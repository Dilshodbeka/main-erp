import { Banknote, ChevronRight, CircleAlert, Layers, Wallet } from 'lucide-react';
import { dateLocale } from '../i18n';
import { directorConsole } from '../console';
import type { State } from '../types';
import { Empty, Metric, Section, money } from '../ui';

const monthLabel = (key: string): string =>
  new Date(`${key}-02T00:00:00`).toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' });

export function DirectorConsole({ state, onGo, onPayExpense, onRepayLoan, onOpenCustomer }: {
  state: State;
  onGo: (section: string, panel: string) => void;
  onPayExpense: (planId: string) => void;
  onRepayLoan: (loanId: string) => void;
  onOpenCustomer: (customerId: string) => void;
}) {
  const report = directorConsole(state);
  return <>
    <div className="metrics three">
      <Metric label="Naqd pul" value={money(report.balances.cash)} detail="Qayerda pul bor — faktik qoldiqlar" icon={Banknote} accent />
      <Metric label="Bank / karta" value={money(report.balances.bank)} detail="O‘tkazmalar foyda yaratmaydi" icon={Wallet} />
      <Metric label="Jami pul" value={money(report.balances.total)} detail="Naqd va bank hisoblari birga" icon={Layers} />
    </div>
    <div className="dashboard-grid">
      <Section title="Nima kelishi kerak" hint="Kimdan qancha pul kelishi kutilmoqda">
        <div className="debt-list">
          <button onClick={() => onGo('orders', 'mijozlar')}><div><b>Mijozlar qarzi</b><small>Oddiy mijozlar va xizmat buyurtmachilari</small></div><strong>{money(report.receivable.customers)}</strong><ChevronRight size={16} /></button>
          <button onClick={() => onGo('shops', 'hisob-kitob')}><div><b>Do‘konlar qarzi</b><small>Do‘konlarga yuborilgan mahsulot</small></div><strong>{money(report.receivable.shops)}</strong><ChevronRight size={16} /></button>
          <button onClick={() => onGo('cash', 'zaymlar')}><div><b>Zaymdan olish mumkin</b><small>Ochilmagan zaym limiti</small></div><strong>{money(report.receivable.loansAvailable)}</strong><ChevronRight size={16} /></button>
        </div>
      </Section>
      <Section title="Kimga qarzdormiz" hint="Sizning majburiyatlaringiz — hammasi bitta summada">
        <div className="debt-list">
          <button onClick={() => onGo('people', 'oylik')}><div><b>Ish haqi</b><small>Xodimlarga to‘lanishi kerak</small></div><strong>{money(report.payable.payroll)}</strong><ChevronRight size={16} /></button>
          <button onClick={() => onGo('purchases', 'yetkazib-beruvchilar')}><div><b>Yetkazib beruvchilar</b><small>Qabul qilingan materiallar uchun</small></div><strong>{money(report.payable.suppliers)}</strong><ChevronRight size={16} /></button>
          <button onClick={() => onGo('cash', 'xarajatlar')}><div><b>Oylik xarajatlar</b><small>Ijara, kommunal va boshqalar</small></div><strong>{money(report.payable.expenses)}</strong><ChevronRight size={16} /></button>
          <button onClick={() => onGo('cash', 'zaymlar')}><div><b>Zaymlar</b><small>Qaytarilishi kerak bo‘lgan summa</small></div><strong>{money(report.payable.loans)}</strong><ChevronRight size={16} /></button>
        </div>
        <div className="settings-facts"><span>Jami majburiyatlar<b>{money(report.payable.total)}</b></span></div>
      </Section>
    </div>
    <Section title="Kelgusi oylar" hint="Reja — hali pul emas, faqat majburiyatlarning ko‘rinishi">
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Oy</th><th className="right">Ish haqi rejasi</th><th className="right">Xarajatlar rejasi</th><th className="right">Jami</th></tr></thead>
        <tbody>{report.future.map(row => <tr key={row.month}>
          <td data-label="Oy">{monthLabel(row.month)}</td>
          <td data-label="Ish haqi rejasi" className="right">{money(row.salary)}</td>
          <td data-label="Xarajatlar rejasi" className="right">{money(row.expenses)}</td>
          <td data-label="Jami" className="right"><b>{money(row.total)}</b></td>
        </tr>)}</tbody>
      </table></div>
    </Section>
    <Section title="E’tibor talab qiladi" hint="Hozir qaralishi kerak bo‘lgan to‘lovlar">
      {report.attention.length ? <div className="mini-cards">{report.attention.map(item => <article key={`${item.kind}-${item.id}`}>
        <div><b>{item.title}</b><small>{item.hint}{item.passed ? <em className="debt"> · muddat o‘tgan</em> : null}</small></div>
        <strong>{money(item.amount)}</strong>
        {item.kind === 'expense-due' && <button className="secondary small" onClick={() => onPayExpense(item.id)}>To‘lash</button>}
        {item.kind === 'loan-owed' && <button className="secondary small" onClick={() => onRepayLoan(item.id)}>Qaytarish</button>}
        {item.kind === 'worker-debt' && <button className="secondary small" onClick={() => onOpenCustomer(item.id)}>Karta</button>}
      </article>)}</div> : <Empty text="E’tibor talab qiladigan narsa yo‘q" />}
    </Section>
  </>;
}
