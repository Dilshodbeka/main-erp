import type { Recipe, RecipeVersion, SeriesInput, State } from './types';

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export interface SeriesDraft {
  recipe: Recipe; version: RecipeVersion; qty: number;
  substitutions?: Record<string, string>; route: SeriesInput['route']; dueDate?: string;
}

export function buildSeriesInput(draft: SeriesDraft): SeriesInput {
  const { recipe, version } = draft;
  if (!recipe.versions.some(row => row.id === version.id)) throw new Error('Retsept versiyasi retseptga tegishli emas');
  if (!Number.isFinite(draft.qty) || draft.qty <= 0) throw new Error('Seriya miqdori noldan katta bo‘lishi kerak');
  const substitutions = draft.substitutions ?? {};
  for (const [slot, itemId] of Object.entries(substitutions)) {
    const component = version.components.find(row => row.slot === slot);
    if (!component) throw new Error(`Noma’lum almashtirish uyasi: ${slot}`);
    if (!itemId) continue;
    if (itemId !== component.itemId && !component.allowedItemIds.includes(itemId)) {
      throw new Error(`«${slot}» uyasi uchun almashtirishga ruxsat yo‘q`);
    }
  }
  for (const component of version.components) {
    if (!(substitutions[component.slot] ?? component.itemId)) throw new Error(`«${component.slot}» uyasi uchun material tanlang`);
  }
  return {
    outputItemId: recipe.outputItemId, recipeVersionId: version.id, qty: draft.qty,
    dueDate: draft.dueDate ?? today(), substitutions: { ...substitutions },
    route: draft.route.map(row => ({ ...row })),
  };
}

export function validateRecipeGraph(state: State): void {
  const edges = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    const targets = edges.get(from) ?? new Set<string>();
    targets.add(to);
    edges.set(from, targets);
  };
  for (const recipe of state.recipes) {
    for (const version of recipe.versions) {
      for (const component of version.components) {
        if (component.itemId !== null) link(recipe.outputItemId, component.itemId);
        for (const allowed of component.allowedItemIds) link(recipe.outputItemId, allowed);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string) => {
    if (visiting.has(node)) throw new Error('Retsept sikl hosil qilmoqda');
    if (visited.has(node)) return;
    visiting.add(node);
    for (const next of edges.get(node) ?? []) visit(next);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of edges.keys()) visit(node);
}
