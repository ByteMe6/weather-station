/**
 * Supabase-generated database types. Regenerate after every migration:
 *
 *   cd infra/supabase-db && yarn regenerate:types
 *
 * Placeholder until the first migration lands (schema: docs/04-prd.md D1–D5).
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
