import { describe, expect, it } from 'vitest';
import {
  COPY_VERSION,
  buildCopy,
  copyManifest,
  copyObjectKey,
  isCopyFresh,
  parseCopy,
  playbackCopy,
  selectCopiesToDelete,
  verifyCopy,
  type CopyMeta,
} from '../supabase/functions/_shared/backup';

const COMPANY = 'a1111111-1111-4111-8111-111111111111';
const OTHER = 'b2222222-2222-4222-8222-222222222222';

const tables = (companyId: string) => ({
  erp_metadata: [{ company_id: companyId, revision: 42 }],
  erp_customers: [{ company_id: companyId, id: 'c1', name: 'Aziza' }, { company_id: companyId, id: 'c2', name: 'Sardor' }],
  erp_cash: [{ company_id: companyId, id: 'k1', amount: 500000 }],
});

const copyOf = (companyId = COMPANY, revision = 42) => buildCopy({
  companyId,
  revision,
  exportedAt: '2026-11-04T09:00:00.000Z',
  tables: { ...tables(companyId), erp_metadata: [{ company_id: companyId, revision }] },
  state: { revision, companyId },
});

describe('company copy document', () => {
  it('round-trips a copy through JSON without losing rows', () => {
    const copy = copyOf();
    const parsed = parseCopy(JSON.stringify(copy));
    expect(parsed.companyId).toBe(COMPANY);
    expect(parsed.revision).toBe(42);
    expect(parsed.tables.erp_customers).toHaveLength(2);
    expect(parsed.version).toBe(COPY_VERSION);
  });

  it('counts every table in the manifest', () => {
    const manifest = copyManifest(tables(COMPANY));
    expect(manifest.rows).toEqual({ erp_cash: 1, erp_customers: 2, erp_metadata: 1 });
    expect(manifest.totalRows).toBe(4);
  });

  it('rejects a file that is not an Aliya ERP copy', () => {
    expect(() => parseCopy(JSON.stringify({ hello: 'world' }))).toThrow(/zaxira/);
    expect(() => parseCopy('not json at all')).toThrow(/zaxira/);
  });

  it('refuses an unsupported copy format version', () => {
    const broken = { ...copyOf(), version: COPY_VERSION + 1 };
    expect(() => parseCopy(JSON.stringify(broken))).toThrow(/versiy/);
  });
});

describe('company copy verification', () => {
  it('accepts an untouched copy', () => {
    expect(verifyCopy(copyOf(), COMPANY)).toEqual({ ok: true, problems: [] });
  });

  it('detects a copy whose rows were cut off', () => {
    const copy = copyOf();
    copy.tables.erp_customers = [copy.tables.erp_customers[0]];
    const result = verifyCopy(copy, COMPANY);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('erp_customers');
  });

  it('detects a copy from another company hidden inside', () => {
    const copy = copyOf();
    copy.tables.erp_customers = [{ company_id: OTHER, id: 'c9', name: 'Chet' }];
    expect(verifyCopy(copy, COMPANY).ok).toBe(false);
  });

  it('detects a state block that does not match the stored revision', () => {
    const copy = copyOf();
    copy.state = { revision: 7, companyId: COMPANY };
    const result = verifyCopy(copy, COMPANY);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('revision');
  });

  it('detects a copy without company metadata', () => {
    const copy = copyOf();
    delete (copy.tables as Record<string, unknown[]>).erp_metadata;
    copy.manifest = copyManifest(copy.tables);
    expect(verifyCopy(copy, COMPANY).ok).toBe(false);
  });
});

describe('company copy placement and freshness', () => {
  it('names the object with company, date and revision', () => {
    expect(copyObjectKey(COMPANY, '2026-11-04T09:00:00.000Z', 42))
      .toBe(`companies/${COMPANY}/2026-11-04T090000Z-r42.json`);
  });

  it('calls a copy stale once it is older than 36 hours', () => {
    expect(isCopyFresh('2026-11-04T09:00:00.000Z', '2026-11-06T09:00:00.000Z')).toBe(false);
    expect(isCopyFresh('2026-11-04T09:00:00.000Z', '2026-11-05T09:00:00.000Z')).toBe(true);
    expect(isCopyFresh(null, '2026-11-05T09:00:00.000Z')).toBe(false);
  });
});

describe('company copy sandbox playback', () => {
  const played = () => {
    const copy = copyOf();
    copy.state = {
      version: 4,
      revision: 42,
      companyId: COMPANY,
      customers: [{ id: 'c1' }, { id: 'c2' }],
      orders: [{ id: 'o1' }],
      cash: [{ id: 'k1' }],
    };
    copy.tables.erp_orders = [{ company_id: COMPANY, id: 'o1' }];
    copy.manifest = copyManifest(copy.tables);
    return copy;
  };

  it('accepts a state block that matches the copied rows', () => {
    const result = playbackCopy(played());
    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({ erp_customers: 2, erp_orders: 1, erp_cash: 1 });
  });

  it('keeps salary plans in the copy and in playback', () => {
    const copy = played();
    copy.tables.erp_salary_plans = [{
      company_id: COMPANY,
      id: 's1',
      employee_id: 'e1',
      amount: 1200000,
      from_month: '2026-11',
    }];
    copy.manifest = copyManifest(copy.tables);
    expect(copy.manifest.rows).toMatchObject({ erp_salary_plans: 1 });

    (copy.state as Record<string, unknown>).salaryPlans = [{ id: 's1' }];
    const result = playbackCopy(copy);
    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({ erp_salary_plans: 1 });
  });

  it('keeps expense plans in the copy and in playback', () => {
    const copy = played();
    copy.tables.erp_expense_plans = [{
      company_id: COMPANY,
      id: 'e1',
      plan_id: 'p1',
      title: 'Ijara',
      amount: 1200000,
      from_month: '2026-11',
      due_day: 15,
      supplier_id: null,
    }];
    copy.manifest = copyManifest(copy.tables);
    expect(copy.manifest.rows).toMatchObject({ erp_expense_plans: 1 });

    (copy.state as Record<string, unknown>).expensePlans = [{ id: 'e1' }];
    const result = playbackCopy(copy);
    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({ erp_expense_plans: 1 });
  });

  it('keeps loans in the copy and in playback', () => {
    const copy = played();
    copy.tables.erp_loans = [{
      company_id: COMPANY,
      id: 'l1',
      title: 'Jasur aka',
      kind: 'loan',
      amount: 10000000,
      note: 'Dastgoh uchun',
    }];
    copy.manifest = copyManifest(copy.tables);
    expect(copy.manifest.rows).toMatchObject({ erp_loans: 1 });

    (copy.state as Record<string, unknown>).loans = [{ id: 'l1' }];
    const result = playbackCopy(copy);
    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({ erp_loans: 1 });
  });

  it('flags a state block that lost an order the rows still carry', () => {
    const copy = played();
    (copy.state as { orders: unknown[] }).orders = [];
    const result = playbackCopy(copy);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('erp_orders');
  });

  it('flags a state block from another company', () => {
    const copy = played();
    (copy.state as { companyId: string }).companyId = OTHER;
    expect(playbackCopy(copy).ok).toBe(false);
  });

  it('flags a copy without a state block at all', () => {
    const copy = played();
    copy.state = null;
    expect(playbackCopy(copy).problems.join(' ')).toMatch(/state/);
  });
});

describe('copy retention', () => {  const meta = (exportedAt: string): CopyMeta => ({ key: copyObjectKey(COMPANY, exportedAt, 1), exportedAt, revision: 1, bytes: 100 });
  const now = '2026-11-04T12:00:00.000Z';

  it('keeps every copy of the last 30 days', () => {
    const copies = [meta('2026-11-04T08:00:00.000Z'), meta('2026-10-20T08:00:00.000Z'), meta('2026-10-06T08:00:00.000Z')];
    expect(selectCopiesToDelete(copies, now)).toEqual([]);
  });

  it('keeps one copy per month inside the last 12 months', () => {
    const copies = [
      meta('2026-11-04T08:00:00.000Z'),
      meta('2026-09-10T08:00:00.000Z'),
      meta('2026-09-20T08:00:00.000Z'),
      meta('2026-08-05T08:00:00.000Z'),
      meta('2025-10-30T08:00:00.000Z'),
    ];
    expect(selectCopiesToDelete(copies, now)).toEqual([
      copies[1].key,
      copies[4].key,
    ]);
  });

  it('never deletes the newest copies even when they are old', () => {
    const copies = [meta('2025-01-01T08:00:00.000Z'), meta('2024-12-01T08:00:00.000Z'), meta('2024-11-01T08:00:00.000Z')];
    expect(selectCopiesToDelete(copies, now)).toEqual([]);
  });
});
