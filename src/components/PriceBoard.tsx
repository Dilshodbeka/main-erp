import { useMemo, useState } from 'react';
import { gapCount, priceCommands, priceGaps, type OperationPrice } from '../price-board';
import { unitLabel } from '../work-view';
import { Section, money, num } from '../ui';
import type { Command, State } from '../types';

// Barcha narx va stavkalar bitta jadvalda: bo‘sh joylar belgilangan, saqlash — bitta tugma.
export function PriceBoard({ state, busy, save }: {
  state: State; busy: boolean; save: (commands: Command[], message: string) => Promise<boolean>;
}) {
  const [operations, setOperations] = useState<Record<string, Partial<OperationPrice>>>({});
  const [items, setItems] = useState<Record<string, number>>({});
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const gaps = useMemo(() => priceGaps(state), [state]);
  const commands = useMemo(() => priceCommands(state, operations, items), [state, operations, items]);
  const total = gapCount(gaps);
  const emptyOperation = new Set([...gaps.operations, ...gaps.norms].map(row => row.id));
  const emptyItem = new Set([...gaps.items, ...gaps.costs].map(row => row.id));
  const operationRows = state.operations.filter(row => row.active && (!onlyEmpty || emptyOperation.has(row.id)));
  const itemRows = state.items.filter(row => row.customerId === null && (onlyEmpty ? emptyItem.has(row.id) : row.kind !== 'material' || row.cost <= 0));
  const cell = (value: number | undefined, fallback: number, change: (next: number) => void, label: string) =>
    <input type="number" min="0" step="0.01" inputMode="decimal" aria-label={label} className={(value ?? fallback) <= 0 ? 'price-input is-empty' : 'price-input'}
      value={value ?? (fallback || '')} placeholder="0" onChange={event => change(event.target.value === '' ? 0 : Number(event.target.value))} />;
  const submit = async () => {
    if (!commands.length) return;
    if (await save(commands, `${commands.length} ta narx saqlandi.`)) { setOperations({}); setItems({}); }
  };
  return <Section title="Narx va stavkalar" hint={total > 0 ? `${total} ta joy to‘ldirilmagan — kalkulyatsiya shu sabab noaniq.` : 'Hamma narx va stavkalar to‘ldirilgan.'}
    action={<div className="section-tools"><label className="check-inline"><input type="checkbox" checked={onlyEmpty} onChange={event => setOnlyEmpty(event.target.checked)} />Faqat bo‘shlari</label><button className="primary small" disabled={busy || !commands.length} onClick={() => void submit()}>{commands.length ? `Saqlash (${commands.length})` : 'Saqlash'}</button></div>}>
    <div className="table-scroll"><table className="price-table"><thead><tr><th>Operatsiya</th><th>O‘lchov</th><th className="right">Mijoz narxi</th><th className="right">Ishchi stavkasi</th><th>Norma</th></tr></thead><tbody>
      {operationRows.map(row => <tr key={row.id}>
        <td data-label="Operatsiya"><b>{row.name}</b></td>
        <td data-label="O‘lchov">{unitLabel(row.unit)}</td>
        <td data-label="Mijoz narxi" className="right">{cell(operations[row.id]?.salePrice, row.salePrice, next => setOperations(old => ({ ...old, [row.id]: { ...old[row.id], salePrice: next } })), `${row.name}: mijoz narxi`)}</td>
        <td data-label="Ishchi stavkasi" className="right">{cell(operations[row.id]?.workerRate, row.workerRate, next => setOperations(old => ({ ...old, [row.id]: { ...old[row.id], workerRate: next } })), `${row.name}: ishchi stavkasi`)}</td>
        <td data-label="Norma">{row.unit !== 'squareMeter' ? <small>kerak emas</small> : row.norms.length ? <small>{`${row.norms.length} ta material`}</small> : <small className="price-missing">norma yo‘q</small>}</td>
      </tr>)}
      {!operationRows.length && <tr><td colSpan={5}><small>{onlyEmpty ? 'Bo‘sh operatsiya yo‘q.' : 'Operatsiyalar hali yaratilmagan.'}</small></td></tr>}
    </tbody></table></div>
    {itemRows.length > 0 && <div className="table-scroll"><table className="price-table"><thead><tr><th>Mahsulot / material</th><th>O‘lchov</th><th className="right">Tannarx</th><th className="right">Sotuv narxi</th></tr></thead><tbody>
      {itemRows.map(row => <tr key={row.id}>
        <td data-label="Mahsulot / material"><b>{row.name}</b></td>
        <td data-label="O‘lchov">{row.unit}</td>
        <td data-label="Tannarx" className="right">{row.cost > 0 ? money(row.cost) : <small className="price-missing">xarid qilinmagan</small>}</td>
        <td data-label="Sotuv narxi" className="right">{row.kind === 'material' ? <small>—</small> : cell(items[row.id], row.salePrice, next => setItems(old => ({ ...old, [row.id]: next })), `${row.name}: sotuv narxi`)}</td>
      </tr>)}
    </tbody></table></div>}
    <p className="subtle-note">{`Material tannarxi xarid qabulidan o‘zi hisoblanadi (${num(gaps.costs.length)} ta material hali xarid qilinmagan). m² bosqich normasi operatsiyani tahrirlash oynasida kiritiladi.`}</p>
  </Section>;
}
