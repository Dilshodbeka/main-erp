import type { Machine, Operation } from './types';

export interface OperationGroup {
  id: string;
  label: string;
  operations: Operation[];
}

export function operationGroups(operations: Operation[], machines: Machine[]): OperationGroup[] {
  const ordered = [...machines].sort((a, b) => a.name.localeCompare(b.name));
  const buckets = new Map<string, Operation[]>(ordered.map(row => [row.id, []]));
  buckets.set('none', []);
  for (const row of operations) {
    const key = row.machineId && buckets.has(row.machineId) ? row.machineId : 'none';
    buckets.get(key)!.push(row);
  }
  const byName = (a: Operation, b: Operation) => a.name.localeCompare(b.name);
  const groups: OperationGroup[] = [];
  const none = buckets.get('none')!.sort(byName);
  if (none.length) groups.push({ id: 'none', label: 'Dastgohsiz', operations: none });
  for (const machine of ordered) {
    const list = buckets.get(machine.id)!.sort(byName);
    if (list.length) groups.push({ id: machine.id, label: machine.name, operations: list });
  }
  return groups;
}
