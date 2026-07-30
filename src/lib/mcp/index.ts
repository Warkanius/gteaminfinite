import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getSystemDocs from "./tools/get-system-docs";
import getDiagnostics from "./tools/get-diagnostics";
import getReferences from "./tools/get-references";
import listRows from "./tools/list-rows";
import createPlayers from "./tools/create-players";
import upsertTeam from "./tools/upsert-team";
import upsertRun from "./tools/upsert-run";
import upsertDominationGame from "./tools/upsert-domination-game";
import upsertPack from "./tools/upsert-pack";
import upsertLockerCode from "./tools/upsert-locker-code";
import upsertChallenge from "./tools/upsert-challenge";
import upsertDynamicDuo from "./tools/upsert-dynamic-duo";
import importStorylineBundle from "./tools/import-storyline-bundle";
import createRows from "./tools/create-rows";
import updateRows from "./tools/update-rows";
import deleteRows from "./tools/delete-rows";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "gteam-infinite-hub",
  title: "GTeam Infinite Hub",
  version: "0.2.0",
  instructions:
    "Tools for building and editing GTeam Infinite content. Start with get_system_docs for the data model, get_diagnostics for gaps, and get_references for the exact names every write tool accepts. Use list_rows to inspect any content table. Use the purpose-built upsert tools (upsert_team, upsert_run, upsert_domination_game, upsert_pack, upsert_locker_code, upsert_challenge, upsert_dynamic_duo) and import_storyline_bundle for composite content: they resolve names to ids, validate everything, and write atomically. Every upsert tool takes mode='preview' (validate and show the plan, no writes) or mode='commit' — always preview first and repeat any destructive replacement back to the user before committing. create_players, create_rows, update_rows and delete_rows remain for low-level edits to players, gem tiers, collections, badges, traits, evo paths, social/media content and rule_config only. All writes require an admin account; per-user and economy data is never exposed.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    getSystemDocs,
    getDiagnostics,
    getReferences,
    listRows,
    createPlayers,
    upsertTeam,
    upsertRun,
    upsertDominationGame,
    upsertPack,
    upsertLockerCode,
    upsertChallenge,
    upsertDynamicDuo,
    importStorylineBundle,
    createRows,
    updateRows,
    deleteRows,
  ],
});
