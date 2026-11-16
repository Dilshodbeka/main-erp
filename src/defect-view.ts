import type { DefectReason, OperationUnit, State } from './types';

export interface DefectMaterialRow { itemId: string; name: string; qty: number; amount: number }

export interface DefectJournalRow {
  id: string; createdAt: string; month: string; orderNumber: string; orderTitle: string;
  operationName: string; employeeName: string; qty: number; unit: OperationUnit;
  reason: DefectReason; note: string; materials: DefectMaterialRow[]; materialCost: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function defectMonths(state: State): string[] {
  return [...new Set(state.defects.map(row => row.createdAt.slice(0, 7)))].sort((left, right) => right.localeCompare(left));
}

export function defectJournalRows(state: State, month: string, employeeId: string): DefectJournalRow[] {
  return state.defects
    .filter(row => (!month || row.createdAt.slice(0, 7) === month) && (!employeeId || row.employeeId === employeeId))
    .map(row => {
      const order = state.orders.find(entry => entry.id === row.orderId);
      const operation = state.operations.find(entry => entry.id === row.operationId);
      const materials = row.materials.map(material => {
        const item = state.items.find(entry => entry.id === material.itemId);
        return { itemId: material.itemId, name: item?.name ?? material.itemId, qty: material.qty, amount: round2(material.qty * (item?.cost ?? 0)) };
      });
      return {
        id: row.id, createdAt: row.createdAt, month: row.createdAt.slice(0, 7),
        orderNumber: order?.number ?? '—', orderTitle: order?.title ?? '',
        operationName: operation?.name ?? '—',
        employeeName: state.employees.find(entry => entry.id === row.employeeId)?.name ?? '—',
        qty: row.qty, unit: operation?.unit ?? 'piece', reason: row.reason, note: row.note,
        materials, materialCost: round2(materials.reduce((sum, material) => sum + material.amount, 0)),
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
}

export interface DefectTotals { squareMeters: number; materialCost: number; top: { name: string; qty: number } | null }

export function defectTotals(rows: DefectJournalRow[]): DefectTotals {
  const square = rows.filter(row => row.unit === 'squareMeter');
  const byEmployee = new Map<string, number>();
  for (const row of square) byEmployee.set(row.employeeName, (byEmployee.get(row.employeeName) ?? 0) + row.qty);
  let top: { name: string; qty: number } | null = null;
  for (const [name, qty] of byEmployee) if (!top || qty > top.qty) top = { name, qty };
  return {
    squareMeters: round2(square.reduce((sum, row) => sum + row.qty, 0)),
    materialCost: round2(rows.reduce((sum, row) => sum + row.materialCost, 0)),
    top: top ? { name: top.name, qty: round2(top.qty) } : null,
  };
}
