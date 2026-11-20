import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMoney, formatQty } from './i18n';
import { debtPng, invoicePng, layoutDebtDocument, layoutInvoice, type InvoiceLayout } from './invoiceImage';
import type { DebtDocumentModel } from './debtDocument';
import type { InvoiceModel } from './documents';

// A deterministic stand-in for ctx.measureText: every glyph is a fraction of the font size.
const px = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0);
const measure = (text: string, font: string) => text.length * px(font) * 0.52;

const textAt = (layout: InvoiceLayout, value: string) => layout.texts.find(row => row.text === value);
const texts = (layout: InvoiceLayout) => layout.texts.map(row => row.text);

function model(over: Partial<InvoiceModel> = {}): InvoiceModel {
  return {
    number: 'HF-0001', date: '2026-11-19T09:00:00.000Z',
    customer: 'Aziza Karimova', address: 'Toshkent sh., Chilonzor 12-uy',
    company: { name: 'Mebel Aliya', phone: '+998 90 123 45 67' },
    positions: [{ title: 'Oshxona shkafi', kind: 'product', qty: 5, unitPrice: 50000, total: 250000 }],
    lines: [], subtotal: 250000, markup: 0,
    total: 250000, paid: 100000, debt: 150000, vat: null,
    ...over,
  };
}

describe('invoice image layout', () => {
  it('signs the document with the firm name and phone over the buyer', () => {
    const layout = layoutInvoice(model(), measure);
    const firm = textAt(layout, 'Mebel Aliya');
    const buyer = textAt(layout, 'Aziza Karimova');
    expect(firm).toBeDefined();
    expect(buyer).toBeDefined();
    expect(firm!.x).toBeLessThan(buyer!.x);
    expect(Math.abs(firm!.y - buyer!.y)).toBeLessThan(40);
    const phone = textAt(layout, '+998 90 123 45 67');
    expect(phone!.y).toBeGreaterThan(firm!.y);
  });

  it('moves the buyer to the left when no firm name is stored', () => {
    const layout = layoutInvoice(model({ company: { name: '', phone: '+998 90 123 45 67' } }), measure);
    expect(texts(layout)).not.toContain('Mebel Aliya');
    expect(textAt(layout, 'Aziza Karimova')!.x).toBeLessThan(layout.width / 2);
  });

  it('drops the phone line when the owner has not stored one', () => {
    const layout = layoutInvoice(model({ company: { name: 'Mebel Aliya', phone: '' } }), measure);
    expect(texts(layout).some(row => row.includes('+998'))).toBe(false);
  });

  it('writes the date with the year a customer can file by', () => {
    expect(texts(layoutInvoice(model(), measure))).toContain('19.11.2026');
  });

  it('wraps a long position title inside its own column', () => {
    const title = 'Qattiq'.repeat(30);
    const layout = layoutInvoice(model({ positions: [{ title, kind: 'product', qty: 1, unitPrice: 1000, total: 1000 }] }), measure);
    const fragments = layout.texts.filter(row => title.startsWith(row.text) && row.text !== title);
    expect(fragments.length).toBeGreaterThan(1);
    const kindColumn = textAt(layout, 'Turi')!;
    for (const fragment of fragments) {
      expect(fragment.x + measure(fragment.text, fragment.font)).toBeLessThanOrEqual(kindColumn.x);
    }
  });

  it('keeps every text inside the page', () => {
    const layout = layoutInvoice(model({
      customer: 'Abdullayev'.repeat(12),
      address: 'Ko‘chasi'.repeat(20),
      positions: [{ title: 'Shkaf'.repeat(40), kind: 'service', qty: 1234.5, unitPrice: 99999999, total: 999999999 }],
    }), measure);
    for (const row of layout.texts) {
      const width = measure(row.text, row.font);
      if (row.align === 'right') expect(row.x - width).toBeGreaterThanOrEqual(0);
      else expect(row.x + width).toBeLessThanOrEqual(layout.width);
      expect(row.y).toBeLessThanOrEqual(layout.height);
    }
  });

  it('grows the page instead of clipping a long order', () => {
    const short = layoutInvoice(model(), measure);
    const many = layoutInvoice(model({
      positions: Array.from({ length: 60 }, (_, index) => ({ title: `Pozitsiya ${index + 1}`, kind: 'product' as const, qty: 1, unitPrice: 1000, total: 1000 })),
    }), measure);
    expect(many.height).toBeGreaterThan(short.height);
    const last = Math.max(...many.texts.map(row => row.y));
    expect(last).toBeLessThanOrEqual(many.height);
    expect(many.texts.filter(row => row.text === 'Pozitsiya 60').length).toBe(1);
  });

  it('shows what the customer owes and never the internal cost', () => {
    const layout = layoutInvoice(model(), measure);
    const all = texts(layout);
    expect(all).toContain('Jami');
    expect(all).toContain('To‘langan');
    expect(all).toContain('Qarz');
    expect(all).toContain(formatMoney(250000));
    expect(all).toContain(formatMoney(100000));
    expect(all).toContain(formatMoney(150000));
    expect(all).not.toContain('Pozitsiyalar');
    expect(all.join(' ')).not.toMatch(/tannarx|marja/i);
  });

  it('labels the owner surcharge and the discount differently', () => {
    const up = texts(layoutInvoice(model({ markup: 30000, total: 280000, subtotal: 250000 }), measure));
    expect(up).toContain('Natsenka');
    expect(up).toContain('Pozitsiyalar');
    expect(up).not.toContain('Chegirma');
    const down = texts(layoutInvoice(model({ markup: -20000, total: 230000, subtotal: 250000 }), measure));
    expect(down).toContain('Chegirma');
    expect(down).not.toContain('Natsenka');
  });

  it('draws stock sale lines with unit and price when there are no positions', () => {
    const layout = layoutInvoice(model({
      positions: [],
      lines: [{ group: 'material', description: 'Yong‘oq panel', position: null, qty: 3, unit: 'dona', price: 45000, total: 135000 }],
      subtotal: 135000, total: 135000, paid: 0, debt: 135000,
    }), measure);
    const all = texts(layout);
    expect(all).toContain('Yong‘oq panel');
    expect(all).toContain(formatQty(3));
    expect(all).toContain(formatMoney(45000));
    expect(all).toContain(formatMoney(135000));
    expect(all).not.toContain('Buyurtma pozitsiyalari');
  });

  it('names the position kind and hides VAT while the setting is off', () => {
    const layout = layoutInvoice(model({
      positions: [
        { title: 'Oshxona shkafi', kind: 'product', qty: 5, unitPrice: 50000, total: 250000 },
        { title: '45 gradus kesish', kind: 'service', qty: 1, unitPrice: 50000, total: 50000 },
      ],
    }), measure);
    const all = texts(layout);
    expect(all).toContain('Mahsulot');
    expect(all).toContain('Xizmat');
    expect(all).not.toContain('QQS');
    const withVat = texts(layoutInvoice(model({ vat: 45000 }), measure));
    expect(withVat).toContain('QQS');
    expect(withVat).toContain(formatMoney(45000));
  });
});

type FakeCtx = {
  font: string;
  fillStyle: string;
  textBaseline: string;
  textAlign: string;
  measureText: (text: string) => { width: number };
  fillText: (text: string, x: number, y: number) => void;
  fillRect: (x: number, y: number, width: number, height: number) => void;
};

function stubCanvas() {
  const painted: string[] = [];
  const filled: number[] = [];
  const ctx: FakeCtx = {
    font: '', fillStyle: '', textBaseline: '', textAlign: '',
    measureText: text => ({ width: measure(text, ctx.font) }),
    fillText: text => { painted.push(text); },
    fillRect: () => { filled.push(1); },
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx,
    toBlob: (callback: (blob: unknown) => void) => callback(new Blob(['png'], { type: 'image/png' })),
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  return { canvas, painted, filled };
}

describe('invoice png painter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('paints every layout text onto a canvas sized to the layout', async () => {
    const { canvas, painted, filled } = stubCanvas();
    const expected = layoutInvoice(model(), measure);
    const blob = await invoicePng(model());
    expect(blob).toBeInstanceOf(Blob);
    expect(canvas.width).toBe(expected.width);
    expect(canvas.height).toBe(expected.height);
    expect(painted).toEqual(expected.texts.map(row => row.text));
    expect(filled.length).toBe(expected.rects.length + 1);
  });

  it('refuses to invent an image when the browser returns nothing', async () => {
    const ctx: FakeCtx = {
      font: '', fillStyle: '', textBaseline: '', textAlign: '',
      measureText: text => ({ width: text.length }),
      fillText: () => {}, fillRect: () => {},
    };
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx, toBlob: (callback: (blob: unknown) => void) => callback(null) }),
    });
    await expect(invoicePng(model())).rejects.toThrow('PNG tayyorlanmadi');
  });
});

function debtModel(over: Partial<DebtDocumentModel> = {}): DebtDocumentModel {
  return {
    customer: 'Aziza Karimova', company: { name: 'Mebel Aliya', phone: '+998 90 123 45 67' },
    date: '2026-11-20',
    rows: [{ label: 'ORD-0001 · Oshxona', createdAt: '2026-10-01T00:00:00Z', total: 30000000, paid: 9200000, outstanding: 20800000 }],
    contract: 30000000, paid: 9200000, debt: 20800000,
    ...over,
  };
}

describe('debt statement layout', () => {
  it('titles the statement and signs it with the firm over the customer', () => {
    const layout = layoutDebtDocument(debtModel(), measure);
    const all = texts(layout);
    expect(all).toContain('QARZ HAQIDA');
    expect(all).toContain('Mebel Aliya');
    expect(all).toContain('+998 90 123 45 67');
    expect(all).toContain('20.11.2026');
    const seller = textAt(layout, 'SOTUVCHI')!;
    const customer = textAt(layout, 'Aziza Karimova')!;
    expect(textAt(layout, 'MIJOZ')!.x).toBeGreaterThan(seller.x);
    expect(customer.x).toBeGreaterThan(seller.x);
    expect(layout.texts.some(row => row.text === 'Mebel Aliya' && row.x === seller.x)).toBe(true);
  });

  it('prints one row per obligation with its own figures', () => {
    const all = texts(layoutDebtDocument(debtModel(), measure));
    expect(all).toContain('ORD-0001 · Oshxona');
    expect(all).toContain('01.10.2026');
    expect(all).toContain(formatMoney(30000000));
    expect(all).toContain(formatMoney(9200000));
    expect(all).toContain(formatMoney(20800000));
    expect(all).toEqual(expect.arrayContaining(['Buyurtma', 'Sana', 'Summa', 'To‘langan', 'Qolgan']));
  });

  it('sums the rows into the total the customer owes', () => {
    const all = texts(layoutDebtDocument(debtModel({
      rows: [
        { label: 'ORD-0001 · Oshxona', createdAt: '2026-10-01T00:00:00Z', total: 30000000, paid: 9200000, outstanding: 20800000 },
        { label: 'ORD-0002 · Shkaf', createdAt: '2026-10-05T00:00:00Z', total: 20000000, paid: 0, outstanding: 20000000 },
      ],
      contract: 50000000, paid: 9200000, debt: 40800000,
    }), measure));
    expect(all).toContain('Jami qarz');
    expect(all).toContain(formatMoney(40800000));
  });

  it('keeps every text inside the page when a label is long', () => {
    const layout = layoutDebtDocument(debtModel({
      rows: [{ label: 'ORD-0001 · ' + 'Oshxona'.repeat(20), createdAt: '2026-10-01T00:00:00Z', total: 30000000, paid: 0, outstanding: 30000000 }],
      paid: 0, debt: 30000000,
    }), measure);
    for (const row of layout.texts) {
      const width = measure(row.text, row.font);
      if (row.align === 'right') expect(row.x - width).toBeGreaterThanOrEqual(0);
      else expect(row.x + width).toBeLessThanOrEqual(layout.width);
      expect(row.y).toBeLessThanOrEqual(layout.height);
    }
  });
});

describe('debt png painter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('paints the statement onto a canvas sized to its layout', async () => {
    const { canvas, painted } = stubCanvas();
    const expected = layoutDebtDocument(debtModel(), measure);
    const blob = await debtPng(debtModel());
    expect(blob).toBeInstanceOf(Blob);
    expect(canvas.width).toBe(expected.width);
    expect(canvas.height).toBe(expected.height);
    expect(painted).toEqual(expected.texts.map(row => row.text));
  });
});
