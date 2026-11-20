import { formatMoney, formatQty } from './i18n';
import type { DebtDocumentModel } from './debtDocument';
import type { InvoiceModel } from './documents';

export type Measure = (text: string, font: string) => number;

export interface DrawText { text: string; x: number; y: number; font: string; align: 'left' | 'right'; color: string }
export interface DrawRect { x: number; y: number; width: number; height: number; color: string }
export interface InvoiceLayout { width: number; height: number; rects: DrawRect[]; texts: DrawText[] }

interface Sink { rects: DrawRect[]; texts: DrawText[] }

const FONT = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const face = (weight: number, size: number) => `${weight} ${size}px ${FONT}`;

const WIDTH = 1240;
const MIN_HEIGHT = 1754;
const PAD = 64;
const CONTENT = WIDTH - PAD * 2;
const GAP = 16;
const LINE = 30;
const CELL_PAD = 11;

const INK = '#1d2b1a';
const MUTED = '#6c7a63';
const BRAND = '#2f6b3c';
const RULE = '#dce5d2';
const HEAD = '#eef3e6';
const ZEBRA = '#f8faf5';
const DEBT = '#a8402f';

const TITLE = face(800, 46);
const NUMBER = face(800, 30);
const CAPTION = face(700, 18);
const NAME = face(800, 26);
const BODY = face(600, 22);
const SMALL = face(600, 20);
const TOTAL_LABEL = face(700, 24);
const TOTAL_VALUE = face(800, 26);
const DEBT_LABEL = face(800, 30);
const DEBT_VALUE = face(800, 36);
const TOTALS_X = PAD + Math.round(CONTENT * 0.45);
const TOTALS_HEIGHT = 46;
const RIGHT = WIDTH - PAD;

interface Column { label: string; width: number; align: 'left' | 'right' }

const POSITION_COLUMNS: Column[] = [
  { label: '№', width: 56, align: 'left' },
  { label: 'Pozitsiya', width: CONTENT - 706, align: 'left' },
  { label: 'Turi', width: 140, align: 'left' },
  { label: 'Miqdor', width: 110, align: 'right' },
  { label: 'Bitta dona narxi', width: 210, align: 'right' },
  { label: 'Summa', width: 190, align: 'right' },
];

const LINE_COLUMNS: Column[] = [
  { label: '№', width: 56, align: 'left' },
  { label: 'Nomi', width: CONTENT - 666, align: 'left' },
  { label: 'Miqdor', width: 110, align: 'right' },
  { label: 'Birlik', width: 110, align: 'left' },
  { label: 'Narx', width: 200, align: 'right' },
  { label: 'Summa', width: 190, align: 'right' },
];

const DEBT_COLUMNS: Column[] = [
  { label: 'Buyurtma', width: CONTENT - 855, align: 'left' },
  { label: 'Sana', width: 150, align: 'left' },
  { label: 'Summa', width: 235, align: 'right' },
  { label: 'To‘langan', width: 235, align: 'right' },
  { label: 'Qolgan', width: 235, align: 'right' },
];

const positionRows = (positions: InvoiceModel['positions']): string[][] => positions.map((row, index) => [
  String(index + 1), row.title, row.kind === 'service' ? 'Xizmat' : 'Mahsulot',
  formatQty(row.qty), formatMoney(row.unitPrice), formatMoney(row.total),
]);

const lineRows = (lines: InvoiceModel['lines']): string[][] => lines.map((row, index) => [
  String(index + 1), row.description, formatQty(row.qty), row.unit, formatMoney(row.price), formatMoney(row.total),
]);

function documentDate(value: string): string {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${String(parsed.getDate()).padStart(2, '0')}.${String(parsed.getMonth() + 1).padStart(2, '0')}.${parsed.getFullYear()}`;
}

const put = (sink: Sink, text: string, x: number, y: number, font: string, color: string, align: 'left' | 'right' = 'left') => {
  sink.texts.push({ text, x, y, font, align, color });
};

// A figure that would not fit its column is set smaller instead of being pushed over the neighbour.
function numberFont(text: string, maxWidth: number, measure: Measure): string {
  for (const size of [22, 20, 18, 16]) if (measure(text, face(600, size)) <= maxWidth) return face(600, size);
  return face(600, 16);
}

// A word longer than the cell has to be cut, otherwise it runs over the next column.
function breakWord(word: string, font: string, maxWidth: number, measure: Measure): string[] {
  const out: string[] = [];
  let rest = word;
  while (rest.length > 1 && measure(rest, font) > maxWidth) {
    let cut = 1;
    for (let index = 2; index < rest.length && measure(rest.slice(0, index), font) <= maxWidth; index += 1) cut = index;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  out.push(rest);
  return out;
}

function wrap(text: string, font: string, maxWidth: number, measure: Measure): string[] {
  const out: string[] = [];
  let line = '';
  const flush = () => { if (line) { out.push(line); line = ''; } };
  // Only breakable whitespace may start a new line: uz-UZ money uses U+00A0 inside
  // a figure ("45 000 so'm"), and splitting there would rewrite the amount.
  for (const word of text.split(/[ \t\r\n]+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, font) <= maxWidth) { line = next; continue; }
    flush();
    if (measure(word, font) > maxWidth) {
      const parts = breakWord(word, font, maxWidth, measure);
      out.push(...parts.slice(0, -1));
      line = parts[parts.length - 1];
      continue;
    }
    line = word;
  }
  flush();
  return out.length ? out : [''];
}

function drawTable(sink: Sink, columns: Column[], rows: string[][], from: number, measure: Measure): number {
  const offsets = columns.map((_, index) => PAD + columns.slice(0, index).reduce((sum, column) => sum + column.width, 0));
  const drawRow = (values: string[], font: string, color: string, line: number, band: string | null, cursor: number): number => {
    const cells = columns.map((column, index) => {
      const value = values[index] ?? '';
      const cellFont = column.align === 'right' ? numberFont(value, column.width - GAP, measure) : font;
      return { font: cellFont, lines: wrap(value, cellFont, column.width - GAP, measure) };
    });
    const height = Math.max(...cells.map(cell => cell.lines.length)) * line + CELL_PAD * 2;
    if (band) sink.rects.push({ x: PAD, y: cursor, width: CONTENT, height, color: band });
    cells.forEach((cell, index) => {
      const column = columns[index];
      let baseline = cursor + CELL_PAD + Math.round(line * 0.78);
      for (const value of cell.lines) {
        put(sink, value, column.align === 'right' ? offsets[index] + column.width : offsets[index], baseline, cell.font, color, column.align);
        baseline += line;
      }
    });
    return cursor + height;
  };
  let cursor = drawRow(columns.map(column => column.label), CAPTION, MUTED, 24, HEAD, from);
  sink.rects.push({ x: PAD, y: cursor, width: CONTENT, height: 2, color: RULE });
  cursor += 2;
  rows.forEach((values, index) => { cursor = drawRow(values, BODY, INK, LINE, index % 2 ? ZEBRA : null, cursor); });
  return cursor;
}

function drawTotals(sink: Sink, rows: { label: string; value: string }[], cursor: number): number {
  for (const row of rows) {
    put(sink, row.label, TOTALS_X, cursor + TOTALS_HEIGHT * 0.7, TOTAL_LABEL, INK);
    put(sink, row.value, RIGHT, cursor + TOTALS_HEIGHT * 0.7, TOTAL_VALUE, INK, 'right');
    cursor += TOTALS_HEIGHT;
  }
  return cursor;
}

interface Party { caption: string; name: string; details: string[]; x: number }

function drawParties(sink: Sink, parties: Party[], y: number, measure: Measure): number {
  const partyWidth = CONTENT / 2;
  for (const party of parties) {
    let baseline = y;
    put(sink, party.caption.toUpperCase(), party.x, baseline, CAPTION, MUTED);
    baseline += 34;
    for (const line of wrap(party.name, NAME, partyWidth - GAP, measure)) {
      put(sink, line, party.x, baseline, NAME, INK);
      baseline += 34;
    }
    for (const detail of party.details) {
      for (const line of wrap(detail, SMALL, partyWidth - GAP, measure)) {
        put(sink, line, party.x, baseline, SMALL, MUTED);
        baseline += 28;
      }
    }
  }
  return Math.max(y + 120, y + 34);
}

export function layoutInvoice(model: InvoiceModel, measure: Measure): InvoiceLayout {
  const sink: Sink = { rects: [], texts: [] };
  let y = PAD + 34;
  put(sink, 'HISOB-FAKTURA', PAD, y, TITLE, INK);
  put(sink, model.number, RIGHT, y - 14, NUMBER, BRAND, 'right');
  put(sink, documentDate(model.date), RIGHT, y + 18, SMALL, MUTED, 'right');
  y += 52;
  sink.rects.push({ x: PAD, y, width: CONTENT, height: 2, color: RULE });
  y += 48;

  const partyWidth = CONTENT / 2;
  y = drawParties(sink, model.company.name
    ? [{ caption: 'Sotuvchi', name: model.company.name, details: [model.company.phone].filter(Boolean), x: PAD },
      { caption: 'Xaridor', name: model.customer, details: [model.address || 'Manzil ko‘rsatilmagan'], x: PAD + partyWidth }]
    : [{ caption: 'Xaridor', name: model.customer, details: [model.address || 'Manzil ko‘rsatilmagan'], x: PAD }], y, measure);
  sink.rects.push({ x: PAD, y, width: CONTENT, height: 2, color: RULE });
  y += 46;

  if (model.positions.length) {
    put(sink, 'Buyurtma pozitsiyalari', PAD, y, BODY, BRAND);
    y = drawTable(sink, POSITION_COLUMNS, positionRows(model.positions), y + 18, measure);
    y += 40;
  }
  if (model.lines.length) {
    put(sink, 'Tovarlar', PAD, y, BODY, BRAND);
    y = drawTable(sink, LINE_COLUMNS, lineRows(model.lines), y + 18, measure);
    y += 40;
  }

  const totals: { label: string; value: string }[] = [];
  if (Math.abs(model.markup) >= 0.005) totals.push({ label: 'Pozitsiyalar', value: formatMoney(model.subtotal) });
  if (model.markup > 0) totals.push({ label: 'Natsenka', value: formatMoney(model.markup) });
  if (model.markup < 0) totals.push({ label: 'Chegirma', value: formatMoney(Math.abs(model.markup)) });
  totals.push({ label: 'Jami', value: formatMoney(model.total) });
  totals.push({ label: 'To‘langan', value: formatMoney(model.paid) });
  if (model.vat !== null) totals.push({ label: 'QQS', value: formatMoney(model.vat) });
  y = drawTotals(sink, totals, y);

  const debtTop = y + 14;
  sink.rects.push({ x: TOTALS_X - 24, y: debtTop, width: RIGHT - (TOTALS_X - 24), height: 108, color: HEAD });
  put(sink, 'Qarz', TOTALS_X, debtTop + 44, DEBT_LABEL, DEBT);
  put(sink, formatMoney(model.debt), RIGHT, debtTop + 86, DEBT_VALUE, DEBT, 'right');
  y = debtTop + 108;

  return { width: WIDTH, height: Math.max(MIN_HEIGHT, y + PAD), ...sink };
}

export function layoutDebtDocument(model: DebtDocumentModel, measure: Measure): InvoiceLayout {
  const sink: Sink = { rects: [], texts: [] };
  let y = PAD + 34;
  put(sink, 'QARZ HAQIDA', PAD, y, TITLE, INK);
  if (model.company.name) put(sink, model.company.name, RIGHT, y - 14, NUMBER, BRAND, 'right');
  put(sink, documentDate(model.date), RIGHT, y + 18, SMALL, MUTED, 'right');
  y += 52;
  sink.rects.push({ x: PAD, y, width: CONTENT, height: 2, color: RULE });
  y += 48;

  const partyWidth = CONTENT / 2;
  y = drawParties(sink, model.company.name
    ? [{ caption: 'Sotuvchi', name: model.company.name, details: [model.company.phone].filter(Boolean), x: PAD },
      { caption: 'Mijoz', name: model.customer, details: [], x: PAD + partyWidth }]
    : [{ caption: 'Mijoz', name: model.customer, details: [], x: PAD }], y, measure);
  sink.rects.push({ x: PAD, y, width: CONTENT, height: 2, color: RULE });
  y += 46;

  put(sink, 'Majburiyatlar', PAD, y, BODY, BRAND);
  const rows = model.rows.map(row => [
    row.label, documentDate(row.createdAt), formatMoney(row.total), formatMoney(row.paid), formatMoney(row.outstanding),
  ]);
  y = drawTable(sink, DEBT_COLUMNS, rows, y + 18, measure);
  y += 40;

  y = drawTotals(sink, [
    { label: 'Jami summa', value: formatMoney(model.contract) },
    { label: 'To‘langan', value: formatMoney(model.paid) },
  ], y);

  const debtTop = y + 14;
  sink.rects.push({ x: TOTALS_X - 24, y: debtTop, width: RIGHT - (TOTALS_X - 24), height: 108, color: HEAD });
  put(sink, 'Jami qarz', TOTALS_X, debtTop + 44, DEBT_LABEL, DEBT);
  put(sink, formatMoney(model.debt), RIGHT, debtTop + 86, DEBT_VALUE, DEBT, 'right');
  y = debtTop + 108;

  return { width: WIDTH, height: Math.max(MIN_HEIGHT, y + PAD), ...sink };
}

function createSurface(build: (measure: Measure) => InvoiceLayout): Promise<Blob> {
  if (typeof document === 'undefined') return Promise.reject(new Error('Rasm brauzerda tayyorlanadi'));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Rasm brauzerda tayyorlanadi'));
  const layout = build((text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  });
  canvas.width = layout.width;
  canvas.height = layout.height;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const rect of layout.rects) {
    ctx.fillStyle = rect.color;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.textBaseline = 'alphabetic';
  for (const item of layout.texts) {
    ctx.font = item.font;
    ctx.fillStyle = item.color;
    ctx.textAlign = item.align;
    ctx.fillText(item.text, item.x, item.y);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('PNG tayyorlanmadi'))), 'image/png');
  });
}

export function invoicePng(model: InvoiceModel): Promise<Blob> {
  return createSurface(measure => layoutInvoice(model, measure));
}

export function debtPng(model: DebtDocumentModel): Promise<Blob> {
  return createSurface(measure => layoutDebtDocument(model, measure));
}
