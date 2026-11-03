import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { digest } from './state.mjs';
import { SERVICE } from './dashboard-server.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dashboard-server.mjs');
const metadataPath = (directory) => path.join(directory, '_dashboard.json');
async function existingService(directory) {
  let data;
  try { data = JSON.parse(await readFile(metadataPath(directory), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  if (data.service !== SERVICE || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535 || !/^[a-f0-9]{64}$/.test(data.token)) return null;
  const origin = `http://127.0.0.1:${data.port}`;
  try {
    const res = await fetch(`${origin}/api/health`, { headers: { Authorization: `Bearer ${data.token}` }, signal: AbortSignal.timeout(1500) });
    const health = await res.json();
    return res.ok && health.service === SERVICE && health.directoryHash === digest(path.resolve(directory)) && health.pid === data.pid
      ? { ...data, origin, activeClients: Number.isInteger(health.activeClients) ? health.activeClients : 0 } : null;
  } catch { return null; }
}

async function saveMetadata(directory, service) {
  const temporary = `${metadataPath(directory)}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      const { activeClients, ...persistent } = service;
      await file.writeFile(JSON.stringify(persistent) + '\n'); await file.sync();
    } finally { await file.close(); }
    await rename(temporary, metadataPath(directory));
  } finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function openDashboardUrl(url, { platform = process.platform, spawnProcess = spawn } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('Dashboard opener only accepts a loopback HTTP URL');
  const windows = platform === 'win32';
  const browser = windows ? windowsDefaultBrowser() : null;
  const browserArgs = browser ? (/firefox/i.test(browser) ? ['-new-window', url] : ['--new-window', url]) : [];
  const [command, args, spawnOptions] = browser
    ? [browser, browserArgs, {}]
    : windows
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Start-Process -FilePath ([Environment]::GetEnvironmentVariable('MODELTRACE_DASHBOARD_URL'))"], { MODELTRACE_DASHBOARD_URL: url }]
    : platform === 'darwin' ? ['open', [url], {}] : ['xdg-open', [url], {}];
  const child = spawnProcess(command, args, { detached: true, windowsHide: true, stdio: 'ignore', ...(windows ? { env: { ...process.env, ...spawnOptions } } : {}) });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });
  child.unref();
  if (windows && browser && spawnProcess === spawn) {
    const processName = path.basename(browser, path.extname(browser));
    if (/^[A-Za-z0-9_-]+$/.test(processName)) {
      await delay(400);
      const focus = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1; if ($p) {(New-Object -ComObject WScript.Shell).AppActivate($p.Id)}`], { detached: true, windowsHide: true, stdio: 'ignore' });
      focus.unref();
    }
  }
}

function windowsDefaultBrowser() {
  const choice = spawnSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice', '/v', 'ProgId'], { encoding: 'utf8', windowsHide: true });
  const progId = choice.status === 0 ? choice.stdout.match(/\bProgId\s+REG_SZ\s+([^\s\r\n]+)/i)?.[1] : null;
  if (!progId) return null;
  const command = spawnSync('reg.exe', ['query', `HKCR\\${progId}\\shell\\open\\command`, '/ve'], { encoding: 'utf8', windowsHide: true });
  if (command.status !== 0) return null;
  const raw = command.stdout.match(/^\s*\(Default\)\s+REG_SZ\s+(.*)$/im)?.[1]?.trim();
  const executable = raw?.match(/^"([^"]+)"/)?.[1] || raw?.split(/\s+/)[0];
  return executable && path.isAbsolute(executable) ? executable : null;
}

export async function launchDashboard(directory, session, { autoOpen = false, opener = openDashboardUrl, now = Date.now } = {}) {
  directory = path.resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = `${metadataPath(directory)}.lock`;
  let lock;
  const deadline = Date.now() + 6000;
  while (!lock) {
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Dashboard startup busy; retry. Check for a stale lock only after confirming no startup is running: ${lockPath}`);
      await delay(60);
    }
  }
  let service, reused = true, opened = false, url;
  try {
    service = await existingService(directory);
    if (!service) {
      reused = false;
      const token = randomBytes(32).toString('hex');
      const child = spawn(process.execPath, [script], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      try {
        service = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Dashboard startup timed out')), 8000);
          const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
          child.once('error', (error) => finish(error));
          child.once('exit', (code) => finish(new Error(`Dashboard exited during startup (${code})`)));
          child.once('message', (message) => message.error ? finish(new Error(message.error)) : finish(null, { service: SERVICE, ...message, token, origin: `http://127.0.0.1:${message.port}` }));
          child.send({ directory, token });
        });
        await saveMetadata(directory, service);
        child.disconnect(); child.unref();
      } catch (error) {
        // This is the exact child created by this request, not a PID read from disk.
        child.kill();
        if (child.connected) child.disconnect();
        child.unref();
        throw error;
      }
    }
    const fragment = new URLSearchParams({ token: service.token, ...(session ? { session: digest(session) } : {}) });
    url = `${service.origin}/#${fragment}`;
    const openedRecently = Number.isFinite(service.lastOpenedAt) && now() - service.lastOpenedAt < 30000;
    if (autoOpen && (service.activeClients || 0) === 0 && !openedRecently) {
      await opener(url);
      opened = true;
      service.lastOpenedAt = now();
      await saveMetadata(directory, service);
    }
  } finally { await lock.close(); await unlink(lockPath); }
  return { url, reused, opened, pid: service.pid, localOnly: true, samplingStarted: false, note: 'Local dashboard only; refresh does not call a model. The URL contains a local access capability: do not publish it. Use dashboard-stop to close the service.' };
}

export async function stopDashboard(directory) {
  const service = await existingService(directory);
  if (!service) return { stopped: false, reason: 'No reachable authenticated dashboard; no process was killed.' };
  const res = await fetch(`${service.origin}/api/shutdown`, {
    method: 'POST', headers: { Authorization: `Bearer ${service.token}`, Origin: service.origin, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error('Dashboard did not accept shutdown; no process was killed');
  return { stopped: true, note: 'Dashboard closed. Monitoring and audit history are unchanged.' };
}
