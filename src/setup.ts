import { dateOffset } from './seed';
import type { Command, State } from './types';

export type SetupStepId = 'employees' | 'materials' | 'operations' | 'order';

export interface SetupStep {
  id: SetupStepId;
  title: string;
  description: string;
  done: (state: State) => boolean;
}

export const setupSteps: SetupStep[] = [
  { id: 'employees', title: 'Xodimlar', description: 'Sex ustasi va yig‘uvchi kabi ishchilarni qo‘shing.', done: state => state.employees.some(row => row.active) },
  { id: 'materials', title: 'Materiallar', description: 'Bo‘yoq, qotiruvchi, abraziv va fasad pozitsiyalarini kiriting.', done: state => state.items.some(row => row.customerId === null) },
  { id: 'operations', title: 'Operatsiyalar', description: 'Jilolash va bo‘yash kabi ish turlarini bosqich tannarxi va normalar bilan sozlang.', done: state => state.operations.some(row => row.active) },
  { id: 'order', title: 'Birinchi buyurtma', description: 'Mijoz va bo‘yash buyurtmasini yarating — tizim qanday ishlashini ko‘ring.', done: state => state.orders.length > 0 },
];

const demoEmployees = ['Sex ustasi', 'Yig‘uvchi'] as const;
const demoItems = [
  { name: 'Fasad · eman', unit: 'dona', minQty: 0, category: '01.07' },
  { name: 'Fasad · oq', unit: 'dona', minQty: 0, category: '01.07' },
  { name: 'Poliuretan bo‘yoq · oq', unit: 'litr', minQty: 5, category: '06.01' },
  { name: 'Qotiruvchi', unit: 'litr', minQty: 2, category: '06.04' },
  { name: 'Erituvchi 646', unit: 'litr', minQty: 2, category: '06.05' },
  { name: 'Abraziv doira P120', unit: 'dona', minQty: 20, category: '07.03' },
] as const;
const demoCustomer = { name: 'Aziza Karimova', phone: '+998 90 123 45 67', address: 'Toshkent, Navoiy ko‘chasi, 24' };
const demoOrderTitle = 'Fasadlarni bo‘yash · 12 m²';
const sameName = (left: string, right: string) => left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
const findEmployee = (state: State, name: string) => state.employees.find(row => sameName(row.name, name));
const findItem = (state: State, name: string) => state.items.find(row => row.customerId === null && sameName(row.name, name));
const findOperation = (state: State, name: string) => state.operations.find(row => row.active && sameName(row.name, name));

function nextEmployee(state: State): Command | null {
  const missing = demoEmployees.find(name => !findEmployee(state, name));
  return missing ? { type: 'employee.create', name: missing } : null;
}

function nextItem(state: State): Command | null {
  const missing = demoItems.find(row => !findItem(state, row.name));
  return missing ? { type: 'item.create', name: missing.name, unit: missing.unit, minQty: missing.minQty, cost: 0, customerId: null, category: missing.category } : null;
}

function nextOperation(state: State): Command | null {
  const prerequisite = nextEmployee(state) ?? nextItem(state);
  if (prerequisite) return prerequisite;
  const employeeIds = state.employees.filter(row => row.active).map(row => row.id);
  if (!findOperation(state, 'Jilolash')) {
    const abrasive = findItem(state, 'Abraziv doira P120')!;
    return { type: 'operation.create', name: 'Jilolash', unit: 'squareMeter', salePrice: 80000, workerRate: 30000, standardMinutes: 0, machineId: null, employeeIds, active: true, autoAccept: false, norms: [{ itemId: abrasive.id, qtyPerM2: 0.5 }] };
  }
  if (!findOperation(state, 'Bo‘yash')) {
    const paint = findItem(state, 'Poliuretan bo‘yoq · oq')!;
    const hardener = findItem(state, 'Qotiruvchi')!;
    return { type: 'operation.create', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 150000, workerRate: 50000, standardMinutes: 0, machineId: null, employeeIds, active: true, autoAccept: false, norms: [{ itemId: paint.id, qtyPerM2: 0.25 }, { itemId: hardener.id, qtyPerM2: 0.1 }] };
  }
  return null;
}

function nextOrder(state: State): Command | null {
  const prerequisite = nextEmployee(state) ?? nextItem(state) ?? nextOperation(state);
  if (prerequisite) return prerequisite;
  const customer = state.customers.find(row => sameName(row.name, demoCustomer.name));
  if (!customer) return { type: 'customer.create', ...demoCustomer, kind: 'customer' };
  if (state.orders.some(row => row.customerId === customer.id && sameName(row.title, demoOrderTitle))) return null;
  const jilolash = findOperation(state, 'Jilolash')!;
  const boyash = findOperation(state, 'Bo‘yash')!;
  const worker = state.employees.find(row => row.active)!;
  return {
    type: 'order.create',
    input: {
      kind: 'service', customerId: customer.id, overhead: 100000,
      dueDate: dateOffset(7), advance: 0, account: 'bank',
      lines: [{
        kind: 'service', title: demoOrderTitle, qty: 1, unitPrice: 1800000, materials: [],
        route: [
          { operationId: jilolash.id, employeeId: worker.id, rate: 30000, qty: 12 },
          { operationId: boyash.id, employeeId: worker.id, rate: 50000, qty: 12 },
        ],
      }],
    },
  };
}

export function nextDemoCommand(step: SetupStepId, state: State): Command | null {
  if (step === 'employees') return nextEmployee(state);
  if (step === 'materials') return nextItem(state);
  if (step === 'operations') return nextOperation(state);
  return nextOrder(state);
}
