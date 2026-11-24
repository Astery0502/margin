import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'darwin') throw new Error('Build the macOS distribution on macOS.');
const key = JSON.parse(await readFile('dist/manifest.json')).key;
const unpackedId = [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)]
  .map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
const store = process.env.MARGIN_CHROME_STORE_ID || '';
const ids = [...new Set([unpackedId, store, process.env.MARGIN_EDGE_STORE_ID].filter(Boolean))];
if (!ids.every(id => /^[a-p]{32}$/.test(id))) throw new Error('Invalid extension store ID.');
const origins = ids.map(id => 'chrome-extension://' + id + '/').join(' ');
const flags = ['-s', '-w', '-X "main.origins=' + origins + '"', '-X main.storeID=' + store].join(' ');
const cachedGo = resolve('.cache/toolchains/go/bin/go');
const go = process.env.GO || await access(cachedGo, constants.X_OK).then(() => cachedGo, () => 'go');
const identity = process.env.MARGIN_SIGNING_IDENTITY || '-';
const notaryProfile = process.env.MARGIN_NOTARY_PROFILE;
if (notaryProfile && identity === '-') throw new Error('Choose a Developer ID signing identity for notarization.');
const work = await mkdtemp(join(tmpdir(), 'margin-mac-build-'));
try {
  const app = join(work, 'Margin Connect.app');
  const macos = join(app, 'Contents/MacOS');
  await mkdir(macos, { recursive: true });
  for (const arch of ['arm64', 'amd64']) {
    execFileSync(go, ['build', '-trimpath', '-ldflags', flags, '-o', join(work, arch), '.'],
      { cwd: 'companion', stdio: 'inherit', env: { ...process.env, CGO_ENABLED: '0', GOOS: 'darwin', GOARCH: arch } });
  }
  execFileSync('lipo', ['-create', join(work, 'arm64'), join(work, 'amd64'), '-output', join(macos, 'MarginConnect')]);
  const licenses = join(app, 'Contents/Resources/Licenses');
  await mkdir(licenses, { recursive: true });
  const goRoot = execFileSync(go, ['env', 'GOROOT'], { encoding: 'utf8' }).trim();
  await copyFile(join(goRoot, 'LICENSE'), join(licenses, 'Go.txt'));
  const dependencies = execFileSync(go, ['list', '-deps', '-f', '{{if and .Module (not .Module.Main)}}{{.Module.Path}} {{.Module.Dir}}{{end}}', '.'],
    { cwd: 'companion', encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  for (const module of new Set(dependencies)) {
    const space = module.indexOf(' ');
    const name = module.slice(0, space).replaceAll('/', '-');
    const directory = module.slice(space + 1);
    await copyFile(join(directory, 'LICENSE'), join(licenses, name + '.txt'));
    await copyFile(join(directory, 'NOTICE'), join(licenses, name + '-NOTICE.txt')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>MarginConnect</string><key>CFBundleIdentifier</key><string>dev.margin.connect</string>
<key>CFBundleName</key><string>Margin Connect</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string><key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string><key>LSUIElement</key><true/>
</dict></plist>\n`);
  execFileSync('codesign', ['--force', '--sign', identity, '--options', 'runtime', ...(identity === '-' ? [] : ['--timestamp']), app]);
  execFileSync('codesign', ['--verify', '--strict', app]);
  await mkdir('dist-native', { recursive: true });
  const archive = 'Margin-Connect-macOS.zip';
  const buildArchive = join(work, archive);
  execFileSync('ditto', ['-c', '-k', '--keepParent', app, buildArchive]);
  if (notaryProfile) {
    execFileSync('xcrun', ['notarytool', 'submit', buildArchive, '--keychain-profile', notaryProfile, '--wait'], { stdio: 'inherit' });
    execFileSync('xcrun', ['stapler', 'staple', app], { stdio: 'inherit' });
    execFileSync('spctl', ['--assess', '--type', 'execute', app], { stdio: 'inherit' });
    await rm(buildArchive);
    execFileSync('ditto', ['-c', '-k', '--keepParent', app, buildArchive]);
  }
  await rename(buildArchive, resolve('dist-native', archive));
  if (!process.env.MARGIN_CONNECT_DOWNLOAD_URL) {
    await copyFile(resolve('dist-native', archive), resolve('dist/providers', archive));
    await writeFile('dist/providers/download.json', JSON.stringify({ url: 'providers/' + archive }));
  }
  console.log('Built universal Margin Connect for ' + ids.join(', '));
} finally { await rm(work, { recursive: true, force: true }); }
