import { describe, expect, it } from 'vitest';
import { matchesQuery, matchesSearch, phoneDigits, sortRows, toggleSort, type SortOption } from './listview';

interface Row { name: string; amount: number | null; due: string }

const rows: Row[] = [
  { name: 'Aliya Mebel', amount: 500, due: '2026-12-10' },
  { name: 'Bektemir', amount: null, due: '2026-11-02' },
  { name: 'chevar', amount: 100, due: '2026-12-01' },
];

const options: SortOption<Row>[] = [
  { value: 'name', label: 'Nomi', get: row => row.name },
  { value: 'amount', label: 'Summa', get: row => row.amount },
  { value: 'due', label: 'Muddat', get: row => row.due },
];

describe('matchesQuery', () => {
  it('accepts everything for an empty query', () => {
    expect(matchesQuery([null, undefined], '')).toBe(true);
    expect(matchesQuery(['Fabric'], '   ')).toBe(true);
  });

  it('matches case-insensitively across several fields', () => {
    expect(matchesQuery(['Aliya', 'ORD-0012'], 'ord-0012')).toBe(true);
    expect(matchesQuery(['Aliya', 'ORD-0012'], 'aliya ord')).toBe(true);
    expect(matchesQuery(['Aliya', 'ORD-0012'], 'other')).toBe(false);
  });

  it('compares numbers as text and skips empty values', () => {
    expect(matchesQuery([500, null, undefined], '500')).toBe(true);
    expect(matchesQuery([null, undefined], '0')).toBe(false);
  });

  it('folds Uzbek apostrophes so a plain quote finds the word', () => {
    expect(matchesQuery(['O‘zbekiston'], "o'zbek")).toBe(true);
  });
});

describe('matchesSearch with phone numbers', () => {
  const phone = '+998 90 123 45 67';

  it('keeps only digits from a phone', () => {
    expect(phoneDigits(phone)).toBe('998901234567');
    expect(phoneDigits('+998 (90) 123-45-67')).toBe('998901234567');
  });

  it('finds a client by the last 2, 3 or 4 digits regardless of formatting', () => {
    expect(matchesSearch('67', ['Aziza'], phone)).toBe(true);
    expect(matchesSearch('567', ['Aziza'], phone)).toBe(true);
    expect(matchesSearch('4567', ['Aziza'], phone)).toBe(true);
    expect(matchesSearch('45 67', ['Aziza'], phone)).toBe(true);
    expect(matchesSearch('+998 90', ['Aziza'], phone)).toBe(true);
    expect(matchesSearch('0123', ['Aziza'], phone)).toBe(true);
  });

  it('does not match a phone for a single digit', () => {
    expect(matchesSearch('6', ['Aziza'], phone)).toBe(false);
  });

  it('still matches a name and combines name with the phone tail', () => {
    expect(matchesSearch('aziza', ['Aziza'], phone)).toBe(true);
    expect(matchesSearch('aziza 4567', ['Aziza'], phone)).toBe(true);
    expect(matchesSearch('aziza 9999', ['Aziza'], phone)).toBe(false);
  });

  it('behaves like the plain query when there is no phone', () => {
    expect(matchesSearch('ORD-0012', ['ORD-0012', 'Shkaf'])).toBe(true);
    expect(matchesSearch('', ['anything'])).toBe(true);
    expect(matchesSearch('missing', ['ORD-0012'])).toBe(false);
  });
});

describe('sortRows', () => {
  it('returns a copy in the original order without a sort', () => {
    const sorted = sortRows(rows, options, null);
    expect(sorted).toEqual(rows);
    expect(sorted).not.toBe(rows);
  });

  it('sorts numbers ascending and descending', () => {
    expect(sortRows(rows, options, { field: 'amount', direction: 'asc' }).map(row => row.amount)).toEqual([100, 500, null]);
    expect(sortRows(rows, options, { field: 'amount', direction: 'desc' }).map(row => row.amount)).toEqual([500, 100, null]);
  });

  it('sorts text with locale rules', () => {
    expect(sortRows(rows, options, { field: 'name', direction: 'asc' }).map(row => row.name))
      .toEqual(['Aliya Mebel', 'Bektemir', 'chevar']);
    expect(sortRows(rows, options, { field: 'due', direction: 'desc' }).map(row => row.due))
      .toEqual(['2026-12-10', '2026-12-01', '2026-11-02']);
  });

  it('keeps the original order for an unknown field', () => {
    expect(sortRows(rows, options, { field: 'missing', direction: 'asc' })).toEqual(rows);
  });
});

describe('toggleSort', () => {
  it('starts ascending and flips direction on the same field', () => {
    expect(toggleSort(null, 'name')).toEqual({ field: 'name', direction: 'asc' });
    expect(toggleSort({ field: 'name', direction: 'asc' }, 'name')).toEqual({ field: 'name', direction: 'desc' });
    expect(toggleSort({ field: 'amount', direction: 'desc' }, 'name')).toEqual({ field: 'name', direction: 'asc' });
  });
});
