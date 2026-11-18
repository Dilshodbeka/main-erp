import { describe, expect, it } from 'vitest';
import { presetName } from './components/AccessPanel';
import { PRESETS } from './permissions';

describe('presetName', () => {
  it('treats missing permissions from the server as no rights instead of crashing', () => {
    expect(presetName(undefined as unknown as string[])).toBe('Huquqlarsiz');
    expect(presetName(null as unknown as string[])).toBe('Huquqlarsiz');
  });

  it('keeps an empty array matching the empty chief preset', () => {
    expect(presetName([])).toBe('Ishlab chiqarish ustasi');
  });

  it('still names an exact preset when rights match', () => {
    expect(presetName([...PRESETS['Kassir']])).toBe('Kassir');
  });
});
