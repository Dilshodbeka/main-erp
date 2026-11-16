import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Account, Command } from '../types';
import { Field, money } from '../ui';

interface ExpenseRow { id: number; category: string; amount: string; note: string }

export function BulkCashForm({ busy, close, save }: {
  busy: boolean; close: () => void; save: (commands: Command[]) => Promise<void>;
}) {
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [account, setAccount] = useState<Account>('cash');
  const [rows, setRows] = useState<ExpenseRow[]>([{ id: 1, category: '', amount: '', note: '' }]);
  const [error, setError] = useState('');
  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  const patch = (id: number, change: Partial<ExpenseRow>) => setRows(current => current.map(row => row.id === id ? { ...row, ...change } : row));

  return <form onSubmit={event => {
    event.preventDefault();
    const commands: Command[] = rows
      .filter(row => row.category.trim() || row.amount)
      .map(row => ({
        type: 'cash.post' as const, direction, amount: Number(row.amount), account,
        toAccount: null, category: row.category.trim(), note: row.note.trim(),
      }));
    if (!commands.length) { setError('Kamida bitta yozuvni to‘ldiring'); return; }
    if (commands.some(command => command.type === 'cash.post' && (!command.category || !Number.isFinite(command.amount) || command.amount <= 0))) {
      setError('Har bir satrda kategoriya va musbat summa bo‘lishi kerak'); return;
    }
    void save(commands);
  }}>
    <div className="form-body">
      <p className="subtle-note">Bir nechta xarajatni bitta formada kiriting: har satr alohida provodka bo‘lib saqlanadi, keyin kunlik/haftalik/oylik hisobga tushadi.</p>
      <div className="form-grid">
        <Field label="Yo‘nalish"><select value={direction} onChange={event => setDirection(event.target.value as 'in' | 'out')}><option value="out">Chiqim (xarajat)</option><option value="in">Kirim</option></select></Field>
        <Field label="Hisob"><select value={account} onChange={event => setAccount(event.target.value as Account)}><option value="cash">Naqd pul</option><option value="bank">Bank / karta</option></select></Field>
      </div>
      {rows.map((row, index) => <div className="bulk-cash-row" key={row.id}>
        <Field label={`Kategoriya ${index + 1}`}><input value={row.category} placeholder="Arenda, kommunal, oziq-ovqat…" maxLength={120} onChange={event => patch(row.id, { category: event.target.value })} required /></Field>
        <Field label="Summa, UZS"><input type="number" min="0.01" step="0.01" value={row.amount} onChange={event => patch(row.id, { amount: event.target.value })} required /></Field>
        <Field label="Izoh"><input value={row.note} maxLength={500} onChange={event => patch(row.id, { note: event.target.value })} /></Field>
        <button type="button" className="icon-button" aria-label={`Satrni olib tashlash ${index + 1}`} disabled={rows.length === 1} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}><Trash2 size={16} /></button>
      </div>)}
      <button type="button" className="secondary" onClick={() => setRows(current => [...current, { id: Math.max(...current.map(row => row.id)) + 1, category: '', amount: '', note: '' }])}><Plus size={16} />Yana xarajat</button>
      <p><b>Jami: {money(total)}</b></p>
      {error && <div className="warning">{error}</div>}
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : `${rows.length} ta provodkani saqlash`}</button></footer>
  </form>;
}
