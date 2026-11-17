import { useState } from 'react';
import { stockQty, reservedQty } from '../domain';
import { Dialog, Field, money, num } from '../ui';
import type { Command, State, Warehouse } from '../types';

export function WarehouseSelect({ warehouses, value, onChange, disabled, label = 'Ombor' }: {
  warehouses: Warehouse[]; value: string; onChange: (id: string) => void; disabled?: boolean; label?: string;
}) {
  const options = warehouses.filter(row => row.active || row.id === value);
  if (options.length <= 1) return null;
  return <label className="warehouse-select"><span>{label}</span>
    <select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {options.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select>
  </label>;
}

export function WarehouseTransfer({ state, itemId, fromId, toId, qty, close, save, busy }: {
  state: State; itemId: string; fromId: string; toId?: string; qty?: number;
  close: () => void; save: (command: Command) => Promise<void>; busy: boolean;
}) {
  const item = state.items.find(row => row.id === itemId);
  const active = state.warehouses.filter(row => row.active);
  const [from, setFrom] = useState(fromId);
  const [to, setTo] = useState(toId && toId !== fromId ? toId : active.find(row => row.id !== fromId)?.id ?? '');
  const [amount, setAmount] = useState(qty ?? 0);
  const [note, setNote] = useState('Omborlar orasida ko‘chirish');
  const [error, setError] = useState('');
  const free = stockQty(state, itemId, from) - reservedQty(state, itemId, from);
  const pickFrom = (id: string) => { setFrom(id); if (id === to) setTo(active.find(row => row.id !== id)?.id ?? ''); };
  return <Dialog title="Ombordan omborga ko‘chirish" subtitle="Ikki ombor orasida qoldiq harakati: manbadan chiqim, qabul qiluvchiga kirim." close={() => { if (!busy) close(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      if (from === to || !to) { setError('Ikki xil omborni tanlang.'); return; }
      if (amount <= 0) { setError('Miqdor noldan katta bo‘lishi kerak.'); return; }
      if (amount > free) { setError(`Manbada bo‘sh qoldiq ${num(free)} ${item?.unit ?? ''}.`); return; }
      void save({ type: 'warehouse.transfer', itemId, fromId: from, toId: to, qty: amount, note: note.trim() });
    }}>
      <div className="form-body">
        <div className="settings-facts"><span>Pozitsiya<b>{item?.name ?? '—'}</b></span><span>Manbada bo‘sh<b>{num(free)} {item?.unit ?? ''}</b></span>{item && <span>Tannarx<b>{money(item.cost)}</b></span>}</div>
        <div className="form-grid">
          <Field label="Qayerdan"><select value={from} disabled={busy} onChange={event => pickFrom(event.target.value)}>{active.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
          <Field label="Qayerga"><select value={to} disabled={busy} onChange={event => setTo(event.target.value)}>{active.filter(row => row.id !== from).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
        </div>
        <Field label={`Miqdor, ${item?.unit ?? ''}`}><input type="number" min="0.001" step="0.001" value={amount || ''} onChange={event => setAmount(Number(event.target.value))} required autoFocus /></Field>
        <Field label="Izoh"><input value={note} maxLength={500} onChange={event => setNote(event.target.value)} /></Field>
        {error && <div className="warning">{error}</div>}
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button>
        <button className="primary" disabled={busy}>{busy ? 'Ko‘chirilmoqda…' : 'Ko‘chirish'}</button>
      </footer>
    </form>
  </Dialog>;
}
