import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ALLOWED_TABLES, ok, fail, userClient } from "../db";

export default defineTool({
  name: "list_rows",
  title: "List rows",
  description:
    "Read rows from a GTeam Infinite table (players, teams, runs, dominations, challenges, gem tasks, duos, collections, badges, locker codes, evo paths, media accounts). Supports a text search and column selection.",
  inputSchema: {
    table: z.enum(ALLOWED_TABLES).describe("Table to read."),
    search: z.string().optional().describe("Case-insensitive match against the name/title column."),
    columns: z.string().optional().describe("Comma-separated columns. Defaults to all."),
    limit: z.number().int().min(1).max(500).optional().describe("Max rows (default 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ table, search, columns, limit }, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;

    let query = client.from(table).select(columns || "*").limit(limit ?? 100);
    if (search) {
      const nameCol = table === "gem_tasks" ? "title" : table === "domination_games" ? "opponent_name" : "name";
      query = query.ilike(nameCol, `%${search}%`);
    }
    const { data, error: dbError } = await query;
    if (dbError) return fail(dbError.message);
    return ok({ table, count: data?.length ?? 0, rows: data ?? [] });
  },
});
