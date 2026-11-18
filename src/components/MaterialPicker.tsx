import { Fragment, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { money } from '../ui';
import { searchMaterialGroups, type MaterialGroup } from '../order-editor';
import type { Item } from '../types';

const sumOf = (item: Item, qty?: number) => money((qty ?? 0) * (item.customerId ? 0 : item.cost));

export function MaterialPickerPanel({ groups, value, query, onQuery, onPick, onClose, describe, clearLabel, qty }: {
  groups: MaterialGroup[];
  value: string;
  query: string;
  onQuery: (query: string) => void;
  onPick: (itemId: string) => void;
  onClose?: () => void;
  describe?: (item: Item) => string;
  clearLabel?: string;
  qty?: number;
}) {
  const rows = searchMaterialGroups(groups, query);
  const total = rows.reduce((sum, group) => sum + group.items.length, 0);
  const span = qty === undefined ? 3 : 4;
  return <div className="material-picker-panel" role="dialog" aria-label="Materialni tanlash">
    <div className="material-picker-search">
      <Search size={15} />
      <input autoFocus value={query} onChange={event => onQuery(event.target.value)} placeholder="Nom yoki guruh: LDSP, kromka…" aria-label="Material qidiruvi" />
      {onClose && <button type="button" className="icon-button" onClick={onClose} aria-label="Yopish"><X size={15} /></button>}
    </div>
    <div className="material-picker-list table-scroll cardable">
      {!total && <p className="subtle-note">Hech narsa topilmadi. Nomning bir qismini yozib ko‘ring.</p>}
      {total > 0 && <table className="material-table">
        <thead><tr><th>Material</th><th>Holati</th><th className="right">Tannarx</th>{qty !== undefined && <th className="right">Summa</th>}</tr></thead>
        <tbody>
          {clearLabel && <tr className={value ? 'material-row' : 'material-row selected'} onClick={() => onPick('')}>
            <td data-label="Material" colSpan={span}>
              <button type="button" className="material-row-button" onClick={event => { event.stopPropagation(); onPick(''); }}>
                <b>{clearLabel}</b>{!value && <Check size={15} />}
              </button>
            </td>
          </tr>}
          {rows.map(group => <Fragment key={group.category}>
            <tr className="material-group-row"><th colSpan={span}>{group.category}<span>{group.items.length}</span></th></tr>
            {group.items.map(item => {
              const hint = describe?.(item);
              const selected = item.id === value;
              return <tr key={item.id} className={selected ? 'material-row selected' : 'material-row'} onClick={() => onPick(item.id)}>
                <td data-label="Material">
                  <button type="button" className="material-row-button" onClick={event => { event.stopPropagation(); onPick(item.id); }}>
                    {item.name}{selected && <Check size={15} />}
                  </button>
                </td>
                <td data-label="Holati">{hint ?? '—'}</td>
                <td data-label="Tannarx" className="right">{money(item.cost)}</td>
                {qty !== undefined && <td data-label="Summa" className="right">{sumOf(item, qty)}</td>}
              </tr>;
            })}
          </Fragment>)}
        </tbody>
      </table>}
    </div>
  </div>;
}

export function MaterialPicker({ groups, value, onChange, label, placeholder = 'Materialni tanlang', describe, disabled, clearLabel, qty }: {
  groups: MaterialGroup[];
  value: string;
  onChange: (itemId: string) => void;
  label: string;
  placeholder?: string;
  describe?: (item: Item) => string;
  disabled?: boolean;
  clearLabel?: string;
  qty?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = groups.flatMap(group => group.items).find(item => item.id === value);
  const hint = selected ? describe?.(selected) : undefined;
  const sums = selected && qty !== undefined ? ` · summa ${sumOf(selected, qty)}` : '';
  const close = () => { setOpen(false); setQuery(''); };
  const pick = (itemId: string) => { onChange(itemId); close(); };

  if (disabled) return <div className="material-picker-static" aria-label={label}>
    <b>{selected?.name ?? placeholder}</b>
    {hint ? <small>{hint}{sums}</small> : null}
  </div>;

  return <div className="material-picker">
    <button type="button" className={selected ? 'material-picker-button chosen' : 'material-picker-button'}
      aria-expanded={open} aria-haspopup="dialog" aria-label={label}
      onClick={() => { if (open) close(); else { setOpen(true); setQuery(''); } }}>
      {selected
        ? <><span><b>{selected.name}</b>{hint ? <small>{hint}{sums}</small> : null}</span><em>O‘zgartirish</em></>
        : <span><b>{placeholder}</b><small>Nom bo‘yicha qidirish mumkin</small></span>}
    </button>
    {open && <MaterialPickerPanel groups={groups} value={value} query={query} onQuery={setQuery} onPick={pick} onClose={close} describe={describe} clearLabel={clearLabel} qty={qty} />}
  </div>;
}
