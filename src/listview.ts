export type SortDirection = 'asc' | 'desc';

export type SortValue = string | number | null | undefined;

export interface SortOption<T, K extends string = string> {
  value: K; label: string; get: (row: T) => SortValue;
}

export interface SortState<K extends string = string> {
  field: K; direction: SortDirection;
}

function fold(value: string): string {
  return value.toLocaleLowerCase('uz').replace(/[‘’ʻʼ`]/g, "'");
}

export function matchesQuery(values: SortValue[], query: string): boolean {
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = values.filter(value => value !== null && value !== undefined).map(value => fold(String(value)));
  return words.every(word => haystack.some(value => value.includes(word)));
}

export function phoneDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

export function matchesSearch(query: string, values: SortValue[], phone?: string | null): boolean {
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = values.filter(value => value !== null && value !== undefined).map(value => fold(String(value)));
  const digits = phoneDigits(phone ?? '');
  return words.every(word => {
    const numeric = phoneDigits(word);
    if (numeric.length >= 2 && digits.includes(numeric)) return true;
    return haystack.some(value => value.includes(fold(word)));
  });
}

function isEmpty(value: SortValue): boolean {
  return value === null || value === undefined || value === '';
}

function compare(left: SortValue, right: SortValue): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), 'uz', { numeric: true, sensitivity: 'base' });
}

export function sortRows<T, K extends string>(rows: T[], options: SortOption<T, K>[], sort: SortState<K> | null): T[] {
  const option = sort ? options.find(row => row.value === sort.field) : undefined;
  if (!sort || !option) return [...rows];
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = option.get(left);
    const b = option.get(right);
    if (isEmpty(a) || isEmpty(b)) return isEmpty(a) ? (isEmpty(b) ? 0 : 1) : -1;
    return compare(a, b) * factor;
  });
}

export function toggleSort<K extends string>(current: SortState<K> | null, field: K): SortState<K> {
  return current?.field === field
    ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { field, direction: 'asc' };
}
