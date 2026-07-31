DO $$
DECLARE
  v_admin uuid; v_payload jsonb; v_res jsonb; v_tok text; v_g1 uuid; v_g6 uuid;
  v_ids uuid[]; v_ids2 uuid[]; v_before jsonb; v_n int; v_other uuid; v_packdup text; v_pack1 uuid;
  v_games jsonb; v_err text; v_orders int[];
  ROAD text := 'ZZ Test Road'; ROAD2 text := 'ZZ Other Road';
BEGIN
  SELECT user_id INTO v_admin FROM user_roles WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  SELECT array_agg(id) INTO v_ids FROM (SELECT id FROM player_cards ORDER BY created_at LIMIT 5) t;
  SELECT array_agg(id) INTO v_ids2 FROM (SELECT id FROM player_cards ORDER BY created_at OFFSET 5 LIMIT 5) t;
  SELECT id INTO v_pack1 FROM packs ORDER BY created_at LIMIT 1;
  SELECT lower(btrim(name)) INTO v_packdup FROM packs GROUP BY 1 HAVING count(*) > 1 LIMIT 1;

  -- clean slate
  DELETE FROM domination_game_players WHERE domination_game_id IN (SELECT id FROM domination_games WHERE road_name IN (ROAD, ROAD2));
  DELETE FROM domination_games WHERE road_name IN (ROAD, ROAD2);

  -------------------------------------------------------------- A: rematch
  v_payload := jsonb_build_object('domination_roads', jsonb_build_array(jsonb_build_object(
    'road_name', ROAD, 'games', jsonb_build_array(
      jsonb_build_object('game_order',1,'opponent_name','Lockport','difficulty_stars',1,'coin_reward',1350,
        'pack_reward_id', v_pack1, 'roster', (SELECT jsonb_agg(jsonb_build_object('player_id',u)) FROM unnest(v_ids) u)),
      jsonb_build_object('game_order',6,'opponent_name','Lockport','difficulty_stars',3,'coin_reward',2000,
        'roster', (SELECT jsonb_agg(jsonb_build_object('player_id',u)) FROM unnest(v_ids2) u))))));
  v_res := public.admin_apply_batch(v_payload, false, NULL, 'domination_road');
  v_tok := v_res->>'preview_token';
  IF v_tok IS NULL THEN RAISE EXCEPTION 'TEST A FAILED: no preview token'; END IF;
  SELECT count(*) INTO v_n FROM domination_games WHERE road_name = ROAD;
  IF v_n <> 0 THEN RAISE EXCEPTION 'TEST A FAILED: preview wrote % rows', v_n; END IF;
  v_res := public.admin_apply_batch(v_payload, true, v_tok, 'domination_road');
  SELECT id INTO v_g1 FROM domination_games WHERE road_name = ROAD AND game_order = 1;
  SELECT id INTO v_g6 FROM domination_games WHERE road_name = ROAD AND game_order = 6;
  IF v_g1 IS NULL OR v_g6 IS NULL OR v_g1 = v_g6 THEN
    RAISE EXCEPTION 'TEST A FAILED: rematch did not produce two distinct ids (% / %)', v_g1, v_g6;
  END IF;
  RAISE NOTICE 'TEST A PASSED: Lockport at order 1 (%) and order 6 (%) are distinct games', v_g1, v_g6;

  -------------------------------------- G: roster slot order round-trip (A)
  IF (SELECT array_agg(player_card_id ORDER BY slot) FROM domination_game_players WHERE domination_game_id = v_g1) <> v_ids THEN
    RAISE EXCEPTION 'TEST G FAILED: slot order not preserved on create';
  END IF;

  ------------------------------------------- B: update game 6 only, by id
  v_payload := jsonb_build_object('domination_roads', jsonb_build_array(jsonb_build_object(
    'road_name', ROAD, 'games', jsonb_build_array(
      jsonb_build_object('domination_game_id', v_g6, 'game_order', 6, 'opponent_name','Lockport',
        'difficulty_stars',5,'coin_reward',9999,
        'roster', (SELECT jsonb_agg(jsonb_build_object('player_id',u)) FROM unnest(ARRAY[v_ids2[5],v_ids2[4],v_ids2[3],v_ids2[2],v_ids2[1]]) u))))));
  v_res := public.admin_apply_batch(v_payload, false, NULL, 'domination_road');
  v_tok := v_res->>'preview_token';
  v_res := public.admin_apply_batch(v_payload, true, v_tok, 'domination_road');
  IF (SELECT coin_reward FROM domination_games WHERE id = v_g1) <> 1350
     OR (SELECT difficulty_stars FROM domination_games WHERE id = v_g1) <> 1
     OR (SELECT array_agg(player_card_id ORDER BY slot) FROM domination_game_players WHERE domination_game_id = v_g1) <> v_ids THEN
    RAISE EXCEPTION 'TEST B FAILED: game 1 was modified';
  END IF;
  IF (SELECT coin_reward FROM domination_games WHERE id = v_g6) <> 9999 THEN
    RAISE EXCEPTION 'TEST B FAILED: game 6 not updated';
  END IF;
  IF (SELECT array_agg(player_card_id ORDER BY slot) FROM domination_game_players WHERE domination_game_id = v_g6)
     <> ARRAY[v_ids2[5],v_ids2[4],v_ids2[3],v_ids2[2],v_ids2[1]] THEN
    RAISE EXCEPTION 'TEST G FAILED: reordered roster not stored in slot order';
  END IF;
  RAISE NOTICE 'TEST B PASSED: updating game 6 left game 1 untouched. TEST G PASSED: slot order survives round trip';

  -------------------------------- C/D: 11 games with rematches, atomically
  v_games := '[]'::jsonb;
  FOR v_n IN 1..11 LOOP
    v_games := v_games || jsonb_build_array(jsonb_build_object(
      'game_order', v_n,
      'opponent_name', CASE WHEN v_n IN (1,6) THEN 'Lockport' WHEN v_n IN (2,9) THEN 'Ringgold' ELSE 'Opp ' || v_n END,
      'difficulty_stars', 1 + (v_n % 5), 'coin_reward', 1000 + v_n * 50,
      'roster', (SELECT jsonb_agg(jsonb_build_object('player_id',u)) FROM unnest(v_ids) u)));
  END LOOP;
  v_payload := jsonb_build_object('domination_roads', jsonb_build_array(jsonb_build_object(
    'road_name', ROAD, 'replace_road', true, 'games', v_games)));
  v_res := public.admin_apply_batch(v_payload, false, NULL, 'domination_road');
  v_tok := v_res->>'preview_token';
  IF v_tok IS NULL THEN RAISE EXCEPTION 'TEST C FAILED: 11-game preview rejected'; END IF;
  RAISE NOTICE 'TEST C PASSED: 11-game road with rematches previewed (creates+updates=%)',
    jsonb_array_length(v_res->'creates') + jsonb_array_length(v_res->'updates');
  v_res := public.admin_apply_batch(v_payload, true, v_tok, 'domination_road');
  SELECT count(*) INTO v_n FROM domination_games WHERE road_name = ROAD;
  IF v_n <> 11 THEN RAISE EXCEPTION 'TEST D FAILED: expected 11 games, got %', v_n; END IF;
  IF (SELECT id FROM domination_games WHERE road_name = ROAD AND game_order = 1) <> v_g1 THEN
    RAISE EXCEPTION 'TEST D FAILED: existing game id was not preserved';
  END IF;
  SELECT count(*) INTO v_n FROM domination_games WHERE road_name = ROAD AND opponent_name = 'Lockport';
  IF v_n <> 2 THEN RAISE EXCEPTION 'TEST D FAILED: expected 2 Lockport games, got %', v_n; END IF;
  RAISE NOTICE 'TEST D PASSED: 11 games committed, ids preserved, 2 distinct Lockport rematches';

  ------------------------------------------ E: bad reference -> zero writes
  v_payload := jsonb_build_object('domination_roads', jsonb_build_array(jsonb_build_object(
    'road_name', ROAD, 'games', jsonb_build_array(
      jsonb_build_object('game_order', 1, 'opponent_name','Lockport','coin_reward', 1),
      jsonb_build_object('game_order', 7, 'opponent_name','Broken','pack_reward_id','11111111-1111-1111-1111-111111111111')))));
  BEGIN
    v_res := public.admin_apply_batch(v_payload, false, NULL, 'domination_road');
    RAISE EXCEPTION 'TEST E FAILED: invalid pack was accepted';
  EXCEPTION WHEN others THEN
    v_err := SQLERRM;
    IF v_err LIKE 'TEST E FAILED%' THEN RAISE; END IF;
  END;
  IF (SELECT coin_reward FROM domination_games WHERE id = v_g1) = 1 THEN
    RAISE EXCEPTION 'TEST E FAILED: partial write occurred';
  END IF;
  RAISE NOTICE 'TEST E PASSED: rejected with [%] and wrote nothing', left(v_err, 160);

  ----------------------------- F: replace_road scoped to one road only
  INSERT INTO domination_games(road_name, opponent_name, game_order, difficulty_stars, coin_reward)
  VALUES (ROAD, 'Placeholder', 12, 1, 0), (ROAD2, 'Untouched', 1, 1, 500);
  v_payload := jsonb_build_object('domination_roads', jsonb_build_array(jsonb_build_object(
    'road_name', ROAD, 'replace_road', true, 'games', v_games)));
  v_res := public.admin_apply_batch(v_payload, false, NULL, 'domination_road');
  v_tok := v_res->>'preview_token';
  IF jsonb_array_length(v_res->'deletes') = 0 THEN RAISE EXCEPTION 'TEST F FAILED: preview did not report the deletion'; END IF;
  v_res := public.admin_apply_batch(v_payload, true, v_tok, 'domination_road');
  IF EXISTS (SELECT 1 FROM domination_games WHERE road_name = ROAD AND opponent_name = 'Placeholder') THEN
    RAISE EXCEPTION 'TEST F FAILED: placeholder survived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM domination_games WHERE road_name = ROAD2 AND opponent_name = 'Untouched') THEN
    RAISE EXCEPTION 'TEST F FAILED: another road was affected';
  END IF;
  RAISE NOTICE 'TEST F PASSED: omitted placeholder deleted, other road untouched';

  ------------------------------------------------- H: pack name ambiguity
  IF v_packdup IS NOT NULL THEN
    BEGIN
      v_res := public.admin_apply_batch(jsonb_build_object('domination_roads', jsonb_build_array(jsonb_build_object(
        'road_name', ROAD, 'games', jsonb_build_array(jsonb_build_object(
          'game_order', 3, 'opponent_name','Opp 3', 'pack_reward', v_packdup))))), false, NULL, 'domination_road');
      RAISE EXCEPTION 'TEST H FAILED: ambiguous pack name accepted';
    EXCEPTION WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE 'TEST H FAILED%' THEN RAISE; END IF;
      IF v_err NOT LIKE 'AMBIGUOUS_PACK%' THEN RAISE EXCEPTION 'TEST H FAILED: wrong error %', v_err; END IF;
    END;
    RAISE NOTICE 'TEST H PASSED: duplicate pack name rejected -> %', left(v_err, 200);
  END IF;
  v_payload := jsonb_build_object('domination_roads', jsonb_build_array(jsonb_build_object(
    'road_name', ROAD, 'games', jsonb_build_array(jsonb_build_object(
      'game_order', 3, 'opponent_name','Opp 3', 'pack_reward_id', v_pack1)))));
  v_res := public.admin_apply_batch(v_payload, false, NULL, 'domination_road');
  v_res := public.admin_apply_batch(v_payload, true, v_res->>'preview_token', 'domination_road');
  IF (SELECT pack_reward_id FROM domination_games WHERE road_name = ROAD AND game_order = 3) <> v_pack1 THEN
    RAISE EXCEPTION 'TEST H FAILED: pack_reward_id not stored';
  END IF;
  RAISE NOTICE 'TEST H PASSED: pack_reward_id stored by immutable id';

  ------------------------------------------------- delete tool (per game)
  SELECT id INTO v_other FROM domination_games WHERE road_name = ROAD AND game_order = 11;
  v_res := public.admin_delete_domination_game(jsonb_build_object('domination_game_id', v_other), false, NULL);
  IF NOT EXISTS (SELECT 1 FROM domination_games WHERE id = v_other) THEN
    RAISE EXCEPTION 'DELETE TEST FAILED: preview deleted the game';
  END IF;
  v_res := public.admin_delete_domination_game(jsonb_build_object('domination_game_id', v_other), true, v_res->>'preview_token');
  IF EXISTS (SELECT 1 FROM domination_games WHERE id = v_other)
     OR EXISTS (SELECT 1 FROM domination_game_players WHERE domination_game_id = v_other) THEN
    RAISE EXCEPTION 'DELETE TEST FAILED: game or roster rows remain';
  END IF;
  RAISE NOTICE 'DELETE TEST PASSED: preview then commit removed game and roster rows';

  ------------------------------------------------------------------ cleanup
  DELETE FROM domination_game_players WHERE domination_game_id IN (SELECT id FROM domination_games WHERE road_name IN (ROAD, ROAD2));
  DELETE FROM domination_games WHERE road_name IN (ROAD, ROAD2);
  DELETE FROM admin_preview_tokens WHERE user_id = v_admin;
  RAISE NOTICE 'ALL DOMINATION ROAD TESTS PASSED; test data removed';
END $$;