import { useState } from 'react';
import { PackageCheck, ShoppingCart } from 'lucide-react';
import { matchesQuery } from '../listview';
import { planCommand, purchasePlan, type PlanGroup, type SupplyNeed } from '../supply';
import type { Command, State } from '../types';
import { Empty, Section, date, money, num } from '../ui';

// Ta’minot: avto-xarid rejasi. Har bir yetkazib beruvchiga bitta tugma bilan xarid yaratiladi.
export function SupplyNeeds({ state, warehouseId, search, onPurchase, onCreate, busy = false }: {
  state: State;
  warehouseId: string;
  search: string;
  onPurchase: (need: SupplyNeed) => void;
  onCreate?: (commands: Command[], message: string) => Promise<boolean>;
  busy?: boolean;
}) {
  const [picked, setPicked] = useState('');
  const groups = purchasePlan(state, warehouseId)
    .map(group => ({ ...group, lines: group.lines.filter(line => matchesQuery([line.name, group.supplierName, line.orders.map(order => order.number).join(' ')], search)) }))
    .filter(group => group.lines.length > 0);
  const lines = groups.flatMap(group => group.lines);
  const ready = groups.filter(group => group.supplierId !== null);
  const supplierOf = (group: PlanGroup): string => group.supplierId ?? picked;
  const create = (list: PlanGroup[]) => onCreate?.(list.map(group => planCommand(group, supplierOf(group), warehouseId)),
    list.length === 1 ? 'Xarid yaratildi. Kelganda «Qabul qilish» orqali omborga kiriting.' : `${list.length} ta xarid yaratildi.`);

  return <Section title="Ta’minot ehtiyoji" hint="Buyurtmalarga yetishmayotgan va minimal qoldiqdan kam material. Allaqachon buyurtma qilingani hisobga olingan."
    action={onCreate && ready.length > 1 ? <button className="primary small" disabled={busy} onClick={() => void create(ready)}><ShoppingCart size={14} />{`Hammasini yaratish (${ready.length})`}</button> : undefined}>
    {!!lines.length && <div className="settings-facts customer-facts plan-facts"><span>Pozitsiyalar<b>{lines.length}</b></span><span>Buyurtmalar<b>{new Set(lines.flatMap(row => row.orders.map(order => order.id))).size}</b></span><span>Taxminiy summa<b>{money(groups.reduce((sum, group) => sum + group.lines.reduce((part, line) => part + line.qty * line.price, 0), 0))}</b></span></div>}
    {groups.map(group => <div className="plan-group" key={group.supplierId ?? 'none'}>
      <header>
        <div>{group.supplierId
          ? <b>{group.supplierName}</b>
          : <select aria-label="Yetkazib beruvchi" value={picked} onChange={event => setPicked(event.target.value)}><option value="">Yetkazib beruvchini tanlang…</option>{state.suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
          <small>{group.supplierId ? `${group.lines.length} ta pozitsiya` : `${group.lines.length} ta pozitsiya · bu materiallar hali xarid qilinmagan`}</small></div>
        {onCreate && <button className="primary small" disabled={busy || !supplierOf(group)} onClick={() => void create([group])}><ShoppingCart size={14} />Xarid yaratish</button>}
      </header>
      <div className="table-scroll cardable"><table className="plan-table"><thead><tr><th>Material</th><th className="right">Sotib olish</th><th>Sabab</th><th className="right">Yo‘lda</th><th className="right">Narx</th><th></th></tr></thead><tbody>
        {group.lines.map(line => <tr key={line.itemId}>
          <td data-label="Material"><b>{line.name}</b></td>
          <td data-label="Sotib olish" className="right"><b>{`${num(line.qty)} ${line.unit}`}</b></td>
          <td data-label="Sabab">{line.forOrders > 0 && <small>{`Yetishmaydi ${num(line.forOrders)} ${line.unit} · ${line.orders.map(order => `${order.number} · ${date(order.dueDate)}`).join(' · ')}`}</small>}{line.forMinimum > 0 && <small>{`Minimal qoldiq uchun ${num(line.forMinimum)} ${line.unit}`}</small>}</td>
          <td data-label="Yo‘lda" className="right">{line.onOrder > 0 ? `${num(line.onOrder)} ${line.unit}` : '—'}</td>
          <td data-label="Narx" className="right">{line.price > 0 ? money(line.price) : '—'}</td>
          <td data-label="Amallar" className="right"><button className="text-button" onClick={() => onPurchase({ itemId: line.itemId, name: line.name, unit: line.unit, warehouseId, short: line.qty, orders: line.orders, lastPurchasePrice: line.price })}>Xarid qilish</button></td>
        </tr>)}
      </tbody></table></div>
    </div>)}
    {!groups.length && <Empty text="Bu omborda ishlab chiqarish buyurtmalariga yetishmayotgan material yo‘q" action={<PackageCheck size={18} />} />}
  </Section>;
}
