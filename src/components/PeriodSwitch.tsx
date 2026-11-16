import { periodEnd, periodStart, type PeriodKind } from '../analytics';

const kinds: { value: PeriodKind; label: string }[] = [
  { value: 'day', label: 'Kun' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
];

export function PeriodSwitch({ value, onChange }: { value: PeriodKind; onChange: (kind: PeriodKind) => void }) {
  return <div className="segmented tight" aria-label="Davr turi">{kinds.map(kind => <button key={kind.value} type="button" className={value === kind.value ? 'selected' : ''} onClick={() => onChange(kind.value)}>{kind.label}</button>)}</div>;
}

export function periodTitle(key: string, kind: PeriodKind): string {
  if (kind !== 'week') return key;
  return `${periodStart(key, kind)} — ${periodEnd(key, kind)}`;
}
