import { formatMoney } from './i18n';
import type { Customer, Order } from './types';

type OrderSummary = Pick<Order, 'number' | 'title' | 'price'>;

export function orderAcceptedMessage(customer: Pick<Customer, 'name'>, order: OrderSummary, debt: number): string {
  const lines = [
    `Assalomu alaykum, ${customer.name}!`,
    'Buyurtmangiz qabul qilindi.',
    `Buyurtma: ${order.number} · ${order.title}`,
    `Buyurtma summasi: ${formatMoney(order.price)}`,
  ];
  if (debt > 0) {
    lines.push(`Qarzingiz: ${formatMoney(debt)}`, `Jami to‘lov: ${formatMoney(order.price + debt)}`);
  } else {
    lines.push(`To‘lov summasi: ${formatMoney(order.price)}`);
  }
  return lines.join('\n');
}

export function debtReminderMessage(customer: Pick<Customer, 'name'>, debt: number): string {
  return [
    `Assalomu alaykum, ${customer.name}!`,
    `Sizning qarzingiz: ${formatMoney(debt)}.`,
    'Iltimos, to‘lovni amalga oshiring.',
  ].join('\n');
}
