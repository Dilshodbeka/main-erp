import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FolderOpen, ImageOff, ImagePlus, Upload } from 'lucide-react';
import {
  buildItemImportPlan, itemImportColumns, itemImportTemplate, parseItemCsv, photoKey,
  type ItemImportPlanRow, type ItemImportRow,
} from '../import';
import { compressPhoto, isPhotoFile } from '../photos';
import { categoryLabel } from '../warehouse';
import { Dialog, errorText, money, num } from '../ui';
import type { Command, Item, ItemKind, State } from '../types';

const kindLabels: Record<ItemKind, string> = { material: 'Material', blank: 'Zagotovka', finished: 'Tayyor mahsulot' };
const actionLabels = { create: 'Yangi', update: 'Yangilanadi', skip: 'O‘zgarmaydi' } as const;

export function ItemImport({ state, busy, close, save }: {
  state: State; busy: boolean; close: () => void;
  save: (commands: Command[]) => Promise<{ done: number; error: string | null }>;
}) {
  const [fileName, setFileName] = useState('');
  const [folderName, setFolderName] = useState('');
  const [parsed, setParsed] = useState<ItemImportRow[] | null>(null);
  const [photos, setPhotos] = useState<Map<string, File>>(new Map());
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'idle' | 'reading' | 'saving'>('idle');
  const [progress, setProgress] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const plan = useMemo(() => parsed ? buildItemImportPlan(state, parsed) : null, [state, parsed]);
  const actionable = plan?.rows.filter(row => !row.error && row.action !== 'skip') ?? [];
  const missingPhotos = plan ? plan.rows.filter(row => row.photoFile && !photos.has(photoKey(row.photoFile))).length : 0;
  const locked = busy || phase !== 'idle';

  const chooseCsv = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setDone(null);
    setPhase('reading');
    try {
      const text = await file.text();
      const rows = parseItemCsv(text);
      setFileName(file.name);
      setParsed(rows);
      if (!rows.length) setError('Faylda ma’lumot qatorlari topilmadi.');
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setPhase('idle');
    }
  };

  const addPhotos = (files: FileList | null) => {
    if (!files?.length) return;
    const next = new Map(photos);
    let added = 0;
    for (const file of Array.from(files)) {
      if (!isPhotoFile(file)) continue;
      next.set(photoKey(file.name), file);
      added++;
    }
    if (!added) { setError('Tanlangan fayllar orasida rasm yo‘q.'); return; }
    setPhotos(next);
    setFolderName(prev => prev || 'Tanlangan rasmlar');
    setError('');
  };

  const downloadTemplate = () => {
    const blob = new Blob([itemImportTemplate()], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'aliya-materiallar-shablon.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const submit = async () => {
    if (!plan || !actionable.length || locked) return;
    setError('');
    setPhase('saving');
    try {
      const commands: Command[] = [];
      for (let index = 0; index < actionable.length; index++) {
        const row = actionable[index];
        setProgress(`Rasm tayyorlanmoqda ${index + 1} / ${actionable.length}`);
        const file = row.photoFile ? photos.get(photoKey(row.photoFile)) : undefined;
        const photo = file ? await compressPhoto(file) : undefined;
        commands.push(commandFor(state, row, photo));
      }
      setProgress(`${commands.length} ta pozitsiya saqlanmoqda…`);
      const result = await save(commands);
      if (result.error) {
        setError(`${result.done} ta pozitsiya saqlandi. Keyingisida xato: ${result.error}`);
        return;
      }
      setDone(result.done);
      setProgress('');
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setPhase('idle');
    }
  };

  return <Dialog title="Materiallarni Excel / CSV dan yuklash" subtitle="Shablonni to‘ldiring, rasm papkasini qo‘shing va importdan oldin natijani tekshiring." close={() => { if (!locked) close(); }} wide>
    <div className="form-body import-body">
      <div className="import-grid">
        <label className={`import-drop ${fileName ? 'filled' : ''}`}>
          <FileSpreadsheet size={22} />
          <b>{fileName || 'CSV fayl tanlash'}</b>
          <small>Excel’da «CSV UTF-8» sifatida saqlang. Ajratgich ; yoki , bo‘lishi mumkin.</small>
          <input type="file" accept=".csv,text/csv,text/plain" hidden disabled={locked} onChange={event => { void chooseCsv(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        <label className={`import-drop ${photos.size ? 'filled' : ''}`} ref={node => { if (node) { const input = node.querySelector('input'); input?.setAttribute('webkitdirectory', ''); input?.setAttribute('directory', ''); } }}>
          <FolderOpen size={22} />
          <b>{photos.size ? `${photos.size} rasm tayyor` : 'Rasm papkasini tanlash'}</b>
          <small>{folderName || 'CSV dagi «Rasm» ustuni papkadagi fayl nomiga mos keladi.'}</small>
          <input type="file" multiple accept="image/*" hidden disabled={locked} onChange={event => { addPhotos(event.target.files); event.target.value = ''; }} />
        </label>
        <label className="import-drop">
          <ImagePlus size={22} />
          <b>Alohida rasmlar</b>
          <small>Papka tanlash ishlamasa, kerakli rasm fayllarini qo‘lda belgilang.</small>
          <input type="file" multiple accept="image/*" hidden disabled={locked} onChange={event => { addPhotos(event.target.files); event.target.value = ''; }} />
        </label>
      </div>

      <div className="import-tools">
        <button type="button" className="secondary" onClick={downloadTemplate} disabled={locked}><Download size={16} />CSV shablon</button>
        {photos.size > 0 && <span className="import-chip">{photos.size} rasm yuklandi</span>}
        {plan && <span className={`import-chip ${missingPhotos ? 'warn' : ''}`}>{missingPhotos ? `${missingPhotos} rasm topilmadi` : 'Rasmlar to‘liq'}</span>}
      </div>

      {!plan && <div className="info-note"><FileSpreadsheet size={18} />Shablon ustunlari: {itemImportColumns.map(([label]) => label).join(', ')}. Faqat «Nomi» majburiy.</div>}

      {plan && <>
        <div className="import-summary">
          <span>Yangi <b>{plan.creates}</b></span>
          <span>Yangilanadi <b>{plan.updates}</b></span>
          <span>O‘zgarmaydi <b>{plan.skips}</b></span>
          <span className={plan.errors ? 'debt' : ''}>Xato <b>{plan.errors}</b></span>
        </div>
        <div className="table-scroll cardable import-scroll"><table className="import-table"><thead><tr><th>#</th><th>Nomi</th><th>Birlik / tur</th><th>Kategoriya</th><th className="right">Min / qoldiq</th><th className="right">Tannarx / sotuv</th><th>Rasm</th><th>Holat</th></tr></thead><tbody>
          {plan.rows.map(row => {
            const found = row.photoFile ? photos.has(photoKey(row.photoFile)) : false;
            const warnings = [...row.warnings];
            if (row.photoFile && !found) warnings.push('Rasm topilmadi — rasmisiz saqlanadi');
            return <tr key={row.line}>
              <td data-label="#" className="muted">{row.line}</td>
              <td data-label="Nomi"><b>{row.name || '—'}</b>{row.supplier && <small>{row.supplier}</small>}</td>
              <td data-label="Birlik / tur">{row.unit}<small>{kindLabels[row.kind]}</small></td>
              <td data-label="Kategoriya">{row.category ? categoryLabel(row.category) : <span className="muted">Tasniflanmagan</span>}</td>
              <td data-label="Min / qoldiq" className="right">{row.minQtyGiven ? num(row.minQty) : '—'}<small>{row.openQty > 0 ? `qoldiq ${num(row.openQty)}` : 'qoldiqsiz'}</small></td>
              <td data-label="Tannarx / sotuv" className="right">{row.costGiven ? money(row.cost) : '—'}<small>{row.salePriceGiven ? money(row.salePrice) : 'sotuv —'}</small></td>
              <td data-label="Rasm">{row.photoFile ? <span className={found ? 'photo-state ready' : 'photo-state'}>{found ? <ImagePlus size={14} /> : <ImageOff size={14} />}{row.photoFile}</span> : <span className="muted">—</span>}</td>
              <td data-label="Holat"><span className={`import-state ${row.error ? 'error' : row.action}`}>{row.error ? 'Xato' : actionLabels[row.action]}</span>{row.changes.length > 0 && <small>{row.changes.join(', ')}</small>}{row.error && <small className="debt">{row.error}</small>}{warnings.map((text, index) => <small className="warn" key={`${text}-${index}`}>{text}</small>)}</td>
            </tr>;
          })}
        </tbody></table></div>
        <details className="import-help"><summary>Ustunlar qo‘llanmasi</summary><dl>{itemImportColumns.map(([label, hint]) => <div key={label}><dt>{label}</dt><dd>{hint}</dd></div>)}</dl><p>Mavjud pozitsiyalar nomi bo‘yicha topiladi. Bo‘sh katak mavjud qiymatni o‘zgartirmaydi; yangi pozitsiyada bo‘sh katak nol yoki standart qiymat oladi. Tannarx faqat yangi pozitsiyada qo‘llanadi, keyingi o‘zgarishlar xarid qabuli orqali bo‘ladi.</p></details>
        {done !== null && <div className="success-note">Import yakunlandi: {done} ta pozitsiya saqlandi. Rasm va qoldiqlar ombor kartasida ko‘rinadi.</div>}
        {error && <div className="warning">{error}</div>}
      </>}
      {!plan && error && <div className="warning">{error}</div>}
      {progress && <p className="subtle-note">{progress}</p>}
    </div>
    <footer className="form-footer">
      <button type="button" className="secondary" onClick={close} disabled={locked}>{done !== null ? 'Yopish' : 'Bekor qilish'}</button>
      <button type="button" className="primary" onClick={() => void submit()} disabled={locked || !actionable.length}><Upload size={16} />{phase === 'saving' ? 'Saqlanmoqda…' : `${actionable.length || 0} ta pozitsiyani import qilish`}</button>
    </footer>
  </Dialog>;
}

function commandFor(state: State, row: ItemImportPlanRow, photo: string | undefined): Command {
  if (row.action === 'create') {
    return {
      type: 'item.create', name: row.name, unit: row.unit, minQty: row.minQty, cost: row.cost,
      customerId: null, kind: row.kind, salePrice: row.salePrice, category: row.category,
      openQty: row.openQty, ...(photo ? { photo } : {}),
    };
  }
  const target = state.items.find((item): item is Item => item.id === row.existingId);
  if (!target) throw new Error(`${row.name} — pozitsiya topilmadi`);
  return {
    type: 'item.update', itemId: target.id, name: target.name,
    unit: row.unitGiven ? row.unit : target.unit,
    minQty: row.minQtyGiven ? row.minQty : target.minQty,
    salePrice: row.salePriceGiven ? row.salePrice : target.salePrice,
    category: row.categoryGiven ? row.category : target.category,
    ...(photo ? { photo } : {}),
  };
}
