import { afterEach, describe, expect, it } from 'vitest';
import { INDUSTRIES, addGroup, addLeaf, groupsOf, loadCompanySettings, nextCode, parseClassifier, parseSettings, presetGroups, saveCompanySettings } from './classifier';
import { FURNITURE_GROUPS, applyWarehouseGroups, categoryCodes, categoryLabel, categoryPattern, isCategoryCode, warehouseGroups } from './warehouse';

afterEach(() => applyWarehouseGroups(FURNITURE_GROUPS));

describe('classifier presets', () => {
  it('every industry has valid, unique codes the kernel accepts', () => {
    for (const { id } of INDUSTRIES) {
      const groups = presetGroups(id);
      const codes = groups.flatMap(group => group.children.map(leaf => leaf.code));
      expect(groups.length).toBeGreaterThan(3);
      expect(new Set(codes).size).toBe(codes.length);
      expect(codes.every(code => categoryPattern.test(code))).toBe(true);
      expect(parseClassifier(groups)).toEqual(groups);
    }
  });

  it('a company without settings keeps the furniture classifier', () => {
    expect(groupsOf(parseSettings(null))).toEqual(FURNITURE_GROUPS);
    expect(groupsOf(parseSettings({ industry: 'sewing' }))[0].name).toBe('Gazlamalar');
    expect(parseSettings({ industry: 'rockets' }).industry).toBe('furniture');
  });

  it('switching the classifier changes what every screen reads', () => {
    expect(categoryLabel('01.01')).toBe('01.01 · LDSP');
    applyWarehouseGroups(presetGroups('sewing'));
    expect(warehouseGroups[0].name).toBe('Gazlamalar');
    expect(categoryLabel('01.01')).toBe('01.01 · Asosiy gazlama');
    expect(isCategoryCode('01.01')).toBe(true);
    expect(isCategoryCode('07.05')).toBe(false);
    expect(categoryCodes).toContain('03.05');
  });
});

describe('editing', () => {
  it('drops broken rows, keeps stored codes', () => {
    expect(parseClassifier([{ code: '02', name: '  Kimyo ', children: [{ code: '02.07', name: 'Lak' }, { code: '03.01', name: 'begona' }, { code: '02.08', name: '' }] },
      { code: 'x', name: 'Yomon' }, { code: '02', name: 'Takror' }]))
      .toEqual([{ code: '02', name: 'Kimyo', children: [{ code: '02.07', name: 'Lak' }] }]);
    expect(parseClassifier([])).toBeNull();
    expect(parseClassifier('nope')).toBeNull();
  });

  it('new groups and leaves get the next free code', () => {
    expect(nextCode(['01', '02', '05'])).toBe('06');
    expect(nextCode(['01.01', '01.02'], '01.')).toBe('01.03');
    const grown = addLeaf(addGroup(presetGroups('general')), '07');
    expect(grown.at(-1)).toEqual({ code: '07', name: '', children: [{ code: '07.01', name: '' }] });
  });

  it('demo mode keeps the settings in the browser, per company', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    await saveCompanySettings(null, 'c1', { industry: 'metal', classifier: null }, storage);
    expect((await loadCompanySettings(null, 'c1', storage)).industry).toBe('metal');
    expect((await loadCompanySettings(null, 'c2', storage)).industry).toBe('furniture');
  });
});
