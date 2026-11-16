/// <reference types="vite/client" />
declare module '*.sql?raw' { const text: string; export default text }
declare const __BUILD_ID__: string;
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
