// Raskroy hisobotidan materiallarni olish (BAZIS, SketchCut, Excel): hisobotdagi jadval nusxalanadi yoki
// CSV/TXT fayl ochiladi. Format qat’iy emas: har bir qatordan nom va sonlar ajratiladi, qaysi son miqdor
// ekanini foydalanuvchi tanlaydi; nom ombordagi materialga o‘xshashligi bo‘yicha topiladi.
import { nameWords } from './staff-control';
import type { Item } from './types';

export interface CutRow { name: string; numbers: number[] }
export interface CutMatch { name: string; qty: number; itemId: string | null; sure: boolean }
/** Which number of a row is the quantity: 'last' or a zero-based position. */
export type QtyColumn = 'last' | number;

const UNIT = /^(шт|штук|лист|листов|л|м|м2|м²|п\.?\s?м|пог\.?\s?м|кг|dona|list|m|m2|m²|metr|kg|l)\.?$/i;
const TOTAL = /^(итого|всего|jami|total|сумма)(?!\p{L})/iu;
const numberOf = (cell: string): number | null => {
  const clean = cell.replace(/\s/g, '').replace(/(шт|лист|м2|м²|п\.?м|м|кг|dona|list|m2|m²|m|kg)\.?$/i, '');
  if (!/^\d+([.,]\d+)?$/.test(clean)) return null;
  const value = Number(clean.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};

function cells(line: string): string[] {
  const split = line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : line.includes('|') ? line.split('|') : line.split(/\s{2,}/);
  return split.map(cell => cell.trim().replace(/^"|"$/g, '')).filter(cell => cell !== '');
}

/** Text copied from a report → rows with a name and at least one number. Headers and totals are skipped. */
export function parseCutText(text: string): CutRow[] {
  const rows: CutRow[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let parts = cells(line);
    // "ЛДСП Белый 16мм 12 лист" — one cell: the trailing number is the quantity.
    if (parts.length === 1) {
      const tail = /^(.*\S)\s+(\d+(?:[.,]\d+)?)\s*([^\d\s]{0,6})$/.exec(line);
      if (!tail || (tail[3] && !UNIT.test(tail[3]))) continue;
      parts = [tail[1], tail[2]];
    }
    const name = parts.find(cell => numberOf(cell) === null && !UNIT.test(cell) && /\p{L}{2,}/u.test(cell));
    const numbers = parts.filter(cell => cell !== name).map(numberOf).filter((value): value is number => value !== null);
    if (!name || TOTAL.test(name) || !numbers.some(value => value > 0)) continue;
    rows.push({ name, numbers });
  }
  return rows;
}

export function qtyOf(row: CutRow, column: QtyColumn): number {
  const value = column === 'last' ? row.numbers.at(-1) : row.numbers[column];
  return value !== undefined && value > 0 ? value : 0;
}

/** The most numbers any row has — how many columns the chooser offers. */
export const numberColumns = (rows: CutRow[]): number => rows.reduce((most, row) => Math.max(most, row.numbers.length), 0);

const keyOf = (name: string): string => nameWords(name).join(' ');

/**
 * Finds the stock item for every row. A name the user matched before (`remembered`: report name → item id)
 * wins; otherwise the item sharing the most words, and only when it is clearly the best one.
 */
export function matchCutRows(rows: CutRow[], items: Pick<Item, 'id' | 'name'>[], column: QtyColumn, remembered: Record<string, string> = {}): CutMatch[] {
  const index = items.map(item => ({ id: item.id, words: nameWords(item.name) }));
  return rows.map(row => {
    const qty = qtyOf(row, column);
    const saved = remembered[keyOf(row.name)];
    if (saved && items.some(item => item.id === saved)) return { name: row.name, qty, itemId: saved, sure: true };
    const words = nameWords(row.name);
    const scored = index.map(item => {
      const common = item.words.filter(word => words.includes(word)).length;
      return { id: item.id, score: common === 0 ? 0 : common / Math.max(item.words.length, words.length), common };
    }).filter(entry => entry.score > 0).sort((left, right) => right.score - left.score || right.common - left.common);
    const best = scored[0];
    const clear = best && best.score >= 0.5 && (!scored[1] || best.score - scored[1].score >= 0.15);
    return { name: row.name, qty, itemId: clear ? best.id : null, sure: Boolean(clear && best.score >= 0.99) };
  });
}

/** Adds the chosen rows to the position's materials; a material already in the list gets the quantity added. */
export function mergeCut<T extends { itemId: string; qty: number; issuedQty: number }>(materials: T[], matches: CutMatch[], blank: (itemId: string, qty: number) => T): T[] {
  const next = materials.filter(row => row.itemId).map(row => ({ ...row }));
  for (const match of matches) {
    if (!match.itemId || match.qty <= 0) continue;
    const existing = next.find(row => row.itemId === match.itemId);
    if (existing) existing.qty = Math.round((existing.qty + match.qty) * 1000) / 1000;
    else next.push(blank(match.itemId, match.qty));
  }
  return next;
}

// What the user matched by hand is remembered in this browser, so the next report needs no picking.
const storageKey = (companyId: string) => `aliya.cut-names.${companyId}`;
export function readCutNames(companyId: string, storage: Pick<Storage, 'getItem'> = localStorage): Record<string, string> {
  try { const value = JSON.parse(storage.getItem(storageKey(companyId)) ?? '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}
export function rememberCutNames(companyId: string, matches: CutMatch[], storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  const names = readCutNames(companyId, storage);
  for (const match of matches) if (match.itemId) names[keyOf(match.name)] = match.itemId;
  try { storage.setItem(storageKey(companyId), JSON.stringify(names)); } catch { /* private mode: nothing to remember */ }
}

/** Reports saved from Russian software are often Windows-1251. */
export function decodeReport(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('�')) return utf8;
  try { return new TextDecoder('windows-1251').decode(bytes); } catch { return utf8; }
}
