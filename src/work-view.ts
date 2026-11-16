import { availableTask, supplierStagePlan, taskBlockReason, type TaskBlockReason } from './domain';
import { taskStatusLabel, formatMoney, unitLabel as operationUnitLabel } from './i18n';
import { withinPeriod } from './reports';
import type { Actor, OperationUnit, RouteLine, State, TaskStatus, WorkReport } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

export interface WorkTaskRow {
  orderId: string; taskId: string; number: string; title: string;
  operationName: string; planned: number; completed: number; defectQty: number; unit: OperationUnit;
  status: TaskStatus; dueDate: string; available: boolean; blockReason: TaskBlockReason | null; autoAccept: boolean;
}

export interface WorkHistoryRow {
  orderId: string; taskId: string; number: string; title: string;
  operationName: string; qty: number; unit: OperationUnit;
  status: WorkReport['status']; taskStatus: TaskStatus; createdAt: string;
}

export const boardTaskLabels: Record<TaskStatus, string> = {
  assigned: taskStatusLabel('assigned'),
  accepted: taskStatusLabel('accepted'),
  in_progress: taskStatusLabel('in_progress'),
  submitted: taskStatusLabel('submitted'),
  completed: taskStatusLabel('completed'),
};

export function boardTaskLabel(status: TaskStatus): string {
  return boardTaskLabels[status];
}

export const operationUnits: [OperationUnit, string][] = (['sheet', 'meter', 'squareMeter', 'piece', 'hole', 'minute', 'hour'] as OperationUnit[])
  .map(unit => [unit, operationUnitLabel(unit)]);

export function unitLabel(unit: OperationUnit): string {
  return operationUnitLabel(unit);
}

export function taskUnit(state: State, task: RouteLine): OperationUnit {
  return state.operations.find(row => row.id === task.operationId)?.unit ?? 'piece';
}

export function executorLabel(state: State, task: RouteLine): string {
  return task.executorKind === 'supplier'
    ? state.suppliers.find(row => row.id === task.supplierId)?.name ?? 'Pudratchi'
    : state.employees.find(row => row.id === task.employeeId)?.name ?? 'Xodim';
}

export function stageCostText(state: State, task: RouteLine): string {
  if (task.executorKind === 'supplier') {
    const sum = supplierStagePlan(task);
    return sum > 0 ? `summa ${formatMoney(sum)}` : 'summa kiritilmagan';
  }
  return `tannarx ${formatMoney(task.rate)} / ${unitLabel(taskUnit(state, task))}`;
}

export function workTaskRows(state: State, actor: Actor): WorkTaskRow[] {
  const rows: WorkTaskRow[] = [];
  for (const order of state.orders) {
    if (order.status !== 'production') continue;
    for (const task of order.route) {
      if (actor.role !== 'admin' && task.employeeId !== actor.id) continue;
      if (task.status === 'submitted' || task.status === 'completed') continue;
      const operation = state.operations.find(row => row.id === task.operationId);
      const defectQty = round(state.defects
        .filter(row => row.orderId === order.id && row.taskId === task.id && row.employeeId === task.employeeId)
        .reduce((sum, row) => sum + row.qty, 0));
      rows.push({
        orderId: order.id, taskId: task.id, number: order.number, title: order.title,
        operationName: task.name, planned: task.planned, completed: task.completed, defectQty,
        unit: taskUnit(state, task), status: task.status,
        dueDate: order.dueDate, available: availableTask(state, order.id, task.id),
        blockReason: taskBlockReason(state, order.id, task.id),
        autoAccept: operation?.autoAccept ?? false,
      });
    }
  }
  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
}

export function workHistoryRows(state: State, actor: Actor): WorkHistoryRow[] {
  const rows: WorkHistoryRow[] = [];
  for (const report of state.reports) {
    if (actor.role !== 'admin' && report.employeeId !== actor.id) continue;
    const order = state.orders.find(row => row.id === report.orderId);
    const task = order?.route.find(row => row.id === report.taskId);
    if (!order || !task) continue;
    rows.push({
      orderId: order.id, taskId: task.id, number: order.number, title: order.title,
      operationName: task.name, qty: report.qty, unit: taskUnit(state, task),
      status: report.status, taskStatus: task.status, createdAt: report.createdAt,
    });
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function acceptedWorkQty(state: State, employeeId: string, from: string, to: string): number {
  return round(state.reports
    .filter(row => row.employeeId === employeeId && row.status === 'accepted' && withinPeriod(row.createdAt, from, to))
    .reduce((sum, row) => sum + row.qty, 0));
}
