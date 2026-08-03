import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getSystemDocs from "./tools/get-system-docs";
import getDiagnostics from "./tools/get-diagnostics";
import getReferences from "./tools/get-references";
import listRows from "./tools/list-rows";
import createPlayers from "./tools/create-players";
import upsertPlayer from "./tools/upsert-player";
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
import { batchTools } from "./tools/batch-tools";
import { dominationDeleteTools } from "./tools/domination-delete";
import { dominationRoadTools } from "./tools/domination-roads";
import { planningReadTools } from "./tools/planning-reads";
import { releaseBundleTools } from "./tools/release-bundles";



const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "gteam-infinite-hub",
  title: "GTeam Infinite Hub",
  version: "0.3.0",
  instructions:
    "Tools for building and editing GTeam Infinite content. Start with get_system_docs for the data model, get_diagnostics for gaps, and getBatchReferences for the immutable ids and card_keys every write tool accepts. Prefer the batch tools for all real work: previewContentBatch/commitContentBatch (any mix of entities), previewPlayerBatch, previewTeamBatch, previewDominationRoadImport, previewEvoPath, previewEvoPathBatch and previewEvoBundle. The protocol is always two steps: call preview* (zero writes, returns creates/updates/deletes/replacements/warnings plus a one-time preview_token), show that plan to the user, then call the matching commit* with the byte-identical payload and that token. A commit whose payload differs is rejected with PREVIEW_PAYLOAD_MISMATCH, a reused token with PREVIEW_ALREADY_COMMITTED, an expired one with PREVIEW_TOKEN_EXPIRED, and a scope somebody else edited since the preview with CONCURRENT_MODIFICATION — in every case nothing is written; every batch is one transaction. Domination road imports also accept expected_game_count with mode='replace' as a hard safety check and return a post-commit verification block (game count, contiguous orders, duplicate orders, roster sizes, total coin reward, proof no other road changed); the commit is rolled back if verification fails. Every committed operation is recorded: use getContentOperations for the history and getRoadRestorePayload to turn any entry into a ready-made rollback payload for previewDominationRoadImport. Target entities by immutable id whenever possible: duplicate player display names are legal, so a name that matches more than one card is REJECTED with all matches listed — use getPlayerVersions or card_key to disambiguate. Domination roads are real records: use listDominationRoads for road_ids and game counts and exportDominationRoad to get a whole road in the exact shape the import tools accept. Bulk road work goes through previewDominationRoadImport / commitDominationRoadImport, which create or rename a road, set its description / sort_order / is_active and create, update, reorder or delete its games and rosters in one transaction — mode='merge' touches only the game_orders you send, mode='replace' makes the road match the payload exactly (omitted game_orders on that road are deleted, matched games keep their ids). previewDeleteDominationRoad / commitDeleteDominationRoad remove an entire road with its games and rosters; previewDeleteDominationGame / commitDeleteDominationGame remove a single game. Domination games are ALWAYS targeted by domination_game_id or road (road_id / road_name) + game_order, never by opponent name: rematches are legal and expected (the same opponent may appear at several game_orders on one road, e.g. an 11-game road where Lockport is games 1 and 6) and each is a separate game with its own roster and rewards. Prefer pack_reward_id over pack names, which are often duplicated. Within one batch, declare temp_ref: 'ref:player:my-card' on a new item and reference it later (destination_player_ref, roster entries) to create a card and everything pointing at it in one shot. Use getEvoChain, getTeamRoster and getDominationRoad to read current structures in the exact shape the batch tools accept. The older single-entity upsert_* tools and list_rows/create_rows/update_rows/delete_rows remain for small one-off edits. All writes require an admin account; per-user and economy data is never exposed.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    getSystemDocs,
    getDiagnostics,
    getReferences,
    listRows,
    ...planningReadTools,
    ...releaseBundleTools,
    ...batchTools,
    ...dominationRoadTools,
    ...dominationDeleteTools,


    createPlayers,
    upsertPlayer,
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
