// Run in a clean Windows account. The installer registers Chrome and Edge for the current user.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') throw new Error('Run this installer check on Windows.');
const dir = join(process.env.LOCALAPPDATA, 'Margin', 'Connect');
const host = join(dir, 'MarginConnect.exe');
const installer = resolve('dist-native/Margin-Connect-Windows.exe');
const uninstall = join(dir, 'Uninstall.exe');
const registrations = ['Google\\Chrome', 'Microsoft\\Edge'].map(browser =>
  'HKCU\\Software\\' + browser + '\\NativeMessagingHosts\\dev.margin.connect');
const uninstallKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MarginConnect';
const query = key => spawnSync('reg.exe', ['query', key, '/reg:32'], { encoding: 'utf8' });
await access(installer);
await assert.rejects(stat(dir), { code: 'ENOENT' }, 'Use a Windows test account without an existing Connect install.');
for (const key of [...registrations, uninstallKey]) assert.equal(query(key).status, 1, 'Use an unregistered test account.');

async function request(origin, op) {
  const body = Buffer.from(JSON.stringify({ op }));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  // The native process watches the pipe for cancellation. Keep stdin open for the full response.
  const data = await new Promise((resolve, reject) => {
    const child = spawn(host, [origin], { stdio: ['pipe', 'pipe', 'inherit'], timeout: 15000 });
    const chunks = [];
    child.on('error', reject);
    child.stdout.on('data', data => chunks.push(data));
    child.on('close', code => {
      if (code !== 0) return reject(new Error('Native host exited with code ' + code));
      resolve(Buffer.concat(chunks));
    });
    child.stdin.on('error', reject);
    child.stdin.write(Buffer.concat([size, body]));
  });
  assert.equal(data.readUInt32LE(0), data.length - 4);
  return JSON.parse(data.subarray(4).toString());
}

execFileSync(installer, ['/S'], { timeout: 60000 });
try {
  const manifest = JSON.parse(await readFile(join(dir, 'host.json'), 'utf8'));
  const origin = manifest.allowed_origins[0];
  for (const key of registrations) assert.ok(query(key).stdout.includes(join(dir, 'host.json')));
  assert.equal((await request(origin, 'capabilities')).protocol, 2);
  assert.equal((await request(origin, 'v2-deepseek-status')).connected, false);
  assert.equal((await request(origin, 'v2-deepseek-logout')).done, true);
  const before = await readFile(join(dir, 'DeepSeek', 'account.dpapi'));
  execFileSync(installer, ['/S'], { timeout: 60000 });
  assert.deepEqual(await readFile(join(dir, 'DeepSeek', 'account.dpapi')), before);
  assert.equal((await request(origin, 'v2-deepseek-status')).generation, 1);
} finally {
  execFileSync(uninstall, ['/S'], { timeout: 60000 });
  // NSIS runs the uninstaller from a temporary copy so it can delete itself.
  const deadline = Date.now() + 60000;
  while (await stat(dir).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  })) {
    if (Date.now() >= deadline) throw new Error('Uninstall did not remove ' + dir);
    await delay(200);
  }
}
for (const key of [...registrations, uninstallKey]) assert.equal(query(key).status, 1);
await assert.rejects(access(host), { code: 'ENOENT' });
await assert.rejects(access(join(dir, 'DeepSeek', 'account.dpapi')), { code: 'ENOENT' });
console.log('Windows user installation, Chrome/Edge registration, protected state, upgrade and uninstall passed.');
