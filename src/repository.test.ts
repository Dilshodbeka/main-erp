import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { bootstrapCompany, demoAdmin } from './repository';
import type { Snapshot } from './sync';

const emptySnapshot = (): Snapshot => ({ state: { ...emptyState(), revision: 1 }, actor: demoAdmin });

describe('bootstrapCompany', () => {
  it('does not send a company id when bootstrapping a company', async () => {
    const calls: Array<{ name: string; params?: Record<string, unknown> }> = [];
    const mockRpc = async (name: string, params?: Record<string, unknown>) => {
      calls.push({ name, params });
      return emptySnapshot();
    };
    await bootstrapCompany('My Company', mockRpc);
    expect(calls[0]).toEqual({ name: 'erp_bootstrap_company', params: { p_name: 'My Company' } });
    expect(calls[1]).toEqual({ name: 'erp_snapshot', params: undefined });
  });

  it('trims the company name and rejects an empty one before calling the server', async () => {
    const calls: string[] = [];
    const mockRpc = async (name: string) => { calls.push(name); return emptySnapshot(); };
    await bootstrapCompany('  Aliya Mebel  ', mockRpc);
    expect(calls[0]).toBe('erp_bootstrap_company');
    await expect(bootstrapCompany('   ', mockRpc)).rejects.toThrow('Korxona nomi 2 dan 160 belgigacha bo‘lishi kerak');
    expect(calls).toHaveLength(2);
  });

  it('passes duplicate-profile and access errors through unchanged', async () => {
    const duplicate = async () => { throw new Error('Account already belongs to a company'); };
    await expect(bootstrapCompany('Second Company', duplicate)).rejects.toThrow('Account already belongs to a company');
    const denied = async () => { throw new Error('Authentication required'); };
    await expect(bootstrapCompany('Any Company', denied)).rejects.toThrow('Authentication required');
  });
});
