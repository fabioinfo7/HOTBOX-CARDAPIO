-- HotBox Delivery — ingredientes visíveis ao cliente/IA por produto
-- Campo separado da ficha técnica para não misturar composição comercial com custo/estoque.

alter table public.products
  add column if not exists customer_ingredients text;

comment on column public.products.customer_ingredients is
  'Ingredientes/composição do produto em linguagem para o cliente. Fonte principal da IA ao responder o que vem no produto.';
