import { categoryCodes } from './warehouse';
import type { Item, ItemKind, State } from './types';

export type ItemImportAction = 'create' | 'update' | 'skip';

export interface ItemImportRow {
  line: number;
  name: string;
  unit: string;
  unitGiven: boolean;
  kind: ItemKind;
  kindGiven: boolean;
  category: string | null;
  categoryGiven: boolean;
  minQty: number;
  minQtyGiven: boolean;
  cost: number;
  costGiven: boolean;
  salePrice: number;
  salePriceGiven: boolean;
  openQty: number;
  photoFile: string;
  supplier: string;
  note: string;
  error: string | null;
  warnings: string[];
}

export interface ItemImportPlanRow extends ItemImportRow {
  action: ItemImportAction;
  existingId: string | null;
  changes: string[];
}

export interface ItemImportPlan {
  rows: ItemImportPlanRow[];
  creates: number;
  updates: number;
  skips: number;
  errors: number;
}

export const itemImportColumns = [
  ['Nomi', 'Majburiy. Ombordagi pozitsiya nomi.'],
  ['Birlik', 'dona, list, m, m², kg, l. Bo‘sh bo‘lsa — dona.'],
  ['Tur', 'Material, zagotovka yoki tayyor mahsulot. Bo‘sh bo‘lsa — material.'],
  ['Kategoriya', 'Tasniflagich kodi, masalan 01.01. Bo‘sh bo‘lsa — tasniflanmagan.'],
  ['Minimal zaxira', 'Ogohlantirish chegarasi.'],
  ['Boshlang‘ich qoldiq', 'Faqat yangi pozitsiya uchun omborga kirim qiladi.'],
  ['Tannarx', 'Faqat yangi pozitsiya uchun. Mavjudlarda xarid qabuli o‘zgartiradi.'],
  ['Sotuv narxi', 'Tayyor mahsulot va do‘kon savdosi uchun.'],
  ['Rasm', 'Papkadagi fayl nomi, masalan ldsp-oq.jpg.'],
  ['Yetkazib beruvchi', 'Ma’lumot uchun — zaxiraga ta’sir qilmaydi.'],
  ['Izoh', 'Ma’lumot uchun.'],
] as const;

const headerAliases: Record<string, string[]> = {
  name: ['nomi', 'nom', 'name', 'наименование', 'название', 'материал', 'pozitsiya', 'позиция', 'tovar', 'товар'],
  unit: ['birlik', 'olchov birligi', 'o‘lchov birligi', 'unit', 'ед', 'ед изм', 'ед. изм', 'ед.изм', 'единица', 'единица измерения', 'unit of measure'],
  kind: ['tur', 'turi', 'kind', 'тип', 'вид'],
  category: ['kategoriya', 'category', 'tasnif', 'tasniflagich', 'kategoriya kodi', 'kod', 'code', 'категория', 'классификатор', 'код'],
  minQty: ['minimal', 'minimal zaxira', 'min', 'min qty', 'minimum', 'минимум', 'мин запас', 'мин. запас', 'мин.запас', 'минимальный запас'],
  openQty: ['qoldiq', 'boshlang‘ich qoldiq', 'boshlangich qoldiq', 'miqdor', 'quantity', 'qty', 'остаток', 'количество', 'начальный остаток'],
  cost: ['tannarx', 'cost', 'narx', 'себестоимость', 'цена', 'закупочная цена'],
  salePrice: ['sotuv', 'sotuv narxi', 'sotish', 'sotish narxi', 'sale', 'sale price', 'продажная цена', 'цена продажи'],
  photo: ['rasm', 'foto', 'photo', 'image', 'фото', 'изображение'],
  supplier: ['yetkazib beruvchi', 'taminotchi', 'ta’minotchi', 'supplier', 'поставщик'],
  note: ['izoh', 'note', 'примечание', 'комментарий'],
};

const headerByAlias = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(headerAliases)) {
  for (const alias of aliases) headerByAlias.set(normalizeKey(alias), canonical);
}

export function normalizeKey(value: string): string {
  return value
    .replace(/[\u2018\u2019\u02bc`´]/g, "'")
    .replace(/\u00a0|\u202f/g, ' ')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.:]+$/, '');
}

function itemKey(name: string): string {
  return normalizeKey(name).replace(/'/g, '');
}

const unitAliases: Record<string, string> = {
  dona: 'dona', don: 'dona', шт: 'dona', штук: 'dona', штука: 'dona', pcs: 'dona', piece: 'dona',
  list: 'list', лист: 'list', sheet: 'list',
  m: 'm', м: 'm', metr: 'm', метр: 'm', погм: 'm', погонныйметр: 'm',
  m2: 'm²', м2: 'm²', 'm²': 'm²', 'м²': 'm²', квм: 'm²', квадратметр: 'm²', kvadratmetr: 'm²', squaremeter: 'm²',
  kg: 'kg', кг: 'kg', kilogramm: 'kg', килограмм: 'kg',
  l: 'l', л: 'l', litr: 'l', литр: 'l',
};

export function normalizeUnitText(raw: string): string {
  const value = raw.trim();
  if (!value) return 'dona';
  const lookup = normalizeKey(value).replace(/\./g, '').replace(/\s+/g, '');
  return unitAliases[lookup] ?? value;
}

export function normalizeKindText(raw: string): { kind: ItemKind; error: string | null } {
  const value = normalizeKey(raw).replace(/\./g, '');
  if (!value) return { kind: 'material', error: null };
  if (['material', 'materyal', 'материал', 'list', 'лист', 'listmaterial'].includes(value)) return { kind: 'material', error: null };
  if (['blank', 'zagotovka', 'заготовка', 'полуфабрикат'].includes(value)) return { kind: 'blank', error: null };
  if (['finished', 'tayyor', 'tayyormahsulot', 'mahsulot', 'готовое', 'изделие', 'готовое изделие'].includes(value)) return { kind: 'finished', error: null };
  return { kind: 'material', error: `Tur noto‘g‘ri: ${raw}. Material, zagotovka yoki tayyor mahsulot yozing.` };
}

export function normalizeCategoryText(raw: string): { code: string | null; error: string | null } {
  const value = raw.trim();
  if (!value) return { code: null, error: null };
  if (categoryCodes.includes(value)) return { code: value, error: null };
  const match = value.match(/(\d{1,2})\s*[.,]\s*(\d{1,2})/);
  if (match) {
    const code = `${match[1].padStart(2, '0')}.${match[2].padStart(2, '0')}`;
    return categoryCodes.includes(code) ? { code, error: null } : { code: null, error: `Noma’lum kategoriya: ${raw}` };
  }
  return { code: null, error: `Kategoriya kodi noto‘g‘ri: ${raw}` };
}

export function parseNumberText(raw: string): number | null {
  let value = raw.replace(/\u00a0|\u202f/g, ' ').trim().replace(/[’‘]/g, "'");
  value = value.replace(/\s*(so'?m|uzs|сум|руб\.?|р\.)$/i, '');
  value = value.replace(/[\s']/g, '');
  if (!value) return 0;
  if (value.includes(',') && value.includes('.')) value = value.replace(/,/g, '');
  else value = value.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface CsvRecord { line: number; cells: string[] }

function detectDelimiter(line: string): ';' | ',' {
  let quoted = false;
  let semicolons = 0;
  let commas = 0;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted) {
      if (char === ';') semicolons++;
      else if (char === ',') commas++;
    }
  }
  return semicolons >= commas ? ';' : ',';
}

function splitCsv(input: string, delimiter: ';' | ','): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const push = () => {
    cells.push(field);
    if (cells.some(cell => cell.trim() !== '')) records.push({ line: start, cells });
    cells = [];
    field = '';
    start = line + 1;
  };
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { field += '"'; index++; }
        else quoted = false;
      } else {
        if (char === '\n') line++;
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) { cells.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index++;
      push();
      line++;
    } else field += char;
  }
  push();
  return records;
}

export function photoKey(value: string): string {
  return (value.split(/[\\/]/).pop() ?? '').trim().toLocaleLowerCase();
}

function filenameOf(value: string): string {
  return value.split(/[\\/]/).pop()?.trim() ?? '';
}

export function parseItemCsv(input: string): ItemImportRow[] {
  const source = input.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/).find(line => line.trim() !== '') ?? '';
  const records = splitCsv(source, detectDelimiter(firstLine));
  if (!records.length) return [];
  const header = records[0];
  const columns = new Map<string, number>();
  header.cells.forEach((cell, index) => {
    const canonical = headerByAlias.get(normalizeKey(cell));
    if (canonical && !columns.has(canonical)) columns.set(canonical, index);
  });
  if (!columns.has('name')) {
    return [{
      line: header.line, name: '', unit: 'dona', unitGiven: false, kind: 'material', kindGiven: false,
      category: null, categoryGiven: false, minQty: 0, minQtyGiven: false, cost: 0, costGiven: false,
      salePrice: 0, salePriceGiven: false, openQty: 0, photoFile: '', supplier: '', note: '', warnings: [],
      error: '«Nomi» ustuni topilmadi. Shablonni yuklab oling.',
    }];
  }
  const cell = (record: CsvRecord, canonical: string) => {
    const index = columns.get(canonical);
    return index === undefined ? '' : (record.cells[index] ?? '').trim();
  };
  return records.slice(1).map(record => {
    const errors: string[] = [];
    const given = (canonical: string) => cell(record, canonical) !== '';
    const name = cell(record, 'name');
    if (!name) errors.push('Nomi bo‘sh');
    else if (name.length > 200) errors.push('Nomi 200 belgidan oshadi');
    const unit = normalizeUnitText(cell(record, 'unit'));
    const kindResult = normalizeKindText(cell(record, 'kind'));
    if (kindResult.error) errors.push(kindResult.error);
    const categoryResult = normalizeCategoryText(cell(record, 'category'));
    if (categoryResult.error) errors.push(categoryResult.error);
    const numeric = (canonical: string, label: string): number => {
      const raw = cell(record, canonical);
      const parsed = parseNumberText(raw);
      if (parsed === null) { errors.push(`${label} raqam emas: ${raw}`); return 0; }
      if (parsed > 1e12) { errors.push(`${label} juda katta`); return 0; }
      return parsed;
    };
    const minQty = numeric('minQty', 'Minimal zaxira');
    const cost = numeric('cost', 'Tannarx');
    const salePrice = numeric('salePrice', 'Sotuv narxi');
    const openQty = numeric('openQty', 'Boshlang‘ich qoldiq');
    return {
      line: record.line,
      name,
      unit,
      unitGiven: given('unit'),
      kind: kindResult.kind,
      kindGiven: given('kind'),
      category: categoryResult.code,
      categoryGiven: given('category'),
      minQty,
      minQtyGiven: given('minQty'),
      cost,
      costGiven: given('cost'),
      salePrice,
      salePriceGiven: given('salePrice'),
      openQty,
      photoFile: filenameOf(cell(record, 'photo')),
      supplier: cell(record, 'supplier'),
      note: cell(record, 'note'),
      error: errors.length ? errors.join(' ') : null,
      warnings: [],
    };
  });
}

export function buildItemImportPlan(state: State, rows: ItemImportRow[]): ItemImportPlan {
  const owned = state.items.filter((item): item is Item => item.customerId === null);
  const byName = new Map(owned.map(item => [itemKey(item.name), item]));
  const seen = new Set<string>();
  const planned = rows.map((row): ItemImportPlanRow => {
    const warnings = [...row.warnings];
    let error = row.error;
    const rowKey = itemKey(row.name);
    if (!error) {
      if (seen.has(rowKey)) error = 'Faylda takrorlangan nom';
      else seen.add(rowKey);
    }
    const existing = rowKey ? byName.get(rowKey) ?? null : null;
    if (error) return { ...row, warnings, error, existingId: null, action: 'skip', changes: [] };
    if (existing) {
      const changes: string[] = [];
      if (row.unitGiven && existing.unit !== row.unit) changes.push('birlik');
      if (row.minQtyGiven && Math.abs(existing.minQty - row.minQty) > 1e-9) changes.push('minimal zaxira');
      if (row.salePriceGiven && Math.abs(existing.salePrice - row.salePrice) > 0.005) changes.push('sotuv narxi');
      if (row.categoryGiven && (existing.category ?? null) !== row.category) changes.push('kategoriya');
      if (row.photoFile) changes.push('rasm');
      if (row.kindGiven && existing.kind !== row.kind) warnings.push(`Tur o‘zgarmaydi: ${existing.kind}`);
      if (row.costGiven && Math.abs(existing.cost - row.cost) > 0.005) warnings.push('Tannarx xarid qabulida o‘zgaradi; bu qiymat qo‘llanmaydi');
      if (row.openQty > 0) warnings.push('Mavjud pozitsiya uchun boshlang‘ich qoldiq qo‘shilmaydi — inventarizatsiyadan foydalaning');
      return { ...row, warnings, error: null, existingId: existing.id, action: changes.length ? 'update' : 'skip', changes };
    }
    if (row.openQty > 0 && row.cost <= 0) warnings.push('Tannarx 0 — boshlang‘ich qoldiq qiymatsiz qabul qilinadi');
    return { ...row, warnings, error: null, existingId: null, action: 'create', changes: [] };
  });
  return {
    rows: planned,
    creates: planned.filter(row => !row.error && row.action === 'create').length,
    updates: planned.filter(row => !row.error && row.action === 'update').length,
    skips: planned.filter(row => !row.error && row.action === 'skip').length,
    errors: planned.filter(row => row.error).length,
  };
}

export function itemImportTemplate(): string {
  return '\uFEFFNomi;Birlik;Tur;Kategoriya;Minimal zaxira;Boshlang‘ich qoldiq;Tannarx;Sotuv narxi;Rasm;Yetkazib beruvchi;Izoh\r\n';
}
