export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      auction_listings: {
        Row: {
          bought_at: string | null
          bought_by: string | null
          expires_at: string
          id: string
          is_active: boolean
          listed_at: string
          player_card_id: string
          price: number
          seller_type: string
        }
        Insert: {
          bought_at?: string | null
          bought_by?: string | null
          expires_at?: string
          id?: string
          is_active?: boolean
          listed_at?: string
          player_card_id: string
          price?: number
          seller_type?: string
        }
        Update: {
          bought_at?: string | null
          bought_by?: string | null
          expires_at?: string
          id?: string
          is_active?: boolean
          listed_at?: string
          player_card_id?: string
          price?: number
          seller_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_listings_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      badges: {
        Row: {
          abbreviation: string
          affected_stat: string | null
          created_at: string
          description_actolytrene: string | null
          description_base: string | null
          description_diamond: string | null
          description_gold: string | null
          description_hof: string | null
          effect_type: string
          id: string
          name: string
        }
        Insert: {
          abbreviation: string
          affected_stat?: string | null
          created_at?: string
          description_actolytrene?: string | null
          description_base?: string | null
          description_diamond?: string | null
          description_gold?: string | null
          description_hof?: string | null
          effect_type?: string
          id?: string
          name: string
        }
        Update: {
          abbreviation?: string
          affected_stat?: string | null
          created_at?: string
          description_actolytrene?: string | null
          description_base?: string | null
          description_diamond?: string | null
          description_gold?: string | null
          description_hof?: string | null
          effect_type?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      card_game_stats: {
        Row: {
          created_at: string
          game_log_id: string
          id: string
          player_card_id: string
          points_scored: number
          side: string
          stat_3pt: number
          stat_ast: number
          stat_blk: number
          stat_dnk: number
          stat_fin: number
          stat_int: number
          stat_mid: number
          stat_reb: number
          stat_stl: number
          user_id: string
        }
        Insert: {
          created_at?: string
          game_log_id: string
          id?: string
          player_card_id: string
          points_scored?: number
          side?: string
          stat_3pt?: number
          stat_ast?: number
          stat_blk?: number
          stat_dnk?: number
          stat_fin?: number
          stat_int?: number
          stat_mid?: number
          stat_reb?: number
          stat_stl?: number
          user_id: string
        }
        Update: {
          created_at?: string
          game_log_id?: string
          id?: string
          player_card_id?: string
          points_scored?: number
          side?: string
          stat_3pt?: number
          stat_ast?: number
          stat_blk?: number
          stat_dnk?: number
          stat_fin?: number
          stat_int?: number
          stat_mid?: number
          stat_reb?: number
          stat_stl?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_game_stats_game_log_id_fkey"
            columns: ["game_log_id"]
            isOneToOne: false
            referencedRelation: "game_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_game_stats_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_completions: {
        Row: {
          challenge_id: string
          completed_at: string
          id: string
          user_id: string
        }
        Insert: {
          challenge_id: string
          completed_at?: string
          id?: string
          user_id: string
        }
        Update: {
          challenge_id?: string
          completed_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_completions_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          card_reward_id: string | null
          challenge_type: string
          coin_reward: number
          conditions: Json | null
          created_at: string
          description: string | null
          expires_at: string | null
          gem_reward: number
          id: string
          is_repeatable: boolean
          lineup_restrictions: Json | null
          name: string
          opponent_team_id: string | null
          pack_reward: string | null
          prerequisite_id: string | null
          series_length: number | null
          series_loss_coins: number
          series_win_coins: number
          sort_order: number
          spotlight_group: string | null
          stat_limit_player_id: string | null
          stat_limit_stat: string | null
          stat_limit_value: number | null
          win_by_amount: number | null
          win_condition: string
        }
        Insert: {
          card_reward_id?: string | null
          challenge_type?: string
          coin_reward?: number
          conditions?: Json | null
          created_at?: string
          description?: string | null
          expires_at?: string | null
          gem_reward?: number
          id?: string
          is_repeatable?: boolean
          lineup_restrictions?: Json | null
          name: string
          opponent_team_id?: string | null
          pack_reward?: string | null
          prerequisite_id?: string | null
          series_length?: number | null
          series_loss_coins?: number
          series_win_coins?: number
          sort_order?: number
          spotlight_group?: string | null
          stat_limit_player_id?: string | null
          stat_limit_stat?: string | null
          stat_limit_value?: number | null
          win_by_amount?: number | null
          win_condition?: string
        }
        Update: {
          card_reward_id?: string | null
          challenge_type?: string
          coin_reward?: number
          conditions?: Json | null
          created_at?: string
          description?: string | null
          expires_at?: string | null
          gem_reward?: number
          id?: string
          is_repeatable?: boolean
          lineup_restrictions?: Json | null
          name?: string
          opponent_team_id?: string | null
          pack_reward?: string | null
          prerequisite_id?: string | null
          series_length?: number | null
          series_loss_coins?: number
          series_win_coins?: number
          sort_order?: number
          spotlight_group?: string | null
          stat_limit_player_id?: string | null
          stat_limit_stat?: string | null
          stat_limit_value?: number | null
          win_by_amount?: number | null
          win_condition?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenges_card_reward_id_fkey"
            columns: ["card_reward_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_prerequisite_id_fkey"
            columns: ["prerequisite_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_stat_limit_player_id_fkey"
            columns: ["stat_limit_player_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      domination_game_players: {
        Row: {
          domination_game_id: string
          id: string
          player_card_id: string
          slot: number
        }
        Insert: {
          domination_game_id: string
          id?: string
          player_card_id: string
          slot?: number
        }
        Update: {
          domination_game_id?: string
          id?: string
          player_card_id?: string
          slot?: number
        }
        Relationships: [
          {
            foreignKeyName: "domination_game_players_domination_game_id_fkey"
            columns: ["domination_game_id"]
            isOneToOne: false
            referencedRelation: "domination_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domination_game_players_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      domination_games: {
        Row: {
          coin_reward: number
          created_at: string
          difficulty_stars: number
          game_order: number
          id: string
          opponent_name: string
          pack_reward: string | null
          road_name: string
        }
        Insert: {
          coin_reward?: number
          created_at?: string
          difficulty_stars?: number
          game_order: number
          id?: string
          opponent_name: string
          pack_reward?: string | null
          road_name: string
        }
        Update: {
          coin_reward?: number
          created_at?: string
          difficulty_stars?: number
          game_order?: number
          id?: string
          opponent_name?: string
          pack_reward?: string | null
          road_name?: string
        }
        Relationships: []
      }
      evo_paths: {
        Row: {
          challenge_description: string
          challenge_stat: string | null
          challenge_target: number
          challenge_type: string
          compound_challenges: Json
          created_at: string
          evolves_to_card_id: string | null
          from_tier_id: string | null
          id: string
          new_badges: Json
          player_card_id: string
          stat_boosts: Json
          step_order: number
          to_tier_id: string | null
        }
        Insert: {
          challenge_description?: string
          challenge_stat?: string | null
          challenge_target?: number
          challenge_type?: string
          compound_challenges?: Json
          created_at?: string
          evolves_to_card_id?: string | null
          from_tier_id?: string | null
          id?: string
          new_badges?: Json
          player_card_id: string
          stat_boosts?: Json
          step_order?: number
          to_tier_id?: string | null
        }
        Update: {
          challenge_description?: string
          challenge_stat?: string | null
          challenge_target?: number
          challenge_type?: string
          compound_challenges?: Json
          created_at?: string
          evolves_to_card_id?: string | null
          from_tier_id?: string | null
          id?: string
          new_badges?: Json
          player_card_id?: string
          stat_boosts?: Json
          step_order?: number
          to_tier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evo_paths_evolves_to_card_id_fkey"
            columns: ["evolves_to_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evo_paths_from_tier_id_fkey"
            columns: ["from_tier_id"]
            isOneToOne: false
            referencedRelation: "gem_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evo_paths_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evo_paths_to_tier_id_fkey"
            columns: ["to_tier_id"]
            isOneToOne: false
            referencedRelation: "gem_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      game_logs: {
        Row: {
          cpu_score: number
          domination_game_id: string | null
          id: string
          mode: string
          opponent_name: string | null
          played_at: string
          player_stats: Json | null
          user_id: string
          user_score: number
          won: boolean
        }
        Insert: {
          cpu_score?: number
          domination_game_id?: string | null
          id?: string
          mode?: string
          opponent_name?: string | null
          played_at?: string
          player_stats?: Json | null
          user_id: string
          user_score?: number
          won?: boolean
        }
        Update: {
          cpu_score?: number
          domination_game_id?: string | null
          id?: string
          mode?: string
          opponent_name?: string | null
          played_at?: string
          player_stats?: Json | null
          user_id?: string
          user_score?: number
          won?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "game_logs_domination_game_id_fkey"
            columns: ["domination_game_id"]
            isOneToOne: false
            referencedRelation: "domination_games"
            referencedColumns: ["id"]
          },
        ]
      }
      gem_market_listings: {
        Row: {
          created_at: string
          gem_tier_id: string
          gem_value: number
          id: string
          player_card_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          gem_tier_id: string
          gem_value?: number
          id?: string
          player_card_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          gem_tier_id?: string
          gem_value?: number
          id?: string
          player_card_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "gem_market_listings_gem_tier_id_fkey"
            columns: ["gem_tier_id"]
            isOneToOne: false
            referencedRelation: "gem_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gem_market_listings_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: true
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      gem_task_completions: {
        Row: {
          completed_at: string
          gem_task_id: string
          id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          gem_task_id: string
          id?: string
          user_id: string
        }
        Update: {
          completed_at?: string
          gem_task_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gem_task_completions_gem_task_id_fkey"
            columns: ["gem_task_id"]
            isOneToOne: false
            referencedRelation: "gem_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      gem_tasks: {
        Row: {
          category: string
          cooldown_hours: number
          created_at: string
          description: string | null
          gem_reward: number
          id: string
          is_active: boolean
          title: string
        }
        Insert: {
          category?: string
          cooldown_hours?: number
          created_at?: string
          description?: string | null
          gem_reward?: number
          id?: string
          is_active?: boolean
          title: string
        }
        Update: {
          category?: string
          cooldown_hours?: number
          created_at?: string
          description?: string | null
          gem_reward?: number
          id?: string
          is_active?: boolean
          title?: string
        }
        Relationships: []
      }
      gem_tiers: {
        Row: {
          color: string
          doubles_modifier: number | null
          gem_value: number
          id: string
          name: string
          roll_modifier: number
          sort_order: number
          stars: number
        }
        Insert: {
          color: string
          doubles_modifier?: number | null
          gem_value?: number
          id?: string
          name: string
          roll_modifier?: number
          sort_order?: number
          stars?: number
        }
        Update: {
          color?: string
          doubles_modifier?: number | null
          gem_value?: number
          id?: string
          name?: string
          roll_modifier?: number
          sort_order?: number
          stars?: number
        }
        Relationships: []
      }
      locker_code_redemptions: {
        Row: {
          id: string
          locker_code_id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          id?: string
          locker_code_id: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          id?: string
          locker_code_id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "locker_code_redemptions_locker_code_id_fkey"
            columns: ["locker_code_id"]
            isOneToOne: false
            referencedRelation: "locker_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      locker_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string | null
          id: string
          max_redemptions: number | null
          reward_type: string
          reward_value: Json
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          max_redemptions?: number | null
          reward_type?: string
          reward_value?: Json
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          max_redemptions?: number | null
          reward_type?: string
          reward_value?: Json
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          link: string | null
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      pack_odds: {
        Row: {
          description: string | null
          dice_roll: string | null
          id: string
          pack_id: string | null
          pack_type: string
          percentage: number
          result_slot: string
        }
        Insert: {
          description?: string | null
          dice_roll?: string | null
          id?: string
          pack_id?: string | null
          pack_type: string
          percentage?: number
          result_slot: string
        }
        Update: {
          description?: string | null
          dice_roll?: string | null
          id?: string
          pack_id?: string | null
          pack_type?: string
          percentage?: number
          result_slot?: string
        }
        Relationships: [
          {
            foreignKeyName: "pack_odds_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "packs"
            referencedColumns: ["id"]
          },
        ]
      }
      pack_players: {
        Row: {
          id: string
          pack_id: string
          player_card_id: string
          slot_number: number
        }
        Insert: {
          id?: string
          pack_id: string
          player_card_id: string
          slot_number?: number
        }
        Update: {
          id?: string
          pack_id?: string
          player_card_id?: string
          slot_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "pack_players_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_players_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      pack_purchases: {
        Row: {
          cards_pulled: Json
          coins_spent: number
          id: string
          pack_id: string
          purchased_at: string
          quantity: number
          user_id: string
        }
        Insert: {
          cards_pulled?: Json
          coins_spent?: number
          id?: string
          pack_id: string
          purchased_at?: string
          quantity?: number
          user_id: string
        }
        Update: {
          cards_pulled?: Json
          coins_spent?: number
          id?: string
          pack_id?: string
          purchased_at?: string
          quantity?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pack_purchases_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "packs"
            referencedColumns: ["id"]
          },
        ]
      }
      packs: {
        Row: {
          cost: number
          created_at: string
          id: string
          name: string
          pack_type: string
          ten_box_cost: number | null
        }
        Insert: {
          cost?: number
          created_at?: string
          id?: string
          name: string
          pack_type?: string
          ten_box_cost?: number | null
        }
        Update: {
          cost?: number
          created_at?: string
          id?: string
          name?: string
          pack_type?: string
          ten_box_cost?: number | null
        }
        Relationships: []
      }
      player_card_badges: {
        Row: {
          badge_id: string
          id: string
          player_card_id: string
          tier: string
        }
        Insert: {
          badge_id: string
          id?: string
          player_card_id: string
          tier?: string
        }
        Update: {
          badge_id?: string
          id?: string
          player_card_id?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_card_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_card_badges_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      player_card_traits: {
        Row: {
          id: string
          player_card_id: string
          target_stat: string | null
          tier: string
          trait_id: string
        }
        Insert: {
          id?: string
          player_card_id: string
          target_stat?: string | null
          tier?: string
          trait_id: string
        }
        Update: {
          id?: string
          player_card_id?: string
          target_stat?: string | null
          tier?: string
          trait_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_card_traits_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_card_traits_trait_id_fkey"
            columns: ["trait_id"]
            isOneToOne: false
            referencedRelation: "signature_traits"
            referencedColumns: ["id"]
          },
        ]
      }
      player_cards: {
        Row: {
          avatar_url: string | null
          card_animation: string | null
          card_color_primary: string | null
          card_color_secondary: string | null
          card_glow_color: string | null
          collection_id: string | null
          created_at: string
          gem_name: string | null
          gem_tier_id: string | null
          id: string
          is_collection_reward: boolean
          market_value: number
          name: string
          position1: string | null
          position2: string | null
          rating: number
          run_rating: number | null
          run_stat_3pt: number | null
          run_stat_ast: number | null
          run_stat_blk: number | null
          run_stat_dnk: number | null
          run_stat_fin: number | null
          run_stat_int: number | null
          run_stat_mid: number | null
          run_stat_reb: number | null
          run_stat_stl: number | null
          social_handle: string | null
          stat_3pt: number
          stat_ast: number
          stat_blk: number
          stat_dnk: number
          stat_fin: number
          stat_int: number
          stat_mid: number
          stat_reb: number
          stat_stl: number
          sub_collection_id: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          card_animation?: string | null
          card_color_primary?: string | null
          card_color_secondary?: string | null
          card_glow_color?: string | null
          collection_id?: string | null
          created_at?: string
          gem_name?: string | null
          gem_tier_id?: string | null
          id?: string
          is_collection_reward?: boolean
          market_value?: number
          name: string
          position1?: string | null
          position2?: string | null
          rating?: number
          run_rating?: number | null
          run_stat_3pt?: number | null
          run_stat_ast?: number | null
          run_stat_blk?: number | null
          run_stat_dnk?: number | null
          run_stat_fin?: number | null
          run_stat_int?: number | null
          run_stat_mid?: number | null
          run_stat_reb?: number | null
          run_stat_stl?: number | null
          social_handle?: string | null
          stat_3pt?: number
          stat_ast?: number
          stat_blk?: number
          stat_dnk?: number
          stat_fin?: number
          stat_int?: number
          stat_mid?: number
          stat_reb?: number
          stat_stl?: number
          sub_collection_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          card_animation?: string | null
          card_color_primary?: string | null
          card_color_secondary?: string | null
          card_glow_color?: string | null
          collection_id?: string | null
          created_at?: string
          gem_name?: string | null
          gem_tier_id?: string | null
          id?: string
          is_collection_reward?: boolean
          market_value?: number
          name?: string
          position1?: string | null
          position2?: string | null
          rating?: number
          run_rating?: number | null
          run_stat_3pt?: number | null
          run_stat_ast?: number | null
          run_stat_blk?: number | null
          run_stat_dnk?: number | null
          run_stat_fin?: number | null
          run_stat_int?: number | null
          run_stat_mid?: number | null
          run_stat_reb?: number | null
          run_stat_stl?: number | null
          social_handle?: string | null
          stat_3pt?: number
          stat_ast?: number
          stat_blk?: number
          stat_dnk?: number
          stat_fin?: number
          stat_int?: number
          stat_mid?: number
          stat_reb?: number
          stat_stl?: number
          sub_collection_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_cards_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_cards_gem_tier_id_fkey"
            columns: ["gem_tier_id"]
            isOneToOne: false
            referencedRelation: "gem_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_cards_sub_collection_id_fkey"
            columns: ["sub_collection_id"]
            isOneToOne: false
            referencedRelation: "sub_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_cards_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          coins: number
          created_at: string
          display_name: string | null
          gems: number
          id: string
          team_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          coins?: number
          created_at?: string
          display_name?: string | null
          gems?: number
          id?: string
          team_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          coins?: number
          created_at?: string
          display_name?: string | null
          gems?: number
          id?: string
          team_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      rule_config: {
        Row: {
          description: string | null
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      run_players: {
        Row: {
          created_at: string
          id: string
          player_card_id: string
          run_id: string
          run_rating: number
          run_stat_3pt: number
          run_stat_ast: number
          run_stat_blk: number
          run_stat_dnk: number
          run_stat_fin: number
          run_stat_int: number
          run_stat_mid: number
          run_stat_reb: number
          run_stat_stl: number
        }
        Insert: {
          created_at?: string
          id?: string
          player_card_id: string
          run_id: string
          run_rating?: number
          run_stat_3pt?: number
          run_stat_ast?: number
          run_stat_blk?: number
          run_stat_dnk?: number
          run_stat_fin?: number
          run_stat_int?: number
          run_stat_mid?: number
          run_stat_reb?: number
          run_stat_stl?: number
        }
        Update: {
          created_at?: string
          id?: string
          player_card_id?: string
          run_id?: string
          run_rating?: number
          run_stat_3pt?: number
          run_stat_ast?: number
          run_stat_blk?: number
          run_stat_dnk?: number
          run_stat_fin?: number
          run_stat_int?: number
          run_stat_mid?: number
          run_stat_reb?: number
          run_stat_stl?: number
        }
        Relationships: [
          {
            foreignKeyName: "run_players_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_players_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_rank_rewards: {
        Row: {
          coin_reward: number
          gem_reward: number
          id: string
          pack_reward: string
          rank_name: string
          sort_order: number
          wins_required: number
        }
        Insert: {
          coin_reward?: number
          gem_reward?: number
          id?: string
          pack_reward?: string
          rank_name: string
          sort_order?: number
          wins_required: number
        }
        Update: {
          coin_reward?: number
          gem_reward?: number
          id?: string
          pack_reward?: string
          rank_name?: string
          sort_order?: number
          wins_required?: number
        }
        Relationships: []
      }
      runs: {
        Row: {
          created_at: string
          id: string
          milestones: Json
          name: string
          target_score: number
          team_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          milestones?: Json
          name: string
          target_score?: number
          team_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          milestones?: Json
          name?: string
          target_score?: number
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_traits: {
        Row: {
          abbreviation: string
          condition_type: string | null
          created_at: string
          description_actolytrene: string | null
          description_base: string | null
          description_diamond: string | null
          description_gold: string | null
          description_hof: string | null
          id: string
          name: string
        }
        Insert: {
          abbreviation: string
          condition_type?: string | null
          created_at?: string
          description_actolytrene?: string | null
          description_base?: string | null
          description_diamond?: string | null
          description_gold?: string | null
          description_hof?: string | null
          id?: string
          name: string
        }
        Update: {
          abbreviation?: string
          condition_type?: string | null
          created_at?: string
          description_actolytrene?: string | null
          description_base?: string | null
          description_diamond?: string | null
          description_gold?: string | null
          description_hof?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      social_creators: {
        Row: {
          accent_color: string | null
          avatar_url: string | null
          created_at: string
          handle: string
          id: string
          name: string
        }
        Insert: {
          accent_color?: string | null
          avatar_url?: string | null
          created_at?: string
          handle: string
          id?: string
          name: string
        }
        Update: {
          accent_color?: string | null
          avatar_url?: string | null
          created_at?: string
          handle?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      social_posts: {
        Row: {
          comments_count: number
          content: string
          created_at: string
          creator_id: string | null
          id: string
          image_url: string | null
          is_published: boolean
          likes_count: number
          player_card_id: string | null
          post_type: string
          posted_at: string
          scheduled_at: string | null
        }
        Insert: {
          comments_count?: number
          content: string
          created_at?: string
          creator_id?: string | null
          id?: string
          image_url?: string | null
          is_published?: boolean
          likes_count?: number
          player_card_id?: string | null
          post_type?: string
          posted_at?: string
          scheduled_at?: string | null
        }
        Update: {
          comments_count?: number
          content?: string
          created_at?: string
          creator_id?: string | null
          id?: string
          image_url?: string | null
          is_published?: boolean
          likes_count?: number
          player_card_id?: string | null
          post_type?: string
          posted_at?: string
          scheduled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "social_creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_collections: {
        Row: {
          collection_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_collections_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      team_players: {
        Row: {
          created_at: string
          id: string
          player_card_id: string
          slot: number
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_card_id: string
          slot?: number
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          player_card_id?: string
          slot?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_players_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          category: string
          created_at: string
          id: string
          name: string
          unlock_cost: number
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          name: string
          unlock_cost?: number
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          name?: string
          unlock_cost?: number
        }
        Relationships: []
      }
      user_collections: {
        Row: {
          acquired_at: string
          evolution_progress: Json | null
          id: string
          is_locked: boolean
          player_card_id: string
          source: string
          user_id: string
        }
        Insert: {
          acquired_at?: string
          evolution_progress?: Json | null
          id?: string
          is_locked?: boolean
          player_card_id: string
          source?: string
          user_id: string
        }
        Update: {
          acquired_at?: string
          evolution_progress?: Json | null
          id?: string
          is_locked?: boolean
          player_card_id?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_collections_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      user_evo_progress: {
        Row: {
          claimed: boolean
          completed: boolean
          completed_at: string | null
          compound_progress: Json
          created_at: string
          current_value: number
          evo_path_id: string
          id: string
          player_card_id: string
          user_id: string
        }
        Insert: {
          claimed?: boolean
          completed?: boolean
          completed_at?: string | null
          compound_progress?: Json
          created_at?: string
          current_value?: number
          evo_path_id: string
          id?: string
          player_card_id: string
          user_id: string
        }
        Update: {
          claimed?: boolean
          completed?: boolean
          completed_at?: string | null
          compound_progress?: Json
          created_at?: string
          current_value?: number
          evo_path_id?: string
          id?: string
          player_card_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_evo_progress_evo_path_id_fkey"
            columns: ["evo_path_id"]
            isOneToOne: false
            referencedRelation: "evo_paths"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_evo_progress_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      user_pack_inventory: {
        Row: {
          created_at: string
          id: string
          pack_id: string
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pack_id: string
          source?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pack_id?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_pack_inventory_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "packs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_rank_claims: {
        Row: {
          claimed_at: string
          id: string
          rank_name: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          id?: string
          rank_name: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          id?: string
          rank_name?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_runs: {
        Row: {
          created_at: string
          current_wins: number
          highest_wins: number
          id: string
          run_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_wins?: number
          highest_wins?: number
          id?: string
          run_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_wins?: number
          highest_wins?: number
          id?: string
          run_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "player"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "player"],
    },
  },
} as const
