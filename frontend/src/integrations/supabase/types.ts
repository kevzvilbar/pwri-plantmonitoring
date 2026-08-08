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
      afm_readings: {
        Row: {
          afm_unit_number: number
          backwash_end: string | null
          backwash_start: string | null
          backwash_volume: number | null
          created_at: string
          dp_psi: number | null
          id: string
          inlet_pressure_psi: number | null
          meter_final: number | null
          meter_initial: number | null
          mode: string
          outlet_pressure_psi: number | null
          plant_id: string
          reading_datetime: string
          recorded_by: string | null
          train_id: string
        }
        Insert: {
          afm_unit_number: number
          backwash_end?: string | null
          backwash_start?: string | null
          backwash_volume?: number | null
          created_at?: string
          dp_psi?: number | null
          id?: string
          inlet_pressure_psi?: number | null
          meter_final?: number | null
          meter_initial?: number | null
          mode?: string
          outlet_pressure_psi?: number | null
          plant_id: string
          reading_datetime?: string
          recorded_by?: string | null
          train_id: string
        }
        Update: {
          afm_unit_number?: number
          backwash_end?: string | null
          backwash_start?: string | null
          backwash_volume?: number | null
          created_at?: string
          dp_psi?: number | null
          id?: string
          inlet_pressure_psi?: number | null
          meter_final?: number | null
          meter_initial?: number | null
          mode?: string
          outlet_pressure_psi?: number | null
          plant_id?: string
          reading_datetime?: string
          recorded_by?: string | null
          train_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "afm_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "afm_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "afm_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "afm_readings_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_sessions: {
        Row: {
          messages: Json
          session_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          messages?: Json
          session_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          messages?: Json
          session_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      archived_plant_data: {
        Row: {
          archived_at: string
          archived_by: string | null
          id: string
          payload: Json
          plant_id: string
          plant_name: string | null
          reason: string | null
          source_row_id: string | null
          source_table: string
        }
        Insert: {
          archived_at?: string
          archived_by?: string | null
          id?: string
          payload: Json
          plant_id: string
          plant_name?: string | null
          reason?: string | null
          source_row_id?: string | null
          source_table: string
        }
        Update: {
          archived_at?: string
          archived_by?: string | null
          id?: string
          payload?: Json
          plant_id?: string
          plant_name?: string | null
          reason?: string | null
          source_row_id?: string | null
          source_table?: string
        }
        Relationships: []
      }
      blending_events: {
        Row: {
          event_date: string
          id: string
          is_meter_replacement: boolean | null
          noted_at: string
          plant_id: string
          plant_name: string | null
          previous_reading: number | null
          raw_meter_reading: number | null
          reading_datetime: string | null
          volume_m3: number
          well_id: string
          well_name: string | null
        }
        Insert: {
          event_date: string
          id?: string
          is_meter_replacement?: boolean | null
          noted_at?: string
          plant_id: string
          plant_name?: string | null
          previous_reading?: number | null
          raw_meter_reading?: number | null
          reading_datetime?: string | null
          volume_m3?: number
          well_id: string
          well_name?: string | null
        }
        Update: {
          event_date?: string
          id?: string
          is_meter_replacement?: boolean | null
          noted_at?: string
          plant_id?: string
          plant_name?: string | null
          previous_reading?: number | null
          raw_meter_reading?: number | null
          reading_datetime?: string | null
          volume_m3?: number
          well_id?: string
          well_name?: string | null
        }
        Relationships: []
      }
      blending_wells: {
        Row: {
          id: string
          note: string | null
          plant_id: string
          plant_name: string | null
          tagged_at: string
          tagged_by: string | null
          well_id: string
          well_name: string | null
        }
        Insert: {
          id?: string
          note?: string | null
          plant_id: string
          plant_name?: string | null
          tagged_at?: string
          tagged_by?: string | null
          well_id: string
          well_name?: string | null
        }
        Update: {
          id?: string
          note?: string | null
          plant_id?: string
          plant_name?: string | null
          tagged_at?: string
          tagged_by?: string | null
          well_id?: string
          well_name?: string | null
        }
        Relationships: []
      }
      cartridge_readings: {
        Row: {
          bag_replaced: boolean
          cartridge_number: number
          created_at: string
          dp_psi: number | null
          id: string
          inlet_pressure_psi: number | null
          outlet_pressure_psi: number | null
          pieces_replaced: number | null
          plant_id: string
          reading_datetime: string
          recorded_by: string | null
          train_id: string
        }
        Insert: {
          bag_replaced?: boolean
          cartridge_number: number
          created_at?: string
          dp_psi?: number | null
          id?: string
          inlet_pressure_psi?: number | null
          outlet_pressure_psi?: number | null
          pieces_replaced?: number | null
          plant_id: string
          reading_datetime?: string
          recorded_by?: string | null
          train_id: string
        }
        Update: {
          bag_replaced?: boolean
          cartridge_number?: number
          created_at?: string
          dp_psi?: number | null
          id?: string
          inlet_pressure_psi?: number | null
          outlet_pressure_psi?: number | null
          pieces_replaced?: number | null
          plant_id?: string
          reading_datetime?: string
          recorded_by?: string | null
          train_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cartridge_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cartridge_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "cartridge_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cartridge_readings_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_audit_log: {
        Row: {
          id: string
          recipient_id: string
          sender_id: string
          sent_at: string
        }
        Insert: {
          id?: string
          recipient_id: string
          sender_id: string
          sent_at?: string
        }
        Update: {
          id?: string
          recipient_id?: string
          sender_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_audit_log_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chat_audit_log_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_audit_log_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chat_audit_log_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          body: string
          expires_at: string
          id: string
          recipient_id: string
          sender_id: string
          sent_at: string
        }
        Insert: {
          body: string
          expires_at?: string
          id?: string
          recipient_id: string
          sender_id: string
          sent_at?: string
        }
        Update: {
          body?: string
          expires_at?: string
          id?: string
          recipient_id?: string
          sender_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chat_messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_executions: {
        Row: {
          completed: boolean
          completed_at: string | null
          completed_by: string | null
          created_at: string
          execution_date: string
          findings: string | null
          frequency: Database["public"]["Enums"]["frequency_type"] | null
          id: string
          plant_id: string | null
          template_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          execution_date?: string
          findings?: string | null
          frequency?: Database["public"]["Enums"]["frequency_type"] | null
          id?: string
          plant_id?: string | null
          template_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          execution_date?: string
          findings?: string | null
          frequency?: Database["public"]["Enums"]["frequency_type"] | null
          id?: string
          plant_id?: string | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_executions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "checklist_executions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_executions_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_executions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_step_executions: {
        Row: {
          completed: boolean
          completed_at: string | null
          completed_by: string | null
          created_at: string
          execution_id: string
          id: string
          notes: string | null
          plant_id: string | null
          step_index: number
          step_text: string
          template_id: string
          value: string | null
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          execution_id: string
          id?: string
          notes?: string | null
          plant_id?: string | null
          step_index: number
          step_text: string
          template_id: string
          value?: string | null
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          execution_id?: string
          id?: string
          notes?: string | null
          plant_id?: string | null
          step_index?: number
          step_text?: string
          template_id?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_step_executions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "checklist_step_executions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_step_executions_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "checklist_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_step_executions_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_step_executions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          category: string
          checklist_steps: string[] | null
          created_at: string
          created_by: string | null
          equipment_name: string
          frequency: Database["public"]["Enums"]["frequency_type"]
          id: string
          plant_id: string | null
          schedule_start_date: string | null
        }
        Insert: {
          category: string
          checklist_steps?: string[] | null
          created_at?: string
          created_by?: string | null
          equipment_name: string
          frequency: Database["public"]["Enums"]["frequency_type"]
          id?: string
          plant_id?: string | null
          schedule_start_date?: string | null
        }
        Update: {
          category?: string
          checklist_steps?: string[] | null
          created_at?: string
          created_by?: string | null
          equipment_name?: string
          frequency?: Database["public"]["Enums"]["frequency_type"]
          id?: string
          plant_id?: string | null
          schedule_start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "checklist_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_templates_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_deliveries: {
        Row: {
          chemical_name: string
          created_at: string
          delivery_date: string
          id: string
          plant_id: string
          quantity: number
          recorded_by: string | null
          remarks: string | null
          supplier: string | null
          unit: string
          unit_cost: number | null
        }
        Insert: {
          chemical_name: string
          created_at?: string
          delivery_date?: string
          id?: string
          plant_id: string
          quantity: number
          recorded_by?: string | null
          remarks?: string | null
          supplier?: string | null
          unit?: string
          unit_cost?: number | null
        }
        Update: {
          chemical_name?: string
          created_at?: string
          delivery_date?: string
          id?: string
          plant_id?: string
          quantity?: number
          recorded_by?: string | null
          remarks?: string | null
          supplier?: string | null
          unit?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "chemical_deliveries_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_dosing_logs: {
        Row: {
          anti_scalant_l: number
          calculated_cost: number | null
          chlorine_kg: number
          created_at: string
          free_chlorine_reagent_pcs: number
          id: string
          log_datetime: string
          plant_id: string
          product_water_free_cl_ppm: number | null
          recorded_by: string | null
          smbs_kg: number
          soda_ash_kg: number
        }
        Insert: {
          anti_scalant_l?: number
          calculated_cost?: number | null
          chlorine_kg?: number
          created_at?: string
          free_chlorine_reagent_pcs?: number
          id?: string
          log_datetime?: string
          plant_id: string
          product_water_free_cl_ppm?: number | null
          recorded_by?: string | null
          smbs_kg?: number
          soda_ash_kg?: number
        }
        Update: {
          anti_scalant_l?: number
          calculated_cost?: number | null
          chlorine_kg?: number
          created_at?: string
          free_chlorine_reagent_pcs?: number
          id?: string
          log_datetime?: string
          plant_id?: string
          product_water_free_cl_ppm?: number | null
          recorded_by?: string | null
          smbs_kg?: number
          soda_ash_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "chemical_dosing_logs_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_dosing_logs_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chemical_dosing_logs_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_inventory: {
        Row: {
          chemical_name: string
          current_stock: number
          id: string
          low_stock_threshold: number
          plant_id: string
          price_per_unit: number | null
          unit: string | null
          unit_type: string | null
          updated_at: string
        }
        Insert: {
          chemical_name: string
          current_stock?: number
          id?: string
          low_stock_threshold?: number
          plant_id: string
          price_per_unit?: number | null
          unit?: string | null
          unit_type?: string | null
          updated_at?: string
        }
        Update: {
          chemical_name?: string
          current_stock?: number
          id?: string
          low_stock_threshold?: number
          plant_id?: string
          price_per_unit?: number | null
          unit?: string | null
          unit_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chemical_inventory_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_prices: {
        Row: {
          chemical_name: string
          created_at: string
          effective_date: string
          id: string
          unit_price: number
          updated_by: string | null
        }
        Insert: {
          chemical_name: string
          created_at?: string
          effective_date: string
          id?: string
          unit_price: number
          updated_by?: string | null
        }
        Update: {
          chemical_name?: string
          created_at?: string
          effective_date?: string
          id?: string
          unit_price?: number
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chemical_prices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chemical_prices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_residual_samples: {
        Row: {
          created_at: string
          dosing_log_id: string
          id: string
          plant_id: string
          residual_ppm: number | null
          sample_index: number
          sampling_point: string | null
        }
        Insert: {
          created_at?: string
          dosing_log_id: string
          id?: string
          plant_id: string
          residual_ppm?: number | null
          sample_index: number
          sampling_point?: string | null
        }
        Update: {
          created_at?: string
          dosing_log_id?: string
          id?: string
          plant_id?: string
          residual_ppm?: number | null
          sample_index?: number
          sampling_point?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chemical_residual_samples_dosing_log_id_fkey"
            columns: ["dosing_log_id"]
            isOneToOne: false
            referencedRelation: "chemical_dosing_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_residual_samples_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      cip_logs: {
        Row: {
          caustic_soda_kg: number | null
          conducted_by: string | null
          created_at: string
          end_datetime: string | null
          hcl_l: number | null
          id: string
          plant_id: string
          remarks: string | null
          sls_g: number | null
          start_datetime: string | null
          train_id: string
        }
        Insert: {
          caustic_soda_kg?: number | null
          conducted_by?: string | null
          created_at?: string
          end_datetime?: string | null
          hcl_l?: number | null
          id?: string
          plant_id: string
          remarks?: string | null
          sls_g?: number | null
          start_datetime?: string | null
          train_id: string
        }
        Update: {
          caustic_soda_kg?: number | null
          conducted_by?: string | null
          created_at?: string
          end_datetime?: string | null
          hcl_l?: number | null
          id?: string
          plant_id?: string
          remarks?: string | null
          sls_g?: number | null
          start_datetime?: string | null
          train_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cip_logs_conducted_by_fkey"
            columns: ["conducted_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "cip_logs_conducted_by_fkey"
            columns: ["conducted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cip_logs_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cip_logs_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_snapshots: {
        Row: {
          evaluated_at: string
          id: string
          plant_id: string | null
          summary: string | null
          violations: Json
        }
        Insert: {
          evaluated_at?: string
          id?: string
          plant_id?: string | null
          summary?: string | null
          violations?: Json
        }
        Update: {
          evaluated_at?: string
          id?: string
          plant_id?: string | null
          summary?: string | null
          violations?: Json
        }
        Relationships: [
          {
            foreignKeyName: "compliance_snapshots_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_thresholds: {
        Row: {
          id: string
          scope: string
          thresholds: Json
          updated_at: string
        }
        Insert: {
          id?: string
          scope: string
          thresholds?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          scope?: string
          thresholds?: Json
          updated_at?: string
        }
        Relationships: []
      }
      correction_requests: {
        Row: {
          created_at: string
          id: string
          note: string | null
          original_value: number
          plant_id: string
          proposed_value: number
          reason: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_id: string
          source_table: string
          status: string
          submitted_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          original_value: number
          plant_id: string
          proposed_value: number
          reason: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_id: string
          source_table: string
          status?: string
          submitted_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          original_value?: number
          plant_id?: string
          proposed_value?: number
          reason?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_id?: string
          source_table?: string
          status?: string
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "correction_requests_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correction_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "correction_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correction_requests_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "correction_requests_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_plant_summary: {
        Row: {
          blending_m3: number | null
          created_at: string
          downtime_hrs: number | null
          feed_pressure_psi: number | null
          feed_tds: number | null
          id: string
          locator_consumption_m3: number | null
          notes: string | null
          permeate_tds: number | null
          plant_id: string
          power_kwh: number | null
          product_tds: number | null
          production_m3: number | null
          pv_ratio: number | null
          raw_turbidity_ntu: number | null
          raw_water_consumption_m3: number | null
          recovery_pct: number | null
          reject_pressure_psi: number | null
          reject_tds: number | null
          rejection_pct: number | null
          source: string | null
          summary_date: string
          updated_at: string
        }
        Insert: {
          blending_m3?: number | null
          created_at?: string
          downtime_hrs?: number | null
          feed_pressure_psi?: number | null
          feed_tds?: number | null
          id?: string
          locator_consumption_m3?: number | null
          notes?: string | null
          permeate_tds?: number | null
          plant_id: string
          power_kwh?: number | null
          product_tds?: number | null
          production_m3?: number | null
          pv_ratio?: number | null
          raw_turbidity_ntu?: number | null
          raw_water_consumption_m3?: number | null
          recovery_pct?: number | null
          reject_pressure_psi?: number | null
          reject_tds?: number | null
          rejection_pct?: number | null
          source?: string | null
          summary_date: string
          updated_at?: string
        }
        Update: {
          blending_m3?: number | null
          created_at?: string
          downtime_hrs?: number | null
          feed_pressure_psi?: number | null
          feed_tds?: number | null
          id?: string
          locator_consumption_m3?: number | null
          notes?: string | null
          permeate_tds?: number | null
          plant_id?: string
          power_kwh?: number | null
          product_tds?: number | null
          production_m3?: number | null
          pv_ratio?: number | null
          raw_turbidity_ntu?: number | null
          raw_water_consumption_m3?: number | null
          recovery_pct?: number | null
          reject_pressure_psi?: number | null
          reject_tds?: number | null
          rejection_pct?: number | null
          source?: string | null
          summary_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_plant_summary_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_audit_log: {
        Row: {
          action: string
          actor_label: string | null
          actor_user_id: string | null
          created_at: string
          dependencies: Json | null
          entity_id: string
          entity_label: string | null
          id: string
          kind: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_label?: string | null
          actor_user_id?: string | null
          created_at?: string
          dependencies?: Json | null
          entity_id: string
          entity_label?: string | null
          id?: string
          kind: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_label?: string | null
          actor_user_id?: string | null
          created_at?: string
          dependencies?: Json | null
          entity_id?: string
          entity_label?: string | null
          id?: string
          kind?: string
          reason?: string | null
        }
        Relationships: []
      }
      derived_meter_sweep_log: {
        Row: {
          changed: boolean
          date_key: string
          id: string
          locator_id: string
          mirror_meter_id: string | null
          mirror_reading_id: string | null
          new_value: number | null
          old_value: number | null
          reading_id: string | null
          swept_at: string
        }
        Insert: {
          changed?: boolean
          date_key: string
          id?: string
          locator_id: string
          mirror_meter_id?: string | null
          mirror_reading_id?: string | null
          new_value?: number | null
          old_value?: number | null
          reading_id?: string | null
          swept_at?: string
        }
        Update: {
          changed?: boolean
          date_key?: string
          id?: string
          locator_id?: string
          mirror_meter_id?: string | null
          mirror_reading_id?: string | null
          new_value?: number | null
          old_value?: number | null
          reading_id?: string | null
          swept_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "derived_meter_sweep_log_locator_id_fkey"
            columns: ["locator_id"]
            isOneToOne: false
            referencedRelation: "locators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derived_meter_sweep_log_mirror_meter_id_fkey"
            columns: ["mirror_meter_id"]
            isOneToOne: false
            referencedRelation: "product_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derived_meter_sweep_log_mirror_reading_id_fkey"
            columns: ["mirror_reading_id"]
            isOneToOne: false
            referencedRelation: "product_meter_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derived_meter_sweep_log_mirror_reading_id_fkey"
            columns: ["mirror_reading_id"]
            isOneToOne: false
            referencedRelation: "product_meter_readings_clean"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derived_meter_sweep_log_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "locator_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derived_meter_sweep_log_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "locator_readings_clean"
            referencedColumns: ["id"]
          },
        ]
      }
      downtime_events: {
        Row: {
          created_at: string
          description: string | null
          duration_hrs: number
          event_date: string
          id: string
          plant_id: string | null
          subsystem: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_hrs?: number
          event_date: string
          id?: string
          plant_id?: string | null
          subsystem?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_hrs?: number
          event_date?: string
          id?: string
          plant_id?: string | null
          subsystem?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "downtime_events_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      electric_bills: {
        Row: {
          billing_month: string
          created_at: string
          current_reading: number
          distribution_charge: number | null
          generation_charge: number | null
          id: string
          multiplier: number
          other_charges: number | null
          period_end: string
          period_start: string
          plant_id: string
          previous_reading: number
          recorded_by: string | null
          remarks: string | null
          total_amount: number
          total_kwh: number | null
          updated_at: string
        }
        Insert: {
          billing_month: string
          created_at?: string
          current_reading: number
          distribution_charge?: number | null
          generation_charge?: number | null
          id?: string
          multiplier?: number
          other_charges?: number | null
          period_end: string
          period_start: string
          plant_id: string
          previous_reading: number
          recorded_by?: string | null
          remarks?: string | null
          total_amount: number
          total_kwh?: number | null
          updated_at?: string
        }
        Update: {
          billing_month?: string
          created_at?: string
          current_reading?: number
          distribution_charge?: number | null
          generation_charge?: number | null
          id?: string
          multiplier?: number
          other_charges?: number | null
          period_end?: string
          period_start?: string
          plant_id?: string
          previous_reading?: number
          recorded_by?: string | null
          remarks?: string | null
          total_amount?: number
          total_kwh?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "electric_bills_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_status_audit_log: {
        Row: {
          entity_id: string
          entity_label: string | null
          entity_type: string
          from_status: string
          id: string
          plant_id: string | null
          reason_category: string | null
          reason_detail: string | null
          timestamp: string
          to_status: string
          user_id: string | null
        }
        Insert: {
          entity_id: string
          entity_label?: string | null
          entity_type: string
          from_status: string
          id?: string
          plant_id?: string | null
          reason_category?: string | null
          reason_detail?: string | null
          timestamp?: string
          to_status: string
          user_id?: string | null
        }
        Update: {
          entity_id?: string
          entity_label?: string | null
          entity_type?: string
          from_status?: string
          id?: string
          plant_id?: string | null
          reason_category?: string | null
          reason_detail?: string | null
          timestamp?: string
          to_status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_status_audit_log_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      filter_replacements: {
        Row: {
          avg_dp_psi: number | null
          created_at: string
          filter_housing_type: string
          id: string
          plant_id: string
          quantity_replaced: number
          recorded_by: string | null
          remarks: string | null
          replacement_date: string
          supplier: string | null
          total_cost: number | null
          train_id: string | null
          unit_price: number
        }
        Insert: {
          avg_dp_psi?: number | null
          created_at?: string
          filter_housing_type: string
          id?: string
          plant_id: string
          quantity_replaced: number
          recorded_by?: string | null
          remarks?: string | null
          replacement_date: string
          supplier?: string | null
          total_cost?: number | null
          train_id?: string | null
          unit_price: number
        }
        Update: {
          avg_dp_psi?: number | null
          created_at?: string
          filter_housing_type?: string
          id?: string
          plant_id?: string
          quantity_replaced?: number
          recorded_by?: string | null
          remarks?: string | null
          replacement_date?: string
          supplier?: string | null
          total_cost?: number | null
          train_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "filter_replacements_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filter_replacements_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      filter_unit_prices: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          filter_housing_type: string
          id: string
          plant_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          filter_housing_type: string
          id?: string
          plant_id: string
          unit_price: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          filter_housing_type?: string
          id?: string
          plant_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "filter_unit_prices_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      import_analysis: {
        Row: {
          actor_label: string | null
          actor_user_id: string | null
          ai_model: string | null
          ai_provider: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decisions: Json | null
          file_kind: string | null
          file_size: number | null
          filename: string
          id: string
          plant_id: string | null
          reason: string | null
          status: string
          sync_summary: Json | null
          tables: Json
          wellmeter_detected: boolean
        }
        Insert: {
          actor_label?: string | null
          actor_user_id?: string | null
          ai_model?: string | null
          ai_provider?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decisions?: Json | null
          file_kind?: string | null
          file_size?: number | null
          filename: string
          id?: string
          plant_id?: string | null
          reason?: string | null
          status?: string
          sync_summary?: Json | null
          tables: Json
          wellmeter_detected?: boolean
        }
        Update: {
          actor_label?: string | null
          actor_user_id?: string | null
          ai_model?: string | null
          ai_provider?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decisions?: Json | null
          file_kind?: string | null
          file_size?: number | null
          filename?: string
          id?: string
          plant_id?: string | null
          reason?: string | null
          status?: string
          sync_summary?: Json | null
          tables?: Json
          wellmeter_detected?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "import_analysis_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      import_audit_log: {
        Row: {
          file_name: string | null
          id: string
          module: string | null
          plant_id: string | null
          row_count: number | null
          schema_errors: Json | null
          schema_valid: boolean | null
          timestamp: string | null
          user_id: string | null
        }
        Insert: {
          file_name?: string | null
          id?: string
          module?: string | null
          plant_id?: string | null
          row_count?: number | null
          schema_errors?: Json | null
          schema_valid?: boolean | null
          timestamp?: string | null
          user_id?: string | null
        }
        Update: {
          file_name?: string | null
          id?: string
          module?: string | null
          plant_id?: string | null
          row_count?: number | null
          schema_errors?: Json | null
          schema_valid?: boolean | null
          timestamp?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      incidents: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          corrective_action: string | null
          created_at: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          immediate_action: string | null
          incident_ref: string | null
          incident_type: string | null
          photo_url: string | null
          plant_id: string
          preventive_measures: string | null
          resolved_at: string | null
          resolved_by: string | null
          root_cause: string | null
          severity: Database["public"]["Enums"]["severity_level"] | null
          status: Database["public"]["Enums"]["incident_status"]
          temperature_c: number | null
          updated_at: string
          weather: string | null
          what_description: string | null
          when_datetime: string | null
          where_location: string | null
          who_reporter: string | null
          witness: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          corrective_action?: string | null
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          immediate_action?: string | null
          incident_ref?: string | null
          incident_type?: string | null
          photo_url?: string | null
          plant_id: string
          preventive_measures?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          root_cause?: string | null
          severity?: Database["public"]["Enums"]["severity_level"] | null
          status?: Database["public"]["Enums"]["incident_status"]
          temperature_c?: number | null
          updated_at?: string
          weather?: string | null
          what_description?: string | null
          when_datetime?: string | null
          where_location?: string | null
          who_reporter?: string | null
          witness?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          corrective_action?: string | null
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          immediate_action?: string | null
          incident_ref?: string | null
          incident_type?: string | null
          photo_url?: string | null
          plant_id?: string
          preventive_measures?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          root_cause?: string | null
          severity?: Database["public"]["Enums"]["severity_level"] | null
          status?: Database["public"]["Enums"]["incident_status"]
          temperature_c?: number | null
          updated_at?: string
          weather?: string | null
          what_description?: string | null
          when_datetime?: string | null
          where_location?: string | null
          who_reporter?: string | null
          witness?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incidents_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "incidents_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "incidents_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_who_reporter_fkey"
            columns: ["who_reporter"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "incidents_who_reporter_fkey"
            columns: ["who_reporter"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      locator_derived_review_flags: {
        Row: {
          date_key: string
          flagged_at: string
          id: string
          locator_id: string
          resolved_at: string | null
        }
        Insert: {
          date_key: string
          flagged_at?: string
          id?: string
          locator_id: string
          resolved_at?: string | null
        }
        Update: {
          date_key?: string
          flagged_at?: string
          id?: string
          locator_id?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locator_derived_review_flags_locator_id_fkey"
            columns: ["locator_id"]
            isOneToOne: false
            referencedRelation: "locators"
            referencedColumns: ["id"]
          },
        ]
      }
      locator_meter_replacements: {
        Row: {
          created_at: string
          id: string
          locator_id: string
          new_meter_brand: string | null
          new_meter_initial_reading: number | null
          new_meter_installed_date: string | null
          new_meter_serial: string | null
          new_meter_size: string | null
          old_meter_brand: string | null
          old_meter_final_reading: number | null
          old_meter_serial: string | null
          old_meter_size: string | null
          plant_id: string
          reading_id: string | null
          remarks: string | null
          replaced_by: string | null
          replacement_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          locator_id: string
          new_meter_brand?: string | null
          new_meter_initial_reading?: number | null
          new_meter_installed_date?: string | null
          new_meter_serial?: string | null
          new_meter_size?: string | null
          old_meter_brand?: string | null
          old_meter_final_reading?: number | null
          old_meter_serial?: string | null
          old_meter_size?: string | null
          plant_id: string
          reading_id?: string | null
          remarks?: string | null
          replaced_by?: string | null
          replacement_date: string
        }
        Update: {
          created_at?: string
          id?: string
          locator_id?: string
          new_meter_brand?: string | null
          new_meter_initial_reading?: number | null
          new_meter_installed_date?: string | null
          new_meter_serial?: string | null
          new_meter_size?: string | null
          old_meter_brand?: string | null
          old_meter_final_reading?: number | null
          old_meter_serial?: string | null
          old_meter_size?: string | null
          plant_id?: string
          reading_id?: string | null
          remarks?: string | null
          replaced_by?: string | null
          replacement_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "locator_meter_replacements_locator_id_fkey"
            columns: ["locator_id"]
            isOneToOne: false
            referencedRelation: "locators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locator_meter_replacements_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locator_meter_replacements_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "locator_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locator_meter_replacements_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "locator_readings_clean"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locator_meter_replacements_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "locator_meter_replacements_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      locator_readings: {
        Row: {
          created_at: string
          current_reading: number
          daily_volume: number | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          is_estimated: boolean
          is_meter_replacement: boolean | null
          is_meter_rollover: boolean
          locator_id: string
          locked_at: string | null
          locked_by: string | null
          meter_rollover_max: number | null
          norm_status: string | null
          off_location_flag: boolean
          plant_id: string
          previous_reading: number | null
          reading_datetime: string
          recorded_by: string | null
          remarks: string | null
        }
        Insert: {
          created_at?: string
          current_reading: number
          daily_volume?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          is_estimated?: boolean
          is_meter_replacement?: boolean | null
          is_meter_rollover?: boolean
          locator_id: string
          locked_at?: string | null
          locked_by?: string | null
          meter_rollover_max?: number | null
          norm_status?: string | null
          off_location_flag?: boolean
          plant_id: string
          previous_reading?: number | null
          reading_datetime?: string
          recorded_by?: string | null
          remarks?: string | null
        }
        Update: {
          created_at?: string
          current_reading?: number
          daily_volume?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          is_estimated?: boolean
          is_meter_replacement?: boolean | null
          is_meter_rollover?: boolean
          locator_id?: string
          locked_at?: string | null
          locked_by?: string | null
          meter_rollover_max?: number | null
          norm_status?: string | null
          off_location_flag?: boolean
          plant_id?: string
          previous_reading?: number | null
          reading_datetime?: string
          recorded_by?: string | null
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locator_readings_locator_id_fkey"
            columns: ["locator_id"]
            isOneToOne: false
            referencedRelation: "locators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locator_readings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "locator_readings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locator_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locator_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "locator_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      locators: {
        Row: {
          address: string | null
          created_at: string
          default_input_mode: string
          derived_from_meter_id: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          is_derived: boolean
          is_locked: boolean
          location_desc: string | null
          meter_brand: string | null
          meter_installed_date: string | null
          meter_serial: string | null
          meter_size: string | null
          name: string
          plant_id: string
          product_meter_id: string | null
          status: Database["public"]["Enums"]["plant_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          default_input_mode?: string
          derived_from_meter_id?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          is_derived?: boolean
          is_locked?: boolean
          location_desc?: string | null
          meter_brand?: string | null
          meter_installed_date?: string | null
          meter_serial?: string | null
          meter_size?: string | null
          name: string
          plant_id: string
          product_meter_id?: string | null
          status?: Database["public"]["Enums"]["plant_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          default_input_mode?: string
          derived_from_meter_id?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          is_derived?: boolean
          is_locked?: boolean
          location_desc?: string | null
          meter_brand?: string | null
          meter_installed_date?: string | null
          meter_serial?: string | null
          meter_size?: string | null
          name?: string
          plant_id?: string
          product_meter_id?: string | null
          status?: Database["public"]["Enums"]["plant_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locators_derived_from_meter_id_fkey"
            columns: ["derived_from_meter_id"]
            isOneToOne: false
            referencedRelation: "product_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locators_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locators_product_meter_id_fkey"
            columns: ["product_meter_id"]
            isOneToOne: false
            referencedRelation: "product_meters"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          attempted_at: string
          email: string
          error_reason: string | null
          id: string
          success: boolean
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          attempted_at?: string
          email: string
          error_reason?: string | null
          id?: string
          success: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          attempted_at?: string
          email?: string
          error_reason?: string | null
          id?: string
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      migration_state: {
        Row: {
          apply_history: Json | null
          filename: string
          manual_override: Json | null
          updated_at: string
        }
        Insert: {
          apply_history?: Json | null
          filename: string
          manual_override?: Json | null
          updated_at?: string
        }
        Update: {
          apply_history?: Json | null
          filename?: string
          manual_override?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          alert_type: string
          created_at: string
          id: string
          link_path: string | null
          message: string | null
          plant_id: string | null
          read: boolean
          severity: Database["public"]["Enums"]["severity_level"]
          title: string
          user_id: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          id?: string
          link_path?: string | null
          message?: string | null
          plant_id?: string | null
          read?: boolean
          severity?: Database["public"]["Enums"]["severity_level"]
          title: string
          user_id: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          id?: string
          link_path?: string | null
          message?: string | null
          plant_id?: string | null
          read?: boolean
          severity?: Database["public"]["Enums"]["severity_level"]
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_switch_log: {
        Row: {
          from_operator_id: string | null
          id: string
          plant_id: string | null
          switched_at: string
          switched_by: string | null
          to_operator_id: string | null
        }
        Insert: {
          from_operator_id?: string | null
          id?: string
          plant_id?: string | null
          switched_at?: string
          switched_by?: string | null
          to_operator_id?: string | null
        }
        Update: {
          from_operator_id?: string | null
          id?: string
          plant_id?: string | null
          switched_at?: string
          switched_by?: string | null
          to_operator_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_switch_log_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      opex_budgets: {
        Row: {
          budget_month: string
          chem_budget: number
          id: string
          notes: string | null
          plant_id: string
          power_budget: number
          total_budget: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          budget_month: string
          chem_budget?: number
          id?: string
          notes?: string | null
          plant_id: string
          power_budget?: number
          total_budget?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          budget_month?: string
          chem_budget?: number
          id?: string
          notes?: string | null
          plant_id?: string
          power_budget?: number
          total_budget?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opex_budgets_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      plant_assignment_audit: {
        Row: {
          admin_id: string | null
          changed_at: string
          created_at: string
          id: string
          justification: string | null
          new_plant_ids: string[]
          user_id: string
        }
        Insert: {
          admin_id?: string | null
          changed_at?: string
          created_at?: string
          id?: string
          justification?: string | null
          new_plant_ids?: string[]
          user_id: string
        }
        Update: {
          admin_id?: string | null
          changed_at?: string
          created_at?: string
          id?: string
          justification?: string | null
          new_plant_ids?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plant_assignment_audit_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "plant_assignment_audit_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plant_assignment_audit_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "plant_assignment_audit_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plant_edit_audit_log: {
        Row: {
          created_at: string
          field_changed: string
          id: string
          new_value: string | null
          old_value: string | null
          plant_id: string
          timestamp: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          field_changed: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          plant_id: string
          timestamp?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          field_changed?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          plant_id?: string
          timestamp?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plant_edit_audit_log_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plant_edit_audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "plant_edit_audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plant_meter_config: {
        Row: {
          config: Json
          permeate_is_production: boolean
          plant_id: string
          updated_at: string | null
        }
        Insert: {
          config?: Json
          permeate_is_production?: boolean
          plant_id: string
          updated_at?: string | null
        }
        Update: {
          config?: Json
          permeate_is_production?: boolean
          plant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plant_meter_config_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: true
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      plant_multiplier_cache: {
        Row: {
          cached_at: string
          effective_mult: number
          invalidated: boolean
          meter_index: number
          plant_id: string
        }
        Insert: {
          cached_at?: string
          effective_mult?: number
          invalidated?: boolean
          meter_index?: number
          plant_id: string
        }
        Update: {
          cached_at?: string
          effective_mult?: number
          invalidated?: boolean
          meter_index?: number
          plant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plant_multiplier_cache_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plant_power_config"
            referencedColumns: ["plant_id"]
          },
        ]
      }
      plant_power_config: {
        Row: {
          grid_meter_count: number
          grid_meter_multipliers: number[]
          grid_meter_names: string[]
          plant_id: string
          solar_meter_count: number
          solar_meter_names: string[]
          updated_at: string
        }
        Insert: {
          grid_meter_count?: number
          grid_meter_multipliers?: number[]
          grid_meter_names?: string[]
          plant_id: string
          solar_meter_count?: number
          solar_meter_names?: string[]
          updated_at?: string
        }
        Update: {
          grid_meter_count?: number
          grid_meter_multipliers?: number[]
          grid_meter_names?: string[]
          plant_id?: string
          solar_meter_count?: number
          solar_meter_names?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plant_power_config_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: true
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      plant_topology_links: {
        Row: {
          created_at: string
          created_by: string | null
          from_id: string
          id: string
          plant_id: string
          to_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_id: string
          id?: string
          plant_id: string
          to_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_id?: string
          id?: string
          plant_id?: string
          to_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plant_topology_links_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      plants: {
        Row: {
          address: string | null
          backwash_mode: string
          created_at: string
          design_capacity_m3: number | null
          filter_housing_type: string
          filter_media_type: string
          geofence_radius_m: number
          gps_lat: number | null
          gps_lng: number | null
          has_grid: boolean
          has_solar: boolean
          id: string
          name: string
          num_ro_trains: number
          solar_capacity_kw: number | null
          status: Database["public"]["Enums"]["plant_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          backwash_mode?: string
          created_at?: string
          design_capacity_m3?: number | null
          filter_housing_type?: string
          filter_media_type?: string
          geofence_radius_m?: number
          gps_lat?: number | null
          gps_lng?: number | null
          has_grid?: boolean
          has_solar?: boolean
          id?: string
          name: string
          num_ro_trains?: number
          solar_capacity_kw?: number | null
          status?: Database["public"]["Enums"]["plant_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          backwash_mode?: string
          created_at?: string
          design_capacity_m3?: number | null
          filter_housing_type?: string
          filter_media_type?: string
          geofence_radius_m?: number
          gps_lat?: number | null
          gps_lng?: number | null
          has_grid?: boolean
          has_solar?: boolean
          id?: string
          name?: string
          num_ro_trains?: number
          solar_capacity_kw?: number | null
          status?: Database["public"]["Enums"]["plant_status"]
          updated_at?: string
        }
        Relationships: []
      }
      power_meter_changes: {
        Row: {
          change_date: string
          changed_by: string | null
          created_at: string
          id: string
          meter_index: number
          new_multiplier: number
          notes: string | null
          old_multiplier: number
          plant_id: string
        }
        Insert: {
          change_date: string
          changed_by?: string | null
          created_at?: string
          id?: string
          meter_index?: number
          new_multiplier?: number
          notes?: string | null
          old_multiplier?: number
          plant_id: string
        }
        Update: {
          change_date?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          meter_index?: number
          new_multiplier?: number
          notes?: string | null
          old_multiplier?: number
          plant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "power_meter_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "power_meter_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "power_meter_changes_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      power_readings: {
        Row: {
          cache_recalculated_at: string | null
          created_at: string
          daily_consumption_kwh: number | null
          daily_grid_kwh: number | null
          daily_solar_kwh: number | null
          grid_meter_readings: Json | null
          id: string
          is_meter_replacement: boolean | null
          meter_multiplier: number | null
          meter_reading_kwh: number
          multiplier: number | null
          plant_id: string
          reading_datetime: string
          recorded_by: string | null
          solar_meter_reading: number | null
        }
        Insert: {
          cache_recalculated_at?: string | null
          created_at?: string
          daily_consumption_kwh?: number | null
          daily_grid_kwh?: number | null
          daily_solar_kwh?: number | null
          grid_meter_readings?: Json | null
          id?: string
          is_meter_replacement?: boolean | null
          meter_multiplier?: number | null
          meter_reading_kwh: number
          multiplier?: number | null
          plant_id: string
          reading_datetime?: string
          recorded_by?: string | null
          solar_meter_reading?: number | null
        }
        Update: {
          cache_recalculated_at?: string | null
          created_at?: string
          daily_consumption_kwh?: number | null
          daily_grid_kwh?: number | null
          daily_solar_kwh?: number | null
          grid_meter_readings?: Json | null
          id?: string
          is_meter_replacement?: boolean | null
          meter_multiplier?: number | null
          meter_reading_kwh?: number
          multiplier?: number | null
          plant_id?: string
          reading_datetime?: string
          recorded_by?: string | null
          solar_meter_reading?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "power_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "power_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "power_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      power_tariffs: {
        Row: {
          created_at: string
          created_by: string | null
          effective_date: string
          id: string
          multiplier: number
          plant_id: string
          provider: string | null
          rate_per_kwh: number
          remarks: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_date: string
          id?: string
          multiplier?: number
          plant_id: string
          provider?: string | null
          rate_per_kwh: number
          remarks?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_date?: string
          id?: string
          multiplier?: number
          plant_id?: string
          provider?: string | null
          rate_per_kwh?: number
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "power_tariffs_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_meter_audit_log: {
        Row: {
          id: string
          meter_id: string | null
          meter_name: string
          new_value: string | null
          old_value: string | null
          plant_id: string | null
          timestamp: string
          user_id: string | null
        }
        Insert: {
          id?: string
          meter_id?: string | null
          meter_name: string
          new_value?: string | null
          old_value?: string | null
          plant_id?: string | null
          timestamp?: string
          user_id?: string | null
        }
        Update: {
          id?: string
          meter_id?: string | null
          meter_name?: string
          new_value?: string | null
          old_value?: string | null
          plant_id?: string | null
          timestamp?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_meter_audit_log_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_meter_readings: {
        Row: {
          created_at: string
          current_reading: number | null
          daily_volume: number | null
          id: string
          is_estimated: boolean
          is_meter_replacement: boolean | null
          is_meter_rollover: boolean
          locked_at: string | null
          locked_by: string | null
          meter_id: string
          meter_rollover_max: number | null
          norm_status: string | null
          plant_id: string
          previous_reading: number | null
          production_volume: number | null
          reading_datetime: string
          recorded_by: string | null
        }
        Insert: {
          created_at?: string
          current_reading?: number | null
          daily_volume?: number | null
          id?: string
          is_estimated?: boolean
          is_meter_replacement?: boolean | null
          is_meter_rollover?: boolean
          locked_at?: string | null
          locked_by?: string | null
          meter_id: string
          meter_rollover_max?: number | null
          norm_status?: string | null
          plant_id: string
          previous_reading?: number | null
          production_volume?: number | null
          reading_datetime?: string
          recorded_by?: string | null
        }
        Update: {
          created_at?: string
          current_reading?: number | null
          daily_volume?: number | null
          id?: string
          is_estimated?: boolean
          is_meter_replacement?: boolean | null
          is_meter_rollover?: boolean
          locked_at?: string | null
          locked_by?: string | null
          meter_id?: string
          meter_rollover_max?: number | null
          norm_status?: string | null
          plant_id?: string
          previous_reading?: number | null
          production_volume?: number | null
          reading_datetime?: string
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_meter_readings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_meter_readings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_meter_readings_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "product_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_meter_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_meter_replacements: {
        Row: {
          created_at: string
          id: string
          meter_id: string
          new_meter_brand: string | null
          new_meter_initial_reading: number | null
          new_meter_installed_date: string | null
          new_meter_serial: string | null
          new_meter_size: string | null
          old_meter_brand: string | null
          old_meter_final_reading: number | null
          old_meter_serial: string | null
          old_meter_size: string | null
          plant_id: string
          reading_id: string | null
          remarks: string | null
          replaced_by: string | null
          replacement_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          meter_id: string
          new_meter_brand?: string | null
          new_meter_initial_reading?: number | null
          new_meter_installed_date?: string | null
          new_meter_serial?: string | null
          new_meter_size?: string | null
          old_meter_brand?: string | null
          old_meter_final_reading?: number | null
          old_meter_serial?: string | null
          old_meter_size?: string | null
          plant_id: string
          reading_id?: string | null
          remarks?: string | null
          replaced_by?: string | null
          replacement_date: string
        }
        Update: {
          created_at?: string
          id?: string
          meter_id?: string
          new_meter_brand?: string | null
          new_meter_initial_reading?: number | null
          new_meter_installed_date?: string | null
          new_meter_serial?: string | null
          new_meter_size?: string | null
          old_meter_brand?: string | null
          old_meter_final_reading?: number | null
          old_meter_serial?: string | null
          old_meter_size?: string | null
          plant_id?: string
          reading_id?: string | null
          remarks?: string | null
          replaced_by?: string | null
          replacement_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_meter_replacements_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "product_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_meter_replacements_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_meter_replacements_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "product_meter_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_meter_replacements_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "product_meter_readings_clean"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_meter_replacements_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_meter_replacements_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_meters: {
        Row: {
          created_at: string
          derived_from_locator_id: string | null
          id: string
          is_derived: boolean
          meter_serial: string | null
          name: string
          plant_id: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          derived_from_locator_id?: string | null
          id?: string
          is_derived?: boolean
          meter_serial?: string | null
          name: string
          plant_id: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          derived_from_locator_id?: string | null
          id?: string
          is_derived?: boolean
          meter_serial?: string | null
          name?: string
          plant_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_meters_derived_from_locator_id_fkey"
            columns: ["derived_from_locator_id"]
            isOneToOne: false
            referencedRelation: "locators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_meters_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      production_calc_log: {
        Row: {
          entry_name: string | null
          id: string
          meter_id: string | null
          meter_name: string | null
          plant_id: string | null
          production_volume: number
          timestamp: string
          user_id: string | null
        }
        Insert: {
          entry_name?: string | null
          id?: string
          meter_id?: string | null
          meter_name?: string | null
          plant_id?: string | null
          production_volume: number
          timestamp?: string
          user_id?: string | null
        }
        Update: {
          entry_name?: string | null
          id?: string
          meter_id?: string | null
          meter_name?: string | null
          plant_id?: string | null
          production_volume?: number
          timestamp?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_calc_log_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      production_costs: {
        Row: {
          chem_cost: number
          cost_date: string
          cost_per_m3: number | null
          driver_notes: string | null
          filter_cost: number
          id: string
          plant_id: string
          power_cost: number
          production_m3: number
          solar_cost: number
          total_cost: number | null
          updated_at: string
        }
        Insert: {
          chem_cost?: number
          cost_date: string
          cost_per_m3?: number | null
          driver_notes?: string | null
          filter_cost?: number
          id?: string
          plant_id: string
          power_cost?: number
          production_m3?: number
          solar_cost?: number
          total_cost?: number | null
          updated_at?: string
        }
        Update: {
          chem_cost?: number
          cost_date?: string
          cost_per_m3?: number | null
          driver_notes?: string | null
          filter_cost?: number
          id?: string
          plant_id?: string
          power_cost?: number
          production_m3?: number
          solar_cost?: number
          total_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_costs_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      pump_readings: {
        Row: {
          created_at: string
          id: string
          l1_amp: number | null
          l2_amp: number | null
          l3_amp: number | null
          plant_id: string
          pump_number: number
          pump_type: string
          reading_datetime: string
          recorded_by: string | null
          target_pressure_psi: number | null
          train_id: string
          voltage: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          l1_amp?: number | null
          l2_amp?: number | null
          l3_amp?: number | null
          plant_id: string
          pump_number: number
          pump_type: string
          reading_datetime?: string
          recorded_by?: string | null
          target_pressure_psi?: number | null
          train_id: string
          voltage?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          l1_amp?: number | null
          l2_amp?: number | null
          l3_amp?: number | null
          plant_id?: string
          pump_number?: number
          pump_type?: string
          reading_datetime?: string
          recorded_by?: string | null
          target_pressure_psi?: number | null
          train_id?: string
          voltage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pump_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pump_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "pump_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pump_readings_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_edit_log: {
        Row: {
          column_name: string
          edited_at: string
          edited_by: string | null
          edited_role: string
          id: string
          new_value: number | null
          note: string | null
          old_value: number | null
          source_id: string
          source_table: string
        }
        Insert: {
          column_name: string
          edited_at?: string
          edited_by?: string | null
          edited_role: string
          id?: string
          new_value?: number | null
          note?: string | null
          old_value?: number | null
          source_id: string
          source_table: string
        }
        Update: {
          column_name?: string
          edited_at?: string
          edited_by?: string | null
          edited_role?: string
          id?: string
          new_value?: number | null
          note?: string | null
          old_value?: number | null
          source_id?: string
          source_table?: string
        }
        Relationships: []
      }
      reading_edit_audit_log: {
        Row: {
          action: string
          actor_label: string | null
          actor_user_id: string | null
          changes: Json | null
          edited_at: string
          id: string
          plant_id: string | null
          record_id: string | null
          table_name: string
          train_id: string | null
        }
        Insert: {
          action?: string
          actor_label?: string | null
          actor_user_id?: string | null
          changes?: Json | null
          edited_at?: string
          id?: string
          plant_id?: string | null
          record_id?: string | null
          table_name: string
          train_id?: string | null
        }
        Update: {
          action?: string
          actor_label?: string | null
          actor_user_id?: string | null
          changes?: Json | null
          edited_at?: string
          id?: string
          plant_id?: string | null
          record_id?: string | null
          table_name?: string
          train_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reading_edit_audit_log_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_anomaly_remarks: {
        Row: {
          avg_flow_rate: number | null
          deviation_pct: number
          direction: string
          flow_rate: number | null
          id: string
          logged_at: string
          logged_by: string | null
          meter_kind: string | null
          plant_id: string
          rate_unit: string
          record_id: string
          remark_text: string
          table_name: string
          tier: string
        }
        Insert: {
          avg_flow_rate?: number | null
          deviation_pct: number
          direction: string
          flow_rate?: number | null
          id?: string
          logged_at?: string
          logged_by?: string | null
          meter_kind?: string | null
          plant_id: string
          rate_unit?: string
          record_id: string
          remark_text: string
          table_name: string
          tier: string
        }
        Update: {
          avg_flow_rate?: number | null
          deviation_pct?: number
          direction?: string
          flow_rate?: number | null
          id?: string
          logged_at?: string
          logged_by?: string | null
          meter_kind?: string | null
          plant_id?: string
          rate_unit?: string
          record_id?: string
          remark_text?: string
          table_name?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_anomaly_remarks_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_gap_reasons: {
        Row: {
          entity_id: string
          entity_type: string
          gap_date: string
          id: string
          logged_at: string
          logged_by: string | null
          plant_id: string
          reason_category: string
          reason_detail: string | null
        }
        Insert: {
          entity_id: string
          entity_type: string
          gap_date: string
          id?: string
          logged_at?: string
          logged_by?: string | null
          plant_id: string
          reason_category: string
          reason_detail?: string | null
        }
        Update: {
          entity_id?: string
          entity_type?: string
          gap_date?: string
          id?: string
          logged_at?: string
          logged_by?: string | null
          plant_id?: string
          reason_category?: string
          reason_detail?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reading_gap_reasons_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_normalizations: {
        Row: {
          action: Database["public"]["Enums"]["reading_norm_action"]
          adjusted_value: number | null
          id: string
          note: string | null
          original_value: number | null
          performed_at: string
          performed_by: string | null
          performed_role: string
          retractable: boolean
          source_id: string
          source_table: string
        }
        Insert: {
          action: Database["public"]["Enums"]["reading_norm_action"]
          adjusted_value?: number | null
          id?: string
          note?: string | null
          original_value?: number | null
          performed_at?: string
          performed_by?: string | null
          performed_role: string
          retractable?: boolean
          source_id: string
          source_table: string
        }
        Update: {
          action?: Database["public"]["Enums"]["reading_norm_action"]
          adjusted_value?: number | null
          id?: string
          note?: string | null
          original_value?: number | null
          performed_at?: string
          performed_by?: string | null
          performed_role?: string
          retractable?: boolean
          source_id?: string
          source_table?: string
        }
        Relationships: []
      }
      regression_results: {
        Row: {
          column_name: string
          corrections: Json
          created_at: string
          created_by: string | null
          created_role: string
          date_from: string | null
          date_to: string | null
          id: string
          intercept: number | null
          plant_id: string | null
          r_squared: number | null
          row_count: number
          slope: number | null
          source_table: string
          status: string
        }
        Insert: {
          column_name: string
          corrections?: Json
          created_at?: string
          created_by?: string | null
          created_role?: string
          date_from?: string | null
          date_to?: string | null
          id?: string
          intercept?: number | null
          plant_id?: string | null
          r_squared?: number | null
          row_count?: number
          slope?: number | null
          source_table: string
          status?: string
        }
        Update: {
          column_name?: string
          corrections?: Json
          created_at?: string
          created_by?: string | null
          created_role?: string
          date_from?: string | null
          date_to?: string | null
          id?: string
          intercept?: number | null
          plant_id?: string | null
          r_squared?: number | null
          row_count?: number
          slope?: number | null
          source_table?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "regression_results_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      ro_plant_users: {
        Row: {
          created_at: string
          id: string
          plant_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          plant_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          plant_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ro_plant_users_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "ro_plants"
            referencedColumns: ["id"]
          },
        ]
      }
      ro_plants: {
        Row: {
          created_at: string
          id: string
          location: string | null
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string | null
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          location?: string | null
          name?: string
        }
        Relationships: []
      }
      ro_pretreatment_readings: {
        Row: {
          afm_units: Json | null
          backwash_end: string | null
          backwash_start: string | null
          bag_filters_changed: number | null
          booster_pumps: Json | null
          cartridge_filter_housings: Json | null
          cartridges_changed: number
          created_at: string
          filter_housings: Json | null
          hpp_target_pressure_psi: number | null
          id: string
          incomplete_reason: string | null
          mmf_readings: Json | null
          plant_id: string
          reading_datetime: string
          recorded_by: string | null
          remarks: string | null
          train_id: string
        }
        Insert: {
          afm_units?: Json | null
          backwash_end?: string | null
          backwash_start?: string | null
          bag_filters_changed?: number | null
          booster_pumps?: Json | null
          cartridge_filter_housings?: Json | null
          cartridges_changed?: number
          created_at?: string
          filter_housings?: Json | null
          hpp_target_pressure_psi?: number | null
          id?: string
          incomplete_reason?: string | null
          mmf_readings?: Json | null
          plant_id: string
          reading_datetime?: string
          recorded_by?: string | null
          remarks?: string | null
          train_id: string
        }
        Update: {
          afm_units?: Json | null
          backwash_end?: string | null
          backwash_start?: string | null
          bag_filters_changed?: number | null
          booster_pumps?: Json | null
          cartridge_filter_housings?: Json | null
          cartridges_changed?: number
          created_at?: string
          filter_housings?: Json | null
          hpp_target_pressure_psi?: number | null
          id?: string
          incomplete_reason?: string | null
          mmf_readings?: Json | null
          plant_id?: string
          reading_datetime?: string
          recorded_by?: string | null
          remarks?: string | null
          train_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ro_pretreatment_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_pretreatment_readings_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      ro_train_meter_replacements: {
        Row: {
          created_at: string
          id: string
          meter_type: string
          new_meter_brand: string | null
          new_meter_initial_reading: number | null
          new_meter_installed_date: string | null
          new_meter_serial: string | null
          new_meter_size: string | null
          old_meter_final_reading: number | null
          old_meter_serial: string | null
          plant_id: string
          reading_id: string | null
          remarks: string | null
          replaced_by: string | null
          replacement_date: string
          train_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          meter_type: string
          new_meter_brand?: string | null
          new_meter_initial_reading?: number | null
          new_meter_installed_date?: string | null
          new_meter_serial?: string | null
          new_meter_size?: string | null
          old_meter_final_reading?: number | null
          old_meter_serial?: string | null
          plant_id: string
          reading_id?: string | null
          remarks?: string | null
          replaced_by?: string | null
          replacement_date: string
          train_id: string
        }
        Update: {
          created_at?: string
          id?: string
          meter_type?: string
          new_meter_brand?: string | null
          new_meter_initial_reading?: number | null
          new_meter_installed_date?: string | null
          new_meter_serial?: string | null
          new_meter_size?: string | null
          old_meter_final_reading?: number | null
          old_meter_serial?: string | null
          plant_id?: string
          reading_id?: string | null
          remarks?: string | null
          replaced_by?: string | null
          replacement_date?: string
          train_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ro_train_meter_replacements_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_meter_replacements_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "ro_train_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_meter_replacements_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "ro_train_readings_clean"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_meter_replacements_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "ro_train_readings_latest"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_meter_replacements_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "v_ro_train_power_allocated"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_meter_replacements_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ro_train_meter_replacements_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_meter_replacements_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      ro_train_readings: {
        Row: {
          chlorine_residual_mg_l: number | null
          created_at: string
          dp_psi: number | null
          feed_flow: number | null
          feed_meter: number | null
          feed_meter_delta: number | null
          feed_meter_prev: number | null
          feed_ph: number | null
          feed_pressure_psi: number | null
          feed_tds: number | null
          id: string
          incomplete_reason: string | null
          is_feed_meter_replacement: boolean
          is_meter_replacement: boolean | null
          is_permeate_meter_replacement: boolean
          is_reject_meter_replacement: boolean
          norm_status: string | null
          permeate_flow: number | null
          permeate_meter: number | null
          permeate_meter_delta: number | null
          permeate_meter_prev: number | null
          permeate_ph: number | null
          permeate_production_date: string | null
          permeate_tds: number | null
          plant_id: string
          power_avg_kw: number | null
          power_delta_kwh: number | null
          power_meter_reading_kwh: number | null
          reading_datetime: string
          recorded_by: string | null
          recovery_pct: number | null
          reject_flow: number | null
          reject_meter: number | null
          reject_meter_delta: number | null
          reject_meter_prev: number | null
          reject_ph: number | null
          reject_pressure_psi: number | null
          reject_tds: number | null
          rejection_pct: number | null
          remarks: string | null
          salt_passage_pct: number | null
          shared_power_meter_group: string | null
          specific_energy_kwh_m3: number | null
          suction_pressure_psi: number | null
          temperature_c: number | null
          train_id: string
          turbidity_ntu: number | null
        }
        Insert: {
          chlorine_residual_mg_l?: number | null
          created_at?: string
          dp_psi?: number | null
          feed_flow?: number | null
          feed_meter?: number | null
          feed_meter_delta?: number | null
          feed_meter_prev?: number | null
          feed_ph?: number | null
          feed_pressure_psi?: number | null
          feed_tds?: number | null
          id?: string
          incomplete_reason?: string | null
          is_feed_meter_replacement?: boolean
          is_meter_replacement?: boolean | null
          is_permeate_meter_replacement?: boolean
          is_reject_meter_replacement?: boolean
          norm_status?: string | null
          permeate_flow?: number | null
          permeate_meter?: number | null
          permeate_meter_delta?: number | null
          permeate_meter_prev?: number | null
          permeate_ph?: number | null
          permeate_production_date?: string | null
          permeate_tds?: number | null
          plant_id: string
          power_avg_kw?: number | null
          power_delta_kwh?: number | null
          power_meter_reading_kwh?: number | null
          reading_datetime?: string
          recorded_by?: string | null
          recovery_pct?: number | null
          reject_flow?: number | null
          reject_meter?: number | null
          reject_meter_delta?: number | null
          reject_meter_prev?: number | null
          reject_ph?: number | null
          reject_pressure_psi?: number | null
          reject_tds?: number | null
          rejection_pct?: number | null
          remarks?: string | null
          salt_passage_pct?: number | null
          shared_power_meter_group?: string | null
          specific_energy_kwh_m3?: number | null
          suction_pressure_psi?: number | null
          temperature_c?: number | null
          train_id: string
          turbidity_ntu?: number | null
        }
        Update: {
          chlorine_residual_mg_l?: number | null
          created_at?: string
          dp_psi?: number | null
          feed_flow?: number | null
          feed_meter?: number | null
          feed_meter_delta?: number | null
          feed_meter_prev?: number | null
          feed_ph?: number | null
          feed_pressure_psi?: number | null
          feed_tds?: number | null
          id?: string
          incomplete_reason?: string | null
          is_feed_meter_replacement?: boolean
          is_meter_replacement?: boolean | null
          is_permeate_meter_replacement?: boolean
          is_reject_meter_replacement?: boolean
          norm_status?: string | null
          permeate_flow?: number | null
          permeate_meter?: number | null
          permeate_meter_delta?: number | null
          permeate_meter_prev?: number | null
          permeate_ph?: number | null
          permeate_production_date?: string | null
          permeate_tds?: number | null
          plant_id?: string
          power_avg_kw?: number | null
          power_delta_kwh?: number | null
          power_meter_reading_kwh?: number | null
          reading_datetime?: string
          recorded_by?: string | null
          recovery_pct?: number | null
          reject_flow?: number | null
          reject_meter?: number | null
          reject_meter_delta?: number | null
          reject_meter_prev?: number | null
          reject_ph?: number | null
          reject_pressure_psi?: number | null
          reject_tds?: number | null
          rejection_pct?: number | null
          remarks?: string | null
          salt_passage_pct?: number | null
          shared_power_meter_group?: string | null
          specific_energy_kwh_m3?: number | null
          suction_pressure_psi?: number | null
          temperature_c?: number | null
          train_id?: string
          turbidity_ntu?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ro_train_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ro_train_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_readings_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      ro_trains: {
        Row: {
          booster_pump_targets: Json | null
          created_at: string
          feed_meter_brand: string | null
          feed_meter_installed_date: string | null
          feed_meter_serial: string | null
          feed_meter_size: string | null
          filter_housing_type: string | null
          filter_media_type: string | null
          hpp_target_pressure_psi: number | null
          id: string
          name: string | null
          num_afm: number
          num_booster_pumps: number
          num_cartridge_filters: number
          num_controllers: number
          num_filter_housings: number
          num_hp_pumps: number
          permeate_meter_brand: string | null
          permeate_meter_installed_date: string | null
          permeate_meter_serial: string | null
          permeate_meter_size: string | null
          plant_id: string
          product_meter_id: string | null
          reject_meter_brand: string | null
          reject_meter_installed_date: string | null
          reject_meter_serial: string | null
          reject_meter_size: string | null
          shared_power_meter_group: string | null
          status: Database["public"]["Enums"]["train_status"]
          train_number: number
          updated_at: string
          well_id: string | null
        }
        Insert: {
          booster_pump_targets?: Json | null
          created_at?: string
          feed_meter_brand?: string | null
          feed_meter_installed_date?: string | null
          feed_meter_serial?: string | null
          feed_meter_size?: string | null
          filter_housing_type?: string | null
          filter_media_type?: string | null
          hpp_target_pressure_psi?: number | null
          id?: string
          name?: string | null
          num_afm?: number
          num_booster_pumps?: number
          num_cartridge_filters?: number
          num_controllers?: number
          num_filter_housings?: number
          num_hp_pumps?: number
          permeate_meter_brand?: string | null
          permeate_meter_installed_date?: string | null
          permeate_meter_serial?: string | null
          permeate_meter_size?: string | null
          plant_id: string
          product_meter_id?: string | null
          reject_meter_brand?: string | null
          reject_meter_installed_date?: string | null
          reject_meter_serial?: string | null
          reject_meter_size?: string | null
          shared_power_meter_group?: string | null
          status?: Database["public"]["Enums"]["train_status"]
          train_number: number
          updated_at?: string
          well_id?: string | null
        }
        Update: {
          booster_pump_targets?: Json | null
          created_at?: string
          feed_meter_brand?: string | null
          feed_meter_installed_date?: string | null
          feed_meter_serial?: string | null
          feed_meter_size?: string | null
          filter_housing_type?: string | null
          filter_media_type?: string | null
          hpp_target_pressure_psi?: number | null
          id?: string
          name?: string | null
          num_afm?: number
          num_booster_pumps?: number
          num_cartridge_filters?: number
          num_controllers?: number
          num_filter_housings?: number
          num_hp_pumps?: number
          permeate_meter_brand?: string | null
          permeate_meter_installed_date?: string | null
          permeate_meter_serial?: string | null
          permeate_meter_size?: string | null
          plant_id?: string
          product_meter_id?: string | null
          reject_meter_brand?: string | null
          reject_meter_installed_date?: string | null
          reject_meter_serial?: string | null
          reject_meter_size?: string | null
          shared_power_meter_group?: string | null
          status?: Database["public"]["Enums"]["train_status"]
          train_number?: number
          updated_at?: string
          well_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ro_trains_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_trains_product_meter_id_fkey"
            columns: ["product_meter_id"]
            isOneToOne: false
            referencedRelation: "product_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_trains_well_id_fkey"
            columns: ["well_id"]
            isOneToOne: false
            referencedRelation: "wells"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_audit: {
        Row: {
          created_at: string
          designation: string | null
          device_id: string | null
          email: string
          id: string
          operator_count: number | null
          plant_ids: string[] | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          designation?: string | null
          device_id?: string | null
          email: string
          id?: string
          operator_count?: number | null
          plant_ids?: string[] | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          designation?: string | null
          device_id?: string | null
          email?: string
          id?: string
          operator_count?: number | null
          plant_ids?: string[] | null
          user_agent?: string | null
        }
        Relationships: []
      }
      status_checks: {
        Row: {
          client_name: string
          created_at: string
          id: string
        }
        Insert: {
          client_name: string
          created_at?: string
          id?: string
        }
        Update: {
          client_name?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      train_status_log: {
        Row: {
          confirmed_at: string
          confirmed_by: string | null
          id: string
          plant_id: string
          reason: string | null
          status: string
          train_id: string
        }
        Insert: {
          confirmed_at?: string
          confirmed_by?: string | null
          id?: string
          plant_id: string
          reason?: string | null
          status: string
          train_id: string
        }
        Update: {
          confirmed_at?: string
          confirmed_by?: string | null
          id?: string
          plant_id?: string
          reason?: string | null
          status?: string
          train_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "train_status_log_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "train_status_log_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          confirmed: boolean
          created_at: string
          designation: string | null
          email: string | null
          first_name: string | null
          id: string
          immediate_head_id: string | null
          last_name: string | null
          last_seen_at: string | null
          middle_name: string | null
          plant_assignments: string[]
          profile_complete: boolean
          status: Database["public"]["Enums"]["profile_status"]
          suffix: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          confirmed?: boolean
          created_at?: string
          designation?: string | null
          email?: string | null
          first_name?: string | null
          id: string
          immediate_head_id?: string | null
          last_name?: string | null
          last_seen_at?: string | null
          middle_name?: string | null
          plant_assignments?: string[]
          profile_complete?: boolean
          status?: Database["public"]["Enums"]["profile_status"]
          suffix?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          confirmed?: boolean
          created_at?: string
          designation?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          immediate_head_id?: string | null
          last_name?: string | null
          last_seen_at?: string | null
          middle_name?: string | null
          plant_assignments?: string[]
          profile_complete?: boolean
          status?: Database["public"]["Enums"]["profile_status"]
          suffix?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_immediate_head_id_fkey"
            columns: ["immediate_head_id"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_profiles_immediate_head_id_fkey"
            columns: ["immediate_head_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      well_blending: {
        Row: {
          plant_id: string
          tagged_at: string
          tagged_by: string | null
          well_id: string
        }
        Insert: {
          plant_id: string
          tagged_at?: string
          tagged_by?: string | null
          well_id: string
        }
        Update: {
          plant_id?: string
          tagged_at?: string
          tagged_by?: string | null
          well_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "well_blending_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_blending_well_id_fkey"
            columns: ["well_id"]
            isOneToOne: true
            referencedRelation: "wells"
            referencedColumns: ["id"]
          },
        ]
      }
      well_meter_replacements: {
        Row: {
          created_at: string
          id: string
          new_brand: string | null
          new_initial_reading: number | null
          new_installed_date: string | null
          new_serial: string | null
          new_size: string | null
          old_final_reading: number | null
          old_serial: string | null
          plant_id: string
          reading_id: string | null
          remarks: string | null
          replaced_by: string | null
          replacement_date: string
          well_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          new_brand?: string | null
          new_initial_reading?: number | null
          new_installed_date?: string | null
          new_serial?: string | null
          new_size?: string | null
          old_final_reading?: number | null
          old_serial?: string | null
          plant_id: string
          reading_id?: string | null
          remarks?: string | null
          replaced_by?: string | null
          replacement_date: string
          well_id: string
        }
        Update: {
          created_at?: string
          id?: string
          new_brand?: string | null
          new_initial_reading?: number | null
          new_installed_date?: string | null
          new_serial?: string | null
          new_size?: string | null
          old_final_reading?: number | null
          old_serial?: string | null
          plant_id?: string
          reading_id?: string | null
          remarks?: string | null
          replaced_by?: string | null
          replacement_date?: string
          well_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "well_meter_replacements_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_meter_replacements_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "well_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_meter_replacements_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "well_readings_clean"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_meter_replacements_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "well_meter_replacements_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_meter_replacements_well_id_fkey"
            columns: ["well_id"]
            isOneToOne: false
            referencedRelation: "wells"
            referencedColumns: ["id"]
          },
        ]
      }
      well_pms_records: {
        Row: {
          created_at: string
          date_gathered: string
          drilling_depth_m: number | null
          id: string
          motor_hp: number | null
          plant_id: string
          pump_installed: string | null
          pump_setting: string | null
          pumping_water_level_m: number | null
          record_type: string
          recorded_by: string | null
          remarks: string | null
          static_water_level_m: number | null
          tds_ppm: number | null
          turbidity_ntu: number | null
          well_id: string
        }
        Insert: {
          created_at?: string
          date_gathered: string
          drilling_depth_m?: number | null
          id?: string
          motor_hp?: number | null
          plant_id: string
          pump_installed?: string | null
          pump_setting?: string | null
          pumping_water_level_m?: number | null
          record_type?: string
          recorded_by?: string | null
          remarks?: string | null
          static_water_level_m?: number | null
          tds_ppm?: number | null
          turbidity_ntu?: number | null
          well_id: string
        }
        Update: {
          created_at?: string
          date_gathered?: string
          drilling_depth_m?: number | null
          id?: string
          motor_hp?: number | null
          plant_id?: string
          pump_installed?: string | null
          pump_setting?: string | null
          pumping_water_level_m?: number | null
          record_type?: string
          recorded_by?: string | null
          remarks?: string | null
          static_water_level_m?: number | null
          tds_ppm?: number | null
          turbidity_ntu?: number | null
          well_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "well_pms_records_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_pms_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "well_pms_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_pms_records_well_id_fkey"
            columns: ["well_id"]
            isOneToOne: false
            referencedRelation: "wells"
            referencedColumns: ["id"]
          },
        ]
      }
      well_readings: {
        Row: {
          created_at: string
          current_reading: number | null
          daily_power_kwh: number | null
          daily_volume: number | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          is_meter_replacement: boolean | null
          is_meter_rollover: boolean
          locked_at: string | null
          locked_by: string | null
          meter_rollover_max: number | null
          norm_status: string | null
          off_location_flag: boolean
          plant_id: string
          power_meter_reading: number | null
          pressure_psi: number | null
          previous_reading: number | null
          reading_datetime: string
          recorded_by: string | null
          tds_ppm: number | null
          turbidity_ntu: number | null
          well_id: string
        }
        Insert: {
          created_at?: string
          current_reading?: number | null
          daily_power_kwh?: number | null
          daily_volume?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          is_meter_replacement?: boolean | null
          is_meter_rollover?: boolean
          locked_at?: string | null
          locked_by?: string | null
          meter_rollover_max?: number | null
          norm_status?: string | null
          off_location_flag?: boolean
          plant_id: string
          power_meter_reading?: number | null
          pressure_psi?: number | null
          previous_reading?: number | null
          reading_datetime?: string
          recorded_by?: string | null
          tds_ppm?: number | null
          turbidity_ntu?: number | null
          well_id: string
        }
        Update: {
          created_at?: string
          current_reading?: number | null
          daily_power_kwh?: number | null
          daily_volume?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          is_meter_replacement?: boolean | null
          is_meter_rollover?: boolean
          locked_at?: string | null
          locked_by?: string | null
          meter_rollover_max?: number | null
          norm_status?: string | null
          off_location_flag?: boolean
          plant_id?: string
          power_meter_reading?: number | null
          pressure_psi?: number | null
          previous_reading?: number | null
          reading_datetime?: string
          recorded_by?: string | null
          tds_ppm?: number | null
          turbidity_ntu?: number | null
          well_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "well_readings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "well_readings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "well_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_readings_well_id_fkey"
            columns: ["well_id"]
            isOneToOne: false
            referencedRelation: "wells"
            referencedColumns: ["id"]
          },
        ]
      }
      wells: {
        Row: {
          created_at: string
          diameter: string | null
          drilling_depth_m: number | null
          electric_meter_brand: string | null
          electric_meter_installed_date: string | null
          electric_meter_serial: string | null
          electric_meter_size: string | null
          gps_lat: number | null
          gps_lng: number | null
          has_power_meter: boolean
          id: string
          is_blending_well: boolean
          meter_brand: string | null
          meter_installed_date: string | null
          meter_rollover_max: number | null
          meter_serial: string | null
          meter_size: string | null
          name: string
          plant_id: string
          size: string | null
          status: Database["public"]["Enums"]["plant_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          diameter?: string | null
          drilling_depth_m?: number | null
          electric_meter_brand?: string | null
          electric_meter_installed_date?: string | null
          electric_meter_serial?: string | null
          electric_meter_size?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          has_power_meter?: boolean
          id?: string
          is_blending_well?: boolean
          meter_brand?: string | null
          meter_installed_date?: string | null
          meter_rollover_max?: number | null
          meter_serial?: string | null
          meter_size?: string | null
          name: string
          plant_id: string
          size?: string | null
          status?: Database["public"]["Enums"]["plant_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          diameter?: string | null
          drilling_depth_m?: number | null
          electric_meter_brand?: string | null
          electric_meter_installed_date?: string | null
          electric_meter_serial?: string | null
          electric_meter_size?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          has_power_meter?: boolean
          id?: string
          is_blending_well?: boolean
          meter_brand?: string | null
          meter_installed_date?: string | null
          meter_rollover_max?: number | null
          meter_serial?: string | null
          meter_size?: string | null
          name?: string
          plant_id?: string
          size?: string | null
          status?: Database["public"]["Enums"]["plant_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wells_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      filter_usage_daily: {
        Row: {
          cost: number | null
          filter_housing_type: string | null
          id: string | null
          plant_id: string | null
          quantity_changed: number | null
          reading_date: string | null
          train_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ro_pretreatment_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_pretreatment_readings_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      locator_readings_clean: {
        Row: {
          created_at: string | null
          current_reading: number | null
          daily_volume: number | null
          gps_lat: number | null
          gps_lng: number | null
          id: string | null
          is_estimated: boolean | null
          is_meter_replacement: boolean | null
          is_meter_rollover: boolean | null
          locator_id: string | null
          locked_at: string | null
          locked_by: string | null
          meter_rollover_max: number | null
          norm_status: string | null
          off_location_flag: boolean | null
          plant_id: string | null
          previous_reading: number | null
          reading_datetime: string | null
          recorded_by: string | null
          remarks: string | null
        }
        Insert: {
          created_at?: string | null
          current_reading?: number | null
          daily_volume?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string | null
          is_estimated?: boolean | null
          is_meter_replacement?: boolean | null
          is_meter_rollover?: boolean | null
          locator_id?: string | null
          locked_at?: string | null
          locked_by?: string | null
          meter_rollover_max?: number | null
          norm_status?: string | null
          off_location_flag?: boolean | null
          plant_id?: string | null
          previous_reading?: number | null
          reading_datetime?: string | null
          recorded_by?: string | null
          remarks?: string | null
        }
        Update: {
          created_at?: string | null
          current_reading?: number | null
          daily_volume?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string | null
          is_estimated?: boolean | null
          is_meter_replacement?: boolean | null
          is_meter_rollover?: boolean | null
          locator_id?: string | null
          locked_at?: string | null
          locked_by?: string | null
          meter_rollover_max?: number | null
          norm_status?: string | null
          off_location_flag?: boolean | null
          plant_id?: string | null
          previous_reading?: number | null
          reading_datetime?: string | null
          recorded_by?: string | null
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locator_readings_locator_id_fkey"
            columns: ["locator_id"]
            isOneToOne: false
            referencedRelation: "locators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locator_readings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "locator_readings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locator_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locator_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "locator_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_error_rates_30d: {
        Row: {
          error_count: number | null
          last_error: string | null
          user_id: string | null
          username: string | null
        }
        Relationships: []
      }
      product_meter_readings_clean: {
        Row: {
          created_at: string | null
          current_reading: number | null
          daily_volume: number | null
          id: string | null
          is_meter_replacement: boolean | null
          is_meter_rollover: boolean | null
          locked_at: string | null
          locked_by: string | null
          meter_id: string | null
          meter_rollover_max: number | null
          norm_status: string | null
          plant_id: string | null
          previous_reading: number | null
          production_volume: number | null
          reading_datetime: string | null
          recorded_by: string | null
        }
        Insert: {
          created_at?: string | null
          current_reading?: number | null
          daily_volume?: number | null
          id?: string | null
          is_meter_replacement?: boolean | null
          is_meter_rollover?: boolean | null
          locked_at?: string | null
          locked_by?: string | null
          meter_id?: string | null
          meter_rollover_max?: number | null
          norm_status?: string | null
          plant_id?: string | null
          previous_reading?: number | null
          production_volume?: number | null
          reading_datetime?: string | null
          recorded_by?: string | null
        }
        Update: {
          created_at?: string | null
          current_reading?: number | null
          daily_volume?: number | null
          id?: string | null
          is_meter_replacement?: boolean | null
          is_meter_rollover?: boolean | null
          locked_at?: string | null
          locked_by?: string | null
          meter_id?: string | null
          meter_rollover_max?: number | null
          norm_status?: string | null
          plant_id?: string | null
          previous_reading?: number | null
          production_volume?: number | null
          reading_datetime?: string | null
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_meter_readings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_meter_readings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_meter_readings_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "product_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_meter_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      ro_train_readings_clean: {
        Row: {
          chlorine_residual_mg_l: number | null
          created_at: string | null
          dp_psi: number | null
          feed_flow: number | null
          feed_meter: number | null
          feed_meter_delta: number | null
          feed_meter_prev: number | null
          feed_ph: number | null
          feed_pressure_psi: number | null
          feed_tds: number | null
          id: string | null
          is_meter_replacement: boolean | null
          norm_status: string | null
          permeate_flow: number | null
          permeate_meter: number | null
          permeate_meter_delta: number | null
          permeate_meter_prev: number | null
          permeate_ph: number | null
          permeate_production_date: string | null
          permeate_tds: number | null
          plant_id: string | null
          power_avg_kw: number | null
          power_delta_kwh: number | null
          power_meter_reading_kwh: number | null
          reading_datetime: string | null
          recorded_by: string | null
          recovery_pct: number | null
          reject_flow: number | null
          reject_meter: number | null
          reject_meter_delta: number | null
          reject_meter_prev: number | null
          reject_ph: number | null
          reject_pressure_psi: number | null
          reject_tds: number | null
          rejection_pct: number | null
          remarks: string | null
          salt_passage_pct: number | null
          shared_power_meter_group: string | null
          specific_energy_kwh_m3: number | null
          suction_pressure_psi: number | null
          temperature_c: number | null
          train_id: string | null
          turbidity_ntu: number | null
        }
        Insert: {
          chlorine_residual_mg_l?: number | null
          created_at?: string | null
          dp_psi?: number | null
          feed_flow?: number | null
          feed_meter?: number | null
          feed_meter_delta?: number | null
          feed_meter_prev?: number | null
          feed_ph?: number | null
          feed_pressure_psi?: number | null
          feed_tds?: number | null
          id?: string | null
          is_meter_replacement?: boolean | null
          norm_status?: string | null
          permeate_flow?: number | null
          permeate_meter?: number | null
          permeate_meter_delta?: number | null
          permeate_meter_prev?: number | null
          permeate_ph?: number | null
          permeate_production_date?: string | null
          permeate_tds?: number | null
          plant_id?: string | null
          power_avg_kw?: number | null
          power_delta_kwh?: number | null
          power_meter_reading_kwh?: number | null
          reading_datetime?: string | null
          recorded_by?: string | null
          recovery_pct?: number | null
          reject_flow?: number | null
          reject_meter?: number | null
          reject_meter_delta?: number | null
          reject_meter_prev?: number | null
          reject_ph?: number | null
          reject_pressure_psi?: number | null
          reject_tds?: number | null
          rejection_pct?: number | null
          remarks?: string | null
          salt_passage_pct?: number | null
          shared_power_meter_group?: string | null
          specific_energy_kwh_m3?: number | null
          suction_pressure_psi?: number | null
          temperature_c?: number | null
          train_id?: string | null
          turbidity_ntu?: number | null
        }
        Update: {
          chlorine_residual_mg_l?: number | null
          created_at?: string | null
          dp_psi?: number | null
          feed_flow?: number | null
          feed_meter?: number | null
          feed_meter_delta?: number | null
          feed_meter_prev?: number | null
          feed_ph?: number | null
          feed_pressure_psi?: number | null
          feed_tds?: number | null
          id?: string | null
          is_meter_replacement?: boolean | null
          norm_status?: string | null
          permeate_flow?: number | null
          permeate_meter?: number | null
          permeate_meter_delta?: number | null
          permeate_meter_prev?: number | null
          permeate_ph?: number | null
          permeate_production_date?: string | null
          permeate_tds?: number | null
          plant_id?: string | null
          power_avg_kw?: number | null
          power_delta_kwh?: number | null
          power_meter_reading_kwh?: number | null
          reading_datetime?: string | null
          recorded_by?: string | null
          recovery_pct?: number | null
          reject_flow?: number | null
          reject_meter?: number | null
          reject_meter_delta?: number | null
          reject_meter_prev?: number | null
          reject_ph?: number | null
          reject_pressure_psi?: number | null
          reject_tds?: number | null
          rejection_pct?: number | null
          remarks?: string | null
          salt_passage_pct?: number | null
          shared_power_meter_group?: string | null
          specific_energy_kwh_m3?: number | null
          suction_pressure_psi?: number | null
          temperature_c?: number | null
          train_id?: string | null
          turbidity_ntu?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ro_train_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ro_train_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_readings_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      ro_train_readings_latest: {
        Row: {
          chlorine_residual_mg_l: number | null
          created_at: string | null
          dp_psi: number | null
          feed_flow: number | null
          feed_meter: number | null
          feed_meter_delta: number | null
          feed_meter_prev: number | null
          feed_ph: number | null
          feed_pressure_psi: number | null
          feed_tds: number | null
          id: string | null
          incomplete_reason: string | null
          is_meter_replacement: boolean | null
          norm_status: string | null
          permeate_flow: number | null
          permeate_meter: number | null
          permeate_meter_delta: number | null
          permeate_meter_prev: number | null
          permeate_ph: number | null
          permeate_production_date: string | null
          permeate_tds: number | null
          plant_id: string | null
          power_avg_kw: number | null
          power_delta_kwh: number | null
          power_meter_reading_kwh: number | null
          reading_datetime: string | null
          recorded_by: string | null
          recovery_pct: number | null
          reject_flow: number | null
          reject_meter: number | null
          reject_meter_delta: number | null
          reject_meter_prev: number | null
          reject_ph: number | null
          reject_pressure_psi: number | null
          reject_tds: number | null
          rejection_pct: number | null
          remarks: string | null
          salt_passage_pct: number | null
          shared_power_meter_group: string | null
          specific_energy_kwh_m3: number | null
          suction_pressure_psi: number | null
          temperature_c: number | null
          train_id: string | null
          turbidity_ntu: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ro_train_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ro_train_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_readings_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      v_power_readings_resolved: {
        Row: {
          cache_recalculated_at: string | null
          cache_stale: boolean | null
          cached_at: string | null
          created_at: string | null
          daily_consumption_kwh: number | null
          daily_grid_kwh: number | null
          daily_solar_kwh: number | null
          grid_kwh_final: number | null
          grid_meter_readings: Json | null
          id: string | null
          is_meter_replacement: boolean | null
          meter_multiplier: number | null
          meter_reading_kwh: number | null
          multiplier: number | null
          plant_id: string | null
          reading_datetime: string | null
          recorded_by: string | null
          resolved_mult: number | null
          solar_kwh_final: number | null
          solar_meter_reading: number | null
        }
        Relationships: [
          {
            foreignKeyName: "power_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "power_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "power_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_ro_train_power_allocated: {
        Row: {
          allocated_power_delta_kwh: number | null
          group_permeate_total: number | null
          group_power_delta_kwh: number | null
          id: string | null
          permeate_flow: number | null
          plant_id: string | null
          raw_power_delta_kwh: number | null
          reading_datetime: string | null
          shared_power_meter_group: string | null
          train_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ro_train_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ro_train_readings_train_id_fkey"
            columns: ["train_id"]
            isOneToOne: false
            referencedRelation: "ro_trains"
            referencedColumns: ["id"]
          },
        ]
      }
      well_readings_clean: {
        Row: {
          created_at: string | null
          current_reading: number | null
          daily_power_kwh: number | null
          daily_volume: number | null
          gps_lat: number | null
          gps_lng: number | null
          id: string | null
          is_meter_replacement: boolean | null
          is_meter_rollover: boolean | null
          locked_at: string | null
          locked_by: string | null
          meter_rollover_max: number | null
          norm_status: string | null
          off_location_flag: boolean | null
          plant_id: string | null
          power_meter_reading: number | null
          pressure_psi: number | null
          previous_reading: number | null
          reading_datetime: string | null
          recorded_by: string | null
          tds_ppm: number | null
          turbidity_ntu: number | null
          well_id: string | null
        }
        Insert: {
          created_at?: string | null
          current_reading?: number | null
          daily_power_kwh?: number | null
          daily_volume?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string | null
          is_meter_replacement?: boolean | null
          is_meter_rollover?: boolean | null
          locked_at?: string | null
          locked_by?: string | null
          meter_rollover_max?: number | null
          norm_status?: string | null
          off_location_flag?: boolean | null
          plant_id?: string | null
          power_meter_reading?: number | null
          pressure_psi?: number | null
          previous_reading?: number | null
          reading_datetime?: string | null
          recorded_by?: string | null
          tds_ppm?: number | null
          turbidity_ntu?: number | null
          well_id?: string | null
        }
        Update: {
          created_at?: string | null
          current_reading?: number | null
          daily_power_kwh?: number | null
          daily_volume?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string | null
          is_meter_replacement?: boolean | null
          is_meter_rollover?: boolean | null
          locked_at?: string | null
          locked_by?: string | null
          meter_rollover_max?: number | null
          norm_status?: string | null
          off_location_flag?: boolean | null
          plant_id?: string | null
          power_meter_reading?: number | null
          pressure_psi?: number | null
          previous_reading?: number | null
          reading_datetime?: string | null
          recorded_by?: string | null
          tds_ppm?: number | null
          turbidity_ntu?: number | null
          well_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "well_readings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "well_readings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_readings_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "operator_error_rates_30d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "well_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "well_readings_well_id_fkey"
            columns: ["well_id"]
            isOneToOne: false
            referencedRelation: "wells"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _get_power_multiplier: { Args: { p_plant_id: string }; Returns: number }
      _recompute_power_row: { Args: { p_id: string }; Returns: undefined }
      admin_set_user_password: {
        Args: { _new_password: string; _user_id: string }
        Returns: undefined
      }
      approve_user: {
        Args: { _approve?: boolean; _user_id: string }
        Returns: {
          confirmed: boolean
          created_at: string
          designation: string | null
          email: string | null
          first_name: string | null
          id: string
          immediate_head_id: string | null
          last_name: string | null
          last_seen_at: string | null
          middle_name: string | null
          plant_assignments: string[]
          profile_complete: boolean
          status: Database["public"]["Enums"]["profile_status"]
          suffix: string | null
          updated_at: string
          username: string | null
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      backfill_well_deltas: {
        Args: never
        Returns: {
          rows_fixed: number
          well_id: string
        }[]
      }
      complete_onboarding: {
        Args: {
          _designation: string
          _first_name: string
          _last_name: string
          _middle_name: string
          _plant_assignments: string[]
          _suffix: string
          _username: string
        }
        Returns: undefined
      }
      fn_cascade_reading_correction: {
        Args: {
          p_admin_id: string
          p_new_current: number
          p_reason?: string
          p_row_id: string
          p_table: string
        }
        Returns: Json
      }
      fn_compute_daily_plant_summary: {
        Args: { p_date: string }
        Returns: Json
      }
      fn_filter_unit_price: {
        Args: { p_as_of: string; p_housing_type: string; p_plant_id: string }
        Returns: number
      }
      fn_locator_cooldown_minutes: {
        Args: {
          p_cooldown?: number
          p_locator_id: string
          p_plant_id: string
          p_user_id: string
        }
        Returns: number
      }
      fn_manager_plant_scorecard: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      fn_notify_derived_review: {
        Args: {
          _date: string
          _detail?: string
          _kind: string
          _locator_id: string
        }
        Returns: undefined
      }
      fn_recalc_power_cache: {
        Args: { p_plant_id: string }
        Returns: undefined
      }
      fn_set_product_meter_mirror: {
        Args: { p_derived_from_locator_id: string; p_meter_id: string }
        Returns: undefined
      }
      fn_sweep_derived_meters:
        | { Args: { p_date?: string; p_lookback_days?: number }; Returns: Json }
        | { Args: { p_lookback_days?: number }; Returns: Json }
      fn_sweep_derived_meters_for_date: {
        Args: { p_date: string }
        Returns: Json
      }
      get_all_staff_profiles: {
        Args: never
        Returns: {
          confirmed: boolean
          created_at: string
          designation: string | null
          email: string | null
          first_name: string | null
          id: string
          immediate_head_id: string | null
          last_name: string | null
          last_seen_at: string | null
          middle_name: string | null
          plant_assignments: string[]
          profile_complete: boolean
          status: Database["public"]["Enums"]["profile_status"]
          suffix: string | null
          updated_at: string
          username: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_all_user_roles: {
        Args: never
        Returns: {
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_manager_or_admin: { Args: { _user_id: string }; Returns: boolean }
      is_manager_or_analyst_or_admin: {
        Args: { _user_id: string }
        Returns: boolean
      }
      purge_expired_chat_messages: { Args: never; Returns: undefined }
      recalc_power_cache_for_plant: {
        Args: { p_plant_id: string }
        Returns: string
      }
      recalculate_all_deltas: {
        Args: { p_plant_id?: string }
        Returns: undefined
      }
      recompute_costs_for_tariff_window: {
        Args: { _from: string; _plant: string }
        Returns: undefined
      }
      recompute_production_cost: {
        Args: { _date: string; _plant_id: string }
        Returns: undefined
      }
      recompute_solar_cost: {
        Args: { _date: string; _plant_id: string }
        Returns: undefined
      }
      refresh_plant_multiplier_cache: {
        Args: { p_plant_id: string }
        Returns: undefined
      }
      refresh_production_costs: {
        Args: { p_from?: string; p_plant_id: string; p_to?: string }
        Returns: undefined
      }
      resolve_plant_multiplier: {
        Args: { p_meter_index: number; p_plant_id: string }
        Returns: number
      }
      touch_last_seen: { Args: never; Returns: undefined }
      update_own_profile: {
        Args: {
          _designation: string
          _first_name: string
          _last_name: string
          _middle_name: string
          _suffix: string
          _username: string
        }
        Returns: undefined
      }
      user_has_plant_access: { Args: { _plant_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "Operator" | "Technician" | "Manager" | "Admin" | "Data Analyst"
      frequency_type: "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly"
      incident_status: "Open" | "InProgress" | "Resolved" | "Closed"
      plant_status: "Active" | "Inactive"
      profile_status: "Pending" | "Active" | "Suspended"
      reading_norm_action: "tag" | "normalize" | "retract"
      severity_level: "Low" | "Medium" | "High" | "Critical"
      train_status: "Running" | "Offline" | "Maintenance"
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
      app_role: ["Operator", "Technician", "Manager", "Admin", "Data Analyst"],
      frequency_type: ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"],
      incident_status: ["Open", "InProgress", "Resolved", "Closed"],
      plant_status: ["Active", "Inactive"],
      profile_status: ["Pending", "Active", "Suspended"],
      reading_norm_action: ["tag", "normalize", "retract"],
      severity_level: ["Low", "Medium", "High", "Critical"],
      train_status: ["Running", "Offline", "Maintenance"],
    },
  },
} as const
