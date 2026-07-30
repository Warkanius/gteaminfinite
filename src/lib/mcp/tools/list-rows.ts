import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { READ_TABLES, SEARCH_COLUMN, ok, fail, userClient, type ReadTable } from "../db";

export default defineTool({
  name: "list_rows",
  title: "List rows",
  description:
    "Read rows from any GTeam Infinite content table: players, teams and rosters, runs / run rosters / rank rewards, domination games and rosters, challenges, packs with their pools and odds, locker codes, gem tiers and gem market, gem tasks, dynamic duos, collections and sub-collections, badges and signature traits plus their card assignments, evo paths, storylines and storyline entities, social creators and posts, media (location) accounts and post templates, and rule_config. Per-user and economy tables are not exposed.",
  inputSchema: {
    table: z.enum(READ_TABLES).describe("Table to read."),
    search: z.string().optional().describe("Case-insensitive match against the table's name/title/code column."),
    columns: z.string().optional().describe("Comma-separated columns. Defaults to all."),
    limit: z.number().int().min(1).max(500).optional().describe("Max rows (default 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ table, search, columns, limit }, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;

    let query = client.from(table).select(columns || "*").limit(limit ?? 100);
    if (search) {
      const col = SEARCH_COLUMN[table as ReadTable];
      if (!col) return fail(`Table "${table}" has no searchable text column. Omit \`search\`.`);
      query = query.ilike(col, `%${search}%`);
    }
    const { data, error: dbError } = await query;
    if (dbError) return fail(dbError.message);
    return ok({ table, count: data?.length ?? 0, rows: data ?? [] });
  },
});
