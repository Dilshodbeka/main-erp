import { useState } from 'react';
import { orderPaid, shippedForLine } from '../domain';
import { dateOffset } from '../seed';
import { AccountField, Dialog, Empty, Field, money, num } from '../ui';
import type { Command, Order, OrderLine, State } from '../types';

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function lineRemaining(state: State, order: Order, line: OrderLine): number {
  return (line.status === 'ready' || line.status === 'shipped') ? round(line.qty - shippedForLine(state, order, line)) : 0;
}

export function shippableOrders(state: State): Order[] {
  return state.orders.filter(order => order.kind !== 'series'
    && ['production', 'ready', 'shipped'].includes(order.status)
    && order.lines.some(line => lineRemaining(state, order, line) > 0));
}

export function shippableLines(state: State, order: Order): OrderLine[] {
  return order.lines.filter(line => lineRemaining(state, order, line) > 0);
}

export function ShipmentEditor({ state, preset, close, save, busy }: {
  state: State;
  preset: { orderId: string; lineId?: string };
  close: () => void;
  save: (command: Command) => Promise<void>;
  busy: boolean;
}) {
  const orders = shippableOrders(state);
  const [orderId, setOrderId] = useState(preset.orderId || orders[0]?.id || '');
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const order = orders.find(row => row.id === orderId);
  const lines = order ? order.lines.filter(line => lineRemaining(state, order, line) > 0) : [];
  const qtyOf = (line: OrderLine) => qtys[line.id] ?? lineRemaining(state, order!, line);
  const total = order ? round(lines.reduce((sum, line) => sum + line.total * qtyOf(line) / line.qty, 0)) : 0;
  const debt = order ? round(order.price - orderPaid(state, order.id)) : 0;

  return <Dialog title="Yuborish / natijani topshirish" subtitle="Har pozitsiyani alohida yuborish mumkin — qolgan qismi keyinroq ham ketadi. To‘lov mijoz hisobidagi eng eski qarzni yopadi." close={() => { if (!busy) close(); }} wide>
    <form onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      if (!order) { setError('Yuboriladigan pozitsiya qolmagan buyurtmani tanlang.'); return; }
      const requested = lines.map(line => ({ lineId: line.id, qty: qtyOf(line) })).filter(row => row.qty > 0);
      if (!requested.length) { setError('Kamida bitta pozitsiya miqdorini kiriting.'); return; }
      if (preset.lineId && !requested.some(row => row.lineId === preset.lineId)) { setError('Tanlangan pozitsiya miqdori 0.'); return; }
      void save({
        type: 'shipment.create', orderId: order.id, lines: requested,
        address: String(form.get('address') || '').trim(), dueDate: String(form.get('dueDate') || ''),
        allowDebt: form.get('allowDebt') === 'on',
      });
    }}>
      <div className="form-body">
        <Field label="Buyurtma"><select value={orderId} onChange={event => { setOrderId(event.target.value); setQtys({}); setError(''); }}>
          <option value="">Buyurtmani tanlang</option>
          {orders.map(row => <option key={row.id} value={row.id}>{row.number} · {row.title} · qolgan {num(row.lines.reduce((sum, line) => sum + lineRemaining(state, row, line), 0))}</option>)}
        </select></Field>
        {!order && <Empty text="Tayyor yoki qisman yuborilgan pozitsiyali buyurtma yo‘q" />}
        {!!order && <>
          <div className="form-section-title"><div><h3>Pozitsiyalar</h3><small>Miqdor shu pozitsiyaning qolgan ishidan oshmaydi</small></div></div>
          {lines.map(line => {
            const remaining = lineRemaining(state, order, line);
            return <div className="editor-line shipment-line" key={line.id}>
              <div><b>{line.title}</b><small>{line.kind === 'service' ? 'Xizmat' : 'Mahsulot'} · {money(round(line.total / line.qty))} / dona · qolgan {num(remaining)}</small></div>
              <input aria-label={`${line.title} yuborish miqdori`} type="number" min="0" max={remaining} step="0.001" value={qtyOf(line)} onChange={event => setQtys(current => ({ ...current, [line.id]: Number(event.target.value) }))} />
              <b className="route-amount">{money(round(line.total * qtyOf(line) / line.qty))}</b>
            </div>;
          })}
          <div className="form-grid">
            <Field label="Manzil / natijani topshirish joyi"><input name="address" defaultValue={state.customers.find(customer => customer.id === order.customerId)?.address} required maxLength={500} /></Field>
            <Field label="Yetkazish sanasi"><input name="dueDate" type="date" defaultValue={dateOffset(1)} required /></Field>
          </div>
          <label className="check-field"><input name="allowDebt" type="checkbox" />Qoplanmagan qarz bilan yuborishga ruxsat beraman</label>
          <p className="subtle-note">Bu yerda pul olinmaydi. Yuborilgan summa mijoz hisobiga qarz bo‘lib yoziladi; keyingi to‘lov avval eng eski qarzni yopadi.</p>
          <div className="estimate-bar">
            <div><small>Shu yuborish summasi</small><b>{money(total)}</b></div>
            <div><small>Buyurtma bo‘yicha qolgan qarz</small><b className={debt > 0 ? 'debt' : 'positive'}>{money(debt)}</b></div>
          </div>
        </>}
        {error && <div className="warning">{error}</div>}
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button>
        <button className="primary" disabled={busy || !order}>{busy ? 'Saqlanmoqda…' : 'Yuborishni qayd etish'}</button>
      </footer>
    </form>
  </Dialog>;
}
