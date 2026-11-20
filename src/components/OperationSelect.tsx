import { operationGroups } from '../operation-groups';
import { money } from '../ui';
import type { Machine, Operation } from '../types';

export function OperationSelect({ operations, machines, value, onChange, ariaLabel, disabled, withPrice }: {
  operations: Operation[];
  machines: Machine[];
  value: string;
  onChange: (operationId: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  withPrice?: boolean;
}) {
  return <select aria-label={ariaLabel} required value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
    <option value="">Bosqichni tanlang</option>
    {operationGroups(operations, machines).map(group => <optgroup key={group.id} label={`${group.label} · ${group.operations.length} ta`}>
      {group.operations.map(row => <option key={row.id} value={row.id}>{withPrice ? `${row.name} · ${money(row.salePrice)}` : row.name}</option>)}
    </optgroup>)}
  </select>;
}
