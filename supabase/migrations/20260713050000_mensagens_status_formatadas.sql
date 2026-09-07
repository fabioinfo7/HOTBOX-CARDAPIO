
CREATE OR REPLACE FUNCTION public.notify_customer_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text; v_instance text; v_token text; v_store_name text;
  v_greeting text; v_body text; v_emoji text; v_order_fmt text; v_footer text;
  msg text; full_url text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.customer_phone IS NOT NULL THEN
    SELECT evolution_api_url, evolution_instance, evolution_api_token, store_name
      INTO v_url, v_instance, v_token, v_store_name
      FROM public.store_config LIMIT 1;

    IF v_url IS NULL OR v_instance IS NULL OR v_token IS NULL THEN
      RETURN NEW;
    END IF;

    v_greeting := 'Oi' || CASE WHEN NEW.customer_name IS NOT NULL AND NEW.customer_name <> '' THEN ', ' || split_part(NEW.customer_name, ' ', 1) ELSE '' END || '!';
    v_order_fmt := '#' || lpad(NEW.order_number::text, 7, '0');
    v_footer := 'Qualquer dúvida, é só chamar por aqui 💬';

    CASE
      WHEN NEW.status = 'preparing' THEN
        v_emoji := '👨‍🍳'; v_body := 'Seu pedido já entrou em preparação — já já fica pronto!';
      WHEN NEW.status = 'ready_pickup' AND NEW.delivery_mode = 'pickup' THEN
        v_emoji := '📦'; v_body := 'Seu pedido está pronto! Pode vir buscar na loja quando quiser.';
      WHEN NEW.status = 'ready_pickup' THEN
        v_emoji := '📦'; v_body := 'Seu pedido está pronto, aguardando o entregador sair com ele.';
      WHEN NEW.status = 'out_for_delivery' THEN
        v_emoji := '🛵'; v_body := 'Seu pedido saiu para entrega! Já já chega até você.';
      WHEN NEW.status = 'delivered' AND NEW.delivery_mode = 'pickup' THEN
        v_emoji := '✅'; v_body := 'Pedido retirado! Bom apetite 😋';
      WHEN NEW.status = 'delivered' THEN
        v_emoji := '✅'; v_body := 'Pedido entregue! Bom apetite 😋';
      WHEN NEW.status = 'cancelled' THEN
        v_emoji := '❌';
        v_body := 'Seu pedido foi cancelado.' || CASE WHEN NEW.cancel_reason IS NOT NULL THEN E'\nMotivo: ' || NEW.cancel_reason ELSE '' END;
      WHEN NEW.status = 'failed' THEN
        v_emoji := '⚠️'; v_body := 'Tivemos um problema pra concluir a entrega do seu pedido. Nossa equipe já vai entrar em contato.';
      ELSE
        RETURN NEW;
    END CASE;

    msg := v_emoji || ' *' || COALESCE(v_store_name, 'Sua loja') || '*' || E'\n'
        || '▬▬▬▬▬▬▬▬▬▬▬▬' || E'\n\n'
        || v_greeting || E'\n\n'
        || v_body || E'\n\n'
        || 'Pedido *' || v_order_fmt || '*' || E'\n'
        || '▬▬▬▬▬▬▬▬▬▬▬▬' || E'\n'
        || '_' || v_footer || '_';

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
