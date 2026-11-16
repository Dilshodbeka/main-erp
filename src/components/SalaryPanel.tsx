import { useMemo, useState } from 'react';
import { Wallet, CircleAlert } from 'lucide-react';
import { salaryLedger } from '../salary';
import { cashCategoryLabel } from '../i18n';
import { Empty, Metric, Section, Title, dateTime, money } from '../ui';
import type { CashEntry, State, WorkerDeduction } from '../types';

const MONTH_NAMES = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} · ${month.slice(0, 4)}`;
}

interface SalaryDisplayRow { id: string; createdAt: string; amount: number }

function allocateSalaryRows<T extends SalaryDisplayRow>(state: State, employeeId: string, month: string, rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ledger = salaryLedger(state, employeeId);
  if (!ledger.months.length) return [];
  const boundary = `${ledger.months[0].month}-01T00:00:00.000Z`;
  const remaining = new Map(ledger.months.map(row => [row.month, row.obliged]));
  const allocated: T[] = [];
  for (const row of sorted) {
    if (row.createdAt < boundary) continue;
    let available = row.amount;
    for (const obligation of ledger.months) {
      if (available <= 0) break;
      const amount = Math.min(available, remaining.get(obligation.month)!);
      remaining.set(obligation.month, remaining.get(obligation.month)! - amount);
      available -= amount;
      if (obligation.month === month && amount > 0) allocated.push({ ...row, amount } as T);
    }
  }
  return allocated.reverse();
}

export function salaryPaymentRows(state: State, employeeId: string, month: string): CashEntry[] {
  return allocateSalaryRows(state, employeeId, month, state.cash
    .filter(row => row.source === 'payroll' && row.sourceId === employeeId && row.direction === 'out')
    .filter(row => !state.cash.some(reversal => reversal.reversalOf === row.id)));
}

export function salaryDeductionRows(state: State, employeeId: string, month: string): WorkerDeduction[] {
  return allocateSalaryRows(state, employeeId, month, state.workerDeductions
    .filter(row => row.employeeId === employeeId && row.direction === 'deduct')
    .filter(row => !state.workerDeductions.some(reversal => reversal.reversalOf === row.id)));
}

export default function SalaryPanel({ state, onPay, onPlan, onDeduct, onReverseDeduction }: {
  state: State;
  onPay: (employeeId: string) => void;
  onPlan: (employeeId: string) => void;
  onDeduct: (employeeId: string) => void;
  onReverseDeduction: (deductionId: string) => void;
}) {
  const rows = useMemo(() => state.employees.map(employee => ({
    employee,
    ledger: salaryLedger(state, employee.id),
    plan: state.salaryPlans.filter(row => row.employeeId === employee.id).sort((a, b) => b.fromMonth.localeCompare(a.fromMonth))[0],
  })), [state]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    planned: sum.planned + row.ledger.plannedTotal,
    paid: sum.paid + row.ledger.paidTotal,
    owed: sum.owed + row.ledger.owed,
    prepaid: sum.prepaid + row.ledger.prepaid,
  }), { planned: 0, paid: 0, owed: 0, prepaid: 0 }), [rows]);
  const [open, setOpen] = useState<string | null>(null);

  return <>
    <Title eyebrow="HR / OYLIK VA QARZLAR" title="Har bir oy alohida ko‘rinadi." description="Oylik, avans va qoldiq — xodimning kassa bilan hisob-kitobi. Faqat belgilangan oylik hisoblanadi; ish hajmi oylikka qo‘shilmaydi." />
    <div className="metrics">
      <Metric label="Oylik hisoblangan" value={money(totals.planned)} detail="Faqat tasdiqlangan oyliklar" icon={Wallet} />
      <Metric label="To‘langan" value={money(totals.paid)} detail="Naqd va bank, stornolar chegirilgan" icon={Wallet} />
      <Metric label="Qoldiq" value={money(totals.owed)} detail="Kompaniya xodimga qarzdor" icon={CircleAlert} accent />
      <Metric label="Oldindan berilgan" value={money(totals.prepaid)} detail="Ochiq majburiyatlardan ortiqcha to‘lov" icon={Wallet} />
    </div>
    <Section title="Xodimlar bo‘yicha oyliklar" hint="Chipni bosing — oyning qaysi to‘lov bilan yopilgani ko‘rinadi">
      {!rows.length && <Empty text="Avval «Xodimlar» bo‘limida xodim yarating" />}
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Xodim</th><th>Oylar</th><th className="right">Hisoblangan</th><th className="right">To‘langan</th><th className="right">Qoldiq</th><th /></tr></thead>
        <tbody>{rows.map(({ employee, ledger, plan }) => <tr key={employee.id}>
          <td data-label="Xodim"><b>{employee.name}</b><small>{employee.active ? 'Faol' : `Ishdan chiqqan${employee.deactivatedAt ? ` · ${dateTime(employee.deactivatedAt)}` : ''}`}{plan ? ` · oylik ${money(plan.amount)}` : ''}{!employee.active && ledger.owed > 0 ? ` · qoldiq ${money(ledger.owed)}` : ''}</small></td>
          <td data-label="Oylar"><div className="month-bar">{ledger.months.map(month => <button
            type="button" key={month.month} className={open === `${employee.id}:${month.month}` ? 'selected' : ''}
            onClick={() => setOpen(open === `${employee.id}:${month.month}` ? null : `${employee.id}:${month.month}`)}>
            <small>{monthLabel(month.month)}</small><b>{money(month.obliged)}</b>
            <em>{month.unpaid <= 0 && month.obliged > 0 ? 'to‘langan' : month.paid > 0 ? 'qisman' : 'to‘lanmagan'}</em>
          </button>)}{!ledger.months.length && <small className="muted">Oylik belgilanmagan</small>}</div></td>
          <td data-label="Hisoblangan" className="right">{money(ledger.plannedTotal)}</td>
          <td data-label="To‘langan" className="right">{money(ledger.paidTotal)}</td>
          <td data-label="Qoldiq" className="right"><strong>{money(ledger.owed)}</strong>{ledger.prepaid > 0 && <small>Oldindan berilgan {money(ledger.prepaid)}</small>}</td>
          <td data-label="Amallar"><div className="button-group">
            <button className="secondary small" onClick={() => onPlan(employee.id)}>Oylik belgilash</button>
            <button className="secondary small" disabled={ledger.owed <= 0 || !state.customers.some(row => row.employeeId === employee.id)}
              onClick={() => onDeduct(employee.id)}>Oylikdan ushlash</button>
            <button className="primary" disabled={ledger.owed <= 0} onClick={() => onPay(employee.id)}>To‘lash</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>
      {rows.map(({ employee, ledger }) => {
        const key = open?.split(':')[0];
        const part = open?.split(':')[1];
        if (key !== employee.id || !part) return null;
        const month = ledger.months.find(row => row.month === part);
        if (!month) return null;
        const payments = salaryPaymentRows(state, employee.id, month.month);
        const deductions = salaryDeductionRows(state, employee.id, month.month);
        return <Section key={`detail-${employee.id}`} title={`${employee.name} — ${monthLabel(month.month)}`}
          hint={`Hisoblangan ${money(month.obliged)} · To‘langan ${money(month.paid)} · Qoldiq ${money(month.unpaid)}`}>
          <div className="table-scroll cardable"><table>
            <thead><tr><th>Sana / vaqt</th><th>Kategoriya</th><th>Izoh</th><th className="right">Summa</th><th /></tr></thead>
            <tbody>{payments.map(row => <tr key={row.id}>
              <td data-label="Sana / vaqt">{dateTime(row.createdAt)}</td>
              <td data-label="Kategoriya">{cashCategoryLabel(row.category)}</td>
              <td data-label="Izoh">{row.note || '—'}</td>
              <td data-label="Summa" className="right">{money(row.amount)}</td>
              <td data-label="Amallar" />
            </tr>)}{deductions.map(row => <tr key={row.id}>
              <td data-label="Sana / vaqt">{dateTime(row.createdAt)}</td>
              <td data-label="Kategoriya">Oylikdan ushlab qolindi</td>
              <td data-label="Izoh">{row.note || '—'}</td>
              <td data-label="Summa" className="right">{money(row.amount)}</td>
              <td data-label="Amallar"><button className="secondary small" onClick={() => onReverseDeduction(row.id)}>Storno</button></td>
            </tr>)}{!payments.length && !deductions.length && <tr><td data-label="Xabar" colSpan={5}>Bu oy uchun to‘lov yozuvi yo‘q</td></tr>}</tbody>
          </table></div>
        </Section>;
      })}
    </Section>
  </>;
}
