import { useState } from 'react';
import { cashByCategory, cashByPeriod, type CashCategoryRow, type CashPeriodRow, type PeriodKind } from '../analytics';
import { sortRows, type SortOption, type SortState } from '../listview';
import { cashCategoryLabel } from '../i18n';
import type { State } from '../types';
import { Empty, Section, money } from '../ui';
import { PeriodSwitch, periodTitle } from './PeriodSwitch';
import { SortSelect } from './SortSelect';

type CashSort = 'key' | 'income' | 'expense' | 'net';
type CategorySort = 'category' | 'income' | 'expense' | 'net';

export function CashAnalytics({ state }: { state: State }) {
  const [kind, setKind] = useState<PeriodKind>('day');
  const [sort, setSort] = useState<SortState<CashSort> | null>({ field: 'key', direction: 'desc' });
  const [categorySort, setCategorySort] = useState<SortState<CategorySort> | null>({ field: 'expense', direction: 'desc' });
  const options: SortOption<CashPeriodRow, CashSort>[] = [
    { value: 'key', label: 'Davr', get: row => row.key },
    { value: 'income', label: 'Kirim', get: row => row.income },
    { value: 'expense', label: 'Chiqim', get: row => row.expense },
    { value: 'net', label: 'Sof oqim', get: row => row.net },
  ];
  const rows = sortRows(cashByPeriod(state, kind), options, sort);
  const categoryOptions: SortOption<CashCategoryRow, CategorySort>[] = [
    { value: 'category', label: 'Kategoriya', get: row => cashCategoryLabel(row.category) },
    { value: 'income', label: 'Kirim', get: row => row.income },
    { value: 'expense', label: 'Chiqim', get: row => row.expense },
    { value: 'net', label: 'Sof oqim', get: row => row.net },
  ];
  const categories = sortRows(cashByCategory(state), categoryOptions, categorySort);
  const income = rows.reduce((sum, row) => sum + row.income, 0);
  const expense = rows.reduce((sum, row) => sum + row.expense, 0);

  return <>
    <Section title="Kirim va chiqim davrlar bo‘yicha" hint="Kunlik, haftalik va oylik xarajatlar. Hisoblararo o‘tkazmalar xarajat hisoblanmaydi." action={<div className="section-tools"><PeriodSwitch value={kind} onChange={setKind} /><SortSelect value={sort} onChange={setSort} options={options} /></div>}>
      <div className="settings-facts"><span>Kirim<b>{money(income)}</b></span><span>Chiqim<b>{money(expense)}</b></span><span>Sof oqim<b>{money(income - expense)}</b></span></div>
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Davr</th><th className="right">Yozuvlar</th><th className="right">Kirim</th><th className="right">Chiqim</th><th className="right">Sof oqim</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}>
          <td data-label="Davr"><b>{periodTitle(row.key, kind)}</b></td>
          <td data-label="Yozuvlar" className="right">{row.count}</td>
          <td data-label="Kirim" className="right positive">{money(row.income)}</td>
          <td data-label="Chiqim" className="right debt">{money(row.expense)}</td>
          <td data-label="Sof oqim" className={`right ${row.net < 0 ? 'debt' : 'positive'}`}>{money(row.net)}</td>
        </tr>)}</tbody>
      </table></div>
      {!rows.length && <Empty text="Kassa yozuvlari paydo bo‘lganda kunlik, haftalik va oylik hisob shu yerda ko‘rinadi" />}
    </Section>
    <Section title="Xarajatlar kategoriyalar bo‘yicha" hint="Arenda, kommunal, oziq-ovqat va boshqa kategoriyalar — kassadagi provodka kategoriyasidan olinadi" action={<SortSelect value={categorySort} onChange={setCategorySort} options={categoryOptions} />}>
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Kategoriya</th><th className="right">Yozuvlar</th><th className="right">Kirim</th><th className="right">Chiqim</th><th className="right">Sof oqim</th></tr></thead>
        <tbody>{categories.map(row => <tr key={row.category}>
          <td data-label="Kategoriya"><b>{cashCategoryLabel(row.category)}</b></td><td data-label="Yozuvlar" className="right">{row.count}</td>
          <td data-label="Kirim" className="right positive">{money(row.income)}</td>
          <td data-label="Chiqim" className="right debt">{money(row.expense)}</td>
          <td data-label="Sof oqim" className={`right ${row.net < 0 ? 'debt' : 'positive'}`}>{money(row.net)}</td>
        </tr>)}</tbody>
      </table></div>
      {!categories.length && <Empty text="Kategoriyalar provodka kiritilganda shakllanadi" />}
    </Section>
  </>;
}
