import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

describe('support tickets SQL contract', () => {
  it('ships one tenant-scoped collection with a read policy', () => {
    expect(schema).toContain('CREATE TABLE public.erp_support_tickets');
    expect(schema).toContain("CHECK (author_role IN ('admin', 'worker'))");
    expect(schema).toContain("CHECK (status IN ('open', 'closed'))");
    expect(schema).toContain("'erp_shipment_lines', 'erp_support_tickets', 'erp_audit'");
  });

  it('snapshots tickets for the author and the owner only', () => {
    expect(schema).toContain("'tickets', (SELECT");
    expect(schema).toContain('FROM public.erp_support_tickets t WHERE t.company_id = v_company AND (v_admin OR t.author_id = v_profile.employee_id)');
    expect(schema).toContain('ORDER BY t.updated_at, t.id');
  });

  it('lets workers create and reply but not close', () => {
    expect(schema).toContain("IF v_type IN ('work.accept', 'work.start', 'work.submit', 'assembly.complete', 'ticket.create', 'ticket.reply') THEN");
    expect(schema).toContain("WHEN 'ticket.close' THEN");
    expect(schema).toContain("IF v_actor.role <> 'admin' THEN RAISE EXCEPTION 'Administrator action required'");
  });

  it('raises byte-identical domain errors', () => {
    expect(schema).toContain("RAISE EXCEPTION 'Ticket text is required'");
    expect(schema).toContain("RAISE EXCEPTION 'Ticket text is too long'");
    expect(schema).toContain("RAISE EXCEPTION 'Ticket not found'");
    expect(schema).toContain("RAISE EXCEPTION 'Ticket is full'");
    expect(schema).toContain("RAISE EXCEPTION 'Invalid ticket context'");
  });

  it('validates context through an immutable helper', () => {
    expect(schema).toContain('CREATE FUNCTION public.erp_ticket_context(p_value jsonb)');
    expect(schema).toContain("jsonb_typeof(p_value -> 'revision') IS DISTINCT FROM 'number'");
    expect(schema).toContain('public.erp_ticket_context(jsonb)');
  });
});
