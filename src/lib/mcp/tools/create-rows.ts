import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { WRITE_TABLES, ok, fail, adminClient } from "../db";

export default defineTool({
  name: "create_rows",
  title: "Create rows",
  description:
    "Admin only. Insert new rows into a GTeam Infinite table. Each row is an object of column/value pairs; call list_rows first to learn the shape. Returns the inserted rows.",
  inputSchema: {
    table: z.enum(WRITE_TABLES).describe("Table to insert into."),
    rows: z.array(z.record(z.string(), z.any())).describe("Rows to insert as column/value objects."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ table, rows }, ctx) => {
    const { client, error } = await adminClient(ctx);
    if (error) return error;
    if (!rows.length) return fail("No rows supplied.");

    const { data, error: dbError } = await client.from(table).insert(rows).select();
    if (dbError) return fail(dbError.message);
    return ok({ table, inserted: data?.length ?? 0, rows: data ?? [] });
  },
});
