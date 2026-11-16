import { useState } from 'react';
import { Check, Clock, Play, Send } from 'lucide-react';
import { Dialog, Empty, Field, date, dateTime, num } from '../ui';
import { boardTaskLabel, unitLabel, workHistoryRows, workTaskRows, type WorkHistoryRow, type WorkTaskRow } from '../work-view';
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

export function WorkTasks({ state, actor, busy, run }: {
  state: State; actor: Actor; busy: boolean; run: (command: Command) => Promise<boolean>;
}) {
  const tasks = workTaskRows(state, actor);
  const history = workHistoryRows(state, actor);
  const [target, setTarget] = useState<WorkTaskRow | null>(null);
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
            <p className="subtle-note">Topshirishga {num(remaining)} {unitLabel(row.unit)} qoldi. {row.autoAccept ? 'Natija topshirilgan zahoti qabul qilinadi.' : 'Natija egasi tomonidan tekshirilib qabul qilinadi.'}</p>
            {row.defectQty > 0 && <p className="info-note">Qayta ishlash · {num(row.defectQty)} {unitLabel(row.unit)} (brak)</p>}
          </div>
          <footer className="work-actions">
            {!row.available && <span className="work-wait"><Clock size={15} />{blockLabels[row.blockReason ?? 'other']}</span>}
            {row.available && row.status === 'assigned' && <button className="primary" disabled={busy} onClick={() => void run({ type: 'work.accept', orderId: row.orderId, taskId: row.taskId })}><Check size={16} />Topshiriqni qabul qilish</button>}
            {row.available && row.status === 'accepted' && <button className="primary" disabled={busy} onClick={() => void run({ type: 'work.start', orderId: row.orderId, taskId: row.taskId })}><Play size={16} />Ishni boshlash</button>}
            {row.available && row.status === 'in_progress' && <button className="primary" disabled={busy} onClick={() => open(row)}><Send size={16} />Natijani topshirish</button>}
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
