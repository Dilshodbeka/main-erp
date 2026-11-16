import { lineMaterials, lineRoute, shippedForLine } from '../domain';
import { positionCost } from '../order-editor';
import { executorLabel, stageCostText } from '../work-view';
import { Badge, money, num } from '../ui';
import type { Order, State } from '../types';

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function OrderPositions({ state, order, busy, onIssue, onShip, onCancel }: {
  state: State;
  order: Order;
  busy: boolean;
  onIssue: (lineId: string) => void;
  onShip: (lineId: string) => void;
  onCancel: (lineId: string) => void;
}) {
  return <div className="position-cards">{order.lines.map((line, index) => {
    const materials = lineMaterials(order, line.id);
    const tasks = lineRoute(order, line.id);
    const shipped = shippedForLine(state, order, line);
    const remaining = round(line.qty - shipped);
    const unissued = materials.some(row => row.issuedQty < row.qty);
    const shippable = (line.status === 'ready' || line.status === 'shipped') && remaining > 0;
    return <article className={`position-card ${line.status === 'cancelled' ? 'cancelled' : ''}`} key={line.id}>
      <header>
        <div><b>{index + 1}. {line.title}</b><small>{line.kind === 'service' ? 'Xizmat' : 'Mebel / mahsulot'} · {num(line.qty)} × {money(line.qty ? round(line.total / line.qty) : line.total)} = <em>{money(line.total)}</em></small></div>
        <Badge status={line.status} />
      </header>
      {line.status !== 'cancelled' && materials.map(row => {
        const item = state.items.find(row2 => row2.id === row.itemId);
        return <div className="position-row" key={row.id}><span>{item?.name}<em>{item?.customerId ? ' · mijozniki, qiymat 0' : ` · ${money(row.estimatedCost)} / dona`}</em></span><b>{num(row.qty)} {item?.unit}<em>{row.issuedQty >= row.qty ? ' · berilgan' : row.issuedQty > 0 ? ` · qisman berilgan · ${num(row.issuedQty)} / ${num(row.qty)}` : order.status === 'production' ? ' · band' : ' · berilmagan'}</em></b></div>;
      })}
      {line.status !== 'cancelled' && tasks.map((task, i) => <div className="position-row" key={task.id}><span>{i + 1}. {task.name} · {executorLabel(state, task)} · {stageCostText(state, task)}</span><b>{num(task.completed)} / {num(task.planned)}</b></div>)}
      {line.status !== 'cancelled' && (materials.length > 0 || tasks.length > 0) && (() => { const cost = positionCost(order, line); return <div className="position-cost">
        <small>Materiallar {money(cost.material)} · Ishlar {money(cost.labor)}</small>
        <b>Reja tannarxi {money(cost.total)}</b>
        <em className={cost.margin < 0 ? 'debt' : 'positive'}>Marja {money(cost.margin)}</em>
      </div>; })()}
      {line.status === 'cancelled' && <small className="subtle-note">Bu pozitsiya bekor qilingan: materiallari omborga qaytgan, summasi buyurtmadan olingan.</small>}
      {order.kind !== 'series' && <div className="position-actions">
        {order.status === 'production' && line.status === 'production' && unissued && <button className="secondary small" disabled={busy} onClick={() => onIssue(line.id)}>Materiallarni berish</button>}
        {shippable && <button className="primary small" disabled={busy} onClick={() => onShip(line.id)}>Yuborish · {num(remaining)}</button>}
        {['draft', 'production', 'ready'].includes(line.status) && shipped === 0 && <button className="text-button danger-text" disabled={busy} onClick={() => onCancel(line.id)}>Pozitsiyani bekor qilish</button>}
      </div>}
    </article>;
  })}</div>;
}
