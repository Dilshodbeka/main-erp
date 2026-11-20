import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Package } from 'lucide-react';
import { itemTurnover, movementJournal, periodKey, type ItemTurnoverRow, type MovementRow, type PeriodKind } from '../analytics';
import { matchesQuery, sortRows, type SortOption, type SortState } from '../listview';
import type { State } from '../types';
import { Empty, Section, dateTime, money, num } from '../ui';
import { PeriodSwitch } from './PeriodSwitch';
import { SortSelect } from './SortSelect';

type JournalSort = 'date' | 'item' | 'qty' | 'value';
type TurnoverSort = 'item' | 'purchased' | 'issued' | 'stock';

export function WarehouseAnalytics({ state, warehouseId, search }: { state: State; warehouseId: string; search: string }) {
  const [direction, setDirection] = useState('all');
  const [source, setSource] = useState('all');
  const [kind, setKind] = useState<PeriodKind>('month');
  const [period, setPeriod] = useState('all');
  const [journalSort, setJournalSort] = useState<SortState<JournalSort> | null>({ field: 'date', direction: 'desc' });
  const [turnoverSort, setTurnoverSort] = useState<SortState<TurnoverSort> | null>({ field: 'purchased', direction: 'desc' });

  const journal = movementJournal(state, warehouseId);
  const sources = [...new Map(journal.map(row => [row.source, row.sourceLabel])).entries()];
  const periods = [...new Set(journal.map(row => periodKey(row.date, kind)))].sort().reverse();
  const journalOptions: SortOption<MovementRow, JournalSort>[] = [
    { value: 'date', label: 'Sana', get: row => row.date },
    { value: 'item', label: 'Pozitsiya', get: row => row.item },
    { value: 'qty', label: 'Miqdor', get: row => row.qty },
    { value: 'value', label: 'Summa', get: row => row.value },
  ];
  const rows = sortRows(journal.filter(row =>
    (direction === 'all' || row.direction === direction)
    && (source === 'all' || row.source === source)
    && (period === 'all' || periodKey(row.date, kind) === period)
    && matchesQuery([row.item, row.counterparty, row.sourceLabel, row.note], search)), journalOptions, journalSort);
  const incoming = rows.filter(row => row.direction === 'in').reduce((sum, row) => sum + row.value, 0);
  const outgoing = rows.filter(row => row.direction === 'out').reduce((sum, row) => sum + row.value, 0);

  const turnoverOptions: SortOption<ItemTurnoverRow, TurnoverSort>[] = [
    { value: 'item', label: 'Pozitsiya', get: row => row.item },
    { value: 'purchased', label: 'Xarid summasi', get: row => row.purchasedValue },
    { value: 'issued', label: 'Ishlab chiqarishga', get: row => row.issuedValue },
    { value: 'stock', label: 'Qoldiq', get: row => row.stock },
  ];
  const turnover = sortRows(itemTurnover(state, warehouseId).filter(row => matchesQuery([row.item], search)), turnoverOptions, turnoverSort);

  return <>
    <Section title="Material oboroti" hint="Har bir pozitsiya bo‘yicha xarid, ishlab chiqarishga berilgan miqdor va joriy qoldiq" action={<SortSelect value={turnoverSort} onChange={setTurnoverSort} options={turnoverOptions} />}>
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Pozitsiya</th><th className="right">Narx / birligi</th><th className="right">Xarid miqdori</th><th className="right">Xarid summasi</th><th className="right">Sexga berilgan</th><th className="right">Berilgan summa</th><th className="right">Kirim / chiqim</th><th className="right">Qoldiq</th></tr></thead>
        <tbody>{turnover.map(row => <tr key={row.itemId}>
          <td data-label="Pozitsiya"><b>{row.item}</b><small>{row.unit}</small></td>
          <td data-label="Narx / birligi" className="right">{money(row.unitPrice)}</td>
          <td data-label="Xarid miqdori" className="right">{num(row.purchasedQty)}</td>
          <td data-label="Xarid summasi" className="right">{money(row.purchasedValue)}</td>
          <td data-label="Sexga berilgan" className="right">{num(row.issuedQty)}</td>
          <td data-label="Berilgan summa" className="right">{money(row.issuedValue)}</td>
          <td data-label="Kirim / chiqim" className="right">{num(row.inQty)} / {num(row.outQty)}</td>
          <td data-label="Qoldiq" className="right"><b>{num(row.stock)} {row.unit}</b></td>
        </tr>)}</tbody>
      </table></div>
      {!turnover.length && <Empty text="Pozitsiyalar hali katalogda yo‘q" />}
    </Section>
    <Section title="Kirim / chiqim jurnali" hint="Har bir harakat: kimdan, qaysi buyurtmaga, qancha miqdor va summa" action={<div className="section-tools">
      <PeriodSwitch value={kind} onChange={value => { setKind(value); setPeriod('all'); }} />
      <select aria-label="Ombor davri" value={period} onChange={event => setPeriod(event.target.value)}>
        <option value="all">Barcha davrlar</option>
        {periods.map(key => <option key={key} value={key}>{key}</option>)}
      </select>
      <select aria-label="Harakat yo‘nalishi" value={direction} onChange={event => setDirection(event.target.value)}>
        <option value="all">Kirim va chiqim</option><option value="in">Kirim</option><option value="out">Chiqim</option>
      </select>
      <select aria-label="Harakat manbasi" value={source} onChange={event => setSource(event.target.value)}>
        <option value="all">Barcha manbalar</option>
        {sources.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <SortSelect value={journalSort} onChange={setJournalSort} options={journalOptions} />
    </div>}>
      <div className="settings-facts"><span>Kirim qiymati<b>{money(incoming)}</b></span><span>Chiqim qiymati<b>{money(outgoing)}</b></span><span>Yozuvlar<b>{rows.length}</b></span></div>
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Sana / vaqt</th><th>Pozitsiya</th><th>Manba</th><th>Kimdan / kimga</th><th className="right">Miqdor</th><th className="right">Summa</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td data-label="Sana / vaqt">{dateTime(row.date)}</td>
          <td data-label="Pozitsiya"><b>{row.item}</b>{row.note && <small>{row.note}</small>}</td>
          <td data-label="Manba"><span className={`cash-amount ${row.direction === 'in' ? 'positive' : 'debt'}`}>{row.direction === 'in' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}{row.sourceLabel}</span></td>
          <td data-label="Kimdan / kimga">{row.counterparty}</td>
          <td data-label="Miqdor" className="right">{num(row.qty)} {row.unit}</td>
          <td data-label="Summa" className="right">{money(row.value)}</td>
        </tr>)}</tbody>
      </table></div>
      {!rows.length && <Empty text="Bu filtr bo‘yicha ombor harakati topilmadi" action={<Package size={18} />} />}
    </Section>
  </>;
}
