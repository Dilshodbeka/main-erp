import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { sortRows, type SortOption, type SortState } from '../listview';
import {
  supplierActions, supplierMaterials, supplierSummary, supplierYears,
  type SupplierActionKind, type SupplierActionRow,
} from '../supplier-card';
import type { State } from '../types';
import { Empty, Section, dateTime, money, num } from '../ui';
import { SortSelect } from './SortSelect';

type ActionSort = 'date' | 'amount';

const kindLabels: Record<SupplierActionKind, string> = {
  purchase: 'Xarid', receipt: 'Qabul', payment: 'To‘lov', service: 'Xizmat',
};

export function SupplierCard({ state, supplierId, onOpenOrder, onPay }: {
  state: State; supplierId: string; onOpenOrder: (orderId: string) => void; onPay: () => void;
}) {
  const supplier = state.suppliers.find(row => row.id === supplierId);
  const [kind, setKind] = useState('all');
  const [year, setYear] = useState('all');
  const [sort, setSort] = useState<SortState<ActionSort> | null>({ field: 'date', direction: 'desc' });
  const [selected, setSelected] = useState<string | null>(null);
  if (!supplier) return null;

  const summary = supplierSummary(state, supplierId);
  const years = supplierYears(state, supplierId);
  const actions = supplierActions(state, supplierId);
  const options: SortOption<SupplierActionRow, ActionSort>[] = [
    { value: 'date', label: 'Sana', get: row => row.date },
    { value: 'amount', label: 'Summa', get: row => Math.abs(row.amount) },
  ];
  const rows = sortRows(actions.filter(row => (kind === 'all' || row.kind === kind)
    && (year === 'all' || row.date.slice(0, 4) === year)), options, sort);
  const materials = supplierMaterials(state, supplierId);
  const material = materials.find(row => row.itemId === selected);

  return <div className="form-body">
    <div className="settings-facts">
      <span>Xaridlar<b>{summary.purchases}</b></span>
      <span>Buyurtma summasi<b>{money(summary.orderedValue)}</b></span>
      <span>Qabul qilingan<b>{money(summary.receivedValue)}</b></span>
      <span>Xizmatlar<b>{money(summary.outsourced)}</b></span>
      <span>To‘langan<b>{money(summary.paid)}</b></span>
      <span>Qarz<b>{summary.debt >= 0 ? money(summary.debt) : `Avans ${money(-summary.debt)}`}</b></span>
      <span>Oxirgi xarid<b>{summary.lastPurchaseAt ? dateTime(summary.lastPurchaseAt) : '—'}</b></span>
      <span>Oxirgi to‘lov<b>{summary.lastPaidAt ? dateTime(summary.lastPaidAt) : '—'}</b></span>
    </div>
    <div className="button-group">
      <span className="subtle-note">{supplier.phone || 'Telefon ko‘rsatilmagan'}</span>
      <button className="secondary" onClick={onPay}>To‘lov qilish</button>
    </div>
    <Section title="Yillik statistika" hint="Har bir yil bo‘yicha xaridlar, qabullar, xizmatlar va to‘lovlar">
      {years.length ? <div className="table-scroll cardable"><table>
        <thead><tr><th>Yil</th><th className="right">Xaridlar</th><th className="right">Buyurtma summasi</th><th className="right">Qabul qilingan</th><th className="right">Xizmatlar</th><th className="right">To‘langan</th></tr></thead>
        <tbody>{years.map(row => <tr key={row.year}>
          <td data-label="Yil"><b>{row.year}</b></td>
          <td data-label="Xaridlar" className="right">{row.purchases}</td>
          <td data-label="Buyurtma summasi" className="right">{money(row.orderedValue)}</td>
          <td data-label="Qabul qilingan" className="right">{money(row.receivedValue)}</td>
          <td data-label="Xizmatlar" className="right">{money(row.outsourced)}</td>
          <td data-label="To‘langan" className="right">{money(row.paid)}</td>
        </tr>)}</tbody>
      </table></div> : <Empty text="Hali statistika uchun harakat yo‘q" />}
    </Section>
    <Section title="Hamkorlik tarixi" hint="Xarid, qabul, to‘lov va autsors xizmatlari — sana va summa bilan" action={<div className="section-tools">
      <select aria-label="Harakat turi filtri" value={kind} onChange={event => setKind(event.target.value)}>
        <option value="all">Barcha harakatlar</option>
        <option value="purchase">Xaridlar</option>
        <option value="receipt">Qabullar</option>
        <option value="payment">To‘lovlar</option>
        <option value="service">Xizmatlar</option>
      </select>
      <select aria-label="Yil filtri" value={year} onChange={event => setYear(event.target.value)}>
        <option value="all">Barcha yillar</option>
        {years.map(row => <option key={row.year} value={row.year}>{row.year}</option>)}
      </select>
      <SortSelect value={sort} onChange={setSort} options={options} />
    </div>}>
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Sana / vaqt</th><th>Harakat</th><th>Izoh</th><th className="right">Summa</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td data-label="Sana / vaqt">{dateTime(row.date)}</td>
          <td data-label="Harakat"><b>{kindLabels[row.kind]}</b>{row.orderId
            ? <button className="row-link" onClick={() => onOpenOrder(row.orderId!)}>{row.title}</button>
            : <small>{row.title}</small>}</td>
          <td data-label="Izoh">{row.detail || '—'}</td>
          <td data-label="Summa" className={`right ${row.amount < 0 ? 'debt' : row.kind === 'payment' ? 'positive' : ''}`}>
            {row.amount < 0 ? `−${money(-row.amount)}` : row.kind === 'payment' ? `+${money(row.amount)}` : money(row.amount)}
          </td>
        </tr>)}</tbody>
      </table></div>
      {!rows.length && <Empty text="Bu davrda harakatlar yo‘q" />}
    </Section>
    <Section title="Yetkazib berilgan materiallar" hint="Oxirgi narx, qoldiq va material qayerda ishlatilgani">
      {materials.length ? <div className="table-scroll cardable"><table>
        <thead><tr><th>Material</th><th className="right">Oxirgi narx</th><th className="right">Qabul qilingan</th><th className="right">Qiymat</th><th className="right">Qoldiq</th><th /></tr></thead>
        <tbody>{materials.map(row => <tr key={row.itemId}>
          <td data-label="Material"><b>{row.name}</b><small>{(row.uses.length + row.recipes.length) || 'Ishlatilmagan'}</small></td>
          <td data-label="Oxirgi narx" className="right">{money(row.lastPrice)}</td>
          <td data-label="Qabul qilingan" className="right">{num(row.receivedQty)} {row.unit}</td>
          <td data-label="Qiymat" className="right">{money(row.receivedValue)}</td>
          <td data-label="Qoldiq" className="right">{num(row.stock)} {row.unit}</td>
          <td data-label="Batafsil"><button className="icon-button" aria-label={`${row.name} qayerda ishlatilgan`} onClick={() => setSelected(selected === row.itemId ? null : row.itemId)}><ChevronRight size={16} style={{ transform: selected === row.itemId ? 'rotate(90deg)' : undefined }} /></button></td>
        </tr>)}</tbody>
      </table></div> : <Empty text="Bu yetkazib beruvchida materiallar yo‘q" />}
      {material && <div className="statement-detail usage-detail">
        <div className="usage-head"><div><small>Qayerda ishlatilgan</small><b>{material.name}</b></div><span className="usage-stock">Qoldiq: <b>{num(material.stock)} {material.unit}</b></span></div>
        <div className="usage-block"><h4>Buyurtmalar</h4>
          {material.uses.length ? <div className="table-scroll cardable"><table>
            <thead><tr><th>Sana / vaqt</th><th>Buyurtma</th><th className="right">Miqdor</th></tr></thead>
            <tbody>{material.uses.map(row => <tr key={row.orderId}>
              <td data-label="Sana / vaqt">{dateTime(row.date)}</td>
              <td data-label="Buyurtma"><button className="row-link" onClick={() => onOpenOrder(row.orderId)}>{row.number} · {row.title}</button></td>
              <td data-label="Miqdor" className="right">{num(row.qty)} {material.unit}</td>
            </tr>)}</tbody>
          </table></div> : <p className="usage-empty">Hali buyurtmada ishlatilmagan</p>}
        </div>
        <div className="usage-block"><h4>Retseptlar</h4>
          {material.recipes.length ? <div className="table-scroll cardable"><table>
            <thead><tr><th>Retsept</th><th>Mahsulot</th></tr></thead>
            <tbody>{material.recipes.map(row => <tr key={row.recipeId}>
              <td data-label="Retsept">{row.name}</td>
              <td data-label="Mahsulot">{row.output}</td>
            </tr>)}</tbody>
          </table></div> : <p className="usage-empty">Retseptlarda ishlatilmagan</p>}
        </div>
      </div>}
    </Section>
  </div>;
}
