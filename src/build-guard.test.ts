import { describe, expect, it } from 'vitest';
import { assertDeployableBuild } from '../vite.config';

describe('build gate', () => {
  const cloud = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_1' };

  it('accepts a bundle that carries the cloud credentials', () => {
    expect(() => assertDeployableBuild(cloud, undefined)).not.toThrow();
  });

  it('rejects a bundle built without the database url', () => {
    const { VITE_SUPABASE_URL: _drop, ...rest } = cloud;
    expect(() => assertDeployableBuild(rest, undefined)).toThrow(/VITE_SUPABASE_URL/);
  });

  it('rejects a bundle built without the publishable key', () => {
    const { VITE_SUPABASE_ANON_KEY: _drop, ...rest } = cloud;
    expect(() => assertDeployableBuild(rest, undefined)).toThrow(/VITE_SUPABASE_ANON_KEY/);
  });

  it('accepts an env-less build only when the demo flag is set', () => {
    expect(() => assertDeployableBuild({}, '1')).not.toThrow();
    expect(() => assertDeployableBuild({}, '0')).toThrow();
  });
});
