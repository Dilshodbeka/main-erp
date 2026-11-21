import { useMemo, useState } from 'react';
import { FileUp } from 'lucide-react';
import { decodeReport, matchCutRows, numberColumns, parseCutText, readCutNames, rememberCutNames, type CutMatch, type QtyColumn } from '../cut-import';
import type { Item } from '../types';
import { errorText, num } from '../ui';

// Raskroy hisobotidan (BAZIS, SketchCut, Excel) materiallarni pozitsiyaga qo‘shish.
export function CutImport({ items, companyId, onApply, close }: {
  items: Item[]; companyId: string; onApply: (matches: CutMatch[]) => void; close: () => void;
}) {
  const [text, setText] = useState('');
  const [column, setColumn] = useState<QtyColumn>('last');
  const [edits, setEdits] = useState<Record<number, Partial<CutMatch>>>({});
  const [error, setError] = useState('');
  const rows = useMemo(() => parseCutText(text), [text]);
  const matches = useMemo(() => matchCutRows(rows, items, column, readCutNames(companyId)).map((row, index) => ({ ...row, ...edits[index] })), [rows, items, column, companyId, edits]);
  const chosen = matches.filter(row => row.itemId && row.qty > 0);
  const columns = numberColumns(rows);
  const edit = (index: number, patch: Partial<CutMatch>) => setEdits(old => ({ ...old, [index]: { ...old[index], ...patch } }));
  const open = async (file: File | undefined) => {
    if (!file) return;
    if (/\.(xlsx?|pdf)$/i.test(file.name)) { setError('Excel yoki PDF faylni ochib, jadvalni nusxalang va shu yerga qo‘ying. Fayl sifatida faqat CSV va TXT o‘qiladi.'); return; }
    try { setText(decodeReport(await file.arrayBuffer())); setEdits({}); setError(''); } catch (e) { setError(errorText(e)); }
  };
  return <div className="cut-import">
    <div className="cut-import-head">
      <div><b>Raskroy hisobotidan</b><small>BAZIS, SketchCut yoki Excel hisobotidagi materiallar jadvalini nusxalab shu yerga qo‘ying (nom va miqdor).</small></div>
      <label className="secondary small cut-file"><FileUp size={14} />CSV / TXT<input type="file" accept=".csv,.txt,.tsv,text/plain,text/csv" onChange={event => { void open(event.target.files?.[0]); event.target.value = ''; }} /></label>
    </div>
    <textarea aria-label="Raskroy hisoboti" rows={4} value={text} placeholder={'ЛДСП Egger 16 мм\t5\nКромка ПВХ 0.4\t86,5'} onChange={event => { setText(event.target.value); setEdits({}); setError(''); }} />
    {error && <p className="warning">{error}</p>}
    {rows.length > 0 && <>
      {columns > 1 && <label className="cut-column"><span>Miqdor qaysi ustunda</span><select value={String(column)} onChange={event => { setColumn(event.target.value === 'last' ? 'last' : Number(event.target.value)); setEdits({}); }}>
        <option value="last">Oxirgi son</option>{Array.from({ length: columns }, (_, index) => <option key={index} value={index}>{`${index + 1}-son`}</option>)}</select></label>}
      <div className="cut-rows">{matches.map((row, index) => <div className={row.itemId ? 'cut-row' : 'cut-row unmatched'} key={index}>
        <span title={row.name}>{row.name}</span>
        <input aria-label={`Miqdor: ${row.name}`} type="number" min="0" step="0.001" value={row.qty || ''} onChange={event => edit(index, { qty: Number(event.target.value) })} />
        <select aria-label={`Material: ${row.name}`} value={row.itemId ?? ''} onChange={event => edit(index, { itemId: event.target.value || null })}>
          <option value="">— o‘tkazib yuborish —</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </div>)}</div>
      <small className="cut-note">{`Topildi: ${num(chosen.length)} / ${num(matches.length)}. Topilmaganini ro‘yxatdan tanlang — keyingi safar tizim o‘zi eslab qoladi.`}</small>
    </>}
    {text.trim() !== '' && !rows.length && <p className="info-note">Jadval o‘qilmadi: har bir qatorda material nomi va miqdor bo‘lishi kerak.</p>}
    <div className="button-group">
      <button type="button" className="secondary small" onClick={close}>Yopish</button>
      <button type="button" className="primary small" disabled={!chosen.length} onClick={() => { rememberCutNames(companyId, chosen); onApply(chosen); close(); }}>{chosen.length ? `Qo‘shish (${chosen.length})` : 'Qo‘shish'}</button>
    </div>
  </div>;
}
