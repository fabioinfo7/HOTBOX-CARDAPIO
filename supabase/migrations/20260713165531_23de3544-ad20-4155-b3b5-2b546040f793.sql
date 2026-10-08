CREATE OR REPLACE FUNCTION public.notify_customer_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url text; v_instance text; v_token text; v_store_name text;
  msg text; full_url text; order_ref text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.customer_phone IS NOT NULL THEN

    SELECT evolution_api_url, evolution_instance, evolution_api_token, COALESCE(store_name, 'HotBox Delivery')
      INTO v_url, v_instance, v_token, v_store_name
      FROM public.store_config LIMIT 1;

    IF v_url IS NULL OR v_instance IS NULL OR v_token IS NULL THEN
      RETURN NEW;
    END IF;

    order_ref := '#' || lpad(NEW.order_number::text, 7, '0');

    msg := CASE NEW.status
      WHEN 'preparing' THEN
        E'👨‍🍳 *Pedido em preparo*\n' ||
        E'━━━━━━━━━━━━━━━\n\n' ||
        'Oi, ' || COALESCE(split_part(NEW.customer_name, ' ', 1), 'tudo bem') || E'! Já colocamos a mão na massa no seu pedido *' || order_ref || E'*.\n\n' ||
        E'⏱️ Em instantes fica pronto.\n\n' ||
        '_' || v_store_name || '_'

      WHEN 'ready_pickup' THEN
        CASE WHEN NEW.delivery_mode = 'retirada' THEN
          E'📦 *Pronto para retirada!*\n' ||
          E'━━━━━━━━━━━━━━━\n\n' ||
          'Seu pedido *' || order_ref || E'* está pronto e te esperando no balcão. 🎉\n\n' ||
          E'É só passar aqui pra retirar. Bom apetite!\n\n' ||
          '_' || v_store_name || '_'
        ELSE
          E'📦 *Pedido pronto!*\n' ||
          E'━━━━━━━━━━━━━━━\n\n' ||
          'Terminamos o seu pedido *' || order_ref || E'* e ele já está indo pro entregador. 🛵\n\n' ||
          E'Em breve sai pra entrega — te aviso quando estiver a caminho.\n\n' ||
          '_' || v_store_name || '_'
        END

      WHEN 'out_for_delivery' THEN
        E'🛵 *Saiu para entrega*\n' ||
        E'━━━━━━━━━━━━━━━\n\n' ||
        'Seu pedido *' || order_ref || E'* está a caminho! 🚀\n\n' ||
        CASE WHEN NEW.deliverer_name IS NOT NULL THEN E'👤 Entregador: *' || NEW.deliverer_name || E'*\n\n' ELSE '' END ||
        E'Já já chega até você. Fica atento(a) ao telefone.\n\n' ||
        '_' || v_store_name || '_'

      WHEN 'delivered' THEN
        E'✅ *Pedido entregue*\n' ||
        E'━━━━━━━━━━━━━━━\n\n' ||
        'Prontinho! O pedido *' || order_ref || E'* foi entregue. 🎉\n\n' ||
        E'Bom apetite, ' || COALESCE(split_part(NEW.customer_name, ' ', 1), 'você') || E'! 😋\n\n' ||
        E'Se curtir, conta pra gente — a gente adora um retorno. ⭐\n\n' ||
        '_' || v_store_name || ' — obrigado pela preferência!_'

      WHEN 'cancelled' THEN
        E'❌ *Pedido cancelado*\n' ||
        E'━━━━━━━━━━━━━━━\n\n' ||
        'Seu pedido *' || order_ref || E'* foi cancelado.\n\n' ||
        CASE WHEN NEW.cancel_reason IS NOT NULL THEN E'📝 Motivo: ' || NEW.cancel_reason || E'\n\n' ELSE '' END ||
        E'Se foi engano ou quiser fazer outro pedido, é só me chamar por aqui. 💬\n\n' ||
        '_' || v_store_name || '_'

      WHEN 'failed' THEN
        E'⚠️ *Tivemos um problema*\n' ||
        E'━━━━━━━━━━━━━━━\n\n' ||
        'Não conseguimos concluir a entrega do pedido *' || order_ref || E'*.\n\n' ||
        E'Nossa equipe já foi avisada e vai entrar em contato com você o mais rápido possível pra resolver. 🤝\n\n' ||
        '_' || v_store_name || '_'

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
$function$;