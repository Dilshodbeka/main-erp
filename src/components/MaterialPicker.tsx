import { useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { searchMaterialGroups, type MaterialGroup } from '../order-editor';
import type { Item } from '../types';

export function MaterialPickerPanel({ groups, value, query, onQuery, onPick, onClose, describe, clearLabel }: {
  groups: MaterialGroup[];
  value: string;
  query: string;
  onQuery: (query: string) => void;
  onPick: (itemId: string) => void;
  onClose?: () => void;
  describe?: (item: Item) => string;
  clearLabel?: string;
}) {
  const rows = searchMaterialGroups(groups, query);
  const total = rows.reduce((sum, group) => sum + group.items.length, 0);
  return <div className="material-picker-panel" role="dialog" aria-label="Materialni tanlash">
    <div className="material-picker-search">
      <Search size={15} />
      <input autoFocus value={query} onChange={event => onQuery(event.target.value)} placeholder="Nom yoki guruh: LDSP, kromka…" aria-label="Material qidiruvi" />
      {onClose && <button type="button" className="icon-button" onClick={onClose} aria-label="Yopish"><X size={15} /></button>}
    </div>
    <div className="material-picker-list">
      {clearLabel && <button type="button" className={value ? 'material-option' : 'material-option selected'} onClick={() => onPick('')}>
        <span><b>{clearLabel}</b></span>
        {!value && <Check size={15} />}
      </button>}
      {rows.map(group => <section key={group.category}>
        <h4>{group.category}<span>{group.items.length}</span></h4>
        {group.items.map(item => {
          const hint = describe?.(item);
          return <button type="button" key={item.id} className={item.id === value ? 'material-option selected' : 'material-option'} onClick={() => onPick(item.id)}>
            <span><b>{item.name}</b>{hint ? <small>{hint}</small> : null}</span>
            {item.id === value && <Check size={15} />}
          </button>;
        })}
      </section>)}
      {!total && <p className="subtle-note">Hech narsa topilmadi. Nomning bir qismini yozib ko‘ring.</p>}
    </div>
  </div>;
}

export function MaterialPicker({ groups, value, onChange, label, placeholder = 'Materialni tanlang', describe, disabled, clearLabel }: {
  groups: MaterialGroup[];
  value: string;
  onChange: (itemId: string) => void;
  label: string;
  placeholder?: string;
  describe?: (item: Item) => string;
  disabled?: boolean;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = groups.flatMap(group => group.items).find(item => item.id === value);
  const hint = selected ? describe?.(selected) : undefined;
  const close = () => { setOpen(false); setQuery(''); };
  const pick = (itemId: string) => { onChange(itemId); close(); };

  if (disabled) return <div className="material-picker-static" aria-label={label}>
    <b>{selected?.name ?? placeholder}</b>
    {hint ? <small>{hint}</small> : null}
  </div>;

  return <div className="material-picker">
    <button type="button" className={selected ? 'material-picker-button chosen' : 'material-picker-button'}
      aria-expanded={open} aria-haspopup="dialog" aria-label={label}
      onClick={() => { if (open) close(); else { setOpen(true); setQuery(''); } }}>
      {selected
        ? <><span><b>{selected.name}</b>{hint ? <small>{hint}</small> : null}</span><em>O‘zgartirish</em></>
        : <span><b>{placeholder}</b><small>Nom bo‘yicha qidirish mumkin</small></span>}
    </button>
    {open && <MaterialPickerPanel groups={groups} value={value} query={query} onQuery={setQuery} onPick={pick} onClose={close} describe={describe} clearLabel={clearLabel} />}
  </div>;
}
