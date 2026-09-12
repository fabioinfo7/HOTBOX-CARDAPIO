
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS fixed_delivery_city text;
ALTER TABLE public.order_drafts ADD COLUMN IF NOT EXISTS delivery_mode text CHECK (delivery_mode IN ('delivery','pickup'));

-- ============ Mensagem específica de "pronto pra retirar" quando for retirada no local ============
CREATE OR REPLACE FUNCTION public.notify_customer_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text; v_instance text; v_token text;
  msg text; full_url text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.customer_phone IS NOT NULL THEN
    SELECT evolution_api_url, evolution_instance, evolution_api_token
      INTO v_url, v_instance, v_token
      FROM public.store_config LIMIT 1;

    IF v_url IS NULL OR v_instance IS NULL OR v_token IS NULL THEN
      RETURN NEW;
    END IF;

    msg := CASE
      WHEN NEW.status = 'preparing' THEN format('👨‍🍳 Seu pedido #%s entrou em preparação!', NEW.order_number)
      WHEN NEW.status = 'ready_pickup' AND NEW.delivery_mode = 'pickup' THEN
        format('📦 Seu pedido #%s está pronto! Pode vir buscar na loja quando quiser. 😊', NEW.order_number)
      WHEN NEW.status = 'ready_pickup' THEN format('📦 Seu pedido #%s está pronto, aguardando o entregador!', NEW.order_number)
      WHEN NEW.status = 'out_for_delivery' THEN format('🛵 Seu pedido #%s saiu para entrega! Já já chega até você.', NEW.order_number)
      WHEN NEW.status = 'delivered' AND NEW.delivery_mode = 'pickup' THEN format('✅ Pedido #%s retirado! Bom apetite 😋', NEW.order_number)
      WHEN NEW.status = 'delivered' THEN format('✅ Pedido #%s entregue! Bom apetite 😋', NEW.order_number)
      WHEN NEW.status = 'cancelled' THEN format('❌ Seu pedido #%s foi cancelado.%s', NEW.order_number,
        CASE WHEN NEW.cancel_reason IS NOT NULL THEN ' Motivo: ' || NEW.cancel_reason ELSE '' END)
      WHEN NEW.status = 'failed' THEN format('⚠️ Tivemos um problema com seu pedido #%s. Nossa equipe vai entrar em contato.', NEW.order_number)
      ELSE NULL
    END;

    IF msg IS NULL THEN RETURN NEW; END IF;

    full_url := rtrim(v_url, '/') || '/message/sendText/' || v_instance;

    PERFORM net.http_post(
      url := full_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_token),
      body := jsonb_build_object('number', NEW.customer_phone, 'text', msg)
    );
  END IF;
  RETURN NEW;
END;
$$;
