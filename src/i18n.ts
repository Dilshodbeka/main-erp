import type { CashSource, DefectReason, ItemKind, OperationUnit, Order, PayrollEntry, Status, TaskStatus } from './types';
import { operationUnitLabel } from '../supabase/functions/_shared/telegram';

export const messages = {
  save: 'Saqlash',
  cancel: 'Bekor qilish',
  acceptTask: 'Qabul qilish',
  startTask: 'Boshlash',
  finishTask: 'Yakunlash',
  pending: 'Tekshiruvda',
  accepted: 'Qabul qilingan',
  rejected: 'Qaytarilgan',
  debt: 'Qarz',
  advance: 'Avans',
  revenue: 'Tushum',
  expense: 'Xarajat',
  statusDraft: 'Hisob-kitob',
  statusProduction: 'Ishlab chiqarishda',
  statusReady: 'Tayyor',
  statusShipped: 'Yuborilmoqda',
  statusDelivered: 'Yetkazilgan',
  statusCancelled: 'Bekor qilingan',
  taskAssigned: 'Tayinlangan',
  taskAccepted: 'Qabul qilingan',
  taskInProgress: 'Bajarilmoqda',
  taskSubmitted: 'Tekshiruvda',
  taskCompleted: 'Topshirilgan',
  orderProduct: 'Mebel',
  orderService: 'Xizmat',
  orderSeries: 'Seriya',
  orderComposite: 'Aralash',
  itemMaterial: 'Material',
  itemBlank: 'Zagotovka',
  itemFinished: 'Tayyor mahsulot',
  cashManual: 'Qo‘lda kiritilgan',
  cashSale: 'Mijoz / do‘kon to‘lovi',
  cashSupplier: 'Yetkazib beruvchiga to‘lov',
  cashPayroll: 'Xodimga to‘lov',
  cashTransfer: 'Hisoblar o‘rtasida o‘tkazma',
  cashExpense: 'Oylik xarajat to‘lovi',
  cashLoan: 'Zaym operatsiyasi',
  payrollPending: 'Kutilmoqda',
  payrollAccepted: 'Hisoblangan',
  payrollRejected: 'Qaytarilgan',
} as const;

export type MessageKey = keyof typeof messages;

export function t(key: MessageKey): string {
  return messages[key];
}

const moneyFormat = new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 0 });
const qtyFormat = new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 3 });

export function formatMoney(value: number): string {
  return `${moneyFormat.format(value)} so‘m`;
}

export function formatQty(value: number): string {
  return qtyFormat.format(value);
}

export function formatDate(value: string): string {
  return value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short' }) : '—';
}

export function formatDateTime(value: string): string {
  if (!value) return '—';
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return '—';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(parsed.getDate())}.${pad(parsed.getMonth() + 1)}.${parsed.getFullYear()} · ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

const statuses: Record<Status, MessageKey> = {
  draft: 'statusDraft',
  production: 'statusProduction',
  ready: 'statusReady',
  shipped: 'statusShipped',
  delivered: 'statusDelivered',
  cancelled: 'statusCancelled',
};

const taskStatuses: Record<TaskStatus, MessageKey> = {
  assigned: 'taskAssigned',
  accepted: 'taskAccepted',
  in_progress: 'taskInProgress',
  submitted: 'taskSubmitted',
  completed: 'taskCompleted',
};

const orderKinds: Record<Order['kind'], MessageKey> = {
  product: 'orderProduct',
  service: 'orderService',
  series: 'orderSeries',
  composite: 'orderComposite',
};

const itemKinds: Record<ItemKind, MessageKey> = {
  material: 'itemMaterial',
  blank: 'itemBlank',
  finished: 'itemFinished',
};

const cashSources: Record<CashSource, MessageKey> = {
  manual: 'cashManual',
  sale: 'cashSale',
  supplier: 'cashSupplier',
  payroll: 'cashPayroll',
  expense: 'cashExpense',
  transfer: 'cashTransfer',
  loan: 'cashLoan',
};

const payrollStatuses: Record<PayrollEntry['status'], MessageKey> = {
  pending: 'payrollPending',
  accepted: 'payrollAccepted',
  rejected: 'payrollRejected',
};

export function statusLabel(status: Status): string {
  return t(statuses[status]);
}

export function taskStatusLabel(status: TaskStatus): string {
  return t(taskStatuses[status]);
}

export function orderKindLabel(kind: Order['kind']): string {
  return t(orderKinds[kind]);
}

export function itemKindLabel(kind: ItemKind): string {
  return t(itemKinds[kind]);
}

export function cashSourceLabel(source: CashSource): string {
  return t(cashSources[source]);
}

const cashCategories: Record<string, string> = {
  payroll: 'Ish haqi',
  'Payroll payment': 'Ish haqi',
  advance: 'Avans',
  sale: 'Mijoz to‘lovi',
  supplier: 'Yetkazib beruvchi',
  'Supplier payment': 'Yetkazib beruvchi',
  manual: 'Qo‘lda kiritilgan',
  expense: 'Oylik xarajat',
  transfer: 'O‘tkazma',
  'loan-draw': 'Zaym olindi',
  'loan-repay': 'Zaym qaytarildi',
  outsourcing: 'Autsors xizmatiga to‘lov',
};

/** Журнал печатает category как есть: админские категории остаются текстом владельца, служебные — переводятся. */
export function cashCategoryLabel(category: string): string {
  return cashCategories[category] ?? category;
}

export function payrollStatusLabel(status: PayrollEntry['status']): string {
  return t(payrollStatuses[status]);
}

export const defectReasonLabels: Record<DefectReason, string> = {
  quality: 'Sifat nuqsoni',
  measurement: 'Noto‘g‘ri o‘lchov',
  drawing: 'Chizmadagi xato',
  customer: 'Mijoz topshirig‘i',
  other: 'Boshqa',
};

export function defectReasonLabel(reason: DefectReason): string {
  return defectReasonLabels[reason];
}

export function unitLabel(unit: OperationUnit): string {
  return operationUnitLabel(unit);
}

export function unitText(unit: string): string {
  return ({ 'шт': 'dona', 'лист': 'list', 'м': 'm', 'м²': 'm²', 'кг': 'kg', 'л': 'l' } as Record<string, string>)[unit] ?? unit;
}

const errorMessages: [RegExp, string][] = [
  [/revision conflict/i, 'Hisob boshqa foydalanuvchi tomonidan o‘zgartirildi. Ma’lumotlarni yangilang va amalni tekshiring.'],
  [/insufficient.*(balance|funds)|negative.*(cash|balance)|account.*negative/i, 'Tanlangan hisobda mablag‘ yetarli emas.'],
  // Порядок важен: частные тексты нехватки идут до общих /previous.*(route|stage)/ и /already issued/.
  // Третья запись — подстраховка для серверных текстов, которых домен не бросает (erp_execute: 'Insufficient unreserved material stock').
  // Голый 'Insufficient stock' в выдачу не входит: это текст продажи из магазина (shipment.create), где списка материалов нет.
  [/insufficient available stock/i, 'Buyurtmani ishga tushirib bo‘lmaydi: bo‘sh material band qilinganlar hisobiga yetishmaydi. Ro‘yxatni «Ishlab chiqarish» bo‘limida ko‘ring.'],
  [/insufficient reserved stock|insufficient stock for issue/i, 'Materiallarni berib bo‘lmaydi: omborda yetarli emas. Kerak va bor miqdor materiallar ro‘yxatida ko‘rsatilgan.'],
  [/insufficient.*stock|below.*reserv|stock cannot/i, 'Bo‘sh material yetarli emas yoki qoldiq zaxiradan kam.'],
  [/order.*(unpaid|debt).*|debt.*allowDebt/i, 'Buyurtma to‘lanmagan. Qarz bilan yuborish uchun egasining aniq ruxsati kerak.'],
  [/payment exceeds|advance exceeds/i, 'Summa qarz qoldig‘idan oshadi. Ortiqcha to‘lov taqiqlangan.'],
  [/invalid review decision/i, 'Qabul qarori noto‘g‘ri.'],
  [/review must be plain/i, 'Qabul qilishda brak maydonlari bo‘lishi mumkin emas.'],
  [/defect reason is required/i, 'Brak sababini tanlang.'],
  [/defect note is required/i, '«Boshqa» sababi uchun izoh yozing.'],
  [/defect note is too long/i, 'Brak izohi 500 belgidan oshmasligi mumkin.'],
  [/defect quantity is invalid/i, 'Brak miqdorini kiriting.'],
  [/nothing to reject/i, 'Brak miqdori nolga teng bo‘lishi mumkin emas.'],
  [/defect quantity exceeds report/i, 'Brak miqdori topshirilgan miqdordan oshmasligi mumkin.'],
  [/report exceeds|remaining.*quantity/i, 'Miqdor bosqichning qabul qilinmagan qoldig‘idan oshadi.'],
  [/previous.*(route|stage)|task is not available/i, 'Avval materiallarni bering va oldingi bosqichni yakunlang.'],
  [/already (issued|reviewed|reversed|delivered|recorded)|all materials already issued/i, 'Bu amal allaqachon bajarilgan. Qayta o‘tkazish taqiqlangan.'],
  [/reverse.*reversal|cannot reverse a reversal/i, 'Stornoni storno qilish mumkin emas. Asl yozuv allaqachon qoplangan.'],
  [/name already exists|duplicate.*name|unique.*name/i, 'Bu nomdagi yozuv allaqachon mavjud.'],
  [/ticket text is required/i, 'Murojaat matnini kiriting.'],
  [/ticket text is too long/i, 'Murojaat matni 2000 belgidan oshmasligi kerak.'],
  [/ticket not found/i, 'Murojaat topilmadi. Sahifani yangilang va qayta urinib ko‘ring.'],
  [/ticket is full/i, 'Bu murojaatga boshqa xabar qo‘shilmaydi: 200 ta xabar chegarasiga yetdi. Yangi murojaat oching.'],
  [/invalid ticket context/i, 'Diagnostika ma’lumoti noto‘g‘ri. Sahifani yangilang va qayta yuboring.'],
  [/not assigned|administrator action|workers may only|profile.*(found|active)|access denied/i, 'Ruxsat yetarli emas. Egasi tayinlash va kirish profilini tekshirishi kerak.'],
  [/belongs to another customer|customer-owned/i, 'Mijoz materialini boshqa buyurtmachiga ishlatish yoki o‘z materiali sifatida baholash mumkin emas.'],
  [/invalid login credentials/i, 'Email yoki parol noto‘g‘ri.'],
  [/authentication user not found|user from sub claim/i, 'Bu sessiya hisobi Supabase Auth bazasida topilmadi — foydalanuvchi o‘chirilgan. «Boshqa hisob bilan kirish» tugmasini bosing yoki administratorga murojaat qiling.'],
  [/already belongs to a company/i, 'Bu hisob allaqachon korxonaga bog‘langan. Sahifani yangilang.'],
  [/authentication required|not authenticated/i, 'Avval hisobingizga kiring.'],
  [/supplier amount is required/i, 'Autsors bosqichini qabul qilishdan oldin pudratchi summasini buyurtmada kiriting.'],
  [/invalid (amount|quantity)|finite|trillion|limit.*numeric/i, 'Miqdor va summani tekshiring: qiymat ruxsat etilgan oraliqdan tashqarida.'],
  [/order requires.*route|production route.*required/i, 'Kamida bitta ishlab chiqarish bosqichini qo‘shing.'],
  [/cancelled position cannot be revised/i, 'Bekor qilingan pozitsiyani qayta tahrirlab bo‘lmadi.'],
  [/stage quantity.*accepted work/i, 'Bosqich miqdorini qabul qilingan ish miqdoridan kamaytirib bo‘lmaydi.'],
  [/order line cannot be removed/i, 'Ochiq pozitsiyani tahrirda o‘chirib bo‘lmaydi — avval uni bekor qiling.'],
  [/paid, issued or used orders|order already has production|reverse order payments/i, 'Buyurtma allaqachon to‘langan yoki ishlab chiqarishda ishlatilgan. Oddiy bekor qilish taqiqlangan.'],
  [/fetch failed|failed to fetch|network/i, 'Server bilan aloqa yo‘q. Oflayn navbat holatini tekshiring.'],
];

export function translateError(message: string): string {
  return errorMessages.find(([pattern]) => pattern.test(message))?.[1] || message;
}
