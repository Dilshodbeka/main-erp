import { PackageCheck, ShoppingCart } from 'lucide-react';
import { matchesQuery } from '../listview';
import { supplyNeeds, type SupplyNeed } from '../supply';
import type { State } from '../types';
import { Empty, Section, date, num } from '../ui';

export function SupplyNeeds({ state, warehouseId, search, onPurchase }: {
  state: State;
  warehouseId: string;
  search: string;
  onPurchase: (need: SupplyNeed) => void;
}) {
  const rows = supplyNeeds(state).filter(need => need.warehouseId === warehouseId
    && matchesQuery([need.name, need.orders.map(order => order.number).join(' ')], search));
  const total = rows.reduce((sum, row) => sum + row.short, 0);

  return <Section title="Ta’minot ehtiyoji" hint="Ishlab chiqarishdagi buyurtmalar uchun bu omborda yetishmayotgan material va uni yopish uchun xarid">
    {!!rows.length && <div className="settings-facts"><span>Pozitsiyalar<b>{rows.length}</b></span><span>Buyurtmalar<b>{new Set(rows.flatMap(row => row.orders.map(order => order.id))).size}</b></span><span>Jami yetishmaydi<b>{num(total)}</b></span></div>}
    <div className="mini-cards">{rows.map(need => <article key={`${need.itemId}:${need.warehouseId}`}>
      <div className="attention-icon"><ShoppingCart size={20} /></div>
      <div>
        <b>{need.name}</b>
        <small>Yetishmaydi {num(need.short)} {need.unit} · oxirgi narx {num(need.lastPurchasePrice)}</small>
        <small>{need.orders.map(order => `${order.number} · ${date(order.dueDate)}`).join(' · ')}</small>
      </div>
      <button className="primary" onClick={() => onPurchase(need)}>Xarid qilish</button>
    </article>)}</div>
    {!rows.length && <Empty text="Bu omborda ishlab chiqarish buyurtmalariga yetishmayotgan material yo‘q" action={<PackageCheck size={18} />} />}
  </Section>;
}
