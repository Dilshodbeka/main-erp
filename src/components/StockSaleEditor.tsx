import { useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { reservedQty, stockQty } from '../domain';
import { buildStockSaleInput } from '../sales';
import { Dialog, errorText, Field, money, num } from '../ui';
import type { Command, State } from '../types';

interface LineDraft { itemId: string; qty: number }

export function StockSaleEditor({ state, close, save, busy }: { state: State; close: () => void; save: (command: Command) => Promise<void>; busy: boolean }) {
  const shops = state.customers.filter(customer => customer.kind === 'shop');
  const finished = state.items.filter(item => item.kind === 'finished' && !item.customerId);
  const [customerId, setCustomerId] = useState(shops[0]?.id || '');
  const [lines, setLines] = useState<LineDraft[]>([{ itemId: finished[0]?.id || '', qty: 1 }]);
  const [error, setError] = useState('');
  const itemOf = (id: string) => state.items.find(item => item.id === id);
  const free = (id: string) => stockQty(state, id) - reservedQty(state, id);
  const total = lines.reduce((sum, line) => sum + line.qty * (itemOf(line.itemId)?.salePrice || 0), 0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      void save(buildStockSaleInput(state, customerId, lines.filter(line => line.itemId && line.qty > 0)));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return <Dialog title="Ombordan do‘konga yuborish" subtitle="Ombordagi tayyor mahsulot. Narx katalogdan olinadi va yuborishda qotib qoladi." close={() => { if (!busy) close(); }} wide>
    <form onSubmit={submit}>
      <div className="form-body">
        <Field label="Do‘kon">
          <select value={customerId} onChange={e => setCustomerId(e.target.value)} required>
            <option value="">Do‘konni tanlang</option>
            {shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
          </select>
        </Field>
        <div className="form-section-title">
          <div><h3>Tayyor mahsulot</h3><small>Ombordagi bo‘sh qoldiq va katalogdagi sotish narxi</small></div>
          <button type="button" className="secondary small" onClick={() => setLines([...lines, { itemId: '', qty: 1 }])}><Plus size={14} />Qator</button>
        </div>
        {lines.map((line, index) => <div className="stock-editor" key={index}>
          <select aria-label={`Yuborish pozitsiyasi ${index + 1}`} required value={line.itemId} onChange={e => setLines(lines.map((row, i) => i === index ? { ...row, itemId: e.target.value } : row))}>
            <option value="">Tayyor mahsulotni tanlang</option>
            {finished.map(item => <option key={item.id} value={item.id}>{item.name} · bo‘sh {num(free(item.id))} {item.unit}</option>)}
          </select>
          <input aria-label={`Miqdor ${index + 1}`} type="number" min="0.001" step="0.001" value={line.qty} required onChange={e => setLines(lines.map((row, i) => i === index ? { ...row, qty: Number(e.target.value) } : row))} />
          <small className="stock-price">{line.itemId ? `${money(itemOf(line.itemId)?.salePrice || 0)} / ${itemOf(line.itemId)?.unit}` : 'Narx — katalogdan'}</small>
          <button type="button" className="icon-button" aria-label={`Pozitsiyani olib tashlash ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, i) => i !== index))}><X size={17} /></button>
        </div>)}
        {!finished.length && <p className="subtle-note">Avval seriya yoki katalogda tayyor mahsulot chiqaring.</p>}
        <div className="payment-due"><small>Katalog narxlari bo‘yicha yuborish</small><strong>{money(total)}</strong></div>
        <div className="info-note">Yuborish qarzga ruxsat bilan rasmiylashtiriladi: do‘kon keyin to‘laydi, to‘lov FIFO bo‘yicha avvalgi yuborishlarni yopadi. Narxni qo‘lda o‘zgartirib bo‘lmaydi.</div>
        {error && <div className="warning">{error}</div>}
      </div>
      <footer className="form-footer"><button type="button" className="secondary" onClick={() => { if (!busy) close(); }} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy || !shops.length || !finished.length}>{busy ? 'Yuborilmoqda…' : 'Do‘konga yuborish'}</button></footer>
    </form>
  </Dialog>;
}
