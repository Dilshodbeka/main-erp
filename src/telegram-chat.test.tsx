import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CompanyProfile } from './company-profile';
import { TelegramChat } from './components/TelegramChat';
import { emptyState } from './domain';
import { formatMoney } from './i18n';
import type { Customer } from './types';

const customer = (kind: Customer['kind']): Customer => ({
  id: 'customer-1', name: 'Aziza Karimova', phone: '+998 90 123 45 67', address: 'Toshkent', kind, employeeId: null,
});

const company: CompanyProfile = { name: 'Aliya Mebel', phone: '+998 90 123 45 67' };

const render = (partner: Customer, debt: number, chatId: string | null = '700100001') =>
  renderToStaticMarkup(createElement(TelegramChat, {
    customer: partner, companyId: 'company-1', chatId, debt, state: emptyState(), company, refreshKey: 0,
    onClose: () => {}, onChanged: () => {}, onNotice: () => {},
  }));

const reminderButton = (html: string): string => {
  const index = html.indexOf('Qarz eslatmasi');
  return index < 0 ? '' : html.slice(html.lastIndexOf('<button', index), index + 'Qarz eslatmasi'.length);
};

describe('TelegramChat debt reminder', () => {
  it('offers the statement for a linked customer who owes money and shows the amount', () => {
    const button = reminderButton(render(customer('customer'), 2_000_000));
    expect(button).toContain('Qarz eslatmasi');
    expect(button).toContain(`Qarz: ${formatMoney(2_000_000)}`);
    expect(button).not.toContain('disabled');
  });

  it('hides the reminder when the customer owes nothing', () => {
    expect(render(customer('customer'), 0)).not.toContain('Qarz eslatmasi');
  });

  it('shows the reminder for every customer kind once money is owed', () => {
    for (const kind of ['customer', 'shop', 'service'] as const) {
      expect(render(customer(kind), 2_000_000)).toContain('Qarz eslatmasi');
    }
  });

  it('hides the reminder while the chat is not linked', () => {
    expect(render(customer('customer'), 2_000_000, null)).not.toContain('Qarz eslatmasi');
  });
});
