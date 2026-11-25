import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, cp, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const windows = process.argv.includes('--windows');
if (!windows && process.platform !== 'darwin') throw new Error('Build the macOS distribution on macOS.');
const { key, version } = JSON.parse(await readFile('dist/manifest.json'));
const unpackedId = [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)]
  .map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
const store = process.env.MARGIN_CHROME_STORE_ID || '';
const ids = [...new Set([unpackedId, store, process.env.MARGIN_EDGE_STORE_ID].filter(Boolean))];
if (!ids.every(id => /^[a-p]{32}$/.test(id))) throw new Error('Invalid extension store ID.');
const origins = ids.map(id => 'chrome-extension://' + id + '/');
const flags = ['-s', '-w', '-X "main.origins=' + origins.join(' ') + '"', '-X main.storeID=' + store].join(' ');
const cachedGo = resolve('.cache/toolchains/go/bin/go');
const go = process.env.GO || await access(cachedGo, constants.X_OK).then(() => cachedGo, () => 'go');
const identity = process.env.MARGIN_SIGNING_IDENTITY || '-';
const notaryProfile = process.env.MARGIN_NOTARY_PROFILE;
if (!windows && notaryProfile && identity === '-') throw new Error('Choose a Developer ID signing identity for notarization.');
const work = await mkdtemp(join(tmpdir(), 'margin-connect-build-'));
try {
  const licenses = join(work, 'Licenses');
  await mkdir(licenses, { recursive: true });
  const goRoot = execFileSync(go, ['env', 'GOROOT'], { encoding: 'utf8' }).trim();
  await copyFile(join(goRoot, 'LICENSE'), join(licenses, 'Go.txt'));
  const dependencies = execFileSync(go, ['list', '-deps', '-f', '{{if and .Module (not .Module.Main)}}{{.Module.Path}} {{.Module.Dir}}{{end}}', '.'],
    { cwd: 'companion', encoding: 'utf8', env: { ...process.env, GOOS: windows ? 'windows' : 'darwin' } }).trim().split('\n').filter(Boolean);
  for (const module of new Set(dependencies)) {
    const space = module.indexOf(' ');
    const name = module.slice(0, space).replaceAll('/', '-');
    const directory = module.slice(space + 1);
    await copyFile(join(directory, 'LICENSE'), join(licenses, name + '.txt'));
    await copyFile(join(directory, 'NOTICE'), join(licenses, name + '-NOTICE.txt')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  await mkdir('dist-native', { recursive: true });
  const archive = windows ? 'Margin-Connect-Windows.exe' : 'Margin-Connect-macOS.zip';
  const buildArchive = join(work, archive);
  if (windows) {
    await writeFile(join(work, 'host.json'), JSON.stringify({ name: 'dev.margin.connect', description: 'Margin Connect', type: 'stdio', path: 'MarginConnect.exe', allowed_origins: origins }));
    const thumbprint = process.env.MARGIN_WINDOWS_SIGN_THUMBPRINT;
    if (thumbprint && !/^[0-9a-f]{40}$/i.test(thumbprint)) throw new Error('Invalid signing certificate thumbprint.');
    for (const arch of ['amd64', 'arm64']) {
      const exe = join(work, arch + '.exe');
      execFileSync(go, ['build', '-trimpath', '-ldflags', flags + ' -H windowsgui', '-o', exe, '.'],
        { cwd: 'companion', stdio: 'inherit', env: { ...process.env, CGO_ENABLED: '0', GOOS: 'windows', GOARCH: arch } });
      if (thumbprint) execFileSync('signtool', ['sign', '/sha1', thumbprint, '/fd', 'SHA256', '/tr', 'http://timestamp.digicert.com', '/td', 'SHA256', exe], { stdio: 'inherit' });
    }
    const flag = process.platform === 'win32' ? '/' : '-';
    execFileSync(process.env.MAKENSIS || 'makensis', [flag + 'DWORK=' + work, ...(thumbprint ? [flag + 'DCERT=' + thumbprint] : []), resolve('scripts/connect-windows.nsi')], { stdio: 'inherit' });
  } else {
    const app = join(work, 'Margin Connect.app');
    const macos = join(app, 'Contents/MacOS');
    await mkdir(macos, { recursive: true });
    for (const arch of ['arm64', 'amd64']) {
      const cc = 'clang -arch ' + (arch === 'amd64' ? 'x86_64' : 'arm64');
      execFileSync(go, ['build', '-trimpath', '-ldflags', flags, '-o', join(work, arch), '.'],
        { cwd: 'companion', stdio: 'inherit', env: { ...process.env, CC: cc, CGO_ENABLED: '1', GOOS: 'darwin', GOARCH: arch, MACOSX_DEPLOYMENT_TARGET: '14.0' } });
    }
    const helpers = join(app, 'Contents/Helpers');
    await mkdir(helpers);
    const host = join(helpers, 'MarginConnect');
    execFileSync('lipo', ['-create', join(work, 'arm64'), join(work, 'amd64'), '-output', host]);
    const signing = ['--force', '--sign', identity, '--options', 'runtime', ...(identity === '-' ? [] : ['--timestamp'])];
    execFileSync('codesign', [...signing, '--identifier', 'dev.margin.connect.host', host]);
    execFileSync('clang', ['-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=14.0', '-framework', 'Foundation',
      'scripts/connect-launcher.m', '-o', join(macos, 'MarginConnect')]);
    await cp(licenses, join(app, 'Contents/Resources/Licenses'), { recursive: true });
    await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>MarginConnect</string><key>CFBundleIdentifier</key><string>dev.margin.connect</string>
<key>CFBundleName</key><string>Margin Connect</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string><key>LSUIElement</key><true/>
</dict></plist>\n`);
    execFileSync('codesign', [...signing, app]);
    execFileSync('codesign', ['--verify', '--strict', app]);
    // Installation copies only the host bytes. Verify that exact standalone layout.
    const installedHost = join(work, 'MarginConnect');
    await writeFile(installedHost, await readFile(host), { mode: 0o700 });
    execFileSync('codesign', ['--verify', '--strict', '--all-architectures', installedHost]);
    execFileSync('ditto', ['-c', '-k', '--keepParent', app, buildArchive]);
    if (notaryProfile) {
      execFileSync('xcrun', ['notarytool', 'submit', buildArchive, '--keychain-profile', notaryProfile, '--wait'], { stdio: 'inherit' });
      execFileSync('xcrun', ['stapler', 'staple', app], { stdio: 'inherit' });
      execFileSync('spctl', ['--assess', '--type', 'execute', app], { stdio: 'inherit' });
      await rm(buildArchive);
      execFileSync('ditto', ['-c', '-k', '--keepParent', app, buildArchive]);
    }
  }
  await rename(buildArchive, resolve('dist-native', archive));
  const downloadFile = resolve('dist/providers/download.json');
  const downloads = JSON.parse(await readFile(downloadFile, 'utf8'));
  const os = windows ? 'win' : 'mac';
  if (!downloads[os] || downloads[os] === 'providers/' + archive) {
    await copyFile(resolve('dist-native', archive), resolve('dist/providers', archive));
    downloads[os] = 'providers/' + archive;
    await writeFile(downloadFile, JSON.stringify(downloads));
  }
  console.log('Built ' + archive + ' for ' + ids.join(', '));
} finally { await rm(work, { recursive: true, force: true }); }
