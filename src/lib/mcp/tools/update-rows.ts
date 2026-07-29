import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ALLOWED_TABLES, ok, fail, adminClient } from "../db";

export default defineTool({
  name: "update_rows",
  title: "Update rows",
  description:
    "Admin only. Patch existing rows matched by a column value (defaults to `name`, use `title` for gem tasks). Only the fields you send are written; everything else is left untouched.",
  inputSchema: {
    table: z.enum(ALLOWED_TABLES).describe("Table to update."),
    match_column: z.string().optional().describe("Column used to find the row. Defaults to `name`."),
    updates: z
      .array(
        z.object({
          match: z.string().describe("Value of the match column, e.g. the player name."),
          patch: z.record(z.string(), z.any()).describe("Columns to write."),
        }),
      )
      .describe("One entry per row to patch."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ table, match_column, updates }, ctx) => {
    const { client, error } = await adminClient(ctx);
    if (error) return error;

    const col = match_column || (table === "gem_tasks" ? "title" : "name");
    const applied: string[] = [];
    const notFound: string[] = [];
    const failed: { match: string; error: string }[] = [];

    for (const { match, patch } of updates) {
      const { data, error: dbError } = await client.from(table).update(patch).ilike(col, match).select("id");
      if (dbError) failed.push({ match, error: dbError.message });
      else if (!data?.length) notFound.push(match);
      else applied.push(match);
    }

    return ok({ table, match_column: col, updated: applied.length, applied, not_found: notFound, failed });
  },
});
