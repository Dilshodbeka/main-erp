import { useState } from 'react';
import { Check, Clock, Play, Send } from 'lucide-react';
import { Dialog, Empty, Field, date, dateTime, num } from '../ui';
import { assemblyMaterials, boardTaskLabel, unitLabel, workHistoryRows, workTaskRows, type WorkHistoryRow, type WorkTaskRow } from '../work-view';
import { materialGroups } from '../order-editor';
import { MaterialPicker } from './MaterialPicker';
import type { Actor, Command, State } from '../types';

const reviewLabels: Record<WorkHistoryRow['status'], string> = {
  submitted: 'Tekshiruvda',
  accepted: 'Qabul qilingan',
  rejected: 'Brak',
};

const blockLabels: Record<NonNullable<WorkTaskRow['blockReason']>, string> = {
  materials: 'Ochiq emas: egasi materiallarni berishi kerak',
  'previous-stage': 'Ochiq emas: avvalgi bosqichni yakunlang',
  other: 'Ochiq emas: administrator tekshirishi kerak',
};

export function AssemblyComplete({ state, orderId, taskId, busy, close, save }: {
  state: State; orderId: string; taskId: string; busy: boolean; close: () => void; save: (command: Command) => Promise<boolean>;
}) {
  const order = state.orders.find(row => row.id === orderId);
  const task = order?.route.find(row => row.id === taskId);
  const rows = assemblyMaterials(state, orderId, taskId);
  const taken = rows.map(row => row.itemId);
  const [actual, setActual] = useState<Record<string, number>>(() => Object.fromEntries(rows.map(row => [row.id, row.norm])));
  const [picked, setPicked] = useState<Record<string, string>>(() => Object.fromEntries(rows.map(row => [row.id, row.itemId])));
  const [output, setOutput] = useState<'client' | 'stock'>('client');
  const finished = state.items.filter(item => item.customerId === null && item.kind === 'finished');
  const [outputItemId, setOutputItemId] = useState(order?.outputItemId ?? '');
  if (!order || !task) return null;
  const blocked = output === 'stock' && !order.outputItemId && !outputItemId;
  const qtyOf = (rowId: string) => actual[rowId] ?? 0;
  const submit = async () => {
    const done = await save({
      type: 'assembly.complete', orderId, taskId, output,
      materials: rows.map(row => ({
        id: row.id, qty: qtyOf(row.id),
        ...(picked[row.id] && picked[row.id] !== row.itemId ? { itemId: picked[row.id] } : {}),
      })),
      ...(output === 'stock' && !order.outputItemId && outputItemId ? { outputItemId } : {}),
    });
    if (done) close();
  };
  return <Dialog title="Tayyor" subtitle={`${order.number} · ${task.name} · haqiqiy sarf va chiqarishni tasdiqlang`} close={() => { if (!busy) close(); }} wide>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="form-body">
        <h3>Haqiqiy sarf</h3>
        <p className="subtle-note">Miqdor norma bo‘yicha to‘ldirilgan. Haqiqiy sarfni tuzating — ombor shunga moslanadi.</p>
        {rows.map(row => <div className="assembly-material" key={row.id}>
          <MaterialPicker groups={materialGroups(state, order.customerId, picked[row.id], taken)}
            value={picked[row.id] ?? ''} onChange={itemId => setPicked(current => ({ ...current, [row.id]: itemId }))}
            label={`${row.name} — almashtirish`} qty={qtyOf(row.id)} />
          <Field label={`Sarf, ${row.unit || 'dona'} · norma ${num(row.norm)}`}>
            <input type="number" min="0" step="0.001" value={actual[row.id] ?? ''} onChange={event => setActual(current => ({ ...current, [row.id]: Number(event.target.value) }))} />
          </Field>
        </div>)}
        <div className="assembly-output">
          <span>Chiqarish</span>
          <label><input type="radio" name="assembly-output" checked={output === 'client'} onChange={() => setOutput('client')} /> Mijozga</label>
          <label><input type="radio" name="assembly-output" checked={output === 'stock'} onChange={() => setOutput('stock')} /> Omborga</label>
        </div>
        {output === 'stock' && !order.outputItemId && (finished.length
          ? <Field label="Tayyor mahsulot"><select value={outputItemId} onChange={event => setOutputItemId(event.target.value)}><option value="">Tanlang…</option>{finished.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          : <p className="info-note">Tayyor mahsulot kartasi yo‘q. Avval Ombor bo‘limida yaratib oling.</p>)}
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button>
        <button className="primary" disabled={busy || blocked}>{busy ? 'Saqlanmoqda…' : 'Tayyor'}</button>
      </footer>
    </form>
  </Dialog>;
}

export function WorkTasks({ state, actor, busy, run }: {
  state: State; actor: Actor; busy: boolean; run: (command: Command) => Promise<boolean>;
}) {
  const tasks = workTaskRows(state, actor);
  const history = workHistoryRows(state, actor);
  const [target, setTarget] = useState<WorkTaskRow | null>(null);
  const [assembly, setAssembly] = useState<WorkTaskRow | null>(null);
  const [qty, setQty] = useState(0);
  const [note, setNote] = useState('');
  const open = (row: WorkTaskRow) => { setTarget(row); setQty(Math.max(0, row.planned - row.completed)); setNote(''); };
  const submit = async () => {
    if (!target) return;
    const done = await run({ type: 'work.submit', orderId: target.orderId, taskId: target.taskId, qty, note });
    if (done) setTarget(null);
  };

  return <>
    <div className="work-grid">
      {tasks.map(row => {
        const remaining = Math.max(0, row.planned - row.completed);
        return <article className="production-card work-card" key={row.taskId}>
          <header>
            <div><span className="eyebrow">{row.number} / BOSQICH</span><h2>{row.operationName}</h2><small>{row.title} · muddat {date(row.dueDate)}</small></div>
            <span className={`task-status ${row.status}`}>{boardTaskLabel(row.status)}</span>
          </header>
          <div className="work-card-body">
            <div className="work-numbers">
              <div><small>Reja</small><b>{num(row.planned)} {unitLabel(row.unit)}</b></div>
              <div><small>Qabul qilindi</small><b>{num(row.completed)} {unitLabel(row.unit)}</b></div>
              <div><small>Qoldi</small><b>{num(remaining)} {unitLabel(row.unit)}</b></div>
            </div>
            <div className="progress-track"><div style={{ width: `${Math.min(100, row.planned ? row.completed / row.planned * 100 : 0)}%` }} /></div>
            {row.assembly && <p className="info-note">Haqiqiy sarf «Tayyor» tugmasida tasdiqlanadi{row.crew ? ` · brigada: ${row.crew}` : ''}.</p>}
            {!row.assembly && <p className="subtle-note">Topshirishga {num(remaining)} {unitLabel(row.unit)} qoldi. {row.autoAccept ? 'Natija topshirilgan zahoti qabul qilinadi.' : 'Natija egasi tomonidan tekshirilib qabul qilinadi.'}</p>}
            {row.defectQty > 0 && <p className="info-note">Qayta ishlash · {num(row.defectQty)} {unitLabel(row.unit)} (brak)</p>}
          </div>
          <footer className="work-actions">
            {!row.available && <span className="work-wait"><Clock size={15} />{blockLabels[row.blockReason ?? 'other']}</span>}
            {row.assembly
              ? row.available && <button className="primary" disabled={busy} onClick={() => setAssembly(row)}><Check size={16} />Tayyor</button>
              : <>
                {row.available && row.status === 'assigned' && <button className="primary" disabled={busy} onClick={() => void run({ type: 'work.accept', orderId: row.orderId, taskId: row.taskId })}><Check size={16} />Topshiriqni qabul qilish</button>}
                {row.available && row.status === 'accepted' && <button className="primary" disabled={busy} onClick={() => void run({ type: 'work.start', orderId: row.orderId, taskId: row.taskId })}><Play size={16} />Ishni boshlash</button>}
                {row.available && row.status === 'in_progress' && <button className="primary" disabled={busy} onClick={() => open(row)}><Send size={16} />Natijani topshirish</button>}
              </>}
          </footer>
        </article>;
      })}
    </div>
    {!tasks.length && <Empty text="Faol topshiriqlar yo‘q. Yangi bosqichlar buyurtma ishga tushirilib, materiallar berilgandan keyin paydo bo‘ladi." />}
    {history.length > 0 && <section className="panel work-history">
      <header className="panel-header"><div><h2>Ish tarixi</h2><p>Topshirilgan natijalar va ularning tekshiruv holati.</p></div></header>
      <div className="work-history-list">{history.map(row => <article key={`${row.orderId}:${row.taskId}:${row.createdAt}`}>
        <div><b>{row.number} · {row.operationName}</b><small>{row.title} · {dateTime(row.createdAt)}</small></div>
        <span className="muted">{num(row.qty)} {unitLabel(row.unit)}</span>
        <span className={`task-status ${row.status}`}>{reviewLabels[row.status]}</span>
      </article>)}</div>
    </section>}
    {assembly && <AssemblyComplete state={state} orderId={assembly.orderId} taskId={assembly.taskId} busy={busy} close={() => setAssembly(null)} save={async command => { const done = await run(command); if (done) setAssembly(null); return done; }} />}
    {target && <Dialog title="Natijani topshirish" subtitle={target.autoAccept ? 'Bu bosqichda natija darhol qabul qilinadi.' : 'Egasi miqdorni tekshirib ishni qabul qiladi.'} close={() => { if (!busy) setTarget(null); }}>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="form-body">
          <h3>{target.number} · {target.operationName}</h3>
          <p>{target.title}</p>
          <Field label={`Natija miqdori, ${unitLabel(target.unit)}`}>
            <input type="number" min="0.001" max={target.planned - target.completed} step="0.001" value={qty || ''} onChange={event => setQty(Number(event.target.value))} required autoFocus />
          </Field>
          <Field label="Izoh"><input maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></Field>
          <div className="info-note">{target.autoAccept ? 'Topshirilgan miqdor avtomatik qabul qilinadi.' : 'Qabul qilishni egasi amalga oshiradi.'}</div>
        </div>
        <footer className="form-footer">
          <button type="button" className="secondary" onClick={() => setTarget(null)} disabled={busy}>Bekor qilish</button>
          <button className="primary" disabled={busy || qty <= 0}>{busy ? 'Yuborilmoqda…' : target.autoAccept ? 'Topshirish va qabul qilish' : 'Qabulga yuborish'}</button>
        </footer>
      </form>
    </Dialog>}
  </>;
}
