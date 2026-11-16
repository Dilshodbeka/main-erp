import type { Actor, State } from './types';

export type GuideAction =
  | { kind: 'modal'; modal: string; label: string }
  | { kind: 'page'; page: string; label: string };

export interface GuideStep {
  id: string; title: string; detail: string; done: boolean; blocked: boolean; action?: GuideAction;
}

export interface PageGuide {
  page: string; title: string; purpose: string; steps: GuideStep[]; outcome: string;
}

interface StepInput {
  id: string; title: string; detail: string; done: boolean;
  action?: GuideAction; needs?: string[];
}

const step = (input: StepInput, done: Map<string, boolean>): GuideStep => ({
  id: input.id, title: input.title, detail: input.detail, done: input.done, action: input.action,
  blocked: !!input.needs?.some(id => !done.get(id)),
});

const build = (inputs: StepInput[]): GuideStep[] => {
  const done = new Map(inputs.map(input => [input.id, input.done]));
  return inputs.map(input => step(input, done));
};

const titles: Record<string, string> = {
  dashboard: 'Umumiy ko‘rinish', orders: 'Savdo va CRM', history: 'Tarix va analitika',
  shops: 'Do‘konlar', production: 'Ishlab chiqarish', warehouse: 'Ombor',
  series: 'Seriyalar va retseptlar', purchases: 'Ta’minot', people: 'Xodimlar',
  logistics: 'Yetkazib berish', cash: 'Moliya va kassa', analytics: 'Hisobotlar', settings: 'Sozlamalar',
};

export function pageGuide(state: State, page: string, actor: Actor): PageGuide {
  if (actor.role !== 'admin') return workerGuide(state, page, actor);
  const ownItems = state.items.filter(item => !item.customerId);
  const finished = ownItems.filter(item => item.kind === 'finished');
  const shopCustomers = state.customers.filter(customer => customer.kind === 'shop');
  const orders = state.orders.filter(order => order.kind !== 'series');
  const activeOrders = orders.filter(order => ['production', 'ready', 'shipped'].includes(order.status));
  const readyOrders = orders.filter(order => ['ready', 'shipped'].includes(order.status));
  const sales = state.cash.filter(entry => entry.source === 'sale');
  const shopSales = sales.filter(entry => shopCustomers.some(shop => shop.id === entry.customerId));
  const supplierPayments = state.cash.filter(entry => entry.source === 'supplier');
  const payrollPayments = state.cash.filter(entry => entry.source === 'payroll');
  const manualIn = state.cash.filter(entry => entry.source === 'manual' && entry.direction === 'in');
  const manualOut = state.cash.filter(entry => entry.source === 'manual' && entry.direction === 'out');
  const purchaseMovements = state.movements.filter(movement => movement.source === 'purchase');
  const countMovements = state.movements.filter(movement => movement.source === 'inventory');
  const delivered = state.shipments.filter(shipment => shipment.status === 'delivered');
  const shipments = state.shipments.filter(shipment => shipment.status !== 'cancelled');
  const acceptedReports = state.reports.filter(report => report.status === 'accepted');
  const operations = state.operations;
  const employees = state.employees.filter(employee => employee.active);
  const operationsAssigned = operations.some(operation => operation.employeeIds.length > 0);

  const base: Record<string, PageGuide> = {
    dashboard: {
      page: 'dashboard', title: titles.dashboard,
      purpose: 'Bu yerda butun ish bir ekranda ko‘rinadi: buyurtmalar, sex, ombor va pul. Ma’lumot qo‘shilgan sari raqamlar o‘zi to‘ladi.',
      steps: build([
        { id: 'customers', title: 'Mijoz qo‘shing', detail: 'Buyurtma, qarz va to‘lovlar mijoz kartasiga bog‘lanadi. Savdo bo‘limidagi «Mijoz» tugmasi orqali qo‘shiladi.', done: state.customers.length > 0, action: { kind: 'modal', modal: 'customer', label: 'Mijoz qo‘shish' } },
        { id: 'operations', title: 'Ishlab chiqarish bosqichini yarating', detail: 'Kesish, kromka, yig‘ish kabi bosqichlar tannarx va mijoz narxi bilan Sozlamalarda yaratiladi.', done: operations.length > 0, action: { kind: 'page', page: 'settings', label: 'Sozlamalarga o‘tish' } },
        { id: 'employees', title: 'Xodim qo‘shing', detail: 'Bosqichga ijrochi tanlanadi; xodimning oyligi har oy alohida belgilanadi.', done: employees.length > 0, action: { kind: 'modal', modal: 'employee', label: 'Xodim qo‘shish' } },
        { id: 'items', title: 'Material qo‘shing', detail: 'Ombor pozitsiyalari buyurtmada band qilinadi, qoldiq va tannarx shu yerdan yuritiladi.', done: ownItems.length > 0, action: { kind: 'modal', modal: 'item', label: 'Material qo‘shish' } },
        { id: 'order', title: 'Birinchi buyurtmani qabul qiling', detail: 'Oldingi qadamlar tayyor bo‘lgach buyurtma yaratiladi, sexga tushadi va kassa hisoboti to‘ladi.', done: orders.length > 0, needs: ['customers', 'operations', 'employees'], action: { kind: 'modal', modal: 'order', label: 'Buyurtma yaratish' } },
      ]),
      outcome: 'Buyurtma sexga tushgach «Ishlab chiqarish» va «Yetkazib berish» bo‘limlari ishlaydi, kassa va hisobotlar to‘ladi.',
    },
    orders: {
      page: 'orders', title: titles.orders,
      purpose: 'Mebel va alohida xizmatlar bitta hisobda yuritiladi. Buyurtma yaratish uchun avval mijoz, bosqich va ijrochi kerak.',
      steps: build([
        { id: 'customers', title: 'Mijoz qo‘shing', detail: 'Har bir buyurtma mijoz kartasiga bog‘lanadi — qarz va to‘lovlar shu kartada yuritiladi.', done: state.customers.length > 0, action: { kind: 'modal', modal: 'customer', label: 'Mijoz qo‘shish' } },
        { id: 'operations', title: 'Bosqichlarni yarating', detail: 'Marshrut faqat ma’lumotnomadagi bosqichlardan tuziladi. Stavka buyurtma tannarxiga, narx mijozga.', done: operations.length > 0, action: { kind: 'page', page: 'settings', label: 'Sozlamalarga o‘tish' } },
        { id: 'employees', title: 'Xodim qo‘shing', detail: 'Har bir bosqichga ijrochi tayinlanadi; oylik har oy alohida belgilanadi.', done: employees.length > 0, action: { kind: 'modal', modal: 'employee', label: 'Xodim qo‘shish' } },
        { id: 'order', title: 'Buyurtma yarating', detail: 'Mijoz, narx, materiallar va marshrut bitta formada kiritiladi.', done: orders.length > 0, needs: ['customers', 'operations', 'employees'], action: { kind: 'modal', modal: 'order', label: 'Buyurtma yaratish' } },
        { id: 'payment', title: 'Mijoz to‘lovini qabul qiling', detail: 'Buyurtma kartasini oching va «To‘lovni qabul qilish» tugmasini bosing. To‘lov kassaga tushadi, qarz kamayadi.', done: sales.length > 0 },
      ]),
      outcome: 'To‘lovdan keyin mijoz kartasi, kassa va hisobotlar yangilanadi. Buyurtma sexga tushgach ish bosqichlari paydo bo‘ladi.',
    },
    history: {
      page: 'history', title: titles.history,
      purpose: 'Yakunlangan buyurtmalar tarixi: tushum, tannarx, foyda va to‘lovlar. Arxiv faqat real harakatlardan to‘ladi.',
      steps: build([
        { id: 'orders', title: 'Buyurtma yarating', detail: 'Tarix yakunlangan va bekor qilingan buyurtmalardan shakllanadi.', done: orders.length > 0, action: { kind: 'page', page: 'orders', label: 'Buyurtmalarga o‘tish' } },
        { id: 'shipped', title: 'Buyurtmani yuboring', detail: 'Yetkazib berish bo‘limida yuborish yaratiladi — tushum yuborishda tan olinadi.', done: shipments.some(shipment => shipment.kind === 'order'), action: { kind: 'page', page: 'logistics', label: 'Yetkazib berish' } },
        { id: 'delivered', title: 'Yetkazishni tasdiqlang', detail: 'Yetkazilgan yuborishlar arxivda to‘liq ko‘rinadi.', done: delivered.length > 0 },
        { id: 'paid', title: 'To‘lovlarni qabul qiling', detail: 'Mijoz to‘lovi kassaga tushgach qarz va foyda hisoboti yopiladi.', done: sales.length > 0 },
      ]),
      outcome: 'Har bir buyurtma bo‘yicha tushum, tannarx va foyda yig‘iladi, hisob-fakturani qayta chop etish mumkin.',
    },
    shops: {
      page: 'shops', title: titles.shops,
      purpose: 'Do‘konlarga tayyor mahsulot yuborish, qarz va avans alohida yuritiladi. Avval do‘kon va tayyor mahsulot kerak.',
      steps: build([
        { id: 'shop', title: 'Do‘kon yarating', detail: 'Savdo bo‘limida mijoz turi «Do‘kon — ombor savdosi» bo‘lgan karta yarating.', done: shopCustomers.length > 0, action: { kind: 'modal', modal: 'customer', label: 'Do‘kon qo‘shish' } },
        { id: 'finished', title: 'Tayyor mahsulot pozitsiyasi', detail: 'Katalogda «Tayyor mahsulot» turidagi pozitsiya va uning qoldig‘i bo‘lishi kerak.', done: finished.length > 0, action: { kind: 'modal', modal: 'item', label: 'Pozitsiya qo‘shish' } },
        { id: 'stockSale', title: 'Do‘konga yuboring', detail: 'Tayyor mahsulot katalog narxida yuboriladi; qarz va avans do‘kon kartasida yuritiladi.', done: shipments.some(shipment => shipment.kind === 'stock'), needs: ['shop', 'finished'], action: { kind: 'modal', modal: 'stockSale', label: 'Yuborish' } },
        { id: 'paid', title: 'Do‘kon to‘lovini qabul qiling', detail: 'To‘lov oldingi yuborishlarni yopadi, ortig‘i avans bo‘lib qoladi.', done: shopSales.length > 0 },
      ]),
      outcome: 'Har bir do‘kon bo‘yicha yuborilgan, to‘langan, qarz va avans alohida hisoblanadi.',
    },
    production: {
      page: 'production', title: titles.production,
      purpose: 'Buyurtma marshruti bo‘yicha ish va natijani qabul qilish. Bosqich tannarxi mijoz narxiga teng emas.',
      steps: build([
        { id: 'operations', title: 'Bosqichlarni yarating', detail: 'Har bir bosqichning tannarxi va mijoz narxi Sozlamalarda belgilanadi.', done: operations.length > 0, action: { kind: 'page', page: 'settings', label: 'Sozlamalarga o‘tish' } },
        { id: 'employees', title: 'Xodim qo‘shing', detail: 'Bosqich faqat tayinlangan va faol xodimga ko‘rinadi.', done: employees.length > 0, action: { kind: 'modal', modal: 'employee', label: 'Xodim qo‘shish' } },
        { id: 'launched', title: 'Buyurtmani sexga tushiring', detail: 'Qoralamadagi buyurtma «Sexga ishga tushirish» tugmasi bilan ochiladi.', done: activeOrders.length > 0, action: { kind: 'page', page: 'orders', label: 'Buyurtmalarga o‘tish' } },
        { id: 'materials', title: 'Materiallarni sexga bering', detail: 'Band qilingan materiallar berilmasa, natijani topshirib bo‘lmaydi.', done: state.orders.filter(order => order.status === 'production').every(order => order.materials.every(line => line.issuedQty >= line.qty)) },
        { id: 'submitted', title: 'Natijani qabul qiling', detail: 'Xodim miqdorni topshiradi, natija qabul qilinadi — qabul qilingan hajm buyurtma tannarxiga tushadi.', done: acceptedReports.length > 0 },
      ]),
      outcome: 'Qabul qilingan natijalar buyurtma tannarxiga tushadi; yuborish va foyda hisoboti shundan yig‘iladi.',
    },
    warehouse: {
      page: 'warehouse', title: titles.warehouse,
      purpose: 'Katalog, qoldiq va o‘rtacha tannarx. Qoldiq faqat xarid qabuli yoki natijadan keyin oshadi.',
      steps: build([
        { id: 'items', title: 'Material pozitsiyasini qo‘shing', detail: 'Nomi, o‘lchovi va minimal zaxirasi bilan katalogga qo‘shiladi.', done: ownItems.length > 0, action: { kind: 'modal', modal: 'item', label: 'Pozitsiya qo‘shish' } },
        { id: 'supplier', title: 'Yetkazib beruvchini qo‘shing', detail: 'Xarid va qarz yetkazib beruvchi kartasiga bog‘lanadi.', done: state.suppliers.length > 0, action: { kind: 'modal', modal: 'supplier', label: 'Ta’minotchi qo‘shish' } },
        { id: 'purchase', title: 'Xarid yarating', detail: 'Ta’minot bo‘limida xarid rasmiylashtiriladi; qoldiq faqat qabuldan keyin oshadi.', done: state.purchases.length > 0, needs: ['items', 'supplier'], action: { kind: 'modal', modal: 'purchase', label: 'Xarid yaratish' } },
        { id: 'received', title: 'Materiallarni qabul qiling', detail: 'Qisman qabul ham mumkin; o‘rtacha tannarx qayta hisoblanadi.', done: purchaseMovements.length > 0, action: { kind: 'page', page: 'purchases', label: 'Ta’minotga o‘tish' } },
        { id: 'counted', title: 'Qoldiqni sanang', detail: 'Inventarizatsiya qoldiqni haqiqiy miqdorga moslaydi va farqni yozadi.', done: countMovements.length > 0 },
      ]),
      outcome: 'Qoldiq, o‘rtacha tannarx va minimal zaxira ogohlantirishlari shu sahifada ko‘rinadi.',
    },
    series: {
      page: 'series', title: titles.series,
      purpose: 'Standart mahsulotlar retsept bo‘yicha seriyada chiqariladi. Seriya mijoz qarzini yaratmaydi.',
      steps: build([
        { id: 'material', title: 'Material qo‘shing', detail: 'Retsept tarkibi katalogdagi materiallardan tanlanadi.', done: ownItems.length > 0, action: { kind: 'modal', modal: 'item', label: 'Material qo‘shish' } },
        { id: 'finished', title: 'Tayyor mahsulot pozitsiyasini qo‘shing', detail: 'Seriya natijasi shu pozitsiya sifatida omborga tushadi.', done: finished.length > 0, action: { kind: 'modal', modal: 'item', label: 'Pozitsiya qo‘shish' } },
        { id: 'recipe', title: 'Retsept yarating', detail: 'Retsept versiyasida materiallar va ruxsat etilgan almashtirishlar belgilanadi.', done: state.recipes.length > 0 },
        { id: 'series', title: 'Seriyani chiqaring', detail: 'Seriya ishga tushgach natija tayyor mahsulot omboriga tushadi.', done: state.orders.some(order => order.kind === 'series') },
      ]),
      outcome: 'Tayyor mahsulot omborga tushgach «Do‘konlar» bo‘limida yuborish ochiladi.',
    },
    purchases: {
      page: 'purchases', title: titles.purchases,
      purpose: 'Xarid, qisman qabul va to‘lov alohida amallar. Avval ta’minotchi va material kerak.',
      steps: build([
        { id: 'suppliers', title: 'Yetkazib beruvchini qo‘shing', detail: 'Har bir xarid va qarz aniq ta’minotchiga bog‘lanadi.', done: state.suppliers.length > 0, action: { kind: 'modal', modal: 'supplier', label: 'Ta’minotchi qo‘shish' } },
        { id: 'items', title: 'Material qo‘shing', detail: 'Xarid satri katalogdagi o‘z materialidan tanlanadi.', done: ownItems.length > 0, action: { kind: 'modal', modal: 'item', label: 'Material qo‘shish' } },
        { id: 'purchase', title: 'Xarid yarating', detail: 'Narx xaridda qotib qoladi; qoldiq hali oshmaydi.', done: state.purchases.length > 0, needs: ['suppliers', 'items'], action: { kind: 'modal', modal: 'purchase', label: 'Xarid yaratish' } },
        { id: 'received', title: 'Materiallarni qabul qiling', detail: 'Qisman qabul ham mumkin; qoldiq va o‘rtacha tannarx shundan keyin yangilanadi.', done: purchaseMovements.length > 0, action: { kind: 'page', page: 'purchases', label: 'Qabul qilish' } },
        { id: 'paid', title: 'Ta’minotchiga to‘lang', detail: 'Qabul qilingan material uchun qarz kartada qoladi; to‘lov kassadan chiqadi va qarzni yopadi.', done: supplierPayments.length > 0 },
      ]),
      outcome: 'Qabul zaxirani oshiradi, to‘lov qarzni kamaytiradi — ikkalasi alohida yozuv sifatida saqlanadi.',
    },
    people: {
      page: 'people', title: titles.people,
      purpose: 'Xodimlar, bosqichlar va oylik ish haqi. Oylik har oy uchun belgilanadi.',
      steps: build([
        { id: 'employees', title: 'Xodim qo‘shing', detail: 'Faol xodimga bosqich tayinlanadi va oylik hisobi ochiladi.', done: state.employees.length > 0, action: { kind: 'modal', modal: 'employee', label: 'Xodim qo‘shish' } },
        { id: 'operations', title: 'Bosqich stavkalarini belgilang', detail: 'Bosqich tannarxi va mijoz narxi Sozlamalardagi bosqichlarda yuritiladi.', done: operations.length > 0, action: { kind: 'page', page: 'settings', label: 'Sozlamalarga o‘tish' } },
        { id: 'route', title: 'Xodimga bosqich tayinlang', detail: 'Buyurtma marshrutidagi har bir bosqichga ijrochi tanlanadi.', done: state.orders.some(order => order.route.length > 0), action: { kind: 'page', page: 'orders', label: 'Buyurtmalarga o‘tish' } },
        { id: 'accepted', title: 'Natijani qabul qiling', detail: 'Xodim topshirgan miqdor qabul qilinadi va buyurtma tannarxiga tushadi.', done: acceptedReports.length > 0 },
        { id: 'paid', title: 'Oylikni to‘lang', detail: 'Xodim kartasidagi «To‘lash» tugmasi orqali; to‘lov kassadan chiqadi.', done: payrollPayments.length > 0 },
      ]),
      outcome: 'Har bir xodim bo‘yicha belgilangan oylik, to‘langan summa va qoldiq alohida yuritiladi.',
    },
    logistics: {
      page: 'logistics', title: titles.logistics,
      purpose: 'Tayyor buyurtmani qismlarga bo‘lib yuborish va yetkazishni tasdiqlash.',
      steps: build([
        { id: 'ready', title: 'Buyurtma tayyor bo‘lsin', detail: 'Barcha bosqichlar qabul qilingach buyurtma yuborishga tayyor bo‘ladi.', done: readyOrders.length > 0, action: { kind: 'page', page: 'orders', label: 'Buyurtmalarga o‘tish' } },
        { id: 'shipment', title: 'Yuborish yarating', detail: 'Miqdor, manzil va yetkazish sanasi kiritiladi; qisman yuborish mumkin.', done: shipments.some(shipment => shipment.kind === 'order'), needs: ['ready'], action: { kind: 'modal', modal: 'shipment', label: 'Yuborish' } },
        { id: 'delivered', title: 'Yetkazishni tasdiqlang', detail: 'Tasdiqdan keyin tushum tan olinadi va hisob-faktura chiqadi.', done: delivered.length > 0 },
      ]),
      outcome: 'Yetkazish tasdiqlanganda tushum tan olinadi; hisob-fakturani shu yerdan chop etish mumkin.',
    },
    cash: {
      page: 'cash', title: titles.cash,
      purpose: 'Kassa va bank harakati tarixni saqlagan holda yuritiladi. Har bir yozuvni storno bilan tuzatish mumkin.',
      steps: build([
        { id: 'opening', title: 'Boshlang‘ich qoldiqni kiriting', detail: 'Naqd va bankdagi haqiqiy pul «Provodka» orqali kiritiladi.', done: manualIn.some(entry => entry.category === 'Boshlang‘ich qoldiq'), action: { kind: 'modal', modal: 'cash', label: 'Qoldiq kiritish' } },
        { id: 'expenses', title: 'Xarajatlarni kiriting', detail: 'Ijara, kommunal, transport va boshqa xarajatlar alohida provodka bo‘ladi.', done: manualOut.length > 0, action: { kind: 'modal', modal: 'cash', label: 'Chiqim kiritish' } },
        { id: 'sales', title: 'Mijoz to‘lovlarini CRM orqali qabul qiling', detail: 'Buyurtma kartasidagi to‘lov kassaga tushadi va qarzni yopadi.', done: sales.length > 0, action: { kind: 'page', page: 'orders', label: 'Buyurtmalarga o‘tish' } },
      ]),
      outcome: 'Har bir yozuv storno bilan tuzatiladi. «Hisobotlar» tugmasida mijozlar, ta’minotchilar, buyurtmalar va kassa bo‘yicha davr hisoboti bor.',
    },
    analytics: {
      page: 'analytics', title: titles.analytics,
      purpose: 'Tanlangan davr uchun tushum, xarajat, foyda va kassa oqimi. Prognoz emas, haqiqiy yozuvlar.',
      steps: build([
        { id: 'shipments', title: 'Yuborish yarating', detail: 'Tushum yuborishda tan olinadi — to‘lovda emas.', done: shipments.some(shipment => shipment.kind === 'order'), action: { kind: 'page', page: 'logistics', label: 'Yetkazib berish' } },
        { id: 'delivered', title: 'Yetkazishni tasdiqlang', detail: 'Yetkazilgan buyurtma tannarx va foyda hisobiga tushadi.', done: delivered.length > 0 },
        { id: 'expenses', title: 'Umumiy xarajatlarni kiriting', detail: 'Ijara, kommunal va boshqa xarajatlar kassa orqali o‘tadi.', done: manualOut.length > 0, action: { kind: 'page', page: 'cash', label: 'Kassaga o‘tish' } },
        { id: 'accepted', title: 'Ish natijalarini qabul qiling', detail: 'Qabul qilingan ish buyurtma tannarxiga tushadi.', done: acceptedReports.length > 0 },
      ]),
      outcome: 'Tushum, to‘g‘ridan-to‘g‘ri xarajat, umumiy xarajat va foyda — hammasi bitta davr uchun.',
    },
    settings: {
      page: 'settings', title: titles.settings,
      purpose: 'Bosqichlar, xodimlar, umumiy baza va zaxira nusxa. Bu yerdagi o‘zgarish butun tizimga ta’sir qiladi.',
      steps: build([
        { id: 'operations', title: 'Ishlab chiqarish bosqichlarini yarating', detail: 'Quyidagi «Ishlab chiqarish bosqichlari» bo‘limida nom, o‘lchov, tannarx va narx kiritiladi.', done: operations.length > 0 },
        { id: 'employees', title: 'Xodim qo‘shing', detail: 'Xodim kirishi va oylik hisobi shu yerdan boshlanadi.', done: state.employees.length > 0, action: { kind: 'modal', modal: 'employee', label: 'Xodim qo‘shish' } },
        { id: 'assigned', title: 'Bosqichga xodim ruxsat bering', detail: 'Operatsiyani tahrirlab, ruxsat etilgan xodimlarni belgilang.', done: operationsAssigned },
      ]),
      outcome: 'Sozlamalar tayyor bo‘lgach buyurtma marshruti, oylik hisobi va umumiy baza ishlaydi; zaxira nusxani shu yerdan olish mumkin.',
    },
  };

  return base[page] ?? base.dashboard;
}

function workerGuide(state: State, page: string, actor: Actor): PageGuide {
  const tasks = state.orders.flatMap(order => order.route.filter(task => task.employeeId === actor.id));
  const reports = state.reports.filter(report => report.employeeId === actor.id);
  const started = tasks.some(task => ['in_progress', 'submitted', 'completed', 'accepted'].includes(task.status));

  return {
    page: 'production', title: titles.production,
    purpose: 'Sizga tayinlangan bosqichlar va natijani topshirish. Faqat o‘z ishingiz ko‘rinadi.',
    steps: build([
      { id: 'assigned', title: 'Bosqich tayinlanishini kuting', detail: 'Buyurtma marshrutida bosqich sizga tayinlangach ish shu sahifada chiqadi.', done: tasks.length > 0 },
      { id: 'started', title: 'Bosqichni boshlang', detail: 'Oldingi bosqich tugagach ish «Boshlash» tugmasi bilan ochiladi.', done: started },
      { id: 'submitted', title: 'Natijani topshiring', detail: 'Tayyor miqdorni kiriting; qabul sex ustasi tomonidan tasdiqlanadi.', done: reports.length > 0 },
    ]),
    outcome: 'Natija qabul qilingach buyurtma keyingi bosqichga o‘tadi. Bu sahifada faqat o‘z ishingiz ko‘rinadi.',
  };
}

export function nextStep(guide: PageGuide): GuideStep | null {
  return guide.steps.find(step => !step.done) ?? null;
}
