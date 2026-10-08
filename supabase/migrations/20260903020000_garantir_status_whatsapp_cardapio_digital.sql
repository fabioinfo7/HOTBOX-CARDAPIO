-- HotBox Delivery — garantia de atualização de status no WhatsApp
-- Inclui explicitamente pedidos originados do cardápio digital (source = 'site').
-- Não altera pedidos, valores ou fluxo de criação. Apenas recria o trigger de notificação.

create extension if not exists pg_net;

-- O trigger precisa saber qual URL chamar. Só preenche se estiver vazio.
update public.store_config
   set app_public_url = 'https://hotbox.up.railway.app'
 where coalesce(btrim(app_public_url), '') = '';

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
  -- Só dispara quando o status REALMENTE muda e existe telefone.
  if new.status is not distinct from old.status
     or nullif(regexp_replace(coalesce(new.customer_phone, ''), '\D', '', 'g'), '') is null then
    return new;
  end if;

  select app_public_url, store_name
    into v_app_url, v_store_name
    from public.store_config
    order by id
    limit 1;

  if coalesce(btrim(v_app_url), '') = '' then
    return new;
  end if;

  v_greeting := 'Oi' || case
    when coalesce(btrim(new.customer_name), '') <> '' then ', ' || split_part(btrim(new.customer_name), ' ', 1)
    else ''
  end || '!';

  v_order_fmt := case
    when new.source = 'ifood' then 'iFood ' || coalesce(new.external_display_id, new.external_id, '—')
    when new.source = '99food' then '99Food ' || coalesce(new.external_display_id, new.external_id, '—')
    else '#' || lpad(coalesce(new.order_number, 0)::text, 7, '0')
  end;

  case
    when new.status = 'preparing' then
      v_emoji := '👨‍🍳';
      v_body := 'Seu pedido já entrou em preparação. Estamos caprichando por aqui!';
    when new.status = 'ready_pickup' and new.delivery_mode = 'pickup' then
      v_emoji := '📦';
      v_body := 'Seu pedido já está pronto e pode ser retirado. 😊';
    when new.status = 'ready_pickup' then
      v_emoji := '📦';
      v_body := 'Seu pedido já está pronto e preparado para sair para entrega. Assim que sair, avisamos você por aqui!';
    when new.status = 'out_for_delivery' then
      v_emoji := '🛵';
      v_body := 'Seu pedido saiu para entrega e já está a caminho! Fique de olho no celular. 😊';
    when new.status = 'delivered' and new.delivery_mode = 'pickup' then
      v_emoji := '✅';
      v_body := 'Pedido retirado! Bom apetite 😋';
    when new.status = 'delivered' then
      v_emoji := '✅';
      v_body := 'Pedido entregue! Bom apetite 😋';
    when new.status = 'cancelled' then
      v_emoji := '❌';
      v_body := 'Seu pedido foi cancelado.' || case
        when nullif(btrim(coalesce(new.cancel_reason, '')), '') is not null then E'\nMotivo: ' || new.cancel_reason
        else ''
      end;
    when new.status = 'failed' then
      v_emoji := '⚠️';
      v_body := 'Tivemos um problema para concluir a entrega. Nossa equipe vai entrar em contato.';
    else
      return new;
  end case;

  msg := v_emoji || ' *' || coalesce(nullif(btrim(v_store_name), ''), 'HotBox Delivery') || '*' || E'\n'
      || '▬▬▬▬▬▬▬▬▬▬▬▬' || E'\n\n'
      || v_greeting || E'\n\n'
      || v_body || E'\n\n'
      || 'Pedido *' || v_order_fmt || '*' || E'\n'
      || '▬▬▬▬▬▬▬▬▬▬▬▬' || E'\n'
      || '_Todas as atualizações do seu pedido chegam por aqui no WhatsApp. 💬_';

  perform net.http_post(
    url := rtrim(v_app_url, '/') || '/api/public/webhooks/whatsapp-notify',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'phone', regexp_replace(new.customer_phone, '\D', '', 'g'),
      'text', msg
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_customer_order_status on public.orders;
create trigger trg_notify_customer_order_status
after update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function public.notify_customer_order_status();
