import type { SortState } from '../listview';

export function SortSelect<K extends string>({ value, onChange, options, label = 'Saralash maydoni' }: {
  value: SortState<K> | null;
  onChange: (next: SortState<K> | null) => void;
  options: readonly { value: K; label: string }[];
  label?: string;
}) {
  const direction = value?.direction ?? 'asc';
  return <span className="sort-select">
    <select aria-label={label} value={value?.field ?? ''} onChange={event => {
      const field = event.target.value as K | '';
      onChange(field ? { field, direction } : null);
    }}>
      <option value="">Saralashsiz</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {value && <button type="button" className="icon-button" aria-label={direction === 'asc' ? 'Kamayish tartibida saralash' : 'O‘sish tartibida saralash'} title={direction === 'asc' ? 'O‘sish → kamayish' : 'Kamayish → o‘sish'} onClick={() => onChange({ field: value.field, direction: direction === 'asc' ? 'desc' : 'asc' })}>{direction === 'asc' ? '↑' : '↓'}</button>}
  </span>;
}
