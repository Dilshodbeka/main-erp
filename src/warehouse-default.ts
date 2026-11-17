import type { Warehouse } from './types';

export const MAIN_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000a001';

export function mainWarehouse(): Warehouse {
  return { id: MAIN_WAREHOUSE_ID, name: 'Asosiy ombor', active: true };
}
