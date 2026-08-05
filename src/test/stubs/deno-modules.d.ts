// Type shim for the Deno-only specifier the edge-function router imports, so
// vitest-side imports of that router typecheck under the app TS program.
declare module "npm:@supabase/supabase-js@2/cors" {
  export const corsHeaders: Record<string, string>;
}
