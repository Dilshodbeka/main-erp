import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import {
  backupName, buildBackup, listSnapshots, parseBackup, readSnapshot, saveSnapshot, shouldSnapshot,
} from './backup';

class FakeStorage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

function stateWith(revision: number) {
  const state = emptyState();
  state.revision = revision;
  return state;
}

describe('backup file', () => {
  it('round-trips the full state with company and revision metadata', () => {
    const backup = buildBackup(stateWith(12), '2026-10-31T10:00:00.000Z');
    expect(backup.revision).toBe(12);
    expect(backup.companyId).toBe(stateWith(0).companyId);
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.state.revision).toBe(12);
    expect(parsed.exportedAt).toBe('2026-10-31T10:00:00.000Z');
    expect(backupName(backup)).toContain('2026-10-31');
    expect(backupName(backup)).toContain('r12');
    expect(backupName(backup).endsWith('.json')).toBe(true);
  });

  it('rejects a foreign or broken file', () => {
    expect(() => parseBackup('{"hello":1}')).toThrow();
    expect(() => parseBackup('not json')).toThrow();
  });
});

describe('local snapshots', () => {
  it('keeps only the newest snapshots and lists them with metadata', () => {
    const storage = new FakeStorage();
    for (let day = 1; day <= 9; day++) {
      saveSnapshot(storage, stateWith(day), `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`);
    }
    const list = listSnapshots(storage);
    expect(list).toHaveLength(7);
    expect(list[0].revision).toBe(9);
    expect(list.at(-1)!.revision).toBe(3);
    expect(readSnapshot(storage, list[0].key)!.state.revision).toBe(9);
  });

  it('snapshots at most once per day', () => {
    expect(shouldSnapshot(null, '2026-10-31T08:00:00.000Z')).toBe(true);
    expect(shouldSnapshot('2026-10-30T08:00:00.000Z', '2026-10-31T08:00:00.000Z')).toBe(true);
    expect(shouldSnapshot('2026-10-31T08:00:00.000Z', '2026-10-31T20:00:00.000Z')).toBe(false);
  });
});
