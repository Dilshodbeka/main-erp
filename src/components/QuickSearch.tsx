import { useEffect, useRef, useState } from 'react';
import { ClipboardList, Search, Store, UserRound, Wrench, X } from 'lucide-react';
import { statusLabel } from '../i18n';
import { money } from '../ui';
import type { QuickSearchResult } from '../quicksearch';

export function QuickSearch({ value, onChange, result, onCustomer, onOrder }: {
  value: string;
  onChange: (value: string) => void;
  result: QuickSearchResult;
  onCustomer: (id: string) => void;
  onOrder: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, []);
  const total = result.customers.length + result.orders.length;
  const show = open && value.trim().length > 0;
  const pickCustomer = (id: string) => { setOpen(false); onCustomer(id); };
  const pickOrder = (id: string) => { setOpen(false); onOrder(id); };
  return <div className="quick-search" ref={box}>
    <label className="search"><Search size={17} /><input
      aria-label="Mijoz yoki buyurtma qidiruvi"
      placeholder="Qidirish…"
      title="Mijoz, telefon yoki buyurtma"
      value={value}
      onChange={event => { onChange(event.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)}
      onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.currentTarget.blur(); } }}
    />{value && <button type="button" className="icon-button" aria-label="Qidiruvni tozalash" onClick={() => { onChange(''); setOpen(false); }}><X size={13} /></button>}</label>
    {show && <div className="quick-results" role="listbox" aria-label="Tez topilganlar">
      {result.customers.length > 0 && <section>
        <h4>Mijozlar</h4>
        {result.customers.map(row => <button type="button" role="option" aria-selected={false} key={row.id} className="quick-row" onClick={() => pickCustomer(row.id)}>
          <span className={`quick-icon ${row.customerKind}`}>{row.customerKind === 'shop' ? <Store size={15} /> : row.customerKind === 'service' ? <Wrench size={15} /> : <UserRound size={15} />}</span>
          <span className="quick-body"><b>{row.title}</b><small>{row.meta}</small></span>
          {row.debt > 0.005 && <em className="debt">qarz {money(row.debt)}</em>}
        </button>)}
      </section>}
      {result.orders.length > 0 && <section>
        <h4>Buyurtmalar</h4>
        {result.orders.map(row => <button type="button" role="option" aria-selected={false} key={row.id} className="quick-row" onClick={() => pickOrder(row.id)}>
          <span className={`quick-icon order ${row.status}`}><ClipboardList size={15} /></span>
          <span className="quick-body"><b>{row.title}</b><small>{row.meta} · {statusLabel(row.status)}</small></span>
          {row.debt > 0.005 && <em className="debt">qarz {money(row.debt)}</em>}
        </button>)}
      </section>}
      {!total && <p className="subtle-note">Hech narsa topilmadi. Sahifadagi filtr joriy bo‘limda davom etadi.</p>}
    </div>}
  </div>;
}
