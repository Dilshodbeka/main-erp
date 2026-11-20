import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

function dedicatedTypes(): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/modal\?\.type === '([a-zA-Z]+)'/g)) found.add(match[1]);
  return [...found].sort();
}

function excludedTypes(): string[] {
  const match = source.match(/!\[([^\]]*)\]\.includes\(modal\.type\)/);
  if (!match) throw new Error('Fallback dialog exclusion list not found');
  return [...match[1].matchAll(/'([a-zA-Z]+)'/g)].map(row => row[1]);
}

describe('modal dialog fallback contract', () => {
  it('App.tsx keeps a dedicated renderer apart from the generic fallback dialog', () => {
    expect(dedicatedTypes().length).toBeGreaterThanOrEqual(10);
    expect(excludedTypes()).toContain('route');
  });

  it('every dedicated modal renderer is excluded from the generic fallback dialog', () => {
    const excluded = excludedTypes();
    expect(dedicatedTypes().filter(type => !excluded.includes(type))).toEqual([]);
  });
});
