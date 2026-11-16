import { useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { Dialog, Empty, Field, Section } from '../ui';
import type { Command, ExecutorKind, OrderLineKind, RouteTemplate, RouteTemplateStage, State } from '../types';

interface StageDraft {
  operationId: string;
  rate: number | null;
  executorKind: ExecutorKind;
  employeeId: string;
  supplierId: string;
}
interface TemplateDraft {
  id: string | null;
  name: string;
  kind: OrderLineKind;
  active: boolean;
  stages: StageDraft[];
}

const blankStage = (state: State): StageDraft => ({
  operationId: state.operations[0]?.id ?? '', rate: null, executorKind: 'employee', employeeId: '', supplierId: '',
});
const blankTemplate = (state: State): TemplateDraft => ({
  id: null, name: '', kind: 'service', active: true, stages: [blankStage(state)],
});
const templateDraft = (template: RouteTemplate): TemplateDraft => ({
  id: template.id, name: template.name, kind: template.kind, active: template.active,
  stages: template.stages.map(stage => ({
    operationId: stage.operationId,
    rate: stage.rate ?? null,
    executorKind: stage.executorKind ?? 'employee',
    employeeId: stage.employeeId ?? '',
    supplierId: stage.supplierId ?? '',
  })),
});

export function RouteTemplates({ state, busy, run }: {
  state: State; busy: boolean; run: (command: Command) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const setStage = (index: number, changes: Partial<StageDraft>) => setDraft(draft
    ? { ...draft, stages: draft.stages.map((row, i) => i === index ? { ...row, ...changes } : row) }
    : draft);

  const save = async () => {
    if (!draft) return;
    const stages: RouteTemplateStage[] = draft.stages.map(stage => {
      const row: RouteTemplateStage = { operationId: stage.operationId, executorKind: stage.executorKind };
      if (stage.rate !== null) row.rate = stage.rate;
      if (stage.executorKind === 'employee') row.employeeId = stage.employeeId || null;
      else row.supplierId = stage.supplierId || null;
      return row;
    });
    const command: Command = draft.id
      ? { type: 'routeTemplate.update', templateId: draft.id, name: draft.name, kind: draft.kind, stages, active: draft.active }
      : { type: 'routeTemplate.create', name: draft.name, kind: draft.kind, stages };
    if (await run(command)) setDraft(null);
  };

  const toggle = async (template: RouteTemplate) => {
    const command: Command = { type: 'routeTemplate.update', templateId: template.id, name: template.name, kind: template.kind, stages: template.stages, active: !template.active };
    await run(command);
  };

  return <>
    <Section
      title="Marshrut shablonlari"
      hint="«Xizmat» (masalan, bo‘yash) va «Pod klyuch» zanjirlari. Buyurtma pozitsiyasiga bir amalda qo‘llanadi — tannarx, mijoz narxi va ijrochi avtomat to‘ldiriladi."
      action={<button className="secondary small" onClick={() => setDraft(blankTemplate(state))}><Plus size={14} />Yangi shablon</button>}
    >
      <div className="catalog-machines">{state.routeTemplates.map(template => <article className="catalog-machine" key={template.id}>
        <header><b>{template.name}</b><span className={`task-status ${template.active ? 'completed' : 'rejected'}`}>{template.active ? 'Faol' : 'O‘chirilgan'}</span></header>
        <strong>{template.kind === 'service' ? 'Xizmat' : 'Mahsulot'}<small>{template.stages.length} bosqich</small></strong>
        <label className="check-field"><input type="checkbox" checked={template.active} disabled={busy} onChange={() => void toggle(template)} />Faol</label>
        <button className="text-button" onClick={() => setDraft(templateDraft(template))}><Pencil size={14} />Tahrirlash</button>
      </article>)}</div>
      {!state.routeTemplates.length && <Empty text="Buyurtmada tez to‘ldirish uchun marshrut shablonini qo‘shing." />}
    </Section>

    {draft && <Dialog title={draft.id ? 'Shablonni tahrirlash' : 'Yangi shablon'} subtitle="Bosqichlar tartibi buyurtmadagi marshrutga o‘tadi." close={() => { if (!busy) setDraft(null); }}>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="form-body">
          <Field label="Shablon nomi"><input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required maxLength={120} autoFocus /></Field>
          <Field label="Shablon turi"><select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as OrderLineKind })}><option value="service">Xizmat</option><option value="product">Mahsulot</option></select></Field>
          {draft.stages.map((stage, index) => <div className="editor-line route-editor" key={index}>
            <span className="route-index">{index + 1}</span>
            <select aria-label={`Shablon bosqich operatsiyasi ${index + 1}`} required value={stage.operationId} onChange={event => setStage(index, { operationId: event.target.value })}>
              <option value="">Bosqichni tanlang</option>{state.operations.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}
            </select>
            <div className="route-executor">
              <select aria-label={`Shablon bosqich ijrochi turi ${index + 1}`} value={stage.executorKind} onChange={event => setStage(index, event.target.value === 'supplier'
                ? { executorKind: 'supplier', employeeId: '', supplierId: state.suppliers[0]?.id ?? '' }
                : { executorKind: 'employee', supplierId: '', employeeId: state.employees.find(emp => emp.active)?.id ?? '' })}>
                <option value="employee">Xodim</option>
                <option value="supplier">Pudratchi</option>
              </select>
              {stage.executorKind === 'employee'
                ? <select aria-label={`Shablon bosqich ijrochisi ${index + 1}`} value={stage.employeeId} onChange={event => setStage(index, { employeeId: event.target.value })}>
                  <option value="">Avtomatik tanlanadi</option>
                  {state.employees.filter(emp => emp.active).map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                </select>
                : <select aria-label={`Shablon bosqich pudratchisi ${index + 1}`} required value={stage.supplierId} onChange={event => setStage(index, { supplierId: event.target.value })}>
                  <option value="">Pudratchini tanlang</option>
                  {state.suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                </select>}
            </div>
            <input aria-label={`Shablon bosqich tannarxi ${index + 1}`} type="number" min="0" step="0.01" placeholder="Avtomatik" value={stage.rate ?? ''} onChange={event => setStage(index, { rate: event.target.value === '' ? null : Number(event.target.value) })} />
            <button type="button" className="icon-button" aria-label={`Shablon bosqichini olib tashlash ${index + 1}`} onClick={() => setDraft({ ...draft, stages: draft.stages.filter((_, i) => i !== index) })}><X size={16} /></button>
          </div>)}
          <button type="button" className="secondary small" onClick={() => setDraft({ ...draft, stages: [...draft.stages, blankStage(state)] })}><Plus size={14} />Bosqich</button>
          {draft.id && <label className="check-field"><input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.target.checked })} />Shablon faol</label>}
        </div>
        <footer className="form-footer">
          <button type="button" className="secondary" onClick={() => setDraft(null)} disabled={busy}>Bekor qilish</button>
          <button className="primary" disabled={busy}>{draft.id ? 'Shablonni saqlash' : 'Shablon yaratish'}</button>
        </footer>
      </form>
    </Dialog>}
  </>;
}