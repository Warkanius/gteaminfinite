import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ALLOWED_TABLES, ok, fail, adminClient } from "../db";

export default defineTool({
  name: "delete_rows",
  title: "Delete rows",
  description:
    "Admin only. Permanently delete rows matched by id. Destructive — confirm with the user before calling.",
  inputSchema: {
    table: z.enum(ALLOWED_TABLES).describe("Table to delete from."),
    ids: z.array(z.string()).describe("Row ids (uuid) to delete."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ table, ids }, ctx) => {
    const { client, error } = await adminClient(ctx);
    if (error) return error;
    if (!ids.length) return fail("No ids supplied.");

    const { data, error: dbError } = await client.from(table).delete().in("id", ids).select("id");
    if (dbError) return fail(dbError.message);
    return ok({ table, deleted: data?.length ?? 0, ids: (data ?? []).map((r: { id: string }) => r.id) });
  },
});
