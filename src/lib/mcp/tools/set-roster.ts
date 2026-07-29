import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ok, fail, adminClient } from "../db";

export default defineTool({
  name: "set_roster",
  title: "Set a roster",
  description:
    "Admin only. Replace the roster of a team, a run, or a domination game with the given player card names (in slot order). Player names must already exist — create them first with create_players.",
  inputSchema: {
    target: z.enum(["team", "run", "domination"]).describe("What kind of roster to set."),
    name: z
      .string()
      .describe("Team name, run name, or domination opponent name."),
    players: z.array(z.string()).describe("Player card names, in slot order (usually 3)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ target, name, players }, ctx) => {
    const { client, error } = await adminClient(ctx);
    if (error) return error;

    const config = {
      team: { parent: "teams", nameCol: "name", child: "team_players", fk: "team_id", slots: true },
      run: { parent: "runs", nameCol: "name", child: "run_players", fk: "run_id", slots: false },
      domination: {
        parent: "domination_games",
        nameCol: "opponent_name",
        child: "domination_game_players",
        fk: "domination_game_id",
        slots: true,
      },
    }[target];

    const { data: parent, error: parentErr } = await client
      .from(config.parent)
      .select("id")
      .ilike(config.nameCol, name)
      .maybeSingle();
    if (parentErr) return fail(parentErr.message);
    if (!parent) return fail(`No ${target} named "${name}".`);

    const { data: cards, error: cardErr } = await client
      .from("player_cards")
      .select("id, name")
      .in("name", players);
    if (cardErr) return fail(cardErr.message);

    const byName = new Map((cards ?? []).map((c: any) => [String(c.name).toLowerCase(), c.id]));
    const missing = players.filter((p) => !byName.has(p.toLowerCase()));
    if (missing.length) return fail(`Unknown player cards: ${missing.join(", ")}`);

    const { error: delErr } = await client.from(config.child).delete().eq(config.fk, parent.id);
    if (delErr) return fail(delErr.message);

    const rows = players.map((p, idx) => ({
      [config.fk]: parent.id,
      player_card_id: byName.get(p.toLowerCase()),
      ...(config.slots ? { slot: idx + 1 } : {}),
    }));
    const { error: insErr } = await client.from(config.child).insert(rows);
    if (insErr) return fail(insErr.message);

    return ok({ target, name, roster: players, size: rows.length });
  },
});
