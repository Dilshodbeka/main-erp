import { useMemo, useState } from 'react';
import { Wallet, CircleAlert } from 'lucide-react';
import { cashCategoryLabel } from '../i18n';
import { loanLedger, loansAvailable } from '../loans';
import { Empty, Metric, Section, Title, dateTime, money } from '../ui';
import type { State } from '../types';

export default function LoansPanel({ state, onSet, onDraw, onRepay }: {
  state: State;
  onSet: (loanId: string | null) => void;
  onDraw: (loanId: string) => void;
  onRepay: (loanId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(() => state.loans
    .map(loan => ({ loan, ledger: loanLedger(state, loan.id) }))
    .slice().sort((a, b) => a.loan.createdAt.localeCompare(b.loan.createdAt)), [state]);
  const totals = useMemo(() => rows.reduce((sum, { ledger }) => ({
    principal: sum.principal + ledger.principal,
    drawn: sum.drawn + ledger.drawn,
    repaid: sum.repaid + ledger.repaid,
    owed: sum.owed + ledger.owed,
  }), { principal: 0, drawn: 0, repaid: 0, owed: 0 }), [rows]);
  const available = loansAvailable(state);

  return <>
    <Title eyebrow="MOLIYA / ZAYMLAR" title="Zaymlar va investitsiyalar." description="Tanishlardan olingan qarz yoki ulush pullari — olingani, qaytarilgani va qolgan qarzdorlik bilan. Har bir yozuv alohida hisob." />
    <div className="metrics">
      <Metric label="Jami summa" value={money(totals.principal)} detail="Barcha zaym va investitsiyalar" icon={Wallet} />
      <Metric label="Olingan" value={money(totals.drawn)} detail="Asosiy hisobga o‘tkazilgan" icon={Wallet} />
      <Metric label="Qaytarilgan" value={money(totals.repaid)} detail="Qisman yoki to‘liq" icon={Wallet} />
      <Metric label="Qarzdorlik" value={money(totals.owed)} detail={`Hozir olish mumkin: ${money(available)}`} icon={CircleAlert} accent />
    </div>
    <Section title="Zaymlar va investitsiyalar" hint="Chipni bosing — yozuv tarixi ko‘rinadi" action={<button className="primary" onClick={() => onSet(null)}>Yangi zaym</button>}>
      {!rows.length && <Empty text="Avval «Yangi zaym» tugmasini bosing" />}
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Nomi</th><th className="right">Olingan</th><th className="right">Mavjud</th><th className="right">Qaytarilgan</th><th className="right">Qarzdorlik</th><th /></tr></thead>
        <tbody>{rows.map(({ loan, ledger }) => <tr key={loan.id}>
          <td data-label="Nomi"><div className="month-bar"><button
            type="button" className={openId === loan.id ? 'selected' : ''}
            onClick={() => setOpenId(openId === loan.id ? null : loan.id)}>
            <small>{loan.kind === 'loan' ? 'Zaym' : 'Investitsiya'} · {money(loan.amount)}</small>
            <b>{loan.title}</b><em>{ledger.owed > 0 ? 'qarz' : 'yopilgan'}</em>
          </button></div></td>
          <td data-label="Olingan" className="right">{money(ledger.drawn)}</td>
          <td data-label="Mavjud" className="right">{money(ledger.available)}</td>
          <td data-label="Qaytarilgan" className="right">{money(ledger.repaid)}</td>
          <td data-label="Qarzdorlik" className="right"><strong>{money(ledger.owed)}</strong></td>
          <td data-label="Amallar"><div className="button-group">
            <button className="secondary small" onClick={() => onSet(loan.id)}>Tahrirlash</button>
            <button className="secondary small" disabled={ledger.available <= 0} onClick={() => onDraw(loan.id)}>Pul olish</button>
            <button className="primary" disabled={ledger.owed <= 0} onClick={() => onRepay(loan.id)}>Qaytarish</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>
      {rows.map(({ loan, ledger }) => {
        if (openId !== loan.id) return null;
        const wires = state.cash
          .filter(row => row.source === 'loan' && row.sourceId === loan.id)
          .filter(row => !state.cash.some(reversal => reversal.reversalOf === row.id))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return <Section key={`detail-${loan.id}`} title={loan.title}
          hint={`Olingan ${money(ledger.drawn)} · Qaytarilgan ${money(ledger.repaid)} · Qolgan qarz ${money(ledger.owed)}`}>
          <div className="table-scroll cardable"><table>
            <thead><tr><th>Sana / vaqt</th><th>Kategoriya</th><th>Izoh</th><th className="right">Summa</th></tr></thead>
            <tbody>{wires.map(row => <tr key={row.id}>
              <td data-label="Sana / vaqt">{dateTime(row.createdAt)}</td>
              <td data-label="Kategoriya">{cashCategoryLabel(row.category)}</td>
              <td data-label="Izoh">{row.note || '—'}</td>
              <td data-label="Summa" className="right">{row.direction === 'in' ? '+' : '−'}{money(row.amount)}</td>
            </tr>)}{!wires.length && <tr><td data-label="Xabar" colSpan={4}>Hozircha o‘tkazmalar yo‘q</td></tr>}</tbody>
          </table></div>
        </Section>;
      })}
    </Section>
  </>;
}
