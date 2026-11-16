import { useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { Dialog, errorText, Field } from '../ui';
import { compressPhoto } from '../photos';
import { groupItems } from '../order-editor';
import { operationUnits } from '../work-view';
import { warehouseGroups } from '../warehouse';
import { MaterialPicker } from './MaterialPicker';
import type { Command, Employee, Item, Operation } from '../types';

const unitOptions = ['dona', 'list', 'm', 'm²', 'kg', 'l'];

function CategoryField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Field label="Ombor tasniflagichi"><select value={value} onChange={event => onChange(event.target.value)}>
    <option value="">Tasniflanmagan</option>
    {warehouseGroups.map(group => <optgroup key={group.code} label={`${group.code} · ${group.name}`}>
      {group.children.map(leaf => <option key={leaf.code} value={leaf.code}>{leaf.code} · {leaf.name}</option>)}
    </optgroup>)}
  </select></Field>;
}

export function ItemEditor({ item, busy, close, save }: {
  item: Item; busy: boolean; close: () => void; save: (command: Command) => Promise<void>;
}) {
  const [name, setName] = useState(item.name);
  const [unit, setUnit] = useState(item.unit);
  const [minQty, setMinQty] = useState(item.minQty);
  const [salePrice, setSalePrice] = useState(item.salePrice);
  const [category, setCategory] = useState(item.category ?? '');
  const [photo, setPhoto] = useState(item.photo ?? '');
  const [photoChanged, setPhotoChanged] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const owned = item.customerId !== null;
  const units = [...new Set([...unitOptions, item.unit])];
  const attach = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError('');
    try {
      setPhoto(await compressPhoto(file));
      setPhotoChanged(true);
    } catch (reason) {
      setPhotoError(errorText(reason));
    } finally {
      setPhotoBusy(false);
    }
  };
  return <Dialog title="Pozitsiyani tahrirlash" subtitle="Nomi, o‘lchov birligi, minimal zaxira, sotuv narxi, rasm va ombor tasniflagichi." close={() => { if (!busy && !photoBusy) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void save({ type: 'item.update', itemId: item.id, name, unit, minQty, salePrice: owned ? 0 : salePrice, category: category || null, ...(photoChanged ? { photo } : {}) }); }}>
      <div className="form-body">
        <Field label="Nomi"><input value={name} onChange={event => setName(event.target.value)} required maxLength={200} autoFocus /></Field>
        <div className="form-grid">
          <Field label="O‘lchov birligi"><select value={unit} onChange={event => setUnit(event.target.value)}>{units.map(value => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Minimal zaxira"><input type="number" min="0" step="0.001" value={minQty} onChange={event => setMinQty(Number(event.target.value))} required /></Field>
          <Field label="Sotish narxi, UZS"><input type="number" min="0" step="0.01" value={owned ? '' : salePrice} onChange={event => setSalePrice(Number(event.target.value))} disabled={owned} required={!owned} /></Field>
        </div>
        <CategoryField value={category} onChange={setCategory} />
        <div className="field"><span>Material rasmi</span>
          <div className="photo-field">
            {photo ? <img className="photo-preview" src={photo} alt={name} /> : <span className="photo-placeholder"><ImagePlus size={22} /></span>}
            <div className="photo-actions">
              <label className="secondary small photo-pick">{photoBusy ? 'Tayyorlanmoqda…' : photo ? 'Rasmni almashtirish' : 'Rasm tanlash'}
                <input type="file" accept="image/*" hidden disabled={busy || photoBusy} onChange={event => { void attach(event.target.files?.[0]); event.target.value = ''; }} />
              </label>
              {photo && !photoBusy && <button type="button" className="text-button danger-text" onClick={() => { setPhoto(''); setPhotoChanged(true); }}><X size={14} />O‘chirish</button>}
            </div>
            <small>Rasm kichraytiriladi va faqat ombor kartasida saqlanadi. PDF hisob-fakturaga chiqmaydi.</small>
            {photoError && <small className="debt">{photoError}</small>}
          </div>
        </div>
        <div className="info-note">{owned
          ? 'Bu mijoz materiali: qiymat hisobga olinmaydi va sotuv narxi belgilanmaydi.'
          : 'Tannarx bu yerda o‘zgarmaydi. U xarid qabuli, retsept chiqimi va inventarizatsiya orqali yangilanadi.'}</div>
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy || photoBusy}>Bekor qilish</button>
        <button className="primary" disabled={busy || photoBusy}>{busy ? 'Saqlanmoqda…' : 'O‘zgarishlarni saqlash'}</button>
      </footer>
    </form>
  </Dialog>;
}

export function EmployeeEditor({ employee, busy, close, save }: {
  employee: Employee; busy: boolean; close: () => void; save: (command: Command) => Promise<void>;
}) {
  const [name, setName] = useState(employee.name);
  const [active, setActive] = useState(employee.active);
  const [deactivatedAt, setDeactivatedAt] = useState(employee.deactivatedAt ?? new Date().toISOString().slice(0, 10));
  return <Dialog title="Xodimni tahrirlash" subtitle="Ism, faollik va ishdan chiqqan sana. Oylik maosh «Oylik va qarzlar» bo‘limida belgilanadi." close={() => { if (!busy) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void save({ type: 'employee.update', employeeId: employee.id, name, active, deactivatedAt: active ? null : deactivatedAt }); }}>
      <div className="form-body">
        <Field label="Ism va familiya"><input value={name} onChange={event => setName(event.target.value)} required maxLength={120} autoFocus /></Field>
        <label className="check-field"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Xodim faol — unga yangi bosqich biriktirish mumkin</label>
        {!active && <Field label="Ishdan chiqqan sana"><input name="deactivatedAt" type="date" value={deactivatedAt} onChange={event => setDeactivatedAt(event.target.value)} required /></Field>}
        <div className="info-note">Nofaolga o‘tkazish tanlangan sanani yozadi va o‘sha oy maoshini kunlari bo‘yicha qisqartiradi. Qabul qilingan ishlar, hisob-kitoblar va to‘lovlar tarixi saqlanadi.</div>
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button>
        <button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Xodimni saqlash'}</button>
      </footer>
    </form>
  </Dialog>;
}

export function OperationRateEditor({ operation, items = [], busy, close, save }: {
  operation: Operation; items?: Item[]; busy: boolean; close: () => void; save: (command: Command) => Promise<void>;
}) {
  const [workerRate, setWorkerRate] = useState(operation.workerRate);
  const [salePrice, setSalePrice] = useState(operation.salePrice);
  const [standardMinutes, setStandardMinutes] = useState(operation.standardMinutes);
  const [autoAccept, setAutoAccept] = useState(operation.autoAccept);
  const [norms, setNorms] = useState(operation.norms);
  const byArea = operation.unit === 'squareMeter';
  const setNorm = (index: number, patch: Partial<{ itemId: string; qtyPerM2: number }>) =>
    setNorms(norms.map((norm, i) => (i === index ? { ...norm, ...patch } : norm)));
  return <Dialog title={`${operation.name} · tannarx`} subtitle="Yangi tannarx keyingi buyurtmalarga qo‘llanadi. Mavjud marshrutlarda tannarx qotib qolgan." close={() => { if (!busy) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void save({
      type: 'operation.update', operationId: operation.id, name: operation.name, unit: operation.unit,
      salePrice, workerRate, standardMinutes, machineId: operation.machineId, employeeIds: operation.employeeIds, active: operation.active,
      autoAccept, norms: byArea ? norms.filter(norm => norm.itemId) : operation.norms,
    }); }}>
      <div className="form-body">
        <div className="form-grid">
          <Field label="Bosqich tannarxi, UZS"><input type="number" min="0" step="0.01" value={workerRate || ''} onChange={event => setWorkerRate(Number(event.target.value))} required autoFocus /></Field>
          <Field label="Mijoz uchun birlik narxi, UZS"><input type="number" min="0" step="0.01" value={salePrice || ''} onChange={event => setSalePrice(Number(event.target.value))} required /></Field>
          <Field label="Vaqt normasi, daqiqa"><input type="number" min="0" step="0.1" value={standardMinutes || ''} onChange={event => setStandardMinutes(Number(event.target.value))} required /></Field>
        </div>
        {byArea && <div className="field"><span>1 m² uchun norma</span>
          {norms.map((norm, index) => <div className="editor-line" key={index}>
            <MaterialPicker label={`Norma materiali ${index + 1}`} value={norm.itemId}
              groups={groupItems(items.filter(item => item.customerId === null && item.kind !== 'finished'))}
              describe={item => item.unit} onChange={itemId => setNorm(index, { itemId })} />
            <input aria-label={`Norma sarfi ${index + 1}`} type="number" min="0.001" step="0.001" value={norm.qtyPerM2} required onChange={event => setNorm(index, { qtyPerM2: Number(event.target.value) })} />
            <button type="button" className="icon-button" aria-label={`Normani olib tashlash ${index + 1}`} onClick={() => setNorms(norms.filter((_, i) => i !== index))}><X size={17} /></button>
          </div>)}
          <button type="button" className="secondary small" onClick={() => setNorms([...norms, { itemId: '', qtyPerM2: 0 }])}><ImagePlus size={14} />Norma qo‘shish</button>
          <small>Norma × maydon buyurtma smetasiga material qatori bo‘lib tushadi. Haqiqiy sarfni ishchi tahrirlaydi.</small>
        </div>}
        <label className="check-field"><input type="checkbox" checked={!autoAccept} onChange={event => setAutoAccept(!event.target.checked)} />Natijani egasi qabul qiladi</label>
        <p className="subtle-note">Yoqilmasa, natija topshirilganda darhol qabul qilinadi.</p>
        <div className="info-note">{operationUnits.find(([key]) => key === operation.unit)?.[1] ?? operation.unit} birligi uchun. Bosqich tannarxi = birlik tannarxi × qabul qilingan miqdor.</div>
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button>
        <button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Tannarxni saqlash'}</button>
      </footer>
    </form>
  </Dialog>;
}
