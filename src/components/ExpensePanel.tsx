import { useMemo, useState } from 'react';
import { Wallet, CircleAlert } from 'lucide-react';
import { expenseLedger } from '../expenses';
import { cashCategoryLabel } from '../i18n';
import { Empty, Metric, Section, Title, dateTime, money } from '../ui';
import type { CashEntry, State } from '../types';

const MONTH_NAMES = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} · ${month.slice(0, 4)}`;
}

export function expensePaymentRows(state: State, planId: string, month: string): CashEntry[] {
  const payments = state.cash
    .filter(row => row.source === 'expense' && row.sourceId === planId && row.direction === 'out')
    .filter(row => !state.cash.some(reversal => reversal.reversalOf === row.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ledger = expenseLedger(state, planId);
  if (!ledger.months.length) return [];
  const remaining = new Map(ledger.months.map(row => [row.month, row.obliged]));
  const allocated: CashEntry[] = [];
  for (const payment of payments) {
    let available = payment.amount;
    for (const obligation of ledger.months) {
      if (available <= 0) break;
      const amount = Math.min(available, remaining.get(obligation.month)!);
      remaining.set(obligation.month, remaining.get(obligation.month)! - amount);
      available -= amount;
      if (obligation.month === month && amount > 0) allocated.push({ ...payment, amount });
    }
  }
  return allocated.reverse();
}

export default function ExpensePanel({ state, onPlan, onPay }: { state: State; onPlan: (planId: string | null) => void; onPay: (planId: string) => void }) {
  const rows = useMemo(() => [...new Set(state.expensePlans.map(row => row.planId))].map(planId => {
    const versions = state.expensePlans
      .filter(row => row.planId === planId)
      .sort((a, b) => a.fromMonth.localeCompare(b.fromMonth) || a.createdAt.localeCompare(b.createdAt));
    return { planId, ledger: expenseLedger(state, planId), version: versions[versions.length - 1] };
  }), [state]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    planned: sum.planned + row.ledger.plannedTotal,
    paid: sum.paid + row.ledger.paidTotal,
    owed: sum.owed + row.ledger.owed,
    prepaid: sum.prepaid + row.ledger.prepaid,
  }), { planned: 0, paid: 0, owed: 0, prepaid: 0 }), [rows]);
  const [open, setOpen] = useState<string | null>(null);

  return <>
    <Title eyebrow="MOLIYA / OYLIK XARAJATLAR" title="Har oy takrorlanadigan xarajatlar." description="Ijara, kommunal, oshxona va boshqa oylik to‘lovlar — muddati, qarzi va tarixi bilan. Oldindan to‘langan summa keyingi oyni yopadi." />
    <div className="metrics">
      <Metric label="Oylik reja" value={money(totals.planned)} detail="Davr boshidan hisoblangan" icon={Wallet} />
      <Metric label="To‘langan" value={money(totals.paid)} detail="Naqd va bank, stornolar chegirilgan" icon={Wallet} />
      <Metric label="Qarzdorlik" value={money(totals.owed)} detail="Muddati kelgan oylik majburiyatlar" icon={CircleAlert} accent />
      <Metric label="Oldindan to‘langan" value={money(totals.prepaid)} detail="Kelgusi oylar hisobiga" icon={Wallet} />
    </div>
    <Section title="Oylik xarajatlar" hint="Chipni bosing — oyning qaysi to‘lov bilan yopilgani ko‘rinadi" action={<button className="primary" onClick={() => onPlan(null)}>Yangi oylik xarajat</button>}>
      {!rows.length && <Empty text="Avval «Yangi oylik xarajat» tugmasini bosing" />}
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Xarajat</th><th>Oylar</th><th className="right">To‘langan</th><th className="right">Qarzdorlik</th><th /></tr></thead>
        <tbody>{rows.map(({ planId, ledger, version }) => <tr key={planId}>
          <td data-label="Xarajat"><b>{ledger.title}</b><small>Har oy {version.dueDay}-kungacha{version.supplierId ? ` · ${state.suppliers.find(s => s.id === version.supplierId)?.name ?? 'Yetkazib beruvchi'}` : ''}</small></td>
          <td data-label="Oylar"><div className="month-bar">{ledger.months.map(month => <button
            type="button" key={month.month} className={open === `${planId}:${month.month}` ? 'selected' : ''}
            onClick={() => setOpen(open === `${planId}:${month.month}` ? null : `${planId}:${month.month}`)}>
            <small>{monthLabel(month.month)}</small><b>{money(month.obliged)}</b>
            <em>{month.unpaid <= 0 && month.obliged > 0 ? 'to‘langan' : month.paid > 0 ? 'qisman' : 'to‘lanmagan'}</em>
          </button>)}{!ledger.months.length && <small className="muted">Kelgusidagi reja</small>}</div></td>
          <td data-label="To‘langan" className="right">{money(ledger.paidTotal)}</td>
          <td data-label="Qarzdorlik" className="right"><strong>{money(ledger.owed)}</strong>{ledger.prepaid > 0 && <small>Oldindan to‘langan {money(ledger.prepaid)}</small>}</td>
          <td data-label="Amallar"><div className="button-group">
            <button className="secondary small" onClick={() => onPlan(planId)}>Tahrirlash</button>
            <button className="primary" disabled={ledger.owed <= 0} onClick={() => onPay(planId)}>To‘lash</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>
      {rows.map(({ planId, ledger }) => {
        const key = open?.split(':')[0];
        const part = open?.split(':')[1];
        if (key !== planId || !part) return null;
        const month = ledger.months.find(row => row.month === part);
        if (!month) return null;
        const payments = expensePaymentRows(state, planId, month.month);
        return <Section key={`detail-${planId}`} title={`${ledger.title} — ${monthLabel(month.month)}`}
          hint={`Hisoblangan ${money(month.obliged)} · To‘langan ${money(Math.max(0, month.paid))} · Qoldiq ${money(Math.max(0, month.obliged - month.paid))}`}>
          <div className="table-scroll cardable"><table>
            <thead><tr><th>Sana / vaqt</th><th>Kategoriya</th><th>Izoh</th><th className="right">Summa</th></tr></thead>
            <tbody>{payments.map(row => <tr key={row.id}>
              <td data-label="Sana / vaqt">{dateTime(row.createdAt)}</td>
              <td data-label="Kategoriya">{cashCategoryLabel(row.category)}</td>
              <td data-label="Izoh">{row.note || '—'}</td>
              <td data-label="Summa" className="right">{money(row.amount)}</td>
            </tr>)}{!payments.length && <tr><td data-label="Xabar" colSpan={4}>Bu oy uchun to‘lov yozuvi yo‘q</td></tr>}</tbody>
          </table></div>
        </Section>;
      })}
    </Section>
  </>;
}
