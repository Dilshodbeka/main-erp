import { describe, expect, it } from 'vitest';
import { decodeReport, matchCutRows, mergeCut, numberColumns, parseCutText, qtyOf, readCutNames, rememberCutNames } from './cut-import';

const items = [
  { id: 'white', name: 'LDSP oq 16 mm' }, { id: 'grey', name: 'LDSP kulrang 16 mm' }, { id: 'edge', name: 'Kromka PVX 0.4 oq' },
  { id: 'hdf', name: 'XDF 3 mm' }, { id: 'egger', name: 'ЛДСП Egger Дуб Сонома 16' },
];

describe('reading a cutting report', () => {
  it('reads a table copied from Excel and skips the header and the total', () => {
    const rows = parseCutText('№\tМатериал\tРазмер\tКол-во\n1\tЛДСП Egger Дуб Сонома 16\t2800x2070\t5\n2\tКромка ПВХ 0.4 белая\t\t86,5\nИтого\t\t\t91,5');
    expect(rows).toEqual([{ name: 'ЛДСП Egger Дуб Сонома 16', numbers: [1, 5] }, { name: 'Кромка ПВХ 0.4 белая', numbers: [2, 86.5] }]);
    expect(rows.map(row => qtyOf(row, 'last'))).toEqual([5, 86.5]);
    expect(numberColumns(rows)).toBe(2);
  });

  it('reads semicolon CSV, units glued to numbers and plain lines', () => {
    expect(parseCutText('LDSP oq 16 mm;12 лист\nKromka PVX 0.4 oq;140.5 м')).toEqual([
      { name: 'LDSP oq 16 mm', numbers: [12] }, { name: 'Kromka PVX 0.4 oq', numbers: [140.5] }]);
    expect(parseCutText('XDF 3 mm 4 шт')).toEqual([{ name: 'XDF 3 mm', numbers: [4] }]);
    expect(parseCutText('Отчёт по раскрою\n\nДата: сегодня')).toEqual([]);
  });

  it('lets the user say which number is the quantity', () => {
    const [row] = parseCutText('ЛДСП белый\t16\t12,4\t5');
    expect([qtyOf(row, 0), qtyOf(row, 1), qtyOf(row, 'last'), qtyOf(row, 7)]).toEqual([16, 12.4, 5, 0]);
  });

  it('decodes Windows-1251 reports', () => {
    const bytes = new Uint8Array([0xcb, 0xc4, 0xd1, 0xcf, 0x3b, 0x35]).buffer; // "ЛДСП;5"
    expect(decodeReport(bytes)).toBe('ЛДСП;5');
    expect(decodeReport(new TextEncoder().encode('LDSP;5').buffer as ArrayBuffer)).toBe('LDSP;5');
  });
});

describe('matching with stock', () => {
  it('finds the item by shared words across Cyrillic and Latin, and refuses to guess between look-alikes', () => {
    const rows = parseCutText('ЛДСП Egger Дуб Сонома 16\t5\nKromka PVX 0.4 oq\t80\nLDSP 16 mm\t3\nФурнитура Blum\t2');
    const matches = matchCutRows(rows, items, 'last');
    expect(matches.map(row => [row.itemId, row.qty, row.sure])).toEqual([['egger', 5, true], ['edge', 80, true], [null, 3, false], [null, 2, false]]);
  });

  it('remembers a manual match for the next report', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    rememberCutNames('c1', [{ name: 'ЛДСП 16 мм', qty: 3, itemId: 'grey', sure: false }], storage);
    const matches = matchCutRows(parseCutText('ЛДСП 16 мм\t7'), items, 'last', readCutNames('c1', storage));
    expect(matches[0]).toMatchObject({ itemId: 'grey', qty: 7, sure: true });
    expect(readCutNames('other', storage)).toEqual({});
  });

  it('adds to the position: new rows appended, the same material summed, unmatched skipped', () => {
    const blank = (itemId: string, qty: number) => ({ itemId, qty, issuedQty: 0 });
    const merged = mergeCut([{ itemId: 'white', qty: 2, issuedQty: 0 }, { itemId: '', qty: 1, issuedQty: 0 }], [
      { name: 'a', qty: 3, itemId: 'white', sure: true }, { name: 'b', qty: 80.5, itemId: 'edge', sure: true },
      { name: 'c', qty: 4, itemId: null, sure: false }, { name: 'd', qty: 0, itemId: 'hdf', sure: true }], blank);
    expect(merged).toEqual([{ itemId: 'white', qty: 5, issuedQty: 0 }, { itemId: 'edge', qty: 80.5, issuedQty: 0 }]);
  });
});
