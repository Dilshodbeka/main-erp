import { describe, expect, it } from 'vitest';
import { formatMoney } from './i18n';
import { debtReminderMessage, orderAcceptedMessage } from './serviceNotify';

const customer = { name: 'Aziza Karimova' };
const order = { number: 'ORD-0007', title: 'Oshxona fasadini kesish', price: 5_000_000 };

describe('orderAcceptedMessage', () => {
  it('shows the order number, title, sum and the total with the old debt', () => {
    const text = orderAcceptedMessage(customer, order, 2_000_000);
    expect(text).toContain('Assalomu alaykum, Aziza Karimova!');
    expect(text).toContain('Buyurtmangiz qabul qilindi.');
    expect(text).toContain('ORD-0007');
    expect(text).toContain('Oshxona fasadini kesish');
    expect(text).toContain(`Buyurtma summasi: ${formatMoney(5_000_000)}`);
    expect(text).toContain(`Qarzingiz: ${formatMoney(2_000_000)}`);
    expect(text).toContain(`Jami to‘lov: ${formatMoney(7_000_000)}`);
  });

  it('asks for the order sum only when there is no old debt', () => {
    const text = orderAcceptedMessage(customer, order, 0);
    expect(text).toContain(`To‘lov summasi: ${formatMoney(5_000_000)}`);
    expect(text).not.toContain('Qarzingiz');
    expect(text).not.toContain('Jami to‘lov');
  });
});

describe('debtReminderMessage', () => {
  it('sends the current debt with a payment request', () => {
    const text = debtReminderMessage(customer, 2_000_000);
    expect(text).toContain('Assalomu alaykum, Aziza Karimova!');
    expect(text).toContain(`Sizning qarzingiz: ${formatMoney(2_000_000)}.`);
    expect(text).toContain('Iltimos, to‘lovni amalga oshiring.');
  });
});
