import { useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import { customerKindLabel, groupCustomers, type CustomerDraft } from '../customers';
import type { Customer, Order } from '../types';

export function CustomerPicker({ customers, value, disabled, orderKind, onChange, onCreate }: {
  customers: Customer[];
  value: string;
  disabled?: boolean;
  orderKind: Order['kind'];
  onChange: (id: string) => void;
  onCreate: (draft: CustomerDraft) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<CustomerDraft>({ name: '', phone: '', address: '', kind: 'customer' });
  const selected = customers.find(customer => customer.id === value);
  const groups = groupCustomers(customers, query).map(group => ({ ...group, rows: group.rows.slice(0, 6) }));
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const startCreate = () => {
    setCreating(true);
    setError('');
    setDraft({ name: query.trim(), phone: '', address: '', kind: orderKind === 'service' ? 'service' : 'customer' });
  };
  const close = () => {
    setOpen(false);
    setCreating(false);
    setError('');
    setQuery('');
  };
  const pick = (id: string) => { onChange(id); close(); };
  const save = async () => {
    if (!draft.name.trim()) { setError('Mijoz ismini kiriting'); return; }
    setBusy(true);
    const id = await onCreate({ ...draft, name: draft.name.trim(), phone: draft.phone.trim(), address: draft.address.trim() });
    setBusy(false);
    if (!id) { setError('Mijoz saqlanmadi. Qayta urinib ko‘ring.'); return; }
    pick(id);
  };

  if (disabled) return <div className="customer-picker-static">
    <b>{selected?.name ?? 'Mijoz tanlanmagan'}</b>
    {selected && <small>{selected.phone || 'Telefon ko‘rsatilmagan'} · {customerKindLabel(selected.kind)}{selected.employeeId ? ' · Xodim' : ''}</small>}
  </div>;

  return <div className="customer-picker">
    <button type="button" className={selected ? 'customer-picker-button chosen' : 'customer-picker-button'} aria-expanded={open} aria-haspopup="dialog" onClick={() => { if (open) close(); else { setOpen(true); setQuery(''); setCreating(false); } }}>
      {selected ? <><span><b>{selected.name}</b><small>{selected.phone || 'Telefon ko‘rsatilmagan'} · {customerKindLabel(selected.kind)}{selected.employeeId ? ' · Xodim' : ''}</small></span><em>O‘zgartirish</em></> : <><span>Mijozni tanlang</span><small>Ism yoki telefonning oxirgi raqamlari</small></>}
    </button>
    {open && <div className="customer-picker-panel" role="dialog" aria-label="Mijozni tanlash">
      {!creating ? <>
        <div className="customer-picker-search"><Search size={15} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Ism yoki telefon: 2–4 raqam" aria-label="Mijoz qidiruvi" /><button type="button" className="icon-button" onClick={close} aria-label="Yopish"><X size={15} /></button></div>
        <div className="customer-picker-list">
          {groups.map(group => <section key={group.kind}>
            <h4>{group.title}<span>{group.rows.length}</span></h4>
            {group.rows.map(customer => <button type="button" key={customer.id} className="customer-option" onClick={() => pick(customer.id)}>
              <span><b>{customer.name}</b><small>{customer.phone || 'Telefon ko‘rsatilmagan'}</small></span>
              <small>{customerKindLabel(customer.kind)}{customer.employeeId ? ' · Xodim' : ''}</small>
              {customer.id === value && <Check size={15} />}
            </button>)}
          </section>)}
          {!total && <p className="subtle-note">Hech narsa topilmadi. Pastdan yangi mijoz yarating.</p>}
        </div>
        <button type="button" className="secondary full" onClick={startCreate}><Plus size={15} />{query.trim() ? `Yangi mijoz: ${query.trim()}` : 'Yangi mijoz'}</button>
      </> : <div className="customer-create">
        <div className="customer-create-head"><b>Yangi mijoz</b><button type="button" className="icon-button" onClick={() => setCreating(false)} aria-label="Bekor qilish"><X size={15} /></button></div>
        <input autoFocus value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="Ism / nom" maxLength={200} aria-label="Yangi mijoz ismi" />
        <input value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} placeholder="Telefon" type="tel" maxLength={60} aria-label="Yangi mijoz telefoni" />
        <select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as CustomerDraft['kind'] })} aria-label="Yangi mijoz turi">
          <option value="customer">Mijoz</option>
          <option value="shop">Do‘kon</option>
          <option value="service">Xizmat buyurtmachisi</option>
        </select>
        <input value={draft.address} onChange={event => setDraft({ ...draft, address: event.target.value })} placeholder="Manzil (majburiy emas)" maxLength={500} aria-label="Yangi mijoz manzili" />
        {error && <div className="warning">{error}</div>}
        <div className="customer-create-actions"><button type="button" className="secondary" onClick={() => setCreating(false)} disabled={busy}>Bekor</button><button type="button" className="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Saqlash va tanlash'}</button></div>
      </div>}
    </div>}
  </div>;
}
