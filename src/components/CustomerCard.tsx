import { useState } from 'react';
import { customerDetail } from '../analytics';
import { customerKindLabel } from '../customers';
import { sortRows, type SortOption, type SortState } from '../listview';
import type { OrderProfitRow } from '../history';
import { shipmentTotals } from '../sales';
import type { State } from '../types';
import { Badge, Empty, Section, dateTime, money } from '../ui';
import { SortSelect } from './SortSelect';

type CustomerOrderSort = 'date' | 'number' | 'revenue' | 'paid' | 'debt' | 'profit';

export function CustomerCard({ state, customerId, onOpenOrder, sellerName, onClaim }: {
  state: State; customerId: string; onOpenOrder: (orderId: string) => void;
  sellerName?: string | null; onClaim?: () => void;
}) {
  const detail = customerDetail(state, customerId);
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<SortState<CustomerOrderSort> | null>({ field: 'date', direction: 'desc' });
  const options: SortOption<OrderProfitRow, CustomerOrderSort>[] = [
    { value: 'date', label: 'Sana', get: row => row.date },
    { value: 'number', label: 'Raqam', get: row => row.order.number },
    { value: 'revenue', label: 'Summa', get: row => row.revenue },
    { value: 'paid', label: 'To‘langan', get: row => row.paid },
    { value: 'debt', label: 'Qarz', get: row => row.debt },
    { value: 'profit', label: 'Foyda', get: row => row.profit },
  ];
  const orders = sortRows(detail.orders.filter(row => status === 'all' || row.order.status === status), options, sort);
  const paymentRows = [
    ...detail.payments.map(row => ({ ...row, kind: 'cash' as const })),
    ...detail.deductions.map(row => ({ ...row, kind: 'deduction' as const })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return <div className="form-body">
    <div className="settings-facts">
      <span>Buyurtmalar<b>{detail.stats.orders}</b></span>
      <span>Shartnoma summasi<b>{money(detail.balance.contract)}</b></span>
      <span>O‘rtacha chek<b>{money(detail.stats.average)}</b></span>
      <span>To‘langan<b>{detail.balance.paid > 0 ? money(detail.balance.paid) : '—'}</b></span>
      <span>Qarz<b className={detail.balance.debt > 0 ? 'debt' : undefined}>{detail.balance.debt > 0 ? money(detail.balance.debt) : '—'}</b></span>
      <span>Avans<b>{detail.balance.advance > 0 ? money(detail.balance.advance) : '—'}</b></span>
      <span>Foyda<b>{money(detail.stats.profit)}</b></span>
      <span>Oxirgi buyurtma<b>{detail.stats.lastOrder ? dateTime(detail.stats.lastOrder) : '—'}</b></span>
    </div>
    <p className="subtle-note">{detail.customer.phone || 'Telefon ko‘rsatilmagan'}{detail.customer.address ? ` · ${detail.customer.address}` : ''} · {customerKindLabel(detail.customer.kind)}{detail.customer.employeeId ? ' · Xodim' : ''}</p>
    <div className="section-tools">
      <span className="subtle-note">Mas’ul sotuvchi: <b>{sellerName || 'biriktirilmagan'}</b></span>
      {onClaim && <button className="secondary small" onClick={onClaim}>Mening mijozim</button>}
    </div>
    <Section title="Mijozning barcha buyurtmalari" hint="Faol, yakunlangan va bekor qilingan buyurtmalar alohida ko‘rinadi" action={<div className="section-tools">
      <select aria-label="Mijoz buyurtmalari filtri" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="all">Barcha holatlar</option><option value="draft">Hisob-kitob</option><option value="production">Ishlab chiqarishda</option>
        <option value="ready">Tayyor</option><option value="shipped">Yuborilmoqda</option><option value="delivered">Yetkazilgan</option><option value="cancelled">Bekor qilingan</option>
      </select>
      <SortSelect value={sort} onChange={setSort} options={options} />
    </div>}>
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Buyurtma</th><th>Holat</th><th>Sana / vaqt</th><th className="right">Summa</th><th className="right">To‘langan</th><th className="right">Qarz</th><th className="right">Foyda</th></tr></thead>
        <tbody>{orders.map(row => <tr key={row.order.id}>
          <td data-label="Buyurtma"><button className="row-link" onClick={() => onOpenOrder(row.order.id)}>{row.order.number} · {row.order.title}</button></td>
          <td data-label="Holat"><Badge status={row.order.status} /></td>
          <td data-label="Sana / vaqt">{dateTime(row.date)}</td>
          <td data-label="Summa" className="right">{money(row.revenue)}</td>
          <td data-label="To‘langan" className="right">{row.paid > 0 ? money(row.paid) : '—'}</td>
          <td data-label="Qarz" className={row.debt > 0 ? 'right debt' : 'right'}>{row.debt > 0 ? money(row.debt) : '—'}</td>
          <td data-label="Foyda" className={`right ${row.profit < 0 ? 'debt' : 'positive'}`}>{money(row.profit)}</td>
        </tr>)}</tbody>
      </table></div>
      {!orders.length && <Empty text="Bu mijozda hali buyurtma yo‘q" />}
    </Section>
    <Section title="To‘lovlar tarixi" hint="Kassadagi mijoz va do‘kon to‘lovlari, qaytarishlar bilan">
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Sana / vaqt</th><th>Kategoriya</th><th>Hisob</th><th className="right">Summa</th></tr></thead>
        <tbody>{paymentRows.map(entry => entry.kind === 'deduction' ? <tr key={entry.id}>
          <td data-label="Sana / vaqt">{dateTime(entry.createdAt)}</td>
          <td data-label="Kategoriya"><b>Oylikdan ushlab qolindi</b>{entry.note && <small>{entry.note}</small>}</td>
          <td data-label="Hisob">—</td>
          <td data-label="Summa" className={`right ${entry.direction === 'refund' ? 'debt' : 'positive'}`}>{entry.direction === 'refund' ? '−' : '+'}{money(entry.amount)}</td>
        </tr> : <tr key={entry.id}>
          <td data-label="Sana / vaqt">{dateTime(entry.createdAt)}</td>
          <td data-label="Kategoriya"><b>{entry.category}</b>{entry.note && <small>{entry.note}</small>}</td>
          <td data-label="Hisob">{entry.account === 'cash' ? 'Naqd pul' : 'Bank'}</td>
          <td data-label="Summa" className={`right ${entry.direction === 'out' ? 'debt' : 'positive'}`}>{entry.direction === 'out' ? '−' : '+'}{money(entry.amount)}</td>
        </tr>)}</tbody>
      </table></div>
      {!paymentRows.length && <Empty text="To‘lovlar hali kiritilmagan" />}
    </Section>
    <Section title="Yetkazishlar" hint="Buyurtma va ombordan sotuv bo‘yicha yuborishlar">
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Sana / vaqt</th><th>Manzil</th><th>Holat</th><th className="right">Summa</th></tr></thead>
        <tbody>{detail.shipments.map(shipment => <tr key={shipment.id}>
          <td data-label="Sana / vaqt">{dateTime(shipment.deliveredAt ?? shipment.createdAt)}</td>
          <td data-label="Manzil">{shipment.address || '—'}</td>
          <td data-label="Holat">{shipment.status === 'delivered' ? 'Yetkazilgan' : shipment.status === 'cancelled' ? 'Bekor qilingan' : 'Yo‘lda'}</td>
          <td data-label="Summa" className="right">{money(shipmentTotals(shipment).revenue)}</td>
        </tr>)}</tbody>
      </table></div>
      {!detail.shipments.length && <Empty text="Yetkazishlar hali yo‘q" />}
    </Section>
  </div>;
}
