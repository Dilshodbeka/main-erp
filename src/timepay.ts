// Timepay Integration API client (read-only): today's check-ins, schedules and employees.
// Only `fetch` is used, so the same code runs in the Edge Functions and under test.
import type { AttendanceData } from './attendance';

export const TIMEPAY_BASE = 'https://api.app.time-pay.uz/api/v1/integration';
const PAGE_LIMIT = 100;   // the API caps `limit` at 100
const MAX_PAGES = 30;     // 3 000 rows per list is far above a workshop's daily volume

type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class TimepayError extends Error {
  constructor(public status: number, public code: string) { super(`Timepay ${status} ${code}`); this.name = 'TimepayError'; }
}

/** Walks a paginated list through `next`, never leaving the Timepay API host. */
async function list<T>(path: string, token: string, fetcher: Fetch): Promise<T[]> {
  const rows: T[] = [];
  let url: string | null = `${TIMEPAY_BASE}${path}${path.includes('?') ? '&' : '?'}limit=${PAGE_LIMIT}`;
  for (let page = 0; url && page < MAX_PAGES; page += 1) {
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json().catch(() => null) as { results?: T[]; next?: string | null; error_code?: string } | null;
    if (!response.ok) throw new TimepayError(response.status, body?.error_code ?? 'request_failed');
    rows.push(...(body?.results ?? []));
    const next = typeof body?.next === 'string' ? body.next.replace(/^http:/, 'https:') : null;
    url = next && next.startsWith(`${TIMEPAY_BASE}/`) ? next : null;
  }
  return rows;
}

/** Everything the attendance rules need for one day (`today` = YYYY-MM-DD in the company's time zone). */
export async function fetchAttendance(token: string, today: string, fetcher: Fetch): Promise<AttendanceData> {
  const [employees, schedules, checks] = await Promise.all([
    list<AttendanceData['employees'][number]>('/employees/', token, fetcher),
    // Schedules are optional: without them the working hours from the settings are used.
    list<AttendanceData['schedules'][number]>('/schedules/', token, fetcher).catch(() => []),
    list<AttendanceData['checks'][number]>(`/checkinouts/?date=${encodeURIComponent(today)}`, token, fetcher),
  ]);
  return { employees, schedules, checks };
}
