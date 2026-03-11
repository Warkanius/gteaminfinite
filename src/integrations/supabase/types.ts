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
      challenges: {
        Row: {
          challenge_type: string
          coin_reward: number
          conditions: Json | null
          created_at: string
          description: string | null
          gem_reward: number
          id: string
          name: string
        }
        Insert: {
          challenge_type?: string
          coin_reward?: number
          conditions?: Json | null
          created_at?: string
          description?: string | null
          gem_reward?: number
          id?: string
          name: string
        }
        Update: {
          challenge_type?: string
          coin_reward?: number
          conditions?: Json | null
          created_at?: string
          description?: string | null
          gem_reward?: number
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
      game_logs: {
        Row: {
          cpu_score: number
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
          id?: string
          mode?: string
          opponent_name?: string | null
          played_at?: string
          player_stats?: Json | null
          user_id?: string
          user_score?: number
          won?: boolean
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
      pack_odds: {
        Row: {
          description: string | null
          dice_roll: string
          id: string
          pack_type: string
          result_slot: string
        }
        Insert: {
          description?: string | null
          dice_roll: string
          id?: string
          pack_type: string
          result_slot: string
        }
        Update: {
          description?: string | null
          dice_roll?: string
          id?: string
          pack_type?: string
          result_slot?: string
        }
        Relationships: []
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
          card_animation: string | null
          card_color_primary: string | null
          card_color_secondary: string | null
          card_glow_color: string | null
          created_at: string
          gem_name: string | null
          gem_tier_id: string | null
          id: string
          is_collection_reward: boolean
          name: string
          position1: string | null
          position2: string | null
          rating: number
          stat_3pt: number
          stat_ast: number
          stat_blk: number
          stat_dnk: number
          stat_fin: number
          stat_int: number
          stat_mid: number
          stat_reb: number
          stat_stl: number
          team_id: string | null
          updated_at: string
        }
        Insert: {
          card_animation?: string | null
          card_color_primary?: string | null
          card_color_secondary?: string | null
          card_glow_color?: string | null
          created_at?: string
          gem_name?: string | null
          gem_tier_id?: string | null
          id?: string
          is_collection_reward?: boolean
          name: string
          position1?: string | null
          position2?: string | null
          rating?: number
          stat_3pt?: number
          stat_ast?: number
          stat_blk?: number
          stat_dnk?: number
          stat_fin?: number
          stat_int?: number
          stat_mid?: number
          stat_reb?: number
          stat_stl?: number
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          card_animation?: string | null
          card_color_primary?: string | null
          card_color_secondary?: string | null
          card_glow_color?: string | null
          created_at?: string
          gem_name?: string | null
          gem_tier_id?: string | null
          id?: string
          is_collection_reward?: boolean
          name?: string
          position1?: string | null
          position2?: string | null
          rating?: number
          stat_3pt?: number
          stat_ast?: number
          stat_blk?: number
          stat_dnk?: number
          stat_fin?: number
          stat_int?: number
          stat_mid?: number
          stat_reb?: number
          stat_stl?: number
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_cards_gem_tier_id_fkey"
            columns: ["gem_tier_id"]
            isOneToOne: false
            referencedRelation: "gem_tiers"
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
          updated_at?: string
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
          player_card_id: string
          user_id: string
        }
        Insert: {
          acquired_at?: string
          evolution_progress?: Json | null
          id?: string
          player_card_id: string
          user_id: string
        }
        Update: {
          acquired_at?: string
          evolution_progress?: Json | null
          id?: string
          player_card_id?: string
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
