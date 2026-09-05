import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/formatters";
import { askAboutLogsFn } from "@/lib/logs-ai.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot,
  Send,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Trash2,
  Radio,
  User,
  Plus,
  Pencil,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/loja/logs")({
  component: LogsPage,
});

type ApiLogRow = {
  id: string;
  source: string;
  direction: string;
  response_status: number | null;
  response_body: string | null;
  error_message: string | null;
  request_payload: any;
  created_at: string;
  order_id: string | null;
  event_type: string | null;
};

type AuditRow = {
  id: string;
  user_email: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: any;
  new_data: any;
  created_at: string;
};

const PAGE_SIZE = 25;

const TABLE_LABEL: Record<string, string> = {
  products: "Produto",
  ingredients: "Insumo",
  recipe_items: "Ficha técnica",
  deliverers: "Entregador",
  store_config: "Configurações",
  orders: "Pedido",
  ifood_product_map: "Mapeamento iFood",
};
const ACTION_LABEL: Record<string, { label: string; icon: any; color: string }> = {
  INSERT: { label: "Criou", icon: Plus, color: "text-emerald-600" },
  UPDATE: { label: "Editou", icon: Pencil, color: "text-amber-600" },
  DELETE: { label: "Excluiu", icon: Trash2, color: "text-destructive" },
};

/**
 * Traduz cada linha de log técnico pra uma frase simples, tipo "Pedido
 * aceito", "Pedido saiu para entrega" — o objetivo é você entender o que
 * aconteceu de relance, sem precisar saber o que "ifood_status_push" ou
 * "202" significam. O técnico continua disponível ao expandir a linha.
 */
function translateLogEntry(r: ApiLogRow): string {
  const isError = !!r.error_message || (r.response_status != null && r.response_status >= 400);
  const evt = (r.event_type || "").toUpperCase();

  // identificação curta do pedido, direto no título — pra você bater o olho
  // e já saber de QUAL pedido a linha está falando, sem precisar expandir
  const ped = r.order_id
    ? ` (pedido ${r.order_id.length > 10 ? "…" + r.order_id.slice(-6).toUpperCase() : "#" + r.order_id})`
    : "";

  if (r.source === "ifood_webhook") {
    if (r.response_status === 401)
      return "🔒 iFood tentou entregar um pedido, mas a senha da URL não confere — pedido NÃO entrou";
    if (r.response_status === 400)
      return "⚠️ Chegou uma mensagem da iFood que não é um pedido válido — nada foi criado";
    if (isError) return `❌ Um pedido da iFood chegou mas NÃO foi salvo${ped} — motivo: ${r.error_message}`;
    if (r.response_status === 200) return `📩 Pedido novo da iFood entrou no sistema${ped}`;
    return `📥 A iFood mandou uma mensagem pro sistema${ped}`;
  }
  if (r.source === "ifood_order_create") {
    if (isError) return `❌ Pedido da iFood chegou mas deu erro ao salvar${ped} — motivo: ${r.error_message}`;
    return `✅ Pedido da iFood salvo e já visível na tela de Pedidos${ped}`;
  }
  if (r.source === "ifood_status_push") {
    const actionLabel: Record<string, string> = {
      confirm: "Você ACEITOU o pedido",
      readytopickup: "Você marcou o pedido como PRONTO",
      dispatch: "Você DESPACHOU o pedido (saiu para entrega)",
      requestcancellation: "Você CANCELOU o pedido",
    };
    const label = actionLabel[evt.toLowerCase()] || "Você mudou o status do pedido";
    if (isError) return `⚠️ ${label}${ped}, mas o aviso NÃO chegou na iFood — motivo: ${r.error_message}`;
    return `✅ ${label}${ped} — e a iFood já foi avisada`;
  }
  if (r.source === "ifood_poll") {
    if (isError)
      return `❌ O sistema tentou verificar se tem pedido novo na iFood, mas falhou — motivo: ${r.error_message}`;
    return `🔄 Verificação automática de novidades na iFood${r.response_body ? ` — ${r.response_body}` : " — nada novo"}`;
  }
  if (r.source === "ifood_poll_event") {
    if (evt === "PLC" || evt === "PLACED") return `📩 A iFood avisou: tem pedido novo chegando${ped}`;
    if (evt.includes("CANCELLATION_REQUESTED") || evt === "CAR")
      return `🔔 A iFood pediu o cancelamento de um pedido${ped} — o sistema já está tratando sozinho`;
    if (evt.includes("CANCELLATION_REQUEST_FAILED") || evt === "CRF")
      return `🚨 ATENÇÃO: a iFood RECUSOU um cancelamento${ped} — esse pedido pode ainda estar ativo lá; confira manualmente`;
    if (evt === "CANCELLED" || evt === "CAN")
      return `❌ Cancelamento confirmado pela iFood${ped} — o pedido já aparece como cancelado aqui também`;
    if (evt.includes("CONC") || evt === "CON")
      return `✅ A iFood confirmou a ENTREGA${ped} — o pedido virou "Entregue" sozinho e saiu da tela de Pedidos`;
    if (evt.includes("DISPATCH") || evt === "DSP")
      return `🛵 O entregador da iFood SAIU com o pedido${ped} — o status mudou sozinho pra "Saiu para entrega"`;
    if (evt.includes("ASSIGN_DRIVER")) return `🏍️ A iFood designou um entregador${ped} — ele está a caminho da loja`;
    if (isError)
      return `⚠️ A iFood mandou um aviso que o sistema não conseguiu processar${ped} — motivo: ${r.error_message}`;
    return `📋 A iFood mandou um aviso do tipo "${r.event_type || "desconhecido"}"${ped} — sem ação necessária`;
  }
  if (r.source === "ifood_auth") {
    if (isError)
      return `🔑 O sistema tentou se conectar na iFood mas as credenciais falharam — confira Client ID/Secret em Configurações`;
    return "🔑 Conexão com a iFood renovada — tudo certo com as credenciais";
  }
  if (r.source === "ifood_cancellation") {
    if (isError)
      return `❌ O sistema tentou confirmar um cancelamento na iFood mas falhou${ped} — motivo: ${r.error_message}`;
    return `✅ Cancelamento confirmado junto à iFood${ped}`;
  }
  if (r.source === "ifood_cancellation_reasons") {
    if (isError)
      return `⚠️ Antes de cancelar, o sistema consulta os motivos que a iFood aceita — essa consulta falhou${ped} (usou um motivo padrão no lugar)`;
    return `📋 Consulta dos motivos de cancelamento aceitos pela iFood${ped} — parte normal do processo de cancelar`;
  }
  if (r.source === "evolution_webhook") {
    if (isError) return `❌ Deu erro no atendimento automático do WhatsApp — motivo: ${r.error_message}`;
    return "💬 Mensagem de cliente no WhatsApp atendida pela IA";
  }
  if (r.source === "whatsapp_sem_texto" || r.source === "meta_webhook") {
    return `📎 Mensagem recebida num formato sem texto reconhecido — ${r.response_body ?? "abra pra ver os detalhes"}`;
  }
  if (r.source === "stripe_webhook") {
    if (isError) return `❌ Um pagamento por cartão falhou — motivo: ${r.error_message}`;
    return "💳 Pagamento por cartão aprovado e confirmado";
  }
  if (r.source === "geocode_store_address") {
    if (isError)
      return `📍 O sistema não conseguiu localizar o endereço da loja no mapa — o cálculo de frete pode falhar por causa disso`;
    return "📍 Endereço da loja localizado no mapa — cálculo de frete funcionando";
  }

  return isError
    ? `❌ Algo deu errado: ${r.error_message ?? "erro não detalhado"}`
    : "✅ Operação concluída com sucesso";
}

function LogsPage() {
  const [rows, setRows] = useState<ApiLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [clearing, setClearing] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const pageRef = useRef(0);
  const sourceRef = useRef("all");

  const [chatHistory, setChatHistory] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPage, setAuditPage] = useState(0);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditExpandedId, setAuditExpandedId] = useState<string | null>(null);

  async function load(targetPage = page, source = sourceFilter) {
    setLoading(true);
    let q = supabase
      .from("api_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1);
    if (source !== "all") q = q.eq("source", source);
    const { data, count } = await q;
    setRows((data as ApiLogRow[]) ?? []);
    setTotalCount(count ?? 0);
    setPage(targetPage);
    pageRef.current = targetPage;
    sourceRef.current = source;
    setLoading(false);
    setLiveCount(0);
  }

  async function loadAudit(targetPage = auditPage) {
    setAuditLoading(true);
    const { data, count } = await supabase
      .from("audit_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1);
    setAuditRows((data as AuditRow[]) ?? []);
    setAuditTotal(count ?? 0);
    setAuditPage(targetPage);
    setAuditLoading(false);
  }

  useEffect(() => {
    load(0);
    loadAudit(0);
    supabase
      .from("api_logs")
      .select("source")
      .then(({ data }) => {
        setSources(Array.from(new Set((data ?? []).map((r: any) => r.source))));
      });

    const channel = supabase
      .channel("api-logs-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "api_logs" }, () => {
        if (pageRef.current === 0) load(0, sourceRef.current);
        else setLiveCount((c) => c + 1);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_log" }, () => {
        loadAudit(0);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function clearLogs() {
    if (!window.confirm("Apagar todos os logs de integração registrados até agora? Não dá pra desfazer.")) return;
    setClearing(true);
    try {
      const { error } = await supabase.from("api_logs").delete().not("id", "is", null);
      if (error) throw error;
      toast.success("Logs apagados!");
      load(0);
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao apagar logs");
    } finally {
      setClearing(false);
    }
  }

  async function askAi() {
    if (!question.trim()) return;
    const q = question.trim();
    setChatHistory((prev) => [...prev, { role: "user", text: q }]);
    setQuestion("");
    setAsking(true);
    try {
      const res = await askAboutLogsFn({ data: { question: q } });
      setChatHistory((prev) => [...prev, { role: "assistant", text: res.answer }]);
    } catch {
      setChatHistory((prev) => [...prev, { role: "assistant", text: "Não consegui responder agora — tenta de novo." }]);
    } finally {
      setAsking(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-black uppercase tracking-tight">Logs</h1>
        <p className="text-sm text-muted-foreground">
          Tudo que acontece no sistema — integrações externas e atividade da equipe — atualizando em tempo real.
        </p>
      </div>

      <Tabs defaultValue="integracoes">
        <TabsList>
          <TabsTrigger value="integracoes">Integrações (iFood, WhatsApp...)</TabsTrigger>
          <TabsTrigger value="usuarios">Atividade dos usuários</TabsTrigger>
        </TabsList>

        <TabsContent value="integracoes" className="space-y-6">
          <Card className="space-y-3 p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Bot className="size-4 text-violet-600" /> Pergunte pra IA sobre os logs
            </h2>
            <p className="text-xs text-muted-foreground">
              Ex: "por que meu último teste da iFood não chegou?" ou "teve algum erro de autenticação hoje?"
            </p>

            {chatHistory.length > 0 && (
              <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-3">
                {chatHistory.map((m, i) => (
                  <div
                    key={i}
                    className={`rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "ml-8 bg-primary text-primary-foreground" : "mr-8 bg-card"}`}
                  >
                    {m.text}
                  </div>
                ))}
                {asking && (
                  <div className="mr-8 rounded-lg bg-card px-3 py-2 text-sm text-muted-foreground">
                    Analisando os logs...
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") askAi();
                }}
                placeholder="Pergunta sobre os logs..."
                disabled={asking}
              />
              <Button onClick={askAi} disabled={asking || !question.trim()}>
                <Send className="size-4" />
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold">
                Registros ({totalCount})
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  <Radio className="size-3 animate-pulse" /> Ao vivo
                </span>
              </h2>
              <div className="flex gap-2">
                {liveCount > 0 && (
                  <Button size="sm" onClick={() => load(0)}>
                    {liveCount} novo(s) — atualizar
                  </Button>
                )}
                <Select
                  value={sourceFilter}
                  onValueChange={(v) => {
                    setSourceFilter(v);
                    load(0, v);
                  }}
                >
                  <SelectTrigger className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as origens</SelectItem>
                    {sources.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => load(page)} disabled={loading}>
                  <RefreshCw className="size-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={clearLogs} disabled={loading || clearing}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>

            {!rows.length ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {loading ? "Carregando..." : "Nenhum log ainda."}
              </p>
            ) : (
              <div className="space-y-1.5">
                {rows.map((r) => {
                  const isError = !!r.error_message || (r.response_status != null && r.response_status >= 400);
                  const isOpen = expandedId === r.id;
                  const friendly = translateLogEntry(r);
                  return (
                    <div
                      key={r.id}
                      className={`rounded-lg border ${isError ? "border-destructive/40 bg-destructive/5" : "bg-muted/10"}`}
                    >
                      <button
                        className="flex w-full items-start gap-3 p-2.5 text-left"
                        onClick={() => setExpandedId(isOpen ? null : r.id)}
                      >
                        {isError ? (
                          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                        ) : (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{friendly}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {formatDateTime(r.created_at)} · <span className="font-mono">{r.source}</span>
                            {r.event_type && <> · {r.event_type}</>}
                            {r.response_status != null && <> · status {r.response_status}</>}
                          </p>
                        </div>
                        {isOpen ? (
                          <ChevronUp className="mt-0.5 size-4 shrink-0" />
                        ) : (
                          <ChevronDown className="mt-0.5 size-4 shrink-0" />
                        )}
                      </button>
                      {isOpen && (
                        <div className="space-y-2 border-t p-3 text-xs">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Detalhe técnico</p>
                          {r.error_message && (
                            <p className="text-destructive">
                              <b>Erro:</b> {r.error_message}
                            </p>
                          )}
                          {r.response_body && (
                            <p>
                              <b>Resposta:</b> {r.response_body}
                            </p>
                          )}
                          {r.request_payload && (
                            <pre className="overflow-x-auto rounded bg-foreground/5 p-2 text-[11px]">
                              {JSON.stringify(r.request_payload, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Página {page + 1} de {totalPages}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => load(page - 1)}>
                  Anterior
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page + 1 >= totalPages || loading}
                  onClick={() => load(page + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="usuarios" className="space-y-6">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <User className="size-4" /> Atividade da equipe ({auditTotal})
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  <Radio className="size-3 animate-pulse" /> Ao vivo
                </span>
              </h2>
              <Button variant="outline" size="sm" onClick={() => loadAudit(auditPage)} disabled={auditLoading}>
                <RefreshCw className="size-4" /> Atualizar
              </Button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Toda vez que alguém logado no painel cria, edita ou apaga um produto, insumo, entregador, configuração ou
              pedido, fica registrado aqui — com quem fez e o que mudou.
            </p>

            {!auditRows.length ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {auditLoading ? "Carregando..." : "Nenhuma atividade registrada ainda."}
              </p>
            ) : (
              <div className="space-y-1.5">
                {auditRows.map((r) => {
                  const actionInfo = ACTION_LABEL[r.action] ?? {
                    label: r.action,
                    icon: Pencil,
                    color: "text-foreground",
                  };
                  const ActionIcon = actionInfo.icon;
                  const isOpen = auditExpandedId === r.id;
                  return (
                    <div key={r.id} className="rounded-lg border bg-muted/10">
                      <button
                        className="flex w-full items-center gap-3 p-2.5 text-left text-sm"
                        onClick={() => setAuditExpandedId(isOpen ? null : r.id)}
                      >
                        <ActionIcon className={`size-4 shrink-0 ${actionInfo.color}`} />
                        <span className="w-40 shrink-0 font-mono text-xs text-muted-foreground">
                          {formatDateTime(r.created_at)}
                        </span>
                        <span className="w-52 shrink-0 truncate font-semibold">
                          {r.user_email ?? "Usuário desconhecido"}
                        </span>
                        <span className={`w-20 shrink-0 text-xs font-bold ${actionInfo.color}`}>
                          {actionInfo.label}
                        </span>
                        <span className="flex-1 text-xs text-muted-foreground">
                          {TABLE_LABEL[r.table_name] ?? r.table_name}
                        </span>
                        {isOpen ? (
                          <ChevronUp className="size-4 shrink-0" />
                        ) : (
                          <ChevronDown className="size-4 shrink-0" />
                        )}
                      </button>
                      {isOpen && (
                        <div className="space-y-2 border-t p-3 text-xs">
                          {r.old_data && (
                            <div>
                              <b>Antes:</b>
                              <pre className="mt-1 overflow-x-auto rounded bg-foreground/5 p-2 text-[11px]">
                                {JSON.stringify(r.old_data, null, 2)}
                              </pre>
                            </div>
                          )}
                          {r.new_data && (
                            <div>
                              <b>Depois:</b>
                              <pre className="mt-1 overflow-x-auto rounded bg-foreground/5 p-2 text-[11px]">
                                {JSON.stringify(r.new_data, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Página {auditPage + 1} de {auditTotalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={auditPage === 0 || auditLoading}
                  onClick={() => loadAudit(auditPage - 1)}
                >
                  Anterior
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={auditPage + 1 >= auditTotalPages || auditLoading}
                  onClick={() => loadAudit(auditPage + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
