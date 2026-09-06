import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { toast } from "sonner";

/** Ícone "?" com dica ao passar o mouse (ou tocar, no celular) — explica em
 *  linguagem simples o que aquele termo/número quer dizer. Mesmo padrão já
 *  usado em loja.precificacao.tsx. */
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
import { Plus, Trash2, Upload, Pencil, MapPinned, Save, ScanSearch, Ban, TriangleAlert } from "lucide-react";
import { usePopulateZonas } from "@/lib/use-populate-zonas";

export const Route = createFileRoute("/_authenticated/loja/zonas-entrega")({
  component: ZonasEntregaPage,
  head: () => ({
    meta: [
      { title: "Zonas de entrega | HotBox Delivery" },
      {
        name: "description",
        content: "Ruas atendidas, faixas de km, custo por entrega e margem de cada zona da HotBox Delivery.",
      },
      { property: "og:title", content: "Zonas de entrega | HotBox Delivery" },
      {
        property: "og:description",
        content: "Gerencie ruas, faixas de km e a margem de cada entrega da HotBox Delivery.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Faixa = { id: string; nome: string; km_from: number; km_to: number; fee: number; ativo: boolean };
type Zona = {
  id: string;
  rua: string;
  bairro: string | null;
  distancia_km: number | null;
  faixa_id: string | null;
  lat: number | null;
  lng: number | null;
  entrega_disponivel: boolean;
  observacao: string | null;
  distancia_variavel?: boolean;
  distancia_km_min?: number | null;
  distancia_km_max?: number | null;
  distancia_suspeita?: boolean;
};

const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Verde = margem saudável, amarelo = baixa, vermelho = negativa. */
function marginTone(marginPct: number, okPct: number, lowPct: number) {
  if (marginPct < 0) return "text-destructive";
  if (marginPct < lowPct) return "text-amber-600 dark:text-amber-400";
  if (marginPct >= okPct) return "text-emerald-600 dark:text-emerald-400";
  return "text-amber-600 dark:text-amber-400";
}

const emptyZona = {
  rua: "",
  bairro: "",
  distancia_km: "",
  faixa_id: "",
  lat: "",
  lng: "",
  entrega_disponivel: true,
  observacao: "",
};

function ZonasEntregaPage() {
  const [faixas, setFaixas] = useState<Faixa[]>([]);
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [costPerKm, setCostPerKm] = useState(0.9);
  const [okPct, setOkPct] = useState(40);
  const [lowPct, setLowPct] = useState(15);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [bairroFilter, setBairroFilter] = useState("all");
  const [kmFilter, setKmFilter] = useState("all");
  const [faixaFilter, setFaixaFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [variavelFilter, setVariavelFilter] = useState("all");
  const [suspeitaFilter, setSuspeitaFilter] = useState("all");

  const [form, setForm] = useState<any>({ ...emptyZona });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [csvOpen, setCsvOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    const [f, z, cfg] = await Promise.all([
      supabase.from("faixas_entrega").select("*").order("km_from", { ascending: true }),
      supabase.from("zonas_entrega").select("*").order("rua", { ascending: true }),
      supabase.from("store_config").select("delivery_cost_per_km").eq("id", 1).maybeSingle(),
    ]);
    setFaixas((f.data as any) ?? []);
    setZonas((z.data as any) ?? []);
    if (cfg.data?.delivery_cost_per_km != null) setCostPerKm(Number(cfg.data.delivery_cost_per_km));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const populateZonas = usePopulateZonas(load);

  const faixaById = useMemo(() => Object.fromEntries(faixas.map((f) => [f.id, f])), [faixas]);

  const countsByFaixa = useMemo(() => {
    const out: Record<string, number> = {};
    for (const z of zonas) if (z.faixa_id) out[z.faixa_id] = (out[z.faixa_id] ?? 0) + 1;
    return out;
  }, [zonas]);

  const bairrosDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const z of zonas) if (z.bairro) set.add(z.bairro);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [zonas]);

  const KM_OPTIONS = [1, 2, 3, 4.5, 6];

  const filtered = useMemo(() => {
    const norm = (s: string) =>
      s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    const kmMax = kmFilter === "all" ? null : Number(kmFilter);
    return zonas.filter((z) => {
      if (q && !norm(z.rua).includes(norm(q))) return false;
      if (bairroFilter !== "all" && (z.bairro ?? "") !== bairroFilter) return false;
      if (faixaFilter !== "all" && z.faixa_id !== faixaFilter) return false;
      if (statusFilter === "ativa" && !z.entrega_disponivel) return false;
      if (statusFilter === "sem_entrega" && z.entrega_disponivel) return false;
      if (variavelFilter === "variavel" && !z.distancia_variavel) return false;
      if (variavelFilter === "fixa" && z.distancia_variavel) return false;
      if (suspeitaFilter === "suspeita" && !z.distancia_suspeita) return false;
      if (suspeitaFilter === "normal" && z.distancia_suspeita) return false;
      if (kmMax != null) {
        // rua de distância variável (preço calculado por número, não fixo):
        // usa a distância mínima possível pra decidir se ENTRA no filtro —
        // se nem o ponto mais próximo da rua cabe no limite, ela fica de fora.
        const km = z.distancia_variavel ? z.distancia_km_min : z.distancia_km;
        if (km == null || km > kmMax) return false;
      }
      return true;
    });
  }, [zonas, q, bairroFilter, faixaFilter, statusFilter, variavelFilter, suspeitaFilter, kmFilter]);

  // ---------- faixas ----------
  async function saveFaixa(f: Faixa) {
    const { error } = await supabase
      .from("faixas_entrega")
      .update({
        nome: f.nome,
        km_from: Number(f.km_from),
        km_to: Number(f.km_to),
        fee: Number(f.fee),
        ativo: f.ativo,
      })
      .eq("id", f.id);
    if (error) toast.error(error.message);
    else toast.success("Faixa salva");
  }

  async function addFaixa() {
    const last = faixas[faixas.length - 1];
    const from = last ? Number(last.km_to) : 0;
    const { error } = await supabase
      .from("faixas_entrega")
      .insert({ nome: `Faixa ${from}-${from + 3} km`, km_from: from, km_to: from + 3, fee: 0, ativo: true });
    if (error) return toast.error(error.message);
    load();
  }

  async function removeFaixa(id: string) {
    const { error } = await supabase.from("faixas_entrega").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  // ---------- zonas ----------
  function openNew() {
    setForm({ ...emptyZona });
    setEditingId(null);
    setOpen(true);
  }

  function openEdit(z: Zona) {
    setForm({
      rua: z.rua,
      bairro: z.bairro ?? "",
      distancia_km: z.distancia_km ?? "",
      faixa_id: z.faixa_id ?? "",
      lat: z.lat ?? "",
      lng: z.lng ?? "",
      entrega_disponivel: z.entrega_disponivel,
      observacao: z.observacao ?? "",
    });
    setEditingId(z.id);
    setOpen(true);
  }

  async function saveZona() {
    if (!form.rua.trim()) return toast.error("Informe o nome da rua");
    const payload = {
      rua: form.rua.trim(),
      bairro: form.bairro?.trim() || null,
      distancia_km: form.distancia_km === "" ? null : Number(form.distancia_km),
      faixa_id: form.faixa_id || null,
      lat: form.lat === "" ? null : Number(form.lat),
      lng: form.lng === "" ? null : Number(form.lng),
      entrega_disponivel: !!form.entrega_disponivel,
      observacao: form.observacao?.trim() || null,
    };
    const { error } = editingId
      ? await supabase.from("zonas_entrega").update(payload).eq("id", editingId)
      : await supabase.from("zonas_entrega").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(editingId ? "Rua atualizada" : "Rua cadastrada");
    setOpen(false);
    load();
  }

  async function removeZona(id: string) {
    const { error } = await supabase.from("zonas_entrega").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setZonas((prev) => prev.filter((z) => z.id !== id));
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggleSelectRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAllRows(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const z of filtered) {
        if (checked) next.add(z.id);
        else next.delete(z.id);
      }
      return next;
    });
  }

  /** Exclui todas as ruas marcadas de uma vez. Em lotes de 150 (mesmo
   *  motivo do toggleAllEntregaDisponivel: evita URL longa demais e
   *  "Bad Request" quando há muitas ruas selecionadas). */
  async function removeSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!window.confirm(`Excluir ${ids.length} rua(s) selecionada(s)? Essa ação não pode ser desfeita.`)) return;

    const CHUNK_SIZE = 150;
    let removed = 0;
    let failedCount = 0;
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase.from("zonas_entrega").delete().in("id", chunk);
      if (error) {
        failedCount += chunk.length;
      } else {
        removed += chunk.length;
        setZonas((prev) => prev.filter((z) => !chunk.includes(z.id)));
      }
    }

    setSelected(new Set());
    if (failedCount) {
      toast.error(`${removed} rua(s) excluída(s). ${failedCount} falharam — tente de novo.`);
    } else {
      toast.success(`${removed} rua(s) excluída(s).`);
    }
  }

  /** Marca/desmarca "não entregamos aqui" direto na linha, sem abrir o diálogo de edição. */
  async function toggleEntregaDisponivel(id: string, entregaDisponivel: boolean) {
    setZonas((prev) => prev.map((z) => (z.id === id ? { ...z, entrega_disponivel: entregaDisponivel } : z)));
    const { error } = await supabase
      .from("zonas_entrega")
      .update({ entrega_disponivel: entregaDisponivel })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      setZonas((prev) => prev.map((z) => (z.id === id ? { ...z, entrega_disponivel: !entregaDisponivel } : z)));
      return;
    }
    toast.success(entregaDisponivel ? "Entrega reativada nessa rua" : "Marcado como sem entrega nessa rua");
  }

  /** Checkbox "selecionar todas" do cabeçalho: aplica o mesmo status pra
   *  todas as ruas que estão sendo exibidas com os filtros atuais (não as
   *  que estão escondidas pelo filtro, pra não mexer no que a pessoa não
   *  está vendo).
   *
   *  Manda em lotes pequenos (não tudo de uma vez num só `.in("id", ids)`):
   *  quando a lista de ruas é grande, um `.in()` com centenas/milhares de
   *  IDs de uma vez gera uma URL longa demais e o Supabase/PostgREST
   *  recusa a requisição com "Bad Request" antes mesmo de tentar
   *  atualizar. Em lotes de 150 isso nunca acontece. */
  async function toggleAllEntregaDisponivel(entregaDisponivel: boolean) {
    const ids = filtered.map((z) => z.id);
    if (!ids.length) return;
    setZonas((prev) => prev.map((z) => (ids.includes(z.id) ? { ...z, entrega_disponivel: entregaDisponivel } : z)));

    const CHUNK_SIZE = 150;
    let failedCount = 0;
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase
        .from("zonas_entrega")
        .update({ entrega_disponivel: entregaDisponivel })
        .in("id", chunk);
      if (error) {
        failedCount += chunk.length;
        setZonas((prev) => prev.map((z) => (chunk.includes(z.id) ? { ...z, entrega_disponivel: !entregaDisponivel } : z)));
      }
    }

    if (failedCount) {
      toast.error(
        `${failedCount} rua(s) não atualizaram. ${ids.length - failedCount} atualizada(s) com sucesso.`,
      );
      return;
    }
    toast.success(
      entregaDisponivel ? `${ids.length} rua(s) reativada(s)` : `${ids.length} rua(s) marcada(s) como sem entrega`,
    );
  }

  /** CSV: rua,bairro,distancia_km,faixa,lat,lng — "faixa" bate pelo nome ou pela distância. */
  async function importCsv() {
    const lines = csv
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return toast.error("Cole o conteúdo do CSV");
    if (/^rua[;,]/i.test(lines[0])) lines.shift();

    const rows = lines.map((line) => {
      const [rua, bairro, distancia, faixaNome, lat, lng] = line.split(/[;,]/).map((c) => c?.trim() ?? "");
      const km = distancia ? Number(distancia.replace(",", ".")) : null;
      const byName = faixaNome ? faixas.find((f) => f.nome.toLowerCase() === faixaNome.toLowerCase()) : null;
      const byKm = km != null ? faixas.find((f) => km >= Number(f.km_from) && km < Number(f.km_to)) : null;
      return {
        rua,
        bairro: bairro || null,
        distancia_km: km,
        faixa_id: (byName ?? byKm)?.id ?? null,
        lat: lat ? Number(lat.replace(",", ".")) : null,
        lng: lng ? Number(lng.replace(",", ".")) : null,
        entrega_disponivel: true,
      };
    });
    const valid = rows.filter((r) => r.rua);
    if (!valid.length) return toast.error("Nenhuma linha válida encontrada");
    const { error } = await supabase.from("zonas_entrega").insert(valid);
    if (error) return toast.error(error.message);
    toast.success(`${valid.length} rua(s) importada(s)`);
    setCsv("");
    setCsvOpen(false);
    load();
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-black uppercase tracking-tight">
            <MapPinned className="size-6 text-primary" /> Zonas de entrega
          </h1>
          <p className="text-sm text-muted-foreground">
            Painel de consulta — mostra as ruas conforme os pedidos vão acontecendo, só pra você acompanhar. O valor
            cobrado de cada cliente é sempre recalculado na hora do pedido (endereço completo + distância real), não é
            lido daqui.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={populateZonas.running} onClick={populateZonas.run}>
            <ScanSearch className="size-4" />
            {populateZonas.running
              ? populateZonas.progress
                ? (populateZonas.progress.label ?? `Varrendo... (${populateZonas.progress.processed}/${populateZonas.progress.total})`)
                : "Buscando ruas..."
              : "Povoar automaticamente"}
          </Button>
          <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Upload className="size-4" /> Importar CSV
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Importar ruas em lote</DialogTitle>
              </DialogHeader>
              <p className="text-xs text-muted-foreground">
                Uma rua por linha, colunas: <b>rua, bairro, distancia_km, faixa, lat, lng</b>. A faixa pode vir pelo
                nome — se ficar vazia, é escolhida pela distância.
              </p>
              <Textarea
                rows={10}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                placeholder={"Rua das Flores,Centro,2.4,Faixa 0-3 km,,\nAv. Brasil,Jardim Primavera,5.1,,,"}
              />
              <DialogFooter>
                <Button onClick={importCsv}>Importar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button onClick={openNew}>
            <Plus className="size-4" /> Adicionar rua
          </Button>
        </div>
      </header>

      {/* -------- faixas -------- */}
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">
              Faixas de entrega{" "}
              <InfoTip text="Cada faixa define um intervalo de distância (ex: de 0 até 3 km) e quanto você cobra do cliente por entregar nela. É essa faixa que decide o valor da taxa de entrega mostrado pro cliente." />
            </h2>
            <p className="text-xs text-muted-foreground">
              Custo por km rodado: <b>{brl(costPerKm)}</b> (altere em Configurações → Entrega). Os custos abaixo já
              contam ida e volta automaticamente.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label className="text-[11px]">
                Margem saudável (%){" "}
                <InfoTip text="Acima desse percentual de lucro, a faixa aparece em VERDE na tabela — sinal de que a taxa cobrada está compensando bem o custo da entrega." />
              </Label>
              <Input
                className="h-8 w-24"
                type="number"
                value={okPct}
                onChange={(e) => setOkPct(Number(e.target.value))}
              />
            </div>
            <div>
              <Label className="text-[11px]">
                Margem baixa (%){" "}
                <InfoTip text="Abaixo desse percentual, a faixa aparece em VERMELHO — sinal de alerta de que você está ganhando pouco (ou até perdendo dinheiro) nessa faixa. Entre os dois limites, aparece em AMARELO." />
              </Label>
              <Input
                className="h-8 w-24"
                type="number"
                value={lowPct}
                onChange={(e) => setLowPct(Number(e.target.value))}
              />
            </div>
            <Button size="sm" variant="outline" onClick={addFaixa}>
              <Plus className="size-3.5" /> Faixa
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {faixas.map((f, idx) => {
            const midKm = (Number(f.km_from) + Number(f.km_to)) / 2;
            const cost = midKm * 2 * costPerKm; // ida e volta
            const margin = Number(f.fee) - cost;
            const pct = Number(f.fee) > 0 ? (margin / Number(f.fee)) * 100 : -100;
            return (
              <div
                key={f.id}
                className="grid items-center gap-2 rounded-lg border p-2 md:grid-cols-[1.4fr_.7fr_.7fr_.8fr_1.4fr_auto]"
              >
                <Input
                  value={f.nome}
                  placeholder="Nome da faixa"
                  onChange={(e) => setFaixas((p) => p.map((x, i) => (i === idx ? { ...x, nome: e.target.value } : x)))}
                />
                <Input
                  type="number"
                  step="0.1"
                  value={f.km_from}
                  placeholder="De (km)"
                  onChange={(e) =>
                    setFaixas((p) => p.map((x, i) => (i === idx ? { ...x, km_from: Number(e.target.value) } : x)))
                  }
                />
                <Input
                  type="number"
                  step="0.1"
                  value={f.km_to}
                  placeholder="Até (km)"
                  onChange={(e) =>
                    setFaixas((p) => p.map((x, i) => (i === idx ? { ...x, km_to: Number(e.target.value) } : x)))
                  }
                />
                <Input
                  type="number"
                  step="0.01"
                  value={f.fee}
                  placeholder="R$"
                  onChange={(e) =>
                    setFaixas((p) => p.map((x, i) => (i === idx ? { ...x, fee: Number(e.target.value) } : x)))
                  }
                />
                <div className="text-xs">
                  <span className="text-muted-foreground">
                    custo médio (ida e volta) {brl(cost)} ·{" "}
                    <Badge variant="secondary" className="ml-1">
                      {countsByFaixa[f.id] ?? 0} rua(s)
                    </Badge>
                  </span>
                  <p className={`font-bold ${marginTone(pct, okPct, lowPct)}`}>
                    margem {brl(margin)} ({pct.toFixed(0)}%){" "}
                    <InfoTip text="O que sobra de lucro por entrega nessa faixa: valor cobrado do cliente menos o custo médio de entregar (baseado na distância média da faixa). O % é essa mesma sobra, mas em proporção do que foi cobrado." />
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={f.ativo}
                    onCheckedChange={(v) => setFaixas((p) => p.map((x, i) => (i === idx ? { ...x, ativo: v } : x)))}
                  />
                  <Button size="icon" variant="ghost" onClick={() => saveFaixa(f)}>
                    <Save className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => removeFaixa(f.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
          {!faixas.length && !loading && <p className="text-sm text-muted-foreground">Nenhuma faixa cadastrada.</p>}
        </div>
      </Card>

      {/* -------- filtros -------- */}
      <Card className="grid gap-3 p-4 md:grid-cols-7">
        <Input placeholder="Buscar por rua..." value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={bairroFilter} onValueChange={setBairroFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Bairro" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os bairros</SelectItem>
            {bairrosDisponiveis.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kmFilter} onValueChange={setKmFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Até quantos km" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Qualquer distância</SelectItem>
            {KM_OPTIONS.map((km) => (
              <SelectItem key={km} value={String(km)}>
                Até {String(km).replace(".", ",")} km
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={faixaFilter} onValueChange={setFaixaFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Faixa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as faixas</SelectItem>
            {faixas.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="ativa">Só ativas</SelectItem>
            <SelectItem value="sem_entrega">Só sem entrega</SelectItem>
          </SelectContent>
        </Select>
        <Select value={variavelFilter} onValueChange={setVariavelFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Tipo de distância" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Fixa e variável</SelectItem>
            <SelectItem value="fixa">Só distância fixa</SelectItem>
            <SelectItem value="variavel">Só distância variável</SelectItem>
          </SelectContent>
        </Select>
        <Select value={suspeitaFilter} onValueChange={setSuspeitaFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Distância suspeita" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="suspeita">Só distância suspeita</SelectItem>
            <SelectItem value="normal">Só distância normal</SelectItem>
          </SelectContent>
        </Select>
        {(q ||
          bairroFilter !== "all" ||
          kmFilter !== "all" ||
          faixaFilter !== "all" ||
          statusFilter !== "all" ||
          variavelFilter !== "all" ||
          suspeitaFilter !== "all") && (
          <div className="md:col-span-7">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ("");
                setBairroFilter("all");
                setKmFilter("all");
                setFaixaFilter("all");
                setStatusFilter("all");
                setVariavelFilter("all");
                setSuspeitaFilter("all");
              }}
            >
              Limpar filtros
            </Button>
            <span className="ml-2 text-xs text-muted-foreground">
              {filtered.length} de {zonas.length} rua(s)
            </span>
          </div>
        )}
      </Card>

      {/* -------- lista de ruas -------- */}
      <Card className="overflow-x-auto p-0">
        {selected.size > 0 && (
          <div className="flex items-center justify-between border-b bg-destructive/5 px-4 py-2">
            <p className="text-sm font-medium">{selected.size} rua(s) selecionada(s)</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </Button>
              <Button size="sm" variant="destructive" onClick={removeSelected}>
                <Trash2 className="size-4" /> Excluir selecionadas
              </Button>
            </div>
          </div>
        )}
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 p-3">
                <Checkbox
                  checked={
                    filtered.length > 0 && filtered.every((z) => selected.has(z.id))
                      ? true
                      : filtered.some((z) => selected.has(z.id))
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={(v) => toggleSelectAllRows(v === true)}
                />
              </th>
              <th className="p-3">Rua</th>
              <th className="p-3">Bairro</th>
              <th className="p-3">
                Km{" "}
                <InfoTip text="Distância de carro só de IDA (loja até a rua). O triângulo amarelo ⚠ aparece quando essa distância ficou muito maior que a linha reta até lá — sinal de que a rota calculada pode estar errada (coordenada da loja imprecisa, ou mapa incompleto na região). Vale conferir manualmente no Google Maps quando aparecer." />
              </th>
              <th className="p-3">
                Faixa{" "}
                <InfoTip text="A faixa de km em que essa rua se encaixa (ex: 0-3 km, 3-6 km...). É a faixa que define quanto se cobra do cliente." />
              </th>
              <th className="p-3">
                Taxa{" "}
                <InfoTip text="Quanto o cliente paga pela entrega nessa rua. Vem direto do valor configurado na faixa correspondente." />
              </th>
              <th className="p-3">
                Custo{" "}
                <InfoTip text="Quanto você gasta pra fazer essa entrega, já contando IDA E VOLTA (a distância de km × 2 × custo por km configurado em Configurações → Entrega)." />
              </th>
              <th className="p-3">
                Margem{" "}
                <InfoTip text="O que sobra de lucro nessa entrega: Taxa cobrada do cliente menos o Custo (que já é ida e volta). Também mostra em % — por exemplo, R$3 de margem numa taxa de R$6 é 50%. Verde = lucro saudável, amarelo = lucro baixo, vermelho = prejuízo." />
              </th>
              <th className="p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={
                      filtered.length > 0 && filtered.every((z) => !z.entrega_disponivel)
                        ? true
                        : filtered.some((z) => !z.entrega_disponivel)
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(v) => toggleAllEntregaDisponivel(!(v === true))}
                  />
                  Status{" "}
                  <InfoTip text="Marque o quadradinho como uma anotação sua de que NÃO entregamos nessa rua (ex: acesso difícil, área de risco). Isso é só uma referência pra você — não afeta o que a IA calcula ou informa ao cliente, que é sempre recalculado na hora do pedido. O checkbox aqui em cima marca/desmarca todas as ruas que estão sendo exibidas com os filtros atuais de uma vez." />
                </div>
              </th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((z) => {
              const faixa = z.faixa_id ? faixaById[z.faixa_id] : null;
              const fee = faixa ? Number(faixa.fee) : 0;
              const cost = (z.distancia_km ?? 0) * 2 * costPerKm; // ida e volta
              const margin = fee - cost;
              const pct = fee > 0 ? (margin / fee) * 100 : -100;
              return (
                <tr key={z.id} className={`border-t ${selected.has(z.id) ? "bg-primary/5" : ""}`}>
                  <td className="p-3">
                    <Checkbox checked={selected.has(z.id)} onCheckedChange={(v) => toggleSelectRow(z.id, v === true)} />
                  </td>
                  <td className="p-3 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {!z.entrega_disponivel && (
                        <span title="Anotado como: não entregamos nessa rua (só referência sua)">
                          <Ban className="size-3.5 shrink-0 text-destructive" />
                        </span>
                      )}
                      {z.distancia_suspeita && (
                        <span title="Distância suspeita — rota muito maior que a linha reta, vale conferir">
                          <TriangleAlert className="size-3.5 shrink-0 text-amber-600" />
                        </span>
                      )}
                      {z.rua}
                    </span>
                    {z.distancia_suspeita && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Distância suspeita
                      </span>
                    )}
                    {z.distancia_variavel && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Distância variável
                      </span>
                    )}
                    {z.observacao && <span className="block text-xs text-muted-foreground">{z.observacao}</span>}
                    {z.distancia_variavel && (
                      <span className="block text-xs text-muted-foreground">
                        Rua comprida — o preço é sempre calculado pelo endereço completo (com número), não por um valor
                        fixo
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">{z.bairro ?? "—"}</td>
                  <td className="p-3">
                    {z.distancia_variavel ? (
                      <span className="text-xs text-muted-foreground">
                        {z.distancia_km_min != null && z.distancia_km_max != null
                          ? `${Number(z.distancia_km_min).toFixed(1)}–${Number(z.distancia_km_max).toFixed(1)} km`
                          : "varia por número"}
                      </span>
                    ) : z.distancia_km != null ? (
                      `${Number(z.distancia_km).toFixed(2)} km`
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3">{z.distancia_variavel ? "—" : (faixa?.nome ?? "—")}</td>
                  <td className="p-3 font-semibold">
                    {z.distancia_variavel ? "calculado no pedido" : faixa ? brl(fee) : "—"}
                  </td>
                  <td className="p-3 text-muted-foreground">{z.distancia_variavel ? "—" : brl(cost)}</td>
                  <td className={`p-3 font-bold ${marginTone(pct, okPct, lowPct)}`}>
                    {z.distancia_variavel ? (
                      <span className="text-xs font-normal text-muted-foreground">varia por número</span>
                    ) : (
                      <>
                        {brl(margin)} {faixa && fee > 0 ? `(${pct.toFixed(0)}%)` : ""}
                      </>
                    )}
                  </td>
                  <td className="p-3">
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={!z.entrega_disponivel}
                        onCheckedChange={(v) => toggleEntregaDisponivel(z.id, !v)}
                      />
                      {z.entrega_disponivel ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Ativa</Badge>
                      ) : (
                        <Badge variant="destructive">Sem entrega</Badge>
                      )}
                    </label>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(z)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => removeZona(z.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={10} className="p-6 text-center text-sm text-muted-foreground">
                  {loading ? "Carregando..." : "Nenhuma rua encontrada."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* -------- form -------- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar rua" : "Adicionar rua"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Rua</Label>
              <Input value={form.rua} onChange={(e) => setForm({ ...form, rua: e.target.value })} />
            </div>
            <div>
              <Label>Bairro</Label>
              <Input value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} />
            </div>
            <div>
              <Label>Distância (km de carro)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.distancia_km}
                onChange={(e) => setForm({ ...form, distancia_km: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Faixa</Label>
              <Select
                value={form.faixa_id || "none"}
                onValueChange={(v) => setForm({ ...form, faixa_id: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Definir pela distância</SelectItem>
                  {faixas.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome} — {brl(Number(f.fee))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Latitude (opcional)</Label>
              <Input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
            </div>
            <div>
              <Label>Longitude (opcional)</Label>
              <Input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label>Observação</Label>
              <Input
                value={form.observacao}
                onChange={(e) => setForm({ ...form, observacao: e.target.value })}
                placeholder="Ex: acesso difícil, área de risco"
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch
                checked={form.entrega_disponivel}
                onCheckedChange={(v) => setForm({ ...form, entrega_disponivel: v })}
              />
              <span className="text-sm">Entrega disponível nessa rua</span>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={saveZona}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
