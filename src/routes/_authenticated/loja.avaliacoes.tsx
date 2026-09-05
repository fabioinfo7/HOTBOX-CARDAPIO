import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MessageSquareText, Search, Star, ThumbsUp, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatPhone } from "@/lib/formatters";

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

function ratingAverage(item: Feedback) {
  const values = [item.service_rating, item.delivery_rating, item.flavor_rating, item.appearance_rating].filter((v): v is number => typeof v === "number");
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} de 5`}>
      {[1, 2, 3, 4, 5].map((star) => <Star key={star} className={`size-3.5 ${star <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-zinc-300"}`} />)}
    </span>
  );
}

function SatisfactionDashboard() {
  const [rows, setRows] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("customer_feedback")
      .select("id,lead_id,customer_name,phone,sent_at,opened_at,submitted_at,service_rating,delivery_rating,flavor_rating,appearance_rating,comment")
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
    return () => { supabase.removeChannel(channel); };
  }, []);

  const completed = useMemo(() => rows.filter((row) => !!row.submitted_at), [rows]);
  const sent = rows.length;
  const opened = rows.filter((row) => !!row.opened_at).length;
  const overall = completed.length
    ? completed.reduce((sum, item) => sum + (ratingAverage(item) ?? 0), 0) / completed.length
    : 0;
  const overallPercent = Math.round((overall / 5) * 100);
  const responseRate = sent ? Math.round((completed.length / sent) * 100) : 0;

  const chartData = METRICS.map(([name, key]) => {
    const values = completed.map((item) => item[key]).filter((v): v is number => typeof v === "number");
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return { name, media: Number(average.toFixed(2)), percentual: Math.round((average / 5) * 100) };
  });

  const filtered = completed.filter((item) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (item.customer_name ?? "").toLowerCase().includes(needle) || item.phone.includes(q.replace(/\D/g, "")) || (item.comment ?? "").toLowerCase().includes(needle);
  });

  return (
    <div className="space-y-5 p-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><ThumbsUp className="size-6" /> Satisfação dos clientes</h1>
          <p className="text-sm text-muted-foreground">Acompanhe a experiência real de quem comprou na HotBox.</p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="w-64 pl-9" placeholder="Nome, telefone ou comentário…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Avaliação geral</p><div className="mt-1 flex items-end gap-2"><p className="text-3xl font-extrabold">{overallPercent}%</p><span className="mb-1 text-sm text-muted-foreground">{overall.toFixed(2)}/5</span></div><Stars value={overall} /></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Respostas recebidas</p><p className="mt-1 text-3xl font-extrabold">{completed.length}</p><p className="text-xs text-muted-foreground">{responseRate}% dos convites enviados</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Convites enviados</p><p className="mt-1 text-3xl font-extrabold">{sent}</p><p className="text-xs text-muted-foreground">{opened} link(s) aberto(s)</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Comentários</p><p className="mt-1 text-3xl font-extrabold">{completed.filter((item) => !!item.comment).length}</p><p className="text-xs text-muted-foreground">Textos opcionais recebidos</p></Card>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="font-bold">Desempenho por quesito</h2>
          <p className="text-xs text-muted-foreground">Média das avaliações respondidas, convertida também em percentual.</p>
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
          {chartData.map((item) => <div key={item.name} className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">{item.name}</p><p className="text-lg font-bold">{item.percentual}%</p><p className="text-[11px] text-muted-foreground">{item.media.toFixed(2)} de 5</p></div>)}
        </div>
      </Card>

      <div>
        <h2 className="mb-3 font-bold">Avaliações individuais</h2>
        {loading ? (
          <Card className="p-8 text-center text-muted-foreground">Carregando avaliações…</Card>
        ) : filtered.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">Nenhuma avaliação respondida encontrada.</Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((item) => {
              const avg = ratingAverage(item) ?? 0;
              return (
                <Card key={item.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" /><p className="font-bold">{item.customer_name || "Cliente sem nome"}</p></div>
                      <p className="mt-1 text-xs text-muted-foreground">{formatPhone(item.phone)} • {item.submitted_at ? formatDateTime(item.submitted_at) : ""}</p>
                    </div>
                    <div className="text-right"><div className="flex items-center justify-end gap-2"><span className="text-xl font-extrabold">{avg.toFixed(1)}</span><Stars value={avg} /></div><p className="text-[11px] text-muted-foreground">média individual</p></div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {METRICS.map(([label, key]) => <div key={key} className="rounded-xl bg-muted/60 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-bold">{item[key]}/5</p></div>)}
                  </div>

                  {item.comment && <div className="mt-3 flex gap-2 rounded-xl border bg-background p-3 text-sm"><MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><p>{item.comment}</p></div>}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
