import { defineTool } from "@lovable.dev/mcp-js";
import { SYSTEM_DOCS_MARKDOWN } from "../../systemDocs";

export default defineTool({
  name: "get_system_docs",
  title: "Get system reference",
  description:
    "Returns the GTeam Infinite system reference: how players, teams, runs, dominations, packs, gems, evolutions and the social feed connect. Read this before creating or editing content.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({ content: [{ type: "text" as const, text: SYSTEM_DOCS_MARKDOWN }] }),
});
