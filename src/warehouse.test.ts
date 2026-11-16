import { describe, expect, it } from 'vitest';
import { categoryCodes, categoryGroupName, categoryLabel, isCategoryCode, warehouseGroups } from './warehouse';

describe('paint warehouse group', () => {
  it('adds group 06 with six leaves', () => {
    const group = warehouseGroups.find(row => row.code === '06');
    expect(group?.name).toBe('Bo‘yoq va kimyo');
    expect(group?.children.map(leaf => leaf.code)).toEqual(['06.01', '06.02', '06.03', '06.04', '06.05', '06.06']);
  });
  it('recognizes the new codes', () => {
    expect(isCategoryCode('06.01')).toBe(true);
    expect(categoryCodes).toContain('06.06');
    expect(categoryGroupName('06.02')).toBe('Bo‘yoq va kimyo');
    expect(categoryLabel('06.01')).toBe('06.01 · Bo‘yoq');
  });
  it('keeps abrasives in group 07', () => {
    expect(categoryGroupName('07.03')).toBe('Sarf materiallari');
    expect(categoryLabel('07.03')).toBe('07.03 · Abrazivlar');
  });
});