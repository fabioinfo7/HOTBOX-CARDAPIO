# HOTBOX V11 — Atendimento automático mais assertivo

## Principais mudanças
- Disjuntor de loop: a mesma pergunta operacional só pode aparecer duas vezes; a terceira tentativa pausa o robô e passa para manual.
- Dado conhecido nunca volta a ser perguntado (bairro, itens, nome/endereço, pagamento).
- Pedido de atendente humano é respeitado imediatamente.
- Frustração + repetição recente também aciona handoff automático.
- O cliente é informado desde o primeiro contato de que fala com o atendimento automático da Hotbox.
- Estado determinístico do funil é calculado pelo backend e injetado no prompt; a IA não escolhe livremente a etapa.
- Reconhecimento de bairro ganhou aliases adicionais.

## Taxa de entrega — correção crítica
### Modo por bairro
A taxa agora é buscada diretamente em `bairros_atendidos.delivery_fee` para o bairro canônico confirmado. A IA não recebe uma taxa genérica e não pode inventar valor. Se o bairro não puder ser identificado com segurança, nenhuma taxa é anunciada.

### Modo por km
O valor vem somente do cálculo por distância. O sistema não substitui falha de cálculo por `default_delivery_fee`. Resultado incerto exige aprovação humana; se ninguém aprovar, o robô pausa em vez de cobrar um valor possivelmente errado.

### Fechamento
Pedido de entrega não é criado com taxa desconhecida. O fechamento recalcula pela mesma fonte autoritativa e, se não houver segurança, transfere para manual.

## Fluxo
WAITING_NEIGHBORHOOD → TAKING_ORDER → WAITING_NAME_ADDRESS → WAITING_FREIGHT → WAITING_PAYMENT → READY_FOR_BEVERAGE_OR_SUMMARY → WAITING_FINAL_CONFIRMATION.
