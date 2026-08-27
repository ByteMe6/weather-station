export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      alert_deliveries: {
        Row: {
          created_at: string
          error: string | null
          fire_date: string
          id: number
          schedule_id: number
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          fire_date: string
          id?: never
          schedule_id: number
          status?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          fire_date?: string
          id?: never
          schedule_id?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_deliveries_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_sessions: {
        Row: {
          expires_at: string
          state: Json
          telegram_id: number
          updated_at: string
        }
        Insert: {
          expires_at: string
          state: Json
          telegram_id: number
          updated_at?: string
        }
        Update: {
          expires_at?: string
          state?: Json
          telegram_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      device_users: {
        Row: {
          added_at: string
          device_id: string
          role: string
          user_id: string
        }
        Insert: {
          added_at?: string
          device_id: string
          role: string
          user_id: string
        }
        Update: {
          added_at?: string
          device_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_users_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "device_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          address: string | null
          created_at: string
          device_id: string
          label: string | null
          latitude: number | null
          longitude: number | null
          secret: string
          status: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          device_id: string
          label?: string | null
          latitude?: number | null
          longitude?: number | null
          secret: string
          status?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          device_id?: string
          label?: string | null
          latitude?: number | null
          longitude?: number | null
          secret?: string
          status?: string
        }
        Relationships: []
      }
      readings: {
        Row: {
          device_id: string
          humidity: number | null
          id: number
          precipitation: number | null
          pressure: number
          temperature: number
          timestamp: string
          wind_direction: number | null
          wind_speed: number | null
        }
        Insert: {
          device_id: string
          humidity?: number | null
          id?: never
          precipitation?: number | null
          pressure: number
          temperature: number
          timestamp: string
          wind_direction?: number | null
          wind_speed?: number | null
        }
        Update: {
          device_id?: string
          humidity?: number | null
          id?: never
          precipitation?: number | null
          pressure?: number
          temperature?: number
          timestamp?: string
          wind_direction?: number | null
          wind_speed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["device_id"]
          },
        ]
      }
      schedules: {
        Row: {
          created_at: string
          days: number[]
          id: number
          time: string
          timezone: string
          user_id: string
        }
        Insert: {
          created_at?: string
          days: number[]
          id?: never
          time: string
          timezone?: string
          user_id: string
        }
        Update: {
          created_at?: string
          days?: number[]
          id?: never
          time?: string
          timezone?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_link_codes: {
        Row: {
          code: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          failed_reason: string | null
          user_id: string
        }
        Insert: {
          code: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          failed_reason?: string | null
          user_id: string
        }
        Update: {
          code?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          failed_reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_link_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          clerk_user_id: string | null
          created_at: string
          id: string
          telegram_id: number | null
        }
        Insert: {
          clerk_user_id?: string | null
          created_at?: string
          id?: string
          telegram_id?: number | null
        }
        Update: {
          clerk_user_id?: string | null
          created_at?: string
          id?: string
          telegram_id?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_devices: {
        Args: never
        Returns: {
          created_at: string
          device_id: string
          label: string
          member_count: number
          status: string
        }[]
      }
      admin_org_id_configured: { Args: never; Returns: string }
      admin_users: {
        Args: never
        Returns: {
          clerk_user_id: string
          created_at: string
          device_count: number
          id: string
          telegram_id: number
        }[]
      }
      claim_device: {
        Args: { p_device_id: string; p_user_id: string }
        Returns: undefined
      }
      claim_due_alert_slots: {
        Args: { p_now?: string }
        Returns: {
          fire_date: string
          schedule_id: number
          slot_time: string
          slot_timezone: string
          telegram_id: number
          user_id: string
        }[]
      }
      current_app_user_id: { Args: never; Returns: string }
      device_members: {
        Args: { p_device_id: string }
        Returns: {
          added_at: string
          clerk_tail: string
          role: string
          telegram_tail: string
          user_id: string
        }[]
      }
      invoke_alert_dispatcher: { Args: never; Returns: undefined }
      is_admin_request: { Args: never; Returns: boolean }
      is_device_owner: { Args: { p_device_id: string }; Returns: boolean }
      merge_telegram_identity: {
        Args: { p_telegram_id: number; p_user_id: string }
        Returns: Database["public"]["CompositeTypes"]["telegram_merge_result"]
        SetofOptions: {
          from: "*"
          to: "telegram_merge_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      readings_bucketed: {
        Args: {
          p_bucket_minutes: number
          p_device_id: string
          p_from: string
          p_to: string
        }
        Returns: {
          avg_humidity: number
          avg_pressure: number
          avg_temperature: number
          avg_wind_speed: number
          bucket: string
          max_humidity: number
          max_pressure: number
          max_temperature: number
          max_wind_speed: number
          min_humidity: number
          min_pressure: number
          min_temperature: number
          sample_count: number
          total_precipitation: number
        }[]
      }
      set_admin_org_id: { Args: { p_org_id: string }; Returns: undefined }
      set_alert_cron_config: {
        Args: { p_secret: string; p_url: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      telegram_merge_result: {
        merged: boolean | null
        devices_moved: number | null
        schedules_moved: number | null
      }
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

