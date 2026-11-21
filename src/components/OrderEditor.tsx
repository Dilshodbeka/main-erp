import { Fragment, useState } from 'react';
import { Copy, Plus, X } from 'lucide-react';
import { stockQty } from '../domain';
import { draftShortage, reservedExcept, type ShortageRow } from '../shortage';
import { unitText } from '../i18n';
import { ShortageNotice } from './ShortageNotice';
import { dateOffset } from '../seed';
import {
  applicableTemplates,
  applyTemplate,
  blankPosition,
  duplicatePosition,
  materialGroups,
  netMarkup,
  orderTotals,
  positionIssue,
  positionLines,
  positionTotal,
  positionsFromOrder,
  stageAmounts,
  stageEmployees,
  stageNormEstimate,
  suggestedUnitPrice,
  type AdjustmentMode,
  type PositionDraft,
  type PositionMaterial,
  type PositionStage,
} from '../order-editor';
import type { CustomerDraft } from '../customers';
import { CustomerPicker } from './CustomerPicker';
import { MaterialPicker } from './MaterialPicker';
import { OperationSelect } from './OperationSelect';
import { WarehouseSelect, WarehouseTransfer } from './WarehousePicker';
import { MAIN_WAREHOUSE_ID } from '../warehouse-default';
import { AccountField, Badge, Dialog, Empty, Field, money, num, statuses } from '../ui';
import type { Command, Order, OrderLineKind, State } from '../types';

const text = (form: FormData, name: string) => String(form.get(name) || '').trim();
const number = (form: FormData, name: string) => Number(form.get(name) || 0);

function AdjustmentField({ label, value, mode, onValue, onMode }: {
  label: string; value: number; mode: AdjustmentMode;
  onValue: (v: number) => void; onMode: (m: AdjustmentMode) => void;
}) {
  return <Field label={label}>
    <div className="adjustment-row">
      <input type="number" min="0" step="0.01" value={value} onChange={event => onValue(Number(event.target.value))} aria-label={`${label} miqdori`} />
      <select value={mode} onChange={event => onMode(event.target.value as AdjustmentMode)} aria-label={`${label} turi`}>
        <option value="percent">%</option>
        <option value="sum">UZS</option>
      </select>
    </div>
  </Field>;
}

export function OrderEditor({ state, order, close, save, busy, createCustomer, onGo }: {
  state: State;
  order?: Order;
  close: () => void;
  save: (command: Command) => Promise<void>;
  busy: boolean;
  createCustomer: (draft: CustomerDraft) => Promise<string | null>;
  onGo?: (section: string, panel?: string) => void;
}) {
  const editing = !!order;
  const [positions, setPositions] = useState<PositionDraft[]>(() => (order ? positionsFromOrder(state, order) : [blankPosition()]));
  const [activeIndex, setActiveIndex] = useState(0);
  const [customerId, setCustomerId] = useState(order?.customerId ?? state.customers[0]?.id ?? '');
  const [overhead, setOverhead] = useState(order?.overhead ?? 0);
  const [markupValue, setMarkupValue] = useState((order?.markup ?? 0) > 0 ? order!.markup! : 0);
  const [markupMode, setMarkupMode] = useState<AdjustmentMode>('sum');
  const [discountValue, setDiscountValue] = useState((order?.markup ?? 0) < 0 ? -(order!.markup!) : 0);
  const [discountMode, setDiscountMode] = useState<AdjustmentMode>('sum');
  const [error, setError] = useState('');
  const lockedWarehouse = !!order?.materials.some(line => line.issuedQty > 0);
  const [warehouseId, setWarehouseId] = useState(order?.warehouseId ?? MAIN_WAREHOUSE_ID);
  const [transfer, setTransfer] = useState<ShortageRow | null>(null);
  const active = Math.min(activeIndex, positions.length - 1);
  const current = positions[active];
  const positionsBase = positions.reduce((total, position) => total + positionTotal(position), 0);
  const markup = netMarkup(positionsBase, markupValue, markupMode, discountValue, discountMode);
  const totals = orderTotals(state, positions, overhead, markup);
  const shortage = draftShortage(state, positions, order?.id ?? null, warehouseId);
  const kinds = new Set(positions.map(position => position.kind));
  const orderKind: Order['kind'] = kinds.size === 1 ? [...kinds][0]! : 'composite';
  const patch = (index: number, changes: Partial<PositionDraft>) => setPositions(list => list.map((position, i) => i === index ? { ...position, ...changes } : position));
  const addPosition = () => { setPositions(list => [...list, blankPosition()]); setActiveIndex(positions.length); };
  const copyPosition = () => { if (!current) return; setPositions(list => [...list.slice(0, active + 1), duplicatePosition(current), ...list.slice(active + 1)]); setActiveIndex(active + 1); };
  const removePosition = () => { if (!current || current.id) return; setPositions(list => list.filter((_, i) => i !== active)); setActiveIndex(Math.max(0, active - 1)); };

  return <>
    <Dialog wide className="dialog-positions"
    title={editing ? `Buyurtmani tahrirlash · ${order.number}` : 'Yangi buyurtma'}
    subtitle={editing ? 'Har pozitsiya alohida hisoblanadi. Mijoz va umumiy muddat bitta buyurtmada qoladi; yuborilgan yoki boshlangan qatorlar qulflanadi.' : 'Bitta mijoz, bitta buyurtma — ichida har mahsulot va xizmat alohida pozitsiya.'}
    close={() => { if (!busy) close(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      if (!customerId) { setError('Mijozni tanlang yoki yangi mijoz yarating.'); return; }
      const issue = positionIssue(positions);
      if (issue) { setError(issue); return; }
      const lines = positionLines(positions);
      const dueDate = text(form, 'dueDate');
      if (order) { void save({ type: 'order.update', orderId: order.id, overhead, markup, dueDate, lines, warehouseId }); return; }
      void save({ type: 'order.create', input: { kind: 'composite', customerId, overhead, markup, dueDate, advance: number(form, 'advance'), account: text(form, 'account') as 'cash' | 'bank', lines, warehouseId } });
    }}>
      <div className="form-body order-form">
        <section className="order-block"><header className="order-block-head"><span>1</span><h3>Mijoz va muddat</h3></header>
        <div className="form-grid order-grid-3">
          <Field label="Mijoz"><CustomerPicker customers={state.customers} value={customerId} disabled={editing} orderKind={orderKind} onChange={id => {
            setCustomerId(id);
            setPositions(list => list.map(position => ({ ...position, materials: position.materials.filter(row => !state.items.find(item => item.id === row.itemId)?.customerId) })));
          }} onCreate={createCustomer} /></Field>
          <Field label="Umumiy tayyorlash muddati"><input name="dueDate" type="date" defaultValue={order?.dueDate ?? dateOffset(7)} required /></Field>
          <WarehouseSelect warehouses={state.warehouses} value={warehouseId} onChange={setWarehouseId} disabled={lockedWarehouse} label="Qaysi ombordan" />
        </div>
        {lockedWarehouse && <p className="subtle-note">Materiallar berilgan — omborni o‘zgartirib bo‘lmaydi.</p>}
        </section>
        <section className="order-block"><header className="order-block-head"><span>2</span><h3>Pozitsiyalar</h3><small>Har bir mahsulot va xizmat — alohida pozitsiya: materiallari va marshruti bilan</small></header>
        <div className="order-positions">
          <div className="position-list">
            {positions.map((position, index) => <button type="button" key={position.id ?? `new-${index}`}
              className={`position-item ${index === active ? 'selected' : ''}`} aria-pressed={index === active} onClick={() => setActiveIndex(index)}>
              <b>{index + 1}. {position.title.trim() || 'Nomsiz pozitsiya'}</b>
              <small>{position.kind === 'service' ? 'Xizmat' : 'Mahsulot'} · {num(position.qty)} × {money(position.unitPrice)}</small>
              <span className="position-sum">{money(positionTotal(position))}{position.status ? ` · ${statuses[position.status]}` : ''}</span>
            </button>)}
            <div className="position-tools">
              <button type="button" className="secondary small" onClick={addPosition}><Plus size={14} />Pozitsiya</button>
              <button type="button" className="secondary small" disabled={!current} onClick={copyPosition}><Copy size={14} />Nusxa</button>
              <button type="button" className="icon-button" disabled={!current || !!current.id} aria-label="Pozitsiyani olib tashlash" onClick={removePosition}><X size={16} /></button>
            </div>
            {editing && <p className="subtle-note">Saqlangan pozitsiya buyurtma kartasida bekor qilinadi.</p>}
          </div>
          <div className="position-detail">{current
            ? <PositionForm state={state} position={current} customerId={customerId} orderId={order?.id ?? null} warehouseId={warehouseId} onTransfer={setTransfer} onChange={changes => patch(active, changes)} shortage={shortage} onGo={onGo} />
            : <Empty text="Chapdan pozitsiya tanlang yoki yangisini qo‘shing" />}</div>
        </div>
        </section>
        <section className="order-block"><header className="order-block-head"><span>3</span><h3>Hisob-kitob</h3><small>Natsenka qo‘shiladi, chegirma ayiriladi — % yoki so‘m</small></header>
        <div className="form-grid order-grid-5">
          <Field label="Boshqa xarajatlar (reja)"><input type="number" min="0" step="0.01" value={overhead} onChange={event => setOverhead(Number(event.target.value))} /></Field>
          <AdjustmentField label="Natsenka" value={markupValue} mode={markupMode} onValue={setMarkupValue} onMode={setMarkupMode} />
          <AdjustmentField label="Chegirma" value={discountValue} mode={discountMode} onValue={setDiscountValue} onMode={setDiscountMode} />
          {!editing && <><Field label="Avans"><input name="advance" type="number" min="0" max={totals.price} step="0.01" defaultValue={0} required /></Field><AccountField /></>}
        </div>
        </section>
        {editing && <div className="info-note">Mahsulot miqdori va bosqich hajmlari alohida: qabul qilingan bosqichni kamaytirib, mahsulot miqdorini esa o‘zgartirsa bo‘ladi. Yuborilgan pozitsiya miqdori va bajarilgan bosqich hajmi pastga tushirilmaydi. Narxni pasaytirsangiz, ortiqcha to‘lov mijoz avansiga o‘tadi.</div>}
        <div className="estimate-bar">
          <div><small>Pozitsiyalar / birliklar</small><b>{positions.length} / {num(totals.qty)}</b></div>
          <div><small>Pozitsiyalar summasi</small><b>{money(totals.positions)}</b></div>
          <div><small>Natsenka − chegirma</small><b className={totals.markup < 0 ? 'debt' : ''}>{money(totals.markup)}</b></div>
          <div><small>Buyurtma summasi</small><b>{money(totals.price)}</b></div>
          <div><small>Reja tannarxi</small><b>{money(totals.cost)}</b></div>
          <div><small>Reja marjasi</small><b className={totals.margin < 0 ? 'debt' : 'positive'}>{money(totals.margin)}</b></div>
        </div>
        {error && <div className="warning">{error}</div>}
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button>
        <button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : editing ? 'O‘zgarishlarni saqlash' : 'Buyurtma yaratish'}</button>
      </footer>
    </form>
  </Dialog>
  {transfer && <WarehouseTransfer state={state} itemId={transfer.itemId} fromId={transfer.warehouseId} toId={transfer.suggestedFrom[0]?.warehouseId} qty={transfer.short} close={() => setTransfer(null)} save={async command => { await save(command); setTransfer(null); }} busy={busy} />}
  </>;
}

function PositionForm({ state, position, customerId, orderId, warehouseId, onChange, shortage, onGo, onTransfer }: {
  state: State;
  position: PositionDraft;
  customerId: string;
  orderId: string | null;
  warehouseId: string;
  onChange: (changes: Partial<PositionDraft>) => void;
  shortage: ShortageRow[];
  onGo?: (section: string, panel?: string) => void;
  onTransfer?: (row: ShortageRow) => void;
}) {
  const floor = position.floor;
  const shortByItem = new Map(shortage.map(row => [row.itemId, row]));
  const shortageChip = (itemId: string) => {
    const row = shortByItem.get(itemId);
    return row ? <small className="shortage-chip">yetishmaydi {num(row.short)} {unitText(row.unit)}</small> : null;
  };
  const setMaterial = (index: number, changes: Partial<PositionMaterial>) => onChange({ materials: position.materials.map((row, i) => i === index ? { ...row, ...changes } : row) });
  const multiWarehouse = state.warehouses.filter(row => row.active).length > 1;
  const sourceWarehouse = multiWarehouse ? state.warehouses.find(row => row.id === warehouseId)?.name : null;
  const describeMaterial = (item: { id: string; unit: string; kind: string; customerId: string | null }) =>
    `erkin ${num(stockQty(state, item.id, warehouseId) - reservedExcept(state, item.id, orderId, warehouseId))} ${item.unit}${item.kind === 'blank' ? ' · zagotovka' : ''}${item.customerId ? ' · mijozniki' : ''}${sourceWarehouse ? ` · ${sourceWarehouse}` : ''}`;
  const setStage = (index: number, changes: Partial<PositionStage>) => onChange({ route: position.route.map((task, i) => i === index ? { ...task, ...changes } : task) });
  const moveStage = (index: number, offset: number) => {
    const next = [...position.route];
    const target = index + offset;
    if (target < 0 || target >= next.length || next[index].locked || next[target].locked) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ route: next });
  };
  const applyShablon = (templateId: string) => {
    const template = state.routeTemplates.find(row => row.id === templateId);
    if (!template) return;
    if (position.route.length && !window.confirm('Joriy marshrut shablon marshrutiga almashtiriladi. Davom etasizmi?')) return;
    onChange({ route: applyTemplate(state, template, position.qty) });
  };
  return <>
    <div className="position-head">
      <div><h3>{position.title.trim() || 'Yangi pozitsiya'}</h3><small>{position.kind === 'service' ? 'Alohida xizmat' : 'Mebel / mahsulot'} · summa {money(positionTotal(position))}</small></div>
      {position.status && <Badge status={position.status} />}
    </div>
    <div className="form-grid">
      <Field label="Pozitsiya nomi"><input value={position.title} placeholder="Masalan, oshxona yoki fasadni bo‘yash" maxLength={200} onChange={event => onChange({ title: event.target.value })} required /></Field>
      <Field label="Pozitsiya turi"><select value={position.kind} onChange={event => onChange({ kind: event.target.value as OrderLineKind })}><option value="product">Mebel / mahsulot</option><option value="service">Alohida xizmat</option></select></Field>
      <Field label={floor > 0 ? `Miqdor · kamida ${num(floor)}` : 'Miqdor'}><input type="number" value={position.qty} min={floor > 0 ? floor : 0.001} step="0.001" onChange={event => onChange({ qty: Number(event.target.value) })} required /></Field>
      <Field label="Bitta dona narxi, UZS"><input type="number" value={position.unitPrice || ''} min="0" step="0.01" placeholder="0" onChange={event => onChange({ unitPrice: Number(event.target.value) })} /></Field>
    </div>
    {!(position.unitPrice > 0) && suggestedUnitPrice(position) > 0 && <p className="subtle-note">
      Narx kiritilmagan. Bosqichlar bo‘yicha bitta dona: {money(suggestedUnitPrice(position))}.{' '}
      <button type="button" className="secondary small" onClick={() => onChange({ unitPrice: suggestedUnitPrice(position) })}>Shu narxni qo‘yish</button>
    </p>}
    <div className="form-section-title">
      <div><h3>Materiallar</h3><small>Butun pozitsiya uchun jami miqdor</small></div>
      <button type="button" className="secondary small" onClick={() => onChange({ materials: [...position.materials, { itemId: '', qty: 1, issuedQty: 0 }] })}><Plus size={14} />Qator</button>
    </div>
    <ShortageNotice rows={shortage} onGo={onGo} onTransfer={onTransfer} />
    {position.materials.map((row, index) => <div className="editor-line material-editor" key={index}>
      <MaterialPicker label={`Material ${index + 1}`} value={row.itemId} disabled={row.issuedQty > 0} qty={row.qty}
        groups={materialGroups(state, customerId, row.itemId, position.materials.map(material => material.itemId))}
        describe={describeMaterial} onChange={itemId => setMaterial(index, { itemId })} />
      <input aria-label={`Material miqdori ${index + 1}`} type="number" min={row.issuedQty > 0 ? row.issuedQty : 0.001} step="0.001" value={row.qty} required onChange={event => setMaterial(index, { qty: Number(event.target.value) })} />
      <button type="button" className="icon-button" aria-label={`Materialni olib tashlash ${index + 1}`} disabled={row.issuedQty > 0} onClick={() => onChange({ materials: position.materials.filter((_, i) => i !== index) })}><X size={17} /></button>
      {row.issuedQty > 0 && <small className="route-rate">{row.issuedQty >= row.qty ? `Berilgan ${num(row.issuedQty)} · to‘liq` : `Berilgan ${num(row.issuedQty)} · Kerak ${num(row.qty)}`}</small>}
      {shortageChip(row.itemId)}
    </div>)}
    {!position.materials.length && <p className="order-empty-line">Material qo‘shilmagan — ombordan chiqim bo‘lmaydi.</p>}
    <div className="form-section-title">
      <div><h3>Ishlab chiqarish marshrut</h3><small>Bosqich summasi = narx × hajm. Pudratchiga — qat’iy summa</small></div>
      <div className="button-group">
        {applicableTemplates(state, position.kind).length > 0 && <select aria-label="Shablon" value="" onChange={event => { if (event.target.value) applyShablon(event.target.value); }}><option value="">Shablon…</option>{applicableTemplates(state, position.kind).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select>}
        <button type="button" className="secondary small" onClick={() => onChange({ route: [...position.route, { operationId: '', executorKind: 'employee', employeeId: state.employees[0]?.id || null, supplierId: null, rate: 0, supplierCost: 0, salePrice: 0, qty: position.qty, locked: false, completed: 0 }] })}><Plus size={14} />Bosqich</button>
      </div>
    </div>
    {position.route.map((task, index) => {
      const amounts = stageAmounts(task);
      const crew = task.crew ?? [];
      const crewMembers = state.employees.filter(employee => employee.active || crew.some(member => member.employeeId === employee.id));
      const freeMember = crewMembers.find(employee => employee.id !== task.employeeId && !crew.some(member => member.employeeId === employee.id));
      return <Fragment key={index}>
      <div className={`editor-line route-editor${task.executorKind === 'supplier' ? ' supplier-stage' : ''}`}>
      <span className="route-index">{index + 1}</span>
      <OperationSelect ariaLabel={`Amal ${index + 1}`} value={task.operationId} disabled={task.locked} withPrice
        operations={state.operations} machines={state.machines}
        onChange={operationId => {
          const operation = state.operations.find(op => op.id === operationId);
          setStage(index, task.executorKind === 'supplier'
            ? { operationId, rate: 0, supplierCost: task.supplierCost ?? 0, salePrice: operation?.salePrice || 0 }
            : { operationId, rate: operation?.workerRate || 0, salePrice: operation?.salePrice || 0,
                // Ruxsati yo‘q ijrochi bilan buyurtma saqlanmaydi — amal almashganda ruxsatlisiga o‘tkazamiz.
                ...(operation && task.employeeId && !operation.employeeIds.includes(task.employeeId) && !task.assembly
                  ? { employeeId: state.employees.find(employee => employee.active && operation.employeeIds.includes(employee.id))?.id ?? null }
                  : {}) });
        }} />
      <div className="route-executor">
        <select aria-label={`Ijrochi turi ${index + 1}`} value={task.executorKind}
          disabled={task.locked}
          onChange={event => setStage(index, event.target.value === 'supplier'
            ? { executorKind: 'supplier', employeeId: null, supplierId: state.suppliers[0]?.id ?? null, rate: 0, supplierCost: task.supplierCost ?? 0, assembly: false, crew: undefined }
            : { executorKind: 'employee', employeeId: state.employees[0]?.id ?? null, supplierId: null, supplierCost: 0, rate: state.operations.find(op => op.id === task.operationId)?.workerRate ?? task.rate })}>
          <option value="employee">Xodim</option>
          <option value="supplier">Pudratchi</option>
        </select>
        {task.executorKind === 'employee'
          ? <select aria-label={`Ijrochi ${index + 1}`} required value={task.employeeId ?? ''} disabled={task.locked} onChange={event => setStage(index, { employeeId: event.target.value || null })}>
            <option value="">Ijrochi</option>
            {stageEmployees(state, task, position.route).map(employee => <option key={employee.id} value={employee.id}>{employee.name}{employee.active ? '' : ' · nofaol'}</option>)}
          </select>
          : <select aria-label={`Pudratchi ${index + 1}`} required value={task.supplierId ?? ''}
            disabled={task.locked}
            onChange={event => setStage(index, { supplierId: event.target.value || null })}>
            <option value="">Pudratchini tanlang</option>
            {state.suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>}
      </div>
      <input aria-label={`Bosqich miqdori ${index + 1}`} className="route-qty" type="number" min={task.completed > 0 ? task.completed : 0.001} step="0.001"
        value={task.qty} required onChange={event => setStage(index, { qty: Number(event.target.value) })} title="Ishning o‘z hajmi: varaqlar, metr, teshik yoki dona" />
      {task.executorKind === 'supplier'
        ? <label className="route-amount route-supplier-cost" title="Pudratchiga to‘lanadigan qat’iy summa. Stavka × miqdor qo‘llanmaydi.">
            <small>Pudratchi summasi</small>
            <input aria-label={`Pudratchi summasi ${index + 1}`} type="number" min="0" step="0.01"
              value={task.supplierCost ?? 0} disabled={task.locked}
              onChange={event => setStage(index, { supplierCost: Number(event.target.value) })} />
          </label>
        : <>
          <span className="route-rate" title="Operatsiya narxi — 1 birlik uchun, mijoz fakturasiga shu tushadi.">
            {money(task.salePrice ?? 0)}
            <small>1 birlik{task.locked ? ` · bajarilgan ${num(task.completed)}` : ''}</small>
          </span>
          <b className="route-amount" title="Summa = operatsiya narxi × bosqich miqdori">
            {money(amounts.price)}
            <small>summa</small>
          </b>
        </>}
      {(() => {
        const estimate = stageNormEstimate(state, task);
        return estimate === null ? null : <small className="route-rate" title="Norma bo‘yicha material smetasi: norma × maydon × o‘rtacha tannarx">material ≈ {money(estimate)}</small>;
      })()}
      <div className="route-tools">
        <button type="button" className="icon-button" aria-label={`Bosqichni yuqoriga ko‘tarish ${index + 1}`} disabled={index === 0 || task.locked || position.route[index - 1]?.locked} onClick={() => moveStage(index, -1)}>↑</button>
        <button type="button" className="icon-button" aria-label={`Bosqichni pastga tushirish ${index + 1}`} disabled={index === position.route.length - 1 || task.locked || position.route[index + 1]?.locked} onClick={() => moveStage(index, 1)}>↓</button>
        <button type="button" className="icon-button" aria-label={`Bosqichni olib tashlash ${index + 1}`} disabled={task.locked} onClick={() => onChange({ route: position.route.filter((_, i) => i !== index) })}><X size={16} /></button>
      </div>
      </div>
      <div className="assembly-editor">
        <label className="assembly-toggle">
          <input type="checkbox" checked={task.assembly === true} disabled={task.locked || task.executorKind === 'supplier'}
            onChange={event => setStage(index, event.target.checked
              ? { assembly: true, crew: task.employeeId ? [{ employeeId: task.employeeId, weight: 1 }, ...crew.filter(member => member.employeeId !== task.employeeId)] : crew }
              : { assembly: false, crew: undefined })} />
          <span>Yig‘ish — brigada bosqichi</span>
        </label>
        {task.assembly && <div className="crew-editor">
          <small>Haqiqiy sarf «Tayyor» tugmasida kiritiladi. To‘lov brigada ulushlari nisbatida bo‘linadi.</small>
          {crew.map((member, crewIndex) => <div className="crew-row" key={crewIndex}>
            <select aria-label={`Brigada a’zosi ${index + 1}.${crewIndex + 1}`} value={member.employeeId} disabled={task.locked}
              onChange={event => setStage(index, { crew: crew.map((row, i) => i === crewIndex ? { ...row, employeeId: event.target.value } : row) })}>
              {crewMembers.filter(employee => employee.id === member.employeeId || !crew.some((other, i) => i !== crewIndex && other.employeeId === employee.id))
                .map(employee => <option key={employee.id} value={employee.id}>{employee.name}{employee.active ? '' : ' · nofaol'}</option>)}
            </select>
            <input aria-label={`Ulush ${index + 1}.${crewIndex + 1}`} type="number" min="0.1" step="0.1" value={member.weight} disabled={task.locked}
              onChange={event => setStage(index, { crew: crew.map((row, i) => i === crewIndex ? { ...row, weight: Number(event.target.value) } : row) })} />
            <button type="button" className="icon-button" aria-label={`Brigada a’zosini olib tashlash ${index + 1}.${crewIndex + 1}`} disabled={task.locked}
              onClick={() => setStage(index, { crew: crew.filter((_, i) => i !== crewIndex) })}><X size={16} /></button>
          </div>)}
          <button type="button" className="secondary small" disabled={task.locked || !freeMember}
            onClick={() => { if (freeMember) setStage(index, { crew: [...crew, { employeeId: freeMember.id, weight: 1 }] }); }}>
            <Plus size={14} />A’zo qo‘shish
          </button>
        </div>}
      </div>
    </Fragment>;
    })}
    {!position.route.length && <p className="order-empty-line">Bosqich yo‘q — qoralama sifatida saqlanadi. Sexga tushirish uchun kamida bitta bosqich kerak.</p>}
  </>;
}
