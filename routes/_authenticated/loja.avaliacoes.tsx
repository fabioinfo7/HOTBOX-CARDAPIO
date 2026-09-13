import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Award,
  CalendarDays,
  CheckCircle2,
  MessageSquareText,
  Quote,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsUp,
  TrendingUp,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/formatters";

export const Route = createFileRoute("/_authenticated/loja/avaliacoes")({
  component: SatisfactionDashboard,
});

type Feedback = {
  id: string;
  lead_id: string | null;
  customer_name: string | null;
  phone: string;
  sent_at: string;
  opened_at: string | null;
  submitted_at: string | null;
  service_rating: number | null;
  delivery_rating: number | null;
  flavor_rating: number | null;
  appearance_rating: number | null;
  comment: string | null;
};

const METRICS = [
  ["Atendimento", "service_rating"],
  ["Tempo de entrega", "delivery_rating"],
  ["Sabor", "flavor_rating"],
  ["Aparência", "appearance_rating"],
] as const;

type ReviewFilter = "all" | "five" | "comments";

function ratingAverage(item: Feedback) {
  const values = [item.service_rating, item.delivery_rating, item.flavor_rating, item.appearance_rating].filter(
    (v): v is number => typeof v === "number",
  );
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Privacidade: exibe somente os 4 últimos números do telefone do lead. */
function maskPhone(phone: string) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return "Telefone protegido";
  const last4 = digits.slice(-4).padStart(4, "*");
  return `(**) *****-${last4}`;
}

function ratingLabel(value: number) {
  if (value >= 4.75) return "Excelente";
  if (value >= 4) return "Muito bom";
  if (value >= 3) return "Bom";
  if (value >= 2) return "Regular";
  return "Precisa de atenção";
}

function Stars({ value, size = "sm" }: { value: number; size?: "sm" | "md" | "lg" }) {
  const iconClass = size === "lg" ? "size-5" : size === "md" ? "size-4" : "size-3.5";
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} de 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`${iconClass} ${star <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-zinc-300"}`}
        />
      ))}
    </span>
  );
}

function MetricScore({ label, value }: { label: string; value: number | null }) {
  const safeValue = typeof value === "number" ? value : 0;
  return (
    <div className="rounded-2xl border bg-muted/35 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Stars value={safeValue} />
        <span className="text-sm font-extrabold tabular-nums">{safeValue.toFixed(1)}</span>
      </div>
    </div>
  );
}

function SatisfactionDashboard() {
  const [rows, setRows] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("customer_feedback")
      .select(
        "id,lead_id,customer_name,phone,sent_at,opened_at,submitted_at,service_rating,delivery_rating,flavor_rating,appearance_rating,comment",
      )
      .order("created_at", { ascending: false });
    setRows((data as Feedback[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("customer-feedback-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_feedback" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const completed = useMemo(() => rows.filter((row) => !!row.submitted_at), [rows]);
  const sent = rows.length;
  const opened = rows.filter((row) => !!row.opened_at).length;
  const overall = completed.length
    ? completed.reduce((sum, item) => sum + (ratingAverage(item) ?? 0), 0) / completed.length
    : 0;
  const overallPercent = Math.round((overall / 5) * 100);
  const responseRate = sent ? Math.round((completed.length / sent) * 100) : 0;
  const fiveStarCount = completed.filter((item) => (ratingAverage(item) ?? 0) >= 4.75).length;
  const positiveCount = completed.filter((item) => (ratingAverage(item) ?? 0) >= 4).length;
  const positiveRate = completed.length ? Math.round((positiveCount / completed.length) * 100) : 0;
  const commentCount = completed.filter((item) => !!item.comment?.trim()).length;

  const chartData = METRICS.map(([name, key]) => {
    const values = completed.map((item) => item[key]).filter((v): v is number => typeof v === "number");
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return { name, media: Number(average.toFixed(2)), percentual: Math.round((average / 5) * 100) };
  });

  const bestMetric = chartData.reduce(
    (best, current) => (current.media > best.media ? current : best),
    chartData[0] ?? { name: "Sem dados", media: 0, percentual: 0 },
  );

  const filtered = completed.filter((item) => {
    const avg = ratingAverage(item) ?? 0;
    if (reviewFilter === "five" && avg < 4.75) return false;
    if (reviewFilter === "comments" && !item.comment?.trim()) return false;

    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const digits = q.replace(/\D/g, "");
    return (
      (item.customer_name ?? "").toLowerCase().includes(needle) ||
      (!!digits && item.phone.replace(/\D/g, "").endsWith(digits)) ||
      (item.comment ?? "").toLowerCase().includes(needle)
    );
  });

  return (
    <div className="space-y-6 p-1">
      <div className="rounded-3xl border bg-gradient-to-br from-background via-background to-muted/60 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                <Sparkles className="size-3.5" /> Prova social HotBox
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700">
                <ShieldCheck className="size-3.5" /> Telefones protegidos
              </span>
            </div>
            <h1 className="flex items-center gap-2 text-2xl font-black sm:text-3xl">
              <ThumbsUp className="size-7" /> Satisfação dos clientes
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Avaliações reais dos clientes, organizadas para acompanhar qualidade, identificar pontos fortes e usar comentários como prova social.
            </p>
          </div>

          <div className="min-w-[220px] rounded-2xl border bg-background/90 p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nota geral</p>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-4xl font-black tabular-nums">{overall.toFixed(1)}</span>
              <span className="mb-1 text-sm font-semibold text-muted-foreground">/ 5</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Stars value={overall} size="lg" />
              <span className="text-xs font-bold text-emerald-600">{overallPercent}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Avaliações respondidas</p>
            <Users className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-1 text-3xl font-extrabold">{completed.length}</p>
          <p className="text-xs text-muted-foreground">{responseRate}% dos convites enviados</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Avaliações positivas</p>
            <CheckCircle2 className="size-4 text-emerald-600" />
          </div>
          <p className="mt-1 text-3xl font-extrabold">{positiveRate}%</p>
          <p className="text-xs text-muted-foreground">Notas individuais a partir de 4</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Excelentes</p>
            <Award className="size-4 text-amber-500" />
          </div>
          <p className="mt-1 text-3xl font-extrabold">{fiveStarCount}</p>
          <p className="text-xs text-muted-foreground">Média individual próxima de 5 estrelas</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Comentários</p>
            <MessageSquareText className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-1 text-3xl font-extrabold">{commentCount}</p>
          <p className="text-xs text-muted-foreground">Depoimentos escritos recebidos</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Ponto mais forte</p>
            <TrendingUp className="size-4 text-primary" />
          </div>
          <p className="mt-2 truncate text-lg font-extrabold">{bestMetric.name}</p>
          <p className="text-xs text-muted-foreground">{bestMetric.media.toFixed(2)}/5 · {bestMetric.percentual}%</p>
        </Card>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-bold">Desempenho por quesito</h2>
            <p className="text-xs text-muted-foreground">Média real das avaliações respondidas.</p>
          </div>
          <div className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700">
            {positiveRate}% de avaliações positivas
          </div>
        </div>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 18 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-8} textAnchor="end" height={50} />
              <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [`${Number(value).toFixed(2)} / 5`, "Média"]} />
              <Bar dataKey="media" radius={[8, 8, 0, 0]} fill="currentColor" className="text-primary" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          {chartData.map((item) => (
            <div key={item.name} className="rounded-2xl border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{item.name}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-lg font-bold">{item.media.toFixed(2)}</p>
                <Stars value={item.media} />
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground">{item.percentual}% de satisfação</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-bold">Avaliações individuais</h2>
            <p className="text-xs text-muted-foreground">Depoimentos reais com dados pessoais protegidos para facilitar o uso como prova social.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border bg-background p-1">
              {([
                ["all", "Todas"],
                ["five", "Excelentes"],
                ["comments", "Com comentário"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReviewFilter(key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    reviewFilter === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="w-64 pl-9"
                placeholder="Nome, final do telefone ou comentário…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        </div>

        {loading ? (
          <Card className="p-8 text-center text-muted-foreground">Carregando avaliações…</Card>
        ) : filtered.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">Nenhuma avaliação respondida encontrada.</Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {filtered.map((item) => {
              const avg = ratingAverage(item) ?? 0;
              return (
                <Card key={item.id} className="overflow-hidden border-border/80 shadow-sm transition hover:shadow-md">
                  <div className="border-b bg-gradient-to-r from-muted/50 to-background p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <div className="flex items-center gap-2">
                            <div className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
                              <Users className="size-4" />
                            </div>
                            <p className="text-base font-black">{item.customer_name || "Cliente HotBox"}</p>
                          </div>
                          <span className="hidden h-5 w-px bg-border sm:block" />
                          <div className="flex items-center gap-2">
                            <Stars value={avg} size="md" />
                            <span className="text-lg font-black tabular-nums">{avg.toFixed(1)}</span>
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                              {ratingLabel(avg)}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <ShieldCheck className="size-3.5 text-emerald-600" /> {maskPhone(item.phone)}
                          </span>
                          {item.submitted_at && (
                            <span className="inline-flex items-center gap-1.5">
                              <CalendarDays className="size-3.5" /> {formatDateTime(item.submitted_at)}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                            <CheckCircle2 className="size-3.5" /> Avaliação verificada
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {METRICS.map(([label, key]) => (
                        <MetricScore key={key} label={label} value={item[key]} />
                      ))}
                    </div>

                    {item.comment?.trim() ? (
                      <div className="relative mt-4 overflow-hidden rounded-2xl border bg-background p-4 pl-11">
                        <Quote className="absolute left-4 top-4 size-5 fill-primary/10 text-primary/40" />
                        <p className="text-sm font-medium leading-relaxed">“{item.comment.trim()}”</p>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-muted-foreground">Depoimento do cliente</span>
                          {avg >= 4.75 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                              <Sparkles className="size-3" /> Ótimo para prova social
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                        Cliente avaliou as categorias, mas não deixou comentário escrito.
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
