// Full-company copy: the document the ERP stores in cloud storage and the only
// thing trusted by restore. Rows come from the server, so a copy is complete even
// if a browser sends a damaged state block.

export const COPY_APP = 'aliya-erp';
export const COPY_KIND = 'company-copy';
export const COPY_VERSION = 1;

export const DAILY_WINDOW_DAYS = 30;
export const MONTHLY_WINDOW_MONTHS = 12;
export const ALWAYS_KEEP = 3;
export const FRESH_HOURS = 36;

export interface CopyManifest { rows: Record<string, number>; totalRows: number }

export interface CompanyCopy {
  app: 'aliya-erp';
  kind: 'company-copy';
  version: number;
  companyId: string;
  revision: number;
  exportedAt: string;
  manifest: CopyManifest;
  tables: Record<string, Record<string, unknown>[]>;
  state: unknown;
}

export interface CopyMeta { key: string; exportedAt: string; revision: number; bytes: number }

const METADATA_TABLE = 'erp_metadata';

const rowList = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object') : [];

export function copyManifest(tables: Record<string, Record<string, unknown>[]>): CopyManifest {
  const rows: Record<string, number> = {};
  let totalRows = 0;
  for (const name of Object.keys(tables).sort()) {
    const count = rowList(tables[name]).length;
    rows[name] = count;
    totalRows += count;
  }
  return { rows, totalRows };
}

export function buildCopy(input: {
  companyId: string; revision: number; exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>; state: unknown;
}): CompanyCopy {
  return {
    app: COPY_APP,
    kind: COPY_KIND,
    version: COPY_VERSION,
    companyId: input.companyId,
    revision: input.revision,
    exportedAt: input.exportedAt,
    manifest: copyManifest(input.tables),
    tables: input.tables,
    state: input.state,
  };
}

export function parseCopy(text: string): CompanyCopy {
  let value: Partial<CompanyCopy> | null = null;
  try { value = JSON.parse(text) as Partial<CompanyCopy>; } catch { value = null; }
  if (!value || value.app !== COPY_APP || value.kind !== COPY_KIND || !value.tables || typeof value.companyId !== 'string') {
    throw new Error('Bu Aliya ERP zaxira nusxasi emas');
  }
  if (value.version !== COPY_VERSION) {
    throw new Error(`Nusxa versiyasi qo‘llab-quvvatlanmaydi: ${String(value.version)} (kerakli versiya ${COPY_VERSION})`);
  }
  return value as CompanyCopy;
}

export function verifyCopy(copy: CompanyCopy, companyId: string): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (copy.companyId !== companyId) problems.push(`Nusxa boshqa korxonaga tegishli (${copy.companyId}).`);
  if (typeof copy.revision !== 'number') problems.push('Nusxada revision raqami yo‘q.');

  const recomputed = copyManifest(copy.tables);
  const stored = copy.manifest?.rows ?? {};
  for (const name of Object.keys({ ...stored, ...recomputed.rows }).sort()) {
    if ((stored[name] ?? -1) !== (recomputed.rows[name] ?? -1)) {
      problems.push(`${name}: kutilgan ${String(stored[name])}, faylda ${String(recomputed.rows[name])}.`);
    }
  }
  if (copy.manifest && copy.manifest.totalRows !== recomputed.totalRows) {
    problems.push(`Jami satrlar: kutilgan ${String(copy.manifest.totalRows)}, faylda ${String(recomputed.totalRows)}.`);
  }
  if (!Object.keys(recomputed.rows).length) problems.push('Nusxada birorta jadval yo‘q.');

  const metadata = rowList(copy.tables[METADATA_TABLE]);
  if (!metadata.length) problems.push(`${METADATA_TABLE}: korxona metadatalari yo‘q.`);
  else {
    const revision = Number((metadata[0] as { revision?: unknown }).revision);
    if (Number.isFinite(revision) && Number.isFinite(copy.revision) && revision !== copy.revision) {
      problems.push(`revision: jadvalda ${String(revision)}, nusxa sarlavhasida ${String(copy.revision)}.`);
    }
  }

  for (const [name, rows] of Object.entries(copy.tables)) {
    for (const row of rowList(rows)) {
      const owner = (row as { company_id?: unknown }).company_id;
      if (owner !== undefined && owner !== null && owner !== companyId) {
        problems.push(`${name}: chet korxona satri topildi.`);
        break;
      }
    }
  }

  const state = copy.state as { revision?: unknown } | null;
  if (state && typeof state === 'object' && typeof state.revision === 'number' && state.revision !== copy.revision) {
    problems.push(`state revision: ${String(state.revision)}, nusxa revision ${String(copy.revision)}.`);
  }

  return { ok: !problems.length, problems };
}

// Sandbox playback: the state block the browser showed must describe exactly the rows being restored.
const STATE_COLLECTIONS: Record<string, string> = {
  customers: 'erp_customers', suppliers: 'erp_suppliers', employees: 'erp_employees',
  machines: 'erp_machines', operations: 'erp_operations', items: 'erp_items',
  recipes: 'erp_recipes', orders: 'erp_orders', purchases: 'erp_purchases',
  movements: 'erp_stock_movements', cash: 'erp_cash', reports: 'erp_work_reports',
  payroll: 'erp_payroll', salaryPlans: 'erp_salary_plans', expensePlans: 'erp_expense_plans', loans: 'erp_loans',
  workerDeductions: 'erp_worker_deductions',
  shipments: 'erp_shipments', audit: 'erp_audit',
};

export interface CopyPreview { ok: boolean; problems: string[]; counts: Record<string, number> }

export function playbackCopy(copy: CompanyCopy): CopyPreview {
  const counts: Record<string, number> = {};
  const state = copy.state as Record<string, unknown> | null;
  if (!state || typeof state !== 'object') {
    return { ok: false, problems: ['state: nusxada korxona holati bloki yo‘q.'], counts };
  }

  const problems: string[] = [];
  if (state.companyId !== copy.companyId) problems.push('state: holat bloki boshqa korxonaga tegishli.');
  if (typeof state.revision === 'number' && Number.isFinite(copy.revision) && state.revision !== copy.revision) {
    problems.push(`state revision: ${String(state.revision)}, nusxa revision ${String(copy.revision)}.`);
  }

  for (const [field, table] of Object.entries(STATE_COLLECTIONS)) {
    const rows = rowList(copy.tables[table]);
    const listed = rowList(state[field]);
    counts[table] = rows.length;
    if (!rows.length && !listed.length) continue;
    const inRows = new Set(rows.map(row => String(row.id)));
    const inState = new Set(listed.map(row => String(row.id)));
    const differs = inRows.size !== inState.size
      || [...inRows].some(id => !inState.has(id))
      || [...inState].some(id => !inRows.has(id));
    if (differs) problems.push(`${table}: holat blokinda ${String(listed.length)}, fayl satrlarida ${String(rows.length)}.`);
  }

  return { ok: !problems.length, problems, counts };
}

export function copyObjectKey(companyId: string, exportedAt: string, revision: number): string {
  return `companies/${companyId}/${stampOf(exportedAt)}-r${revision}.json`;
}

const stampOf = (exportedAt: string): string =>
  `${exportedAt.slice(0, 10)}T${exportedAt.slice(11, 19).replace(/:/g, '')}Z`;

const nameOf = /^(\d{4}-\d{2}-\d{2})T(\d{6})Z-r(\d+)\.json$/;

export function copyMetaFromKey(key: string): { exportedAt: string; revision: number } {
  const match = nameOf.exec(key.split('/').pop() ?? '');
  if (!match) return { exportedAt: '', revision: 0 };
  const [, date, time, revision] = match;
  return {
    exportedAt: `${date}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`,
    revision: Number(revision),
  };
}

export function isCopyFresh(latestExportedAt: string | null, now: string, maxAgeHours: number = FRESH_HOURS): boolean {
  if (!latestExportedAt) return false;
  const created = Date.parse(latestExportedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(created) || !Number.isFinite(current)) return false;
  return current - created <= maxAgeHours * 60 * 60 * 1000;
}

const monthOf = (exportedAt: string): string => exportedAt.slice(0, 7);

const monthsAgo = (now: string, back: number): string => {
  const date = new Date(`${now.slice(0, 7)}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - back);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function selectCopiesToDelete(copies: CopyMeta[], now: string): string[] {
  if (!copies.length) return [];
  const sorted = [...copies].sort((left, right) => right.exportedAt.localeCompare(left.exportedAt));
  const newest = new Map<string, CopyMeta>();
  for (const copy of sorted) if (!newest.has(monthOf(copy.exportedAt))) newest.set(monthOf(copy.exportedAt), copy);

  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - DAILY_WINDOW_DAYS);
  const windowStamp = windowStart.toISOString();
  const monthlyAllowed = new Set<string>();
  for (let back = 1; back <= MONTHLY_WINDOW_MONTHS; back++) monthlyAllowed.add(monthsAgo(now, back));

  const dropped = sorted.filter(copy => {
    if (copy.exportedAt >= windowStamp) return false;
    return !(monthlyAllowed.has(monthOf(copy.exportedAt)) && newest.get(monthOf(copy.exportedAt))?.key === copy.key);
  });
  // Retention must never leave a company with fewer copies than the safety floor.
  const allowed = Math.max(0, sorted.length - ALWAYS_KEEP);
  return dropped.slice(Math.max(0, dropped.length - allowed)).map(copy => copy.key);
}
