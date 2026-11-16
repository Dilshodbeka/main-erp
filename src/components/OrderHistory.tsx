import { useState } from 'react';
import { FileText, History as HistoryIcon, Pencil } from 'lucide-react';
import { Empty, Metric, Section, Title, dateTime, money, num } from '../ui';
import { completedOrderRows, customerAnalytics, processAnalytics, supplierAnalytics, type OrderProfitRow } from '../history';
import { matchesQuery, sortRows, type SortOption, type SortState } from '../listview';
import type { State } from '../types';
import { SortSelect } from './SortSelect';

type HistorySortKey = 'date' | 'customer' | 'revenue' | 'profit' | 'debt';

export function OrderHistory({ state, search, onOpen, onInvoice }: {
  state: State; search: string; onOpen: (orderId: string) => void; onInvoice: (orderId: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'delivered' | 'cancelled'>('all');
  const [sort, setSort] = useState<SortState<HistorySortKey> | null>({ field: 'date', direction: 'desc' });
  const sortOptions: SortOption<OrderProfitRow, HistorySortKey>[] = [
    { value: 'date', label: 'Sana', get: row => row.date },
    { value: 'customer', label: 'Mijoz', get: row => row.customer },
    { value: 'revenue', label: 'Tushum', get: row => row.revenue },
    { value: 'profit', label: 'Foyda', get: row => row.profit },
    { value: 'debt', label: 'Qarz', get: row => row.debt },
  ];
  const rows = sortRows(completedOrderRows(state)
    .filter(row => filter === 'all' || row.order.status === filter)
    .filter(row => matches(search, row.order.number, row.order.title, row.customer)), sortOptions, sort);
  const delivered = completedOrderRows(state).filter(row => row.order.status === 'delivered');
  const revenue = delivered.reduce((sum, row) => sum + row.revenue, 0);
  const profit = delivered.reduce((sum, row) => sum + row.profit, 0);
  const debt = delivered.reduce((sum, row) => sum + row.debt, 0);
  const customers = customerAnalytics(state).filter(row => row.orders > 0 && matches(search, row.name));
  const suppliers = supplierAnalytics(state).filter(row => row.purchases > 0 && matches(search, row.name));
  const processes = processAnalytics(state).filter(row => matches(search, row.name));

  return <>
    <Title
      eyebrow="TARIX / BIZNES STATISTIKASI"
      title="Yakunlangan ishlar va haqiqiy foyda."
      description="Yetkazilgan buyurtmalar, mijozlar, yetkazib beruvchilar va bosqichlar bo‘yicha fakt ko‘rsatkichlari. Reja emas — qabul qilingan ish, berilgan material va olingan pul."
      action={<div className="segmented tight">{(['all', 'delivered', 'cancelled'] as const).map(key => <button key={key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>{key === 'all' ? 'Barchasi' : key === 'delivered' ? 'Yetkazilgan' : 'Bekor qilingan'}</button>)}</div>}
    />
    <div className="metrics">
      <Metric label="Yakunlangan buyurtmalar" value={delivered.length} detail={`${completedOrderRows(state).filter(row => row.order.status === 'cancelled').length} bekor qilingan`} icon={HistoryIcon} />
      <Metric label="Tushum" value={money(revenue)} detail="Yetkazilgan buyurtmalar qiymati" icon={FileText} />
      <Metric label="Foyda, fakt" value={money(profit)} detail="Tushum − material − bosqich tannarxi − boshqa xarajat" icon={HistoryIcon} accent />
      <Metric label="Qarz" value={money(debt)} detail="Yakunlangan, lekin to‘lanmagan" icon={FileText} />
    </div>
    <Section title="Yakunlangan buyurtmalar" hint="Faqat yetkazilgan va bekor qilingan buyurtmalar. Foyda — fakt tannarx bo‘yicha." action={<SortSelect value={sort} onChange={setSort} options={sortOptions} />}>
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Buyurtma</th><th>Mijoz</th><th>Sana / vaqt</th><th className="right">Tushum</th><th className="right">Xarajat</th><th className="right">Foyda</th><th className="right">Qarz</th><th /></tr></thead>
        <tbody>{rows.map(row => <tr key={row.order.id}>
          <td data-label="Buyurtma"><button className="row-link" onClick={() => onOpen(row.order.id)}>{row.order.number} · {row.order.title}</button><small>{row.order.status === 'cancelled' ? 'Bekor qilingan' : `Marja ${num(row.margin)}%`}</small></td>
          <td data-label="Mijoz">{row.customer}</td>
          <td data-label="Sana / vaqt">{dateTime(row.date)}</td>
          <td data-label="Tushum" className="right">{money(row.revenue)}</td>
          <td data-label="Xarajat" className="right">{money(row.cost + row.overhead)}</td>
          <td data-label="Foyda" className={`right ${row.profit < 0 ? 'debt' : 'positive'}`}>{money(row.profit)}</td>
          <td data-label="Qarz" className="right debt">{money(row.debt)}</td>
          <td data-label="Amallar"><div className="table-actions"><button className="icon-button" aria-label={`Ochish ${row.order.number}`} onClick={() => onOpen(row.order.id)}><Pencil size={15} /></button><button className="icon-button" aria-label={`Hisob-faktura ${row.order.number}`} onClick={() => onInvoice(row.order.id)}><FileText size={15} /></button></div></td>
        </tr>)}</tbody>
      </table></div>
      {!rows.length && <Empty text="Yakunlangan buyurtmalar hali yo‘q. Buyurtma yetkazilgandan keyin shu yerda paydo bo‘ladi." />}
    </Section>
    <Section title="Mijozlar statistikasi" hint="Tushum, foyda, o‘rtacha chek va qarz — barcha yakunlanmagan buyurtmalar bilan birga.">
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Mijoz</th><th className="right">Buyurtmalar</th><th className="right">Tushum</th><th className="right">Foyda</th><th className="right">O‘rtacha chek</th><th className="right">Qarz</th><th>Oxirgi buyurtma</th></tr></thead>
        <tbody>{customers.map(row => <tr key={row.customerId}>
          <td data-label="Mijoz"><b>{row.name}</b></td><td data-label="Buyurtmalar" className="right">{row.orders}</td><td data-label="Tushum" className="right">{money(row.revenue)}</td>
          <td data-label="Foyda" className={`right ${row.profit < 0 ? 'debt' : 'positive'}`}>{money(row.profit)}</td>
          <td data-label="O‘rtacha chek" className="right">{money(row.average)}</td><td data-label="Qarz" className="right debt">{money(row.debt)}</td>
          <td data-label="Oxirgi buyurtma">{row.lastOrder ? dateTime(row.lastOrder) : '—'}</td>
        </tr>)}</tbody>
      </table></div>
      {!customers.length && <Empty text="Mijozlar statistikasi buyurtmalar paydo bo‘lganda to‘ladi." />}
    </Section>
    <Section title="Yetkazib beruvchilar statistikasi" hint="Qabul qilingan material qiymati, to‘lovlar va qarzdorlik.">
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Yetkazib beruvchi</th><th className="right">Xaridlar</th><th className="right">Qabul qiymati</th><th className="right">To‘langan</th><th className="right">Qarz</th><th>Oxirgi xarid</th></tr></thead>
        <tbody>{suppliers.map(row => <tr key={row.supplierId}>
          <td data-label="Yetkazib beruvchi"><b>{row.name}</b></td><td data-label="Xaridlar" className="right">{row.purchases}</td><td data-label="Qabul qiymati" className="right">{money(row.receivedValue)}</td>
          <td data-label="To‘langan" className="right">{money(row.paid)}</td><td data-label="Qarz" className="right debt">{money(row.debt)}</td>
          <td data-label="Oxirgi xarid">{row.lastPurchase ? dateTime(row.lastPurchase) : '—'}</td>
        </tr>)}</tbody>
      </table></div>
      {!suppliers.length && <Empty text="Yetkazib beruvchilar statistikasi xarid qabul qilingandan keyin paydo bo‘ladi." />}
    </Section>
    <Section title="Bosqichlar va dastgohlar yuklamasi" hint="Reja va fakt miqdor, bosqich tannarxi, mijoz qiymati hamda rad etilgan hisobotlar.">
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Bosqich</th><th className="right">Reja</th><th className="right">Bajarildi</th><th className="right">Bosqich tannarxi</th><th className="right">Mijoz qiymati</th><th className="right">Rad etilgan</th><th className="right">Birlik tannarxi</th></tr></thead>
        <tbody>{processes.map(row => <tr key={row.operationId}>
          <td data-label="Bosqich"><b>{row.name}</b></td><td data-label="Reja" className="right">{num(row.planned)}</td><td data-label="Bajarildi" className="right">{num(row.completed)}</td>
          <td data-label="Bosqich tannarxi" className="right">{money(row.payroll)}</td><td data-label="Mijoz qiymati" className="right">{money(row.saleValue)}</td>
          <td data-label="Rad etilgan" className={`right ${row.rejected ? 'debt' : ''}`}>{row.rejected}</td><td data-label="Birlik tannarxi" className="right">{money(row.rate)}</td>
        </tr>)}</tbody>
      </table></div>
      {!processes.length && <Empty text="Bosqichlar statistikasi buyurtma marshrutlari paydo bo‘lganda to‘ladi." />}
    </Section>
    <div className="info-note">Foyda — boshqaruv ko‘rsatkichi: yetkazilgan buyurtma qiymati minus berilgan materiallar, qabul qilingan ishning tannarxi va boshqa xarajatlar. Rasmiy buxgalteriya hisobi emas; QQS va soliqlar hisobga olinmagan.</div>
  </>;
}

function matches(search: string, ...values: (string | number | undefined)[]): boolean {
  return matchesQuery(values, search);
}
