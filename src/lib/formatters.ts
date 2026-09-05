export const brl = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export const formatPhone = (raw: string) => {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3").trim();
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3").trim();
};

export const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");

export const formatDateTime = (d: string | Date) =>
  new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_review: "Aguardando Revisão",
  pending: "Pendente",
  preparing: "Em Preparação",
  ready_pickup: "Aguardando Retirada",
  out_for_delivery: "Saiu para Entrega",
  delivered: "Entregue",
  failed: "Entrega Falhou",
  cancelled: "Cancelado",
};

export const VEHICLE_LABEL: Record<string, string> = {
  moto: "Moto",
  bike: "Bicicleta",
  carro: "Carro",
  pe: "A pé",
};

export const ORDER_STATUS_COLOR: Record<string, string> = {
  pending_review: "bg-warning text-warning-foreground",
  pending: "bg-primary text-primary-foreground",
  preparing: "bg-accent text-accent-foreground",
  ready_pickup: "bg-warning text-warning-foreground",
  out_for_delivery: "bg-secondary text-secondary-foreground",
  delivered: "bg-success text-success-foreground",
  failed: "bg-destructive text-destructive-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

/** Formata o número do pedido com 7 casas: 12 -> #0000012 */
export const orderNumberFmt = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || n === "") return "—";
  return `#${String(n).padStart(7, "0")}`;
};

/**
 * Pedidos da iFood usam a identificação REAL que a própria iFood manda
 * (external_display_id) — nunca a numeração sequencial do sistema, senão
 * fica impossível achar o pedido que a iFood está cobrando/perguntando
 * sobre. Pedidos do WhatsApp/site continuam com a numeração própria do
 * sistema (order_number nunca é atribuído a pedidos da iFood, então nem
 * cai no fallback abaixo nesse caso).
 */
export const orderDisplayRef = (order: {
  source?: string | null;
  order_number?: number | string | null;
  external_display_id?: string | null;
}) => {
  if (order.source === "ifood") return order.external_display_id ? `iFood ${order.external_display_id}` : "iFood —";
  if (order.source === "99food") return order.external_display_id ? `99Food ${order.external_display_id}` : "99Food —";
  return orderNumberFmt(order.order_number);
};
