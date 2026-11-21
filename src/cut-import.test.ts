import { describe, expect, it } from 'vitest';
import { convertUnits, decodeReport, matchCutRows, matchWorks, sheetArea, matchWords, mergeCut, numberColumns, parseCutTable, parseCutText, parseCutWorks, qtyOf, readCutNames, readSpreadsheet, rememberCutNames, unitKey, unitMismatch } from './cut-import';

// Names as they are on the real stock of the company (21.11.2026).
const items = [
  { id: 'ldsp-black', name: 'LDSP qora 16mm', unit: 'list' },
  { id: 'mdf', name: 'MDF', unit: 'list' },
  { id: 'kashmir', name: 'LDSP Ultradecor Kashimir shagrin 5 kv (15105)', unit: 'list' },
  { id: 'edge-1', name: 'kromka 1mm', unit: 'm' },
  { id: 'ldsp-m2', name: 'LDSP kv', unit: 'm²' },
  { id: 'edge-04', name: 'kromka 0.4', unit: 'm' },
  { id: 'xdf', name: 'XDF', unit: 'list' },
  { id: 'edge-2', name: 'kromka 2mm', unit: 'm' },
  { id: 'xdf-m2', name: 'XDF kv', unit: 'm²' },
  { id: 'ldsp-white', name: 'LDSP oq 16mm shagren', unit: 'list' },
  { id: 'blum', name: 'Petlya Blum CLIP top BLUMOTION 110° nakladnaya 71B3550 (13750)', unit: 'dona' },
  { id: 'tandem45', name: 'HOMAT Tandem SC316S-3D 45sm (11427)', unit: 'dona' },
  { id: 'tandem40', name: 'HOMAT Tandem SC316S-3D 40sm (11426)', unit: 'dona' },
];
const best = (text: string) => matchCutRows(parseCutText(text), items, 'last').map(row => row.itemId);

describe('reading a report', () => {
  it('finds the columns by the header of a BAZIS specification', () => {
    const rows = parseCutTable([
      ['Спецификация материалов', '', '', '', ''],
      ['№', 'Наименование', 'Артикул', 'Ед. изм.', 'Кол-во'],
      ['1', 'ЛДСП 16мм Белый Шагрень', '', 'м2', '12,45'],
      ['2', 'Кромка ПВХ 0.4мм', '', 'м.п.', '86,5'],
      ['3', 'Петля Blum CLIP top 110', '13750', 'шт', '8'],
      ['', 'Итого', '', '', '106,95'],
    ]);
    expect(rows.map(row => [row.name, row.qty, row.unit, row.article ?? ''])).toEqual([
      ['ЛДСП 16мм Белый Шагрень', 12.45, 'м2', ''], ['Кромка ПВХ 0.4мм', 86.5, 'м.п.', ''], ['Петля Blum CLIP top 110', 8, 'шт', '13750']]);
    expect(numberColumns(rows)).toBe(0);
  });

  it('without a header: name and numbers, the user picks the quantity', () => {
    const rows = parseCutText('LDSP qora 16mm;12 лист\nkromka 2mm;140.5 м\nXDF 3 mm 4 шт');
    expect(rows.map(row => [row.name, qtyOf(row, 'last'), row.unit ?? ''])).toEqual([['LDSP qora 16mm', 12, 'лист'], ['kromka 2mm', 140.5, 'м'], ['XDF 3 mm', 4, 'шт']]);
    const [row] = parseCutText('ЛДСП белый\t16\t12,4\t5');
    expect([qtyOf(row, 0), qtyOf(row, 1), qtyOf(row, 'last'), qtyOf(row, 7)]).toEqual([16, 12.4, 5, 0]);
    expect(parseCutText('Отчёт по раскрою\n\nДата: сегодня')).toEqual([]);
  });

  it('reads an Excel file', async () => {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([['Наименование', 'Ед.изм.', 'Количество'], ['ЛДСП 16мм черный', 'лист', 3], ['Кромка 2мм', 'м', 44.5]]);
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Материалы');
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const rows = parseCutTable(await readSpreadsheet(bytes));
    expect(rows.map(row => [row.name, row.qty])).toEqual([['ЛДСП 16мм черный', 3], ['Кромка 2мм', 44.5]]);
    expect(matchCutRows(rows, items, 'last').map(row => row.itemId)).toEqual(['ldsp-black', 'edge-2']);
  });

  it('decodes Windows-1251 text and knows units', () => {
    expect(decodeReport(new Uint8Array([0xcb, 0xc4, 0xd1, 0xcf, 0x3b, 0x35]).buffer)).toBe('ЛДСП;5');
    expect(['м2', 'кв.м', 'm²', 'kv', 'м.п.', 'пог.м', 'лист', 'шт', 'dona'].map(unitKey)).toEqual(['m2', 'm2', 'm2', 'm2', 'm', 'm', 'sheet', 'piece', 'piece']);
  });
});

describe('matching with the real stock', () => {
  it('folds Russian report words into stock words', () => {
    expect(matchWords('ЛДСП 16мм Белый Шагрень')).toEqual(['ldsp', 'n16', 'oq', 'shagren']);
    expect(matchWords('LDSP qora 16mm')).toEqual(['ldsp', 'qora', 'n16']);
    expect(matchWords('Кромка ПВХ 0,4мм')).toEqual(['kromka', 'pvx', 'n0p4']);
    expect(matchWords('kromka 0.4')).toEqual(['kromka', 'n0p4']);
  });

  it('Russian names find Uzbek/Latin items: colour, thickness and edge type decide', () => {
    expect(best('ЛДСП 16мм Белый Шагрень\t12 лист\nЛДСП черный 16 мм\t3 лист\nКромка ПВХ 0.4мм\t86,5\nКромка 2мм\t40\nКромка 1 мм\t12'))
      .toEqual(['ldsp-white', 'ldsp-black', 'edge-04', 'edge-2', 'edge-1']);
  });

  it('the unit picks between the same material in sheets and in m²', () => {
    expect(best('ЛДСП\t12,4 м2\nХДФ\t3,2 м2\nХДФ\t2 лист')).toEqual(['ldsp-m2', 'xdf-m2', 'xdf']);
  });

  it('the article in brackets is an exact match', () => {
    expect(best('Направляющие Tandem 45 см (11427)\t2 шт\nНаправляющие Tandem 40 см 11426\t2 шт\nПетля Blum CLIP top 110\t8 шт'))
      .toEqual(['tandem45', 'tandem40', 'blum']);
  });

  it('does not guess when it is not clear', () => {
    expect(best('ЛДСП 18мм\t3 лист\nФурнитура разная\t2')).toEqual([null, null]);
  });

  it('warns when the report unit differs from the stock unit', () => {
    const [row] = matchCutRows(parseCutText('ЛДСП черный 16мм\t12,4 м2'), items, 'last');
    expect(row.itemId).toBe('ldsp-black');
    expect(unitMismatch(row, items)).toBe(true);
  });

  it('remembers a manual match for the next report', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    rememberCutNames('c1', [{ name: 'ЛДСП 18 мм', qty: 3, itemId: 'ldsp-black', sure: false }], storage);
    expect(matchCutRows(parseCutText('ЛДСП 18 мм\t7'), items, 'last', readCutNames('c1', storage))[0]).toMatchObject({ itemId: 'ldsp-black', qty: 7, sure: true });
    expect(readCutNames('other', storage)).toEqual({});
  });

  it('adds to the position: new rows appended, the same material summed, unmatched skipped', () => {
    const blank = (itemId: string, qty: number) => ({ itemId, qty, issuedQty: 0 });
    expect(mergeCut([{ itemId: 'xdf', qty: 2, issuedQty: 0 }, { itemId: '', qty: 1, issuedQty: 0 }], [
      { name: 'a', qty: 3, itemId: 'xdf', sure: true }, { name: 'b', qty: 80.5, itemId: 'edge-2', sure: true },
      { name: 'c', qty: 4, itemId: null, sure: false }, { name: 'd', qty: 0, itemId: 'mdf', sure: true }], blank))
      .toEqual([{ itemId: 'xdf', qty: 5, issuedQty: 0 }, { itemId: 'edge-2', qty: 80.5, issuedQty: 0 }]);
  });
});

// The structure of a real BAZIS-Mebelshchik «Смета» export (xls), 21.11.2026: several tables one under another.
const head = (title: string) => [['Расчет стоимости материалов и комплектую'], [`Таблица ${title}`], ['Заказ'], ['Изделие', 'Прихожая 1000х400х1900'], ['Артикул изделия'], ['Заказчик'], ['Разработчик'], ['Количество изделий в заказе', '1']];
const MATERIALS = ['Артикул', 'Наименование материала', 'Ед. изм. с модели', 'Расчетное количество', 'Коэф-т', 'Ед. изм.', 'Количество в изделии', 'Количество в заказе', 'Цена', 'Стоимость в изделии', 'Стоимость в заказе', 'Примечание'];
const WORKS = ['Наименование операции', 'Ед. изм.', 'Норма выработки', 'Расценка', 'Объем в изделии', 'Объем в заказе', 'Трудоемкость в изделии', 'Трудоемкость в заказе', 'Стоимость нормо-часа', 'Стоимость в изделии', 'Стоимость в заказе', 'Примечание', 'Группа'];
const smeta: string[][] = [
  ...head('Общая'), MATERIALS,
  ['', 'ДВПО 3.2мм белый', 'кв.м', '1.808736', '1', '', '1.808736', '1.808736', '0', '0', '0', ''],
  ['EK-7x50', 'Евровинт 7х50', 'шт', '56', '1', 'шт', '56', '112', '400', '22400', '22400', ''],
  ['LDSP/16-L/GS', 'ЛДСП 16мм, Серый камень', 'кв.м', '5.074452', '1', 'кв.м.', '5.074452', '5.074452', '90000', '456700.68', '456700.68', ''],
  ['', '', '', '', '', '', '', '', '', '479100.68', '479100.68', ''],
  ...head('Листовые'), MATERIALS, ['LDSP/16-L/GS', 'ЛДСП 16мм, Серый камень', 'кв.м', '5.074452', '1', 'кв.м.', '5.074452', '5.074452', '90000', '456700.68', '456700.68', ''],
  ...head('Фурнитура'), MATERIALS, ['EK-7x50', 'Евровинт 7х50', 'шт', '56', '1', 'шт', '56', '112', '400', '22400', '22400', ''],
  ...head('Общая'), WORKS, ['Lamarty 16мм'], ['Резка под углом на ФРС', 'м', '1', '5000', '5.074452', '5.074452', '5.074452', '5.074452', '5000', '25372.26', '25372.26', '', 'Lamarty 16мм'],
  ['01 Листовой материал'], ['Сверловка', 'шт', '1', '800', '100', '100', '100', '100', '800', '80000', '80000', '', '01 Листовой материал'],
  ['', '', '', '', '', '', '105.074452', '105.074452', '', '105372.26', '105372.26', ''],
  ...head('Сверловка и Фрезеровка'), WORKS, ['Сверловка', 'шт', '1', '800', '100', '100', '100', '100', '800', '80000', '80000', '', '01 Листовой материал'],
  [['Расчет стоимости заказа на 21.11.2026']].flat(), ['Наименование статьи затрат', 'Стоимость в изделии', 'Стоимость в заказе', 'Примечание'], ['Narx', '584472.94', '584472.94', ''],
];

describe('BAZIS «Смета»', () => {
  it('takes materials once, from «Общая», with the quantity for the whole order', () => {
    const rows = parseCutTable(smeta);
    expect(rows.map(row => [row.name, row.qty, unitKey(row.unit)])).toEqual([
      ['ДВПО 3.2мм белый', 1.809, 'm2'], ['Евровинт 7х50', 112, 'piece'], ['ЛДСП 16мм, Серый камень', 5.074, 'm2']]);
    expect(matchCutRows(rows, items, 'last').map(row => row.itemId)).toEqual(['xdf-m2', null, null]);
  });

  it('reads the works once and matches them with the operations', () => {
    const works = parseCutWorks(smeta);
    expect(works).toEqual([{ name: 'Резка под углом на ФРС', unit: 'м', qty: 5.074, rate: 5000 }, { name: 'Сверловка', unit: 'шт', qty: 100, rate: 800 }]);
    const operations = [{ id: 'nest', name: 'Nesting raskroy', unit: 'sheet' }, { id: 'drill', name: 'teshish', unit: 'hole' }, { id: 'edge', name: 'Kromka 1 lik', unit: 'meter' }];
    expect(matchWorks(works, operations).map(row => [row.operationId, row.sure])).toEqual([[null, false], ['drill', true]]);
  });
});

describe('m² ↔ sheets', () => {
  it('knows the sheet area from the name or the material', () => {
    expect(sheetArea('Akril Craftwood F-023 2440×1220×18 (14845)')).toBe(2.977);
    expect(sheetArea('LDSP qora 16mm')).toBe(5.796);
    expect(sheetArea('XDF')).toBe(5.796);
    expect(sheetArea('kromka 2mm')).toBeNull();
  });

  it('a report in m² becomes sheets for a material kept in sheets, rounded up', () => {
    const [row] = matchCutRows(parseCutText('ЛДСП черный 16мм\t12,4 м2'), items, 'last');
    const converted = convertUnits(row, items);
    expect(converted).toMatchObject({ itemId: 'ldsp-black', qty: 2.14, unit: 'list', from: { qty: 12.4, unit: 'м2', area: 5.796 } });
    expect(unitMismatch(converted, items)).toBe(false);
    expect(convertUnits(converted, items)).toBe(converted);
  });

  it('sheets become m² for a material kept in m²; same units and unknown sizes stay', () => {
    expect(convertUnits({ name: 'ЛДСП', qty: 2, unit: 'лист', itemId: 'ldsp-m2', sure: true }, items)).toMatchObject({ qty: 11.592, unit: 'm²' });
    const same = { name: 'ЛДСП', qty: 5, unit: 'м2', itemId: 'ldsp-m2', sure: true };
    expect(convertUnits(same, items)).toBe(same);
    const edge = { name: 'Кромка', qty: 5, unit: 'м2', itemId: 'edge-2', sure: true };
    expect(convertUnits(edge, items)).toBe(edge);
  });
});
