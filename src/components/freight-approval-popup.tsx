import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MapPin, Phone, Truck, Timer, Info, Edit2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Approval = {
  id: string;
  phone: string;
  customer_name: string | null;
  address: string;
  fee: number;
  distance_km: number | null;
  expires_at: string;
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
 * Popup global da loja: sempre que a IA calcular uma taxa de entrega, ela
 * pausa e pede autorização aqui. O gerente tem 30 segundos — se não responder,
 * o popup some sozinho e a IA informa o valor calculado ao cliente.
 *
 * O operador pode manter o valor calculado OU digitar um valor diferente antes
 * de confirmar. O valor confirmado (seja o original ou o editado) é salvo no
 * banco e usado pela IA no resumo e no total — nunca é sobrescrito pelo cálculo
 * automático depois.
 */
export function FreightApprovalPopup() {
  const [item, setItem] = useState<Approval | null>(null);
  const [left, setLeft] = useState(30);
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
        .select("id, phone, customer_name, address, fee, distance_km, expires_at")
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
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

  // contagem regressiva; fecha sozinho quando expira
  // Também reseta o campo de taxa customizada quando um novo pedido aparece
  useEffect(() => {
    if (!item) return;
    busy.current = false;
    setCustomFee(""); // limpa edição anterior ao mostrar novo item
    const tick = () => {
      const secs = Math.max(0, Math.ceil((new Date(item.expires_at).getTime() - Date.now()) / 1000));
      setLeft(secs);
      if (secs === 0) setItem(null);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [item]);

  async function resolve(status: "approved" | "rejected") {
    if (!item || busy.current) return;
    busy.current = true;

    // Se o operador digitou um valor diferente do calculado, usa esse valor.
    // O campo aceita formatos como "8", "8,50", "8.50" — normaliza para número.
    let effectiveFee = item.fee;
    if (status === "approved" && customFee.trim()) {
      const parsed = Number(customFee.trim().replace(",", "."));
      if (!Number.isNaN(parsed) && parsed >= 0) {
        effectiveFee = parsed;
      }
    }

    // Salva o valor definitivo (original ou editado pelo operador) junto com o status.
    // O campo `fee` na tabela é lido pelo webhook para usar como taxa oficial —
    // nunca é sobrescrito pelo cálculo automático depois desta aprovação.
    const { error } = await supabase
      .from("pending_freight_approvals")
      .update({ status, fee: effectiveFee, resolved_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("status", "pending");
    if (error) {
      busy.current = false;
      toast.error("Não foi possível registrar sua resposta");
      return;
    }

    const feeChanged = status === "approved" && effectiveFee !== item.fee;
    toast[status === "approved" ? "success" : "info"](
      status === "approved"
        ? feeChanged
          ? `Valor alterado para ${brl(effectiveFee)} e liberado para a IA.`
          : "Valor liberado — a IA vai informar ao cliente."
        : "Conversa passou para atendimento manual.",
    );
    setItem(null);
  }

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-foreground/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-background shadow-2xl">
        <div className="flex items-center gap-2 bg-primary px-5 py-3 text-primary-foreground">
          <Truck className="size-5" />
          <p className="font-display text-base font-black uppercase tracking-wide">Confirmar taxa de entrega</p>
          <span className="ml-auto flex items-center gap-1 rounded-full bg-primary-foreground/15 px-2 py-0.5 text-xs font-bold">
            <Timer className="size-3.5" /> {left}s
          </span>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">
            A IA calculou a taxa abaixo. Posso informar esse valor ao cliente?
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
                  <p className="mt-1 text-xl font-black text-primary">{brl(item.fee)}</p>
                </div>
              </div>
              {item.distance_km != null && (
                <p className="mt-2 text-center text-xs font-semibold text-muted-foreground">
                  Margem: {brl(item.fee - Number(item.distance_km) * 2 * costPerKm)}
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
                placeholder={Number(item.fee).toFixed(2).replace(".", ",")}
                value={customFee}
                onChange={(e) => setCustomFee(e.target.value)}
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Deixe em branco para usar o valor calculado ({brl(item.fee)}).
              O valor confirmado aqui será usado no resumo e no total — não será recalculado.
            </p>
          </div>

          <div className="flex gap-2">
            <Button className="flex-1" size="lg" onClick={() => resolve("approved")}>
              {customFee.trim() &&
               !Number.isNaN(Number(customFee.trim().replace(",", "."))) &&
               Number(customFee.trim().replace(",", ".")) !== item.fee
                ? `Confirmar R$ ${customFee.trim()} e enviar`
                : "Sim, pode informar"}
            </Button>
            <Button className="flex-1" size="lg" variant="outline" onClick={() => resolve("rejected")}>
              Não, eu respondo
            </Button>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            Sem resposta em {left}s, a IA informa o valor calculado automaticamente.
          </p>
        </div>
      </div>
    </div>
  );
}
