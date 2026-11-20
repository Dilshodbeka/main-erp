// Where "done / later" reactions to recommendations are kept: the company database when the
// migration is applied, otherwise this browser (demo mode, or a server that is not updated yet).
import type { SupabaseClient } from '@supabase/supabase-js';
import { DONE_DAYS, LATER_DAYS, markUntil, type Insight, type InsightMarks, type InsightMarkStatus } from './insights';

const storageKey = (companyId: string) => `aliya.insights.${companyId}`;

function readLocal(companyId: string, storage: Pick<Storage, 'getItem'>): InsightMarks {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(companyId)) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const marks: InsightMarks = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const row = value as { status?: unknown; hiddenUntil?: unknown } | null;
      if (row && (row.status === 'done' || row.status === 'later') && typeof row.hiddenUntil === 'string') marks[key] = { status: row.status, hiddenUntil: row.hiddenUntil };
    }
    return marks;
  } catch { return {}; }
}

function writeLocal(companyId: string, marks: InsightMarks, storage: Pick<Storage, 'setItem'>): void {
  try { storage.setItem(storageKey(companyId), JSON.stringify(marks)); } catch { /* private mode: the reaction lasts for this page only */ }
}

/** Drops reactions whose time has passed, so the list does not grow forever. */
export function pruneMarks(marks: InsightMarks, nowIso: string): InsightMarks {
  return Object.fromEntries(Object.entries(marks).filter(([, mark]) => mark.hiddenUntil > nowIso));
}

export async function loadInsightMarks(supabase: SupabaseClient | null, companyId: string, nowIso: string, storage: Storage = localStorage): Promise<InsightMarks> {
  if (supabase) {
    const reply = await supabase.rpc('erp_insight_marks');
    if (!reply.error && reply.data && typeof reply.data === 'object') return reply.data as InsightMarks;
  }
  return pruneMarks(readLocal(companyId, storage), nowIso);
}

/** `status: null` brings a hidden card back. Returns the marks after the change. */
export async function saveInsightMark(
  supabase: SupabaseClient | null, companyId: string, current: InsightMarks, insight: Pick<Insight, 'key' | 'title' | 'priority' | 'effect'>,
  status: InsightMarkStatus | null, nowIso: string, storage: Storage = localStorage,
): Promise<InsightMarks> {
  if (supabase) {
    const reply = await supabase.rpc('erp_insight_mark', {
      p_key: insight.key, p_status: status, p_days: status === 'done' ? DONE_DAYS : LATER_DAYS,
      p_title: insight.title, p_priority: insight.priority, p_effect: insight.effect,
    });
    if (!reply.error && reply.data && typeof reply.data === 'object') return reply.data as InsightMarks;
  }
  const next = pruneMarks({ ...current }, nowIso);
  if (status) next[insight.key] = { status, hiddenUntil: markUntil(status, nowIso) }; else delete next[insight.key];
  writeLocal(companyId, next, storage);
  return next;
}
