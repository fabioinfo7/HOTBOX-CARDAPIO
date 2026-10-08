import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PrintReceipt } from "@/components/print-receipt";
import { formatBusinessHoursText } from "@/lib/business-hours";
import { toast } from "sonner";

export const AUTO_PRINT_EVENT = "hb:print-order";

/**
 * Impressão manual: sempre funciona, independentemente da configuração de
 * impressão automática. A configuração auto_print_on_accept só controla os
 * gatilhos automáticos por aceite/realtime.
 */
export function requestAutoPrint(orderId: string) {
  window.dispatchEvent(new CustomEvent(AUTO_PRINT_EVENT, { detail: { orderId, force: true } }));
}

const SESSION_NOTICE_KEY = "hb_auto_print_notice_shown";

export function AutoPrintReceipt() {
  const [enabled, setEnabled] = useState(false);
  const [job, setJob] = useState<{ order: any; items: any[] } | null>(null);
  const [businessHoursText, setBusinessHoursText] = useState<string | null>(null);
  const printedIds = useRef<Set<string>>(new Set());

  async function printOrder(orderId: string) {
    if (printedIds.current.has(orderId)) return;
    const { data: order, error: orderError } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (orderError) {
      toast.error(`Não foi possível carregar o pedido para impressão: ${orderError.message}`);
      return;
    }
    if (!order) {
      toast.error("Pedido não encontrado para impressão.");
      return;
    }
    const { data: items, error: itemsError } = await supabase.from("order_items").select("*").eq("order_id", orderId).order("created_at");
    if (itemsError) {
      toast.error(`Não foi possível carregar os itens do pedido: ${itemsError.message}`);
      return;
    }
    printedIds.current.add(orderId);
    setJob({ order, items: items ?? [] });
  }

  useEffect(() => {
    let alive = true;
    (supabase as any).from("store_config").select("business_hours_enabled, business_hours").maybeSingle().then(({ data }: any) => {
      if (!alive) return;
      if (data?.business_hours_enabled && Array.isArray(data.business_hours) && data.business_hours.length) setBusinessHoursText(formatBusinessHoursText(data.business_hours));
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.from("store_config").select("auto_print_on_accept").maybeSingle().then(({ data }) => {
      if (!alive) return;
      const on = !!data?.auto_print_on_accept;
      setEnabled(on);
      if (on && !sessionStorage.getItem(SESSION_NOTICE_KEY)) {
        sessionStorage.setItem(SESSION_NOTICE_KEY, "1");
        toast.info('Impressão automática ativa: ao aceitar um pedido, a nota vai imprimir sozinha. Para impressão sem a caixa do navegador, configure o Chrome da loja em modo kiosk.', { duration: 12000 });
      }
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    function onPrintRequest(e: Event) {
      const detail = (e as CustomEvent).detail || {};
      const orderId = detail.orderId as string | undefined;
      const force = detail.force === true;
      if (!orderId || (!enabled && !force)) return;
      void printOrder(orderId);
    }
    window.addEventListener(AUTO_PRINT_EVENT, onPrintRequest);
    return () => window.removeEventListener(AUTO_PRINT_EVENT, onPrintRequest);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const ch = supabase.channel("auto-print-orders").on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: "status=eq.preparing" }, (payload) => {
      const row = payload.new as any;
      if (row?.id) void printOrder(row.id);
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled]);

  useEffect(() => {
    if (!job) return;
    const timer = window.setTimeout(() => {
      window.print();
      setJob(null);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [job]);

  if (!job) return null;
  return <PrintReceipt order={job.order} items={job.items} businessHoursText={businessHoursText} />;
}
