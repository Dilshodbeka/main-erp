export interface Panel { id: string; title: string }
export interface SectionDef { id: string; title: string; panels: Panel[] }
export interface Route { section: string; panel: string }

const productionPanels: Panel[] = [
  { id: 'doska', title: 'Sex doskasi' },
  { id: 'brak', title: 'Brak tarixi' },
];

const registry: SectionDef[] = [
  { id: 'dashboard', title: 'Umumiy ko‘rinish', panels: [] },
  { id: 'advisor', title: 'Tavsiyalar', panels: [] },
  { id: 'orders', title: 'Savdo va CRM', panels: [{ id: 'buyurtmalar', title: 'Buyurtmalar' }, { id: 'mijozlar', title: 'Mijozlar' }] },
  { id: 'history', title: 'Tarix va analitika', panels: [{ id: 'tarix', title: 'Buyurtmalar tarixi' }, { id: 'sotuv', title: 'Sotuv analitikasi' }] },
  { id: 'shops', title: 'Do‘konlar', panels: [{ id: 'hisob-kitob', title: 'Hisob-kitob' }, { id: 'yuborish', title: 'Yuborishga tayyor' }] },
  { id: 'production', title: 'Ishlab chiqarish', panels: productionPanels },
  { id: 'warehouse', title: 'Ombor', panels: [{ id: 'tasniflagich', title: 'Tasniflagich' }, { id: 'qoldiqlar', title: 'Qoldiqlar tahlili' }, { id: 'taminot', title: 'Ta’minot ehtiyoji' }] },
  { id: 'series', title: 'Seriyalar va retseptlar', panels: [{ id: 'seriyalar', title: 'Seriyalar' }, { id: 'retseptlar', title: 'Retseptlar' }] },
  { id: 'purchases', title: 'Ta’minot', panels: [{ id: 'xaridlar', title: 'Xaridlar' }, { id: 'yetkazib-beruvchilar', title: 'Yetkazib beruvchilar' }, { id: 'narxlar', title: 'Narxlar tarixi' }] },
  { id: 'people', title: 'Xodimlar', panels: [{ id: 'xodimlar', title: 'Xodimlar' }, { id: 'stavkalar', title: 'Bosqich tannarxi' }, { id: 'oylik', title: 'Oylik va qarzlar' }] },
  { id: 'logistics', title: 'Yetkazib berish', panels: [] },
  { id: 'cash', title: 'Moliya va kassa', panels: [{ id: 'kassa', title: 'Kassa' }, { id: 'xarajatlar', title: 'Oylik xarajatlar' }, { id: 'zaymlar', title: 'Zaymlar va investitsiyalar' }, { id: 'pult', title: 'Direktor pulti' }, { id: 'hisobotlar', title: 'Hisobotlar' }] },
  { id: 'analytics', title: 'Hisobotlar', panels: [{ id: 'moliyaviy', title: 'Moliyaviy natija' }, { id: 'sogliq', title: 'Xodimlar va sog‘liq' }] },
  { id: 'settings', title: 'Sozlamalar', panels: [{ id: 'malumotnoma', title: 'Ma’lumotnoma' }, { id: 'kirish', title: 'Korxona va kirish' }, { id: 'baza', title: 'Baza va zaxira' }] },
];

export function panelsFor(sectionId: string, admin: boolean): Panel[] {
  if (sectionId === 'people' && !admin) return [];
  if (sectionId === 'production' && !admin) return [];
  return registry.find(section => section.id === sectionId)?.panels ?? [];
}

export function defaultPanel(sectionId: string, admin: boolean): string {
  return panelsFor(sectionId, admin)[0]?.id ?? '';
}

export function parseHash(hash: string): Route | null {
  const path = hash.replace(/^#\/?/, '');
  if (!path) return null;
  const [section, panel = ''] = path.split('/').filter(Boolean).map(part => decodeURIComponent(part));
  if (!section) return null;
  return { section, panel };
}

export function routeHash(route: Route): string {
  return route.panel ? `#/${route.section}/${route.panel}` : `#/${route.section}`;
}

export function normalizeRoute(route: Route | null, visible: string[], admin: boolean): Route {
  const fallback = visible[0] ?? 'dashboard';
  if (!route || !visible.includes(route.section)) return { section: fallback, panel: defaultPanel(fallback, admin) };
  const panels = panelsFor(route.section, admin);
  const panel = panels.some(entry => entry.id === route.panel) ? route.panel : defaultPanel(route.section, admin);
  return { section: route.section, panel };
}
