-- HotBox Delivery — sincroniza parâmetros operacionais aprovados em 27/08/2026
-- Mantém o prazo usado pela interface/configuração alinhado ao atendimento da IA.
update public.store_config
set estimated_delivery_time_minutes = 40,
    store_address = 'Rua Carlos Chagas, 492, Jardim Gramacho'
where true;
