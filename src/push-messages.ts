// What the watcher says through Web Push: a short notification for the owner (the same findings
// that go to Telegram) and "a task is waiting for you" for workers. Pure — tested without a browser.
import { availableTask } from './domain';
import type { State } from './types';
import type { Finding } from './watch';

export interface PushMessage { title: string; body: string; url: string; tag: string }

/** Telegram HTML → plain text for a system notification. */
export function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** One notification for everything that became due in this run. */
export function ownerPush(due: Finding[]): PushMessage | null {
  if (!due.length) return null;
  const lines = due.slice(0, 4).map(row => plainText(row.text));
  if (due.length > 4) lines.push(`…va yana ${due.length - 4} ta`);
  return { title: due.length === 1 ? 'Nazorat: e’tibor bering' : `Nazorat: ${due.length} ta holat`, body: lines.join('\n'), url: '#/dashboard', tag: 'watch' };
}

export interface WorkerNotice { key: string; employeeId: string; message: PushMessage }

/** Tasks that are open for a worker right now and still not accepted: announced once per task. */
export function workerNotices(state: State): WorkerNotice[] {
  const notices: WorkerNotice[] = [];
  for (const order of state.orders) {
    if (order.status !== 'production') continue;
    for (const task of order.route) {
      if (task.status !== 'assigned' || task.executorKind === 'supplier') continue;
      if (!availableTask(state, order.id, task.id)) continue;
      const people = new Set<string>([task.employeeId, ...(task.crew ?? []).map(member => member.employeeId)].filter((id): id is string => Boolean(id)));
      for (const employeeId of people) {
        notices.push({
          key: `task:${task.id}:${employeeId}`, employeeId,
          message: { title: 'Yangi topshiriq', body: `${order.number} · ${task.name} — ${order.title}`, url: '#/production', tag: `task-${task.id}` },
        });
      }
    }
  }
  return notices;
}
