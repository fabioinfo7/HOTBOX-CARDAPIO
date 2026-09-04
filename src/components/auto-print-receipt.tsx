import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PrintReceipt } from "@/components/print-receipt";
import { formatBusinessHoursText } from "@/lib/business-hours";
import { toast } from "sonner";

/** Nome do evento global disparado sempre que um pedido é aceito. */
export const AUTO_PRINT_EVENT = "hb:print-order";

/** Dispara a impressão automática de um pedido (chamar depois de aceitar). */
export function requestAutoPrint(orderId: string) {
  window.dispatchEvent(new CustomEvent(AUTO_PRINT_EVENT, { detail: { orderId } }));
}

const SESSION_NOTICE_KEY = "hb_auto_print_notice_shown";

/**
 * Componente global (montado uma vez no layout da loja) responsável por:
 *  1. Avisar, uma vez por sessão do navegador, que a impressão automática
 *     está ativa e que o navegador vai abrir a caixa de impressão sozinho
 *     (não existe permissão de "driver de impressora" pra site — ver nota
 *     abaixo). Isso substitui o popup de "autorização".
 *  2. Escutar QUALQUER pedido que mude o status pra "preparing" — direto no
 *     banco, via Realtime — e imprimir a nota escondida. É assim (e não só
 *     escutando cliques de botão) porque um pedido pode virar "preparing"
 *     de vários jeitos: clique em "Aceitar" na fila, na tela do pedido, ou
 *     automaticamente pelo fluxo da IA no WhatsApp — o clique manual sozinho
 *     não cobria esse último caso, que era o motivo da impressão não sair.
 *
 * IMPORTANTE — limite técnico real: navegadores não têm uma permissão do
 * tipo câmera/microfone pra impressora. `window.print()` sempre abre a caixa
 * de impressão do sistema operacional, mesmo com essa função automática.
 * Pra imprimir 100% sem caixa (silencioso), o Chrome precisa ser aberto
 * nesse computador com a flag de impressão em modo kiosk, ex.:
 *   chrome.exe --kiosk-printing
 * apontando o Chrome pra abrir direto na tela de Pedidos. Isso é uma
 * configuração do computador da loja, não algo que o site consiga pedir.
 */
export function AutoPrintReceipt() {
  const [enabled, setEnabled] = useState(false);
  const [job, setJob] = useState<{ order: any; items: any[] } | null>(null);
  const [businessHoursText, setBusinessHoursText] = useState<string | null>(null);
  // Evita imprimir o mesmo pedido duas vezes na mesma sessão (ex: o clique
  // manual E o Realtime pegando a mesma transição de status).
  const printedIds = useRef<Set<string>>(new Set());

  async function printOrder(orderId: string) {
    if (printedIds.current.has(orderId)) return;
    printedIds.current.add(orderId);
    const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!order) return;
    const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId).order("created_at");
    setJob({ order, items: items ?? [] });
  }

  useEffect(() => {
    let alive = true;
    (supabase as any)
      .from("store_config")
      .select("business_hours_enabled, business_hours")
      .maybeSingle()
      .then(({ data }: any) => {
        if (!alive) return;
        if (data?.business_hours_enabled && Array.isArray(data.business_hours) && data.business_hours.length) {
          setBusinessHoursText(formatBusinessHoursText(data.business_hours));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    supabase
      .from("store_config")
      .select("auto_print_on_accept")
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const on = !!data?.auto_print_on_accept;
        setEnabled(on);
        if (on && !sessionStorage.getItem(SESSION_NOTICE_KEY)) {
          sessionStorage.setItem(SESSION_NOTICE_KEY, "1");
          toast.info(
            'Impressão automática ativa: ao aceitar um pedido, a nota vai imprimir sozinha. Se o navegador abrir a caixa de impressão, escolha a impressora térmica e marque "lembrar" — para imprimir sem essa caixa aparecer, configure o Chrome da loja em modo kiosk (veja em Configurações).',
            { duration: 12000 },
          );
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  // Gatilho manual (clique em "Aceitar" na fila / tela do pedido) — imediato.
  useEffect(() => {
    function onPrintRequest(e: Event) {
      if (!enabled) return;
      const orderId = (e as CustomEvent).detail?.orderId as string | undefined;
      if (!orderId) return;
      printOrder(orderId);
    }
    window.addEventListener(AUTO_PRINT_EVENT, onPrintRequest);
    return () => window.removeEventListener(AUTO_PRINT_EVENT, onPrintRequest);
  }, [enabled]);

  // Gatilho de banco (Realtime) — cobre QUALQUER caminho que leve o pedido a
  // "preparing", inclusive o fluxo automático da IA no WhatsApp.
  useEffect(() => {
    if (!enabled) return;
    const ch = supabase
      .channel("auto-print-orders")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: "status=eq.preparing" },
        (payload) => {
          const row = payload.new as any;
          if (row?.id) printOrder(row.id);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [enabled]);

  useEffect(() => {
    if (!job) return;
    // Dá um tick pro DOM renderizar a nota escondida (.print-58mm só aparece
    // dentro de @media print, então isso não pisca nada na tela) antes de
    // chamar a caixa de impressão do navegador.
    const id = setTimeout(() => {
      window.print();
      setJob(null);
    }, 300);
    return () => clearTimeout(id);
  }, [job]);

  if (!job) return null;
  return <PrintReceipt order={job.order} items={job.items} businessHoursText={businessHoursText} />;
}
