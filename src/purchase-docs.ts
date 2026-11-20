// The supplier's own document of a purchase: receipt (chek) number and date. Kept beside the
// purchase, outside the command kernel: the company database when the migration is applied,
// otherwise this browser (demo mode).
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PurchaseDoc { number: string; date: string | null }
export type PurchaseDocs = Record<string, PurchaseDoc>;

const storageKey = (companyId: string) => `aliya.purchase-docs.${companyId}`;

/** Form values → a document, or null when nothing was entered. A wrong date is dropped, not guessed. */
export function cleanDoc(number: string, date: string): PurchaseDoc | null {
  const clean = number.trim().slice(0, 60);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date.trim()) && !Number.isNaN(Date.parse(`${date.trim()}T00:00:00Z`)) ? date.trim() : null;
  return clean || day ? { number: clean, date: day } : null;
}

/** "Chek № 20307 · 12.11.2026" */
export function docLabel(doc: PurchaseDoc | undefined | null): string {
  if (!doc) return '';
  const day = doc.date ? `${doc.date.slice(8, 10)}.${doc.date.slice(5, 7)}.${doc.date.slice(0, 4)}` : '';
  return [doc.number ? `Chek № ${doc.number}` : 'Chek', day].filter(Boolean).join(' · ');
}

function parse(value: unknown): PurchaseDocs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const docs: PurchaseDocs = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const row = raw as { number?: unknown; date?: unknown } | null;
    const doc = row ? cleanDoc(typeof row.number === 'string' ? row.number : '', typeof row.date === 'string' ? row.date : '') : null;
    if (doc) docs[id] = doc;
  }
  return docs;
}

function readLocal(companyId: string, storage: Pick<Storage, 'getItem'>): PurchaseDocs {
  try { return parse(JSON.parse(storage.getItem(storageKey(companyId)) ?? '{}')); } catch { return {}; }
}

export async function loadPurchaseDocs(supabase: SupabaseClient | null, companyId: string, storage: Storage = localStorage): Promise<PurchaseDocs> {
  if (supabase) {
    const reply = await supabase.rpc('erp_purchase_docs');
    if (!reply.error) return parse(reply.data);
  }
  return readLocal(companyId, storage);
}

/** Saves (or, with `doc: null`, clears) the receipt of one purchase. Returns all documents after the change. */
export async function savePurchaseDoc(supabase: SupabaseClient | null, companyId: string, current: PurchaseDocs, purchaseId: string, doc: PurchaseDoc | null, storage: Storage = localStorage): Promise<PurchaseDocs> {
  if (supabase) {
    const reply = await supabase.rpc('erp_purchase_doc_set', { p_purchase_id: purchaseId, p_number: doc?.number ?? '', p_date: doc?.date ?? null });
    if (!reply.error) return parse(reply.data);
    throw new Error('Chek raqami saqlanmadi. Bazada yangilanish qo‘llanmagan bo‘lishi mumkin.');
  }
  const next = { ...current };
  if (doc) next[purchaseId] = doc; else delete next[purchaseId];
  try { storage.setItem(storageKey(companyId), JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
