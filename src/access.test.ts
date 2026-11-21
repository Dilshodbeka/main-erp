import { describe, expect, it } from 'vitest';
import { accessErrorText, resetPasswordError, resolvePermissions, validateAccessDraft, type AccessAccount, type AccessDraft } from './access';
import { PRESETS } from './permissions';
import type { Employee } from './types';

const employees: Employee[] = [
  { id: 'e1', name: 'Sardor', active: true },
  { id: 'e2', name: 'Olim', active: false },
];
const accounts: AccessAccount[] = [
  { id: 'u1', name: 'Sardor', email: 'sardor@example.com', role: 'worker', employeeId: 'e3', employeeName: 'Sardor', permissions: ['orders.view_all'] },
  { id: 'u2', name: 'Egasi', email: 'owner@example.com', role: 'admin', employeeId: null, employeeName: null, permissions: [] },
];

const draft: AccessDraft = {
  role: 'worker', employeeId: 'e1', displayName: '', email: 'new@example.com', password: 'secret123', confirm: 'secret123',
  preset: '', permissions: [], scopeWorkshopIds: [], scopeWarehouseIds: [],
};

describe('validateAccessDraft', () => {
  it('accepts a linked worker with a valid email and password', () => {
    expect(validateAccessDraft(draft, employees, accounts)).toBe('');
  });

  it('requires an active employee for a worker', () => {
    expect(validateAccessDraft({ ...draft, employeeId: '' }, employees, accounts)).toBe('Xodimni tanlang');
    expect(validateAccessDraft({ ...draft, employeeId: 'e2' }, employees, accounts)).toBe('Faol xodimni tanlang');
  });

  it('rejects an employee who already has a login', () => {
    expect(validateAccessDraft({ ...draft, employeeId: 'e3' }, employees, accounts)).toBe('Bu xodimga kirish allaqachon bog‘langan');
  });

  it('requires a name for a TV display account', () => {
    const display: AccessDraft = { ...draft, role: 'display', employeeId: '', displayName: ' ' };
    expect(validateAccessDraft(display, employees, accounts)).toBe('Ekran nomini kiriting (kamida 2 belgi)');
    expect(validateAccessDraft({ ...display, displayName: 'Seh ekrani' }, employees, accounts)).toBe('');
  });

  it('validates the email address and rejects duplicates case-insensitively', () => {
    expect(validateAccessDraft({ ...draft, email: 'bad' }, employees, accounts)).toBe('Email manzilini to‘g‘ri kiriting');
    expect(validateAccessDraft({ ...draft, email: 'OWNER@example.com' }, employees, accounts)).toBe('Bu email allaqachon ro‘yxatda');
  });

  it('requires at least one workshop for the Seh boshlig‘i preset', () => {
    const chief: AccessDraft = { ...draft, preset: 'Seh boshlig‘i', permissions: [...PRESETS['Seh boshlig‘i']] };
    expect(validateAccessDraft(chief, employees, accounts)).toBe('Seh boshlig‘i uchun kamida bitta seh tanlang');
    expect(validateAccessDraft({ ...chief, scopeWorkshopIds: ['w2'] }, employees, accounts)).toBe('');
  });

  it('requires matching passwords of 8 to 72 characters', () => {
    expect(validateAccessDraft({ ...draft, password: 'short', confirm: 'short' }, employees, accounts)).toBe('Parol kamida 8 belgidan iborat bo‘lsin');
    expect(validateAccessDraft({ ...draft, password: 'x'.repeat(73), confirm: 'x'.repeat(73) }, employees, accounts)).toBe('Parol 72 belgidan oshmasin');
    expect(validateAccessDraft({ ...draft, confirm: 'other' }, employees, accounts)).toBe('Parollar mos kelmadi');
  });
});

describe('resolvePermissions', () => {
  it('returns preset keys when no overrides', () => {
    expect(resolvePermissions('Sotuvchi', PRESETS['Sotuvchi'])).toEqual(PRESETS['Sotuvchi']);
  });
  it('empty preset keeps only valid overrides', () => {
    expect(resolvePermissions('', ['orders.view_all', 'bogus' as never])).toEqual(['orders.view_all']);
  });
  it('adds checked keys and removes unchecked preset keys', () => {
    const base = PRESETS['Sotuvchi'];
    const added = resolvePermissions('Sotuvchi', [...base, 'cash.view']);
    expect(added).toEqual([...base, 'cash.view']);
    const removed = base.filter(key => key !== 'orders.edit_own');
    expect(resolvePermissions('Sotuvchi', removed)).toEqual(removed);
  });
});

describe('resetPasswordError', () => {
  it('accepts a valid new password', () => {
    expect(resetPasswordError('newsecret', 'newsecret')).toBe('');
  });

  it('reuses the password rules', () => {
    expect(resetPasswordError('short', 'short')).toBe('Parol kamida 8 belgidan iborat bo‘lsin');
    expect(resetPasswordError('newsecret', 'other')).toBe('Parollar mos kelmadi');
  });
});

describe('accessErrorText', () => {
  it('asks to sign in again when the session is missing or rejected', () => {
    expect(accessErrorText('session_missing')).toBe('Sessiya brauzerda topilmadi. Sahifani yangilab, qaytadan kiring.');
    expect(accessErrorText('auth_missing')).toBe('Sessiya serverga yuborilmadi. Sahifani yangilang.');
    expect(accessErrorText('auth_invalid')).toBe('Server sessiyani qabul qilmadi. Qaytadan kiring.');
    expect(accessErrorText('auth_invalid', 'Invalid API key')).toBe('Server sessiyani qabul qilmadi (Invalid API key). Qaytadan kiring.');
  });

  it('keeps the owner-only message for a role mismatch', () => {
    expect(accessErrorText('access_denied')).toBe('Bu amal faqat korxona egasiga ruxsat etilgan.');
  });

  it('explains when the account has no company profile', () => {
    expect(accessErrorText('profile_missing')).toBe('Bu hisobga korxona profili bog‘lanmagan. Administratorga murojaat qiling.');
  });

  it('falls back to the server message and then to a generic text', () => {
    expect(accessErrorText('', 'Server xatosi')).toBe('Server xatosi');
    expect(accessErrorText('', '')).toBe('Amal bajarilmadi. Qayta urinib ko‘ring.');
  });
});
