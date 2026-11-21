// Materiallarni raskroy / spetsifikatsiya hisobotidan olish (BAZIS-Mebelshchik, Excel, CSV, nusxalangan jadval).
// Sarlavha qatori topilsa (Наименование, Кол-во, Ед. изм., Артикул) ustunlar o‘zi aniqlanadi; topilmasa —
// har bir qatordan nom va sonlar ajratiladi, miqdor ustunini foydalanuvchi tanlaydi.
// Nom ombordagi pozitsiyaga quyidagi tartibda bog‘lanadi: avval eslab qolingan tanlov, keyin artikul
// (ombordagi nomdagi qavs ichidagi raqam), keyin so‘zlar o‘xshashligi + o‘lchov birligi + qalinlik.
import { nameWords } from './staff-control';
import type { Item } from './types';

export interface CutRow { name: string; numbers: number[]; unit?: string; article?: string; qty?: number }
export interface CutMatch { name: string; qty: number; itemId: string | null; sure: boolean; unit?: string }
/** Which number of a row is the quantity: 'last' or a zero-based position. */
export type QtyColumn = 'last' | number;

const UNIT = /^(шт|штук|лист|листов|л|м|м2|м²|кв\.?\s?м|п\.?\s?м|м\.?\s?п|пог\.?\s?м|кг|компл|dona|list|m|m2|m²|kv|metr|kg)\.?$/i;
const TOTAL = /^(итого|всего|jami|total|сумма)(?!\p{L})/iu;
const numberOf = (cell: string): number | null => {
  const clean = cell.replace(/\s/g, '').replace(/(шт|лист|м2|м²|п\.?м|м\.?п|м|кг|dona|list|m2|m²|m|kg)\.?$/i, '');
  if (!/^\d+([.,]\d+)?$/.test(clean)) return null;
  const value = Number(clean.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};

/** Units of a report and of the stock brought to one spelling: piece, sheet, m, m2, kg, l. */
export function unitKey(raw: string | undefined | null): string {
  const unit = String(raw ?? '').toLowerCase().replace(/\s|\./g, '');
  if (/^(шт|штук|dona|компл|комплект|pcs)$/.test(unit)) return 'piece';
  if (/^(лист|листов|list|лст)$/.test(unit)) return 'sheet';
  if (/^(м2|м²|квм|m2|m²|kv|kvm|квадрат)$/.test(unit)) return 'm2';
  if (/^(м|мп|пм|погм|m|metr|mp|пог)$/.test(unit)) return 'm';
  if (/^(кг|kg)$/.test(unit)) return 'kg';
  if (/^(л|l|litr|литр)$/.test(unit)) return 'l';
  return unit;
}

function cells(line: string): string[] {
  const split = line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : line.includes('|') ? line.split('|') : line.split(/\s{2,}/);
  return split.map(cell => cell.trim().replace(/^"|"$/g, ''));
}

// ── Header detection ─────────────────────────────────────────────────────────────────────────────
const HEAD = {
  name: /(наименован|название|материал|nomi|nom\b|material|изделие|номенклатур)/i,
  qty: /(кол-?во|количеств|кол\.|к-во|miqdor|soni|qty|расход|всего)/i,
  unit: /(ед\.?\s*изм|единиц|ед\.|o.lchov|birlik|unit)/i,
  article: /(артикул|код|artikul|kod|article)/i,
};
interface Columns { name: number; qty: number; unit: number; article: number }

function headerOf(row: string[]): Columns | null {
  const find = (pattern: RegExp, skip: number[] = []) => row.findIndex((cell, index) => !skip.includes(index) && pattern.test(cell));
  const name = find(HEAD.name);
  const qty = find(HEAD.qty, [name]);
  if (name < 0 || qty < 0) return null;
  return { name, qty, unit: find(HEAD.unit, [name, qty]), article: find(HEAD.article, [name, qty]) };
}

function fromTable(table: string[][]): CutRow[] | null {
  const at = table.slice(0, 30).findIndex(row => headerOf(row) !== null);
  if (at < 0) return null;
  const columns = headerOf(table[at])!;
  const rows: CutRow[] = [];
  for (const row of table.slice(at + 1)) {
    const name = (row[columns.name] ?? '').trim();
    const qty = numberOf(row[columns.qty] ?? '');
    if (!name || TOTAL.test(name) || qty === null || qty <= 0 || !/\p{L}{2,}/u.test(name)) continue;
    const unit = columns.unit >= 0 ? (row[columns.unit] ?? '').trim() : '';
    const article = columns.article >= 0 ? (row[columns.article] ?? '').trim() : '';
    rows.push({ name, numbers: [qty], qty, ...(unit ? { unit } : {}), ...(article ? { article } : {}) });
  }
  return rows;
}

function fromLines(table: string[][]): CutRow[] {
  const rows: CutRow[] = [];
  for (const raw of table) {
    let parts = raw.filter(cell => cell !== '');
    if (!parts.length) continue;
    // "ЛДСП Белый 16мм 12 лист" — one cell: the trailing number is the quantity.
    if (parts.length === 1) {
      const tail = /^(.*\S)\s+(\d+(?:[.,]\d+)?)\s*([^\d\s]{0,6})$/.exec(parts[0]);
      if (!tail || (tail[3] && !UNIT.test(tail[3]))) continue;
      parts = tail[3] ? [tail[1], tail[2], tail[3]] : [tail[1], tail[2]];
    }
    const name = parts.find(cell => numberOf(cell) === null && !UNIT.test(cell) && /\p{L}{2,}/u.test(cell));
    const glued = parts.map(cell => /^\d+(?:[.,]\d+)?\s*(\S+)$/.exec(cell.trim())?.[1]).find(tail => tail && UNIT.test(tail));
    const unit = parts.find(cell => UNIT.test(cell)) ?? glued;
    const numbers = parts.filter(cell => cell !== name).map(numberOf).filter((value): value is number => value !== null);
    if (!name || TOTAL.test(name) || !numbers.some(value => value > 0)) continue;
    rows.push({ name, numbers, ...(unit ? { unit } : {}) });
  }
  return rows;
}

/** A table (rows of cells, e.g. from Excel) → material rows. */
export function parseCutTable(table: string[][]): CutRow[] {
  const clean = table.map(row => row.map(cell => String(cell ?? '').trim()));
  return fromTable(clean) ?? fromLines(clean);
}

/** Text copied from a report → material rows. Headers and totals are skipped. */
export function parseCutText(text: string): CutRow[] {
  return parseCutTable(text.replace(/\r/g, '').split('\n').filter(line => line.trim()).map(cells));
}

/** The quantity: the one under the «Кол-во» header, otherwise the chosen number of the row. */
export function qtyOf(row: CutRow, column: QtyColumn): number {
  if (row.qty !== undefined) return row.qty;
  const value = column === 'last' ? row.numbers.at(-1) : row.numbers[column];
  return value !== undefined && value > 0 ? value : 0;
}

/** How many numbers rows have — the quantity column chooser is shown only when the header was not found. */
export const numberColumns = (rows: CutRow[]): number => rows.some(row => row.qty !== undefined) ? 0 : rows.reduce((most, row) => Math.max(most, row.numbers.length), 0);

// ── Matching ─────────────────────────────────────────────────────────────────────────────────────
// Same thing, different words: Russian reports vs Uzbek/Latin stock names.
const SYNONYMS: Record<string, string> = {
  beliy: 'oq', belyy: 'oq', belaya: 'oq', beloe: 'oq', white: 'oq', ak: 'oq',
  cherniy: 'qora', chernyy: 'qora', chernaya: 'qora', black: 'qora', kora: 'qora',
  seriy: 'kulrang', seryy: 'kulrang', seraya: 'kulrang', grey: 'kulrang', gray: 'kulrang',
  hdf: 'xdf', dvp: 'xdf', ldstp: 'ldsp', dsp: 'ldsp', lmdf: 'mdf',
  shagren: 'shagren', shagreni: 'shagren', shagrin: 'shagren', shagrenevaya: 'shagren',
  kromochnaya: 'kromka', kromki: 'kromka', krom: 'kromka', edge: 'kromka',
  mm: '', sm: '', list: '', listov: '', sht: '', dona: '', kvm: '', kv: '', m2: '', mp: '',
  petli: 'petlya', petlya: 'petlya', ruchki: 'ruchka', ruchka: 'ruchka',
  napravlyayushie: 'tandem', napravlyayushaya: 'tandem',
  akril: 'akril', akrill: 'akril', akrilovaya: 'akril', ploskiy: '', tolshina: '',
};
/** Words of a name for comparison: transliterated, numbers split off ("16mm" → "16"), synonyms folded. */
export function matchWords(name: string): string[] {
  // Numbers become words of their own: "16mm" → n16, "0,4" → n0p4, "2" → n2 (single digits count too).
  const marked = name.replace(/(\d)([a-zа-яё°])/gi, '$1 $2').replace(/([a-zа-яё])(\d)/gi, '$1 $2').replace(/(\d)[.,](\d)/g, '$1p$2')
    .replace(/(^|[^\p{L}\d])(\d[\dp]*)/gu, '$1n$2');
  const words = nameWords(marked).map(word => /^n\d/.test(word) ? word.replace(/p0+$/, '') : word);
  const folded = words.map(word => SYNONYMS[word] ?? word).filter(Boolean);
  return [...new Set(folded)];
}
/** "Planka Blum ... (13748)" → "13748": the supplier's article stored in the stock name. */
export const articleOf = (name: string): string | null => /\((\d{3,})\)\s*$/.exec(name)?.[1] ?? null;
/** Small numbers of a name (thickness, width): articles and long codes are not compared here. */
const numbersIn = (words: string[]): string[] => words.filter(word => /^n[\dp]{1,4}$/.test(word));

/** Stock units → the same keys as report units. */
const stockUnit = (unit: string): string => unitKey(unit);

const keyOf = (name: string): string => matchWords(name).join(' ');

/**
 * Finds the stock item for every row. A name the user matched before (`remembered`: report name → item id)
 * wins, then the article, then the item sharing the most words — only when it is clearly the best one.
 * Same unit adds weight (a report in m² picks «LDSP kv» over «LDSP» in sheets); a different thickness
 * (16 vs 18) removes it.
 */
export function matchCutRows(rows: CutRow[], items: Pick<Item, 'id' | 'name' | 'unit'>[], column: QtyColumn, remembered: Record<string, string> = {}): CutMatch[] {
  const index = items.map(item => ({ id: item.id, words: matchWords(item.name), article: articleOf(item.name), unit: stockUnit(item.unit ?? '') }));
  return rows.map(row => {
    const qty = qtyOf(row, column);
    const unit = row.unit ? unitKey(row.unit) : '';
    const base = { name: row.name, qty, ...(row.unit ? { unit: row.unit } : {}) };
    const saved = remembered[keyOf(row.name)];
    if (saved && items.some(item => item.id === saved)) return { ...base, itemId: saved, sure: true };
    const article = (row.article ?? '').replace(/\D/g, '') || articleOf(row.name) || (/\b(\d{4,6})\b/.exec(row.name)?.[1] ?? '');
    const byArticle = article ? index.filter(item => item.article === article) : [];
    if (byArticle.length === 1) return { ...base, itemId: byArticle[0].id, sure: true };
    const words = matchWords(row.name);
    const own = numbersIn(words);
    const scored = index.map(item => {
      const common = item.words.filter(word => words.includes(word)).length;
      if (!common) return { id: item.id, score: 0 };
      let score = common / Math.max(item.words.filter(word => !/^n\d{4,}$/.test(word)).length, words.filter(word => !/^n\d{4,}$/.test(word)).length);
      const theirs = numbersIn(item.words);
      if (own.length && theirs.length && !theirs.some(number => own.includes(number))) score -= 0.4;
      if (unit && item.unit) score += unit === item.unit ? 0.2 : -0.1;
      return { id: item.id, score };
    }).filter(entry => entry.score > 0).sort((left, right) => right.score - left.score);
    const best = scored[0];
    const clear = best && best.score >= 0.5 && (!scored[1] || best.score - scored[1].score >= 0.15);
    return { ...base, itemId: clear ? best.id : null, sure: Boolean(clear && best.score >= 0.99) };
  });
}

/** Adds the chosen rows to the position's materials; a material already in the list gets the quantity added. */
export function mergeCut<T extends { itemId: string; qty: number; issuedQty: number }>(materials: T[], matches: CutMatch[], blank: (itemId: string, qty: number) => T): T[] {
  const next = materials.filter(row => row.itemId).map(row => ({ ...row }));
  for (const match of matches) {
    if (!match.itemId || match.qty <= 0) continue;
    const existing = next.find(row => row.itemId === match.itemId);
    if (existing) existing.qty = Math.round((existing.qty + match.qty) * 1000) / 1000;
    else next.push(blank(match.itemId, Math.round(match.qty * 1000) / 1000));
  }
  return next;
}

/** The report unit differs from the stock unit (m² vs sheets): the quantity has to be checked by hand. */
export function unitMismatch(match: CutMatch, items: Pick<Item, 'id' | 'unit'>[]): boolean {
  if (!match.unit || !match.itemId) return false;
  const item = items.find(row => row.id === match.itemId);
  return Boolean(item && unitKey(match.unit) !== stockUnit(item.unit));
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

/** Excel (xls/xlsx/ods) → all sheets as one table. The reader is loaded only when a file is opened. */
export async function readSpreadsheet(bytes: ArrayBuffer): Promise<string[][]> {
  const XLSX = await import('xlsx');
  const book = XLSX.read(bytes, { type: 'array', cellText: true, cellDates: false });
  const table: string[][] = [];
  for (const name of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false });
    for (const row of rows) table.push((row as unknown[]).map(cell => String(cell ?? '')));
  }
  return table;
}
