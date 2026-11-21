import { useState } from 'react';
import { defectMaterials } from '../domain';
import { defectReasonLabel } from '../i18n';
import { Dialog, Field, money, num } from '../ui';
import { executorLabel, taskUnit, unitLabel } from '../work-view';
import type { Command, DefectReason, State } from '../types';

const reasons: DefectReason[] = ['quality', 'measurement', 'drawing', 'customer', 'other'];
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function WorkReview({ state, orderId, taskId, busy, close, save }: {
  state: State; orderId: string; taskId: string; busy: boolean; close: () => void; save: (command: Command) => Promise<void>;
}) {
  const order = state.orders.find(row => row.id === orderId);
  const task = order?.route.find(row => row.id === taskId);
  const report = state.reports
    .filter(row => row.orderId === orderId && row.taskId === taskId && row.status === 'submitted')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const [defectQty, setDefectQty] = useState(0);
  const [reason, setReason] = useState<DefectReason>('quality');
  const [note, setNote] = useState('');
  if (!order || !task || !report) return null;
  const unit = taskUnit(state, task);
  const defect = Math.min(report.qty, Math.max(0, defectQty));
  const good = round2(report.qty - defect);
  const wasted = defect > 0
    ? defectMaterials(state, task, defect).reduce((sum, row) => sum + (state.items.find(item => item.id === row.itemId)?.cost ?? 0) * row.qty, 0)
    : 0;
  const cleanNote = note.trim();
  const blocked = defect > 0 && reason === 'other' && cleanNote.length === 0;
  const label = defect <= 0 ? 'Qabul qilish' : good > 0 ? `Qabul ${num(good)} · Brak ${num(defect)}` : 'Hammasi brak — qayta ishlash';
  const submit = () => {
    if (defect <= 0) return save({ type: 'work.review', reportId: report.id, accept: true });
    return save({ type: 'work.review', reportId: report.id, accept: false, defectQty: defect, reason, ...(cleanNote ? { note: cleanNote } : {}) });
  };
  return <Dialog title={`Qabul — ${task.name} · ${order.number}`} subtitle={`${order.title} · ${executorLabel(state, task)}`} close={() => { if (!busy) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="form-body">
        <div className="settings-facts">
          <span>Topshirilgan<b>{num(report.qty)} {unitLabel(unit)}</b></span>
          <span>Qolgan<b>{num(good)} {unitLabel(unit)}</b></span>
          <span>Birlik tannarxi<b>{money(task.rate)} / {unitLabel(unit)}</b></span>
          <span>Qabulda tannarxga tushadi<b>{money(round2(task.rate * good))}</b></span>
          <span>Brakda sarflangan material<b>{money(wasted)}</b></span>
        </div>
        <Field label="Brak miqdori">
          <input type="number" min="0" max={report.qty} step="0.001" value={defectQty || ''} onChange={event => setDefectQty(Number(event.target.value))} autoFocus />
        </Field>
        <Field label="Brak sababi">
          <select value={reason} onChange={event => setReason(event.target.value as DefectReason)}>{reasons.map(row => <option key={row} value={row}>{defectReasonLabel(row)}</option>)}</select>
        </Field>
        <Field label="Izoh"><input maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder={reason === 'other' ? 'Sababni yozing — majburiy' : 'Ixtiyoriy'} /></Field>
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button>
        <button className="primary" disabled={busy || blocked}>{busy ? 'Saqlanmoqda…' : label}</button>
      </footer>
    </form>
  </Dialog>;
}

// Brak qabuldan keyin aniqlanganda (avtoqabul ham): hajm xodimga qayta ishlashga qaytadi.
export function WorkDefect({ state, orderId, taskId, busy, close, save }: {
  state: State; orderId: string; taskId: string; busy: boolean; close: () => void; save: (command: Command) => Promise<void>;
}) {
  const order = state.orders.find(row => row.id === orderId);
  const task = order?.route.find(row => row.id === taskId);
  const report = state.reports
    .filter(row => row.orderId === orderId && row.taskId === taskId && row.status === 'accepted')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const [defectQty, setDefectQty] = useState(0);
  const [reason, setReason] = useState<DefectReason>('quality');
  const [note, setNote] = useState('');
  if (!order || !task || !report) return null;
  const unit = taskUnit(state, task);
  const max = Math.min(report.qty, task.completed);
  const defect = Math.min(max, Math.max(0, defectQty));
  const wasted = defect > 0
    ? defectMaterials(state, task, defect).reduce((sum, row) => sum + (state.items.find(item => item.id === row.itemId)?.cost ?? 0) * row.qty, 0)
    : 0;
  const cleanNote = note.trim();
  const blocked = defect <= 0 || (reason === 'other' && cleanNote.length === 0);
  return <Dialog title={`Brak — ${task.name} · ${order.number}`} subtitle={`${order.title} · ${executorLabel(state, task)}`} close={() => { if (!busy) close(); }}>
    <form onSubmit={event => { event.preventDefault(); if (!blocked) void save({ type: 'work.defect', reportId: report.id, defectQty: defect, reason, ...(cleanNote ? { note: cleanNote } : {}) }); }}>
      <div className="form-body">
        <div className="settings-facts">
          <span>Qabul qilingan<b>{num(task.completed)} / {num(task.planned)} {unitLabel(unit)}</b></span>
          <span>Brakdan keyin<b>{num(round2(task.completed - defect))} {unitLabel(unit)}</b></span>
          <span>Bosqich haqi kamayadi<b>{money(round2(task.rate * defect))}</b></span>
          <span>Brakda sarflangan material<b>{money(wasted)}</b></span>
        </div>
        <Field label={`Brak miqdori (ko‘pi bilan ${num(max)})`}>
          <input type="number" min="0" max={max} step="0.001" value={defectQty || ''} onChange={event => setDefectQty(Number(event.target.value))} autoFocus />
        </Field>
        <Field label="Brak sababi">
          <select value={reason} onChange={event => setReason(event.target.value as DefectReason)}>{reasons.map(row => <option key={row} value={row}>{defectReasonLabel(row)}</option>)}</select>
        </Field>
        <Field label="Izoh"><input maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder={reason === 'other' ? 'Sababni yozing — majburiy' : 'Ixtiyoriy'} /></Field>
        <p className="subtle-note">Brak hajmi xodimga qayta ishlashga qaytadi. Bosqich yana ochiladi, buyurtma «Tayyor» bo‘lsa — ishlab chiqarishga qaytadi.</p>
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button>
        <button className="primary" disabled={busy || blocked}>{busy ? 'Saqlanmoqda…' : 'Brakni yozish'}</button>
      </footer>
    </form>
  </Dialog>;
}
