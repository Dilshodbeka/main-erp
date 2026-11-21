import { MAIN_WORKSHOP_ID } from './workshop-default';
import type { Order, RouteLine, Workshop } from './types';

export const SEX_WORKSHOP_STORAGE_KEY = 'aliya.sex.workshop';

export interface WorkshopTab { id: string | null; name: string; count: number }

export function activeWorkshops(workshops: Workshop[]): Workshop[] {
  return workshops.filter(workshop => workshop.active);
}

export function stageWorkshopId(task: RouteLine): string {
  return task.workshopId ?? MAIN_WORKSHOP_ID;
}

export function workshopName(workshops: Workshop[], id: string | undefined): string {
  return workshops.find(workshop => workshop.id === (id ?? MAIN_WORKSHOP_ID))?.name ?? 'Seh';
}

export function unfinishedWorkshops(order: Order): string[] {
  const ids = new Set<string>();
  for (const task of order.route) if (task.completed < task.planned) ids.add(stageWorkshopId(task));
  return [...ids];
}

export function visibleInWorkshop(order: Order, workshopId: string | null): boolean {
  return workshopId === null || unfinishedWorkshops(order).includes(workshopId);
}

export function routeForWorkshop(order: Order, workshopId: string | null): RouteLine[] {
  return workshopId === null ? order.route : order.route.filter(task => stageWorkshopId(task) === workshopId);
}

export function ordersForWorkshop(orders: Order[], workshopId: string | null): Order[] {
  return orders.filter(order => visibleInWorkshop(order, workshopId));
}

export function workshopTabs(workshops: Workshop[], orders: Order[]): WorkshopTab[] {
  const active = activeWorkshops(workshops);
  if (active.length < 2) return [];
  return [
    { id: null, name: 'Barchasi', count: orders.length },
    ...active.map(workshop => ({
      id: workshop.id, name: workshop.name,
      count: orders.filter(order => visibleInWorkshop(order, workshop.id)).length,
    })),
  ];
}

export function resolveWorkshopTab(workshops: Workshop[], stored: string | null): string | null {
  if (!stored) return null;
  return activeWorkshops(workshops).some(workshop => workshop.id === stored) ? stored : null;
}
