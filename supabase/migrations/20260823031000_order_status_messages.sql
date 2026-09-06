-- HotBox Delivery — mensagens de status mais claras no WhatsApp.
create or replace function public.notify_customer_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text; v_instance text; v_token text; v_store_name text;
  v_greeting text; v_body text; v_emoji text; v_order_fmt text; v_footer text;
  msg text; full_url text;
begin
  if new.status is distinct from old.status and new.customer_phone is not null then
    select evolution_api_url, evolution_instance, evolution_api_token, store_name
      into v_url, v_instance, v_token, v_store_name
      from public.store_config limit 1;
    if v_url is null or v_instance is null or v_token is null then return new; end if;

    v_greeting := 'Oi' || case when coalesce(new.customer_name,'') <> '' then ', ' || split_part(new.customer_name,' ',1) else '' end || '!';
    v_order_fmt := '#' || lpad(new.order_number::text, 7, '0');
    v_footer := 'Qualquer dúvida, é só chamar por aqui 💬';

    case
      when new.status = 'preparing' then
        v_emoji := '👨‍🍳'; v_body := 'Seu pedido já entrou em preparação. Estamos caprichando por aqui!';
      when new.status = 'ready_pickup' and new.delivery_mode = 'pickup' then
        v_emoji := '📦'; v_body := 'Seu pedido já está pronto e pode ser retirado. 😊';
      when new.status = 'ready_pickup' then
        v_emoji := '📦'; v_body := 'Seu pedido já está pronto e preparado para sair para entrega. Assim que sair, avisamos você por aqui!';
      when new.status = 'out_for_delivery' then
        v_emoji := '🛵'; v_body := 'Seu pedido saiu para entrega e já está a caminho! Fique de olho no celular. 😊';
      when new.status = 'delivered' and new.delivery_mode = 'pickup' then
        v_emoji := '✅'; v_body := 'Pedido retirado! Bom apetite 😋';
      when new.status = 'delivered' then
        v_emoji := '✅'; v_body := 'Pedido entregue! Bom apetite 😋';
      when new.status = 'cancelled' then
        v_emoji := '❌'; v_body := 'Seu pedido foi cancelado.' || case when new.cancel_reason is not null then E'\nMotivo: ' || new.cancel_reason else '' end;
      when new.status = 'failed' then
        v_emoji := '⚠️'; v_body := 'Tivemos um problema para concluir a entrega. Nossa equipe vai entrar em contato.';
      else return new;
    end case;

    msg := v_emoji || ' *' || coalesce(v_store_name,'HotBox Delivery') || '*' || E'\n'
        || '▬▬▬▬▬▬▬▬▬▬▬▬' || E'\n\n' || v_greeting || E'\n\n' || v_body || E'\n\n'
        || 'Pedido *' || v_order_fmt || '*' || E'\n' || '▬▬▬▬▬▬▬▬▬▬▬▬' || E'\n' || '_' || v_footer || '_';
    full_url := rtrim(v_url,'/') || '/message/sendText/' || v_instance;
    perform net.http_post(url := full_url, headers := jsonb_build_object('Content-Type','application/json','apikey',v_token), body := jsonb_build_object('number',new.customer_phone,'text',msg));
  end if;
  return new;
end;
$$;
