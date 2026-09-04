
-- ============ ENDURECIMENTO DE SEGURANÇA — STORAGE ============

-- Selfie do entregador: antes qualquer usuário autenticado podia gravar em
-- qualquer caminho do bucket. Agora só pode gravar dentro da própria pasta
-- (o app já envia para "${auth.uid()}/arquivo.jpg").
DROP POLICY IF EXISTS "auth upload own selfie" ON storage.objects;
CREATE POLICY "auth upload own selfie" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deliverer-selfies' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Comprovante de Pix: só o servidor (service role, via IA no webhook) deve gravar.
-- Remove a permissão que deixava qualquer usuário autenticado subir arquivo nesse bucket.
DROP POLICY IF EXISTS "service upload receipts" ON storage.objects;

-- ============ ENDURECIMENTO — GARANTE QUE SÓ QUEM TEM O PAPEL CERTO ENXERGA DADOS ============
-- (reforço defensivo; as políticas abaixo já existiam de forma equivalente, isso apenas
-- garante que ficaram registradas corretamente após todas as migrations anteriores)

-- Ninguém além de admin pode ler leads
DROP POLICY IF EXISTS "admins manage leads" ON public.leads;
CREATE POLICY "admins manage leads" ON public.leads FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

-- Ninguém além de admin pode ler configuração da loja (chaves Pix, tokens iFood/Evolution)
DROP POLICY IF EXISTS "admins read config" ON public.store_config;
CREATE POLICY "admins read config" ON public.store_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'));

-- ============ CORREÇÃO: TELA DO CLIENTE PRECISA LER TAXA DE ENTREGA E CHAVE PIX ============
-- A tabela store_config nunca teve permissão de leitura para visitantes (anon) — só para
-- admin autenticado. Isso fazia a taxa de entrega e a chave Pix nunca aparecerem pro cliente.
-- Criamos uma VIEW só com os campos públicos e seguros (sem tokens/segredos) e liberamos
-- a leitura dela para todo mundo, mantendo a tabela original travada para admin.
DROP VIEW IF EXISTS public.store_config_public;
CREATE VIEW public.store_config_public AS
  SELECT store_name, default_delivery_fee, pix_key, pix_copia_cola, pix_mode
  FROM public.store_config
  WHERE id = 1;

GRANT SELECT ON public.store_config_public TO anon, authenticated;

