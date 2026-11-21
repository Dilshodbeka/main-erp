import type { Command, Customer } from './types';

export const PERMISSION_KEYS = [
  'orders.view_all', 'orders.create', 'orders.edit_own', 'orders.edit_all', 'orders.launch',
  'orders.issue_materials', 'orders.cancel', 'customers.claim', 'customers.assign',
  'payments.customer', 'cash.view', 'cash.post', 'cash.reverse', 'purchases.view',
  'purchases.create', 'purchases.receive', 'suppliers.pay', 'warehouse.view', 'warehouse.count',
  'warehouse.transfer', 'cost.view', 'production.view_all', 'work.review', 'defects.view',
  'salaries.view', 'salaries.pay', 'reports.view', 'shipments.view', 'shipments.create',
  'shipments.deliver', 'settings.catalog', 'settings.access',
] as const;
export type Permission = (typeof PERMISSION_KEYS)[number];

export type PresetKey = 'Sotuvchi' | 'Katta sotuvchi' | 'Kassir' | 'Omborchi' | 'Ishlab chiqarish ustasi' | 'Seh boshlig‘i' | 'Yetkazib beruvchi';

export const PRESETS: Record<PresetKey, Permission[]> = {
  'Sotuvchi': ['orders.view_all', 'orders.create', 'orders.edit_own', 'orders.launch', 'customers.claim', 'payments.customer', 'shipments.view'],
  'Katta sotuvchi': ['orders.view_all', 'orders.create', 'orders.edit_own', 'orders.edit_all', 'orders.launch', 'orders.cancel', 'customers.claim', 'customers.assign', 'payments.customer', 'shipments.view', 'reports.view'],
  'Kassir': ['orders.view_all', 'cash.view', 'cash.post', 'payments.customer', 'reports.view'],
  'Omborchi': ['warehouse.view', 'warehouse.count', 'warehouse.transfer', 'orders.issue_materials', 'purchases.view', 'purchases.receive', 'settings.catalog'],
  'Ishlab chiqarish ustasi': [],
  'Seh boshlig‘i': ['production.view_all', 'work.review', 'defects.view', 'warehouse.view', 'orders.issue_materials'],
  'Yetkazib beruvchi': ['shipments.view', 'shipments.deliver', 'orders.view_all'],
};

// Базовые действия любого worker — не права каталога, разрешены всегда (для своих этапов).
export const WORKER_BASE: ReadonlySet<Command['type']> = new Set(['work.accept', 'work.start', 'work.submit', 'assembly.complete', 'ticket.create', 'ticket.reply']);

export type Gate =
  | { kind: 'base' }                                  // worker base actions
  | { kind: 'ownership'; extra?: Permission }         // order-scoped: владение + опц. доп. право
  | { kind: 'permission'; key: Permission };

// Команды, отсутствующие в GATE, — admin-only (сохраняют прежнее поведение).
const GATE: Record<string, Gate> = {
  'customer.create': { kind: 'permission', key: 'orders.create' },
  'customer.claim': { kind: 'permission', key: 'customers.claim' },
  'customer.assign': { kind: 'permission', key: 'customers.assign' },
  'customer.pay': { kind: 'permission', key: 'payments.customer' },
  'order.create': { kind: 'permission', key: 'orders.create' },
  'series.create': { kind: 'permission', key: 'orders.create' },
  'order.update': { kind: 'ownership' },
  'orderLine.cancel': { kind: 'ownership' },
  'order.cancel': { kind: 'ownership', extra: 'orders.cancel' },
  'order.launch': { kind: 'ownership', extra: 'orders.launch' },
  'order.issue': { kind: 'permission', key: 'orders.issue_materials' },
  'purchase.create': { kind: 'permission', key: 'purchases.create' },
  'purchase.receive': { kind: 'permission', key: 'purchases.receive' },
  'supplier.pay': { kind: 'permission', key: 'suppliers.pay' },
  'inventory.count': { kind: 'permission', key: 'warehouse.count' },
  'warehouse.transfer': { kind: 'permission', key: 'warehouse.transfer' },
  'cash.post': { kind: 'permission', key: 'cash.post' },
  'cash.reverse': { kind: 'permission', key: 'cash.reverse' },
  'payroll.pay': { kind: 'permission', key: 'salaries.pay' },
  'salary.plan.set': { kind: 'permission', key: 'salaries.pay' },
  'salary.pay': { kind: 'permission', key: 'salaries.pay' },
  'shipment.create': { kind: 'permission', key: 'shipments.create' },
  'shipment.createStock': { kind: 'permission', key: 'shipments.create' },
  'shipment.deliver': { kind: 'permission', key: 'shipments.deliver' },
  'work.review': { kind: 'permission', key: 'work.review' },
  'work.defect': { kind: 'permission', key: 'work.review' },
  'machine.create': { kind: 'permission', key: 'settings.catalog' },
  'machine.update': { kind: 'permission', key: 'settings.catalog' },
  'operation.create': { kind: 'permission', key: 'settings.catalog' },
  'operation.update': { kind: 'permission', key: 'settings.catalog' },
  'item.create': { kind: 'permission', key: 'settings.catalog' },
  'item.update': { kind: 'permission', key: 'settings.catalog' },
  'recipe.create': { kind: 'permission', key: 'settings.catalog' },
  'recipe.version.create': { kind: 'permission', key: 'settings.catalog' },
  'routeTemplate.create': { kind: 'permission', key: 'settings.catalog' },
  'routeTemplate.update': { kind: 'permission', key: 'settings.catalog' },
};

export function requiredPermission(type: Command['type']): Permission | null {
  const gate = GATE[type];
  if (!gate) return null;
  if (gate.kind === 'permission') return gate.key;
  if (gate.kind === 'ownership' && gate.extra) return gate.extra;
  return null;
}

// Владение заказом: edit_all, либо edit_own + customer.sellerId === actor.id.
export function canTouchOrder(actor: { role: string; permissions?: string[]; id?: string }, customer: Customer | undefined): boolean {
  if (actor.role === 'admin') return true;
  const perms = actor.permissions ?? [];
  if (perms.includes('orders.edit_all')) return true;
  return perms.includes('orders.edit_own') && customer?.sellerId === actor.id;
}

export const PERMISSION_LABEL: Record<Permission, string> = {
  'orders.view_all': 'Barcha buyurtmalarni ko‘rish',
  'orders.create': 'Buyurtma yaratish',
  'orders.edit_own': 'O‘z mijozining buyurtmasini tahrirlash',
  'orders.edit_all': 'Barcha buyurtmalarni tahrirlash',
  'orders.launch': 'Buyurtmani ishga tushirish',
  'orders.issue_materials': 'Materiallarni berish',
  'orders.cancel': 'Buyurtmani bekor qilish',
  'customers.claim': 'Mijozni o‘ziga biriktirish',
  'customers.assign': 'Mijozni boshqa sotuvchiga biriktirish',
  'payments.customer': 'Mijoz to‘lovini qabul qilish',
  'cash.view': 'Kassani ko‘rish',
  'cash.post': 'Kassa operatsiyalari',
  'cash.reverse': 'Kassa bekor qilish',
  'purchases.view': 'Xaridlarni ko‘rish',
  'purchases.create': 'Xarid yaratish',
  'purchases.receive': 'Xaridni qabul qilish',
  'suppliers.pay': 'Yetkazib beruvchiga to‘lash',
  'warehouse.view': 'Omborni ko‘rish',
  'warehouse.count': 'Inventarizatsiya',
  'warehouse.transfer': 'Omborlar o‘rtasida ko‘chirish',
  'cost.view': 'Tannarxni ko‘rish',
  'production.view_all': 'Barcha ishlab chiqarishni ko‘rish',
  'work.review': 'Ishni tekshirish (qabul)',
  'defects.view': 'Brakni ko‘rish',
  'salaries.view': 'Oyliklarni ko‘rish',
  'salaries.pay': 'Oylik to‘lash',
  'reports.view': 'Hisobotlarni ko‘rish',
  'shipments.view': 'Yetkazishlarni ko‘rish',
  'shipments.create': 'Yetkazish yaratish',
  'shipments.deliver': 'Yetkazishni tasdiqlash',
  'settings.catalog': 'Ma’lumotnoma (katalog)',
  'settings.access': 'Kirish huquqlarini boshqarish',
};

export interface PermissionGroup { title: string; keys: Permission[] }

export const PERMISSION_GROUPS: PermissionGroup[] = [
  { title: 'Savdo', keys: ['orders.view_all', 'orders.create', 'orders.edit_own', 'orders.edit_all', 'orders.launch', 'orders.issue_materials', 'orders.cancel', 'customers.claim', 'customers.assign', 'payments.customer', 'shipments.view', 'shipments.create', 'shipments.deliver'] },
  { title: 'Kassa', keys: ['cash.view', 'cash.post', 'cash.reverse'] },
  { title: 'Ombor', keys: ['warehouse.view', 'warehouse.count', 'warehouse.transfer', 'purchases.view', 'purchases.create', 'purchases.receive', 'suppliers.pay'] },
  { title: 'Ishlab chiqarish', keys: ['production.view_all', 'work.review', 'defects.view'] },
  { title: 'Hisobotlar', keys: ['cost.view', 'salaries.view', 'reports.view'] },
  { title: 'Sozlamalar', keys: ['salaries.pay', 'settings.catalog', 'settings.access'] },
];
