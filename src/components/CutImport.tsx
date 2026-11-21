import { useMemo, useState } from 'react';
import { FileUp } from 'lucide-react';
import { convertUnits, decodeReport, matchCutRows, matchWorks, numberColumns, parseCutTable, parseCutText, parseCutWorks, readCutNames, readSpreadsheet, rememberCutNames, rememberWorkNames, unitMismatch, type CutMatch, type QtyColumn, type WorkMatch } from '../cut-import';
import type { Operation } from '../types';
import type { Item } from '../types';
import { errorText, num } from '../ui';

// Raskroy hisobotidan (BAZIS, SketchCut, Excel) materiallarni pozitsiyaga qo‘shish.
export function CutImport({ items, operations, companyId, onApply, close }: {
  items: Item[]; operations: Operation[]; companyId: string; onApply: (matches: CutMatch[], works: WorkMatch[]) => void; close: () => void;
}) {
  const [text, setText] = useState('');
  const [column, setColumn] = useState<QtyColumn>('last');
  const [edits, setEdits] = useState<Record<number, Partial<CutMatch>>>({});
  const [error, setError] = useState('');
  const [file, setFile] = useState<{ name: string; table: string[][] } | null>(null);
  const rows = useMemo(() => file ? parseCutTable(file.table) : parseCutText(text), [text, file]);
  // Avval tanlangan material bo‘yicha m² ↔ list qayta hisoblanadi, keyin qo‘lda o‘zgartirilgan son ustun.
  const matches = useMemo(() => matchCutRows(rows, items, column, readCutNames(companyId)).map((row, index) => {
    const picked = { ...row, ...(edits[index]?.itemId !== undefined ? { itemId: edits[index].itemId ?? null } : {}) };
    const converted = convertUnits(picked, items);
    return edits[index]?.qty !== undefined ? { ...converted, qty: edits[index].qty! } : converted;
  }), [rows, items, column, companyId, edits]);
  const chosen = matches.filter(row => row.itemId && row.qty > 0);
  const [workEdits, setWorkEdits] = useState<Record<number, Partial<WorkMatch>>>({});
  const works = useMemo(() => file ? matchWorks(parseCutWorks(file.table), operations, readCutNames(companyId)).map((row, index) => ({ ...row, ...workEdits[index] })) : [],
    [file, operations, companyId, workEdits]);
  const chosenWorks = works.filter(row => row.operationId && row.qty > 0);
  const columns = numberColumns(rows);
  const edit = (index: number, patch: Partial<CutMatch>) => setEdits(old => ({ ...old, [index]: { ...old[index], ...patch } }));
  const open = async (picked: File | undefined) => {
    if (!picked) return;
    if (/\.pdf$/i.test(picked.name)) { setError('PDF o‘qilmaydi: BAZIS’da hisobotni Excel’ga saqlang yoki jadvalni nusxalang.'); return; }
    try {
      const bytes = await picked.arrayBuffer();
      const table = /\.(xlsx|xls|ods)$/i.test(picked.name) ? await readSpreadsheet(bytes) : decodeReport(bytes).replace(/\r/g, '').split('\n').map(line => line.split(/\t|;/));
      setFile({ name: picked.name, table }); setText(''); setEdits({}); setError('');
    } catch (e) { setError(`Fayl o‘qilmadi: ${errorText(e)}`); }
  };
  return <div className="cut-import">
    <div className="cut-import-head">
      <div><b>Raskroy hisobotidan</b><small>BAZIS-Mebelshchik hisobotini (Excel) oching yoki jadvalni nusxalab shu yerga qo‘ying. «Наименование» va «Кол-во» ustunlari o‘zi topiladi.</small></div>
      <label className="secondary small cut-file"><FileUp size={14} />Excel / CSV<input type="file" accept=".xlsx,.xls,.ods,.csv,.txt,.tsv" onChange={event => { void open(event.target.files?.[0]); event.target.value = ''; }} /></label>
    </div>
    {file ? <p className="cut-file-name"><b>{file.name}</b><button type="button" className="text-button" onClick={() => { setFile(null); setEdits({}); setWorkEdits({}); }}>Boshqa</button></p> : <textarea aria-label="Raskroy hisoboti" rows={4} value={text} placeholder={'ЛДСП Egger 16 мм\t5\nКромка ПВХ 0.4\t86,5'} onChange={event => { setText(event.target.value); setEdits({}); setError(''); }} />}
    {error && <p className="warning">{error}</p>}
    {rows.length > 0 && <>
      {columns > 1 && <label className="cut-column"><span>Miqdor qaysi ustunda</span><select value={String(column)} onChange={event => { setColumn(event.target.value === 'last' ? 'last' : Number(event.target.value)); setEdits({}); }}>
        <option value="last">Oxirgi son</option>{Array.from({ length: columns }, (_, index) => <option key={index} value={index}>{`${index + 1}-son`}</option>)}</select></label>}
      <div className="cut-rows">{matches.map((row, index) => <div className={row.itemId ? 'cut-row' : 'cut-row unmatched'} key={index}>
        <span title={row.name}>{row.name}{row.unit ? <small>{row.unit}</small> : null}{row.from ? <small className="cut-conv">{`${num(row.from.qty)} ${row.from.unit} → ${num(row.qty)} ${row.unit} (list ${num(row.from.area)} m²)`}</small>
          : unitMismatch(row, items) ? <small className="cut-warn">{`ombordagi o‘lchov: ${items.find(item => item.id === row.itemId)?.unit ?? ''} — miqdorni tekshiring`}</small> : null}</span>
        <input aria-label={`Miqdor: ${row.name}`} type="number" min="0" step="0.001" value={row.qty || ''} onChange={event => edit(index, { qty: Number(event.target.value) })} />
        <select aria-label={`Material: ${row.name}`} value={row.itemId ?? ''} onChange={event => edit(index, { itemId: event.target.value || null })}>
          <option value="">— o‘tkazib yuborish —</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </div>)}</div>
      {works.length > 0 && <>
        <b className="cut-subhead">{`Ishlar → marshrut bosqichlari (${chosenWorks.length} / ${works.length})`}</b>
        <div className="cut-rows">{works.map((row, index) => <div className={row.operationId ? 'cut-row' : 'cut-row unmatched'} key={`w${index}`}>
          <span title={row.name}>{row.name}<small>{row.unit}</small></span>
          <input aria-label={`Hajm: ${row.name}`} type="number" min="0" step="0.001" value={row.qty || ''} onChange={event => setWorkEdits(old => ({ ...old, [index]: { ...old[index], qty: Number(event.target.value) } }))} />
          <select aria-label={`Operatsiya: ${row.name}`} value={row.operationId ?? ''} onChange={event => setWorkEdits(old => ({ ...old, [index]: { ...old[index], operationId: event.target.value || null } }))}>
            <option value="">— qo‘shmaslik —</option>{operations.filter(operation => operation.active).map(operation => <option key={operation.id} value={operation.id}>{operation.name}</option>)}</select>
        </div>)}</div>
      </>}
      <small className="cut-note">{`Topildi: ${num(chosen.length)} / ${num(matches.length)}. Topilmaganini ro‘yxatdan tanlang — keyingi safar tizim o‘zi eslab qoladi.`}</small>
    </>}
    {(text.trim() !== '' || file) && !rows.length && <p className="info-note">Jadval o‘qilmadi: har bir qatorda material nomi va miqdor bo‘lishi kerak.</p>}
    <div className="button-group">
      <button type="button" className="secondary small" onClick={close}>Yopish</button>
      <button type="button" className="primary small" disabled={!chosen.length && !chosenWorks.length} onClick={() => { rememberCutNames(companyId, chosen); rememberWorkNames(companyId, chosenWorks); onApply(chosen, chosenWorks); close(); }}>{chosen.length + chosenWorks.length ? `Qo‘shish (${chosen.length + chosenWorks.length})` : 'Qo‘shish'}</button>
    </div>
  </div>;
}
