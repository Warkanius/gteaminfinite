-- Update existing LFO games (orders 1-6)
UPDATE domination_games SET opponent_name = 'Ringgold I', coin_reward = 750, difficulty_stars = 1, pack_reward = '56c40113-4a0b-404a-b726-7d413e92aaea' WHERE id = 'e7e01aba-e55f-4482-ac42-74b0490a7905';
UPDATE domination_games SET opponent_name = 'Heritage I', coin_reward = 750, difficulty_stars = 1, pack_reward = '56c40113-4a0b-404a-b726-7d413e92aaea' WHERE id = '7d89293e-f56d-4f09-b783-8ee137c7d72e';
UPDATE domination_games SET opponent_name = 'McCallie I', coin_reward = 1000, difficulty_stars = 2, pack_reward = '56c40113-4a0b-404a-b726-7d413e92aaea' WHERE id = '9ef46b69-df7e-4d6d-bb9c-694204afce04';
UPDATE domination_games SET opponent_name = 'Hamilton Heights I', coin_reward = 1000, difficulty_stars = 2, pack_reward = '56c40113-4a0b-404a-b726-7d413e92aaea' WHERE id = '3f0ab7bb-3d24-45b4-90e2-0537ec8585b4';
UPDATE domination_games SET opponent_name = 'Ringgold II', coin_reward = 1000, difficulty_stars = 3, pack_reward = '56c40113-4a0b-404a-b726-7d413e92aaea' WHERE id = '7cb1dbd8-0da9-42be-b3ee-9cd2c1de6d76';
UPDATE domination_games SET opponent_name = 'Heritage II', coin_reward = 1000, difficulty_stars = 3, pack_reward = '56c40113-4a0b-404a-b726-7d413e92aaea' WHERE id = 'e18a5552-ecff-4f11-bcc7-18bacbb54520';

-- Update existing Seirin games (orders 1-6)
UPDATE domination_games SET opponent_name = 'Kaijo I', coin_reward = 750, difficulty_stars = 1, pack_reward = '56c40113-4a0b-404a-b726-7d413e92aaea' WHERE id = 'f6158db4-0fab-4b94-a4b3-dd60ac64576e';
UPDATE domination_games SET opponent_name = 'Shutoku I', coin_reward = 750, difficulty_stars = 1, pack_reward = '56c40113-4a0b-404a-b726-7d413e92aaea' WHERE id = 'b2978bd7-0e03-4c55-a424-d3c1e44739d4';
UPDATE domination_games SET opponent_name = 'Toō I', coin_reward = 1000, difficulty_stars = 2, pack_reward = '56c40113-4a0b-404a-b726-7d413e92aaea' WHERE id = 'badd0dac-4800-4599-8915-10c09bcf25ea';
UPDATE domination_games SET opponent_name = 'Yosen I', coin_reward = 1000, difficulty_stars = 2, pack_reward = '56c40113-4a0b-404a-b726-7d413e92aaea' WHERE id = '4128e9e0-88bb-4c74-a385-994367b12de8';
UPDATE domination_games SET opponent_name = 'Shutoku II', coin_reward = 1000, difficulty_stars = 3, pack_reward = '56c40113-4a0b-404a-b726-7d413e92aaea' WHERE id = 'a0707a78-c4aa-43f8-b1c3-143a4780a5f0';
UPDATE domination_games SET opponent_name = 'Kaijo II', coin_reward = 1000, difficulty_stars = 3, pack_reward = '56c40113-4a0b-404a-b726-7d413e92aaea' WHERE id = 'f7eb8ccc-586d-4e22-a818-5635cc9fd8b4';

-- Insert LFO games 7-11
INSERT INTO domination_games (road_name, game_order, opponent_name, difficulty_stars, coin_reward, pack_reward) VALUES
  ('LFO High School', 7, 'Brainerd ''84', 3, 1000, '56c40113-4a0b-404a-b726-7d413e92aaea'),
  ('LFO High School', 8, 'McCallie II', 4, 2000, '7feeb04c-4061-48cb-a07f-2d5bedf09f9a'),
  ('LFO High School', 9, 'Hamilton Heights II', 4, 2000, '7feeb04c-4061-48cb-a07f-2d5bedf09f9a'),
  ('LFO High School', 10, 'Brainerd ''84 II', 4, 2000, '7feeb04c-4061-48cb-a07f-2d5bedf09f9a'),
  ('LFO High School', 11, 'Georgia Stars', 5, 4000, '7feeb04c-4061-48cb-a07f-2d5bedf09f9a');

-- Insert Seirin games 7-11
INSERT INTO domination_games (road_name, game_order, opponent_name, difficulty_stars, coin_reward, pack_reward) VALUES
  ('Seirin High', 7, 'Rakuzan', 3, 1000, '56c40113-4a0b-404a-b726-7d413e92aaea'),
  ('Seirin High', 8, 'Toō II', 4, 2000, '7feeb04c-4061-48cb-a07f-2d5bedf09f9a'),
  ('Seirin High', 9, 'Yosen II', 4, 2000, '7feeb04c-4061-48cb-a07f-2d5bedf09f9a'),
  ('Seirin High', 10, 'Rakuzan II', 4, 2000, '7feeb04c-4061-48cb-a07f-2d5bedf09f9a'),
  ('Seirin High', 11, 'Generation of Miracles', 5, 4000, '7feeb04c-4061-48cb-a07f-2d5bedf09f9a');