import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Dialog, Empty, Field, Section, money, num } from '../ui';
import { operationUnits, unitLabel } from '../work-view';
import { MAIN_WORKSHOP_ID } from '../workshop-default';
import { activeWorkshops, workshopName } from '../workshop-view';
import type { Command, Machine, Operation, OperationUnit, State } from '../types';

interface MachineDraft {
  id: string | null; name: string; hourlyRevenueTarget: number; active: boolean; workshopId: string;
}

interface OperationDraft {
  id: string | null; name: string; unit: OperationUnit; salePrice: number; workerRate: number;
  standardMinutes: number; machineId: string; employeeIds: string[]; active: boolean; autoAccept: boolean; workshopId: string;
}

const blankMachine = (): MachineDraft => ({ id: null, name: '', hourlyRevenueTarget: 0, active: true, workshopId: MAIN_WORKSHOP_ID });

const blankOperation = (state: State): OperationDraft => ({
  id: null, name: '', unit: 'piece', salePrice: 0, workerRate: 0, standardMinutes: 0,
  machineId: '', employeeIds: state.employees.filter(emp => emp.active).map(emp => emp.id), active: true, autoAccept: true, workshopId: MAIN_WORKSHOP_ID,
});

const machineDraft = (machine: Machine): MachineDraft => ({
  id: machine.id, name: machine.name, hourlyRevenueTarget: machine.hourlyRevenueTarget, active: machine.active, workshopId: machine.workshopId ?? MAIN_WORKSHOP_ID,
});

const operationDraft = (operation: Operation): OperationDraft => ({
  id: operation.id, name: operation.name, unit: operation.unit, salePrice: operation.salePrice,
  workerRate: operation.workerRate, standardMinutes: operation.standardMinutes,
  machineId: operation.machineId ?? '', employeeIds: [...operation.employeeIds], active: operation.active, autoAccept: operation.autoAccept,
  workshopId: operation.workshopId ?? MAIN_WORKSHOP_ID,
});

export function CatalogSettings({ state, busy, run, onAddEmployee, onEditEmployee }: {
  state: State; busy: boolean; run: (command: Command) => Promise<boolean>;
  onAddEmployee: () => void; onEditEmployee: (id: string) => void;
}) {
  const [machine, setMachine] = useState<MachineDraft | null>(null);
  const [operation, setOperation] = useState<OperationDraft | null>(null);
  const machineName = (id: string | null) => state.machines.find(row => row.id === id)?.name ?? 'Dastgohsiz';
  const workshops = activeWorkshops(state.workshops);
  const multiWorkshop = workshops.length > 1;

  const saveMachine = async () => {
    if (!machine) return;
    const command: Command = machine.id
      ? { type: 'machine.update', machineId: machine.id, name: machine.name, hourlyRevenueTarget: machine.hourlyRevenueTarget, active: machine.active, workshopId: machine.workshopId }
      : { type: 'machine.create', name: machine.name, hourlyRevenueTarget: machine.hourlyRevenueTarget, workshopId: machine.workshopId };
    if (await run(command)) setMachine(null);
  };

  const saveOperation = async () => {
    if (!operation) return;
    const body = {
      name: operation.name, unit: operation.unit, salePrice: operation.salePrice, workerRate: operation.workerRate,
      standardMinutes: operation.standardMinutes, machineId: operation.machineId || null,
      employeeIds: operation.employeeIds, active: operation.active, autoAccept: operation.autoAccept, workshopId: operation.workshopId,
    };
    const command: Command = operation.id
      ? { type: 'operation.update', operationId: operation.id, ...body }
      : { type: 'operation.create', ...body };
    if (await run(command)) setOperation(null);
  };

  return <>
    <Section
      title="Ishlab chiqarish ma’lumotnomasi"
      hint="Dastgohlar, operatsiyalar, narxlar va ruxsatlar. Buyurtmada tannarx yaratilgan paytda qotib qoladi."
      action={<div className="button-group">
        <button className="secondary small" onClick={() => setMachine(blankMachine())}><Plus size={14} />Dastgoh</button>
        <button className="secondary small" onClick={() => setOperation(blankOperation(state))}><Plus size={14} />Operatsiya</button>
      </div>}
    >
      <div className="catalog-machines">{state.machines.map(row => <article className="catalog-machine" key={row.id}>
        <header><b>{row.name}</b>{multiWorkshop && <small className="muted">{workshopName(state.workshops, row.workshopId)}</small>}<span className={`task-status ${row.active ? 'completed' : 'rejected'}`}>{row.active ? 'Faol' : 'O‘chirilgan'}</span></header>
        <strong>{money(row.hourlyRevenueTarget)}<small> soatlik maqsad</small></strong>
        <button className="text-button" onClick={() => setMachine(machineDraft(row))}><Pencil size={14} />Tahrirlash</button>
      </article>)}</div>
      {!state.machines.length && <Empty text="Mashina-soat normasi va tushum maqsadini hisobga olish uchun dastgoh qo‘shing." />}
      <div className="operation-list">{state.operations.map((row, index) => <article key={row.id}>
        <span>{String(index + 1).padStart(2, '0')}</span>
        <div className="catalog-op">
          <b>{row.name}</b>
          <small>{unitLabel(row.unit)} · norma {num(row.standardMinutes)} daq. · {machineName(row.machineId)}{multiWorkshop ? ` · ${workshopName(state.workshops, row.workshopId)}` : ''} · ruxsat {row.employeeIds.length}</small>
        </div>
        <div className="catalog-price"><b>{money(row.salePrice)}</b><small>mijozga · tannarx {money(row.workerRate)}</small></div>
        <span className={`task-status ${row.active ? 'completed' : 'rejected'}`}>{row.active ? 'Faol' : 'O‘chirilgan'}</span>
        <button className="icon-button" aria-label={`Operatsiyani tahrirlash ${row.name}`} onClick={() => setOperation(operationDraft(row))}><Pencil size={16} /></button>
      </article>)}</div>
      {!state.operations.length && <Empty text="Buyurtma marshrutlarini tuzish uchun kamida bitta operatsiya qo‘shing." />}
      <p className="panel-footnote">Ma’lumotnomani o‘zgartirish allaqachon yaratilgan buyurtmalardagi tannarxni va qabul qilingan natijalarni qayta yozmaydi.</p>
    </Section>

    <Section
      title="Xodimlar"
      hint="Ism va faollik. Nofaolga o‘tkazish ketgan sanasini yozadi va o‘sha oy maoshini kunlari bo‘yicha qisqartiradi; eski ishlar va hisob-kitoblar saqlanadi."
      action={<button className="secondary small" onClick={onAddEmployee}><Plus size={14} />Xodim</button>}
    >
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Xodim</th><th>Holat</th><th className="right">Qabul qilingan natijalar</th><th /></tr></thead>
        <tbody>{state.employees.map(emp => <tr key={emp.id}>
          <td data-label="Xodim"><b>{emp.name}</b></td>
          <td data-label="Holat"><span className={`task-status ${emp.active ? 'completed' : 'rejected'}`}>{emp.active ? 'Faol' : 'Nofaol'}</span></td>
          <td data-label="Qabul qilingan natijalar" className="right">{state.reports.filter(row => row.employeeId === emp.id && row.status === 'accepted').length}</td>
          <td data-label="Amallar"><button className="icon-button" aria-label={`${emp.name} tahrirlash`} title="Tahrirlash" onClick={() => onEditEmployee(emp.id)}><Pencil size={16} /></button></td>
        </tr>)}</tbody>
      </table></div>
      {!state.employees.length && <Empty text="Xodim qo‘shing — bosqichlar faqat tasdiqlangan xodimlarga ochiladi." />}
    </Section>

    {machine && <Dialog title={machine.id ? 'Dastgohni tahrirlash' : 'Yangi dastgoh'} subtitle="Mashina-soat tushum maqsadi uskunaning bandligini baholashga yordam beradi." close={() => { if (!busy) setMachine(null); }}>
      <form onSubmit={event => { event.preventDefault(); void saveMachine(); }}>
        <div className="form-body">
          <Field label="Dastgoh nomi"><input value={machine.name} onChange={event => setMachine({ ...machine, name: event.target.value })} required maxLength={120} autoFocus /></Field>
          <Field label="Soatlik tushum maqsadi, UZS"><input type="number" min="0" step="0.01" value={machine.hourlyRevenueTarget || ''} onChange={event => setMachine({ ...machine, hourlyRevenueTarget: Number(event.target.value) })} required /></Field>
          {multiWorkshop && <Field label="Sex"><select value={machine.workshopId} onChange={event => setMachine({ ...machine, workshopId: event.target.value })}>{workshops.map(ws => <option key={ws.id} value={ws.id}>{ws.name}</option>)}</select></Field>}
          {machine.id && <label className="check-field"><input type="checkbox" checked={machine.active} onChange={event => setMachine({ ...machine, active: event.target.checked })} />Dastgoh faol</label>}
        </div>
        <footer className="form-footer">
          <button type="button" className="secondary" onClick={() => setMachine(null)} disabled={busy}>Bekor qilish</button>
          <button className="primary" disabled={busy}>Dastgohni saqlash</button>
        </footer>
      </form>
    </Dialog>}

    {operation && <Dialog title={operation.id ? 'Operatsiyani tahrirlash' : 'Yangi operatsiya'} subtitle="O‘lchov birligi, mijoz narxi, bosqich tannarxi va ruxsat berilgan xodimlar." close={() => { if (!busy) setOperation(null); }} wide>
      <form onSubmit={event => { event.preventDefault(); void saveOperation(); }}>
        <div className="form-body">
          <div className="form-grid">
            <Field label="Operatsiya nomi"><input value={operation.name} onChange={event => setOperation({ ...operation, name: event.target.value })} required maxLength={120} autoFocus /></Field>
            <Field label="O‘lchov birligi"><select value={operation.unit} onChange={event => setOperation({ ...operation, unit: event.target.value as OperationUnit })}>{operationUnits.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
            <Field label="Mijoz uchun birlik narxi, UZS"><input type="number" min="0" step="0.01" value={operation.salePrice || ''} onChange={event => setOperation({ ...operation, salePrice: Number(event.target.value) })} required /></Field>
            <Field label="Bosqich tannarxi, UZS"><input type="number" min="0" step="0.01" value={operation.workerRate || ''} onChange={event => setOperation({ ...operation, workerRate: Number(event.target.value) })} required /></Field>
            <Field label="Vaqt normasi, daqiqa"><input type="number" min="0" step="0.1" value={operation.standardMinutes || ''} onChange={event => setOperation({ ...operation, standardMinutes: Number(event.target.value) })} required /></Field>
            <Field label="Dastgoh"><select value={operation.machineId} onChange={event => {
              const machineId = event.target.value;
              const ws = state.machines.find(row => row.id === machineId)?.workshopId;
              setOperation({ ...operation, machineId, workshopId: machineId ? (ws ?? MAIN_WORKSHOP_ID) : operation.workshopId });
            }}><option value="">Dastgohsiz</option>{state.machines.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
            {multiWorkshop && <Field label="Sex"><select value={operation.workshopId} onChange={event => setOperation({ ...operation, workshopId: event.target.value })}>{workshops.map(ws => <option key={ws.id} value={ws.id}>{ws.name}</option>)}</select></Field>}
          </div>
          <div className="form-section-title"><div><h3>Ruxsat berilgan xodimlar</h3><small>Bosqich faqat belgilangan xodimlarga ochiq</small></div></div>
          <div className="employee-picker">{state.employees.map(emp => <label key={emp.id}>
            <input type="checkbox" checked={operation.employeeIds.includes(emp.id)} onChange={event => setOperation({
              ...operation,
              employeeIds: event.target.checked
                ? [...operation.employeeIds, emp.id]
                : operation.employeeIds.filter(id => id !== emp.id),
            })} />
            {emp.name}{!emp.active ? ' · nofaol' : ''}
          </label>)}</div>
          {!state.employees.length && <p className="subtle-note">Avval «Xodimlar» bo‘limida xodimlarni qo‘shing.</p>}
          <label className="check-field"><input type="checkbox" checked={!operation.autoAccept} onChange={event => setOperation({ ...operation, autoAccept: !event.target.checked })} />Natijani egasi qabul qiladi</label>
          <p className="subtle-note">Yoqilmasa, natija topshirilganda darhol qabul qilinadi.</p>
          <label className="check-field"><input type="checkbox" checked={operation.active} onChange={event => setOperation({ ...operation, active: event.target.checked })} />Operatsiya faol va yangi buyurtmalar uchun ochiq</label>
          <div className="info-note">Vaqt normasi va dastgoh maqsadi pulni hisobdan chiqarmaydi.</div>
        </div>
        <footer className="form-footer">
          <button type="button" className="secondary" onClick={() => setOperation(null)} disabled={busy}>Bekor qilish</button>
          <button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Operatsiyani saqlash'}</button>
        </footer>
      </form>
    </Dialog>}
  </>;
}
