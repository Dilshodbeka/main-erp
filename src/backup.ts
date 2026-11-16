import type { State } from './types';

export interface BackupFile {
  app: 'aliya-erp'; kind: 'backup'; version: State['version'];
  companyId: string; revision: number; exportedAt: string; state: State;
}

export interface BackupMeta { key: string; exportedAt: string; revision: number; bytes: number }

export interface SnapshotStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'aliya-erp-backup:';
const MARK = 'aliya-erp-backup:last';
export const SNAPSHOT_KEEP = 7;

export function buildBackup(state: State, exportedAt: string = new Date().toISOString()): BackupFile {
  return { app: 'aliya-erp', kind: 'backup', version: state.version, companyId: state.companyId, revision: state.revision, exportedAt, state };
}

export function backupName(backup: BackupFile): string {
  return `aliya-erp-${backup.companyId.slice(0, 8)}-${backup.exportedAt.slice(0, 10)}-r${backup.revision}.json`;
}

export function parseBackup(text: string): BackupFile {
  const value = JSON.parse(text) as Partial<BackupFile>;
  if (value?.app !== 'aliya-erp' || value.kind !== 'backup' || !value.state || typeof value.revision !== 'number') {
    throw new Error('Bu Aliya ERP zaxira fayli emas');
  }
  return value as BackupFile;
}

export function downloadBackup(state: State, exportedAt?: string): BackupFile {
  const backup = buildBackup(state, exportedAt);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = backupName(backup);
  link.click();
  URL.revokeObjectURL(link.href);
  return backup;
}

export function saveSnapshot(storage: SnapshotStorage, state: State, exportedAt: string = new Date().toISOString(), keep: number = SNAPSHOT_KEEP): BackupMeta[] {
  const backup = buildBackup(state, exportedAt);
  storage.setItem(`${PREFIX}${exportedAt}`, JSON.stringify(backup));
  storage.setItem(MARK, exportedAt);
  for (const meta of listSnapshots(storage).slice(keep)) storage.removeItem(meta.key);
  return listSnapshots(storage);
}

export function listSnapshots(storage: SnapshotStorage): BackupMeta[] {
  const rows: BackupMeta[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const backup = parseBackup(raw);
      rows.push({ key, exportedAt: backup.exportedAt, revision: backup.revision, bytes: raw.length });
    } catch { /* Ignore unrelated or damaged entries. */ }
  }
  return rows.sort((left, right) => right.exportedAt.localeCompare(left.exportedAt));
}

export function readSnapshot(storage: SnapshotStorage, key: string): BackupFile | null {
  if (!key.startsWith(PREFIX)) return null;
  const raw = storage.getItem(key);
  if (!raw) return null;
  try { return parseBackup(raw); } catch { return null; }
}

export function shouldSnapshot(lastExportedAt: string | null, now: string = new Date().toISOString()): boolean {
  return !lastExportedAt || lastExportedAt.slice(0, 10) !== now.slice(0, 10);
}

export function lastSnapshotMark(storage: SnapshotStorage): string | null {
  return storage.getItem(MARK);
}
