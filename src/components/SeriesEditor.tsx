import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Dialog, Field, money, num } from '../ui';
import { buildSeriesInput, type SeriesDraft } from '../recipes';
import { dateOffset } from '../seed';
import type { Command, State } from '../types';

type RouteDraft = { operationId: string; employeeId: string; rate: number };

function firstRoute(state: State): RouteDraft {
  const operation = state.operations.find(row => row.active);
  const employeeId = operation?.employeeIds.find(id => state.employees.some(row => row.id === id && row.active)) ?? '';
  return { operationId: operation?.id ?? '', employeeId, rate: operation?.workerRate ?? 0 };
}

export function SeriesEditor({ state, busy, close, save }: {
  state: State; busy: boolean; close: () => void; save: (command: Command) => Promise<void>;
}) {
  const recipes = state.recipes.filter(recipe => recipe.active && recipe.versions.length > 0);
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? '');
  const recipe = recipes.find(row => row.id === recipeId);
  const [versionId, setVersionId] = useState(recipe?.versions[recipe.versions.length - 1]?.id ?? '');
  const version = recipe?.versions.find(row => row.id === versionId) ?? recipe?.versions[recipe.versions.length - 1];
  const [qty, setQty] = useState(1);
  const [dueDate, setDueDate] = useState(dateOffset(7));
  const [substitutions, setSubstitutions] = useState<Record<string, string>>({});
  const [route, setRoute] = useState<RouteDraft[]>([firstRoute(state)]);
  const [error, setError] = useState('');

  const item = (id: string | null) => state.items.find(row => row.id === id);
  const operations = state.operations.filter(row => row.active);
  const chosen = (slot: string, fallback: string | null) => substitutions[slot] ?? fallback ?? '';
  const optionIds = (component: { itemId: string | null; allowedItemIds: string[] }) =>
    [component.itemId, ...component.allowedItemIds].filter((id, index, all): id is string => !!id && all.indexOf(id) === index);
  const materialPlan = version ? version.components.reduce((sum, component) => {
    const row = item(chosen(component.slot, component.itemId));
    return sum + (row?.cost ?? 0) * component.qtyPerUnit * qty;
  }, 0) : 0;
  const laborPlan = route.reduce((sum, row) => sum + row.rate * qty, 0);

  const pickRecipe = (id: string) => {
    const next = recipes.find(row => row.id === id);
    setRecipeId(id);
    setVersionId(next?.versions[next.versions.length - 1]?.id ?? '');
    setSubstitutions({});
  };

  const pickVersion = (id: string) => { setVersionId(id); setSubstitutions({}); };

  const pickOperation = (index: number, operationId: string) => {
    const operation = operations.find(row => row.id === operationId);
    const employeeId = operation?.employeeIds.find(id => state.employees.some(row => row.id === id && row.active)) ?? '';
    setRoute(route.map((row, i) => i === index ? { operationId, employeeId, rate: operation?.workerRate ?? 0 } : row));
  };

  const moveStage = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= route.length) return;
    const next = [...route];
    [next[index], next[target]] = [next[target], next[index]];
    setRoute(next);
  };

  const submit = () => {
    setError('');
    if (!recipe || !version) { setError('Retsept va versiyani tanlang'); return; }
    if (!route.length || route.some(row => !row.operationId || !row.employeeId)) { setError('Marshrut bosqichlari va ijrochilarni qo‘shing'); return; }
    if (version.components.some(component => !chosen(component.slot, component.itemId))) { setError('Retseptning har bir uyasi uchun material tanlang'); return; }
    try {
      const draft: SeriesDraft = { recipe, version, qty, substitutions, route, dueDate };
      void save({ type: 'series.create', input: buildSeriesInput(draft) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Seriyani tekshiring');
    }
  };

  return <Dialog title="Seriyali chiqarish" subtitle="Mijozsiz ombor seriyasi: materiallar, almashtirishlar va marshrut. Tayyor mahsulot barcha bosqichlar qabul qilingandan keyin kiradi." close={close} wide>
    <form onSubmit={event => { event.preventDefault(); submit(); }}>
      <div className="form-body">
        <div className="form-grid">
          <Field label="Retsept">
            <select value={recipeId} onChange={event => pickRecipe(event.target.value)} required>
              <option value="">Retseptni tanlang</option>
              {recipes.map(row => <option key={row.id} value={row.id}>{row.name} · {item(row.outputItemId)?.name}</option>)}
            </select>
          </Field>
          <Field label="Retsept versiyasi">
            <select value={version?.id ?? ''} onChange={event => pickVersion(event.target.value)} required>
              {recipe?.versions.slice().reverse().map(row => <option key={row.id} value={row.id}>Versiya {row.version}</option>)}
            </select>
          </Field>
          <Field label="Seriya birliklari soni"><input type="number" min="0.001" step="0.001" value={qty} onChange={event => setQty(Number(event.target.value))} required /></Field>
          <Field label="Chiqarish muddati"><input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} required /></Field>
        </div>

        {version && <>
          <div className="form-section-title"><div><h3>Materiallar va almashtirishlar</h3><small>Norma seriya miqdoriga ko‘paytiriladi</small></div></div>
          <div className="series-materials">{version.components.map(component => {
            const options = optionIds(component);
            const selected = chosen(component.slot, component.itemId);
            return <div className="series-material" key={component.id}>
              <div><b>{component.slot}</b><small>{num(component.qtyPerUnit)} × {num(qty)} = {num(round(component.qtyPerUnit * qty))} {item(selected)?.unit ?? ''}</small></div>
              <select aria-label={`Uya materiali ${component.slot}`} value={selected} onChange={event => {
                const next = { ...substitutions };
                if (!event.target.value || event.target.value === component.itemId) delete next[component.slot];
                else next[component.slot] = event.target.value;
                setSubstitutions(next);
              }}>
                {!component.itemId && <option value="">Materialni tanlang</option>}
                {component.itemId && <option value={component.itemId}>{item(component.itemId)?.name ?? 'Asosiy material'} · asosiy</option>}
                {component.allowedItemIds.map(id => <option key={id} value={id}>{item(id)?.name ?? 'Almashtirish'}</option>)}
                {!options.length && <option value="">Ruxsat etilgan materiallar yo‘q</option>}
              </select>
              <strong>{money((item(selected)?.cost ?? 0) * component.qtyPerUnit * qty)}</strong>
            </div>;
          })}</div>
        </>}

        <div className="form-section-title">
          <div><h3>Ishlab chiqarish marshruti</h3><small>Ketma-ket bosqichlar, tannarx seriyada qotib qoladi</small></div>
          <button type="button" className="secondary small" onClick={() => setRoute([...route, { ...firstRoute(state), operationId: '', employeeId: '' }])}><Plus size={14} />Bosqich</button>
        </div>
        {route.map((line, index) => {
          const operation = operations.find(row => row.id === line.operationId);
          const employees = state.employees.filter(employee => employee.active && (!operation || operation.employeeIds.includes(employee.id)));
          return <div className="editor-line route-editor" key={index}>
            <span className="route-index">{index + 1}</span>
            <select aria-label={`Operatsiya ${index + 1}`} required value={line.operationId} onChange={event => pickOperation(index, event.target.value)}>
              <option value="">Bosqichni tanlang</option>
              {operations.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
            <select aria-label={`Ijrochi ${index + 1}`} required value={line.employeeId} onChange={event => setRoute(route.map((row, i) => i === index ? { ...row, employeeId: event.target.value } : row))}>
              <option value="">Ijrochi</option>
              {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>
            <input aria-label={`Birlik tannarxi ${index + 1}`} type="number" min="0" step="0.01" value={line.rate} required onChange={event => setRoute(route.map((row, i) => i === index ? { ...row, rate: Number(event.target.value) } : row))} />
            <b className="route-amount">{money(line.rate * qty)}</b>
            <div className="route-tools">
              <button type="button" className="icon-button" aria-label={`Bosqichni yuqoriga ko‘tarish ${index + 1}`} disabled={index === 0} onClick={() => moveStage(index, -1)}>↑</button>
              <button type="button" className="icon-button" aria-label={`Bosqichni pastga tushirish ${index + 1}`} disabled={index === route.length - 1} onClick={() => moveStage(index, 1)}>↓</button>
              <button type="button" className="icon-button" aria-label={`Bosqichni olib tashlash ${index + 1}`} disabled={route.length === 1} onClick={() => setRoute(route.filter((_, i) => i !== index))}><X size={16} /></button>
            </div>
          </div>;
        })}
        {!operations.length && <p className="subtle-note">Avval sozlamalarda operatsiyalarni qo‘shing.</p>}

        <div className="estimate-bar">
          <div><small>Materiallar, reja</small><b>{money(materialPlan)}</b></div>
          <div><small>Tannarx, reja</small><b>{money(laborPlan)}</b></div>
          <div><small>Jami reja</small><b>{money(materialPlan + laborPlan)}</b></div>
          <span>Barcha bosqichlarni bir marta qabul qilish = omborga bitta kirim</span>
        </div>
        <div className="info-note">Seriyada mijoz va sotish narxi yo‘q. Haqiqiy tannarx berilgan materiallar va qabul qilingan ishning tannarxidan shakllanadi.</div>
        {error && <div className="warning">{error}</div>}
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button>
        <button className="primary" disabled={busy || !recipes.length}>{busy ? 'Saqlanmoqda…' : 'Seriya yaratish'}</button>
      </footer>
    </form>
  </Dialog>;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
