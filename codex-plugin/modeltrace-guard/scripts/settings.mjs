import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SETTINGS_FILE = '_settings.json';
export const DEFAULT_GLOBAL_SETTINGS = Object.freeze({ autoMonitorNewSessions: true });

function validateSettings(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Global settings must be an object');
  const fields = Object.getOwnPropertyNames(value);
  if (fields.some((field) => !Object.hasOwn(DEFAULT_GLOBAL_SETTINGS, field))) throw new Error('Unknown global setting');
  if (Object.hasOwn(value, 'autoMonitorNewSessions') && typeof value.autoMonitorNewSessions !== 'boolean') throw new Error('autoMonitorNewSessions must be boolean');
  return { ...DEFAULT_GLOBAL_SETTINGS, ...value };
}

export async function readGlobalSettings(directory) {
  const filename = path.join(directory, SETTINGS_FILE);
  try { return validateSettings(JSON.parse(await readFile(filename, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return { ...DEFAULT_GLOBAL_SETTINGS }; throw error; }
}

export async function writeGlobalSettings(directory, patch) {
  if (!patch || Array.isArray(patch) || typeof patch !== 'object' || Object.getOwnPropertyNames(patch).length !== 1 || !Object.hasOwn(patch, 'autoMonitorNewSessions')) throw new Error('Only autoMonitorNewSessions may be changed');
  const next = validateSettings({ ...(await readGlobalSettings(directory)), ...patch });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, SETTINGS_FILE);
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(next, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
  try { await rename(temporary, filename); }
  finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
  return next;
}
