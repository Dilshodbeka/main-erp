import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, getSession } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }));

vi.mock('./repository', () => ({
  supabase: { functions: { invoke }, auth: { getSession } },
}));

import { listAccounts } from './accessApi';

describe('accessApi', () => {
  beforeEach(() => {
    invoke.mockReset();
    getSession.mockReset();
  });

  it('sends the signed-in user token to erp-access', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'user-jwt' } }, error: null });
    invoke.mockResolvedValue({ data: { ok: true, accounts: [] }, error: null });

    await listAccounts();

    expect(invoke).toHaveBeenCalledWith('erp-access', {
      body: { action: 'list' },
      headers: { Authorization: 'Bearer user-jwt' },
    });
  });

  it('reports a missing session instead of calling the function anonymously', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(listAccounts()).rejects.toMatchObject({ code: 'session_missing' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
