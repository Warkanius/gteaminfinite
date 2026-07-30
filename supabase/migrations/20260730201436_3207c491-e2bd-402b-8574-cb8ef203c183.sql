-- Resolve an ordered list of player card names to ids, failing loudly on gaps.
CREATE OR REPLACE FUNCTION public.admin_resolve_player_ids(p_names jsonb)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ids uuid[] := '{}';
  v_name text;
  v_id uuid;
  v_count int;
BEGIN
  IF p_names IS NULL OR jsonb_typeof(p_names) <> 'array' THEN
    RETURN v_ids;
  END IF;
  FOR v_name IN SELECT jsonb_array_elements_text(p_names) LOOP
    SELECT count(*), min(id) INTO v_count, v_id
    FROM player_cards WHERE lower(name) = lower(btrim(v_name));
    IF v_count = 0 THEN
      RAISE EXCEPTION 'Unknown player card: "%"', v_name;
    END IF;
    IF v_count > 1 THEN
      RAISE EXCEPTION 'Ambiguous player card name "%" matches % cards', v_name, v_count;
    END IF;
    v_ids := v_ids || v_id;
  END LOOP;
  RETURN v_ids;
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_resolve_player_ids(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_player_ids(jsonb) TO authenticated, service_role;

-- Atomic admin content engine: preview (p_commit = false) or apply (p_commit = true).
CREATE OR REPLACE FUNCTION public.admin_apply_content(p_kind text, p_payload jsonb, p_commit boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ops jsonb := '[]'::jsonb;
  v_destr jsonb := '[]'::jsonb;
  v_id uuid;
  v_other uuid;
  v_name text;
  v_road text;
  v_code text;
  v_ids uuid[];
  v_ids_b uuid[];
  v_n int;
  v_m int;
  v_total numeric;
  v_slot text;
  v_slots int[];
  v_reward jsonb;
  v_pack_reward text;
  v_type text;
  v_stat_keys text[] := ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int'];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload must be an object';
  END IF;

  ------------------------------------------------------------------ TEAM
  IF p_kind = 'team' THEN
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'name is required'; END IF;
    SELECT id INTO v_id FROM teams WHERE lower(name) = lower(v_name);

    v_ops := v_ops || jsonb_build_object(
      'table','teams',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_name,
      'fields', jsonb_strip_nulls(jsonb_build_object(
        'category', p_payload->>'category',
        'unlock_cost', p_payload->'unlock_cost')));

    IF p_payload ? 'roster' THEN
      v_ids := public.admin_resolve_player_ids(p_payload->'roster');
      SELECT count(*) INTO v_n FROM team_players WHERE team_id = v_id;
      v_destr := v_destr || jsonb_build_object(
        'table','team_players','action','replace',
        'replaces_rows', coalesce(v_n,0),
        'new_rows', coalesce(array_length(v_ids,1),0));
    END IF;

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO teams(name, category, unlock_cost)
        VALUES (v_name, coalesce(p_payload->>'category','domination'), coalesce((p_payload->>'unlock_cost')::int,0))
        RETURNING id INTO v_id;
      ELSE
        UPDATE teams SET
          category = coalesce(p_payload->>'category', category),
          unlock_cost = coalesce((p_payload->>'unlock_cost')::int, unlock_cost)
        WHERE id = v_id;
      END IF;
      IF p_payload ? 'roster' THEN
        DELETE FROM team_players WHERE team_id = v_id;
        INSERT INTO team_players(team_id, player_card_id, slot)
        SELECT v_id, v_ids[i], i FROM generate_subscripts(v_ids,1) AS i;
      END IF;
    END IF;

  ------------------------------------------------------------------ RUN
  ELSIF p_kind = 'run' THEN
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'name is required'; END IF;
    SELECT id INTO v_id FROM runs WHERE lower(name) = lower(v_name);

    v_other := NULL;
    IF p_payload ? 'team' AND p_payload->>'team' IS NOT NULL THEN
      SELECT id INTO v_other FROM teams WHERE lower(name) = lower(btrim(p_payload->>'team'));
      IF v_other IS NULL THEN RAISE EXCEPTION 'Unknown team: "%"', p_payload->>'team'; END IF;
    END IF;

    IF p_payload ? 'milestones' AND jsonb_typeof(p_payload->'milestones') <> 'array' THEN
      RAISE EXCEPTION 'milestones must be an array';
    END IF;

    v_ops := v_ops || jsonb_build_object(
      'table','runs',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_name,
      'fields', jsonb_strip_nulls(jsonb_build_object(
        'target_score', p_payload->'target_score',
        'team_id', v_other,
        'milestones', p_payload->'milestones')));

    IF p_payload ? 'roster' THEN
      v_ids := public.admin_resolve_player_ids(p_payload->'roster');
      SELECT count(*) INTO v_n FROM run_players WHERE run_id = v_id;
      v_destr := v_destr || jsonb_build_object(
        'table','run_players','action','replace',
        'replaces_rows', coalesce(v_n,0),
        'new_rows', coalesce(array_length(v_ids,1),0));
    END IF;

    IF p_payload ? 'rank_rewards' THEN
      IF jsonb_typeof(p_payload->'rank_rewards') <> 'array' THEN
        RAISE EXCEPTION 'rank_rewards must be an array';
      END IF;
      SELECT count(*) INTO v_n FROM run_rank_rewards;
      v_destr := v_destr || jsonb_build_object(
        'table','run_rank_rewards','action','replace_global',
        'note','run_rank_rewards is a single global ladder shared by every Run',
        'replaces_rows', coalesce(v_n,0),
        'new_rows', jsonb_array_length(p_payload->'rank_rewards'));
    END IF;

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO runs(name, target_score, team_id, milestones)
        VALUES (v_name,
                coalesce((p_payload->>'target_score')::int, 21),
                v_other,
                coalesce(p_payload->'milestones','[]'::jsonb))
        RETURNING id INTO v_id;
      ELSE
        UPDATE runs SET
          target_score = coalesce((p_payload->>'target_score')::int, target_score),
          team_id = coalesce(v_other, team_id),
          milestones = coalesce(p_payload->'milestones', milestones)
        WHERE id = v_id;
      END IF;

      IF p_payload ? 'roster' THEN
        DELETE FROM run_players WHERE run_id = v_id;
        INSERT INTO run_players(run_id, player_card_id, run_rating,
          run_stat_3pt, run_stat_mid, run_stat_fin, run_stat_dnk,
          run_stat_stl, run_stat_blk, run_stat_ast, run_stat_reb, run_stat_int)
        SELECT v_id, pc.id,
          coalesce(pc.run_rating, round(pc.rating)::int),
          coalesce(pc.run_stat_3pt, pc.stat_3pt),
          coalesce(pc.run_stat_mid, pc.stat_mid),
          coalesce(pc.run_stat_fin, pc.stat_fin),
          coalesce(pc.run_stat_dnk, pc.stat_dnk),
          coalesce(pc.run_stat_stl, pc.stat_stl),
          coalesce(pc.run_stat_blk, pc.stat_blk),
          coalesce(pc.run_stat_ast, pc.stat_ast),
          coalesce(pc.run_stat_reb, pc.stat_reb),
          coalesce(pc.run_stat_int, pc.stat_int)
        FROM player_cards pc WHERE pc.id = ANY(v_ids);
      END IF;

      IF p_payload ? 'rank_rewards' THEN
        DELETE FROM run_rank_rewards;
        INSERT INTO run_rank_rewards(rank_name, wins_required, coin_reward, gem_reward, pack_reward, sort_order)
        SELECT coalesce(e->>'rank_name', 'Rank ' || ord),
               coalesce((e->>'wins_required')::int, ord::int),
               coalesce((e->>'coin_reward')::int, 0),
               coalesce((e->>'gem_reward')::int, 0),
               coalesce(e->>'pack_reward', ''),
               coalesce((e->>'sort_order')::int, ord::int)
        FROM jsonb_array_elements(p_payload->'rank_rewards') WITH ORDINALITY AS t(e, ord);
      END IF;
    END IF;

  ------------------------------------------------------- DOMINATION GAME
  ELSIF p_kind = 'domination_game' THEN
    v_name := btrim(coalesce(p_payload->>'opponent_name',''));
    v_road := btrim(coalesce(p_payload->>'road_name',''));
    IF v_name = '' OR v_road = '' THEN
      RAISE EXCEPTION 'opponent_name and road_name are required';
    END IF;
    SELECT id INTO v_id FROM domination_games
    WHERE lower(opponent_name) = lower(v_name) AND lower(road_name) = lower(v_road);

    v_ops := v_ops || jsonb_build_object(
      'table','domination_games',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_road || ' / ' || v_name,
      'fields', jsonb_strip_nulls(jsonb_build_object(
        'game_order', p_payload->'game_order',
        'difficulty_stars', p_payload->'difficulty_stars',
        'coin_reward', p_payload->'coin_reward',
        'pack_reward', p_payload->>'pack_reward')));

    IF p_payload ? 'roster' THEN
      v_ids := public.admin_resolve_player_ids(p_payload->'roster');
      SELECT count(*) INTO v_n FROM domination_game_players WHERE domination_game_id = v_id;
      v_destr := v_destr || jsonb_build_object(
        'table','domination_game_players','action','replace',
        'replaces_rows', coalesce(v_n,0),
        'new_rows', coalesce(array_length(v_ids,1),0));
    END IF;

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO domination_games(road_name, opponent_name, difficulty_stars, game_order, coin_reward, pack_reward)
        VALUES (v_road, v_name,
                coalesce((p_payload->>'difficulty_stars')::int, 1),
                coalesce((p_payload->>'game_order')::int, 1),
                coalesce((p_payload->>'coin_reward')::int, 0),
                p_payload->>'pack_reward')
        RETURNING id INTO v_id;
      ELSE
        UPDATE domination_games SET
          difficulty_stars = coalesce((p_payload->>'difficulty_stars')::int, difficulty_stars),
          game_order = coalesce((p_payload->>'game_order')::int, game_order),
          coin_reward = coalesce((p_payload->>'coin_reward')::int, coin_reward),
          pack_reward = CASE WHEN p_payload ? 'pack_reward' THEN p_payload->>'pack_reward' ELSE pack_reward END
        WHERE id = v_id;
      END IF;
      IF p_payload ? 'roster' THEN
        DELETE FROM domination_game_players WHERE domination_game_id = v_id;
        INSERT INTO domination_game_players(domination_game_id, player_card_id, slot)
        SELECT v_id, v_ids[i], i FROM generate_subscripts(v_ids,1) AS i;
      END IF;
    END IF;

  ------------------------------------------------------------------ PACK
  ELSIF p_kind = 'pack' THEN
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'name is required'; END IF;
    SELECT id INTO v_id FROM packs WHERE lower(name) = lower(v_name);
    IF v_id IS NULL AND NOT (p_payload ? 'pack_type') THEN
      v_type := 'standard';
    ELSE
      v_type := p_payload->>'pack_type';
    END IF;
    IF v_type IS NULL THEN
      SELECT pack_type INTO v_type FROM packs WHERE id = v_id;
    END IF;

    IF p_payload ? 'players' THEN
      v_ids := public.admin_resolve_player_ids(p_payload->'players');
      IF coalesce(array_length(v_ids,1),0) = 0 THEN
        RAISE EXCEPTION 'players pool cannot be empty; omit the field to keep the current pool';
      END IF;
      SELECT count(*) INTO v_n FROM pack_players WHERE pack_id = v_id;
      v_destr := v_destr || jsonb_build_object(
        'table','pack_players','action','replace',
        'replaces_rows', coalesce(v_n,0),
        'new_rows', array_length(v_ids,1));
      v_slots := ARRAY(SELECT i FROM generate_subscripts(v_ids,1) AS i);
    ELSE
      SELECT array_agg(DISTINCT slot_number) INTO v_slots FROM pack_players WHERE pack_id = v_id;
    END IF;

    IF p_payload ? 'odds' THEN
      IF jsonb_typeof(p_payload->'odds') <> 'array' OR jsonb_array_length(p_payload->'odds') = 0 THEN
        RAISE EXCEPTION 'odds must be a non-empty array';
      END IF;
      SELECT sum((e->>'percentage')::numeric) INTO v_total
      FROM jsonb_array_elements(p_payload->'odds') AS e;
      IF v_total IS NULL OR abs(v_total - 100) > 0.01 THEN
        RAISE EXCEPTION 'Pack odds must total 100 percent (got %)', coalesce(v_total, 0);
      END IF;
      SELECT count(*) INTO v_m
      FROM jsonb_array_elements(p_payload->'odds') AS e
      WHERE coalesce((e->>'percentage')::numeric, 0) <= 0;
      IF v_m > 0 THEN
        RAISE EXCEPTION 'Every odds entry needs a percentage greater than 0';
      END IF;
      FOR v_slot IN SELECT e->>'result_slot' FROM jsonb_array_elements(p_payload->'odds') AS e LOOP
        IF v_slot IS NULL OR btrim(v_slot) = '' THEN
          RAISE EXCEPTION 'Every odds entry needs a result_slot';
        END IF;
        IF v_slot <> 'player_choice' THEN
          IF v_slot !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'result_slot must be a slot number or "player_choice" (got "%")', v_slot;
          END IF;
          IF coalesce(array_length(v_slots,1),0) > 0 AND NOT (v_slot::int = ANY(v_slots)) THEN
            RAISE EXCEPTION 'Odds slot % has no cards in the pack pool (pool slots: %)', v_slot, v_slots;
          END IF;
        END IF;
      END LOOP;
      SELECT count(*) INTO v_n FROM pack_odds WHERE pack_id = v_id;
      v_destr := v_destr || jsonb_build_object(
        'table','pack_odds','action','replace',
        'replaces_rows', coalesce(v_n,0),
        'new_rows', jsonb_array_length(p_payload->'odds'));
    END IF;

    v_ops := v_ops || jsonb_build_object(
      'table','packs',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_name,
      'fields', jsonb_strip_nulls(jsonb_build_object(
        'pack_type', v_type,
        'cost', p_payload->'cost',
        'ten_box_cost', p_payload->'ten_box_cost')));

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO packs(name, pack_type, cost, ten_box_cost)
        VALUES (v_name, coalesce(v_type,'standard'),
                coalesce((p_payload->>'cost')::int, 0),
                (p_payload->>'ten_box_cost')::int)
        RETURNING id INTO v_id;
      ELSE
        UPDATE packs SET
          pack_type = coalesce(v_type, pack_type),
          cost = coalesce((p_payload->>'cost')::int, cost),
          ten_box_cost = CASE WHEN p_payload ? 'ten_box_cost' THEN (p_payload->>'ten_box_cost')::int ELSE ten_box_cost END
        WHERE id = v_id;
      END IF;
      SELECT pack_type INTO v_type FROM packs WHERE id = v_id;

      IF p_payload ? 'players' THEN
        DELETE FROM pack_players WHERE pack_id = v_id;
        INSERT INTO pack_players(pack_id, player_card_id, slot_number)
        SELECT v_id, v_ids[i], i FROM generate_subscripts(v_ids,1) AS i;
      END IF;

      IF p_payload ? 'odds' THEN
        DELETE FROM pack_odds WHERE pack_id = v_id;
        INSERT INTO pack_odds(pack_id, pack_type, dice_roll, result_slot, percentage, description)
        SELECT v_id, v_type, '0', e->>'result_slot', (e->>'percentage')::numeric,
               coalesce(e->>'description', 'Slot ' || (e->>'result_slot'))
        FROM jsonb_array_elements(p_payload->'odds') AS e;
      END IF;
    END IF;

  ------------------------------------------------------------ LOCKER CODE
  ELSIF p_kind = 'locker_code' THEN
    v_code := upper(btrim(coalesce(p_payload->>'code','')));
    IF v_code = '' THEN RAISE EXCEPTION 'code is required'; END IF;
    SELECT id INTO v_id FROM locker_codes WHERE upper(code) = v_code;

    v_type := coalesce(p_payload->>'reward_type', 'coins');
    IF v_type NOT IN ('coins','gems','pack','card') THEN
      RAISE EXCEPTION 'reward_type must be coins, gems, pack or card';
    END IF;
    v_reward := coalesce(p_payload->'reward_value', '{}'::jsonb);

    IF v_type IN ('coins','gems') THEN
      IF coalesce((v_reward->>'amount')::numeric, 0) <= 0 THEN
        RAISE EXCEPTION '% reward needs reward_value.amount greater than 0', v_type;
      END IF;
      v_reward := jsonb_build_object('amount', (v_reward->>'amount')::int);
    ELSIF v_type = 'pack' THEN
      IF v_reward ? 'pack_name' THEN
        SELECT id INTO v_other FROM packs WHERE lower(name) = lower(btrim(v_reward->>'pack_name'));
        IF v_other IS NULL THEN RAISE EXCEPTION 'Unknown pack: "%"', v_reward->>'pack_name'; END IF;
      ELSIF v_reward ? 'pack_id' THEN
        SELECT id INTO v_other FROM packs WHERE id = (v_reward->>'pack_id')::uuid;
        IF v_other IS NULL THEN RAISE EXCEPTION 'Unknown pack id: %', v_reward->>'pack_id'; END IF;
      ELSE
        RAISE EXCEPTION 'pack reward needs reward_value.pack_name';
      END IF;
      v_reward := jsonb_build_object('pack_id', v_other);
    ELSE
      IF v_reward ? 'card_name' THEN
        v_ids := public.admin_resolve_player_ids(jsonb_build_array(v_reward->>'card_name'));
        v_other := v_ids[1];
      ELSIF v_reward ? 'player_card_id' THEN
        SELECT id INTO v_other FROM player_cards WHERE id = (v_reward->>'player_card_id')::uuid;
        IF v_other IS NULL THEN RAISE EXCEPTION 'Unknown player card id: %', v_reward->>'player_card_id'; END IF;
      ELSE
        RAISE EXCEPTION 'card reward needs reward_value.card_name';
      END IF;
      v_reward := jsonb_build_object('player_card_id', v_other);
    END IF;

    v_ops := v_ops || jsonb_build_object(
      'table','locker_codes',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_code,
      'fields', jsonb_build_object(
        'reward_type', v_type,
        'reward_value', v_reward,
        'max_redemptions', p_payload->'max_redemptions',
        'expires_at', p_payload->>'expires_at'));

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO locker_codes(code, reward_type, reward_value, max_redemptions, expires_at)
        VALUES (v_code, v_type, v_reward,
                (p_payload->>'max_redemptions')::int,
                (p_payload->>'expires_at')::timestamptz)
        RETURNING id INTO v_id;
      ELSE
        UPDATE locker_codes SET
          reward_type = v_type,
          reward_value = v_reward,
          max_redemptions = CASE WHEN p_payload ? 'max_redemptions' THEN (p_payload->>'max_redemptions')::int ELSE max_redemptions END,
          expires_at = CASE WHEN p_payload ? 'expires_at' THEN (p_payload->>'expires_at')::timestamptz ELSE expires_at END
        WHERE id = v_id;
      END IF;
    END IF;

  ------------------------------------------------------------- CHALLENGE
  ELSIF p_kind = 'challenge' THEN
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'name is required'; END IF;
    SELECT id INTO v_id FROM challenges WHERE lower(name) = lower(v_name);

    v_other := NULL;
    IF p_payload ? 'opponent_team' AND p_payload->>'opponent_team' IS NOT NULL THEN
      SELECT id INTO v_other FROM teams WHERE lower(name) = lower(btrim(p_payload->>'opponent_team'));
      IF v_other IS NULL THEN RAISE EXCEPTION 'Unknown team: "%"', p_payload->>'opponent_team'; END IF;
    END IF;

    v_ids := '{}';
    IF p_payload ? 'card_reward' AND p_payload->>'card_reward' IS NOT NULL THEN
      v_ids := public.admin_resolve_player_ids(jsonb_build_array(p_payload->>'card_reward'));
    END IF;
    v_ids_b := '{}';
    IF p_payload ? 'stat_limit_player' AND p_payload->>'stat_limit_player' IS NOT NULL THEN
      v_ids_b := public.admin_resolve_player_ids(jsonb_build_array(p_payload->>'stat_limit_player'));
    END IF;

    v_pack_reward := NULL;
    IF p_payload ? 'pack_reward' AND p_payload->>'pack_reward' IS NOT NULL THEN
      SELECT id::text INTO v_pack_reward FROM packs WHERE lower(name) = lower(btrim(p_payload->>'pack_reward'));
      IF v_pack_reward IS NULL THEN v_pack_reward := p_payload->>'pack_reward'; END IF;
    END IF;

    IF p_payload ? 'prerequisite' AND p_payload->>'prerequisite' IS NOT NULL THEN
      SELECT id INTO v_ids[1] FROM challenges WHERE lower(name) = lower(btrim(p_payload->>'prerequisite'));
    END IF;

    v_ops := v_ops || jsonb_build_object(
      'table','challenges',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_name,
      'fields', jsonb_strip_nulls(jsonb_build_object(
        'opponent_team_id', v_other,
        'win_condition', p_payload->>'win_condition',
        'coin_reward', p_payload->'coin_reward',
        'gem_reward', p_payload->'gem_reward',
        'pack_reward', v_pack_reward,
        'lineup_restrictions', p_payload->'lineup_restrictions',
        'expires_at', p_payload->>'expires_at')));

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO challenges(
          name, description, challenge_type, opponent_team_id, win_condition, win_by_amount,
          series_length, series_win_coins, series_loss_coins, stat_limit_player_id, stat_limit_stat,
          stat_limit_value, coin_reward, gem_reward, pack_reward, card_reward_id, spotlight_group,
          sort_order, lineup_restrictions, is_repeatable, expires_at)
        VALUES (
          v_name, p_payload->>'description', coalesce(p_payload->>'challenge_type','single'), v_other,
          coalesce(p_payload->>'win_condition','win'), (p_payload->>'win_by_amount')::int,
          (p_payload->>'series_length')::int,
          coalesce((p_payload->>'series_win_coins')::int, 0),
          coalesce((p_payload->>'series_loss_coins')::int, 0),
          nullif(coalesce(array_length(v_ids_b,1),0), 0) * 0 + v_ids_b[1],
          p_payload->>'stat_limit_stat', (p_payload->>'stat_limit_value')::int,
          coalesce((p_payload->>'coin_reward')::int, 0),
          coalesce((p_payload->>'gem_reward')::int, 0),
          v_pack_reward,
          CASE WHEN p_payload ? 'card_reward' THEN v_ids[1] ELSE NULL END,
          p_payload->>'spotlight_group',
          coalesce((p_payload->>'sort_order')::int, 0),
          p_payload->'lineup_restrictions',
          coalesce((p_payload->>'is_repeatable')::boolean, true),
          (p_payload->>'expires_at')::timestamptz)
        RETURNING id INTO v_id;
      ELSE
        UPDATE challenges SET
          description = CASE WHEN p_payload ? 'description' THEN p_payload->>'description' ELSE description END,
          challenge_type = coalesce(p_payload->>'challenge_type', challenge_type),
          opponent_team_id = coalesce(v_other, opponent_team_id),
          win_condition = coalesce(p_payload->>'win_condition', win_condition),
          win_by_amount = CASE WHEN p_payload ? 'win_by_amount' THEN (p_payload->>'win_by_amount')::int ELSE win_by_amount END,
          series_length = CASE WHEN p_payload ? 'series_length' THEN (p_payload->>'series_length')::int ELSE series_length END,
          series_win_coins = coalesce((p_payload->>'series_win_coins')::int, series_win_coins),
          series_loss_coins = coalesce((p_payload->>'series_loss_coins')::int, series_loss_coins),
          stat_limit_player_id = CASE WHEN p_payload ? 'stat_limit_player' THEN v_ids_b[1] ELSE stat_limit_player_id END,
          stat_limit_stat = CASE WHEN p_payload ? 'stat_limit_stat' THEN p_payload->>'stat_limit_stat' ELSE stat_limit_stat END,
          stat_limit_value = CASE WHEN p_payload ? 'stat_limit_value' THEN (p_payload->>'stat_limit_value')::int ELSE stat_limit_value END,
          coin_reward = coalesce((p_payload->>'coin_reward')::int, coin_reward),
          gem_reward = coalesce((p_payload->>'gem_reward')::int, gem_reward),
          pack_reward = CASE WHEN p_payload ? 'pack_reward' THEN v_pack_reward ELSE pack_reward END,
          card_reward_id = CASE WHEN p_payload ? 'card_reward' THEN v_ids[1] ELSE card_reward_id END,
          spotlight_group = CASE WHEN p_payload ? 'spotlight_group' THEN p_payload->>'spotlight_group' ELSE spotlight_group END,
          sort_order = coalesce((p_payload->>'sort_order')::int, sort_order),
          lineup_restrictions = CASE WHEN p_payload ? 'lineup_restrictions' THEN p_payload->'lineup_restrictions' ELSE lineup_restrictions END,
          is_repeatable = coalesce((p_payload->>'is_repeatable')::boolean, is_repeatable),
          expires_at = CASE WHEN p_payload ? 'expires_at' THEN (p_payload->>'expires_at')::timestamptz ELSE expires_at END
        WHERE id = v_id;
      END IF;
    END IF;

  ----------------------------------------------------------- DYNAMIC DUO
  ELSIF p_kind = 'dynamic_duo' THEN
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'name is required'; END IF;
    SELECT id INTO v_id FROM dynamic_duos WHERE lower(name) = lower(v_name);

    IF v_id IS NULL AND (p_payload->>'player_a' IS NULL OR p_payload->>'player_b' IS NULL) THEN
      RAISE EXCEPTION 'player_a and player_b are required when creating a duo';
    END IF;

    v_ids := '{}';
    IF p_payload->>'player_a' IS NOT NULL THEN
      v_ids := public.admin_resolve_player_ids(jsonb_build_array(p_payload->>'player_a'));
    END IF;
    v_ids_b := '{}';
    IF p_payload->>'player_b' IS NOT NULL THEN
      v_ids_b := public.admin_resolve_player_ids(jsonb_build_array(p_payload->>'player_b'));
    END IF;
    IF coalesce(array_length(v_ids,1),0) > 0 AND coalesce(array_length(v_ids_b,1),0) > 0
       AND v_ids[1] = v_ids_b[1] THEN
      RAISE EXCEPTION 'player_a and player_b must be different cards';
    END IF;

    FOR v_slot IN SELECT k FROM (
      SELECT jsonb_object_keys(coalesce(p_payload->'boosts_a','{}'::jsonb)) AS k
      UNION ALL
      SELECT jsonb_object_keys(coalesce(p_payload->'boosts_b','{}'::jsonb)) AS k) s LOOP
      IF NOT (v_slot = ANY(v_stat_keys)) THEN
        RAISE EXCEPTION 'Unknown boost key "%". Allowed: %', v_slot, v_stat_keys;
      END IF;
    END LOOP;

    v_ops := v_ops || jsonb_build_object(
      'table','dynamic_duos',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_name,
      'fields', jsonb_strip_nulls(jsonb_build_object(
        'player_card_id_a', v_ids[1],
        'player_card_id_b', v_ids_b[1],
        'boosts_a', p_payload->'boosts_a',
        'boosts_b', p_payload->'boosts_b',
        'is_active', p_payload->'is_active')));

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO dynamic_duos(name, description, player_card_id_a, player_card_id_b, boosts_a, boosts_b, is_active)
        VALUES (v_name, p_payload->>'description', v_ids[1], v_ids_b[1],
                coalesce(p_payload->'boosts_a','{}'::jsonb),
                coalesce(p_payload->'boosts_b','{}'::jsonb),
                coalesce((p_payload->>'is_active')::boolean, true))
        RETURNING id INTO v_id;
      ELSE
        UPDATE dynamic_duos SET
          description = CASE WHEN p_payload ? 'description' THEN p_payload->>'description' ELSE description END,
          player_card_id_a = coalesce(v_ids[1], player_card_id_a),
          player_card_id_b = coalesce(v_ids_b[1], player_card_id_b),
          boosts_a = coalesce(p_payload->'boosts_a', boosts_a),
          boosts_b = coalesce(p_payload->'boosts_b', boosts_b),
          is_active = coalesce((p_payload->>'is_active')::boolean, is_active),
          updated_at = now()
        WHERE id = v_id;
      END IF;
    END IF;

  ELSE
    RAISE EXCEPTION 'Unknown kind: %', p_kind;
  END IF;

  RETURN jsonb_build_object(
    'kind', p_kind,
    'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit,
    'id', v_id,
    'operations', v_ops,
    'destructive', v_destr);
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_apply_content(text, jsonb, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_content(text, jsonb, boolean) TO authenticated, service_role;