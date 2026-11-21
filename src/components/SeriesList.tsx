import { useState } from 'react';
import { dateLocale } from '../i18n';
import { Check, Factory, Package, Plus } from 'lucide-react';
import { Badge, Empty, Section, money, num } from '../ui';
import { actualSeriesCost, estimatedCost, stockQty } from '../domain';
import { boardTaskLabel, executorLabel } from '../work-view';
import { SeriesEditor } from './SeriesEditor';
import { ShortageNotice } from './ShortageNotice';
import { orderShortage } from '../shortage';
import type { Command, Order, RouteLine, State } from '../types';

const stageClass = (task: RouteLine) => task.status === 'completed' ? 'done' : task.status === 'submitted' ? 'review' : task.status === 'assigned' ? 'wait' : 'active';

export function SeriesList({ state, busy, run, onGo }: {
  state: State; busy: boolean; run: (command: Command) => Promise<boolean>;
  onGo?: (section: string, panel?: string) => void;
}) {
  const [editor, setEditor] = useState(false);
  const series = state.orders.filter(order => order.kind === 'series').slice().reverse();
  const item = (id: string | null) => state.items.find(row => row.id === id);
  const save = async (command: Command) => { if (await run(command)) setEditor(false); };

  return <>
    <Section
      title="Ombor seriyalari"
      hint="Konveyer mijoz buyurtmalaridan alohida: CRM qarzi, mijozga yuborish va savdo kanbanisiz."
      action={<button className="primary small" disabled={!state.recipes.length} onClick={() => setEditor(true)}><Plus size={15} />Seriya</button>}
    >
      {!state.recipes.length && <Empty text="Avval zagotovka yoki tayyor mahsulot retseptini yarating" />}
      <div className="series-list">{series.map(order => <SeriesCard key={order.id} order={order} state={state} busy={busy} run={run} onGo={onGo} itemName={id => item(id)?.name ?? 'Mahsulot'} />)}</div>
      {state.recipes.length > 0 && !series.length && <Empty text="Retsept bo‘yicha birinchi ombor seriyasini ishga tushiring" />}
    </Section>
    {editor && <SeriesEditor state={state} busy={busy} close={() => { if (!busy) setEditor(false); }} save={save} />}
  </>;
}

function SeriesCard({ order, state, busy, run, onGo, itemName }: {
  order: Order; state: State; busy: boolean; run: (command: Command) => Promise<boolean>;
  itemName: (id: string | null) => string;
  onGo?: (section: string, panel?: string) => void;
}) {
  const issued = order.materials.filter(line => line.issuedQty >= line.qty).length;
  const ready = order.status === 'ready';
  const output = itemName(order.outputItemId);
  const unit = state.items.find(row => row.id === order.outputItemId)?.unit ?? 'dona';
  return <article className="production-card series-card">
    <header>
      <div>
        <span className="eyebrow">{order.number} / OMBOR SERIYASI</span>
        <h2>{order.title}</h2>
        <small>{num(order.qty)} {unit} · muddat {new Date(`${order.dueDate}T12:00:00`).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short' })} · mijozsiz</small>
      </div>
      <Badge status={order.status} />
    </header>
    <div className="series-facts">
      <span>Mahsulot<b>{output}</b></span>
      <span>Ombordagi qoldiq<b>{num(stockQty(state, order.outputItemId ?? ''))} {unit}</b></span>
      <span>Reja tannarxi<b>{money(estimatedCost(state, order))}</b></span>
      <span>Haqiqiy tannarx<b>{money(actualSeriesCost(state, order))}</b></span>
    </div>
    {order.status === 'production' && issued < order.materials.length && <div className="material-warning"><Package size={17} />Materiallar band qilindi: {order.materials.length} dan {issued} berildi<button disabled={busy} onClick={() => void run({ type: 'order.issue', orderId: order.id })}>Sehga berish</button><ShortageNotice rows={orderShortage(state, order)} onGo={onGo} /></div>}
    {ready && <div className="material-warning"><Check size={17} />Seriya qabul qilinib omborga kirim qilindi. Mijozga yuborish yaratilmaydi.</div>}
    <div className="series-material-view">{order.materials.map(line => <span key={line.id}>{itemName(line.itemId)} <b>{num(line.qty)}</b> <small>{line.issuedQty >= line.qty ? 'berilgan' : line.issuedQty > 0 ? `qisman · ${num(line.issuedQty)} / ${num(line.qty)}` : order.status === 'draft' ? 'berilmagan' : 'band'}</small></span>)}</div>
    <div className="task-list">{order.route.map((task, index) => <article className={task.completed >= task.planned ? 'task complete' : 'task'} key={task.id}>
      <div className="task-count">{task.completed >= task.planned ? <Check size={18} /> : index + 1}</div>
      <div className="task-info">
        <b>{task.name}</b>
        <small>{executorLabel(state, task)} · {money(task.rate)} / dona</small>
        <div className="progress-track"><div style={{ width: `${Math.min(100, task.completed / task.planned * 100)}%` }} /></div>
        <small>Qabul qilindi {num(task.completed)} / {num(task.planned)}</small>
      </div>
      <span className={`stage-chip ${stageClass(task)}`}>{boardTaskLabel(task.status)}</span>
    </article>)}</div>
    <footer>
      {order.status === 'draft' && <button className="primary small" disabled={busy} onClick={() => void run({ type: 'order.launch', orderId: order.id })}><Factory size={14} />Sehga ishga tushirish</button>}
      {order.status === 'draft' && <button className="text-button danger-text" onClick={() => void run({ type: 'order.cancel', orderId: order.id })}>Seriyani bekor qilish</button>}
      <small>{ready ? 'Ombordan sotishga tayyor' : order.status === 'production' ? 'Sehda ish' : 'Band qilinmagan qoralama'}</small>
    </footer>
  </article>;
}
