import { formatBusinessHoursText, type BusinessHourRange } from "@/lib/business-hours";
import { normalizeStreet } from "@/lib/zonas-entrega.server";

export type PublicFaqIntent =
  | "delivery_time"
  | "store_location"
  | "business_hours"
  | "payment_methods"
  | "pickup"
  | "open_now"
  | "food_temperature"
  | "split_payment";

export type AutoTemplateConfig = {
  storeName?: string | null;
  deliveryTimeMinutes?: number | null;
  businessHoursEnabled?: boolean | null;
  businessHours?: BusinessHourRange[] | null;
  storeAddress?: string | null;
};

export function detectPublicFaqIntent(input: string): PublicFaqIntent | null {
  const t = normalizeStreet(String(input || ""));
  if (!t) return null;

  if (/(quanto tempo|tempo de entrega|prazo de entrega|demora quanto|quanto demora|previsao de entrega|chega em quanto)/.test(t)) {
    return "delivery_time";
  }
  if (/(onde (voces|vcs) ficam|onde fica|qual endereco|endereco da loja|de onde (voces|vcs) sao|localizacao da loja)/.test(t)) {
    return "store_location";
  }
  if (/(qual horario|horario de atendimento|que horas abre|que horas fecha|funciona ate|funciona de|horario de funcionamento)/.test(t)) {
    return "business_hours";
  }
  if (/(esta aberto|estao abertos|ta aberto|tao abertos|estao atendendo|ta atendendo|funcionando agora)/.test(t)) {
    return "open_now";
  }
  if (/(aceita pix|aceitam pix|aceita cartao|aceitam cartao|forma de pagamento|formas de pagamento|como posso pagar|como paga)/.test(t)) {
    return "payment_methods";
  }
  if (/(posso retirar|tem retirada|faz retirada|retirar no local|buscar no local|pegar no local)/.test(t)) {
    return "pickup";
  }
  // Temperatura/embalagem não é respondida sem fonte oficial cadastrada.

  if (
    /(?:metade|meio|parte).{0,35}(?:pix|cartao).{0,35}(?:metade|meio|parte|pix|cartao)|(?:pix).{0,35}(?:cartao).{0,35}(?:mesmo pedido|mesma compra|metade|parte)|(?:cartao).{0,35}(?:pix).{0,35}(?:mesmo pedido|mesma compra|metade|parte)|(?:duas|2).{0,20}(?:formas|forma).{0,20}pagamento|dividir.{0,25}pagamento/.test(t)
  ) {
    return "split_payment";
  }
  return null;
}

export function renderPublicFaq(intent: PublicFaqIntent, cfg: AutoTemplateConfig): string {
  const store = String(cfg.storeName || "Hotbox Delivery").trim() || "Hotbox Delivery";
  const deliveryTime = Number(cfg.deliveryTimeMinutes || 40);
  const safeTime = Number.isFinite(deliveryTime) && deliveryTime > 0 ? Math.round(deliveryTime) : 40;
  const hoursText = cfg.businessHoursEnabled && Array.isArray(cfg.businessHours) && cfg.businessHours.length
    ? formatBusinessHoursText(cfg.businessHours)
    : null;

  switch (intent) {
    case "delivery_time":
      return `Nosso prazo de entrega é de até *${safeTime} minutos* e normalmente chega antes. Durante o pedido você também recebe as atualizações pelo WhatsApp.`;
    case "store_location":
      return cfg.storeAddress
        ? `${store} fica em *${String(cfg.storeAddress).trim()}*.`
        : `Ainda não tenho um endereço oficial cadastrado para informar com segurança.`;
    case "business_hours":
      return hoursText
        ? `Nosso horário de atendimento é:\n${hoursText}`
        : `Nosso horário de atendimento pode variar. Posso verificar o atendimento para o seu pedido por aqui.`;
    case "open_now":
      return hoursText
        ? `Estamos com o atendimento automático ativo. Nosso horário cadastrado é:\n${hoursText}`
        : `Estamos com o atendimento automático ativo por aqui.`;
    case "payment_methods":
      return `Aceitamos *Pix* e *cartão de crédito ou débito*. Não aceitamos dinheiro em espécie, para segurança do nosso entregador.`;
    case "pickup":
      return `Sim, você pode escolher *retirada*. Nesse caso não há taxa de entrega e não é necessário informar bairro para continuar o pedido.`;
    case "food_temperature":
      return `O prazo cadastrado de entrega é de até *${safeTime} minutos*. Sobre temperatura/embalagem, só posso confirmar o que estiver cadastrado nas informações oficiais da loja.`;
    case "split_payment":
      return `No atendimento automático, cada pedido precisa ficar registrado com *uma única forma de pagamento*. Posso manter em *Pix* ou alterar para *cartão*.`;
  }
}

export function resumePromptForDraft(draft: any): string | null {
  if (!draft) return null;

  if (draft.awaiting_final_confirmation) {
    return "Posso fechar o pedido?";
  }

  if (draft.delivery_mode === "pickup") return null;
  if (!draft.address_neighborhood) return "Para verificar a entrega para você, me informe seu bairro, por favor.";
  return null;
}

export function menuSendFailureMessage(): string {
  return "Não consegui enviar a imagem do cardápio agora. Para não ficar repetindo mensagens, vou deixar esta conversa disponível para nossa equipe continuar seu atendimento.";
}
