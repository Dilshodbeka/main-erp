import { describe, expect, it, vi } from 'vitest';
import { cleanDoc, docLabel, loadPurchaseDocs, savePurchaseDoc } from './purchase-docs';

const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as unknown as Storage; };

describe('purchase receipt number and date', () => {
  it('cleans what was typed and ignores an empty form', () => {
    expect(cleanDoc('  20307 ', '2026-11-12')).toEqual({ number: '20307', date: '2026-11-12' });
    expect(cleanDoc('20307', '')).toEqual({ number: '20307', date: null });
    expect(cleanDoc('', '2026-11-12')).toEqual({ number: '', date: '2026-11-12' });
    expect(cleanDoc('  ', '')).toBeNull();
    expect(cleanDoc('7', '12.11.2026')).toEqual({ number: '7', date: null }); // a wrong date is dropped, not guessed
    expect(cleanDoc('x'.repeat(100), '')!.number).toHaveLength(60);
  });

  it('prints a short label', () => {
    expect(docLabel({ number: '20307', date: '2026-11-12' })).toBe('Chek № 20307 · 12.11.2026');
    expect(docLabel({ number: '20307', date: null })).toBe('Chek № 20307');
    expect(docLabel({ number: '', date: '2026-11-13' })).toBe('Chek · 13.11.2026');
    expect(docLabel(undefined)).toBe('');
  });

  it('demo mode keeps receipts in the browser, per company', async () => {
    const storage = memory();
    let docs = await savePurchaseDoc(null, 'c1', {}, 'p1', { number: '20307', date: '2026-11-12' }, storage);
    docs = await savePurchaseDoc(null, 'c1', docs, 'p2', { number: '20308', date: null }, storage);
    expect(await loadPurchaseDocs(null, 'c1', storage)).toEqual({ p1: { number: '20307', date: '2026-11-12' }, p2: { number: '20308', date: null } });
    expect(await loadPurchaseDocs(null, 'c2', storage)).toEqual({});
    docs = await savePurchaseDoc(null, 'c1', docs, 'p1', null, storage);
    expect(Object.keys(docs)).toEqual(['p2']);
  });

  it('cloud mode goes through the database and reports a failed save', async () => {
    const rpc = vi.fn(async (name: string, args?: unknown) => name === 'erp_purchase_docs'
      ? { data: { p1: { number: '20307', date: '2026-11-12' }, bad: { number: 5 } }, error: null }
      : { data: { p9: { number: '1', date: null } }, error: null, args });
    const client = { rpc } as never;
    expect(await loadPurchaseDocs(client, 'c1', memory())).toEqual({ p1: { number: '20307', date: '2026-11-12' } });
    expect(await savePurchaseDoc(client, 'c1', {}, 'p9', { number: '1', date: null }, memory())).toEqual({ p9: { number: '1', date: null } });
    expect(rpc).toHaveBeenLastCalledWith('erp_purchase_doc_set', { p_purchase_id: 'p9', p_number: '1', p_date: null });
    const broken = { rpc: async () => ({ data: null, error: { message: 'no function' } }) } as never;
    await expect(savePurchaseDoc(broken, 'c1', {}, 'p9', { number: '1', date: null }, memory())).rejects.toThrow(/saqlanmadi/);
    expect(await loadPurchaseDocs(broken, 'c1', memory())).toEqual({}); // before the migration: simply nothing to show
  });
});
