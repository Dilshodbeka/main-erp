import { chatSendFile } from './chat';
import type { DebtDocumentModel } from './debtDocument';
import type { InvoiceModel } from './documents';
import { debtPng, invoicePng } from './invoiceImage';
import type { Actor, Command } from './types';

type Deliver = (companyId: string, customerId: string, file: File, caption: string) => Promise<unknown>;

export function invoiceFileName(orderNumber: string): string {
  return `Hisob-faktura-${orderNumber.trim().replace(/[^A-Za-z0-9_-]+/g, '-')}.png`;
}

// A document may only leave for a launch the server already accepted: an offline queue would
// let the invoice arrive before the numbers behind it, and only the owner may sign one.
export function shouldSendInvoiceFile({ command, actor, linked, pending }: {
  command: Command;
  actor: Actor;
  linked: boolean;
  pending: number;
}): boolean {
  return command.type === 'order.launch' && actor.role === 'admin' && linked && pending === 0;
}

export async function sendInvoiceFile({ companyId, customerId, model, fileName, deliver = chatSendFile }: {
  companyId: string;
  customerId: string;
  model: InvoiceModel;
  fileName: string;
  deliver?: Deliver;
}): Promise<void> {
  const blob = await invoicePng(model);
  await deliver(companyId, customerId, new File([blob], fileName, { type: 'image/png' }), '');
}

export async function sendDebtFile({ companyId, customerId, model, fileName, deliver = chatSendFile }: {
  companyId: string;
  customerId: string;
  model: DebtDocumentModel;
  fileName: string;
  deliver?: Deliver;
}): Promise<void> {
  const blob = await debtPng(model);
  await deliver(companyId, customerId, new File([blob], fileName, { type: 'image/png' }), '');
}
