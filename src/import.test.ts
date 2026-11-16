import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { buildItemImportPlan, itemImportTemplate, parseItemCsv, parseNumberText } from './import';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: emptyState().companyId };

function run(state: State, command: Command): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);
}

describe('item import', () => {
  it('reads an Excel-style CSV with BOM, semicolons and quoted cells', () => {
    const csv = '\uFEFFNomi;Birlik;Turi;Kategoriya;Minimal zaxira;Boshlang‘ich qoldiq;Tannarx;Sotuv narxi;Rasm\r\n' +
      '"LDSP, oq";list;Material;01.01;5;20;180000,50;0;ldsp oq.jpg\r\n' +
      '"Kromka; PVX";m;material;2.1;0;100;1 250;0;\r\n';
    const rows = parseItemCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'LDSP, oq', unit: 'list', kind: 'material', category: '01.01', minQty: 5,
      openQty: 20, cost: 180000.5, salePrice: 0, photoFile: 'ldsp oq.jpg', error: null,
    });
    expect(rows[1]).toMatchObject({ name: 'Kromka; PVX', unit: 'm', category: '02.01', cost: 1250, error: null });
  });

  it('accepts comma-separated headers in Russian and English', () => {
    const csv = 'name,unit,kind,category,min qty,qty,cost,sale price,photo\n' +
      'MDF,m2,finished,1.2,3,10,"2 000,25",450000,mdf.jpg\n';
    const rows = parseItemCsv(csv);
    expect(rows[0]).toMatchObject({
      name: 'MDF', unit: 'm²', kind: 'finished', category: '01.02', minQty: 3,
      openQty: 10, cost: 2000.25, salePrice: 450000, photoFile: 'mdf.jpg', error: null,
    });
  });

  it('reports broken numbers and unknown categories per row', () => {
    const csv = 'nomi;birlik;kategoriya;tannarx\nOddiy;dona;01.01;abc\nBoshqa;dona;99.99;10\n';
    const rows = parseItemCsv(csv);
    expect(rows[0].error).toContain('raqam emas');
    expect(rows[1].error).toContain('Noma’lum kategoriya');
  });

  it('classifies rows as create, update and unchanged', () => {
    let state = emptyState();
    state = run(state, { type: 'item.create', name: 'LDSP oq', unit: 'list', minQty: 5, cost: 100, customerId: null, category: '01.01' });
    state = run(state, { type: 'item.create', name: 'MDF', unit: 'list', minQty: 0, cost: 200, customerId: null });
    const csv = 'nomi;birlik;kategoriya;minimal zaxira;qoldiq;tannarx;sotuv narxi\n' +
      'LDSP oq;list;01.01;5;0;0;0\n' +
      'MDF;list;;0;4;0;90000\n' +
      'Kromka;m;02.01;2;30;500;0\n';
    const plan = buildItemImportPlan(state, parseItemCsv(csv));
    expect(plan).toMatchObject({ creates: 1, updates: 1, skips: 1, errors: 0 });
    expect(plan.rows[0].action).toBe('skip');
    expect(plan.rows[1].action).toBe('update');
    expect(plan.rows[1].changes).toEqual(['sotuv narxi']);
    expect(plan.rows[1].warnings.some(text => text.includes('boshlang‘ich qoldiq'))).toBe(true);
    expect(plan.rows[2]).toMatchObject({ action: 'create', openQty: 30, cost: 500, existingId: null });
  });

  it('rejects duplicate names inside one file', () => {
    const plan = buildItemImportPlan(emptyState(), parseItemCsv('nomi;birlik\nLDSP;list\nldsp;list\n'));
    expect(plan.errors).toBe(1);
    expect(plan.rows[1].error).toBe('Faylda takrorlangan nom');
  });

  it('parses local number formats', () => {
    expect(parseNumberText('1 250,50')).toBe(1250.5);
    expect(parseNumberText("1'250.75")).toBe(1250.75);
    expect(parseNumberText('180 000 so‘m')).toBe(180000);
    expect(parseNumberText('')).toBe(0);
    expect(parseNumberText('-5')).toBeNull();
    expect(parseNumberText('12a')).toBeNull();
  });

  it('provides a spreadsheet template with the import columns', () => {
    const template = itemImportTemplate();
    expect(template.startsWith('\uFEFFNomi;Birlik;Tur;Kategoriya;')).toBe(true);
    expect(template).toContain('Rasm;Yetkazib beruvchi;Izoh');
    expect(template.endsWith('\r\n')).toBe(true);
  });
});
