// Caminho: src/routes/_authenticated/loja.reengajamento.tsx
// Tela: /loja/reengajamento
// Re-engajamento 100% MANUAL — o admin seleciona e decide quem recebe.

import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone, formatDateTime } from "@/lib/formatters";
import { sendReengagementBatch } from "@/lib/chat.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Send, Users, Clock, Search, CheckSquare, Square, History } from "lucide-react";

export const Route = createFileRoute("/_authenticated/loja/reengajamento")({
  component: ReengajamentoPage,
});

type Contact = {
  id: string;
  phone: string;
  name: string | null;
  created_at: string;
};

type SentRecord = {
  id: string;
  phone: string;
  sent_at: string | null;
  status: string;
  created_at: string;
};

const DEFAULT_MSG =
  "Olá! 👋 Vi que você entrou em contato mas não finalizou o pedido.\n\nPosso te ajudar com alguma dúvida ou montar seu pedido agora? 😊";

export default function ReengajamentoPage() {
  const [tab, setTab] = useState<"enviar" | "historico">("enviar");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState(DEFAULT_MSG);
  const [q, setQ] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [history, setHistory] = useState<SentRecord[]>([]);

  async function loadContacts() {
    // Contatos que enviaram mensagem mas nunca compraram (order_count = 0)
    const { data } = await supabase
      .from("leads")
      .select("id,phone,name,created_at")
      .eq("order_count", 0)
      .order("created_at", { ascending: false });
    setContacts((data as Contact[]) ?? []);
  }

  async function loadHistory() {
    const { data } = await supabase
      .from("reengagement_queue")
      .select("id,phone,sent_at,status,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    setHistory((data as SentRecord[]) ?? []);
  }

  useEffect(() => {
    loadContacts();
    loadHistory();
  }, []);

  const filtered = contacts.filter((c) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (c.name ?? "").toLowerCase().includes(s) || c.phone.includes(q.replace(/\D/g, ""));
  });

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((c) => c.phone)));
    }
  }

  function toggleOne(phone: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(phone) ? next.delete(phone) : next.add(phone);
      return next;
    });
  }

  async function handleSend() {
    if (!selected.size) return toast.error("Selecione ao menos um contato");
    if (!message.trim()) return toast.error("Digite a mensagem");

    const phones = [...selected];
    setSending(true);
    setProgress({ sent: 0, total: phones.length });

    try {
      const result = await sendReengagementBatch({ data: { phones, message } });
      toast.success(`${result.sent} mensagem(s) enviada(s) com sucesso`);
      setSelected(new Set());
      await loadContacts();
      await loadHistory();
    } catch {
      toast.error("Erro ao enviar mensagens");
    }

    setSending(false);
    setProgress(null);
  }

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      {/* Cabeçalho */}
      <div>
        <h1 className="text-xl font-bold">Re-engajamento manual</h1>
        <p className="text-sm text-muted-foreground">
          Selecione os contatos que nunca compraram e envie uma mensagem. Você decide quem recebe e quando.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {(["enviar", "historico"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium transition ${
              tab === t
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "enviar" ? (
              <span className="flex items-center gap-1.5"><Send className="size-3.5" /> Enviar mensagem</span>
            ) : (
              <span className="flex items-center gap-1.5"><History className="size-3.5" /> Histórico</span>
            )}
          </button>
        ))}
      </div>

      {tab === "enviar" && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Coluna esquerda — lista de contatos */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <Users className="size-4 text-muted-foreground" />
                {contacts.length} contato(s) sem compra
              </p>
              <button
                onClick={toggleAll}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {allSelected
                  ? <><Square className="size-3.5" /> Desmarcar todos</>
                  : <><CheckSquare className="size-3.5" /> Selecionar todos ({filtered.length})</>
                }
              </button>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 text-sm" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>

            <Card className="max-h-[420px] divide-y overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Nenhum contato sem compra.</p>
              ) : (
                filtered.map((c) => (
                  <div
                    key={c.phone}
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/40"
                    onClick={() => toggleOne(c.phone)}
                  >
                    <Checkbox
                      checked={selected.has(c.phone)}
                      onCheckedChange={() => toggleOne(c.phone)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{c.name || "Sem nome"}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatPhone(c.phone)} • chegou em {formatDateTime(c.created_at)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </Card>
          </div>

          {/* Coluna direita — mensagem + envio */}
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-sm font-semibold">Mensagem</p>
              <Textarea
                rows={7}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Digite a mensagem que será enviada..."
                className="resize-none text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                A mensagem será enviada pelo mesmo número do atendimento.
              </p>
            </div>

            {/* Resumo */}
            <Card className="p-4 text-sm">
              <p className="font-semibold">Resumo do envio</p>
              <p className="mt-1 text-muted-foreground">
                <b className="text-foreground">{selected.size}</b> contato(s) selecionado(s)
              </p>
              {selected.size > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Tempo estimado: ~{Math.ceil(selected.size * 6 / 60)} min (delay anti-ban entre envios)
                </p>
              )}
            </Card>

            {/* Progresso */}
            {sending && progress && (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="size-4 animate-pulse text-primary" />
                  <span>Enviando… aguarde sem fechar a página</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/20">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${(progress.sent / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <Button
              className="w-full"
              disabled={!selected.size || !message.trim() || sending}
              onClick={handleSend}
            >
              <Send className="mr-2 size-4" />
              {sending ? "Enviando…" : `Enviar para ${selected.size} contato(s)`}
            </Button>
          </div>
        </div>
      )}

      {tab === "historico" && (
        <Card className="divide-y">
          {history.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              Nenhum envio registrado ainda.
            </p>
          ) : (
            history.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{formatPhone(r.phone)}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.sent_at ? `Enviado em ${formatDateTime(r.sent_at)}` : formatDateTime(r.created_at)}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  r.status === "sent"
                    ? "bg-green-100 text-green-700"
                    : r.status === "cancelled"
                    ? "bg-gray-100 text-gray-500"
                    : "bg-yellow-100 text-yellow-700"
                }`}>
                  {r.status === "sent" ? "Enviado" : r.status === "cancelled" ? "Cancelado" : "Pendente"}
                </span>
              </div>
            ))
          )}
        </Card>
      )}
    </div>
  );
}
