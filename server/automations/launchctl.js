// launchctl wrappers. LAUNCHCTL_BIN overrides the binary (tests use a mock script).
import os from 'node:os';
import { run } from './exec.js';

const BIN = () => process.env.LAUNCHCTL_BIN || 'launchctl';
export const domain = () => `gui/${process.env.LAUNCHD_UID || os.userInfo().uid}`;

export const launchctl = args => run(BIN(), args);

/** @returns {Promise<Map<string,{pid:number|null,status:number|null}>>} loaded jobs from `launchctl list` */
export async function listLoaded() {
  const r = await launchctl(['list']);
  const out = new Map();
  for (const line of r.stdout.split('\n').slice(1)) {
    const [pid, status, label] = line.split('\t');
    if (label) out.set(label.trim(), { pid: pid === '-' ? null : Number(pid), status: status === '-' ? null : Number(status) });
  }
  return out;
}

/** @returns {Promise<Set<string>>} labels launchd has marked disabled */
export async function listDisabled() {
  const r = await launchctl(['print-disabled', domain()]);
  const out = new Set();
  for (const m of r.stdout.matchAll(/"([^"]+)"\s*=>\s*(disabled|true)/g)) out.add(m[1]);
  return out;
}

export const bootout = label => launchctl(['bootout', `${domain()}/${label}`]);
export const bootstrap = file => launchctl(['bootstrap', domain(), file]);
export const kickstart = label => launchctl(['kickstart', '-k', `${domain()}/${label}`]);
export const setEnabled = (label, on) => launchctl([on ? 'enable' : 'disable', `${domain()}/${label}`]);

/** bootout (errors ignored: it may not be loaded) then bootstrap. */
export async function reload(file, label) {
  await bootout(label);
  return bootstrap(file);
}
