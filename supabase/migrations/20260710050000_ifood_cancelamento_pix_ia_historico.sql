
-- ============ IFOOD: nova origem de pedido ============
ALTER TYPE public.order_source ADD VALUE IF NOT EXISTS 'ifood';

-- ============ IFOOD: credenciais no config da loja ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_client_id text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_client_secret text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_merchant_id text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_webhook_secret text;

-- ============ IFOOD: referência externa do pedido (evita duplicar) ============
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_external_id ON public.orders(external_id) WHERE external_id IS NOT NULL;

-- ============ PIX: comprovante enviado pelo cliente + confirmação ============
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_receipt_url text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_confirmed_by text; -- 'ia' | 'admin'

-- ============ CANCELAMENTO: quem cancelou e por quê ============
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancel_reason text;

-- ============ Permite admin cancelar (update já coberto pela policy "admins update orders") ============
-- (nenhuma policy nova necessária — admins já têm update total)

-- ============ Índice para histórico com filtro por data/status ============
CREATE INDEX IF NOT EXISTS idx_orders_created_status ON public.orders(created_at DESC, status);

-- ============ Storage: comprovantes de pix enviados por clientes/ia ============
insert into storage.buckets (id, name, public)
values ('payment-receipts', 'payment-receipts', true)
on conflict (id) do nothing;

create policy "public read receipts" on storage.objects for select
  using (bucket_id = 'payment-receipts');
create policy "service upload receipts" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-receipts');
