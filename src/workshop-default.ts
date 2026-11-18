import type { Workshop } from './types';

export const MAIN_WORKSHOP_ID = '00000000-0000-4000-8000-00000000b001';

export function mainWorkshop(): Workshop {
  return { id: MAIN_WORKSHOP_ID, name: 'Asosiy ishlab chiqarish', active: true };
}
