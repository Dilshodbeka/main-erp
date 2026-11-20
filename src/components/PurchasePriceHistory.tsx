import { Printer } from 'lucide-react';
import { Empty, Section, dateTime, money, num } from '../ui';
import type { State } from '../types';

export function PurchasePriceHistory({ state, onPrint }: { state: State; onPrint: (purchaseId: string) => void }) {
  const rows = state.purchases.slice().reverse().flatMap(purchase => purchase.lines
    .filter(line => line.received > 0)
    .map(line => ({ purchase, line })));
  return <Section title="Xarid narxlari tarixi" hint="Har bir qabuldan oldin va keyin yetkazib beruvchi narxi hamda o‘rtacha tannarx">
    <div className="price-history">{rows.map(({ purchase, line }) => {
      const item = state.items.find(row => row.id === line.itemId);
      const supplier = state.suppliers.find(row => row.id === purchase.supplierId);
      return <article key={line.id}>
        <div className="price-history-head">
          <b>{item?.name ?? 'Material'}</b>
          <small>{purchase.number} · {supplier?.name ?? 'Yetkazib beruvchi'} · {dateTime(purchase.createdAt)}</small>
        </div>
        <div className="price-pair"><small>Yetkazib beruvchi narxi</small><span>{money(line.previousPurchasePrice)}<i>→</i><b>{money(line.newPurchasePrice)}</b></span></div>
        <div className="price-pair"><small>O‘rtacha tannarx</small><span>{money(line.previousAverageCost)}<i>→</i><b>{money(line.newAverageCost)}</b></span></div>
        <div className="price-history-qty"><small>Qabul qilindi</small><b>{num(line.received)} {item?.unit ?? ''}</b></div>
        <button className="text-button" onClick={() => onPrint(purchase.id)}><Printer size={14} />Qabul varaqasi</button>
      </article>;
    })}</div>
    {!rows.length && <Empty text="Tarix materiallar birinchi marta qabul qilingandan keyin paydo bo‘ladi" />}
  </Section>;
}
