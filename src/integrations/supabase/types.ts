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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          kind: string
          plan_id: string | null
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          kind?: string
          plan_id?: string | null
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          kind?: string
          plan_id?: string | null
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          attached_document_ids: string[]
          auto_approve_plans: boolean
          capabilities: Json
          created_at: string
          id: string
          last_assistant_at: string | null
          last_read_at: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attached_document_ids?: string[]
          auto_approve_plans?: boolean
          capabilities?: Json
          created_at?: string
          id?: string
          last_assistant_at?: string | null
          last_read_at?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attached_document_ids?: string[]
          auto_approve_plans?: boolean
          capabilities?: Json
          created_at?: string
          id?: string
          last_assistant_at?: string | null
          last_read_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_turns: {
        Row: {
          attempts: number
          claim_at: string | null
          created_at: string
          error: string | null
          id: string
          payload: Json
          status: string
          thread_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          claim_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          status?: string
          thread_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          claim_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          status?: string
          thread_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_turns_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      document_icons: {
        Row: {
          created_at: string
          document_id: string
          media_asset_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          media_asset_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          media_asset_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_icons_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_icons_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          current_sentence_index: number
          id: string
          position: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_sentence_index?: number
          id?: string
          position?: number
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_sentence_index?: number
          id?: string
          position?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_commands: {
        Row: {
          arguments: Json
          connection_id: string
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          result: Json | null
          started_at: string | null
          status: string
          tool_name: string
          user_id: string
        }
        Insert: {
          arguments?: Json
          connection_id: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          result?: Json | null
          started_at?: string | null
          status?: string
          tool_name: string
          user_id: string
        }
        Update: {
          arguments?: Json
          connection_id?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          result?: Json | null
          started_at?: string | null
          status?: string
          tool_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_commands_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "mcp_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_connections: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string | null
          pairing_code: string | null
          pairing_expires_at: string | null
          provider: string
          server_info: Json
          status: string
          token_hash: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string | null
          pairing_code?: string | null
          pairing_expires_at?: string | null
          provider: string
          server_info?: Json
          status?: string
          token_hash?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string | null
          pairing_code?: string | null
          pairing_expires_at?: string | null
          provider?: string
          server_info?: Json
          status?: string
          token_hash?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          created_at: string
          duration_seconds: number | null
          error_message: string | null
          fal_model_id: string | null
          fal_request_id: string | null
          fal_response_url: string | null
          fal_status_url: string | null
          generation_params: Json | null
          height: number | null
          id: string
          kind: string
          mime_type: string | null
          seen_at: string | null
          size_bytes: number | null
          source_document_id: string | null
          status: string | null
          storage_path: string | null
          title: string
          updated_at: string
          url: string | null
          user_id: string
          width: number | null
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          fal_model_id?: string | null
          fal_request_id?: string | null
          fal_response_url?: string | null
          fal_status_url?: string | null
          generation_params?: Json | null
          height?: number | null
          id?: string
          kind: string
          mime_type?: string | null
          seen_at?: string | null
          size_bytes?: number | null
          source_document_id?: string | null
          status?: string | null
          storage_path?: string | null
          title?: string
          updated_at?: string
          url?: string | null
          user_id: string
          width?: number | null
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          fal_model_id?: string | null
          fal_request_id?: string | null
          fal_response_url?: string | null
          fal_status_url?: string | null
          generation_params?: Json | null
          height?: number | null
          id?: string
          kind?: string
          mime_type?: string | null
          seen_at?: string | null
          size_bytes?: number | null
          source_document_id?: string | null
          status?: string | null
          storage_path?: string | null
          title?: string
          updated_at?: string
          url?: string | null
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      media_folder_items: {
        Row: {
          asset_id: string
          created_at: string
          folder_id: string
          id: string
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          folder_id: string
          id?: string
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          folder_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_folder_items_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_folder_items_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      media_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_index: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_index?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_index?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      plan_schedules: {
        Row: {
          attached_document_ids: string[]
          cadence: string
          capabilities: Json
          claim_at: string | null
          created_at: string
          enabled: boolean
          ends_at: string | null
          id: string
          image_urls: string[]
          interval_n: number
          last_plan_id: string | null
          last_run_at: string | null
          max_runs: number | null
          month_days: number[]
          next_run_at: string | null
          run_count: number
          starts_at: string | null
          thread_id: string | null
          time_of_day: string | null
          timezone: string
          title: string
          updated_at: string
          user_id: string
          user_request: string
          weekdays: number[]
          year_month_days: Json
        }
        Insert: {
          attached_document_ids?: string[]
          cadence: string
          capabilities?: Json
          claim_at?: string | null
          created_at?: string
          enabled?: boolean
          ends_at?: string | null
          id?: string
          image_urls?: string[]
          interval_n?: number
          last_plan_id?: string | null
          last_run_at?: string | null
          max_runs?: number | null
          month_days?: number[]
          next_run_at?: string | null
          run_count?: number
          starts_at?: string | null
          thread_id?: string | null
          time_of_day?: string | null
          timezone?: string
          title?: string
          updated_at?: string
          user_id: string
          user_request: string
          weekdays?: number[]
          year_month_days?: Json
        }
        Update: {
          attached_document_ids?: string[]
          cadence?: string
          capabilities?: Json
          claim_at?: string | null
          created_at?: string
          enabled?: boolean
          ends_at?: string | null
          id?: string
          image_urls?: string[]
          interval_n?: number
          last_plan_id?: string | null
          last_run_at?: string | null
          max_runs?: number | null
          month_days?: number[]
          next_run_at?: string | null
          run_count?: number
          starts_at?: string | null
          thread_id?: string | null
          time_of_day?: string | null
          timezone?: string
          title?: string
          updated_at?: string
          user_id?: string
          user_request?: string
          weekdays?: number[]
          year_month_days?: Json
        }
        Relationships: [
          {
            foreignKeyName: "plan_schedules_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          acknowledged: boolean
          approved_at: string | null
          attached_document_ids: string[]
          auto_approve_after_compose: boolean
          awaiting_count: number
          awaiting_since: string | null
          completed_at: string | null
          compose_attempts: number
          compose_claim_at: string | null
          consecutive_no_progress: number
          created_at: string
          current_step: number
          error_lovable_prompt: string | null
          error_message: string | null
          id: string
          origin_document_id: string | null
          origin_sentence_index: number | null
          plan_summary: string | null
          proposed_capabilities: Json
          result_summary: string | null
          retry_count: number
          retry_note: string | null
          review_in_chat: boolean
          schedule_id: string | null
          scheduled_for: string | null
          status: string
          step_claim_at: string | null
          steps: Json | null
          thread_id: string | null
          tick_count: number
          total_steps: number
          updated_at: string
          user_id: string
          user_request: string
          watchdog_at: string | null
        }
        Insert: {
          acknowledged?: boolean
          approved_at?: string | null
          attached_document_ids?: string[]
          auto_approve_after_compose?: boolean
          awaiting_count?: number
          awaiting_since?: string | null
          completed_at?: string | null
          compose_attempts?: number
          compose_claim_at?: string | null
          consecutive_no_progress?: number
          created_at?: string
          current_step?: number
          error_lovable_prompt?: string | null
          error_message?: string | null
          id?: string
          origin_document_id?: string | null
          origin_sentence_index?: number | null
          plan_summary?: string | null
          proposed_capabilities?: Json
          result_summary?: string | null
          retry_count?: number
          retry_note?: string | null
          review_in_chat?: boolean
          schedule_id?: string | null
          scheduled_for?: string | null
          status: string
          step_claim_at?: string | null
          steps?: Json | null
          thread_id?: string | null
          tick_count?: number
          total_steps?: number
          updated_at?: string
          user_id: string
          user_request: string
          watchdog_at?: string | null
        }
        Update: {
          acknowledged?: boolean
          approved_at?: string | null
          attached_document_ids?: string[]
          auto_approve_after_compose?: boolean
          awaiting_count?: number
          awaiting_since?: string | null
          completed_at?: string | null
          compose_attempts?: number
          compose_claim_at?: string | null
          consecutive_no_progress?: number
          created_at?: string
          current_step?: number
          error_lovable_prompt?: string | null
          error_message?: string | null
          id?: string
          origin_document_id?: string | null
          origin_sentence_index?: number | null
          plan_summary?: string | null
          proposed_capabilities?: Json
          result_summary?: string | null
          retry_count?: number
          retry_note?: string | null
          review_in_chat?: boolean
          schedule_id?: string | null
          scheduled_for?: string | null
          status?: string
          step_claim_at?: string | null
          steps?: Json | null
          thread_id?: string | null
          tick_count?: number
          total_steps?: number
          updated_at?: string
          user_id?: string
          user_request?: string
          watchdog_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plans_origin_document_id_fkey"
            columns: ["origin_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      sentences: {
        Row: {
          content: string
          created_at: string
          document_id: string
          id: string
          linked_document_id: string | null
          linked_thread_id: string | null
          order_index: number
          pending_delete: boolean
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          document_id: string
          id?: string
          linked_document_id?: string | null
          linked_thread_id?: string | null
          order_index?: number
          pending_delete?: boolean
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          document_id?: string
          id?: string
          linked_document_id?: string | null
          linked_thread_id?: string | null
          order_index?: number
          pending_delete?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sentences_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentences_linked_document_id_fkey"
            columns: ["linked_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentences_linked_thread_id_fkey"
            columns: ["linked_thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          auto_attach_document_ids: string[]
          auto_open_linked_chat: boolean
          background_media_asset_id: string | null
          created_at: string
          favorites: Json
          grid_layout: Json
          id: string
          last_favorite_slot: number | null
          lock_favorites: boolean
          locked_document_id: string | null
          muted: boolean
          pinned_document_id: string | null
          tap_mode: string | null
          theme: string
          tts_prefetch: number
          tts_voice: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_attach_document_ids?: string[]
          auto_open_linked_chat?: boolean
          background_media_asset_id?: string | null
          created_at?: string
          favorites?: Json
          grid_layout?: Json
          id?: string
          last_favorite_slot?: number | null
          lock_favorites?: boolean
          locked_document_id?: string | null
          muted?: boolean
          pinned_document_id?: string | null
          tap_mode?: string | null
          theme?: string
          tts_prefetch?: number
          tts_voice?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_attach_document_ids?: string[]
          auto_open_linked_chat?: boolean
          background_media_asset_id?: string | null
          created_at?: string
          favorites?: Json
          grid_layout?: Json
          id?: string
          last_favorite_slot?: number | null
          lock_favorites?: boolean
          locked_document_id?: string | null
          muted?: boolean
          pinned_document_id?: string | null
          tap_mode?: string | null
          theme?: string
          tts_prefetch?: number
          tts_voice?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_background_media_asset_id_fkey"
            columns: ["background_media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      vc_profiles: {
        Row: {
          created_at: string
          id: string
          provider_profile_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          provider_profile_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          provider_profile_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vc_runs: {
        Row: {
          allowed_domains: string[]
          attempts: number
          browser_id: string | null
          cost_usd: number | null
          created_at: string
          deadline_at: string
          error: string | null
          finished_at: string | null
          id: string
          live_view_url: string | null
          phase_text: string | null
          plan_id: string | null
          poll_at: string | null
          provider_run_id: string | null
          result: string | null
          secret_request: Json | null
          session_id: string | null
          start_url: string | null
          started_at: string
          status: string
          step_index: number | null
          task: string
          thread_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed_domains?: string[]
          attempts?: number
          browser_id?: string | null
          cost_usd?: number | null
          created_at?: string
          deadline_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          live_view_url?: string | null
          phase_text?: string | null
          plan_id?: string | null
          poll_at?: string | null
          provider_run_id?: string | null
          result?: string | null
          secret_request?: Json | null
          session_id?: string | null
          start_url?: string | null
          started_at?: string
          status?: string
          step_index?: number | null
          task: string
          thread_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed_domains?: string[]
          attempts?: number
          browser_id?: string | null
          cost_usd?: number | null
          created_at?: string
          deadline_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          live_view_url?: string | null
          phase_text?: string | null
          plan_id?: string | null
          poll_at?: string | null
          provider_run_id?: string | null
          result?: string | null
          secret_request?: Json | null
          session_id?: string | null
          start_url?: string | null
          started_at?: string
          status?: string
          step_index?: number | null
          task?: string
          thread_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vc_runs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vc_runs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      vc_secrets: {
        Row: {
          alias: string
          cipher: string
          created_at: string
          domain: string
          id: string
          label: string | null
          one_time: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          alias: string
          cipher: string
          created_at?: string
          domain: string
          id?: string
          label?: string | null
          one_time?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          alias?: string
          cipher?: string
          created_at?: string
          domain?: string
          id?: string
          label?: string | null
          one_time?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_due_schedule: {
        Args: { p_id: string }
        Returns: {
          attached_document_ids: string[]
          cadence: string
          capabilities: Json
          claim_at: string | null
          created_at: string
          enabled: boolean
          ends_at: string | null
          id: string
          image_urls: string[]
          interval_n: number
          last_plan_id: string | null
          last_run_at: string | null
          max_runs: number | null
          month_days: number[]
          next_run_at: string | null
          run_count: number
          starts_at: string | null
          thread_id: string | null
          time_of_day: string | null
          timezone: string
          title: string
          updated_at: string
          user_id: string
          user_request: string
          weekdays: number[]
          year_month_days: Json
        }
        SetofOptions: {
          from: "*"
          to: "plan_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      commit_document_edit: {
        Args: { p_contents: string[]; p_document_id: string }
        Returns: undefined
      }
      compact_sentence_indexes: {
        Args: { p_document_id: string }
        Returns: undefined
      }
      document_sentence_counts: {
        Args: never
        Returns: {
          document_id: string
          sentence_count: number
        }[]
      }
      insert_sentences_at: {
        Args: {
          p_contents: string[]
          p_document_id: string
          p_insert_at: number
        }
        Returns: undefined
      }
      insert_sentences_at_as: {
        Args: {
          p_contents: string[]
          p_document_id: string
          p_insert_at: number
          p_user_id: string
        }
        Returns: undefined
      }
      move_sentence: {
        Args: {
          p_document_id: string
          p_from_index: number
          p_to_index: number
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
