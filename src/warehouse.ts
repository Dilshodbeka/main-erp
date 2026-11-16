export interface WarehouseLeaf { code: string; name: string }
export interface WarehouseGroup { code: string; name: string; children: WarehouseLeaf[] }

export const warehouseGroups: WarehouseGroup[] = [
  {
    code: '01', name: 'List materiallar', children: [
      { code: '01.01', name: 'LDSP' },
      { code: '01.02', name: 'MDF' },
      { code: '01.03', name: 'HDF' },
      { code: '01.04', name: 'HPL plastik' },
      { code: '01.05', name: 'Shisha' },
      { code: '01.06', name: 'Oynalar' },
      { code: '01.07', name: 'Fasadlar' },
    ],
  },
  {
    code: '02', name: 'Kromka materiallari', children: [
      { code: '02.01', name: 'PVX kromka' },
      { code: '02.02', name: 'Kromka Egger' },
      { code: '02.03', name: 'Kromka Rehau' },
      { code: '02.04', name: 'Kromka AGT' },
    ],
  },
  {
    code: '03', name: 'Pogon materiallari', children: [
      { code: '03.01', name: 'Alyuminiy profil' },
      { code: '03.02', name: 'Shtapik' },
      { code: '03.03', name: 'Plintus' },
      { code: '03.04', name: 'Quvur' },
    ],
  },
  {
    code: '04', name: 'Mahkamlagichlar', children: [
      { code: '04.01', name: 'Shuruplar' },
      { code: '04.02', name: 'Konfirmatlar' },
      { code: '04.03', name: 'Dublar' },
      { code: '04.04', name: 'Mixlar' },
    ],
  },
  {
    code: '05', name: 'Furnitura', children: [
      { code: '05.01', name: 'Menteşalar' },
      { code: '05.02', name: 'Yo‘naltiruvchilar' },
      { code: '05.03', name: 'Dastalar' },
      { code: '05.04', name: 'Qulflar va dovarchilar' },
      { code: '05.05', name: 'Ko‘tarish mexanizmlari' },
    ],
  },
  {
    code: '06', name: 'Bo‘yoq va kimyo', children: [
      { code: '06.01', name: 'Bo‘yoq' },
      { code: '06.02', name: 'Lak' },
      { code: '06.03', name: 'Grunt' },
      { code: '06.04', name: 'Qotiruvchi' },
      { code: '06.05', name: 'Erituvchi' },
      { code: '06.06', name: 'Shpaklyovka' },
    ],
  },
  {
    code: '07', name: 'Sarf materiallari', children: [
      { code: '07.01', name: 'Yelim' },
      { code: '07.02', name: 'Germetik' },
      { code: '07.03', name: 'Abrazivlar' },
      { code: '07.04', name: 'Qadoqlash' },
      { code: '07.05', name: 'Bo‘yoq va moylar' },
    ],
  },
];

export const categoryCodes = warehouseGroups.flatMap(group => group.children.map(leaf => leaf.code));

export const categoryPattern = /^\d{2}\.\d{2}$/;

export function isCategoryCode(value: string | null | undefined): value is string {
  return typeof value === 'string' && categoryCodes.includes(value);
}

export function categoryLabel(code: string | null): string {
  if (!code) return 'Tasniflanmagan';
  for (const group of warehouseGroups) {
    const leaf = group.children.find(row => row.code === code);
    if (leaf) return `${leaf.code} · ${leaf.name}`;
  }
  return code;
}

export function categoryGroupName(code: string | null): string {
  if (!code) return 'Tasniflanmagan';
  return warehouseGroups.find(group => code.startsWith(`${group.code}.`))?.name ?? 'Tasniflanmagan';
}

export function inWarehouseGroup(code: string | null, groupCode: string | null): boolean {
  if (!groupCode) return true;
  return !!code && code.startsWith(`${groupCode}.`);
}

export function inWarehouseLeaf(code: string | null, leafCode: string | null): boolean {
  if (!leafCode) return true;
  return code === leafCode;
}
