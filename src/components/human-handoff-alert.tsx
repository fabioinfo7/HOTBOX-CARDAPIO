import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AlertTriangle, Phone, Timer, MessageCircle, BellOff } from "lucide-react";
import { getHandoffAlarmAudio, setHandoffAlarmSrc, playHandoffAlarm, pauseHandoffAlarm } from "@/lib/handoff-alarm-audio";

type Handoff = {
  id: string;
  conversation_id: string | null;
  phone: string;
  customer_name: string | null;
  reason: string | null;
  expires_at: string;
  created_at: string;
};

/**
 * Alerta global da loja: sempre que a IA chama request_human_handoff (porque
 * não sabe responder algo com segurança), esse componente:
 *  - toca um alarme contínuo (separado do alarme de pedidos)
 *  - mostra um popup pedindo pra um atendente assumir a conversa
 *  - se ninguém assumir em 2 minutos, o pedido expira sozinho (job no banco)
 *    e a IA volta a atender normalmente essa conversa.
 *
 * Pode existir mais de um pedido pendente ao mesmo tempo (clientes
 * diferentes) — mostra um por vez, sempre o mais antigo primeiro, e o
 * alarme continua tocando enquanto existir pelo menos um pendente.
 */
export function HumanHandoffAlert() {
  const [pending, setPending] = useState<Handoff[]>([]);
  const [alarmOn, setAlarmOn] = useState(true);
  const [left, setLeft] = useState(120);
  const busy = useRef(false);

  // som + preferência (Configurações → Alertas → "IA pediu atendimento humano")
  useEffect(() => {
    supabase
      .from("store_config")
      .select("handoff_alarm_sound_url, handoff_alarm_default_on")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        setHandoffAlarmSrc(
          data?.handoff_alarm_sound_url || "https://cdn.jsdelivr.net/gh/anars/blank-audio/1-minute-of-silence.mp3",
        );
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
        .gt("expires_at", new Date().toISOString())
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

  // contagem regressiva do item exibido; some sozinho quando expira (o job
  // no banco já cuida de marcar status='expired' — aqui é só a UI)
  useEffect(() => {
    if (!item) return;
    busy.current = false;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((new Date(item.expires_at).getTime() - Date.now()) / 1000));
      setLeft(secs);
      if (secs === 0) setPending((prev) => prev.filter((p) => p.id !== item.id));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [item?.id, item?.expires_at]);

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
    toast.success("Você assumiu essa conversa — a IA parou de responder por aqui.");
    setPending((prev) => prev.filter((p) => p.id !== item.id));
  }

  if (!item) return null;

  const minutes = Math.floor(left / 60);
  const seconds = left % 60;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-foreground/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-background shadow-2xl">
        <div className="flex items-center gap-2 bg-destructive px-5 py-3 text-destructive-foreground">
          <AlertTriangle className="size-5" />
          <p className="font-display text-base font-black uppercase tracking-wide">Atendimento humano necessário</p>
          <span className="ml-auto flex items-center gap-1 rounded-full bg-destructive-foreground/15 px-2 py-0.5 text-xs font-bold">
            <Timer className="size-3.5" />
            {minutes}:{String(seconds).padStart(2, "0")}
          </span>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">
            A IA não conseguiu responder esse cliente com segurança e já avisou que vai transferir. Assuma a conversa
            ou deixe que a IA continue tentando contornar sozinha.
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
              title="Silenciar o alarme (o popup continua até alguém assumir ou o prazo acabar)"
            >
              <BellOff className="size-4" />
            </Button>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            Sem ninguém assumir em {minutes}:{String(seconds).padStart(2, "0")}, a IA volta a atender normalmente e
            tenta contornar a situação sozinha.
          </p>
        </div>
      </div>
    </div>
  );
}
