-- Aliya ERP: tenant-scoped cloud copy.
--
-- erp_backup_dump(p_company_id, p_state)     -> one CompanyCopy document (all rows of ONE company).
-- erp_backup_restore(p_payload, p_expected)  -> replace that company's rows with the document, guarded by revision.
--
-- The table list is read from the catalog at call time: every public.erp_* table that owns a
-- company_id column is covered, so new modules and new tables are copied without touching this file.
-- erp_companies itself is never part of a copy; restoring must not be able to rename or delete a company.
-- Both functions are service_role only: the Edge Function proves the caller is that company's admin
-- before it is allowed to call them. Direct row access stays blocked by RLS.

CREATE OR REPLACE FUNCTION public.erp_backup_tables()
RETURNS TABLE (table_name text, insert_rank integer)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH RECURSIVE tenant AS (
      SELECT c.relname::text AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname LIKE 'erp\_%'
        AND c.relname <> 'erp_companies'
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attname = 'company_id'
        )
    ),
    edges AS (
      SELECT DISTINCT cl.relname::text AS child, pr.relname::text AS parent
      FROM pg_constraint k
      JOIN pg_class cl ON cl.oid = k.conrelid
      JOIN pg_class pr ON pr.oid = k.confrelid
      JOIN pg_namespace n ON n.oid = k.connamespace
      WHERE k.contype = 'f' AND n.nspname = 'public' AND cl.oid <> pr.oid
    ),
    depth AS (
      SELECT name, 0 AS lvl FROM tenant
      UNION
      SELECT e.child, d.lvl + 1 FROM edges e
      JOIN depth d ON d.name = e.parent
      JOIN tenant t ON t.name = e.child
    )
  SELECT r.name, (row_number() OVER (ORDER BY r.lvl, r.name))::integer
  FROM (
    SELECT t.name, coalesce(max(d.lvl), 0) AS lvl
    FROM tenant t LEFT JOIN depth d ON d.name = t.name GROUP BY t.name
  ) r;
$$;

CREATE OR REPLACE FUNCTION public.erp_backup_dump(p_company_id uuid, p_state jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rec record;
  v_rows jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_total bigint := 0;
  v_revision bigint;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Company id is required' USING ERRCODE = '22023';
  END IF;
  SELECT revision INTO v_revision FROM public.erp_metadata WHERE company_id = p_company_id;
  IF v_revision IS NULL THEN
    RAISE EXCEPTION 'Company metadata not found: %', p_company_id USING ERRCODE = 'P0002';
  END IF;

  FOR v_rec IN SELECT table_name FROM public.erp_backup_tables() ORDER BY insert_rank DESC LOOP
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t), ''[]''::jsonb) FROM public.%I t WHERE t.company_id = $1',
      v_rec.table_name
    ) INTO v_rows USING p_company_id;
    v_tables := v_tables || jsonb_build_object(v_rec.table_name, v_rows);
    v_counts := v_counts || jsonb_build_object(v_rec.table_name, jsonb_array_length(v_rows));
    v_total := v_total + jsonb_array_length(v_rows);
  END LOOP;

  RETURN jsonb_build_object(
    'app', 'aliya-erp',
    'kind', 'company-copy',
    'version', 1,
    'companyId', p_company_id,
    'revision', v_revision,
    'exportedAt', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'manifest', jsonb_build_object('rows', v_counts, 'totalRows', v_total),
    'tables', v_tables,
    'state', p_state
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_backup_restore(p_payload jsonb, p_expected_revision bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_claim text;
  v_company uuid;
  v_revision bigint;
  v_actor uuid;
  v_actor_name text;
  v_rec record;
  v_rows jsonb;
  v_cols text;
  v_count integer;
  v_restored jsonb := '{}'::jsonb;
  v_total bigint := 0;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'A company copy document is required' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_payload->>'app', '') <> 'aliya-erp' OR coalesce(p_payload->>'kind', '') <> 'company-copy' THEN
    RAISE EXCEPTION 'This file is not an Aliya ERP company copy' USING ERRCODE = '22023';
  END IF;
  IF coalesce(jsonb_typeof(p_payload->'version'), '') <> 'number'
     OR (p_payload->>'version')::integer <> 1 THEN
    RAISE EXCEPTION 'Unsupported company copy version: %', coalesce(p_payload->>'version', 'none') USING ERRCODE = '22023';
  END IF;
  IF coalesce(jsonb_typeof(p_payload->'companyId'), '') <> 'string' THEN
    RAISE EXCEPTION 'Company copy is missing its company id' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'Expected revision is required' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_company := (p_payload->>'companyId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Company copy carries an invalid company id' USING ERRCODE = '22023';
  END;
  IF NOT EXISTS (SELECT 1 FROM public.erp_companies WHERE id = v_company) THEN
    RAISE EXCEPTION 'Company not found: %', v_company USING ERRCODE = 'P0002';
  END IF;

  -- One lock, then the optimistic check: a copy that is not the current state cannot overwrite it.
  SELECT revision INTO STRICT v_revision FROM public.erp_metadata WHERE company_id = v_company FOR UPDATE;
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Revision conflict: copy expects %, company is at %', p_expected_revision, v_revision
      USING ERRCODE = '40001';
  END IF;

  IF p_payload ? 'tables' AND jsonb_typeof(p_payload->'tables') <> 'object' THEN
    RAISE EXCEPTION 'Company copy tables must be an object' USING ERRCODE = '22023';
  END IF;
  FOR v_rec IN SELECT key AS name FROM jsonb_each(coalesce(p_payload->'tables', '{}'::jsonb)) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.erp_backup_tables() WHERE table_name = v_rec.name) THEN
      RAISE EXCEPTION 'Company copy holds an unknown or non-tenant table: %', v_rec.name USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_rec IN SELECT table_name FROM public.erp_backup_tables() ORDER BY insert_rank ASC LOOP
    v_rows := coalesce(p_payload->'tables'->v_rec.table_name, '[]'::jsonb);
    IF jsonb_typeof(v_rows) <> 'array' THEN
      RAISE EXCEPTION 'Company copy table % must be an array', v_rec.table_name USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rows) AS r
      WHERE coalesce(jsonb_typeof(r), '') <> 'object'
         OR (r->>'company_id')::uuid IS DISTINCT FROM v_company
    ) THEN
      RAISE EXCEPTION 'Company copy holds a row of another company in table %', v_rec.table_name USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_rec IN SELECT table_name FROM public.erp_backup_tables() ORDER BY insert_rank DESC LOOP
    EXECUTE format('DELETE FROM public.%I WHERE company_id = $1', v_rec.table_name) USING v_company;
  END LOOP;

  FOR v_rec IN SELECT table_name FROM public.erp_backup_tables() ORDER BY insert_rank ASC LOOP
    v_rows := coalesce(p_payload->'tables'->v_rec.table_name, '[]'::jsonb);
    IF jsonb_array_length(v_rows) = 0 THEN
      CONTINUE;
    END IF;
    SELECT string_agg(format('%I %s', a.attname, format_type(a.atttypid, a.atttypmod)), ', ' ORDER BY a.attnum)
      INTO v_cols
      FROM pg_attribute a
      WHERE a.attrelid = format('public.%I', v_rec.table_name)::regclass
        AND a.attnum > 0 AND NOT a.attisdropped;
    EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_to_recordset($1) AS x(%s)', v_rec.table_name, v_cols)
      USING v_rows;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_restored := v_restored || jsonb_build_object(v_rec.table_name, v_count);
    v_total := v_total + v_count;
  END LOOP;

  UPDATE public.erp_metadata SET revision = revision + 1 WHERE company_id = v_company RETURNING revision INTO v_revision;

  v_claim := nullif(current_setting('request.jwt.claim.sub', true), '');
  IF v_claim ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_actor := v_claim::uuid;
    SELECT name INTO v_actor_name FROM public.erp_profiles WHERE id = v_actor;
  ELSE
    SELECT id, name INTO v_actor, v_actor_name
      FROM public.erp_profiles WHERE company_id = v_company AND role = 'admin' ORDER BY name LIMIT 1;
  END IF;
  IF v_actor IS NULL THEN
    v_actor := gen_random_uuid();
    v_actor_name := 'system';
  END IF;

  INSERT INTO public.erp_audit (company_id, request_id, actor_user_id, actor_id, actor_name, action, entity_id, command, expected_revision, revision)
    VALUES (v_company, gen_random_uuid(), v_actor, v_actor, v_actor_name, 'company.restore', v_company::text,
      jsonb_build_object('type', 'company.restore',
        'copyRevision', p_payload->'revision',
        'exportedAt', p_payload->>'exportedAt',
        'totalRows', v_total),
      p_expected_revision, v_revision);

  RETURN jsonb_build_object('companyId', v_company, 'revision', v_revision, 'restored', v_restored, 'totalRows', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.erp_backup_dump(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_backup_restore(jsonb, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_backup_dump(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_backup_restore(jsonb, bigint) TO service_role;
