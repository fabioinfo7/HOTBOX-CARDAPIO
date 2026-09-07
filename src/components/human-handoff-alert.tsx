import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AlertTriangle, Phone, MessageCircle, BellOff } from "lucide-react";
import { setHandoffAlarmSrc, playHandoffAlarm, pauseHandoffAlarm } from "@/lib/handoff-alarm-audio";

type Handoff = {
  id: string;
  conversation_id: string | null;
  phone: string;
  customer_name: string | null;
  reason: string | null;
  expires_at?: string | null;
  created_at: string;
};

/**
 * Alerta global da loja para handoff realmente necessário:
 *  - toca um alarme contínuo separado do alarme de pedidos;
 *  - mostra um popup interno para o operador;
 *  - o cliente não recebe mensagem técnica;
 *  - não expira sozinho nem reativa o robô automaticamente.
 *
 * Pode existir mais de um pedido pendente ao mesmo tempo (clientes
 * diferentes) — mostra um por vez, sempre o mais antigo primeiro, e o
 * alarme continua tocando enquanto existir pelo menos um pendente.
 */
export function HumanHandoffAlert() {
  const [pending, setPending] = useState<Handoff[]>([]);
  const [alarmOn, setAlarmOn] = useState(true);
  const busy = useRef(false);

  // som + preferência (Configurações → Alertas → "IA pediu atendimento humano")
  useEffect(() => {
    supabase
      .from("store_config")
      .select("handoff_alarm_sound_url, handoff_alarm_default_on")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        setHandoffAlarmSrc(data?.handoff_alarm_sound_url || "");
        setAlarmOn(data?.handoff_alarm_default_on ?? true);
      });
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadPending() {
      const { data } = await (supabase as any)
        .from("pending_human_handoffs")
        .select("id, conversation_id, phone, customer_name, reason, expires_at, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (!alive) return;
      setPending((data as Handoff[]) ?? []);
    }

    loadPending();

    // Polling de segurança — mesma lógica do popup de aprovação de frete:
    // garante que o alerta aparece mesmo se o Realtime falhar silenciosamente.
    const pollId = setInterval(loadPending, 3000);

    const ch = supabase
      .channel("human-handoffs")
      .on("postgres_changes", { event: "*", schema: "public", table: "pending_human_handoffs" }, () => {
        loadPending();
      })
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          console.error("[human-handoff-alert] realtime subscription failed:", status, err);
        }
      });

    return () => {
      alive = false;
      clearInterval(pollId);
      supabase.removeChannel(ch);
    };
  }, []);

  // alarme contínuo enquanto houver pelo menos 1 pedido pendente
  useEffect(() => {
    if (!alarmOn) {
      pauseHandoffAlarm();
      return;
    }
    if (pending.length > 0) playHandoffAlarm();
    else pauseHandoffAlarm();
  }, [pending.length, alarmOn]);

  const item = pending[0] ?? null;

  // O alerta permanece até alguém assumir. Não existe mais expiração
  // automática que reative o robô sem o operador ver a conversa.


  async function assumirAtendimento() {
    if (!item || busy.current) return;
    busy.current = true;
    const { error: handoffErr } = await (supabase as any)
      .from("pending_human_handoffs")
      .update({ status: "assumed", resolved_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("status", "pending");
    if (handoffErr) {
      busy.current = false;
      toast.error("Não foi possível registrar que você assumiu");
      return;
    }
    if (item.conversation_id) {
      await supabase.from("whatsapp_conversations").update({ bot_paused: true }).eq("id", item.conversation_id);
    }
    pauseHandoffAlarm();
    toast.success("Atendimento manual assumido.");
    setPending((prev) => prev.filter((p) => p.id !== item.id));
  }

  if (!item) return null;


  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-foreground/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-background shadow-2xl">
        <div className="flex items-center gap-2 bg-destructive px-5 py-3 text-destructive-foreground">
          <AlertTriangle className="size-5" />
          <p className="font-display text-base font-black uppercase tracking-wide">Atendimento humano necessário</p>
          <span className="ml-auto rounded-full bg-destructive-foreground/15 px-2 py-0.5 text-xs font-bold">
            Ação necessária
          </span>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">
            Esta conversa precisa de intervenção manual. O cliente não recebeu nenhuma mensagem técnica sobre isso.
            Abra a conversa e continue normalmente a partir do ponto em que ela parou.
          </p>

          <div className="rounded-xl bg-muted/50 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Phone className="size-4 text-muted-foreground" />
              {item.customer_name ? `${item.customer_name} — ` : ""}
              {item.phone}
            </p>
            {item.reason && (
              <p className="mt-2 border-t pt-2 text-sm">
                <span className="font-semibold text-muted-foreground">Motivo: </span>
                {item.reason}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button className="flex-1" size="lg" variant="destructive" asChild onClick={assumirAtendimento}>
              <Link to="/loja/chat" search={{ phone: item.phone, name: item.customer_name ?? undefined }}>
                <MessageCircle className="size-4" />
                Assumir atendimento
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setAlarmOn(false);
                pauseHandoffAlarm();
              }}
              title="Silenciar o alarme (o popup continua até alguém assumir)"
            >
              <BellOff className="size-4" />
            </Button>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            O robô permanece pausado até um operador assumir ou reativá-lo manualmente.
          </p>
        </div>
      </div>
    </div>
  );
}
