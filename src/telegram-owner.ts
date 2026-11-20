// Owner branch of the Telegram bot: turns one incoming text into one reply.
// Pure (no Deno, Supabase or DOM): the Edge Function loads the bundled copy
// (supabase/functions/_shared/owner-bot.generated.js, built by `npm run build:bot`).
import { migrateState } from './migrations';
import { OWNER_COMMANDS, ownerMenuText, ownerReport, parseOwnerCommand, type ReportKey } from './telegram-reports';

export interface OwnerReply {
  text: string;
  /** Telegram reply keyboard rows; taps arrive as plain text equal to the label. */
  keyboard: string[][];
}

/** Two buttons per row; a tap sends the label back as a normal message. */
export function ownerKeyboard(): string[][] {
  const rows: string[][] = [];
  for (let index = 0; index < OWNER_COMMANDS.length; index += 2) {
    rows.push(OWNER_COMMANDS.slice(index, index + 2).map(row => row.label));
  }
  return rows;
}

/** A slash command, a bare key, or a tapped keyboard label. */
export function resolveOwnerInput(input: string): ReportKey | 'menu' | null {
  const text = input.trim();
  const byLabel = OWNER_COMMANDS.find(row => row.label === text);
  if (byLabel) return byLabel.key;
  return parseOwnerCommand(text);
}

/** True when the reply needs ERP data; lets the caller skip the snapshot for the menu. */
export function ownerNeedsState(input: string): boolean {
  const target = resolveOwnerInput(input);
  return target !== null && target !== 'menu';
}

/** rawState is the `state` object returned by the erp_snapshot RPC for an admin profile. */
export function ownerReply(input: string, rawState: unknown): OwnerReply {
  const keyboard = ownerKeyboard();
  const target = resolveOwnerInput(input);
  if (target === 'menu') return { text: ownerMenuText(), keyboard };
  if (target === null) {
    return { text: `Bu buyruq tanilmadi.\n\n${ownerMenuText()}`, keyboard };
  }
  return { text: ownerReport(migrateState(rawState), target), keyboard };
}

/** "7135485514, 123" → ['7135485514', '123']; anything non-numeric is dropped. */
export function parseOwnerIds(value: string | undefined): string[] {
  return (value ?? '').split(/[\s,;]+/).map(part => part.trim()).filter(part => /^-?\d{3,20}$/.test(part));
}
