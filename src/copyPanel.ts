// Panel-side wording and gates for cloud copies. Kept out of the component so the
// freshness banner, the restore gate and the preview list are covered by tests.
import { FRESH_HOURS, isCopyFresh, type CopyMeta } from '../supabase/functions/_shared/backup';
import { CONFIRM_WORD } from './cloudBackup';

export type BannerTone = 'ok' | 'warn';
export interface CopyBanner { tone: BannerTone; text: string }

export function ageText(exportedAt: string, now: string): string {
  const created = Date.parse(exportedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(created) || !Number.isFinite(current)) return 'vaqti noma’lum';
  const hours = Math.floor((current - created) / 3_600_000);
  if (hours < 0) return 'vaqti noma’lum';
  if (hours < 24) return `${hours} soat oldin`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} kun oldin`;
  return `${Math.floor(days / 30)} oy oldin`;
}

export function copyBanner(latest: CopyMeta | null, now: string): CopyBanner {
  if (!latest) {
    return { tone: 'warn', text: 'Bulutda hali nusxa yo‘q. «Bulutga nusxa olish» bilan birinchi nusxani yarating.' };
  }
  const age = ageText(latest.exportedAt, now);
  if (isCopyFresh(latest.exportedAt, now)) {
    return { tone: 'ok', text: `Oxirgi bulut nusxasi ${age} — yangi.` };
  }
  return { tone: 'warn', text: `Oxirgi bulut nusxasi ${age} — ${FRESH_HOURS} soatdan eskirgan. Ilova ochilganda yangilanadi, ho‘zir qo‘lda ham olishingiz mumkin.` };
}

export function isConfirmed(word: string): boolean {
  return word.trim() === CONFIRM_WORD;
}

export function previewRows(counts: Record<string, number>): { table: string; rows: number }[] {
  return Object.entries(counts)
    .filter(([, rows]) => rows > 0)
    .map(([table, rows]) => ({ table, rows }))
    .sort((left, right) => left.table.localeCompare(right.table));
}
