import { applyCommand, emptyState } from './domain';
import type { Actor, Command, State } from './types';

export function createDemo(actor: Actor): State {
  let state = emptyState();
  const run = (command: Command) => { state = applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor); };
  run({ type: 'customer.create', name: 'Aziza Karimova', phone: '+998 90 123 45 67', address: 'Toshkent, Navoiy ko‘chasi, 24', kind: 'customer' });
  run({ type: 'customer.create', name: '«Issiq uy» qahvaxonasi', phone: '+998 91 555 12 12', address: 'Toshkent, Chilonzor, 8', kind: 'customer' });
  run({ type: 'customer.create', name: '«Mo‘ljal» mebel saloni', phone: '+998 71 200 30 40', address: 'Toshkent, Bobur ko‘chasi, 15', kind: 'shop' });
  run({ type: 'supplier.create', name: 'Plita materiallari', phone: '+998 90 777 00 11' });
  run({ type: 'employee.create', name: 'Seh ustasi' });
  run({ type: 'employee.create', name: 'Yig‘uvchi' });
  run({ type: 'machine.create', name: 'Formatlash dastgohi', hourlyRevenueTarget: 200000 });
  const machineId = state.machines[0].id;
  const employeeIds = state.employees.filter(employee => employee.active).map(employee => employee.id);
  run({ type: 'operation.create', name: 'Kesish', unit: 'sheet', salePrice: 50000, workerRate: 5000, standardMinutes: 15, machineId, employeeIds, active: true, autoAccept: true });
  run({ type: 'operation.create', name: 'Kromka', unit: 'meter', salePrice: 95000, workerRate: 95000, standardMinutes: 0, machineId: null, employeeIds, active: true, autoAccept: true });
  run({ type: 'operation.create', name: 'Yig‘ish va nazorat', unit: 'piece', salePrice: 250000, workerRate: 250000, standardMinutes: 0, machineId: null, employeeIds, active: true, autoAccept: true });
  run({ type: 'item.create', name: 'LDSP 18 mm · tabiiy eman', unit: 'list', minQty: 5, cost: 0, customerId: null, category: '01.01' });
  run({ type: 'item.create', name: 'ABS kromka 2 mm', unit: 'm', minQty: 30, cost: 0, customerId: null, category: '02.01' });
  run({ type: 'item.create', name: 'Yumshoq yopiluvchi mentesha', unit: 'dona', minQty: 15, cost: 0, customerId: null, category: '05.01' });
  run({ type: 'item.create', name: 'Mijoz fasadlari · bo‘yash uchun', unit: 'dona', minQty: 0, cost: 0, customerId: state.customers[1].id, category: '01.07' });
  run({ type: 'item.create', name: 'Shkaf korpusi · zagotovka', unit: 'dona', minQty: 0, cost: 0, customerId: null, kind: 'blank' });
  run({ type: 'item.create', name: '«Standart» shkafi', unit: 'dona', minQty: 0, cost: 0, customerId: null, kind: 'finished', salePrice: 6500000 });
  run({ type: 'item.create', name: 'Fasad · eman', unit: 'dona', minQty: 0, cost: 0, customerId: null, category: '01.07' });
  run({ type: 'item.create', name: 'Fasad · oq', unit: 'dona', minQty: 0, cost: 0, customerId: null, category: '01.07' });
  run({ type: 'item.create', name: 'Poliuretan bo‘yoq · oq', unit: 'litr', minQty: 5, cost: 0, customerId: null, category: '06.01' });
  run({ type: 'item.create', name: 'Akril lak', unit: 'litr', minQty: 3, cost: 0, customerId: null, category: '06.02' });
  run({ type: 'item.create', name: 'Qotiruvchi', unit: 'litr', minQty: 2, cost: 0, customerId: null, category: '06.04' });
  run({ type: 'item.create', name: 'Erituvchi 646', unit: 'litr', minQty: 2, cost: 0, customerId: null, category: '06.05' });
  run({ type: 'item.create', name: 'Abraziv doira P120', unit: 'dona', minQty: 20, cost: 0, customerId: null, category: '07.03' });
  const blankItem = state.items[4].id;
  const cabinetItem = state.items[5].id;
  const oakFacade = state.items[6].id;
  const whiteFacade = state.items[7].id;
  const paintItem = state.items[8].id;
  const hardenerItem = state.items[10].id;
  const abrasiveItem = state.items[12].id;
  run({ type: 'operation.create', name: 'Jilolash', unit: 'squareMeter', salePrice: 80000, workerRate: 30000, standardMinutes: 0, machineId: null, employeeIds, active: true, autoAccept: false, norms: [{ itemId: abrasiveItem, qtyPerM2: 0.5 }] });
  run({ type: 'operation.create', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 150000, workerRate: 50000, standardMinutes: 0, machineId: null, employeeIds, active: true, autoAccept: false, norms: [{ itemId: paintItem, qtyPerM2: 0.25 }, { itemId: hardenerItem, qtyPerM2: 0.1 }] });
  run({ type: 'cash.post', direction: 'in', amount: 30000000, account: 'bank', toAccount: null, category: 'Boshlang‘ich qoldiq', note: 'Egasi mablag‘ining namoyishi — tushum emas' });
  run({ type: 'cash.post', direction: 'transfer', amount: 6000000, account: 'bank', toAccount: 'cash', category: 'O‘tkazma', note: 'Kassani to‘ldirish' });
  run({ type: 'purchase.create', supplierId: state.suppliers[0].id, lines: [
    { itemId: state.items[0].id, qty: 20, price: 550000 },
    { itemId: state.items[1].id, qty: 120, price: 12000 },
    { itemId: state.items[2].id, qty: 40, price: 45000 },
    { itemId: paintItem, qty: 20, price: 120000 },
    { itemId: hardenerItem, qty: 10, price: 180000 },
    { itemId: abrasiveItem, qty: 100, price: 8000 },
  ] });
  const purchase = state.purchases[0];
  run({ type: 'purchase.receive', purchaseId: purchase.id, lines: purchase.lines.map(l => ({ lineId: l.id, qty: l.qty })) });
  run({ type: 'supplier.pay', supplierId: state.suppliers[0].id, amount: 10000000, account: 'bank' });
  run({ type: 'purchase.create', supplierId: state.suppliers[0].id, lines: [
    { itemId: oakFacade, qty: 10, price: 180000 },
    { itemId: whiteFacade, qty: 10, price: 150000 },
  ] });
  let facadePurchase = state.purchases[1];
  run({ type: 'purchase.receive', purchaseId: facadePurchase.id, lines: facadePurchase.lines.map(l => ({ lineId: l.id, qty: l.qty })) });
  run({ type: 'purchase.create', supplierId: state.suppliers[0].id, lines: [
    { itemId: oakFacade, qty: 5, price: 195000 },
    { itemId: whiteFacade, qty: 5, price: 155000 },
  ] });
  facadePurchase = state.purchases[2];
  run({ type: 'purchase.receive', purchaseId: facadePurchase.id, lines: facadePurchase.lines.map(l => ({ lineId: l.id, qty: l.qty })) });
  run({ type: 'customer.receive', itemId: state.items[3].id, qty: 8, note: 'Mijoz fasadlari qabul qilindi, alohida mulk' });
  run({ type: 'order.create', input: {
    kind: 'product', customerId: state.customers[0].id, title: '«Tabiiy eman» oshxonasi', qty: 1, price: 16000000,
    overhead: 250000, dueDate: dateOffset(10), advance: 5000000, account: 'bank',
    materials: [{ itemId: state.items[0].id, qty: 6 }, { itemId: state.items[1].id, qty: 24 }, { itemId: state.items[2].id, qty: 12 }],
    route: state.operations.slice(0, 3).map((op, i) => ({ operationId: op.id, employeeId: state.employees[i === 2 ? 1 : 0].id, rate: op.workerRate })),
  } });
  const order = state.orders[0];
  run({ type: 'order.launch', orderId: order.id });
  run({ type: 'order.issue', orderId: order.id });
  run({ type: 'order.create', input: {
    kind: 'service', customerId: state.customers[1].id, title: 'Mijozning 8 fasadini bo‘yash', qty: 8, price: 4000000,
    overhead: 0, dueDate: dateOffset(3), advance: 0, account: 'cash',
    materials: [{ itemId: state.items[3].id, qty: 8 }],
    route: state.operations.slice(3).map(op => ({ operationId: op.id, employeeId: state.employees[1].id, rate: op.workerRate })),
  } });
  const service = state.orders[1];
  run({ type: 'order.launch', orderId: service.id });
  run({ type: 'order.issue', orderId: service.id });
  run({ type: 'work.accept', orderId: service.id, taskId: service.route[0].id });
  run({ type: 'supplier.create', name: 'Pudratchi Metall', phone: '+998 90 111 22 33' });
  const contractorId = state.suppliers.at(-1)!.id;
  run({ type: 'operation.create', name: 'Metall ish', unit: 'piece', salePrice: 900000, workerRate: 0,
    standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: true });
  const outsourcedOperationId = state.operations.at(-1)!.id;
  run({ type: 'order.create', input: {
    kind: 'service', customerId: state.customers[1].id, title: 'Metall karishlar', qty: 1, price: 900000,
    overhead: 0, dueDate: dateOffset(6), advance: 0, account: 'cash', materials: [],
    route: [{ operationId: outsourcedOperationId, executorKind: 'supplier', employeeId: null, supplierId: contractorId, rate: 0, supplierCost: 500000 }],
  } });
  const outsourced = state.orders.at(-1)!;
  run({ type: 'order.launch', orderId: outsourced.id });
  run({ type: 'recipe.create', outputItemId: blankItem, name: 'Shkaf korpusi', components: [
    { slot: 'LDSP', itemId: state.items[0].id, allowedItemIds: [], qtyPerUnit: 2 },
  ] });
  run({ type: 'recipe.create', outputItemId: cabinetItem, name: '«Standart» shkafi', components: [
    { slot: 'Korpus', itemId: state.items[0].id, allowedItemIds: [], qtyPerUnit: 3 },
    { slot: 'Fasad', itemId: oakFacade, allowedItemIds: [whiteFacade], qtyPerUnit: 1 },
  ] });
  const cabinetRecipe = state.recipes[1];
  run({ type: 'series.create', input: {
    outputItemId: cabinetItem, recipeVersionId: cabinetRecipe.versions[0].id, qty: 2,
    dueDate: dateOffset(12), substitutions: { 'Fasad': whiteFacade },
    route: [{ operationId: state.operations[2].id, employeeId: state.employees[1].id, rate: state.operations[2].workerRate }],
  } });
  const series = state.orders.at(-1)!;
  run({ type: 'order.launch', orderId: series.id });
  run({ type: 'order.issue', orderId: series.id });
  run({ type: 'item.create', name: '«Kompakt» shkafi', unit: 'dona', minQty: 0, cost: 0, customerId: null, kind: 'finished', salePrice: 4200000 });
  run({ type: 'inventory.count', itemId: state.items.at(-1)!.id, qty: 4, note: 'Do‘konlar uchun tayyor mahsulotning namoyish qoldig‘i' });
  run({ type: 'employee.create', name: 'Bo‘yoqchi (ketgan)' });
  run({ type: 'salary.plan.set', employeeId: state.employees[0].id, amount: 3200000, fromMonth: monthOffset(-1) });
  run({ type: 'salary.plan.set', employeeId: state.employees[1].id, amount: 2600000, fromMonth: monthOffset(-1) });
  run({ type: 'salary.plan.set', employeeId: state.employees[2].id, amount: 2400000, fromMonth: monthOffset(-1) });
  run({ type: 'salary.pay', employeeId: state.employees[0].id, amount: 3200000, account: 'cash', kind: 'payroll', note: 'O‘tgan oylik to‘lovi', allowPrepay: false });
  run({ type: 'salary.pay', employeeId: state.employees[1].id, amount: 1500000, account: 'cash', kind: 'advance', note: 'Oylikdan oldin avans', allowPrepay: false });
  run({ type: 'employee.update', employeeId: state.employees[2].id, name: state.employees[2].name, active: false, deactivatedAt: `${monthOffset(-1)}-12` });
  const demoNow = new Date().toISOString();
  const expenseA = crypto.randomUUID();
  const expenseB = crypto.randomUUID();
  state.expensePlans.push(
    { id: crypto.randomUUID(), planId: expenseA, title: 'Ijara', amount: 3000000, fromMonth: monthOffset(-1), dueDay: 10, supplierId: null, createdAt: demoNow },
    { id: crypto.randomUUID(), planId: expenseA, title: 'Ijara', amount: 3500000, fromMonth: monthOffset(0), dueDay: 10, supplierId: null, createdAt: demoNow },
    { id: crypto.randomUUID(), planId: expenseB, title: 'Kommunal xizmatlar', amount: 800000, fromMonth: monthOffset(0), dueDay: 20, supplierId: null, createdAt: demoNow },
  );
  const pay = (planId: string, amount: number, daysAgo: number, note: string) => state.cash.push({
    id: crypto.randomUUID(), direction: 'out', amount, account: 'cash', toAccount: null,
    source: 'expense', sourceId: planId, customerId: null, category: 'expense', note, number: null, reversalOf: null,
    createdAt: `${dateOffset(-daysAgo)}T09:00:00.000Z`,
  });
  pay(expenseA, 3000000, 20, 'O‘tgan oy ijarasi');
  pay(expenseB, 400000, 5, 'Qisman to‘lov');
  const loanA = crypto.randomUUID();
  const loanB = crypto.randomUUID();
  state.loans.push(
    { id: loanA, title: 'Jasur aka', kind: 'loan', amount: 10000000, note: 'Dastgoh uchun', createdAt: demoNow },
    { id: loanB, title: 'Sardor — investitsiya', kind: 'investment', amount: 5000000, note: 'Yangi bo‘limga ulush', createdAt: demoNow },
  );
  state.cash.push(
    { id: crypto.randomUUID(), direction: 'in', amount: 6000000, account: 'cash', toAccount: null, source: 'loan', sourceId: loanA, customerId: null, category: 'loan-draw', note: 'Birinchi transh', number: null, reversalOf: null, createdAt: `${dateOffset(-12)}T09:00:00.000Z` },
    { id: crypto.randomUUID(), direction: 'out', amount: 2000000, account: 'cash', toAccount: null, source: 'loan', sourceId: loanA, customerId: null, category: 'loan-repay', note: 'Qisman qaytarish', number: null, reversalOf: null, createdAt: `${dateOffset(-3)}T09:00:00.000Z` },
    { id: crypto.randomUUID(), direction: 'in', amount: 5000000, account: 'bank', toAccount: null, source: 'loan', sourceId: loanB, customerId: null, category: 'loan-draw', note: 'Investitsiya tushumi', number: null, reversalOf: null, createdAt: `${dateOffset(-15)}T09:00:00.000Z` },
  );
  run({ type: 'customer.create', name: 'Yig‘uvchi — shaxsiy hisob', phone: '', address: '', kind: 'customer', employeeId: state.employees[1].id });
  const workerCustomerId = state.customers.at(-1)!.id;
  state.shipments.push({
    id: crypto.randomUUID(), orderId: null, customerId: workerCustomerId, kind: 'stock',
    lines: [{ id: crypto.randomUUID(), itemId: null, description: 'Ustaga material', qty: 1, salePrice: 800000, unitCost: 0, materialCost: 0, laborCost: 0 }],
    address: '', dueDate: dateOffset(2), status: 'delivered', createdAt: `${dateOffset(-8)}T10:00:00.000Z`, deliveredAt: `${dateOffset(-8)}T10:00:00.000Z`, reversalOf: null,
  });
  state.workerDeductions.push({
    id: crypto.randomUUID(), employeeId: state.employees[1].id, customerId: workerCustomerId, amount: 300000,
    direction: 'deduct', note: 'Material uchun ushlab qolindi', reversalOf: null, createdAt: `${dateOffset(-6)}T09:00:00.000Z`,
  });
  run({ type: 'order.create', input: {
    kind: 'service', customerId: state.customers[1].id, title: 'Fasadlarni bo‘yash · 12 m²', qty: 1, price: 1800000,
    overhead: 100000, dueDate: dateOffset(7), advance: 0, account: 'bank',
    materials: [],
    route: [
      { operationId: state.operations[3].id, employeeId: state.employees[0].id, rate: 30000, qty: 12 },
      { operationId: state.operations[4].id, employeeId: state.employees[0].id, rate: 50000, qty: 12 },
    ],
  } });
  run({ type: 'routeTemplate.create', name: 'Bo‘yash xizmati', kind: 'service', stages: [
    { operationId: state.operations[3].id, employeeId: state.employees[1].id },
    { operationId: state.operations[4].id, employeeId: state.employees[1].id },
  ] });
  run({ type: 'routeTemplate.create', name: 'Oshxona pod klyuch', kind: 'product', stages: [
    { operationId: state.operations[0].id, employeeId: state.employees[0].id },
    { operationId: state.operations[1].id, employeeId: state.employees[0].id },
    { operationId: state.operations[2].id, employeeId: state.employees[1].id },
  ] });
  return state;
}

export function monthOffset(months: number): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function dateOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
