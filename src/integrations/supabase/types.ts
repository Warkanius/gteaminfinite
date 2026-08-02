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
      admin_preview_tokens: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          kind: string
          normalized_payload: Json
          payload_hash: string
          token: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          normalized_payload: Json
          payload_hash: string
          token: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          normalized_payload?: Json
          payload_hash?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
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
          archived_at: string | null
          category: string | null
          created_at: string
          description_actolytrene: string | null
          description_base: string | null
          description_diamond: string | null
          description_gold: string | null
          description_hof: string | null
          disabled_at: string | null
          effect_type: string
          ends_at: string | null
          id: string
          metadata: Json | null
          name: string
          publish_at: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          supported_tiers: string[] | null
        }
        Insert: {
          abbreviation: string
          affected_stat?: string | null
          archived_at?: string | null
          category?: string | null
          created_at?: string
          description_actolytrene?: string | null
          description_base?: string | null
          description_diamond?: string | null
          description_gold?: string | null
          description_hof?: string | null
          disabled_at?: string | null
          effect_type?: string
          ends_at?: string | null
          id?: string
          metadata?: Json | null
          name: string
          publish_at?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          supported_tiers?: string[] | null
        }
        Update: {
          abbreviation?: string
          affected_stat?: string | null
          archived_at?: string | null
          category?: string | null
          created_at?: string
          description_actolytrene?: string | null
          description_base?: string | null
          description_diamond?: string | null
          description_gold?: string | null
          description_hof?: string | null
          disabled_at?: string | null
          effect_type?: string
          ends_at?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          publish_at?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          supported_tiers?: string[] | null
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
          archived_at: string | null
          card_reward_id: string | null
          challenge_type: string
          coin_reward: number
          conditions: Json | null
          created_at: string
          description: string | null
          disabled_at: string | null
          ends_at: string | null
          expires_at: string | null
          gem_reward: number
          id: string
          is_repeatable: boolean
          lineup_restrictions: Json | null
          name: string
          opponent_team_id: string | null
          pack_reward: string | null
          prerequisite_id: string | null
          publish_at: string | null
          reward_payload: Json | null
          series_length: number | null
          series_loss_coins: number
          series_win_coins: number
          sort_order: number
          spotlight_group: string | null
          starts_at: string | null
          stat_limit_player_id: string | null
          stat_limit_stat: string | null
          stat_limit_value: number | null
          status: Database["public"]["Enums"]["content_status"]
          win_by_amount: number | null
          win_condition: string
        }
        Insert: {
          archived_at?: string | null
          card_reward_id?: string | null
          challenge_type?: string
          coin_reward?: number
          conditions?: Json | null
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          expires_at?: string | null
          gem_reward?: number
          id?: string
          is_repeatable?: boolean
          lineup_restrictions?: Json | null
          name: string
          opponent_team_id?: string | null
          pack_reward?: string | null
          prerequisite_id?: string | null
          publish_at?: string | null
          reward_payload?: Json | null
          series_length?: number | null
          series_loss_coins?: number
          series_win_coins?: number
          sort_order?: number
          spotlight_group?: string | null
          starts_at?: string | null
          stat_limit_player_id?: string | null
          stat_limit_stat?: string | null
          stat_limit_value?: number | null
          status?: Database["public"]["Enums"]["content_status"]
          win_by_amount?: number | null
          win_condition?: string
        }
        Update: {
          archived_at?: string | null
          card_reward_id?: string | null
          challenge_type?: string
          coin_reward?: number
          conditions?: Json | null
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          expires_at?: string | null
          gem_reward?: number
          id?: string
          is_repeatable?: boolean
          lineup_restrictions?: Json | null
          name?: string
          opponent_team_id?: string | null
          pack_reward?: string | null
          prerequisite_id?: string | null
          publish_at?: string | null
          reward_payload?: Json | null
          series_length?: number | null
          series_loss_coins?: number
          series_win_coins?: number
          sort_order?: number
          spotlight_group?: string | null
          starts_at?: string | null
          stat_limit_player_id?: string | null
          stat_limit_stat?: string | null
          stat_limit_value?: number | null
          status?: Database["public"]["Enums"]["content_status"]
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
      collection_requirements: {
        Row: {
          allowed_evo_stages: number[] | null
          any_evo_stage: boolean
          collection_id: string
          created_at: string
          evolved_counts: boolean
          id: string
          is_reward_card: boolean
          player_card_id: string
          sort_order: number
        }
        Insert: {
          allowed_evo_stages?: number[] | null
          any_evo_stage?: boolean
          collection_id: string
          created_at?: string
          evolved_counts?: boolean
          id?: string
          is_reward_card?: boolean
          player_card_id: string
          sort_order?: number
        }
        Update: {
          allowed_evo_stages?: number[] | null
          any_evo_stage?: boolean
          collection_id?: string
          created_at?: string
          evolved_counts?: boolean
          id?: string
          is_reward_card?: boolean
          player_card_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "collection_requirements_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_requirements_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          allow_multiple_reward_cards: boolean
          archived_at: string | null
          color_primary: string | null
          color_secondary: string | null
          created_at: string
          description: string | null
          disabled_at: string | null
          ends_at: string | null
          evolved_counts: boolean
          gem_tier_id: string | null
          glow_color: string | null
          id: string
          image_url: string | null
          is_repeatable: boolean
          name: string
          prerequisite_collection_id: string | null
          publish_at: string | null
          release_bundle_id: string | null
          reward_card_id: string | null
          reward_coins: number
          reward_gems: number
          reward_pack_id: string | null
          reward_payload: Json | null
          reward_type: string
          sort_order: number
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          allow_multiple_reward_cards?: boolean
          archived_at?: string | null
          color_primary?: string | null
          color_secondary?: string | null
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          evolved_counts?: boolean
          gem_tier_id?: string | null
          glow_color?: string | null
          id?: string
          image_url?: string | null
          is_repeatable?: boolean
          name: string
          prerequisite_collection_id?: string | null
          publish_at?: string | null
          release_bundle_id?: string | null
          reward_card_id?: string | null
          reward_coins?: number
          reward_gems?: number
          reward_pack_id?: string | null
          reward_payload?: Json | null
          reward_type?: string
          sort_order?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          allow_multiple_reward_cards?: boolean
          archived_at?: string | null
          color_primary?: string | null
          color_secondary?: string | null
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          evolved_counts?: boolean
          gem_tier_id?: string | null
          glow_color?: string | null
          id?: string
          image_url?: string | null
          is_repeatable?: boolean
          name?: string
          prerequisite_collection_id?: string | null
          publish_at?: string | null
          release_bundle_id?: string | null
          reward_card_id?: string | null
          reward_coins?: number
          reward_gems?: number
          reward_pack_id?: string | null
          reward_payload?: Json | null
          reward_type?: string
          sort_order?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_gem_tier_id_fkey"
            columns: ["gem_tier_id"]
            isOneToOne: false
            referencedRelation: "gem_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_prerequisite_collection_id_fkey"
            columns: ["prerequisite_collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_release_bundle_id_fkey"
            columns: ["release_bundle_id"]
            isOneToOne: false
            referencedRelation: "release_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_reward_card_id_fkey"
            columns: ["reward_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_reward_pack_id_fkey"
            columns: ["reward_pack_id"]
            isOneToOne: false
            referencedRelation: "packs"
            referencedColumns: ["id"]
          },
        ]
      }
      content_audit_log: {
        Row: {
          after_snapshot: Json | null
          before_snapshot: Json | null
          content_type: string
          created_at: string
          created_ids: Json
          deleted_ids: Json
          id: string
          operation_id: string
          operation_type: string
          payload: Json
          payload_hash: string
          preview_token: string | null
          restored_from: string | null
          scope_id: string | null
          scope_label: string | null
          updated_ids: Json
          user_id: string
          verification: Json | null
          warnings: Json
        }
        Insert: {
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          content_type: string
          created_at?: string
          created_ids?: Json
          deleted_ids?: Json
          id?: string
          operation_id?: string
          operation_type: string
          payload?: Json
          payload_hash: string
          preview_token?: string | null
          restored_from?: string | null
          scope_id?: string | null
          scope_label?: string | null
          updated_ids?: Json
          user_id: string
          verification?: Json | null
          warnings?: Json
        }
        Update: {
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          content_type?: string
          created_at?: string
          created_ids?: Json
          deleted_ids?: Json
          id?: string
          operation_id?: string
          operation_type?: string
          payload?: Json
          payload_hash?: string
          preview_token?: string | null
          restored_from?: string | null
          scope_id?: string | null
          scope_label?: string | null
          updated_ids?: Json
          user_id?: string
          verification?: Json | null
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "content_audit_log_restored_from_fkey"
            columns: ["restored_from"]
            isOneToOne: false
            referencedRelation: "content_audit_log"
            referencedColumns: ["id"]
          },
        ]
      }
      content_reference_registry: {
        Row: {
          column_kind: string
          created_at: string
          id: string
          is_active: boolean
          is_protected: boolean
          label_column: string | null
          parent_column: string | null
          reference_type: string
          source_column: string
          source_table: string
          target_entity_type: string
        }
        Insert: {
          column_kind?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_protected?: boolean
          label_column?: string | null
          parent_column?: string | null
          reference_type: string
          source_column: string
          source_table: string
          target_entity_type: string
        }
        Update: {
          column_kind?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_protected?: boolean
          label_column?: string | null
          parent_column?: string | null
          reference_type?: string
          source_column?: string
          source_table?: string
          target_entity_type?: string
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
          archived_at: string | null
          coin_reward: number
          created_at: string
          difficulty_stars: number
          disabled_at: string | null
          ends_at: string | null
          game_order: number
          id: string
          opponent_name: string
          opponent_team_id: string | null
          pack_reward: string | null
          pack_reward_id: string | null
          publish_at: string | null
          road_id: string
          road_name: string
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
        }
        Insert: {
          archived_at?: string | null
          coin_reward?: number
          created_at?: string
          difficulty_stars?: number
          disabled_at?: string | null
          ends_at?: string | null
          game_order: number
          id?: string
          opponent_name: string
          opponent_team_id?: string | null
          pack_reward?: string | null
          pack_reward_id?: string | null
          publish_at?: string | null
          road_id: string
          road_name: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
        }
        Update: {
          archived_at?: string | null
          coin_reward?: number
          created_at?: string
          difficulty_stars?: number
          disabled_at?: string | null
          ends_at?: string | null
          game_order?: number
          id?: string
          opponent_name?: string
          opponent_team_id?: string | null
          pack_reward?: string | null
          pack_reward_id?: string | null
          publish_at?: string | null
          road_id?: string
          road_name?: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
        }
        Relationships: [
          {
            foreignKeyName: "domination_games_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domination_games_pack_reward_id_fkey"
            columns: ["pack_reward_id"]
            isOneToOne: false
            referencedRelation: "packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domination_games_road_id_fkey"
            columns: ["road_id"]
            isOneToOne: false
            referencedRelation: "domination_roads"
            referencedColumns: ["id"]
          },
        ]
      }
      domination_roads: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          disabled_at: string | null
          ends_at: string | null
          id: string
          is_active: boolean
          name: string
          publish_at: string | null
          slug: string
          sort_order: number
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          publish_at?: string | null
          slug: string
          sort_order?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          publish_at?: string | null
          slug?: string
          sort_order?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: []
      }
      dynamic_duos: {
        Row: {
          archived_at: string | null
          boosts_a: Json
          boosts_b: Json
          created_at: string
          description: string | null
          disabled_at: string | null
          ends_at: string | null
          id: string
          is_active: boolean
          name: string
          player_card_id_a: string
          player_card_id_b: string
          publish_at: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          boosts_a?: Json
          boosts_b?: Json
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          player_card_id_a: string
          player_card_id_b: string
          publish_at?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          boosts_a?: Json
          boosts_b?: Json
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          player_card_id_a?: string
          player_card_id_b?: string
          publish_at?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: []
      }
      evo_objectives: {
        Row: {
          created_at: string
          description: string | null
          evo_path_id: string
          group_key: string
          id: string
          objective_type: string
          scope: string
          sort_order: number
          stat_key: string | null
          target: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          evo_path_id: string
          group_key?: string
          id?: string
          objective_type: string
          scope?: string
          sort_order?: number
          stat_key?: string | null
          target: number
        }
        Update: {
          created_at?: string
          description?: string | null
          evo_path_id?: string
          group_key?: string
          id?: string
          objective_type?: string
          scope?: string
          sort_order?: number
          stat_key?: string | null
          target?: number
        }
        Relationships: [
          {
            foreignKeyName: "evo_objectives_evo_path_id_fkey"
            columns: ["evo_path_id"]
            isOneToOne: false
            referencedRelation: "evo_paths"
            referencedColumns: ["id"]
          },
        ]
      }
      evo_paths: {
        Row: {
          archived_at: string | null
          avatar_url: string | null
          badge_upgrades: Json
          card_animation: string | null
          card_color_primary: string | null
          card_color_secondary: string | null
          card_glow_color: string | null
          challenge_description: string
          challenge_stat: string | null
          challenge_target: number
          challenge_type: string
          compound_challenges: Json
          created_at: string
          disabled_at: string | null
          ends_at: string | null
          evolves_to_card_id: string | null
          final_rating: number | null
          final_stats: Json | null
          from_tier_id: string | null
          id: string
          is_repeatable: boolean
          market_value: number | null
          new_badges: Json
          new_traits: Json
          objective_mode: string
          objectives: Json
          player_card_id: string
          publish_at: string | null
          sort_order: number
          starts_at: string | null
          stat_boosts: Json
          status: Database["public"]["Enums"]["content_status"]
          step_order: number
          tier_progression_override: boolean
          to_tier_id: string | null
          trait_upgrades: Json
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          avatar_url?: string | null
          badge_upgrades?: Json
          card_animation?: string | null
          card_color_primary?: string | null
          card_color_secondary?: string | null
          card_glow_color?: string | null
          challenge_description?: string
          challenge_stat?: string | null
          challenge_target?: number
          challenge_type?: string
          compound_challenges?: Json
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          evolves_to_card_id?: string | null
          final_rating?: number | null
          final_stats?: Json | null
          from_tier_id?: string | null
          id?: string
          is_repeatable?: boolean
          market_value?: number | null
          new_badges?: Json
          new_traits?: Json
          objective_mode?: string
          objectives?: Json
          player_card_id: string
          publish_at?: string | null
          sort_order?: number
          starts_at?: string | null
          stat_boosts?: Json
          status?: Database["public"]["Enums"]["content_status"]
          step_order?: number
          tier_progression_override?: boolean
          to_tier_id?: string | null
          trait_upgrades?: Json
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          avatar_url?: string | null
          badge_upgrades?: Json
          card_animation?: string | null
          card_color_primary?: string | null
          card_color_secondary?: string | null
          card_glow_color?: string | null
          challenge_description?: string
          challenge_stat?: string | null
          challenge_target?: number
          challenge_type?: string
          compound_challenges?: Json
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          evolves_to_card_id?: string | null
          final_rating?: number | null
          final_stats?: Json | null
          from_tier_id?: string | null
          id?: string
          is_repeatable?: boolean
          market_value?: number | null
          new_badges?: Json
          new_traits?: Json
          objective_mode?: string
          objectives?: Json
          player_card_id?: string
          publish_at?: string | null
          sort_order?: number
          starts_at?: string | null
          stat_boosts?: Json
          status?: Database["public"]["Enums"]["content_status"]
          step_order?: number
          tier_progression_override?: boolean
          to_tier_id?: string | null
          trait_upgrades?: Json
          updated_at?: string
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
          archived_at: string | null
          created_at: string
          disabled_at: string | null
          ends_at: string | null
          gem_tier_id: string
          gem_value: number
          id: string
          player_card_id: string
          publish_at: string | null
          sort_order: number
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          gem_tier_id: string
          gem_value?: number
          id?: string
          player_card_id: string
          publish_at?: string | null
          sort_order?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          gem_tier_id?: string
          gem_value?: number
          id?: string
          player_card_id?: string
          publish_at?: string | null
          sort_order?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
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
          archived_at: string | null
          category: string
          cooldown_hours: number
          created_at: string
          description: string | null
          disabled_at: string | null
          ends_at: string | null
          gem_reward: number
          gem_tier_id: string | null
          group_key: string | null
          id: string
          is_active: boolean
          prerequisite_task_id: string | null
          publish_at: string | null
          requirement_amount: number | null
          requirement_type: string | null
          reward_payload: Json | null
          sort_order: number
          starts_at: string | null
          stat_key: string | null
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          category?: string
          cooldown_hours?: number
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          gem_reward?: number
          gem_tier_id?: string | null
          group_key?: string | null
          id?: string
          is_active?: boolean
          prerequisite_task_id?: string | null
          publish_at?: string | null
          requirement_amount?: number | null
          requirement_type?: string | null
          reward_payload?: Json | null
          sort_order?: number
          starts_at?: string | null
          stat_key?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          category?: string
          cooldown_hours?: number
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          gem_reward?: number
          gem_tier_id?: string | null
          group_key?: string | null
          id?: string
          is_active?: boolean
          prerequisite_task_id?: string | null
          publish_at?: string | null
          requirement_amount?: number | null
          requirement_type?: string | null
          reward_payload?: Json | null
          sort_order?: number
          starts_at?: string | null
          stat_key?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gem_tasks_gem_tier_id_fkey"
            columns: ["gem_tier_id"]
            isOneToOne: false
            referencedRelation: "gem_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gem_tasks_prerequisite_task_id_fkey"
            columns: ["prerequisite_task_id"]
            isOneToOne: false
            referencedRelation: "gem_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      gem_tiers: {
        Row: {
          abbreviation: string | null
          archived_at: string | null
          color: string
          disabled_at: string | null
          doubles_modifier: number | null
          ends_at: string | null
          gem_value: number
          glow_color: string | null
          id: string
          market_rules: Json | null
          max_badges: number | null
          max_traits: number | null
          name: string
          publish_at: string | null
          rating_max: number | null
          rating_min: number | null
          roll_modifier: number
          sort_order: number
          stars: number
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
        }
        Insert: {
          abbreviation?: string | null
          archived_at?: string | null
          color: string
          disabled_at?: string | null
          doubles_modifier?: number | null
          ends_at?: string | null
          gem_value?: number
          glow_color?: string | null
          id?: string
          market_rules?: Json | null
          max_badges?: number | null
          max_traits?: number | null
          name: string
          publish_at?: string | null
          rating_max?: number | null
          rating_min?: number | null
          roll_modifier?: number
          sort_order?: number
          stars?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
        }
        Update: {
          abbreviation?: string | null
          archived_at?: string | null
          color?: string
          disabled_at?: string | null
          doubles_modifier?: number | null
          ends_at?: string | null
          gem_value?: number
          glow_color?: string | null
          id?: string
          market_rules?: Json | null
          max_badges?: number | null
          max_traits?: number | null
          name?: string
          publish_at?: string | null
          rating_max?: number | null
          rating_min?: number | null
          roll_modifier?: number
          sort_order?: number
          stars?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
        }
        Relationships: []
      }
      lifecycle_history: {
        Row: {
          changed_by: string | null
          created_at: string
          entity_id: string
          entity_type: string
          from_status: string | null
          id: string
          operation_id: string | null
          to_status: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          from_status?: string | null
          id?: string
          operation_id?: string | null
          to_status: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          from_status?: string | null
          id?: string
          operation_id?: string | null
          to_status?: string
        }
        Relationships: []
      }
      location_accounts: {
        Row: {
          accent_color: string | null
          avatar_url: string | null
          created_at: string
          handle: string
          id: string
          is_active: boolean
          location_type: string
          name: string
          personality: string
          road_name: string | null
          run_id: string | null
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          avatar_url?: string | null
          created_at?: string
          handle: string
          id?: string
          is_active?: boolean
          location_type?: string
          name: string
          personality?: string
          road_name?: string | null
          run_id?: string | null
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          avatar_url?: string | null
          created_at?: string
          handle?: string
          id?: string
          is_active?: boolean
          location_type?: string
          name?: string
          personality?: string
          road_name?: string | null
          run_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_accounts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      location_post_templates: {
        Row: {
          created_at: string
          event_type: string
          id: string
          is_active: boolean
          personality: string
          sort_order: number
          template_text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          is_active?: boolean
          personality: string
          sort_order?: number
          template_text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          is_active?: boolean
          personality?: string
          sort_order?: number
          template_text?: string
          updated_at?: string
        }
        Relationships: []
      }
      location_records: {
        Row: {
          biggest_blowout: number
          created_at: string
          current_streak: number
          games_played: number
          high_score: number
          id: string
          last_played_at: string | null
          location_account_id: string
          longest_win_streak: number
          losses: number
          updated_at: string
          user_id: string
          wins: number
        }
        Insert: {
          biggest_blowout?: number
          created_at?: string
          current_streak?: number
          games_played?: number
          high_score?: number
          id?: string
          last_played_at?: string | null
          location_account_id: string
          longest_win_streak?: number
          losses?: number
          updated_at?: string
          user_id: string
          wins?: number
        }
        Update: {
          biggest_blowout?: number
          created_at?: string
          current_streak?: number
          games_played?: number
          high_score?: number
          id?: string
          last_played_at?: string | null
          location_account_id?: string
          longest_win_streak?: number
          losses?: number
          updated_at?: string
          user_id?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "location_records_location_account_id_fkey"
            columns: ["location_account_id"]
            isOneToOne: false
            referencedRelation: "location_accounts"
            referencedColumns: ["id"]
          },
        ]
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
          archived_at: string | null
          code: string
          created_at: string
          disabled_at: string | null
          ends_at: string | null
          expires_at: string | null
          id: string
          max_redemptions: number | null
          publish_at: string | null
          reward_payload: Json | null
          reward_type: string
          reward_value: Json
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
        }
        Insert: {
          archived_at?: string | null
          code: string
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          expires_at?: string | null
          id?: string
          max_redemptions?: number | null
          publish_at?: string | null
          reward_payload?: Json | null
          reward_type?: string
          reward_value?: Json
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
        }
        Update: {
          archived_at?: string | null
          code?: string
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          expires_at?: string | null
          id?: string
          max_redemptions?: number | null
          publish_at?: string | null
          reward_payload?: Json | null
          reward_type?: string
          reward_value?: Json
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
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
      oauth_bridge_sessions: {
        Row: {
          auth_code: string | null
          client_redirect_uri: string
          code_verifier: string
          created_at: string
          id: string
          state: string
        }
        Insert: {
          auth_code?: string | null
          client_redirect_uri: string
          code_verifier: string
          created_at?: string
          id?: string
          state: string
        }
        Update: {
          auth_code?: string | null
          client_redirect_uri?: string
          code_verifier?: string
          created_at?: string
          id?: string
          state?: string
        }
        Relationships: []
      }
      pack_odds: {
        Row: {
          conditional_rules: Json | null
          description: string | null
          dice_roll: string | null
          gem_tier_id: string | null
          id: string
          pack_id: string | null
          pack_type: string
          percentage: number
          result_slot: string
          slot_number: number | null
        }
        Insert: {
          conditional_rules?: Json | null
          description?: string | null
          dice_roll?: string | null
          gem_tier_id?: string | null
          id?: string
          pack_id?: string | null
          pack_type: string
          percentage?: number
          result_slot: string
          slot_number?: number | null
        }
        Update: {
          conditional_rules?: Json | null
          description?: string | null
          dice_roll?: string | null
          gem_tier_id?: string | null
          id?: string
          pack_id?: string | null
          pack_type?: string
          percentage?: number
          result_slot?: string
          slot_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pack_odds_gem_tier_id_fkey"
            columns: ["gem_tier_id"]
            isOneToOne: false
            referencedRelation: "gem_tiers"
            referencedColumns: ["id"]
          },
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
          archived_at: string | null
          box_topper: Json | null
          collection_id: string | null
          cost: number
          created_at: string
          description: string | null
          disabled_at: string | null
          duplicate_protection: boolean
          ends_at: string | null
          featured_card_ids: string[] | null
          guaranteed_tier_ids: string[] | null
          id: string
          image_url: string | null
          is_choice_pack: boolean
          name: string
          open_animation: string | null
          pack_size: number | null
          pack_type: string
          per_user_limit: number | null
          pity_reward: Json | null
          pity_threshold: number | null
          publish_at: string | null
          purchase_limit: number | null
          release_bundle_id: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          ten_box_cost: number | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          box_topper?: Json | null
          collection_id?: string | null
          cost?: number
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          duplicate_protection?: boolean
          ends_at?: string | null
          featured_card_ids?: string[] | null
          guaranteed_tier_ids?: string[] | null
          id?: string
          image_url?: string | null
          is_choice_pack?: boolean
          name: string
          open_animation?: string | null
          pack_size?: number | null
          pack_type?: string
          per_user_limit?: number | null
          pity_reward?: Json | null
          pity_threshold?: number | null
          publish_at?: string | null
          purchase_limit?: number | null
          release_bundle_id?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          ten_box_cost?: number | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          box_topper?: Json | null
          collection_id?: string | null
          cost?: number
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          duplicate_protection?: boolean
          ends_at?: string | null
          featured_card_ids?: string[] | null
          guaranteed_tier_ids?: string[] | null
          id?: string
          image_url?: string | null
          is_choice_pack?: boolean
          name?: string
          open_animation?: string | null
          pack_size?: number | null
          pack_type?: string
          per_user_limit?: number | null
          pity_reward?: Json | null
          pity_threshold?: number | null
          publish_at?: string | null
          purchase_limit?: number | null
          release_bundle_id?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          ten_box_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packs_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packs_release_bundle_id_fkey"
            columns: ["release_bundle_id"]
            isOneToOne: false
            referencedRelation: "release_bundles"
            referencedColumns: ["id"]
          },
        ]
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
          archived_at: string | null
          avatar_url: string | null
          base_card_id: string | null
          card_animation: string | null
          card_color_primary: string | null
          card_color_secondary: string | null
          card_glow_color: string | null
          card_key: string
          card_variant: string | null
          collection_id: string | null
          created_at: string
          disabled_at: string | null
          ends_at: string | null
          evo_stage: number
          gem_name: string | null
          gem_tier_id: string | null
          id: string
          is_collection_reward: boolean
          market_value: number
          name: string
          position1: string | null
          position2: string | null
          publish_at: string | null
          rating: number
          release_bundle_id: string | null
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
          starts_at: string | null
          stat_3pt: number
          stat_ast: number
          stat_blk: number
          stat_dnk: number
          stat_fin: number
          stat_int: number
          stat_mid: number
          stat_reb: number
          stat_stl: number
          status: Database["public"]["Enums"]["content_status"]
          sub_collection_id: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          avatar_url?: string | null
          base_card_id?: string | null
          card_animation?: string | null
          card_color_primary?: string | null
          card_color_secondary?: string | null
          card_glow_color?: string | null
          card_key?: string
          card_variant?: string | null
          collection_id?: string | null
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          evo_stage?: number
          gem_name?: string | null
          gem_tier_id?: string | null
          id?: string
          is_collection_reward?: boolean
          market_value?: number
          name: string
          position1?: string | null
          position2?: string | null
          publish_at?: string | null
          rating?: number
          release_bundle_id?: string | null
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
          starts_at?: string | null
          stat_3pt?: number
          stat_ast?: number
          stat_blk?: number
          stat_dnk?: number
          stat_fin?: number
          stat_int?: number
          stat_mid?: number
          stat_reb?: number
          stat_stl?: number
          status?: Database["public"]["Enums"]["content_status"]
          sub_collection_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          avatar_url?: string | null
          base_card_id?: string | null
          card_animation?: string | null
          card_color_primary?: string | null
          card_color_secondary?: string | null
          card_glow_color?: string | null
          card_key?: string
          card_variant?: string | null
          collection_id?: string | null
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          evo_stage?: number
          gem_name?: string | null
          gem_tier_id?: string | null
          id?: string
          is_collection_reward?: boolean
          market_value?: number
          name?: string
          position1?: string | null
          position2?: string | null
          publish_at?: string | null
          rating?: number
          release_bundle_id?: string | null
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
          starts_at?: string | null
          stat_3pt?: number
          stat_ast?: number
          stat_blk?: number
          stat_dnk?: number
          stat_fin?: number
          stat_int?: number
          stat_mid?: number
          stat_reb?: number
          stat_stl?: number
          status?: Database["public"]["Enums"]["content_status"]
          sub_collection_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_cards_base_card_id_fkey"
            columns: ["base_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "player_cards_release_bundle_id_fkey"
            columns: ["release_bundle_id"]
            isOneToOne: false
            referencedRelation: "release_bundles"
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
      release_bundle_entities: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          release_bundle_id: string
          role: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          release_bundle_id: string
          role?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          release_bundle_id?: string
          role?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "release_bundle_entities_release_bundle_id_fkey"
            columns: ["release_bundle_id"]
            isOneToOne: false
            referencedRelation: "release_bundles"
            referencedColumns: ["id"]
          },
        ]
      }
      release_bundles: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          disabled_at: string | null
          ends_at: string | null
          id: string
          name: string
          notes: string | null
          publish_at: string | null
          slug: string
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          name: string
          notes?: string | null
          publish_at?: string | null
          slug: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          publish_at?: string | null
          slug?: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: []
      }
      reward_grants: {
        Row: {
          coins: number
          created_at: string
          gems: number
          grant_key: string
          id: string
          user_id: string
        }
        Insert: {
          coins?: number
          created_at?: string
          gems?: number
          grant_key: string
          id?: string
          user_id: string
        }
        Update: {
          coins?: number
          created_at?: string
          gems?: number
          grant_key?: string
          id?: string
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
      rule_config_versions: {
        Row: {
          activate_at: string | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          environment: string
          id: string
          is_active: boolean
          key: string
          value: Json
          version: number
        }
        Insert: {
          activate_at?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          environment?: string
          id?: string
          is_active?: boolean
          key: string
          value: Json
          version?: number
        }
        Update: {
          activate_at?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          environment?: string
          id?: string
          is_active?: boolean
          key?: string
          value?: Json
          version?: number
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
          archived_at: string | null
          created_at: string
          disabled_at: string | null
          ends_at: string | null
          id: string
          milestones: Json
          name: string
          publish_at: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          target_score: number
          team_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          milestones?: Json
          name: string
          publish_at?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          target_score?: number
          team_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          milestones?: Json
          name?: string
          publish_at?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
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
          archived_at: string | null
          category: string | null
          condition_type: string | null
          created_at: string
          description_actolytrene: string | null
          description_base: string | null
          description_diamond: string | null
          description_gold: string | null
          description_hof: string | null
          disabled_at: string | null
          ends_at: string | null
          id: string
          metadata: Json | null
          name: string
          publish_at: string | null
          requires_target_stat: boolean
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          supported_target_stats: string[] | null
          supported_tiers: string[] | null
        }
        Insert: {
          abbreviation: string
          archived_at?: string | null
          category?: string | null
          condition_type?: string | null
          created_at?: string
          description_actolytrene?: string | null
          description_base?: string | null
          description_diamond?: string | null
          description_gold?: string | null
          description_hof?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          metadata?: Json | null
          name: string
          publish_at?: string | null
          requires_target_stat?: boolean
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          supported_target_stats?: string[] | null
          supported_tiers?: string[] | null
        }
        Update: {
          abbreviation?: string
          archived_at?: string | null
          category?: string | null
          condition_type?: string | null
          created_at?: string
          description_actolytrene?: string | null
          description_base?: string | null
          description_diamond?: string | null
          description_gold?: string | null
          description_hof?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          publish_at?: string | null
          requires_target_stat?: boolean
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          supported_target_stats?: string[] | null
          supported_tiers?: string[] | null
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
          archived_at: string | null
          comments_count: number
          content: string
          created_at: string
          creator_id: string | null
          disabled_at: string | null
          ends_at: string | null
          event_type: string | null
          headline_image_url: string | null
          headline_rank: number | null
          id: string
          image_url: string | null
          is_headline: boolean
          is_published: boolean
          likes_count: number
          location_account_id: string | null
          player_card_id: string | null
          post_type: string
          posted_at: string
          publish_at: string | null
          scheduled_at: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
        }
        Insert: {
          archived_at?: string | null
          comments_count?: number
          content: string
          created_at?: string
          creator_id?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          event_type?: string | null
          headline_image_url?: string | null
          headline_rank?: number | null
          id?: string
          image_url?: string | null
          is_headline?: boolean
          is_published?: boolean
          likes_count?: number
          location_account_id?: string | null
          player_card_id?: string | null
          post_type?: string
          posted_at?: string
          publish_at?: string | null
          scheduled_at?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
        }
        Update: {
          archived_at?: string | null
          comments_count?: number
          content?: string
          created_at?: string
          creator_id?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          event_type?: string | null
          headline_image_url?: string | null
          headline_rank?: number | null
          id?: string
          image_url?: string | null
          is_headline?: boolean
          is_published?: boolean
          likes_count?: number
          location_account_id?: string | null
          player_card_id?: string | null
          post_type?: string
          posted_at?: string
          publish_at?: string | null
          scheduled_at?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
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
            foreignKeyName: "social_posts_location_account_id_fkey"
            columns: ["location_account_id"]
            isOneToOne: false
            referencedRelation: "location_accounts"
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
      storyline_entities: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          note: string | null
          storyline_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          note?: string | null
          storyline_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          note?: string | null
          storyline_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storyline_entities_storyline_id_fkey"
            columns: ["storyline_id"]
            isOneToOne: false
            referencedRelation: "storylines"
            referencedColumns: ["id"]
          },
        ]
      }
      storylines: {
        Row: {
          arc_image_url: string | null
          archived_at: string | null
          created_at: string
          disabled_at: string | null
          ends_at: string | null
          id: string
          publish_at: string | null
          starts_at: string | null
          status: string
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          arc_image_url?: string | null
          archived_at?: string | null
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          publish_at?: string | null
          starts_at?: string | null
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          arc_image_url?: string | null
          archived_at?: string | null
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          publish_at?: string | null
          starts_at?: string | null
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      sub_collection_requirements: {
        Row: {
          allowed_evo_stages: number[] | null
          any_evo_stage: boolean
          created_at: string
          evolved_counts: boolean
          id: string
          is_reward_card: boolean
          player_card_id: string
          sort_order: number
          sub_collection_id: string
        }
        Insert: {
          allowed_evo_stages?: number[] | null
          any_evo_stage?: boolean
          created_at?: string
          evolved_counts?: boolean
          id?: string
          is_reward_card?: boolean
          player_card_id: string
          sort_order?: number
          sub_collection_id: string
        }
        Update: {
          allowed_evo_stages?: number[] | null
          any_evo_stage?: boolean
          created_at?: string
          evolved_counts?: boolean
          id?: string
          is_reward_card?: boolean
          player_card_id?: string
          sort_order?: number
          sub_collection_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_collection_requirements_player_card_id_fkey"
            columns: ["player_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_collection_requirements_sub_collection_id_fkey"
            columns: ["sub_collection_id"]
            isOneToOne: false
            referencedRelation: "sub_collections"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_collections: {
        Row: {
          archived_at: string | null
          collection_id: string
          color_primary: string | null
          color_secondary: string | null
          created_at: string
          description: string | null
          disabled_at: string | null
          ends_at: string | null
          glow_color: string | null
          id: string
          image_url: string | null
          is_repeatable: boolean
          name: string
          publish_at: string | null
          reward_card_id: string | null
          reward_coins: number
          reward_gems: number
          reward_pack_id: string | null
          reward_payload: Json | null
          reward_type: string
          sort_order: number
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          collection_id: string
          color_primary?: string | null
          color_secondary?: string | null
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          glow_color?: string | null
          id?: string
          image_url?: string | null
          is_repeatable?: boolean
          name: string
          publish_at?: string | null
          reward_card_id?: string | null
          reward_coins?: number
          reward_gems?: number
          reward_pack_id?: string | null
          reward_payload?: Json | null
          reward_type?: string
          sort_order?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          collection_id?: string
          color_primary?: string | null
          color_secondary?: string | null
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          ends_at?: string | null
          glow_color?: string | null
          id?: string
          image_url?: string | null
          is_repeatable?: boolean
          name?: string
          publish_at?: string | null
          reward_card_id?: string | null
          reward_coins?: number
          reward_gems?: number
          reward_pack_id?: string | null
          reward_payload?: Json | null
          reward_type?: string
          sort_order?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_collections_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_collections_reward_card_id_fkey"
            columns: ["reward_card_id"]
            isOneToOne: false
            referencedRelation: "player_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_collections_reward_pack_id_fkey"
            columns: ["reward_pack_id"]
            isOneToOne: false
            referencedRelation: "packs"
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
          archived_at: string | null
          category: string
          created_at: string
          disabled_at: string | null
          ends_at: string | null
          id: string
          name: string
          publish_at: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          unlock_cost: number
        }
        Insert: {
          archived_at?: string | null
          category?: string
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          name: string
          publish_at?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          unlock_cost?: number
        }
        Update: {
          archived_at?: string | null
          category?: string
          created_at?: string
          disabled_at?: string | null
          ends_at?: string | null
          id?: string
          name?: string
          publish_at?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          unlock_cost?: number
        }
        Relationships: []
      }
      user_collection_claims: {
        Row: {
          claimed_at: string
          collection_id: string | null
          id: string
          reward_type: string
          sub_collection_id: string | null
          user_id: string
        }
        Insert: {
          claimed_at?: string
          collection_id?: string | null
          id?: string
          reward_type: string
          sub_collection_id?: string | null
          user_id: string
        }
        Update: {
          claimed_at?: string
          collection_id?: string | null
          id?: string
          reward_type?: string
          sub_collection_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_collection_claims_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_collection_claims_sub_collection_id_fkey"
            columns: ["sub_collection_id"]
            isOneToOne: false
            referencedRelation: "sub_collections"
            referencedColumns: ["id"]
          },
        ]
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
      user_rttr_progress: {
        Row: {
          created_at: string
          domination_game_id: string
          id: string
          road_name: string
          updated_at: string
          user_id: string
          wins: number
        }
        Insert: {
          created_at?: string
          domination_game_id: string
          id?: string
          road_name: string
          updated_at?: string
          user_id: string
          wins?: number
        }
        Update: {
          created_at?: string
          domination_game_id?: string
          id?: string
          road_name?: string
          updated_at?: string
          user_id?: string
          wins?: number
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
      admin_apply_batch: {
        Args: {
          p_commit?: boolean
          p_kind?: string
          p_payload: Json
          p_preview_token?: string
        }
        Returns: Json
      }
      admin_apply_content: {
        Args: { p_commit?: boolean; p_kind: string; p_payload: Json }
        Returns: Json
      }
      admin_apply_entity: {
        Args: { p_commit?: boolean; p_item: Json; p_kind: string }
        Returns: Json
      }
      admin_apply_evo: {
        Args: { p_commit?: boolean; p_item: Json }
        Returns: Json
      }
      admin_apply_extra: {
        Args: { p_commit?: boolean; p_kind: string; p_payload: Json }
        Returns: Json
      }
      admin_apply_extra_legacy: {
        Args: { p_commit?: boolean; p_kind: string; p_payload: Json }
        Returns: Json
      }
      admin_apply_player: {
        Args: { p_commit?: boolean; p_payload: Json }
        Returns: Json
      }
      admin_audit_write: {
        Args: {
          p_after: Json
          p_before: Json
          p_content_type: string
          p_created: Json
          p_deleted: Json
          p_operation_type: string
          p_payload: Json
          p_restored_from?: string
          p_scope_id: string
          p_scope_label: string
          p_token: string
          p_updated: Json
          p_verification: Json
          p_warnings: Json
        }
        Returns: string
      }
      admin_canonical_hash: { Args: { p: Json }; Returns: string }
      admin_canonical_json: { Args: { p: Json }; Returns: Json }
      admin_col_type: {
        Args: { p_column: string; p_table: string }
        Returns: string
      }
      admin_consume_preview_token: {
        Args: {
          p_fingerprint: string
          p_kind: string
          p_payload: Json
          p_token: string
        }
        Returns: Json
      }
      admin_content_restore_payload: {
        Args: { p_audit_id: string }
        Returns: Json
      }
      admin_delete_domination_game: {
        Args: { p_commit?: boolean; p_payload: Json; p_preview_token?: string }
        Returns: Json
      }
      admin_delete_entity: {
        Args: {
          p_commit?: boolean
          p_entity_id: string
          p_entity_type: string
          p_force?: boolean
        }
        Returns: Json
      }
      admin_diff_fields: {
        Args: { p_fields: Json; p_id: string; p_table: string }
        Returns: Json
      }
      admin_duplicate_player_names: { Args: never; Returns: Json }
      admin_entity_lookup: {
        Args: { p_name: string; p_name_column: string; p_table: string }
        Returns: Json
      }
      admin_entity_meta: { Args: { p_type: string }; Returns: Json }
      admin_error: {
        Args: { p_code: string; p_extra?: Json; p_message: string }
        Returns: undefined
      }
      admin_has_column: {
        Args: { p_column: string; p_table: string }
        Returns: boolean
      }
      admin_install_lifecycle: { Args: { p_table: string }; Returns: undefined }
      admin_issue_preview_token: {
        Args: { p_fingerprint: string; p_kind: string; p_payload: Json }
        Returns: string
      }
      admin_lifecycle_apply: {
        Args: {
          p_commit?: boolean
          p_dates?: Json
          p_entity_id: string
          p_entity_type: string
          p_override?: boolean
          p_status: string
        }
        Returns: Json
      }
      admin_player_matches: { Args: { p_name: string }; Returns: Json }
      admin_player_usage: { Args: { p_card_id: string }; Returns: Json }
      admin_rename_apply: {
        Args: {
          p_commit?: boolean
          p_entity_id: string
          p_entity_type: string
          p_new_key?: string
          p_new_name: string
        }
        Returns: Json
      }
      admin_rename_domination_opponent: {
        Args: {
          p_commit?: boolean
          p_game_id: string
          p_game_order: number
          p_new_name: string
          p_road_id: string
        }
        Returns: Json
      }
      admin_require_admin: { Args: never; Returns: undefined }
      admin_resolve_card: { Args: { p_ref: Json }; Returns: string }
      admin_resolve_pack: {
        Args: { p_game_order?: number; p_ref: Json }
        Returns: string
      }
      admin_resolve_player: { Args: { p_ref: Json }; Returns: string }
      admin_resolve_player_ids: { Args: { p_names: Json }; Returns: string[] }
      admin_reward_validate: { Args: { p_payload: Json }; Returns: Json }
      admin_road_bulk: {
        Args: { p_commit?: boolean; p_payload: Json; p_preview_token?: string }
        Returns: Json
      }
      admin_road_delete: {
        Args: { p_commit?: boolean; p_payload: Json; p_preview_token?: string }
        Returns: Json
      }
      admin_road_export: { Args: { p_ref: Json }; Returns: Json }
      admin_road_fingerprint: { Args: { p_road_id: string }; Returns: string }
      admin_road_outside_fingerprint: {
        Args: { p_road_id: string }
        Returns: string
      }
      admin_road_raise: {
        Args: {
          p_code: string
          p_extra?: Json
          p_field?: string
          p_game_order?: number
          p_message: string
          p_value?: string
        }
        Returns: undefined
      }
      admin_slugify: { Args: { p_text: string }; Returns: string }
      admin_stat_keys: { Args: never; Returns: string[] }
      admin_substitute_refs: {
        Args: { p_item: Json; p_refs: Json }
        Returns: Json
      }
      admin_unused_players: { Args: { p_by_name?: boolean }; Returns: Json }
      admin_upsert_row: {
        Args: {
          p_action?: string
          p_commit: boolean
          p_fields: Json
          p_id: string
          p_match: string
          p_table: string
        }
        Returns: Json
      }
      admin_usage: {
        Args: { p_entity_id: string; p_entity_type: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      sync_gem_tier_collection: { Args: { p_tier_id: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "player"
      content_status: "draft" | "scheduled" | "active" | "disabled" | "archived"
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
      content_status: ["draft", "scheduled", "active", "disabled", "archived"],
    },
  },
} as const
