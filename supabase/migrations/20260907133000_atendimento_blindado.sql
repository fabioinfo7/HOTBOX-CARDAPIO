-- HOTBOX V15 — Atendimento blindado
-- Idempotente: pode ser aplicado em banco que já tenha parte dessas estruturas.

-- ============================================================
-- 1) Handoff humano interno (silencioso para o cliente)
-- ============================================================
create table if not exists public.pending_human_handoffs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.whatsapp_conversations(id) on delete cascade,
  phone text not null,
  customer_name text,
  reason text,
  status text not null default 'pending',
  expires_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.pending_human_handoffs to authenticated;
grant all on public.pending_human_handoffs to service_role;

alter table public.pending_human_handoffs enable row level security;

drop policy if exists "admins manage human handoffs" on public.pending_human_handoffs;
create policy "admins manage human handoffs"
on public.pending_human_handoffs
for all
to authenticated
using (public.has_role(auth.uid(), 'store_admin'))
with check (public.has_role(auth.uid(), 'store_admin'));

create index if not exists idx_pending_human_handoffs_status_created
  on public.pending_human_handoffs(status, created_at);

create unique index if not exists uq_pending_human_handoff_per_conversation
  on public.pending_human_handoffs(conversation_id)
  where status = 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pending_human_handoffs'
  ) then
    alter publication supabase_realtime add table public.pending_human_handoffs;
  end if;
end $$;

alter table public.store_config
  add column if not exists handoff_alarm_default_on boolean not null default true,
  add column if not exists handoff_alarm_sound_url text;

-- ============================================================
-- 2) Propriedade exclusiva da comunicação da taxa
-- ============================================================
alter table public.pending_freight_approvals
  add column if not exists address_key text;

create index if not exists idx_pending_freight_address_key
  on public.pending_freight_approvals(conversation_id, address_key, status, created_at desc);

alter table public.order_drafts
  add column if not exists freight_notification_status text,
  add column if not exists freight_notification_value numeric(10,2),
  add column if not exists freight_notification_address_key text,
  add column if not exists freight_notification_at timestamptz;

comment on column public.order_drafts.freight_notification_status is
  'Controle exclusivo de envio da taxa: pending, bot_authorized, operator_will_send, sent_by_bot, sent_by_operator.';

comment on column public.order_drafts.freight_notification_value is
  'Valor oficial congelado da taxa para o endereço atual.';

comment on column public.order_drafts.freight_notification_address_key is
  'Chave normalizada do endereço ao qual a taxa congelada pertence.';

-- Garante que nenhuma aprovação pendente antiga fique liberando envio por expiração.
update public.pending_freight_approvals
set expires_at = greatest(coalesce(expires_at, now()), now() + interval '24 hours')
where status = 'pending';
