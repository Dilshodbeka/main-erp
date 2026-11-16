import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, getSession } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }));

vi.mock('./repository', () => ({
  supabase: { functions: { invoke }, auth: { getSession } },
}));

import {
  CONFIRM_WORD, cloudBackupErrorText, createCloudCopy, ensureDailyCopy, listCloudCopies, readCloudCopy,
  restoreCloudCopy, verifyCloudCopy,
} from './cloudBackup';
import type { State } from './types';

const state = { version: 4, revision: 7, companyId: 'a1111111-1111-4111-8111-111111111111' } as unknown as State;
const meta = { key: 'companies/a/2026-11-04T090000Z-r7.json', exportedAt: '2026-11-04T09:00:00.000Z', revision: 7, bytes: 74000 };

describe('cloudBackup transport', () => {
  beforeEach(() => {
    invoke.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({ data: { session: { access_token: 'user-jwt' } }, error: null });
  });

  it('sends the signed-in token and the state block when storing a copy', async () => {
    invoke.mockResolvedValue({ data: { ok: true, copy: meta }, error: null });

    await expect(createCloudCopy(state)).resolves.toEqual(meta);

    expect(invoke).toHaveBeenCalledWith('erp-backup', {
      body: { action: 'put', state },
      headers: { Authorization: 'Bearer user-jwt' },
    });
  });

  it('reports a missing session instead of calling the function anonymously', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(listCloudCopies('2026-11-04T10:00:00.000Z')).rejects.toMatchObject({ code: 'session_missing' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('marks the newest copy fresh or stale for the watchdog', async () => {
    invoke.mockResolvedValue({ data: { ok: true, copies: [meta] }, error: null });

    await expect(listCloudCopies('2026-11-04T10:00:00.000Z')).resolves.toMatchObject({ fresh: true, latest: meta });
    await expect(listCloudCopies('2026-11-06T10:00:00.000Z')).resolves.toMatchObject({ fresh: false });

    invoke.mockResolvedValue({ data: { ok: true, copies: [] }, error: null });
    await expect(listCloudCopies('2026-11-04T10:00:00.000Z')).resolves.toMatchObject({ fresh: false, latest: null });
  });

  it('skips the daily copy while the newest one is fresh', async () => {
    invoke.mockResolvedValue({ data: { ok: true, copies: [meta] }, error: null });

    const result = await ensureDailyCopy(state, '2026-11-04T10:00:00.000Z');

    expect(result).toEqual({ ran: false, fresh: true });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('stores a copy when the cloud has none', async () => {
    invoke
      .mockResolvedValueOnce({ data: { ok: true, copies: [] }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, copy: meta }, error: null });

    const result = await ensureDailyCopy(state, '2026-11-04T10:00:00.000Z');

    expect(result).toEqual({ ran: true, fresh: false, copy: meta });
    expect(invoke.mock.calls[1][1]).toMatchObject({ body: { action: 'put' } });
  });

  it('refuses to restore before the typed confirmation matches', async () => {
    await expect(restoreCloudCopy({ key: meta.key, expectedRevision: 7, confirm: 'ha', state }))
      .rejects.toMatchObject({ code: 'confirm_mismatch' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sends the key, the expected revision, the confirmation and the live state block', async () => {
    invoke.mockResolvedValue({ data: { ok: true, revision: 8, safetyCopy: meta }, error: null });

    await expect(restoreCloudCopy({ key: meta.key, expectedRevision: 7, confirm: CONFIRM_WORD, state }))
      .resolves.toMatchObject({ revision: 8, safetyCopy: meta });

    expect(invoke).toHaveBeenCalledWith('erp-backup', {
      body: { action: 'restore', key: meta.key, expectedRevision: 7, confirm: CONFIRM_WORD, state },
      headers: { Authorization: 'Bearer user-jwt' },
    });
  });

  it('asks the server to verify a stored copy and reports what it found', async () => {
    invoke.mockResolvedValue({ data: { ok: true, verified: { ok: false, problems: ['erp_cash: kutilgan 3, faylda 2.'] } }, error: null });

    await expect(verifyCloudCopy(meta.key)).resolves.toEqual({ ok: false, problems: ['erp_cash: kutilgan 3, faylda 2.'] });

    expect(invoke).toHaveBeenCalledWith('erp-backup', {
      body: { action: 'verify', key: meta.key },
      headers: { Authorization: 'Bearer user-jwt' },
    });
  });

  it('reads a stored copy so the screen can play it back before restoring', async () => {
    invoke.mockResolvedValue({ data: { ok: true, document: { companyId: state.companyId, tables: {} } }, error: null });

    await expect(readCloudCopy(meta.key)).resolves.toMatchObject({ companyId: state.companyId });
    expect(invoke.mock.calls[0][1]).toMatchObject({ body: { action: 'get', key: meta.key } });
  });

  it('keeps the server error code so the screen can explain it', async () => {    invoke.mockResolvedValue({ data: { ok: false, code: 'revision_conflict', message: 'Company is at 9' }, error: null });
    await expect(restoreCloudCopy({ key: meta.key, expectedRevision: 7, confirm: CONFIRM_WORD, state }))
      .rejects.toMatchObject({ code: 'revision_conflict', message: 'Company is at 9' });

    invoke.mockResolvedValue({
      data: null,
      error: { message: 'Failed to fetch', context: { json: async () => ({ ok: false, code: 'storage_unavailable' }) } },
    });
    await expect(createCloudCopy(state)).rejects.toMatchObject({ code: 'storage_unavailable' });
  });

  it('explains every failure in Uzbek instead of showing a raw code', () => {
    expect(cloudBackupErrorText('confirm_mismatch')).toContain('TIKLASH');
    expect(cloudBackupErrorText('revision_conflict')).toContain('yangi');
    expect(cloudBackupErrorText('storage_unavailable')).toMatch(/bulut/i);
    expect(cloudBackupErrorText('access_denied')).toContain('egasi');
    expect(cloudBackupErrorText('anything else')).toBe('anything else');
  });
});
