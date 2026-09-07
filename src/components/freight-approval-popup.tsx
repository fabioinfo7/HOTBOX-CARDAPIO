import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MapPin, Phone, Truck, Timer, Info, Edit2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { resolveFreightApprovalFn } from "@/lib/freight-approval.functions";

type Approval = {
  id: string;
  phone: string;
  customer_name: string | null;
  address: string;
  fee: number;
  distance_km: number | null;
  expires_at: string;
  approval_kind?: "standard" | "partner_quote" | null;
};

const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Mesmo componente de dica usado em loja.zonas-entrega.tsx e
 *  loja.precificacao.tsx — ícone "?" que explica o termo em palavras simples. */
function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="align-middle text-muted-foreground/70 hover:text-foreground" tabIndex={-1}>
            <Info className="inline size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-xs leading-relaxed">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Popup global de decisão de taxa.
 * O operador escolhe QUEM informará o cliente: automação OU operador.
 * Não existe autorização automática por tempo. A escolha congela a origem e
 * o valor para impedir envio duplicado ou taxa diferente no mesmo endereço.
 */
export function FreightApprovalPopup() {
  const [item, setItem] = useState<Approval | null>(null);
  const [left, setLeft] = useState(25);
  const [costPerKm, setCostPerKm] = useState(0.9);
  const busy = useRef(false);

  // Campo de edição manual da taxa. Começa vazio; se o operador digitar algo,
  // esse valor substitui o calculado antes de ser salvo. Se ficar vazio e o
  // operador confirmar, usa o valor calculado pelo sistema.
  const [customFee, setCustomFee] = useState<string>("");

  // custo por km pago ao entregador (Configurações → Entrega)
  useEffect(() => {
    supabase
      .from("store_config")
      .select("delivery_cost_per_km")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.delivery_cost_per_km != null) setCostPerKm(Number(data.delivery_cost_per_km));
      });
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadPending() {
      const { data } = await supabase
        .from("pending_freight_approvals")
        .select("id, phone, customer_name, address, fee, distance_km, expires_at, approval_kind")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1);
      if (!alive) return;
      setItem((prev) => prev ?? (data?.[0] as Approval | undefined) ?? null);
    }

    loadPending();

    // Polling de segurança: o popup depende do canal Realtime para aparecer
    // na hora, mas se o Realtime cair, não estiver habilitado pra essa tabela
    // no projeto, ou a inscrição falhar silenciosamente, a loja nunca veria a
    // aprovação pendente até expirar. Esse poll garante que, no pior caso, o
    // popup aparece em até 3s mesmo sem Realtime funcionando.
    const pollId = setInterval(loadPending, 3000);

    const ch = supabase
      .channel("freight-approvals")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pending_freight_approvals" }, (payload) => {
        const row = payload.new as any;
        if (row?.status === "pending") setItem(row as Approval);
      })
      .subscribe((status, err) => {
        // Se a inscrição falhar (canal fechado, erro de auth, timeout), cai
        // no polling acima — mas loga pra dar pra diagnosticar no console.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          console.error("[freight-approval-popup] realtime subscription failed:", status, err);
        }
      });

    return () => {
      alive = false;
      clearInterval(pollId);
      supabase.removeChannel(ch);
    };
  }, []);

  // O popup não expira nem autoriza a IA sozinho. Depois de 25s apenas
  // deixa de mostrar a contagem como "janela rápida", mas continua visível até
  // alguém escolher QUEM vai informar a taxa.
  useEffect(() => {
    if (!item) return;
    busy.current = false;
    setCustomFee("");
    const startedAt = Date.now();
    const tick = () => {
      const secs = Math.max(0, 25 - Math.floor((Date.now() - startedAt) / 1000));
      setLeft(secs);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [item?.id]);

  async function resolve(mode: "bot" | "operator") {
    if (!item || busy.current) return;
    busy.current = true;

    let effectiveFee = item.approval_kind === "partner_quote" ? 0 : item.fee;
    if (customFee.trim()) {
      const parsed = Number(customFee.trim().replace(",", "."));
      if (Number.isFinite(parsed) && parsed > 0) effectiveFee = Number(parsed.toFixed(2));
    }

    if (item.approval_kind === "partner_quote" && (!Number.isFinite(effectiveFee) || effectiveFee <= 0)) {
      busy.current = false;
      toast.error("Digite a taxa informada pelo motoboy parceiro antes de autorizar.");
      return;
    }

    const result: any = await resolveFreightApprovalFn({
      data: {
        approvalId: item.id,
        mode,
        fee: effectiveFee,
      },
    });

    if (!result?.ok) {
      busy.current = false;
      toast.error(result?.error || "Não foi possível registrar sua decisão");
      return;
    }

    if (mode === "bot") {
      toast.success(`Taxa de ${brl(effectiveFee)} enviada uma única vez pela automação.`);
    } else {
      toast.info(`Automação bloqueada para a taxa. Você vai informar ${brl(effectiveFee)} manualmente.`);
    }

    setItem(null);
  }

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-foreground/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-background shadow-2xl">
        <div className="flex items-center gap-2 bg-primary px-5 py-3 text-primary-foreground">
          <Truck className="size-5" />
          <p className="font-display text-base font-black uppercase tracking-wide">
            {item.approval_kind === "partner_quote" ? "Cotação com motoboy parceiro" : "Confirmar taxa de entrega"}
          </p>
          <span className="ml-auto flex items-center gap-1 rounded-full bg-primary-foreground/15 px-2 py-0.5 text-xs font-bold">
            <Timer className="size-3.5" /> {left}s
          </span>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">
            {item.approval_kind === "partner_quote"
              ? "Consulte o motoboy parceiro, digite abaixo o valor informado por ele e autorize o envio. A automação não possui permissão para escolher ou estimar essa taxa."
              : "A taxa foi calculada abaixo. Escolha quem vai informar o cliente. Depois da sua escolha, o outro lado fica bloqueado para evitar valor duplicado ou diferente."}
          </p>

          <div className="rounded-xl bg-muted/50 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Phone className="size-4 text-muted-foreground" />
              {item.customer_name ? `${item.customer_name} — ` : ""}
              {item.phone}
            </p>
            <p className="mt-2 flex items-start gap-2 text-sm">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>{item.address}</span>
            </p>
            <div className="mt-3 border-t pt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {item.distance_km != null
                  ? `${Number(item.distance_km).toFixed(2)} km até o cliente (${(Number(item.distance_km) * 2).toFixed(2)} km ida e volta)`
                  : "Distância não medida"}
              </span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Você gasta (ida e volta){" "}
                    <InfoTip text="Distância até o cliente × 2 (ida e volta) × custo por km configurado em Configurações → Entrega. O sistema já soma a volta sozinho — o valor lá em Configurações é só de 1 km rodado." />
                  </p>
                  <p className="mt-1 text-xl font-black text-destructive">
                    {item.distance_km != null ? brl(Number(item.distance_km) * 2 * costPerKm) : "—"}
                  </p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Taxa de entrega
                  </p>
                  <p className="mt-1 text-xl font-black text-primary">
                    {item.approval_kind === "partner_quote" ? "Aguardando cotação" : brl(item.fee)}
                  </p>
                </div>
              </div>
              {item.distance_km != null && (
                <p className="mt-2 text-center text-xs font-semibold text-muted-foreground">
                  Margem: {item.approval_kind === "partner_quote" ? "—" : brl(item.fee - Number(item.distance_km) * 2 * costPerKm)}
                </p>
              )}
            </div>
          </div>

          {/* Campo de edição manual da taxa — operador pode alterar antes de confirmar */}
          <div className="rounded-xl border bg-muted/30 p-4">
            <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Edit2 className="size-3.5" />
              Valor a enviar ao cliente
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-muted-foreground">R$</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder={item.approval_kind === "partner_quote" ? "Digite a taxa cotada" : Number(item.fee).toFixed(2).replace(".", ",")}
                value={customFee}
                onChange={(e) => setCustomFee(e.target.value)}
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {item.approval_kind === "partner_quote"
                ? "Este valor é obrigatório. Depois de autorizado, será enviado uma única vez e congelado para este endereço."
                : <>Deixe em branco para usar o valor calculado ({brl(item.fee)}). O valor confirmado aqui será usado no resumo e no total — não será recalculado.</>}
            </p>
          </div>

          {item.approval_kind === "partner_quote" ? (
            <Button
              className="w-full"
              size="lg"
              onClick={() => resolve("bot")}
              disabled={!customFee.trim() || !Number.isFinite(Number(customFee.trim().replace(",", "."))) || Number(customFee.trim().replace(",", ".")) <= 0}
            >
              Autorizar envio da taxa
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button className="flex-1" size="lg" onClick={() => resolve("bot")}>
                {customFee.trim() &&
                 !Number.isNaN(Number(customFee.trim().replace(",", "."))) &&
                 Number(customFee.trim().replace(",", ".")) !== item.fee
                  ? `Autorizar R$ ${customFee.trim()}`
                  : "Autorizar automação"}
              </Button>
              <Button className="flex-1" size="lg" variant="outline" onClick={() => resolve("operator")}>
                Eu vou informar
              </Button>
            </div>
          )}
          <p className="text-center text-[11px] text-muted-foreground">
            {left > 0
              ? `Aguardando sua decisão — ${left}s na janela rápida.`
              : "Aguardando sua decisão. A automação NÃO enviará a taxa sem autorização."}
          </p>
        </div>
      </div>
    </div>
  );
}
