import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listRows from "./tools/list-rows";
import createRows from "./tools/create-rows";
import updateRows from "./tools/update-rows";
import deleteRows from "./tools/delete-rows";
import createPlayers from "./tools/create-players";
import setRoster from "./tools/set-roster";
import getDiagnostics from "./tools/get-diagnostics";
import getSystemDocs from "./tools/get-system-docs";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "gteam-infinite-hub",
  title: "GTeam Infinite Hub",
  version: "0.1.0",
  instructions:
    "Tools for building and editing GTeam Infinite content. Start with get_system_docs for the data model and get_diagnostics for gaps. Use list_rows to inspect current data, create_players / create_rows to add content, update_rows to patch existing rows by name, set_roster to fill team / run / domination rosters, and delete_rows only after confirming with the user. All writes require an admin account.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    getSystemDocs,
    getDiagnostics,
    listRows,
    createPlayers,
    createRows,
    updateRows,
    setRoster,
    deleteRows,
  ],
});
