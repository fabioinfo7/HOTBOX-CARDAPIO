-- HotBox Delivery — garante aviso de status no WhatsApp pelo provedor ativo
-- (Evolution ou Meta Cloud API) através do endpoint central da aplicação.
create extension if not exists pg_net;

create or replace function public.notify_customer_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app_url text;
  v_store_name text;
  v_greeting text;
  v_body text;
  v_emoji text;
  v_order_fmt text;
  msg text;
begin
  if new.status is not distinct from old.status or new.customer_phone is null then
    return new;
  end if;

  select app_public_url, store_name
    into v_app_url, v_store_name
    from public.store_config
    limit 1;

  if coalesce(v_app_url, '') = '' then
    return new;
  end if;

  v_greeting := 'Oi' || case
    when coalesce(new.customer_name, '') <> '' then ', ' || split_part(new.customer_name, ' ', 1)
    else ''
  end || '!';

  v_order_fmt := case
    when new.source = 'ifood' then 'iFood ' || coalesce(new.external_display_id, new.external_id, '—')
    when new.source = '99food' then '99Food ' || coalesce(new.external_display_id, new.external_id, '—')
    else '#' || lpad(coalesce(new.order_number, 0)::text, 7, '0')
  end;

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
    else
      return new;
  end case;

  msg := v_emoji || ' *' || coalesce(v_store_name, 'HotBox Delivery') || '*' || E'\n'
      || '▬▬▬▬▬▬▬▬▬▬▬▬' || E'\n\n'
      || v_greeting || E'\n\n'
      || v_body || E'\n\n'
      || 'Pedido *' || v_order_fmt || '*' || E'\n'
      || '▬▬▬▬▬▬▬▬▬▬▬▬' || E'\n'
      || '_Qualquer dúvida, é só chamar por aqui 💬_';

  perform net.http_post(
    url := rtrim(v_app_url, '/') || '/api/public/webhooks/whatsapp-notify',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('phone', new.customer_phone, 'text', msg)
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_customer_order_status on public.orders;
create trigger trg_notify_customer_order_status
after update of status on public.orders
for each row execute function public.notify_customer_order_status();
