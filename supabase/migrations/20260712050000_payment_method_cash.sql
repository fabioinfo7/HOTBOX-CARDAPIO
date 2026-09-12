
-- ============ CORREÇÃO CRÍTICA: 'cash' nunca foi um valor válido do enum payment_method ============
-- Isso fazia TODO pedido em dinheiro falhar na hora de gravar no banco,
-- com ou sem troco — o enum só aceitava 'pix' e 'card'.
DO $$
BEGIN
  ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'cash';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
