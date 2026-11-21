// Narx va stavkalar: barcha operatsiya va mahsulot narxlarini bitta jadvalda to‘ldirish.
import type { Command, Item, Operation, State } from './types';

export interface OperationPrice { salePrice: number; workerRate: number }
export interface PriceGaps { operations: Operation[]; norms: Operation[]; items: Item[]; costs: Item[] }

const valid = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1000000000000;

// Nima to‘ldirilmagan: stavkasiz/narxsiz operatsiyalar, normasiz m² bosqichlar, sotuv narxisiz mahsulot, tannarxsiz material.
export function priceGaps(state: State): PriceGaps {
  const active = state.operations.filter(row => row.active);
  return {
    operations: active.filter(row => row.workerRate <= 0 || row.salePrice <= 0),
    norms: active.filter(row => row.unit === 'squareMeter' && row.norms.length === 0),
    items: state.items.filter(row => row.customerId === null && row.kind === 'finished' && row.salePrice <= 0),
    costs: state.items.filter(row => row.customerId === null && row.kind === 'material' && row.cost <= 0),
  };
}

export function gapCount(gaps: PriceGaps): number {
  return gaps.operations.length + gaps.norms.length + gaps.items.length + gaps.costs.length;
}

// Faqat o‘zgargan qatorlar uchun buyruqlar; noto‘g‘ri son kiritilgan qator o‘tkazib yuboriladi.
export function priceCommands(state: State, operations: Record<string, Partial<OperationPrice>>, items: Record<string, number>): Command[] {
  const commands: Command[] = [];
  for (const row of state.operations) {
    const draft = operations[row.id];
    if (!draft) continue;
    const salePrice = draft.salePrice ?? row.salePrice;
    const workerRate = draft.workerRate ?? row.workerRate;
    if (!valid(salePrice) || !valid(workerRate)) continue;
    if (salePrice === row.salePrice && workerRate === row.workerRate) continue;
    commands.push({
      type: 'operation.update', operationId: row.id, name: row.name, unit: row.unit, salePrice, workerRate,
      standardMinutes: row.standardMinutes, machineId: row.machineId, employeeIds: [...row.employeeIds],
      active: row.active, autoAccept: row.autoAccept, norms: row.norms.map(norm => ({ ...norm })),
      ...(row.workshopId ? { workshopId: row.workshopId } : {}),
    });
  }
  for (const row of state.items) {
    const salePrice = items[row.id];
    if (salePrice === undefined || row.customerId !== null || !valid(salePrice) || salePrice === row.salePrice) continue;
    commands.push({ type: 'item.update', itemId: row.id, name: row.name, unit: row.unit, minQty: row.minQty, salePrice, category: row.category });
  }
  return commands;
}
