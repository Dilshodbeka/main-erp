import { PERMISSION_KEYS, PRESETS, type Permission, type PresetKey } from './permissions';
import type { Employee, Role } from './types';

export type AccessRole = 'worker' | 'display';

export interface AccessAccount {
  id: string;
  name: string;
  email: string;
  role: Role;
  employeeId: string | null;
  employeeName: string | null;
  permissions: string[];
}

export interface AccessDraft {
  role: AccessRole;
  employeeId: string;
  displayName: string;
  email: string;
  password: string;
  confirm: string;
  preset: PresetKey | '';
  permissions: Permission[];
  scopeWorkshopIds: string[];
  scopeWarehouseIds: string[];
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function passwordError(password: string, confirm: string): string {
  if (password.length < 8) return 'Parol kamida 8 belgidan iborat bo‘lsin';
  if (password.length > 72) return 'Parol 72 belgidan oshmasin';
  if (password !== confirm) return 'Parollar mos kelmadi';
  return '';
}

export function resetPasswordError(password: string, confirm: string): string {
  return passwordError(password, confirm);
}

// Пресет — ярлык; галочки поверх пресета добавляются, снятые — убираются.
export function resolvePermissions(preset: PresetKey | '', overrides: Permission[]): Permission[] {
  const valid = overrides.filter(p => (PERMISSION_KEYS as readonly string[]).includes(p));
  if (!preset) return valid;
  const set = new Set<Permission>(PRESETS[preset]);
  for (const key of PRESETS[preset]) if (!valid.includes(key)) set.delete(key);
  for (const key of valid) set.add(key);
  return [...set];
}

export function accessErrorText(code: string, message = ''): string {
  if (code === 'not_configured') return 'Bulut bazasi ulanmagan. Sozlamalarda Supabase ulanishini tekshiring.';
  if (code === 'session_missing') return 'Sessiya brauzerda topilmadi. Sahifani yangilab, qaytadan kiring.';
  if (code === 'auth_missing') return 'Sessiya serverga yuborilmadi. Sahifani yangilang.';
  if (code === 'auth_invalid') return message && message !== 'auth_invalid'
    ? `Server sessiyani qabul qilmadi (${message}). Qaytadan kiring.`
    : 'Server sessiyani qabul qilmadi. Qaytadan kiring.';
  if (code === 'access_denied') return 'Bu amal faqat korxona egasiga ruxsat etilgan.';
  if (code === 'profile_missing') return 'Bu hisobga korxona profili bog‘lanmagan. Administratorga murojaat qiling.';
  if (code === 'not_found' || /function|404/i.test(code)) return 'Server funksiyasi hali joylanmagan (erp-access). Administratorga murojaat qiling.';
  if (code === 'table_missing') return 'Baza sxemasi yangilanmagan. SQL skriptini qo‘llash kerak.';
  if (code === 'email_taken') return 'Bu email allaqachon ro‘yxatdan o‘tgan.';
  if (code === 'employee_linked') return 'Bu xodimga kirish allaqachon bog‘langan.';
  if (code === 'weak_password') return 'Parol juda oddiy yoki qisqa. Kamida 8 belgi kiriting.';
  if (code === 'password_too_long') return 'Parol 72 belgidan oshmasin.';
  if (code === 'admin_protected') return 'Egasi hisobini bu yerdan o‘zgartirib bo‘lmaydi.';
  if (code === 'account_not_found') return 'Hisob topilmadi. Ro‘yxatni yangilang.';
  if (code === 'network') return 'Serverga ulanib bo‘lmadi. Internetni tekshiring.';
  return message || 'Amal bajarilmadi. Qayta urinib ko‘ring.';
}

export function validateAccessDraft(draft: AccessDraft, employees: Employee[], accounts: AccessAccount[]): string {
  const email = draft.email.trim().toLowerCase();
  if (!emailPattern.test(email) || email.length > 254) return 'Email manzilini to‘g‘ri kiriting';
  if (accounts.some(account => account.email.trim().toLowerCase() === email)) return 'Bu email allaqachon ro‘yxatda';
  const password = passwordError(draft.password, draft.confirm);
  if (password) return password;
  if (draft.role === 'display') {
    return draft.displayName.trim().length < 2 ? 'Ekran nomini kiriting (kamida 2 belgi)' : '';
  }
  if (!draft.employeeId) return 'Xodimni tanlang';
  if (accounts.some(account => account.employeeId === draft.employeeId)) return 'Bu xodimga kirish allaqachon bog‘langan';
  if (!employees.some(employee => employee.id === draft.employeeId && employee.active)) return 'Faol xodimni tanlang';
  if (draft.preset === 'Seh boshlig‘i' && !draft.scopeWorkshopIds.length) return 'Seh boshlig‘i uchun kamida bitta seh tanlang';
  return '';
}
