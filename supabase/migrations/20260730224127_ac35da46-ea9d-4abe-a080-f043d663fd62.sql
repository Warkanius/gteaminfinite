DELETE FROM public.team_players WHERE team_id IN (SELECT id FROM public.teams WHERE name = '__zz_fixture_team');
DELETE FROM public.teams WHERE name = '__zz_fixture_team';
DELETE FROM public.player_card_badges WHERE player_card_id IN (SELECT id FROM public.player_cards WHERE name = '__zz_fixture_player');
DELETE FROM public.player_card_traits WHERE player_card_id IN (SELECT id FROM public.player_cards WHERE name = '__zz_fixture_player');
DELETE FROM public.player_cards WHERE name = '__zz_fixture_player';