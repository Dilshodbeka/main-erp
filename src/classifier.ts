// Ombor tasniflagichi korxonaga qarab: mebel, tikuvchilik, metall yoki umumiy ishlab chiqarish.
// Tayyor to‘plamdan boshlanadi, keyin guruh va bo‘limlar nomini korxona o‘zi o‘zgartiradi.
// Pozitsiyada faqat kod (masalan, 02.03) saqlanadi, shuning uchun nomni o‘zgartirish xavfsiz.
import type { SupabaseClient } from '@supabase/supabase-js';
import { FURNITURE_GROUPS, type WarehouseGroup } from './warehouse';

export type Industry = 'furniture' | 'general' | 'sewing' | 'metal' | 'doors';
export const INDUSTRIES: { id: Industry; name: string }[] = [
  { id: 'furniture', name: 'Mebel' },
  { id: 'general', name: 'Umumiy ishlab chiqarish' },
  { id: 'sewing', name: 'Tikuvchilik' },
  { id: 'metal', name: 'Metall buyumlar' },
  { id: 'doors', name: 'Eshik va deraza' },
];

const build = (rows: [string, string[]][]): WarehouseGroup[] => rows.map(([name, leaves], index) => {
  const code = String(index + 1).padStart(2, '0');
  return { code, name, children: leaves.map((leaf, position) => ({ code: `${code}.${String(position + 1).padStart(2, '0')}`, name: leaf })) };
});

const PRESETS: Record<Industry, WarehouseGroup[]> = {
  furniture: FURNITURE_GROUPS,
  general: build([
    ['Asosiy xomashyo', ['Asosiy material', 'Yordamchi material', 'Yarim tayyor mahsulot']],
    ['Butlovchi qismlar', ['Butlovchilar', 'Ehtiyot qismlar']],
    ['Mahkamlagichlar', ['Vint va boltlar', 'Boshqa mahkamlagichlar']],
    ['Kimyo va bo‘yoq', ['Bo‘yoq va lak', 'Yelim va germetik', 'Erituvchi']],
    ['Qadoqlash', ['Quti va karton', 'Plyonka va lenta', 'Yorliqlar']],
    ['Sarf materiallari', ['Asbob sarfi', 'Abrazivlar', 'Xo‘jalik mollari']],
  ]),
  sewing: build([
    ['Gazlamalar', ['Asosiy gazlama', 'Astar', 'Trikotaj', 'Qistirma']],
    ['Iplar', ['Tikuv ipi', 'Overlok ipi', 'Bezak ipi']],
    ['Furnitura', ['Tugmalar', 'Zamoklar', 'Rezinka', 'Tasma va lentalar', 'Ilgak va knopkalar']],
    ['Bezak', ['Yorliq va birkalar', 'Kashta va aplikatsiya']],
    ['Qadoqlash', ['Paket', 'Quti', 'Ilgich (veshalka)']],
    ['Sarf materiallari', ['Ignalar', 'Bo‘r va markerlar', 'Moy va ehtiyot qismlar']],
  ]),
  metal: build([
    ['Metall prokat', ['List', 'Quvur', 'Profil', 'Armatura va sim', 'Burchak va shveller']],
    ['Mahkamlagichlar', ['Boltlar va gaykalar', 'Vintlar', 'Zaklyopkalar']],
    ['Payvandlash', ['Elektrodlar', 'Payvand simi', 'Gaz']],
    ['Bo‘yoq va qoplama', ['Grunt', 'Bo‘yoq', 'Kukun bo‘yoq', 'Erituvchi']],
    ['Butlovchilar', ['Petlya va qulflar', 'G‘ildirak va podshipniklar', 'Plastik qopqoqlar']],
    ['Sarf materiallari', ['Kesuvchi disklar', 'Abrazivlar', 'Parma va frezalar', 'Himoya vositalari']],
  ]),
  doors: build([
    ['Profil', ['PVX profil', 'Alyuminiy profil', 'Armatura (metall)', 'Yog‘och brus']],
    ['To‘ldirish', ['Shisha paket', 'Shisha', 'Sendvich panel', 'MDF va panellar']],
    ['Furnitura', ['Petlyalar', 'Dastalar', 'Qulflar', 'Ochish mexanizmlari']],
    ['Zichlagich va izolyatsiya', ['Rezina zichlagich', 'Montaj ko‘pigi', 'Germetik']],
    ['Mahkamlagichlar', ['Shuruplar', 'Anker va dyubellar']],
    ['Qo‘shimcha', ['Podokonnik', 'Otliv', 'Moskit to‘r', 'Qadoqlash']],
  ]),
};

export const presetGroups = (industry: Industry): WarehouseGroup[] =>
  PRESETS[industry].map(group => ({ ...group, children: group.children.map(leaf => ({ ...leaf })) }));

const clean = (value: unknown): string => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 60) : '';

/** Stored or typed classifier → a valid one, or null when nothing usable is left. Codes are kept as stored. */
export function parseClassifier(raw: unknown): WarehouseGroup[] | null {
  if (!Array.isArray(raw)) return null;
  const groups: WarehouseGroup[] = [];
  const seen = new Set<string>();
  for (const entry of raw.slice(0, 30)) {
    const row = entry as { code?: unknown; name?: unknown; children?: unknown } | null;
    const code = typeof row?.code === 'string' ? row.code : '';
    const name = clean(row?.name);
    if (!/^\d{2}$/.test(code) || !name || seen.has(code)) continue;
    seen.add(code);
    const children = (Array.isArray(row?.children) ? row!.children as unknown[] : []).slice(0, 40).flatMap(item => {
      const leaf = item as { code?: unknown; name?: unknown } | null;
      const leafCode = typeof leaf?.code === 'string' ? leaf.code : '';
      const leafName = clean(leaf?.name);
      if (!new RegExp(`^${code}\\.\\d{2}$`).test(leafCode) || !leafName || seen.has(leafCode)) return [];
      seen.add(leafCode);
      return [{ code: leafCode, name: leafName }];
    });
    groups.push({ code, name, children });
  }
  return groups.length ? groups.sort((left, right) => left.code.localeCompare(right.code)) : null;
}

/** The next free two-digit number after the highest used one ("03" after 01, 02); null when 99 is taken. */
export function nextCode(used: string[], prefix = ''): string | null {
  const numbers = used.filter(code => code.startsWith(prefix)).map(code => Number(code.slice(prefix.length)));
  const next = Math.max(0, ...numbers) + 1;
  return next > 99 ? null : `${prefix}${String(next).padStart(2, '0')}`;
}

export const addGroup = (groups: WarehouseGroup[]): WarehouseGroup[] => {
  const code = nextCode(groups.map(group => group.code));
  return code ? [...groups, { code, name: '', children: [] }] : groups;
};
export const addLeaf = (groups: WarehouseGroup[], groupCode: string): WarehouseGroup[] => groups.map(group => {
  if (group.code !== groupCode) return group;
  const code = nextCode(group.children.map(leaf => leaf.code), `${group.code}.`);
  return code ? { ...group, children: [...group.children, { code, name: '' }] } : group;
});

// ── Saqlash: umumiy bazada korxona sozlamasi, namoyishda — shu brauzer ───────────────────────────
export interface CompanySettings { industry: Industry; classifier: WarehouseGroup[] | null }
const storageKey = (companyId: string) => `aliya.company-settings.${companyId}`;
const industryOf = (value: unknown): Industry => INDUSTRIES.some(row => row.id === value) ? value as Industry : 'furniture';

export function parseSettings(raw: unknown): CompanySettings {
  const row = (raw && typeof raw === 'object' ? raw : {}) as { industry?: unknown; classifier?: unknown };
  return { industry: industryOf(row.industry), classifier: parseClassifier(row.classifier) };
}

/** The groups to show: the company's own, else the preset of its industry (furniture when nothing is set). */
export const groupsOf = (settings: CompanySettings): WarehouseGroup[] => settings.classifier ?? presetGroups(settings.industry);

export async function loadCompanySettings(supabase: SupabaseClient | null, companyId: string, storage: Pick<Storage, 'getItem'> = localStorage): Promise<CompanySettings> {
  if (supabase) {
    const reply = await supabase.rpc('erp_company_settings');
    return parseSettings(reply.error ? null : reply.data);
  }
  try { return parseSettings(JSON.parse(storage.getItem(storageKey(companyId)) ?? 'null')); } catch { return parseSettings(null); }
}

export async function saveCompanySettings(supabase: SupabaseClient | null, companyId: string, settings: CompanySettings, storage: Pick<Storage, 'setItem'> = localStorage): Promise<void> {
  if (supabase) {
    const reply = await supabase.rpc('erp_company_settings_set', { p_industry: settings.industry, p_classifier: settings.classifier });
    if (reply.error) throw new Error(reply.error.message);
    return;
  }
  storage.setItem(storageKey(companyId), JSON.stringify(settings));
}
