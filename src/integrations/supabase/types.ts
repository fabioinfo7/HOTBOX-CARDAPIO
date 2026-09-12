// Generated from the project's Supabase SQL schema and migrations.
// Do not place SQL in this file. Regenerate when the database schema changes.

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
      ai_instructions: {
        Row: {
          active: boolean
          content: string
          created_at: string
          id: string
          type: string
          valid_date: string | null
        }
        Insert: {
          active?: boolean
          content: string
          created_at?: string
          id?: string
          type: string
          valid_date?: string | null
        }
        Update: {
          active?: boolean
          content?: string
          created_at?: string
          id?: string
          type?: string
          valid_date?: string | null
        }
        Relationships: []
      }
      api_logs: {
        Row: {
          created_at: string
          direction: string
          error_message: string | null
          event_type: string | null
          id: string
          request_payload: Json | null
          response_body: string | null
          response_status: number | null
          source: string
        }
        Insert: {
          created_at?: string
          direction?: string
          error_message?: string | null
          event_type?: string | null
          id?: string
          request_payload?: Json | null
          response_body?: string | null
          response_status?: number | null
          source: string
        }
        Update: {
          created_at?: string
          direction?: string
          error_message?: string | null
          event_type?: string | null
          id?: string
          request_payload?: Json | null
          response_body?: string | null
          response_status?: number | null
          source?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      bairros_atendidos: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      bairros_nao_atendidos: {
        Row: {
          active: boolean | null
          bairro: string | null
          created_at: string | null
          id: string
          nome: string | null
        }
        Insert: {
          active?: boolean | null
          bairro?: string | null
          created_at?: string | null
          id?: string
          nome?: string | null
        }
        Update: {
          active?: boolean | null
          bairro?: string | null
          created_at?: string | null
          id?: string
          nome?: string | null
        }
        Relationships: []
      }
      combo_items: {
        Row: {
          created_at: string
          id: string
          included_product_id: string
          product_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          id?: string
          included_product_id: string
          product_id: string
          quantity?: number
        }
        Update: {
          created_at?: string
          id?: string
          included_product_id?: string
          product_id?: string
          quantity?: number
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string
          customer_phone: string
          discount_amount: number
          id: string
          order_id: string
          order_subtotal: number
          order_total: number
          reversed_at: string | null
          used_at: string
        }
        Insert: {
          coupon_id: string
          customer_phone: string
          discount_amount?: number
          id?: string
          order_id: string
          order_subtotal?: number
          order_total?: number
          reversed_at?: string | null
          used_at?: string
        }
        Update: {
          coupon_id?: string
          customer_phone?: string
          discount_amount?: number
          id?: string
          order_id?: string
          order_subtotal?: number
          order_total?: number
          reversed_at?: string | null
          used_at?: string
        }
        Relationships: []
      }
      coupons: {
        Row: {
          active: boolean
          allow_promotion_stack: boolean
          applicable_product_id: string | null
          code: string
          created_at: string
          description: string | null
          discount_type: string
          discount_value: number
          first_order_only: boolean
          id: string
          max_uses_per_customer: number | null
          min_order_value: number | null
          updated_at: string
          usage_count: number
          usage_limit: number | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          active?: boolean
          allow_promotion_stack?: boolean
          applicable_product_id?: string | null
          code: string
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value: number
          first_order_only?: boolean
          id?: string
          max_uses_per_customer?: number | null
          min_order_value?: number | null
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          active?: boolean
          allow_promotion_stack?: boolean
          applicable_product_id?: string | null
          code?: string
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          first_order_only?: boolean
          id?: string
          max_uses_per_customer?: number | null
          min_order_value?: number | null
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      customer_address_cache: {
        Row: {
          address_normalized: string
          lat: number
          lng: number
          phone: string
          updated_at: string
        }
        Insert: {
          address_normalized: string
          lat: number
          lng: number
          phone: string
          updated_at?: string
        }
        Update: {
          address_normalized?: string
          lat?: number
          lng?: number
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_feedback: {
        Row: {
          appearance_rating: number | null
          comment: string | null
          created_at: string
          created_by: string | null
          customer_name: string | null
          delivery_rating: number | null
          flavor_rating: number | null
          id: string
          lead_id: string | null
          opened_at: string | null
          order_id: string | null
          phone: string
          sent_at: string | null
          service_rating: number | null
          submitted_at: string | null
          token: string
          updated_at: string
          whatsapp_message_id: string | null
        }
        Insert: {
          appearance_rating?: number | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          delivery_rating?: number | null
          flavor_rating?: number | null
          id?: string
          lead_id?: string | null
          opened_at?: string | null
          order_id?: string | null
          phone: string
          sent_at?: string | null
          service_rating?: number | null
          submitted_at?: string | null
          token?: string
          updated_at?: string
          whatsapp_message_id?: string | null
        }
        Update: {
          appearance_rating?: number | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          delivery_rating?: number | null
          flavor_rating?: number | null
          id?: string
          lead_id?: string | null
          opened_at?: string | null
          order_id?: string | null
          phone?: string
          sent_at?: string | null
          service_rating?: number | null
          submitted_at?: string | null
          token?: string
          updated_at?: string
          whatsapp_message_id?: string | null
        }
        Relationships: []
      }
      deliverers: {
        Row: {
          active: boolean
          created_at: string
          full_name: string
          id: string
          payment_note: string | null
          payment_updated_at: string | null
          phone: string | null
          selfie_url: string | null
          vehicle: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          full_name: string
          id: string
          payment_note?: string | null
          payment_updated_at?: string | null
          phone?: string | null
          selfie_url?: string | null
          vehicle?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          full_name?: string
          id?: string
          payment_note?: string | null
          payment_updated_at?: string | null
          phone?: string | null
          selfie_url?: string | null
          vehicle?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string
          due_date: string
          id: string
          is_paid: boolean
          notes: string | null
          paid_at: string | null
          recurrence: string
        }
        Insert: {
          amount?: number
          category: string
          created_at?: string
          description: string
          due_date: string
          id?: string
          is_paid?: boolean
          notes?: string | null
          paid_at?: string | null
          recurrence?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string
          due_date?: string
          id?: string
          is_paid?: boolean
          notes?: string | null
          paid_at?: string | null
          recurrence?: string
        }
        Relationships: []
      }
      faixas_entrega: {
        Row: {
          ativo: boolean
          created_at: string
          fee: number
          id: string
          km_from: number
          km_to: number
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          fee?: number
          id?: string
          km_from?: number
          km_to?: number
          nome?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          fee?: number
          id?: string
          km_from?: number
          km_to?: number
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      ifood_product_map: {
        Row: {
          created_at: string
          ifood_item_id: string
          ifood_item_name: string | null
          product_id: string | null
        }
        Insert: {
          created_at?: string
          ifood_item_id: string
          ifood_item_name?: string | null
          product_id?: string | null
        }
        Update: {
          created_at?: string
          ifood_item_id?: string
          ifood_item_name?: string | null
          product_id?: string | null
        }
        Relationships: []
      }
      ingredients: {
        Row: {
          code: string | null
          created_at: string
          id: string
          low_stock_threshold: number
          name: string
          purchase_price: number
          purchase_quantity: number
          stock_quantity: number
          track_stock: boolean
          unit: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          low_stock_threshold?: number
          name: string
          purchase_price?: number
          purchase_quantity?: number
          stock_quantity?: number
          track_stock?: boolean
          unit?: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          low_stock_threshold?: number
          name?: string
          purchase_price?: number
          purchase_quantity?: number
          stock_quantity?: number
          track_stock?: boolean
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          created_at: string
          first_order_at: string
          id: string
          last_order_at: string
          name: string | null
          order_count: number
          phone: string
          tags: string[]
          total_spent: number
        }
        Insert: {
          created_at?: string
          first_order_at?: string
          id?: string
          last_order_at?: string
          name?: string | null
          order_count?: number
          phone: string
          tags?: string[]
          total_spent?: number
        }
        Update: {
          created_at?: string
          first_order_at?: string
          id?: string
          last_order_at?: string
          name?: string | null
          order_count?: number
          phone?: string
          tags?: string[]
          total_spent?: number
        }
        Relationships: []
      }
      menu_images: {
        Row: {
          created_at: string
          filename: string | null
          id: string
          storage_path: string
          url: string
        }
        Insert: {
          created_at?: string
          filename?: string | null
          id?: string
          storage_path: string
          url: string
        }
        Update: {
          created_at?: string
          filename?: string | null
          id?: string
          storage_path?: string
          url?: string
        }
        Relationships: []
      }
      meta_capi_events: {
        Row: {
          created_at: string
          event_name: string
          event_time: string
          id: string
          payload: Json | null
          phone: string
          response: Json | null
          success: boolean | null
        }
        Insert: {
          created_at?: string
          event_name: string
          event_time?: string
          id?: string
          payload?: Json | null
          phone: string
          response?: Json | null
          success?: boolean | null
        }
        Update: {
          created_at?: string
          event_name?: string
          event_time?: string
          id?: string
          payload?: Json | null
          phone?: string
          response?: Json | null
          success?: boolean | null
        }
        Relationships: []
      }
      meta_processed_messages: {
        Row: {
          created_at: string
          message_id: string
        }
        Insert: {
          created_at?: string
          message_id: string
        }
        Update: {
          created_at?: string
          message_id?: string
        }
        Relationships: []
      }
      nfood_product_map: {
        Row: {
          created_at: string
          nfood_item_id: string
          nfood_item_name: string | null
          product_id: string | null
        }
        Insert: {
          created_at?: string
          nfood_item_id: string
          nfood_item_name?: string | null
          product_id?: string | null
        }
        Update: {
          created_at?: string
          nfood_item_id?: string
          nfood_item_name?: string | null
          product_id?: string | null
        }
        Relationships: []
      }
      order_drafts: {
        Row: {
          address_city: string | null
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_reference: string | null
          address_street: string | null
          card_type: string | null
          change_for: number | null
          conversation_id: string
          customer_name: string | null
          delivery_mode: string | null
          estimated_delivery_fee: number | null
          estimated_distance_km: number | null
          failed_finalize_attempts: number
          awaiting_final_confirmation: boolean
          items: Json
          notes: string | null
          out_of_delivery_area: boolean
          payment_method: string | null
          payment_timing: string | null
          stage: string
          updated_at: string
        }
        Insert: {
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_reference?: string | null
          address_street?: string | null
          card_type?: string | null
          change_for?: number | null
          conversation_id: string
          customer_name?: string | null
          delivery_mode?: string | null
          estimated_delivery_fee?: number | null
          estimated_distance_km?: number | null
          failed_finalize_attempts?: number
          awaiting_final_confirmation?: boolean
          items?: Json
          notes?: string | null
          out_of_delivery_area?: boolean
          payment_method?: string | null
          payment_timing?: string | null
          stage?: string
          updated_at?: string
        }
        Update: {
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_reference?: string | null
          address_street?: string | null
          card_type?: string | null
          change_for?: number | null
          conversation_id?: string
          customer_name?: string | null
          delivery_mode?: string | null
          estimated_delivery_fee?: number | null
          estimated_distance_km?: number | null
          failed_finalize_attempts?: number
          awaiting_final_confirmation?: boolean
          items?: Json
          notes?: string | null
          out_of_delivery_area?: boolean
          payment_method?: string | null
          payment_timing?: string | null
          stage?: string
          updated_at?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          is_promotion_price: boolean
          list_price: number | null
          notes: string | null
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_promotion_price?: boolean
          list_price?: number | null
          notes?: string | null
          order_id: string
          product_id?: string | null
          product_name: string
          quantity?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_promotion_price?: boolean
          list_price?: number | null
          notes?: string | null
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: []
      }
      orders: {
        Row: {
          accepted_at: string | null
          accepted_by_deliverer_at: string | null
          address_cep: string | null
          address_city: string | null
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_reference: string | null
          address_street: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          card_type: string | null
          change_for: number | null
          coupon_code: string | null
          coupon_discount: number
          created_at: string
          customer_cancel_reason: string | null
          customer_cancel_requested: boolean
          customer_name: string
          customer_phone: string
          delivered_at: string | null
          deliverer_paid_at: string | null
          deliverer_id: string | null
          deliverer_name: string | null
          deliverer_vehicle: string | null
          delivery_distance_km: number | null
          delivery_fee: number
          delivery_mode: string
          external_display_id: string | null
          external_id: string | null
          failure_reason: string | null
          id: string
          ifood_billing_address: Json | null
          ifood_display_id: string | null
          ifood_driver_assigned_at: string | null
          ifood_last_pushed_status: string | null
          inter_txid: string | null
          lead_id: string | null
          nfood_driver_assigned_at: string | null
          nfood_last_pushed_status: string | null
          notes: string | null
          order_number: Json | string | number | boolean
          order_timing: string | null
          out_for_delivery_at: string | null
          payment_confirmed_at: string | null
          payment_confirmed_by: string | null
          payment_link: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_receipt_url: string | null
          payment_status: string
          payment_timing: string | null
          pix_code: string | null
          ready_at: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_deliverer_at?: string | null
          address_cep?: string | null
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_reference?: string | null
          address_street?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          card_type?: string | null
          change_for?: number | null
          coupon_code?: string | null
          coupon_discount?: number
          created_at?: string
          customer_cancel_reason?: string | null
          customer_cancel_requested?: boolean
          customer_name: string
          customer_phone: string
          delivered_at?: string | null
          deliverer_paid_at?: string | null
          deliverer_id?: string | null
          deliverer_name?: string | null
          deliverer_vehicle?: string | null
          delivery_distance_km?: number | null
          delivery_fee?: number
          delivery_mode?: string
          external_display_id?: string | null
          external_id?: string | null
          failure_reason?: string | null
          id?: string
          ifood_billing_address?: Json | null
          ifood_display_id?: string | null
          ifood_driver_assigned_at?: string | null
          ifood_last_pushed_status?: string | null
          inter_txid?: string | null
          lead_id?: string | null
          nfood_driver_assigned_at?: string | null
          nfood_last_pushed_status?: string | null
          notes?: string | null
          order_number: Json | string | number | boolean
          order_timing?: string | null
          out_for_delivery_at?: string | null
          payment_confirmed_at?: string | null
          payment_confirmed_by?: string | null
          payment_link?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_receipt_url?: string | null
          payment_status?: string
          payment_timing?: string | null
          pix_code?: string | null
          ready_at?: string | null
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          total?: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by_deliverer_at?: string | null
          address_cep?: string | null
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_reference?: string | null
          address_street?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          card_type?: string | null
          change_for?: number | null
          coupon_code?: string | null
          coupon_discount?: number
          created_at?: string
          customer_cancel_reason?: string | null
          customer_cancel_requested?: boolean
          customer_name?: string
          customer_phone?: string
          delivered_at?: string | null
          deliverer_paid_at?: string | null
          deliverer_id?: string | null
          deliverer_name?: string | null
          deliverer_vehicle?: string | null
          delivery_distance_km?: number | null
          delivery_fee?: number
          delivery_mode?: string
          external_display_id?: string | null
          external_id?: string | null
          failure_reason?: string | null
          id?: string
          ifood_billing_address?: Json | null
          ifood_display_id?: string | null
          ifood_driver_assigned_at?: string | null
          ifood_last_pushed_status?: string | null
          inter_txid?: string | null
          lead_id?: string | null
          nfood_driver_assigned_at?: string | null
          nfood_last_pushed_status?: string | null
          notes?: string | null
          order_number?: Json | string | number | boolean
          order_timing?: string | null
          out_for_delivery_at?: string | null
          payment_confirmed_at?: string | null
          payment_confirmed_by?: string | null
          payment_link?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_receipt_url?: string | null
          payment_status?: string
          payment_timing?: string | null
          pix_code?: string | null
          ready_at?: string | null
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          total?: number
        }
        Relationships: []
      }
      pending_freight_approvals: {
        Row: {
          address: string
          conversation_id: string | null
          created_at: string
          customer_name: string | null
          distance_km: number | null
          expires_at: string
          fee: number
          id: string
          phone: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address: string
          conversation_id?: string | null
          created_at?: string
          customer_name?: string | null
          distance_km?: number | null
          expires_at?: string
          fee?: number
          id?: string
          phone: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string
          conversation_id?: string | null
          created_at?: string
          customer_name?: string | null
          distance_km?: number | null
          expires_at?: string
          fee?: number
          id?: string
          phone?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pending_human_handoffs: {
        Row: {
          conversation_id: string | null
          created_at: string | null
          id: string
          phone: string | null
          reason: string | null
          resolved_at: string | null
          status: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          phone?: string | null
          reason?: string | null
          resolved_at?: string | null
          status?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          phone?: string | null
          reason?: string | null
          resolved_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          category: string | null
          cost_price: number
          created_at: string
          description: string | null
          customer_ingredients: string | null
          featured: boolean
          id: string
          image_url: string | null
          is_combo: boolean
          kind: Database["public"]["Enums"]["product_kind"]
          name: string
          needs_preparation: boolean
          promotion_active: boolean
          promotion_days_of_week: number[] | null
          promotion_end_at: string | null
          promotion_label: string | null
          promotion_price: number | null
          promotion_start_at: string | null
          promotion_time_end: string | null
          promotion_time_start: string | null
          promotion_type: string
          sale_price: number
          target_margin_percent: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          cost_price?: number
          created_at?: string
          description?: string | null
          customer_ingredients?: string | null
          featured?: boolean
          id?: string
          image_url?: string | null
          is_combo?: boolean
          kind?: Database["public"]["Enums"]["product_kind"]
          name: string
          needs_preparation?: boolean
          promotion_active?: boolean
          promotion_days_of_week?: number[] | null
          promotion_end_at?: string | null
          promotion_label?: string | null
          promotion_price?: number | null
          promotion_start_at?: string | null
          promotion_time_end?: string | null
          promotion_time_start?: string | null
          promotion_type?: string
          sale_price?: number
          target_margin_percent?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          cost_price?: number
          created_at?: string
          description?: string | null
          customer_ingredients?: string | null
          featured?: boolean
          id?: string
          image_url?: string | null
          is_combo?: boolean
          kind?: Database["public"]["Enums"]["product_kind"]
          name?: string
          needs_preparation?: boolean
          promotion_active?: boolean
          promotion_days_of_week?: number[] | null
          promotion_end_at?: string | null
          promotion_label?: string | null
          promotion_price?: number | null
          promotion_start_at?: string | null
          promotion_time_end?: string | null
          promotion_time_start?: string | null
          promotion_type?: string
          sale_price?: number
          target_margin_percent?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      quick_replies: {
        Row: {
          body: string
          created_at: string
          id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      receivable_items: {
        Row: {
          cost_price: number
          created_at: string
          description: string
          id: string
          product_id: string | null
          quantity: number
          receivable_id: string
          unit_price: number
        }
        Insert: {
          cost_price?: number
          created_at?: string
          description: string
          id?: string
          product_id?: string | null
          quantity?: number
          receivable_id: string
          unit_price?: number
        }
        Update: {
          cost_price?: number
          created_at?: string
          description?: string
          id?: string
          product_id?: string | null
          quantity?: number
          receivable_id?: string
          unit_price?: number
        }
        Relationships: []
      }
      receivables: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          customer_name: string
          description: string
          due_date: string | null
          id: string
          notes: string | null
          paid_at: string | null
          purchase_date: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          customer_name: string
          description: string
          due_date?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          purchase_date?: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_name?: string
          description?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          purchase_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      recipe_items: {
        Row: {
          id: string
          ingredient_id: string
          product_id: string
          quantity: number
          unit: string | null
        }
        Insert: {
          id?: string
          ingredient_id: string
          product_id: string
          quantity?: number
          unit?: string | null
        }
        Update: {
          id?: string
          ingredient_id?: string
          product_id?: string
          quantity?: number
          unit?: string | null
        }
        Relationships: []
      }
      reengagement_queue: {
        Row: {
          conversation_id: string | null
          created_at: string | null
          id: string
          phone: string | null
          scheduled_at: string | null
          sent_at: string | null
          status: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          phone?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          phone?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      ruas_nao_atendidas: {
        Row: {
          active: boolean | null
          bairro: string | null
          created_at: string | null
          id: string
          rua: string | null
        }
        Insert: {
          active?: boolean | null
          bairro?: string | null
          created_at?: string | null
          id?: string
          rua?: string | null
        }
        Update: {
          active?: boolean | null
          bairro?: string | null
          created_at?: string | null
          id?: string
          rua?: string | null
        }
        Relationships: []
      }
      store_config: {
        Row: {
          admin_alarm_default_on: boolean
          admin_alert_email: string | null
          admin_alert_phone: string | null
          ai_active_groq_slot: number
          ai_active_provider: string
          ai_last_failover_at: string | null
          ai_temperature: number
          alarm_sound_url: string | null
          app_public_url: string | null
          auto_print_on_accept: boolean
          banner_image_url: string | null
          banner_tagline: string | null
          bot_global_active: boolean
          business_hours: Json
          business_hours_closed_message: string | null
          business_hours_enabled: boolean
          chat_wallpaper: string
          combustivel_preco_litro: number | null
          default_delivery_fee: number
          deliverer_alarm_default_on: boolean
          deliverer_alarm_sound_url: string | null
          delivery_cost_per_km: number
          delivery_fee_tiers: Json
          delivery_pricing_mode: string
          digital_menu_enabled: boolean
          estimated_delivery_time_minutes: number | null
          evolution_api_token: string | null
          evolution_api_url: string | null
          evolution_disabled: boolean
          evolution_instance: string | null
          fee_pct_99food: number
          fee_pct_ifood: number
          fee_pct_site: number
          fee_pct_whatsapp: number
          fixed_delivery_city: string | null
          gemini_api_key: string | null
          google_maps_api_key: string | null
          groq_api_key: string | null
          groq_api_key_2: string | null
          groq_api_key_3: string | null
          id: number
          ifood_access_token: string | null
          ifood_client_id: string | null
          ifood_client_secret: string | null
          ifood_last_poll_at: string | null
          ifood_last_poll_error: string | null
          ifood_merchant_id: string | null
          ifood_own_delivery: boolean
          ifood_polling_enabled: boolean
          ifood_polling_token: string | null
          ifood_token_expires_at: string | null
          ifood_webhook_secret: string | null
          inter_cert_pem: string | null
          inter_client_id: string | null
          inter_client_secret: string | null
          inter_enabled: boolean
          inter_key_pem: string | null
          inter_pix_key: string | null
          meta_access_token: string | null
          meta_app_id: string | null
          meta_app_secret: string | null
          meta_capi_access_token: string | null
          meta_phone_number_id: string | null
          meta_pixel_id: string | null
          meta_test_event_code: string | null
          meta_verify_token: string | null
          meta_waba_id: string | null
          nfood_access_token: string | null
          nfood_api_base_url: string | null
          nfood_app_id: string | null
          nfood_client_id: string | null
          nfood_client_secret: string | null
          nfood_merchant_id: string | null
          nfood_oauth_token_url: string | null
          nfood_own_delivery: boolean
          nfood_token_expires_at: string | null
          openai_api_key: string | null
          payment_link_url: string | null
          pix_auto_cancel_minutes: number
          pix_copia_cola: string | null
          pix_key: string | null
          pix_mode: Database["public"]["Enums"]["pix_mode"]
          privacy_contact_email: string | null
          store_address: string | null
          store_lat: number | null
          store_lng: number | null
          store_name: string
          updated_at: string
          veiculo_consumo_kml: number | null
          whatsapp_number: string | null
          whatsapp_provider: string
        }
        Insert: {
          admin_alarm_default_on?: boolean
          admin_alert_email?: string | null
          admin_alert_phone?: string | null
          ai_active_groq_slot?: number
          ai_active_provider?: string
          ai_last_failover_at?: string | null
          ai_temperature?: number
          alarm_sound_url?: string | null
          app_public_url?: string | null
          auto_print_on_accept?: boolean
          banner_image_url?: string | null
          banner_tagline?: string | null
          bot_global_active?: boolean
          business_hours?: Json
          business_hours_closed_message?: string | null
          business_hours_enabled?: boolean
          chat_wallpaper?: string
          combustivel_preco_litro?: number | null
          default_delivery_fee?: number
          deliverer_alarm_default_on?: boolean
          deliverer_alarm_sound_url?: string | null
          delivery_cost_per_km?: number
          delivery_fee_tiers?: Json
          delivery_pricing_mode?: string
          digital_menu_enabled?: boolean
          estimated_delivery_time_minutes?: number | null
          evolution_api_token?: string | null
          evolution_api_url?: string | null
          evolution_disabled?: boolean
          evolution_instance?: string | null
          fee_pct_99food?: number
          fee_pct_ifood?: number
          fee_pct_site?: number
          fee_pct_whatsapp?: number
          fixed_delivery_city?: string | null
          gemini_api_key?: string | null
          google_maps_api_key?: string | null
          groq_api_key?: string | null
          groq_api_key_2?: string | null
          groq_api_key_3?: string | null
          id?: number
          ifood_access_token?: string | null
          ifood_client_id?: string | null
          ifood_client_secret?: string | null
          ifood_last_poll_at?: string | null
          ifood_last_poll_error?: string | null
          ifood_merchant_id?: string | null
          ifood_own_delivery?: boolean
          ifood_polling_enabled?: boolean
          ifood_polling_token?: string | null
          ifood_token_expires_at?: string | null
          ifood_webhook_secret?: string | null
          inter_cert_pem?: string | null
          inter_client_id?: string | null
          inter_client_secret?: string | null
          inter_enabled?: boolean
          inter_key_pem?: string | null
          inter_pix_key?: string | null
          meta_access_token?: string | null
          meta_app_id?: string | null
          meta_app_secret?: string | null
          meta_capi_access_token?: string | null
          meta_phone_number_id?: string | null
          meta_pixel_id?: string | null
          meta_test_event_code?: string | null
          meta_verify_token?: string | null
          meta_waba_id?: string | null
          nfood_access_token?: string | null
          nfood_api_base_url?: string | null
          nfood_app_id?: string | null
          nfood_client_id?: string | null
          nfood_client_secret?: string | null
          nfood_merchant_id?: string | null
          nfood_oauth_token_url?: string | null
          nfood_own_delivery?: boolean
          nfood_token_expires_at?: string | null
          openai_api_key?: string | null
          payment_link_url?: string | null
          pix_auto_cancel_minutes?: number
          pix_copia_cola?: string | null
          pix_key?: string | null
          pix_mode?: Database["public"]["Enums"]["pix_mode"]
          privacy_contact_email?: string | null
          store_address?: string | null
          store_lat?: number | null
          store_lng?: number | null
          store_name?: string
          updated_at?: string
          veiculo_consumo_kml?: number | null
          whatsapp_number?: string | null
          whatsapp_provider?: string
        }
        Update: {
          admin_alarm_default_on?: boolean
          admin_alert_email?: string | null
          admin_alert_phone?: string | null
          ai_active_groq_slot?: number
          ai_active_provider?: string
          ai_last_failover_at?: string | null
          ai_temperature?: number
          alarm_sound_url?: string | null
          app_public_url?: string | null
          auto_print_on_accept?: boolean
          banner_image_url?: string | null
          banner_tagline?: string | null
          bot_global_active?: boolean
          business_hours?: Json
          business_hours_closed_message?: string | null
          business_hours_enabled?: boolean
          chat_wallpaper?: string
          combustivel_preco_litro?: number | null
          default_delivery_fee?: number
          deliverer_alarm_default_on?: boolean
          deliverer_alarm_sound_url?: string | null
          delivery_cost_per_km?: number
          delivery_fee_tiers?: Json
          delivery_pricing_mode?: string
          digital_menu_enabled?: boolean
          estimated_delivery_time_minutes?: number | null
          evolution_api_token?: string | null
          evolution_api_url?: string | null
          evolution_disabled?: boolean
          evolution_instance?: string | null
          fee_pct_99food?: number
          fee_pct_ifood?: number
          fee_pct_site?: number
          fee_pct_whatsapp?: number
          fixed_delivery_city?: string | null
          gemini_api_key?: string | null
          google_maps_api_key?: string | null
          groq_api_key?: string | null
          groq_api_key_2?: string | null
          groq_api_key_3?: string | null
          id?: number
          ifood_access_token?: string | null
          ifood_client_id?: string | null
          ifood_client_secret?: string | null
          ifood_last_poll_at?: string | null
          ifood_last_poll_error?: string | null
          ifood_merchant_id?: string | null
          ifood_own_delivery?: boolean
          ifood_polling_enabled?: boolean
          ifood_polling_token?: string | null
          ifood_token_expires_at?: string | null
          ifood_webhook_secret?: string | null
          inter_cert_pem?: string | null
          inter_client_id?: string | null
          inter_client_secret?: string | null
          inter_enabled?: boolean
          inter_key_pem?: string | null
          inter_pix_key?: string | null
          meta_access_token?: string | null
          meta_app_id?: string | null
          meta_app_secret?: string | null
          meta_capi_access_token?: string | null
          meta_phone_number_id?: string | null
          meta_pixel_id?: string | null
          meta_test_event_code?: string | null
          meta_verify_token?: string | null
          meta_waba_id?: string | null
          nfood_access_token?: string | null
          nfood_api_base_url?: string | null
          nfood_app_id?: string | null
          nfood_client_id?: string | null
          nfood_client_secret?: string | null
          nfood_merchant_id?: string | null
          nfood_oauth_token_url?: string | null
          nfood_own_delivery?: boolean
          nfood_token_expires_at?: string | null
          openai_api_key?: string | null
          payment_link_url?: string | null
          pix_auto_cancel_minutes?: number
          pix_copia_cola?: string | null
          pix_key?: string | null
          pix_mode?: Database["public"]["Enums"]["pix_mode"]
          privacy_contact_email?: string | null
          store_address?: string | null
          store_lat?: number | null
          store_lng?: number | null
          store_name?: string
          updated_at?: string
          veiculo_consumo_kml?: number | null
          whatsapp_number?: string | null
          whatsapp_provider?: string
        }
        Relationships: []
      }
      system_alerts: {
        Row: {
          context: Json | null
          created_at: string
          id: string
          kind: string
          message: string
          notified_at: string | null
          resolved_at: string | null
          severity: string
        }
        Insert: {
          context?: Json | null
          created_at?: string
          id?: string
          kind: string
          message: string
          notified_at?: string | null
          resolved_at?: string | null
          severity?: string
        }
        Update: {
          context?: Json | null
          created_at?: string
          id?: string
          kind?: string
          message?: string
          notified_at?: string | null
          resolved_at?: string | null
          severity?: string
        }
        Relationships: []
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
      whatsapp_conversations: {
        Row: {
          ad_id: string | null
          ad_source: string | null
          ad_title: string | null
          bot_paused: boolean
          capi_lead_sent_at: string | null
          capi_purchase_sent_at: string | null
          created_at: string
          ctwa_clid: string | null
          customer_name: string | null
          has_unread: boolean
          id: string
          last_inbound_meta_message_id: string | null
          last_message_at: string
          last_message_preview: string | null
          last_seen_at: string | null
          phone: string
          referral_source_url: string | null
          unread_count: number
        }
        Insert: {
          ad_id?: string | null
          ad_source?: string | null
          ad_title?: string | null
          bot_paused?: boolean
          capi_lead_sent_at?: string | null
          capi_purchase_sent_at?: string | null
          created_at?: string
          ctwa_clid?: string | null
          customer_name?: string | null
          has_unread?: boolean
          id?: string
          last_inbound_meta_message_id?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          last_seen_at?: string | null
          phone: string
          referral_source_url?: string | null
          unread_count?: number
        }
        Update: {
          ad_id?: string | null
          ad_source?: string | null
          ad_title?: string | null
          bot_paused?: boolean
          capi_lead_sent_at?: string | null
          capi_purchase_sent_at?: string | null
          created_at?: string
          ctwa_clid?: string | null
          customer_name?: string | null
          has_unread?: boolean
          id?: string
          last_inbound_meta_message_id?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          last_seen_at?: string | null
          phone?: string
          referral_source_url?: string | null
          unread_count?: number
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          ai_processed_at: string | null
          body: string | null
          conversation_id: string
          created_at: string
          direction: string
          external_id: string | null
          id: string
          media_type: string | null
          media_url: string | null
          read_at: string | null
          sender_type: string
        }
        Insert: {
          ai_processed_at?: string | null
          body?: string | null
          conversation_id: string
          created_at?: string
          direction: string
          external_id?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          read_at?: string | null
          sender_type: string
        }
        Update: {
          ai_processed_at?: string | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          read_at?: string | null
          sender_type?: string
        }
        Relationships: []
      }
      whatsapp_processing_locks: {
        Row: {
          created_at: string
          expires_at: string
          phone: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          phone: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          phone?: string
        }
        Relationships: []
      }
      zonas_entrega: {
        Row: {
          bairro: string | null
          created_at: string
          distancia_km: number | null
          distancia_km_max: number | null
          distancia_km_min: number | null
          distancia_suspeita: boolean
          distancia_variavel: boolean
          entrega_disponivel: boolean
          faixa_id: string | null
          id: string
          lat: number | null
          lng: number | null
          observacao: string | null
          rua: string
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          created_at?: string
          distancia_km?: number | null
          distancia_km_max?: number | null
          distancia_km_min?: number | null
          distancia_suspeita?: boolean
          distancia_variavel?: boolean
          entrega_disponivel?: boolean
          faixa_id?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          observacao?: string | null
          rua: string
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          created_at?: string
          distancia_km?: number | null
          distancia_km_max?: number | null
          distancia_km_min?: number | null
          distancia_suspeita?: boolean
          distancia_variavel?: boolean
          entrega_disponivel?: boolean
          faixa_id?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          observacao?: string | null
          rua?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      store_config_public: {
        Row: {
          admin_alarm_default_on: boolean | null
          admin_alert_email: string | null
          admin_alert_phone: string | null
          ai_active_groq_slot: number | null
          ai_active_provider: string | null
          ai_last_failover_at: string | null
          ai_temperature: number | null
          alarm_sound_url: string | null
          app_public_url: string | null
          auto_print_on_accept: boolean | null
          banner_image_url: string | null
          banner_tagline: string | null
          bot_global_active: boolean | null
          business_hours: Json | null
          business_hours_closed_message: string | null
          business_hours_enabled: boolean | null
          chat_wallpaper: string | null
          combustivel_preco_litro: number | null
          default_delivery_fee: number | null
          deliverer_alarm_default_on: boolean | null
          deliverer_alarm_sound_url: string | null
          delivery_cost_per_km: number | null
          delivery_fee_tiers: Json | null
          delivery_pricing_mode: string | null
          digital_menu_enabled: boolean | null
          estimated_delivery_time_minutes: number | null
          evolution_api_token: string | null
          evolution_api_url: string | null
          evolution_disabled: boolean | null
          evolution_instance: string | null
          fee_pct_99food: number | null
          fee_pct_ifood: number | null
          fee_pct_site: number | null
          fee_pct_whatsapp: number | null
          fixed_delivery_city: string | null
          gemini_api_key: string | null
          google_maps_api_key: string | null
          groq_api_key: string | null
          groq_api_key_2: string | null
          groq_api_key_3: string | null
          id: number | null
          ifood_access_token: string | null
          ifood_client_id: string | null
          ifood_client_secret: string | null
          ifood_last_poll_at: string | null
          ifood_last_poll_error: string | null
          ifood_merchant_id: string | null
          ifood_own_delivery: boolean | null
          ifood_polling_enabled: boolean | null
          ifood_polling_token: string | null
          ifood_token_expires_at: string | null
          ifood_webhook_secret: string | null
          inter_cert_pem: string | null
          inter_client_id: string | null
          inter_client_secret: string | null
          inter_enabled: boolean | null
          inter_key_pem: string | null
          inter_pix_key: string | null
          meta_access_token: string | null
          meta_app_id: string | null
          meta_app_secret: string | null
          meta_capi_access_token: string | null
          meta_phone_number_id: string | null
          meta_pixel_id: string | null
          meta_test_event_code: string | null
          meta_verify_token: string | null
          meta_waba_id: string | null
          nfood_access_token: string | null
          nfood_api_base_url: string | null
          nfood_app_id: string | null
          nfood_client_id: string | null
          nfood_client_secret: string | null
          nfood_merchant_id: string | null
          nfood_oauth_token_url: string | null
          nfood_own_delivery: boolean | null
          nfood_token_expires_at: string | null
          openai_api_key: string | null
          payment_link_url: string | null
          pix_auto_cancel_minutes: number | null
          pix_copia_cola: string | null
          pix_key: string | null
          pix_mode: Database["public"]["Enums"]["pix_mode"] | null
          privacy_contact_email: string | null
          store_address: string | null
          store_lat: number | null
          store_lng: number | null
          store_name: string | null
          updated_at: string | null
          veiculo_consumo_kml: number | null
          whatsapp_number: string | null
          whatsapp_provider: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _coupon_quote_internal: {
        Args: {
          p_at: string
          p_cart: Json
          p_code: string
          p_customer_phone: string
          p_subtotal: number
        }
        Returns: Json
      }
      admin_set_deliverer_role: {
        Args: {
          _grant: boolean
          _user_id: string
        }
        Returns: boolean
      }
      assign_internal_order_number: {
        Args: Record<string, never>
        Returns: Json
      }
      auto_cancel_stale_pix: {
        Args: Record<string, never>
        Returns: number
      }
      auto_confirm_email: {
        Args: Record<string, never>
        Returns: Json
      }
      claim_first_admin: {
        Args: Record<string, never>
        Returns: boolean
      }
      cleanup_old_api_logs: {
        Args: Record<string, never>
        Returns: Json
      }
      compute_recipe_cost: {
        Args: {
          _product_id: string
        }
        Returns: number
      }
      create_site_order_secure: {
        Args: {
          p_coupon_code: string
          p_items: Json
          p_order: Json
        }
        Returns: Json
      }
      create_whatsapp_order_atomic: {
        Args: {
          p_items: Json
          p_order: Json
        }
        Returns: Json
      }
      deduct_stock_on_preparing: {
        Args: Record<string, never>
        Returns: Json
      }
      handle_new_user: {
        Args: Record<string, never>
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_coupon_usage: {
        Args: {
          p_code: string
        }
        Returns: Json
      }
      notify_customer_order_status: {
        Args: Record<string, never>
        Returns: Json
      }
      push_ifood_status_change: {
        Args: Record<string, never>
        Returns: Json
      }
      record_system_alert: {
        Args: {
          _context: Json
          _kind: string
          _message: string
          _severity: string
        }
        Returns: string
      }
      register_deliverer: {
        Args: {
          _full_name: string
          _phone: string
          _selfie_url: string
          _vehicle: string
        }
        Returns: boolean
      }
      reschedule_ifood_polling: {
        Args: Record<string, never>
        Returns: Json
      }
      reschedule_system_alerts_job: {
        Args: Record<string, never>
        Returns: Json
      }
      reverse_coupon_on_cancel: {
        Args: Record<string, never>
        Returns: Json
      }
      set_customer_feedback_updated_at: {
        Args: Record<string, never>
        Returns: Json
      }
      set_updated_at: {
        Args: Record<string, never>
        Returns: Json
      }
      upsert_lead_from_order: {
        Args: Record<string, never>
        Returns: Json
      }
      validate_coupon_public: {
        Args: {
          p_cart: Json
          p_code: string
          p_customer_phone: string
          p_subtotal: number
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: 'store_admin' | 'deliverer'
      order_source: 'site' | 'whatsapp' | 'ifood' | '99food'
      order_status: 'pending_review' | 'pending' | 'preparing' | 'ready_pickup' | 'out_for_delivery' | 'delivered' | 'failed' | 'cancelled'
      payment_method: 'pix' | 'card' | 'cash' | 'link'
      pix_mode: 'static' | 'dynamic'
      product_kind: 'recipe' | 'beverage'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (Database["public"]["Tables"] & Database["public"]["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] & Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] & Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends { Row: infer R } ? R : never
  : PublicTableNameOrOptions extends keyof (Database["public"]["Tables"] & Database["public"]["Views"])
    ? (Database["public"]["Tables"] & Database["public"]["Views"])[PublicTableNameOrOptions] extends { Row: infer R } ? R : never
    : never

export type TablesInsert<TableName extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][TableName]["Insert"]
export type TablesUpdate<TableName extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][TableName]["Update"]
export type Enums<EnumName extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][EnumName]
