import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TelegramChat } from './components/TelegramChat';
import { formatMoney } from './i18n';
import type { Customer } from './types';

const customer = (kind: Customer['kind']): Customer => ({
  id: 'customer-1', name: 'Aziza Karimova', phone: '+998 90 123 45 67', address: 'Toshkent', kind, employeeId: null,
});

const render = (partner: Customer, debt: number, chatId: string | null = '700100001') =>
  renderToStaticMarkup(createElement(TelegramChat, {
    customer: partner, companyId: 'company-1', chatId, debt, refreshKey: 0,
    onClose: () => {}, onChanged: () => {}, onNotice: () => {},
  }));

const reminderButton = (html: string): string => {
  const index = html.indexOf('Qarz eslatmasi');
  return index < 0 ? '' : html.slice(html.lastIndexOf('<button', index), index + 'Qarz eslatmasi'.length);
};

describe('TelegramChat debt reminder', () => {
  it('offers the reminder for a linked service customer and shows the debt in the title', () => {
    const button = reminderButton(render(customer('service'), 2_000_000));
    expect(button).toContain('Qarz eslatmasi');
    expect(button).toContain(`Qarz: ${formatMoney(2_000_000)}`);
    expect(button).not.toContain('disabled');
  });

  it('disables the reminder when the service customer has no debt', () => {
    const button = reminderButton(render(customer('service'), 0));
    expect(button).toContain('Qarz eslatmasi');
    expect(button).toContain('Qarz yo‘q');
    expect(button).toContain('disabled');
  });

  it('hides the reminder from non-service customers', () => {
    expect(render(customer('customer'), 2_000_000)).not.toContain('Qarz eslatmasi');
    expect(render(customer('shop'), 2_000_000)).not.toContain('Qarz eslatmasi');
  });

  it('hides the reminder while the chat is not linked', () => {
    expect(render(customer('service'), 2_000_000, null)).not.toContain('Qarz eslatmasi');
  });
});
