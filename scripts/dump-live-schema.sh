#!/usr/bin/env bash
# Regenerates src/test/sql/live-schema.sql + live-functions.sql from the live database.
# Used by the Commissioner mutation-matrix integration tests so they run the REAL
# table definitions and the REAL plpgsql bodies inside embedded Postgres (PGlite).
set -euo pipefail
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/src/test/sql"

psql -tAX <<'SQL' > "$OUT_DIR/live-schema.sql"
WITH enums AS (
  SELECT format('CREATE TYPE public.%I AS ENUM (%s);', t.typname,
           string_agg(quote_literal(e.enumlabel), ',' ORDER BY e.enumsortorder)) AS ddl
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname='public'
   GROUP BY t.typname
), tables AS (
  SELECT c.relname,
         format('CREATE TABLE public.%I (%s);', c.relname,
           string_agg(format('%I %s%s%s', a.attname,
             format_type(a.atttypid, a.atttypmod),
             CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
             CASE WHEN d.adbin IS NOT NULL THEN ' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid) ELSE '' END),
             ', ' ORDER BY a.attnum)) AS ddl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
   WHERE c.relkind='r'
   GROUP BY c.relname
), cons AS (
  SELECT format('ALTER TABLE public.%I ADD CONSTRAINT %I %s;', c.relname, o.conname, pg_get_constraintdef(o.oid)) AS ddl,
         CASE o.contype WHEN 'p' THEN 1 WHEN 'u' THEN 2 WHEN 'c' THEN 3 ELSE 4 END AS ord
    FROM pg_constraint o
    JOIN pg_class c ON c.oid=o.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
   WHERE o.contype IN ('p','u','c','f')
)
SELECT ddl FROM enums
UNION ALL SELECT ddl FROM tables
UNION ALL SELECT ddl FROM (SELECT ddl, ord FROM cons ORDER BY ord) c2;
SQL

psql -tAX <<'SQL' > "$OUT_DIR/live-functions.sql"
SELECT pg_get_functiondef(p.oid) || E';\n'
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public'
   AND p.prokind='f'
   AND (p.proname LIKE 'admin\_%' OR p.proname LIKE 'content\_release%'
        OR p.proname IN ('has_role','update_updated_at_column','evo_seed_objectives_from_legacy',
                         'evo_sync_legacy_from_objectives','player_cards_autofill_card_key','sync_gem_tier_collection'))
 -- SQL-language function bodies are validated at creation time, so a function
 -- must be emitted after everything it calls. plpgsql bodies are not validated,
 -- so they come first; SQL bodies follow, ordered by how many other admin
 -- functions they call (leaves before callers).
 ORDER BY (l.lanname = 'sql')::int,
          CASE WHEN l.lanname = 'sql' THEN (
            SELECT count(*) FROM pg_proc d JOIN pg_namespace dn ON dn.oid=d.pronamespace
             WHERE dn.nspname='public' AND d.oid <> p.oid
               AND pg_get_functiondef(p.oid) LIKE '%public.' || d.proname || '(%'
          ) ELSE 0 END,
          p.proname;
SQL
wc -l "$OUT_DIR/live-schema.sql" "$OUT_DIR/live-functions.sql"
