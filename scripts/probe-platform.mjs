// Проверка миграции платформы на встроенном PostgreSQL (PGlite): npm i --no-save @electric-sql/pglite && node scripts/probe-platform.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const root = new URL('../supabase/', import.meta.url).pathname;
const db = new PGlite();
const run = async (label, sql) => { try { await db.exec(sql); console.log('ok  ', label); return true; } catch (e) { console.log('FAIL', label, '→', String(e.message).slice(0, 220)); return false; } };
await run('stubs', `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
`);
if (!await run('schema.sql', readFileSync(root + 'schema.sql', 'utf8'))) process.exit(1);
const platform = readFileSync(root + 'migrations/20261130_platform.sql', 'utf8');
const q = async (sql, params) => (await db.query(sql, params)).rows;
const as = async uid => db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';
await db.exec(`INSERT INTO auth.users(id, email) VALUES ('${U1}', 'owner@test.uz'), ('${U2}', 'client@test.uz')`);
await as(U1);
const [{ erp_bootstrap_company: c1 }] = await q(`SELECT public.erp_bootstrap_company('Aliya Mebel')`);
console.log('company 1', c1);
if (!await run('platform migration', platform)) process.exit(1);
if (!await run('platform migration (second run)', platform)) process.exit(1);
console.log('existing company:', await q(`SELECT name, plan, trial_ends_at IS NOT NULL AS has_trial FROM erp_companies`));
console.log('platform admins:', await q(`SELECT user_id FROM erp_platform_admins`));
console.log('owner subscription:', (await q(`SELECT public.erp_subscription() AS s`))[0].s);
// a new client registers
await as(U2);
const [{ erp_bootstrap_company: c2 }] = await q(`SELECT public.erp_bootstrap_company('Mijoz Mebel')`);
const s2 = (await q(`SELECT public.erp_subscription() AS s`))[0].s;
console.log('client subscription:', s2.plan, 'active', s2.active, 'platformAdmin', s2.platformAdmin, 'trial days', Math.round((new Date(s2.trialEndsAt) - Date.now()) / 864e5));
const cmd = name => `SELECT public.erp_execute(gen_random_uuid(), (SELECT revision FROM erp_metadata WHERE company_id = '${c2}'), '{"type":"customer.create","name":"${name}","phone":"","address":"","kind":"customer"}'::jsonb) IS NOT NULL AS ok`;
console.log('client write during trial:', await q(cmd('Birinchi')));
try { await q(`SELECT public.erp_platform_companies()`); console.log('FAIL client can list companies'); } catch (e) { console.log('ok   client cannot open platform panel →', e.message); }
// expire the trial
await db.exec(`UPDATE erp_companies SET trial_ends_at = now() - interval '1 day' WHERE id = '${c2}'`);
try { await q(cmd('Ikkinchi')); console.log('FAIL write allowed after expiry'); } catch (e) { console.log('ok   write blocked after expiry →', e.message); }
console.log('client can still read:', (await q(`SELECT jsonb_array_length(public.erp_snapshot() -> 'state' -> 'customers') AS customers`))[0]);
console.log('revision unchanged:', await q(`SELECT revision FROM erp_metadata WHERE company_id = '${c2}'`));
// the seller extends it
await as(U1);
const list = (await q(`SELECT public.erp_platform_companies() AS l`))[0].l;
console.log('seller sees:', list.map(r => `${r.name}:${r.plan}:${r.active}:${r.ownerEmail}:orders=${r.orders}`));
await q(`SELECT public.erp_platform_company_set($1, 'paid', now() + interval '30 days', false, '["shops","series"]'::jsonb, 'test')`, [c2]);
await as(U2);
console.log('client write after extension:', await q(cmd('Ikkinchi')));
const s3 = (await q(`SELECT public.erp_subscription() AS s`))[0].s;
console.log('client now:', s3.plan, s3.active, s3.disabledModules);
await as(U1);
await q(`SELECT public.erp_platform_company_set($1, 'paid', now() + interval '30 days', true, '[]'::jsonb, '')`, [c2]);
await as(U2);
try { await q(cmd('Uchinchi')); console.log('FAIL write allowed when blocked'); } catch (e) { console.log('ok   blocked company cannot write →', e.message); }
await as(U1);
console.log('owner company still writes:', await q(`SELECT public.erp_execute(gen_random_uuid(), (SELECT revision FROM erp_metadata WHERE company_id = '${c1}'), '{"type":"customer.create","name":"Farrux","phone":"","address":"","kind":"customer"}'::jsonb) IS NOT NULL AS ok`));
