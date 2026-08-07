/**
 * Client-side content-release engine.
 *
 * There is exactly ONE implementation: the module the edge function uses. The
 * admin UI re-exports it so browser previews, GPT previews and the committed
 * payload are produced by identical code — a previous duplicate here silently
 * dropped Runs data from evo card versions.
 */
export * from "../../supabase/functions/actions/contentRelease";
