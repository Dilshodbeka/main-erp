import { describe, expect, it } from 'vitest';
import { cashCategoryLabel, cashSourceLabel, formatDate, formatDateTime, formatMoney, formatQty, itemKindLabel, messages, orderKindLabel, payrollStatusLabel, statusLabel, taskStatusLabel, translateError, unitLabel, unitText } from './i18n';
import type { CashSource, ItemKind, OperationUnit, Order, PayrollEntry, Status, TaskStatus } from './types';

describe('Uzbek localization', () => {
  it('uses Latin Uzbek and UZS', () => {
    expect(formatMoney(125000)).toContain('125');
    expect(formatMoney(125000)).toContain('so‘m');
    expect(statusLabel('production')).toBe('Ishlab chiqarishda');
    expect(unitLabel('squareMeter')).toBe('m²');
    for (const value of Object.values(messages)) expect(value).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('labels every status, kind, source and unit', () => {
    const statuses: Status[] = ['draft', 'production', 'ready', 'shipped', 'delivered', 'cancelled'];
    const tasks: TaskStatus[] = ['assigned', 'accepted', 'in_progress', 'submitted', 'completed'];
    const orders: Order['kind'][] = ['product', 'service', 'series'];
    const items: ItemKind[] = ['material', 'blank', 'finished'];
    const sources: CashSource[] = ['manual', 'sale', 'supplier', 'payroll', 'expense', 'transfer'];
    const payroll: PayrollEntry['status'][] = ['pending', 'accepted', 'rejected'];
    const units: OperationUnit[] = ['sheet', 'meter', 'squareMeter', 'piece', 'hole', 'minute', 'hour'];
    for (const value of statuses) expect(statusLabel(value)).toBeTruthy();
    for (const value of tasks) expect(taskStatusLabel(value)).toBeTruthy();
    for (const value of orders) expect(orderKindLabel(value)).toBeTruthy();
    for (const value of items) expect(itemKindLabel(value)).toBeTruthy();
    for (const value of sources) expect(cashSourceLabel(value)).toBeTruthy();
    for (const value of payroll) expect(payrollStatusLabel(value)).toBeTruthy();
    for (const value of units) expect(unitLabel(value)).toBeTruthy();
    expect(unitText('шт')).toBe('dona');
    for (const value of [...statuses.map(statusLabel), ...tasks.map(taskStatusLabel), ...orders.map(orderKindLabel), ...items.map(itemKindLabel), ...sources.map(cashSourceLabel), ...payroll.map(payrollStatusLabel), ...units.map(unitLabel)]) {
      expect(value).not.toMatch(/[А-Яа-яЁё]/);
    }
  });

  it('translates salary categories and both historical spellings', () => {
    expect(cashCategoryLabel('payroll')).toBe('Ish haqi');
    expect(cashCategoryLabel('Payroll payment')).toBe('Ish haqi');
    expect(cashCategoryLabel('advance')).toBe('Avans');
    expect(cashCategoryLabel('sale')).toBe('Mijoz to‘lovi');
    expect(cashCategoryLabel('supplier')).toBe('Yetkazib beruvchi');
    expect(cashCategoryLabel('Supplier payment')).toBe('Yetkazib beruvchi');
    expect(cashCategoryLabel('manual')).toBe('Qo‘lda kiritilgan');
    expect(cashCategoryLabel('expense')).toBe('Oylik xarajat');
    expect(cashCategoryLabel('transfer')).toBe('O‘tkazma');
    expect(cashCategoryLabel('Kommunal xizmatlar')).toBe('Kommunal xizmatlar');
  });

  it('translates loan wire categories', () => {
    expect(cashCategoryLabel('loan-draw')).toBe('Zaym olindi');
    expect(cashCategoryLabel('loan-repay')).toBe('Zaym qaytarildi');
  });

  it('labels outsourcing cash category in Uzbek', () => {
    expect(cashCategoryLabel('outsourcing')).toBe('Autsors xizmatiga to‘lov');
  });

  it('explains a session whose auth user was deleted', () => {
    expect(translateError('Authentication user not found')).toContain('Supabase Auth');
    expect(translateError('User from sub claim in JWT does not exist')).toContain('Boshqa hisob bilan kirish');
  });

  it('explains a stage quantity below accepted work', () => {
    expect(translateError('Stage quantity is below accepted work')).toBe(
      'Bosqich miqdorini qabul qilingan ish miqdoridan kamaytirib bo‘lmaydi.');
  });

  it('formats negative money, decimal quantities and dates', () => {
    expect(formatMoney(-125000)).toContain('-');
    expect(formatMoney(-125000)).toContain('125');
    expect(formatQty(125.125)).toBe('125,125');
    expect(formatDate('2026-10-30')).toContain('okt');
    expect(formatDate('')).toBe('—');
  });

  it('formats operation timestamps with date and local time', () => {
    expect(formatDateTime('2026-11-06T14:35:00')).toBe('06.11.2026 · 14:35');
    expect(formatDateTime('2026-11-06T09:05:00.000Z')).toMatch(/^06\.11\.2026 · \d{2}:\d{2}$/);
    expect(formatDateTime('2026-11-06')).toBe('06.11.2026 · 12:00');
    expect(formatDateTime('')).toBe('—');
  });
});

describe('нехватка материала', () => {
  it('различает запуск и выдачу', () => {
    expect(translateError('Insufficient available stock')).toBe('Buyurtmani ishga tushirib bo‘lmaydi: bo‘sh material band qilinganlar hisobiga yetishmaydi. Ro‘yxatni «Ishlab chiqarish» bo‘limida ko‘ring.');
    expect(translateError('Insufficient reserved stock')).toBe('Materiallarni berib bo‘lmaydi: omborda yetarli emas. Kerak va bor miqdor materiallar ro‘yxatida ko‘rsatilgan.');
    expect(translateError('Insufficient stock for issue')).toBe('Materiallarni berib bo‘lmaydi: omborda yetarli emas. Kerak va bor miqdor materiallar ro‘yxatida ko‘rsatilgan.');
    expect(translateError('Insufficient stock')).toBe('Bo‘sh material yetarli emas yoki qoldiq zaxiradan kam.');
  });

  it('сохраняет подстраховку для серверных текстов', () => {
    expect(translateError('Insufficient unreserved material stock')).toBe('Bo‘sh material yetarli emas yoki qoldiq zaxiradan kam.');
    expect(translateError('Stock cannot be negative')).toBe('Bo‘sh material yetarli emas yoki qoldiq zaxiradan kam.');
  });
});

describe('support error translations', () => {
  it('maps every ticket contract error to Uzbek', () => {
    expect(translateError('Ticket text is required')).toBe('Murojaat matnini kiriting.');
    expect(translateError('Ticket text is too long')).toBe('Murojaat matni 2000 belgidan oshmasligi kerak.');
    expect(translateError('Ticket not found')).toBe('Murojaat topilmadi. Sahifani yangilang va qayta urinib ko‘ring.');
    expect(translateError('Ticket is full')).toBe('Bu murojaatga boshqa xabar qo‘shilmaydi: 200 ta xabar chegarasiga yetdi. Yangi murojaat oching.');
    expect(translateError('Invalid ticket context')).toBe('Diagnostika ma’lumoti noto‘g‘ri. Sahifani yangilang va qayta yuboring.');
  });
});
