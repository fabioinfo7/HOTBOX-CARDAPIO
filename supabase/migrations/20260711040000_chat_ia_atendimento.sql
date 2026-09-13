
-- ============ CONVERSAS DE WHATSAPP (uma por telefone) ============
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  customer_name text,
  bot_paused boolean not null default false,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  unread_count int not null default 0,
  created_at timestamptz not null default now()
);

-- ============ MENSAGENS (histórico completo, os dois lados) ============
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  sender_type text not null check (sender_type in ('customer','bot','admin')),
  body text,
  media_url text,
  media_type text check (media_type in ('image','audio','video','document')),
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conv ON public.whatsapp_messages(conversation_id, created_at);

-- ============ RASCUNHO DO PEDIDO — memória de trabalho da IA por conversa ============
CREATE TABLE IF NOT EXISTS public.order_drafts (
  conversation_id uuid primary key references public.whatsapp_conversations(id) on delete cascade,
  customer_name text,
  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  address_reference text,
  items jsonb not null default '[]'::jsonb,
  payment_method text check (payment_method in ('pix','card','cash')),
  payment_timing text check (payment_timing in ('now','delivery')),
  change_for numeric(10,2),
  notes text,
  stage text not null default 'greeting',
  updated_at timestamptz not null default now()
);

-- ============ PEDIDOS: troco (quando pagamento é dinheiro) ============
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS change_for numeric(10,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_timing text; -- 'now' | 'delivery'

-- ============ RLS: só admin acessa (dados operacionais internos) ============
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage conversations" ON public.whatsapp_conversations;
CREATE POLICY "admins manage conversations" ON public.whatsapp_conversations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

DROP POLICY IF EXISTS "admins manage messages" ON public.whatsapp_messages;
CREATE POLICY "admins manage messages" ON public.whatsapp_messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

DROP POLICY IF EXISTS "admins manage drafts" ON public.order_drafts;
CREATE POLICY "admins manage drafts" ON public.order_drafts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

-- ============ REALTIME: pra lista de conversas e mensagens atualizarem sozinhas ============
ALTER TABLE public.whatsapp_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ============ STORAGE: mídia enviada no chat (foto, vídeo, áudio, documento) ============
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

DROP POLICY IF EXISTS "public read chat media" ON storage.objects;
CREATE POLICY "public read chat media" ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-media');

DROP POLICY IF EXISTS "admins upload chat media" ON storage.objects;
CREATE POLICY "admins upload chat media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-media' AND public.has_role(auth.uid(), 'store_admin'));
