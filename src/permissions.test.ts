import { describe, expect, it } from 'vitest';
import { canTouchOrder, PRESETS, requiredPermission, WORKER_BASE } from './permissions';

describe('permissions catalog', () => {
  it('maps seller actions', () => {
    expect(requiredPermission('customer.create')).toBe('orders.create');
    expect(requiredPermission('cash.post')).toBe('cash.post');
    expect(requiredPermission('salary.pay')).toBe('salaries.pay');
    expect(requiredPermission('work.review')).toBe('work.review');
    expect(requiredPermission('employee.create')).toBeNull(); // admin-only
  });
  it('order-scoped extra permission', () => {
    expect(requiredPermission('order.cancel')).toBe('orders.cancel');
    expect(requiredPermission('order.launch')).toBe('orders.launch');
    expect(requiredPermission('order.update')).toBeNull(); // ownership only
  });
  it('worker base excludes catalog rights', () => {
    for (const t of ['work.accept', 'work.start', 'work.submit', 'ticket.create', 'ticket.reply']) expect(WORKER_BASE.has(t as never)).toBe(true);
    expect(WORKER_BASE.has('order.create')).toBe(false);
  });
  it('presets are disjoint sensible defaults', () => {
    expect(PRESETS['Ishlab chiqarish ustasi']).toEqual([]);
    expect(PRESETS['Sotuvchi']).toContain('orders.edit_own');
    expect(PRESETS['Sotuvchi']).not.toContain('orders.edit_all');
  });
});

describe('canTouchOrder', () => {
  const customer = (sellerId: string | null) => ({ sellerId } as never);
  it('admin always', () => expect(canTouchOrder({ role: 'admin' }, customer(null))).toBe(true));
  it('edit_all any', () => expect(canTouchOrder({ role: 'worker', permissions: ['orders.edit_all'] }, customer('x'))).toBe(true));
  it('edit_own own only', () => {
    expect(canTouchOrder({ role: 'worker', permissions: ['orders.edit_own'] }, customer('me'))).toBe(false);
    expect(canTouchOrder({ id: 'me', role: 'worker', permissions: ['orders.edit_own'] }, customer('me') as never)).toBe(true);
    expect(canTouchOrder({ id: 'me', role: 'worker', permissions: ['orders.edit_own'] }, customer('other') as never)).toBe(false);
  });
  it('no rights denies', () => expect(canTouchOrder({ role: 'worker' }, customer('me'))).toBe(false));
});
