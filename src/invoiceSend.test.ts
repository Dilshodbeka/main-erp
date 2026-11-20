import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Actor, Command } from './types';
import { debtFileName, type DebtDocumentModel } from './debtDocument';
import type { InvoiceModel } from './documents';
import { invoiceFileName, sendDebtFile, sendInvoiceFile, shouldSendInvoiceFile } from './invoiceSend';

const admin = { id: 'a1', name: 'Aliya', role: 'admin' } as Actor;
const worker = { id: 'w1', name: 'Kamol', role: 'worker' } as Actor;
const launch: Command = { type: 'order.launch', orderId: 'o1' };
const issue: Command = { type: 'order.issue', orderId: 'o1' };

describe('shouldSendInvoiceFile', () => {
  it('sends when an admin launch reaches a linked customer with nothing queued', () => {
    expect(shouldSendInvoiceFile({ command: launch, actor: admin, linked: true, pending: 0 })).toBe(true);
  });

  it('stays silent for every other command', () => {
    expect(shouldSendInvoiceFile({ command: issue, actor: admin, linked: true, pending: 0 })).toBe(false);
  });

  it('stays silent without a Telegram chat to carry the document', () => {
    expect(shouldSendInvoiceFile({ command: launch, actor: admin, linked: false, pending: 0 })).toBe(false);
  });

  it('stays silent while writes are queued offline', () => {
    expect(shouldSendInvoiceFile({ command: launch, actor: admin, linked: true, pending: 2 })).toBe(false);
  });

  it('stays silent for a worker: the invoice belongs to the owner', () => {
    expect(shouldSendInvoiceFile({ command: launch, actor: worker, linked: true, pending: 0 })).toBe(false);
  });
});

describe('invoiceFileName', () => {
  it('carries the order number a customer recognises', () => {
    expect(invoiceFileName('ORD-0001')).toBe('Hisob-faktura-ORD-0001.png');
  });

  it('removes spaces and slashes a file name cannot hold', () => {
    expect(invoiceFileName('ORD 12/01')).toBe('Hisob-faktura-ORD-12-01.png');
  });
});

function model(over: Partial<InvoiceModel> = {}): InvoiceModel {
  return {
    number: 'ORD-0001', date: '2026-11-19T09:00:00.000Z',
    customer: 'Aziza Karimova', address: 'Toshkent sh., Chilonzor 12-uy',
    company: { name: 'Mebel Aliya', phone: '+998 90 123 45 67' },
    positions: [{ title: 'Oshxona shkafi', kind: 'product', qty: 5, unitPrice: 50000, total: 250000 }],
    lines: [], subtotal: 250000, markup: 0,
    total: 250000, paid: 100000, debt: 150000, vat: null,
    ...over,
  };
}

function stubBrowserCanvas() {
  const ctx = {
    font: '', fillStyle: '', textBaseline: '', textAlign: '',
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillText: () => {}, fillRect: () => {},
  };
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ctx,
      toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob(['png'], { type: 'image/png' })),
    }),
  });
}

describe('sendInvoiceFile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('delivers a png file with no caption of its own', async () => {
    stubBrowserCanvas();
    const sent: { companyId: string; customerId: string; file: File; caption: string }[] = [];
    const deliver = async (companyId: string, customerId: string, file: File, caption: string) => {
      sent.push({ companyId, customerId, file, caption });
    };
    await sendInvoiceFile({
      companyId: 'co1', customerId: 'c1', model: model(),
      fileName: invoiceFileName('ORD-0001'), deliver,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].companyId).toBe('co1');
    expect(sent[0].customerId).toBe('c1');
    expect(sent[0].file.name).toBe('Hisob-faktura-ORD-0001.png');
    expect(sent[0].file.type).toBe('image/png');
    expect(sent[0].caption).toBe('');
  });

  it('does not reach the network when the image cannot be drawn', async () => {
    const sent: File[] = [];
    const deliver = async (_companyId: string, _customerId: string, file: File) => { sent.push(file); };
    await expect(sendInvoiceFile({
      companyId: 'co1', customerId: 'c1', model: model(),
      fileName: invoiceFileName('ORD-0001'), deliver,
    })).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});

describe('App wiring', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

  it('sends the document once the launch is accepted by the server', () => {
    expect(app).toContain('void sendInvoiceOnLaunch(command, result.state)');
    expect(app).toContain('await sendInvoiceFile({');
    expect(app).toContain('model: invoice(result, launched.id, actor, company)');
    expect(app).toContain('fileName: invoiceFileName(launched.number)');
  });

  it('keeps the whole rule in shouldSendInvoiceFile and no longer writes a text message', () => {
    expect(app).toContain('if (!shouldSendInvoiceFile({');
    expect(app).not.toMatch(/orderAcceptedMessage|chatSendText|serviceNotify/);
  });

  it('does not sign a customer document the firm cannot name', () => {
    expect(app).toMatch(/if \(!company\.name\) return;/);
  });
});

function debtModel(): DebtDocumentModel {
  return {
    customer: 'Aziza Karimova', company: { name: 'Mebel Aliya', phone: '+998 90 123 45 67' },
    date: '2026-11-20',
    rows: [{ label: 'ORD-0001 · Oshxona', createdAt: '2026-10-01T00:00:00Z', total: 30000000, paid: 9200000, outstanding: 20800000 }],
    contract: 30000000, paid: 9200000, debt: 20800000,
  };
}

describe('sendDebtFile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('delivers the debt statement as a png file with no caption of its own', async () => {
    stubBrowserCanvas();
    const sent: { companyId: string; customerId: string; file: File; caption: string }[] = [];
    const deliver = async (companyId: string, customerId: string, file: File, caption: string) => {
      sent.push({ companyId, customerId, file, caption });
    };
    await sendDebtFile({
      companyId: 'co1', customerId: 'c1', model: debtModel(),
      fileName: debtFileName('Aziza Karimova'), deliver,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].file.name).toBe('Qarz-haqida-Karimova.png');
    expect(sent[0].file.type).toBe('image/png');
    expect(sent[0].caption).toBe('');
  });

  it('does not reach the network when the image cannot be drawn', async () => {
    const sent: File[] = [];
    const deliver = async (_companyId: string, _customerId: string, file: File) => { sent.push(file); };
    await expect(sendDebtFile({
      companyId: 'co1', customerId: 'c1', model: debtModel(),
      fileName: debtFileName('Aziza Karimova'), deliver,
    })).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});

describe('debt button wiring', () => {
  const chat = readFileSync(new URL('./components/TelegramChat.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

  it('sends the statement document instead of the text reminder', () => {
    expect(chat).toContain('await sendDebtFile({');
    expect(chat).toContain('debtDocument(state, customer.id, company)');
    expect(chat).toContain('fileName: debtFileName(customer.name)');
    expect(chat).not.toMatch(/serviceNotify|debtReminderMessage/);
  });

  it('asks the owner to confirm a document, not a message', () => {
    expect(chat).toContain('Qarz hujjatini yuborish');
  });

  it('does not sign a debt statement the firm cannot name', () => {
    expect(chat).toMatch(/if \(!company\.name\)/);
  });

  it('shows the button for every linked customer who owes money', () => {
    expect(chat).not.toContain("customer.kind === 'service' && chatId");
  });

  it('gives the chat the balance data the statement is built from', () => {
    expect(app).toMatch(/<TelegramChat customer=\{chatPartner\}[^>]*state=\{state\}[^>]*company=\{company\}/);
  });
});
