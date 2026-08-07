/**
 * Commissioner behavioural test harness.
 *
 * Boots an embedded Postgres (PGlite) loaded with the REAL production table
 * definitions and the REAL plpgsql bodies snapshotted from the live database
 * (`scripts/dump-live-schema.sh` regenerates src/test/sql/live-*.sql).
 *
 * Every Commissioner operation under test therefore runs the same schema,
 * normalization, reference resolution, matching and constraint logic the live
 * commit path runs — no mocks, no re-implementations.
 */
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL_DIR = join(process.cwd(), "src/test/sql");
const read = (name: string) => readFileSync(join(SQL_DIR, name), "utf8");

export type Row = Record<string, any>;

export interface CommissionerDb {
  db: PGlite;
  /** Runs admin_apply_batch (preview or commit) and returns the plan/result. */
  batch(payload: unknown, commit: boolean, token?: string | null): Promise<Row>;
  /** preview + commit using the token the preview issued. */
  previewThenCommit(payload: unknown): Promise<{ preview: Row; commit: Row }>;
  rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  count(sql: string, params?: unknown[]): Promise<number>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Ids used across the matrix so assertions can reference stable records. */
export const IDS = {
  admin: "11111111-1111-1111-1111-111111111111",
  emerald: "a0000000-0000-0000-0000-000000000001",
  sapphire: "a0000000-0000-0000-0000-000000000002",
  ruby: "a0000000-0000-0000-0000-000000000003",
  amethyst: "a0000000-0000-0000-0000-000000000004",
  cardA: "b0000000-0000-0000-0000-00000000000a",
  cardB: "b0000000-0000-0000-0000-00000000000b",
  cardC: "b0000000-0000-0000-0000-00000000000c",
  badgeShooter: "c0000000-0000-0000-0000-00000000000a",
  badgeLock: "c0000000-0000-0000-0000-00000000000b",
  traitClutch: "d0000000-0000-0000-0000-00000000000a",
} as const;

const AUTH_STUBS = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT '${IDS.admin}'::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated' $$;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
INSERT INTO auth.users (id,email) VALUES ('${IDS.admin}','commissioner@test.local')
  ON CONFLICT (id) DO NOTHING;
`;

/** has_role lives in the dumped functions; override it so the harness is admin. */
const ADMIN_STUB = `
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
`;

export const SEED_SQL = `
INSERT INTO public.gem_tiers (id,name,stars,color,sort_order,rating_min,rating_max) VALUES
 ('${IDS.emerald}','Emerald',1,'#0f0',1,1,1.99),
 ('${IDS.sapphire}','Sapphire',2,'#00f',2,2,2.99),
 ('${IDS.ruby}','Ruby',3,'#f00',3,3,3.99),
 ('${IDS.amethyst}','Amethyst',4,'#a0f',4,4,4.99);
INSERT INTO public.badges (id,name,abbreviation,effect_type) VALUES
 ('${IDS.badgeShooter}','Deadeye','DE','reroll'),
 ('${IDS.badgeLock}','Clamps','CL','reroll');
INSERT INTO public.signature_traits (id,name,abbreviation) VALUES
 ('${IDS.traitClutch}','Clutch Gene','CG');
INSERT INTO public.player_cards (id,name,gem_tier_id,gem_name,rating,card_key) VALUES
 ('${IDS.cardA}','Matrix Guard A','${IDS.emerald}','Emerald',1.4,'matrix-guard-a'),
 ('${IDS.cardB}','Matrix Guard B','${IDS.sapphire}','Sapphire',2.1,'matrix-guard-b'),
 ('${IDS.cardC}','Matrix Wing C','${IDS.ruby}','Ruby',3.2,'matrix-wing-c');
INSERT INTO public.evo_objective_registry (key,label,objective_type,stat_key) VALUES
 ('points','Points','total_stat','points'),
 ('games_won','Games won','games_won',NULL),
 ('three_pointers_made','Three-pointers made','total_stat','stat_3pt'),
 ('assists','Assists','total_stat','stat_ast'),
 ('rebounds','Rebounds','total_stat','stat_reb'),
 ('steals','Steals','total_stat','stat_stl'),
 ('blocks','Blocks','total_stat','stat_blk'),
 ('dunks_made','Dunks made','total_stat','stat_dnk'),
 ('mid_range_shots_made','Mid-range shots made','total_stat','stat_mid')
ON CONFLICT (key) DO NOTHING;
`;

export async function bootCommissionerDb(): Promise<CommissionerDb> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
  await db.exec(AUTH_STUBS);
  await db.exec(read("live-schema.sql"));
  await db.exec(read("live-functions.sql"));
  await db.exec(ADMIN_STUB);
  await db.exec(SEED_SQL);
  await db.exec("CREATE TABLE IF NOT EXISTS __seed_marker(done boolean);");

  const rows = async <T = Row>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;

  const batch = async (payload: unknown, commit: boolean, token: string | null = null) => {
    const res = await db.query<{ r: Row }>(
      "SELECT public.admin_apply_batch($1::jsonb, $2, $3, 'content_release') AS r",
      [JSON.stringify(payload), commit, token],
    );
    return res.rows[0].r;
  };

  return {
    db,
    batch,
    async previewThenCommit(payload: unknown) {
      const preview = await batch(payload, false);
      const commit = await batch(payload, true, preview.preview_token);
      return { preview, commit };
    },
    rows,
    async one<T = Row>(sql: string, params: unknown[] = []) {
      return (await rows<T>(sql, params))[0];
    },
    async count(sql: string, params: unknown[] = []) {
      const r = await rows<{ c: number }>(sql, params);
      return Number(r[0]?.c ?? 0);
    },
    async reset() {
      // TRUNCATE ... CASCADE reaches referencing tables, so the whole content
      // surface is wiped and re-seeded to a known baseline before every test.
      await db.exec(`
        DO $$
        DECLARE t text;
        BEGIN
          SELECT string_agg(format('public.%I', c.relname), ', ') INTO t
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r'
             AND c.relname NOT IN ('evo_objective_registry');
          EXECUTE 'TRUNCATE ' || t || ' CASCADE';
        END $$;
      `);
      await db.exec(SEED_SQL.replace(/ON CONFLICT \(key\) DO NOTHING;/, "ON CONFLICT (key) DO NOTHING;"));
    },
    async close() {
      await db.close();
    },
  };
}

/** Plan helper: creates/updates/replacements/deletes filtered to one table. */
export function planFor(plan: Row, bucket: "creates" | "updates" | "replacements" | "deletes", table: string) {
  return ((plan[bucket] as Row[]) ?? []).filter((o) => o.table === table);
}
