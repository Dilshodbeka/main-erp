import { useState, type FormEvent } from 'react';
import { Banknote, ChevronDown } from 'lucide-react';
import { date, money } from '../ui';
import type { Account, Command, Customer } from '../types';
import type { CustomerBalance } from '../receivables';

const dash = (value: number): string => value > 0 ? money(value) : '—';

export function CustomerLedger({ customer, ledger, busy, run }: { customer: Customer; ledger: CustomerBalance; busy: boolean; run: (command: Command) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const account = (form.get('account') || 'cash') as Account;
    if (await run({ type: 'customer.pay', customerId: customer.id, amount: Number(form.get('amount') || 0), account })) setOpen(false);
  };
  return <article className="ledger-card">
    <div className="ledger-head">
      <div><h3>{customer.name}</h3><small>{customer.address || 'Manzil ko‘rsatilmagan'} · {customer.phone || 'Telefon ko‘rsatilmagan'}</small></div>
      <span className={`badge ${ledger.debt > 0 ? 'debt' : ledger.advance > 0 ? 'ready' : 'delivered'}`}><i />{ledger.debt > 0 ? 'Qarz bor' : ledger.advance > 0 ? 'Avans' : 'Hisob-kitob qilingan'}</span>
    </div>
    <div className="ledger-figures">
      <div><small>Shartnoma</small><b>{dash(ledger.contract)}</b></div>
      <div><small>To‘langan</small><b>{dash(ledger.paid)}</b></div>
      <div><small>Qarz</small><b className={ledger.debt > 0 ? 'debt' : undefined}>{dash(ledger.debt)}</b></div>
      <div><small>Avans</small><b>{dash(ledger.advance)}</b></div>
    </div>
    {ledger.obligations.length > 0 ? <div className="ledger-rows">{ledger.obligations.map(row => <div className="ledger-row" key={row.id}>
      <span>{date(row.createdAt)}<small>{row.label}</small></span>
      <span>{money(row.total)}</span>
      <span>to‘langan {money(row.paid)}</span>
      <b className={row.outstanding > 0 ? 'debt' : 'positive'}>{row.outstanding > 0 ? money(row.outstanding) : 'yopilgan'}</b>
    </div>)}</div> : <p className="subtle-note">Bu do‘konda hali tasdiqlangan buyurtma yoki ombor sotuvi yo‘q.</p>}
    <div className="ledger-pay">
      {open ? <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field"><span>To‘lov summasi, UZS</span><input name="amount" type="number" min="0.01" step="0.01" defaultValue={ledger.debt > 0 ? ledger.debt : undefined} placeholder="Avans bilan ham mumkin" required /></label>
          <label className="field"><span>Hisob</span><select name="account"><option value="cash">Naqd pul</option><option value="bank">Bank / karta</option></select></label>
        </div>
        <div className="button-group"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Bekor qilish</button><button className="primary" disabled={busy}><Banknote size={15} />{busy ? 'O‘tkazilmoqda…' : 'To‘lovni o‘tkazish'}</button></div>
        <p className="subtle-note">To‘lov avval eng eski qarzni yopadi; tasdiqlangan shartnomadan ortiqcha pul avans bo‘lib qoladi.</p>
      </form> : <button className="secondary" onClick={() => setOpen(true)} disabled={busy}><Banknote size={15} />To‘lov yoki avansni qabul qilish<ChevronDown size={14} /></button>}
    </div>
  </article>;
}
