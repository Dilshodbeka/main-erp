import { mode, supabase } from './repository';

export interface CompanyProfile {
  name: string;
  phone: string;
}

export const DEMO_COMPANY: CompanyProfile = { name: 'Aliya Mebel', phone: '' };
export const NO_COMPANY: CompanyProfile = { name: '', phone: '' };

type CompanyRow = { name: string | null; phone: string | null };

async function currentRow(): Promise<CompanyProfile | null> {
  if (mode === 'demo') return DEMO_COMPANY;
  const { data, error } = await supabase!.from('erp_companies').select('name, phone').maybeSingle<CompanyRow>();
  if (error) throw new Error(error.message);
  return data ? { name: data.name ?? '', phone: data.phone ?? '' } : null;
}

async function writePhone(phone: string): Promise<string> {
  const { data, error } = await supabase!.rpc('erp_company_profile_set', { p_phone: phone });
  if (error) throw new Error(error.message);
  return String(data ?? '');
}

// A document the customer receives is never signed with an invented firm, so an unreadable row yields no block at all.
export async function loadCompanyProfile(read: () => Promise<CompanyProfile | null> = currentRow): Promise<CompanyProfile> {
  try { return (await read()) ?? NO_COMPANY; }
  catch { return NO_COMPANY; }
}

export async function saveCompanyPhone(phone: string, call: (phone: string) => Promise<string> = writePhone): Promise<string> {
  return call(phone.trim());
}
