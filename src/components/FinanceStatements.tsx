import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { periodEnd, periodKey, periodStart, type PeriodKind } from '../analytics';
import { customerKindLabel } from '../customers';
import { statusLabel } from '../i18n';
import { matchesQuery, sortRows, type SortOption, type SortState } from '../listview';
import {
  customerStatements, orderStatements, supplierStatements,
  type CustomerStatementRow, type OrderStatementRow, type PaymentRow, type SupplierStatementRow,
} from '../statements';
import type { Actor, State } from '../types';
import { Empty, Section, dateTime, money } from '../ui';
import { PeriodSwitch, periodTitle } from './PeriodSwitch';
import { SortSelect } from './SortSelect';

type Tab = 'customers' | 'suppliers' | 'orders';
type CustomerSort = 'name' | 'shipped' | 'paid' | 'debt';
type SupplierSort = 'name' | 'received' | 'outsourced' | 'paid' | 'debt';
type OrderSort = 'date' | 'price' | 'paid' | 'debt';

const tabs: { id: Tab; label: string }[] = [
  { id: 'customers', label: 'Mijozlar' },
  { id: 'suppliers', label: 'Ta’minotchilar' },
  { id: 'orders', label: 'Buyurtmalar' },
];

const nextDay = (iso: string): string => {
  const value = new Date(`${iso}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};

function periodLabel(key: string, kind: PeriodKind): string {
  if (key === 'all') return 'Butun davr';
  if (kind !== 'month') return periodTitle(key, kind);
  return new Date(`${key}-02T00:00:00`).toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' });
}

export function statementDates(state: State, tab: Tab): string[] {
  if (tab === 'customers') return [
    ...state.shipments.map(row => row.createdAt),
    ...state.cash.filter(row => row.source === 'sale').map(row => row.createdAt),
  ];
  if (tab === 'suppliers') return [
    ...state.purchases.map(row => row.createdAt),
    ...state.cash.filter(row => row.source === 'supplier').map(row => row.createdAt),
  ];
  return state.orders.filter(row => row.kind !== 'series').map(row => row.createdAt);
}

function Payments({ rows, empty }: { rows: PaymentRow[]; empty: string }) {
  if (!rows.length) return <Empty text={empty} />;
  return <div className="table-scroll cardable"><table>
    <thead><tr><th>Sana / vaqt</th><th>Hisob</th><th>Izoh</th><th className="right">Summa</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      <td data-label="Sana / vaqt">{dateTime(row.date)}{row.reversalOf ? <small>storno</small> : row.reversed ? <small>bekor qilingan</small> : null}</td>
      <td data-label="Hisob">{row.account === 'cash' ? 'Naqd pul' : 'Bank / karta'}</td>
      <td data-label="Izoh">{row.note || '—'}</td>
      <td data-label="Summa" className={`right ${row.amount < 0 ? 'debt' : 'positive'}`}>{money(row.amount)}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function FinanceStatements({ state, actor, search = '', onOpenCustomer }: {
  state: State; actor: Actor; search?: string; onOpenCustomer?: (customerId: string) => void;
}) {
  const admin = actor.role === 'admin';
  const [tab, setTab] = useState<Tab>('customers');
  const [kind, setKind] = useState<PeriodKind>('month');
  const [period, setPeriod] = useState(() => periodKey(new Date().toISOString(), 'month'));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [customerSort, setCustomerSort] = useState<SortState<CustomerSort> | null>({ field: 'paid', direction: 'desc' });
  const [supplierSort, setSupplierSort] = useState<SortState<SupplierSort> | null>({ field: 'paid', direction: 'desc' });
  const [orderSort, setOrderSort] = useState<SortState<OrderSort> | null>({ field: 'date', direction: 'desc' });
  const match = (...values: (string | number | undefined)[]) => !search || matchesQuery(values, search);

  const keys = [...new Set(statementDates(state, tab).map(value => periodKey(value, kind)))].sort().reverse();
  if (!keys.includes(period)) keys.unshift(period);
  const range = period === 'all'
    ? { from: '2000-01-01', to: '2100-01-01' }
    : { from: periodStart(period, kind), to: nextDay(periodEnd(period, kind)) };

  const customerOptions: SortOption<CustomerStatementRow, CustomerSort>[] = [
    { value: 'name', label: 'Mijoz', get: row => row.name },
    { value: 'shipped', label: 'Yuborilgan', get: row => row.shipped },
    { value: 'paid', label: 'To‘langan', get: row => row.paid },
    { value: 'debt', label: 'Qarz', get: row => row.debt },
  ];
  const supplierOptions: SortOption<SupplierStatementRow, SupplierSort>[] = [
    { value: 'name', label: 'Ta’minotchi', get: row => row.name },
    { value: 'received', label: 'Qabul qilingan', get: row => row.receivedValue },
    { value: 'outsourced', label: 'Xizmatlar', get: row => row.outsourced },
    { value: 'paid', label: 'To‘langan', get: row => row.paid },
    { value: 'debt', label: 'Qarz', get: row => row.debt },
  ];
  const orderOptions: SortOption<OrderStatementRow, OrderSort>[] = [
    { value: 'date', label: 'Sana', get: row => row.createdAt },
    { value: 'price', label: 'Summa', get: row => row.price },
    { value: 'paid', label: 'To‘langan', get: row => row.paid },
    { value: 'debt', label: 'Qarz', get: row => row.debt },
  ];

  const customerRows = sortRows(customerStatements(state, range.from, range.to)
    .filter(row => admin && match(row.name)), customerOptions, customerSort);
  const supplierRows = sortRows(supplierStatements(state, range.from, range.to)
    .filter(row => admin && match(row.name)), supplierOptions, supplierSort);
  const orderRows = sortRows(orderStatements(state, range.from, range.to)
    .filter(row => admin && match(row.number, row.title, row.customer)), orderOptions, orderSort);

  const shipped = customerRows.reduce((sum, row) => sum + row.shipped, 0);
  const customerPaid = customerRows.reduce((sum, row) => sum + row.paid, 0);
  const customerDebt = customerRows.reduce((sum, row) => sum + row.debt, 0);
  const customerAdvance = customerRows.reduce((sum, row) => sum + row.advance, 0);
  const received = supplierRows.reduce((sum, row) => sum + row.receivedValue, 0);
  const outsourced = supplierRows.reduce((sum, row) => sum + row.outsourced, 0);
  const supplierPaid = supplierRows.reduce((sum, row) => sum + row.paid, 0);
  const supplierTotalDebt = supplierRows.reduce((sum, row) => sum + row.debt, 0);
  const orderTotal = orderRows.reduce((sum, row) => sum + row.price, 0);
  const orderPaid = orderRows.reduce((sum, row) => sum + row.paid, 0);
  const orderDebt = orderRows.reduce((sum, row) => sum + row.debt, 0);

  const selectedCustomer = customerRows.find(row => row.customerId === expanded);
  const selectedSupplier = supplierRows.find(row => row.supplierId === expanded);

  const changeKind = (next: PeriodKind) => {
    setKind(next);
    setPeriod(periodKey(new Date().toISOString(), next));
    setExpanded(null);
  };
  const changeTab = (next: Tab) => { setTab(next); setExpanded(null); };

  const title = 'Kim, qancha va qachon.';
  const hint = 'Tanlangan davr uchun mijozlar, ta’minotchilar va buyurtmalar hisob-kitobi. Hisob — yuborilgan yoki qabul qilingan summa, to‘langan — kassadan o‘tgan pul, qarz — hozirgi qoldiq. Qatorni oching: to‘lovlar, yuborishlar va xaridlar ko‘rinadi.';

  return <Section title={title} hint={hint} action={<div className="section-tools">
    <PeriodSwitch value={kind} onChange={changeKind} />
    <select aria-label="Hisobot davri" value={period} onChange={event => { setPeriod(event.target.value); setExpanded(null); }}>
      <option value="all">Barcha davrlar</option>
      {keys.map(key => <option key={key} value={key}>{periodLabel(key, kind)}</option>)}
    </select>
  </div>}>
    {tab === 'customers' && <div className="settings-facts">
      <span>Yuborilgan<b>{money(shipped)}</b></span>
      <span>Olingan pul<b>{money(customerPaid)}</b></span>
      <span>Hozirgi qarz<b>{money(customerDebt)}</b></span>
      <span>Avanslar<b>{money(customerAdvance)}</b></span>
    </div>}
    {tab === 'suppliers' && <div className="settings-facts">
      <span>Qabul qilingan<b>{money(received)}</b></span>
      <span>Xizmatlar<b>{money(outsourced)}</b></span>
      <span>To‘langan<b>{money(supplierPaid)}</b></span>
      <span>Hozirgi qarz<b>{money(supplierTotalDebt)}</b></span>
    </div>}
    {tab === 'orders' && <div className="settings-facts">
      <span>Buyurtmalar<b>{orderRows.length}</b></span>
      <span>Summa<b>{money(orderTotal)}</b></span>
      <span>To‘langan<b>{money(orderPaid)}</b></span>
      <span>Qarz<b>{money(orderDebt)}</b></span>
    </div>}

    <div className="filter-bar">
      {admin && <div className="segmented tight" aria-label="Hisobot turi">
        {tabs.map(item => <button key={item.id} type="button" className={tab === item.id ? 'selected' : ''} onClick={() => changeTab(item.id)}>{item.label}</button>)}
      </div>}
      {tab === 'customers' && <SortSelect value={customerSort} onChange={setCustomerSort} options={customerOptions} />}
      {tab === 'suppliers' && <SortSelect value={supplierSort} onChange={setSupplierSort} options={supplierOptions} />}
      {tab === 'orders' && <SortSelect value={orderSort} onChange={setOrderSort} options={orderOptions} />}
    </div>

    {tab === 'customers' && <>
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Mijoz</th><th className="right">Buyurtmalar</th><th className="right">Yuborilgan</th><th className="right">To‘langan</th><th className="right">Qarz</th><th>Oxirgi to‘lov</th><th /></tr></thead>
        <tbody>{customerRows.map(row => <tr key={row.customerId}>
          <td data-label="Mijoz"><button className="row-link" onClick={() => setExpanded(expanded === row.customerId ? null : row.customerId)}>{row.name}</button><small>{customerKindLabel(row.kind)}{row.employeeId ? ' · Xodim' : ''}</small></td>
          <td data-label="Buyurtmalar" className="right">{row.orders}</td>
          <td data-label="Yuborilgan" className="right">{money(row.shipped)}</td>
          <td data-label="To‘langan" className="right positive">{money(row.paid)}</td>
          <td data-label="Qarz" className="right"><b className={row.debt > 0 ? 'debt' : ''}>{money(row.debt)}</b>{row.advance > 0 && <small>avans {money(row.advance)}</small>}</td>
          <td data-label="Oxirgi to‘lov">{row.lastPaidAt ? dateTime(row.lastPaidAt) : '—'}</td>
          <td data-label="Batafsil"><button className="icon-button" aria-label={`${row.name} batafsil`} onClick={() => setExpanded(expanded === row.customerId ? null : row.customerId)}><ChevronRight size={16} style={{ transform: expanded === row.customerId ? 'rotate(90deg)' : undefined }} /></button></td>
        </tr>)}</tbody>
      </table></div>
      {!customerRows.length && <Empty text="Bu davrda mijozlar harakati yo‘q" />}
      {selectedCustomer && <div className="statement-detail">
        <div className="statement-head"><h4>{selectedCustomer.name} · {periodLabel(period, kind)}</h4>{onOpenCustomer && <button className="secondary small" onClick={() => onOpenCustomer(selectedCustomer.customerId)}>To‘liq karta</button>}</div>
        <div><h4>To‘lovlar</h4><Payments rows={selectedCustomer.payments} empty="Bu davrda to‘lov yo‘q" /></div>
        <div><h4>Yuborishlar</h4>
          {selectedCustomer.shipments.length ? <div className="table-scroll cardable"><table>
            <thead><tr><th>Sana / vaqt</th><th>Buyurtma</th><th className="right">Miqdor</th><th className="right">Summa</th><th>Holat</th></tr></thead>
            <tbody>{selectedCustomer.shipments.map(row => <tr key={row.id}>
              <td data-label="Sana / vaqt">{dateTime(row.date)}</td><td data-label="Buyurtma"><b>{row.orderNumber}</b><small>{row.title}</small></td>
              <td data-label="Miqdor" className="right">{row.qty}</td><td data-label="Summa" className="right">{money(row.amount)}</td>
              <td data-label="Holat">{row.status === 'delivered' ? 'Yetkazilgan' : 'Yo‘lda'}</td>
            </tr>)}</tbody>
          </table></div> : <Empty text="Bu davrda yuborish yo‘q" />}
        </div>
      </div>}
    </>}

    {tab === 'suppliers' && <>
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Ta’minotchi</th><th className="right">Xaridlar</th><th className="right">Qabul qilingan</th><th className="right">Xizmatlar</th><th className="right">To‘langan</th><th className="right">Qarz</th><th>Oxirgi to‘lov</th><th /></tr></thead>
        <tbody>{supplierRows.map(row => <tr key={row.supplierId}>
          <td data-label="Ta’minotchi"><button className="row-link" onClick={() => setExpanded(expanded === row.supplierId ? null : row.supplierId)}>{row.name}</button></td>
          <td data-label="Xaridlar" className="right">{row.purchases}</td>
          <td data-label="Qabul qilingan" className="right">{money(row.receivedValue)}</td>
          <td data-label="Xizmatlar" className="right">{money(row.outsourced)}</td>
          <td data-label="To‘langan" className="right positive">{money(row.paid)}</td>
          <td data-label="Qarz" className="right"><b className={row.debt > 0 ? 'debt' : ''}>{money(row.debt)}</b></td>
          <td data-label="Oxirgi to‘lov">{row.lastPaidAt ? dateTime(row.lastPaidAt) : '—'}</td>
          <td data-label="Batafsil"><button className="icon-button" aria-label={`${row.name} batafsil`} onClick={() => setExpanded(expanded === row.supplierId ? null : row.supplierId)}><ChevronRight size={16} style={{ transform: expanded === row.supplierId ? 'rotate(90deg)' : undefined }} /></button></td>
        </tr>)}</tbody>
      </table></div>
      {!supplierRows.length && <Empty text="Bu davrda ta’minotchilar harakati yo‘q" />}
      {selectedSupplier && <div className="statement-detail">
        <div><h4>To‘lovlar · {periodLabel(period, kind)}</h4><Payments rows={selectedSupplier.payments} empty="Bu davrda to‘lov yo‘q" /></div>
        <div><h4>Xaridlar · {periodLabel(period, kind)}</h4>
          {selectedSupplier.purchaseRows.length ? <div className="table-scroll cardable"><table>
            <thead><tr><th>Sana / vaqt</th><th>Xarid</th><th className="right">Summa</th><th className="right">Qabul qilingan</th></tr></thead>
            <tbody>{selectedSupplier.purchaseRows.map(row => <tr key={row.id}>
              <td data-label="Sana / vaqt">{dateTime(row.date)}</td><td data-label="Xarid"><b>{row.number}</b></td>
              <td data-label="Summa" className="right">{money(row.value)}</td><td data-label="Qabul qilingan" className="right">{money(row.receivedValue)}</td>
            </tr>)}</tbody>
          </table></div> : <Empty text="Bu davrda xarid yo‘q" />}
        </div>
      </div>}
    </>}

    {tab === 'orders' && <>
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Buyurtma</th><th>Mijoz</th><th>Holat</th><th className="right">Summa</th><th className="right">To‘langan</th><th className="right">Qarz</th><th>Sana / vaqt</th></tr></thead>
        <tbody>{orderRows.map(row => <tr key={row.orderId}>
          <td data-label="Buyurtma"><b>{row.number}</b><small>{row.title}</small></td>
          <td data-label="Mijoz">{row.customer}</td>
          <td data-label="Holat">{statusLabel(row.status)}<small>{row.kind === 'service' ? 'Xizmat' : 'Mebel'}</small></td>
          <td data-label="Summa" className="right">{money(row.price)}</td>
          <td data-label="To‘langan" className="right positive">{money(row.paid)}</td>
          <td data-label="Qarz" className="right"><b className={row.debt > 0 ? 'debt' : ''}>{money(row.debt)}</b></td>
          <td data-label="Sana / vaqt">{dateTime(row.createdAt)}</td>
        </tr>)}</tbody>
      </table></div>
      {!orderRows.length && <Empty text="Bu davrda buyurtmalar yo‘q" />}
    </>}
  </Section>;
}
