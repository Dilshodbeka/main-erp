import type { RouteLine } from '../types';

export function TaskActionButton({ task, busy, available, onReview, onSubmit }: {
  task: RouteLine; busy: boolean; available: boolean; onReview: () => void; onSubmit: () => void;
}) {
  if (task.status === 'completed') return <button className="secondary" disabled>Tayyor</button>;
  if (task.status === 'submitted') return <button className="primary" disabled={busy} onClick={onReview}>Qabul qilish</button>;
  return <button className="secondary" disabled={busy || !available || task.status !== 'in_progress'} onClick={onSubmit}>{task.status === 'in_progress' ? 'Natijani topshirish' : task.status === 'accepted' ? 'Xodim boshladi' : 'Bosqichni kutmoqda'}</button>;
}
