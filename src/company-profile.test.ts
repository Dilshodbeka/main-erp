import { describe, expect, it } from 'vitest';
import { DEMO_COMPANY, NO_COMPANY, loadCompanyProfile, saveCompanyPhone } from './company-profile';

describe('company profile', () => {
  it('reads the firm block the customer document is signed with', async () => {
    const stored = { name: 'Aliya Mebel', phone: '+998 90 123 45 67' };
    expect(await loadCompanyProfile(async () => stored)).toEqual(stored);
  });

  it('signs with nothing when the company row cannot be read', async () => {
    expect(await loadCompanyProfile(async () => null)).toEqual(NO_COMPANY);
    expect(await loadCompanyProfile(async () => { throw new Error('Authentication required'); })).toEqual(NO_COMPANY);
  });

  it('labels the local demo company', () => {
    expect(DEMO_COMPANY.name.length).toBeGreaterThan(1);
    expect(DEMO_COMPANY.phone).toBe('');
  });

  it('saves the phone without the spaces the owner pasted', async () => {
    const sent: string[] = [];
    expect(await saveCompanyPhone('  +998 90 123 45 67  ', async phone => { sent.push(phone); return phone; })).toBe('+998 90 123 45 67');
    expect(sent).toEqual(['+998 90 123 45 67']);
  });

  it('lets a rejected phone reach the caller unchanged', async () => {
    await expect(saveCompanyPhone('+998 90 123 45 67', async () => { throw new Error('Administrator required'); })).rejects.toThrow('Administrator required');
  });
});
