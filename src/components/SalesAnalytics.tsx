import { useState } from 'react';
import { salesByPeriod, type PeriodKind, type SalesPeriodRow } from '../analytics';
import { sortRows, type SortOption, type SortState } from '../listview';
import type { State } from '../types';
import { Empty, Section, money } from '../ui';
import { PeriodSwitch, periodTitle } from './PeriodSwitch';
import { SortSelect } from './SortSelect';

type SalesSort = 'key' | 'orders' | 'revenue' | 'shipped' | 'paid' | 'profit';

export function SalesAnalytics({ state }: { state: State }) {
  const [kind, setKind] = useState<PeriodKind>('month');
  const [sort, setSort] = useState<SortState<SalesSort> | null>({ field: 'key', direction: 'desc' });
  const options: SortOption<SalesPeriodRow, SalesSort>[] = [
    { value: 'key', label: 'Davr', get: row => row.key },
    { value: 'orders', label: 'Buyurtmalar', get: row => row.orders },
    { value: 'revenue', label: 'Tushum', get: row => row.revenue },
    { value: 'shipped', label: 'Yetkazilgan', get: row => row.shipped },
    { value: 'paid', label: 'Olingan pul', get: row => row.paid },
    { value: 'profit', label: 'Foyda', get: row => row.profit },
  ];
  const rows = sortRows(salesByPeriod(state, kind), options, sort);

  return <Section title="Savdo dinamikasi" hint="Buyurtma qiymati — shartnoma sanasida, yetkazish — yetkazilgan/yuborilgan sanada, pul — kassa tushum sanasida" action={<div className="section-tools"><PeriodSwitch value={kind} onChange={setKind} /><SortSelect value={sort} onChange={setSort} options={options} /></div>}>
    <div className="table-scroll cardable"><table>
      <thead><tr><th>Davr</th><th className="right">Buyurtmalar</th><th className="right">Shartnoma summasi</th><th className="right">Yetkazilgan</th><th className="right">Olingan pul</th><th className="right">Foyda</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}>
        <td data-label="Davr"><b>{periodTitle(row.key, kind)}</b></td>
        <td data-label="Buyurtmalar" className="right">{row.orders}</td>
        <td data-label="Shartnoma summasi" className="right">{money(row.revenue)}</td>
        <td data-label="Yetkazilgan" className="right">{money(row.shipped)}</td>
        <td data-label="Olingan pul" className="right positive">{money(row.paid)}</td>
        <td data-label="Foyda" className={`right ${row.profit < 0 ? 'debt' : 'positive'}`}>{money(row.profit)}</td>
      </tr>)}</tbody>
    </table></div>
    {!rows.length && <Empty text="Buyurtmalar, yetkazishlar va to‘lovlar paydo bo‘lganda savdo dinamikasi shakllanadi" />}
  </Section>;
}
