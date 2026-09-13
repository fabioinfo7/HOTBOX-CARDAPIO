
-- ============ CORREÇÃO CRÍTICA: estoque não pode ser ativado por padrão ============
-- O controle de estoque foi implementado com track_stock=true e stock_quantity=0
-- por padrão para TODO insumo — o que faz o sistema (e a IA no WhatsApp) achar que
-- absolutamente tudo está em falta, já que ninguém preencheu o estoque real ainda.
-- A partir de agora, rastreio de estoque é OPT-IN: começa desligado, e só é
-- ativado quando o admin realmente configurar o estoque daquele insumo em
-- /loja/produtos (aba Insumos).

-- Desliga o rastreio pra tudo que já existe (correção imediata)
UPDATE public.ingredients SET track_stock = false WHERE track_stock = true;

-- Novos insumos, a partir de agora, também nascem com rastreio desligado
ALTER TABLE public.ingredients ALTER COLUMN track_stock SET DEFAULT false;
