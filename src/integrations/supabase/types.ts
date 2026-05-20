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
      plans: {
        Row: {
          acknowledged: boolean
          approved_at: string | null
          attached_document_ids: string[]
          completed_at: string | null
          created_at: string
          current_step: number
          error_lovable_prompt: string | null
          error_message: string | null
          id: string
          origin_document_id: string | null
          origin_sentence_index: number | null
          plan_summary: string | null
          result_summary: string | null
          status: string
          step_claim_at: string | null
          steps: Json | null
          total_steps: number
          updated_at: string
          user_id: string
          user_request: string
        }
        Insert: {
          acknowledged?: boolean
          approved_at?: string | null
          attached_document_ids?: string[]
          completed_at?: string | null
          created_at?: string
          current_step?: number
          error_lovable_prompt?: string | null
          error_message?: string | null
          id?: string
          origin_document_id?: string | null
          origin_sentence_index?: number | null
          plan_summary?: string | null
          result_summary?: string | null
          status: string
          step_claim_at?: string | null
          steps?: Json | null
          total_steps?: number
          updated_at?: string
          user_id: string
          user_request: string
        }
        Update: {
          acknowledged?: boolean
          approved_at?: string | null
          attached_document_ids?: string[]
          completed_at?: string | null
          created_at?: string
          current_step?: number
          error_lovable_prompt?: string | null
          error_message?: string | null
          id?: string
          origin_document_id?: string | null
          origin_sentence_index?: number | null
          plan_summary?: string | null
          result_summary?: string | null
          status?: string
          step_claim_at?: string | null
          steps?: Json | null
          total_steps?: number
          updated_at?: string
          user_id?: string
          user_request?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_origin_document_id_fkey"
            columns: ["origin_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
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
          order_index: number
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          document_id: string
          id?: string
          linked_document_id?: string | null
          order_index?: number
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          document_id?: string
          id?: string
          linked_document_id?: string | null
          order_index?: number
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
        ]
      }
      user_preferences: {
        Row: {
          created_at: string
          favorites: Json
          grid_layout: Json
          id: string
          last_favorite_slot: number | null
          muted: boolean
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          favorites?: Json
          grid_layout?: Json
          id?: string
          last_favorite_slot?: number | null
          muted?: boolean
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          favorites?: Json
          grid_layout?: Json
          id?: string
          last_favorite_slot?: number | null
          muted?: boolean
          theme?: string
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
      insert_sentences_at: {
        Args: {
          p_contents: string[]
          p_document_id: string
          p_insert_at: number
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
    Enums: {},
  },
} as const
