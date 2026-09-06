import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { brasiliaDateDaysAgo, brasiliaDateISO, brasiliaDayRange, brasiliaMonthStart } from "@/lib/brasilia-date";
import { FinancialCashLedger } from "@/components/financial-cash-ledger";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableFooter } from "@/components/ui/table";
import { toast } from "sonner";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  Edit2,
  HelpCircle,
  DollarSign,
  PiggyBank,
  BarChart3,
  Calendar,
  RefreshCw,
  ArrowUpCircle,
  ArrowDownCircle,
  Info,
  Flame,
  ArrowDownUp,
  HandCoins,
  Search,
  RotateCcw,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/loja/financeiro")({
  component: FinanceiroPage,
});

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const CATEGORY_LABELS: Record<string, { label: string; emoji: string }> = {
  aluguel: { label: "Aluguel", emoji: "🏠" },
  energia: { label: "Energia elétrica", emoji: "⚡" },
  gas: { label: "Gás", emoji: "🔥" },
  agua: { label: "Água", emoji: "💧" },
  embalagens: { label: "Embalagens", emoji: "📦" },
  ingredientes: { label: "Ingredientes / Insumos", emoji: "🥩" },
  pessoal: { label: "Pessoal / Ajudantes", emoji: "👤" },
  impostos: { label: "Impostos / Taxas", emoji: "📋" },
  marketing: { label: "Divulgação / Marketing", emoji: "📣" },
  manutencao: { label: "Manutenção / Reparos", emoji: "🔧" },
  transporte: { label: "Transporte", emoji: "🚗" },
  outros: { label: "Outros", emoji: "📌" },
};

const COLORS = [
  "#f97316",
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#ec4899",
  "#eab308",
  "#14b8a6",
  "#ef4444",
  "#64748b",
  "#8b5cf6",
  "#f59e0b",
  "#06b6d4",
];

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  site: "Site próprio",
  ifood: "iFood",
  "99food": "99Food",
};

function Tooltip2({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="ml-1 align-middle text-muted-foreground hover:text-foreground"
      >
        <HelpCircle className="inline size-3.5" />
      </button>
      {open && (
        <span className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-lg">
          {text}
          <button type="button" className="ml-2 underline" onClick={() => setOpen(false)}>
            fechar
          </button>
        </span>
      )}
    </span>
  );
}

type Expense = {
  id: string;
  description: string;
  category: string;
  amount: number;
  due_date: string;
  competence_date?: string | null;
  paid_at: string | null;
  is_paid: boolean;
  recurrence: string;
  notes: string | null;
  created_at: string;
};

function todayISO() {
  return brasiliaDateISO();
}
function monthStart() {
  return brasiliaMonthStart();
}
function monthEnd() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

export default function FinanceiroPage() {
  const [tab, setTab] = useState<"dashboard" | "despesas" | "fluxo" | "relatorio" | "ranking" | "dizimo">(
    "dashboard",
  );
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [orderItems, setOrderItems] = useState<Record<string, any[]>>({});
  const [productCost, setProductCost] = useState<Record<string, number>>({});
  const [productCategory, setProductCategory] = useState<{
    byId: Record<string, string>;
    byName: Record<string, string>;
  }>({ byId: {}, byName: {} });
  const [receivablesPaid, setReceivablesPaid] = useState<
    Array<{ id: string; amount: number; paid_at: string; customer_name: string; description: string }>
  >([]);
  const [cashDaily, setCashDaily] = useState<Array<{ day: string; inflow: number; outflow: number }>>([]);
  const [feePct, setFeePct] = useState<Record<string, number>>({ whatsapp: 0, site: 0, ifood: 0, "99food": 0 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  // período do dashboard — padrão: mês atual
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());

  async function load() {
    setLoading(true);
    const { since, until } = brasiliaDayRange(from, to);
    const [{ data: exp }, { data: ord }, { data: prods }, { data: recv }, { data: feeCfg }] = await Promise.all([
      supabase
        .from("expenses" as any)
        .select("*")
        .order("due_date", { ascending: true }) as any,
      supabase
        .from("orders")
        .select("id, total, subtotal, delivery_fee, status, created_at, delivered_at, payment_method, payment_status, payment_confirmed_at, payment_timing, source, coupon_code, coupon_discount, deliverer_id")
        .eq("status", "delivered")
        .gte("delivered_at", since)
        .lte("delivered_at", until),
      supabase.from("products").select("id, name, category, cost_price"),
      supabase
        .from("receivables" as any)
        .select("id, amount, paid_at, customer_name, description")
        .eq("status", "paid")
        .gte("paid_at", since)
        .lte("paid_at", until) as any,
      supabase
        .from("store_config")
        .select("fee_pct_whatsapp, fee_pct_site, fee_pct_ifood, fee_pct_99food")
        .maybeSingle(),
    ]);
    const { data: cashRows } = await (supabase as any).rpc("financial_cash_daily", { p_from: from, p_to: to });
    setCashDaily(((cashRows as any[]) ?? []).map((r) => ({ day: r.day, inflow: Number(r.inflow || 0), outflow: Number(r.outflow || 0) })));

    setExpenses((exp as any) ?? []);
    setOrders(ord ?? []);
    setReceivablesPaid((recv as any) ?? []);
    setFeePct({
      whatsapp: Number(feeCfg?.fee_pct_whatsapp ?? 0),
      site: Number(feeCfg?.fee_pct_site ?? 0),
      ifood: Number(feeCfg?.fee_pct_ifood ?? 0),
      "99food": Number(feeCfg?.fee_pct_99food ?? 0),
    });

    const costMap: Record<string, number> = {};
    const catById: Record<string, string> = {};
    const catByName: Record<string, string> = {};
    for (const p of (prods as any[]) ?? []) {
      costMap[p.id] = Number(p.cost_price ?? 0);
      const cat = (p.category || "Sem categoria").trim();
      catById[p.id] = cat;
      catByName[String(p.name).toLowerCase().trim()] = cat;
    }
    setProductCost(costMap);
    setProductCategory({ byId: catById, byName: catByName });

    if (ord && ord.length) {
      const { data: items } = await supabase
        .from("order_items")
        .select("order_id, product_id, quantity, unit_price, product_name")
        .in(
          "order_id",
          ord.map((o: any) => o.id),
        );
      const grouped: Record<string, any[]> = {};
      for (const it of (items as any[]) ?? []) (grouped[it.order_id] ||= []).push(it);
      setOrderItems(grouped);
    } else {
      setOrderItems({});
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [from, to]);

  const expensesInPeriod = useMemo(
    () => expenses.filter((e) => (e.competence_date || e.due_date) >= from && (e.competence_date || e.due_date) <= to),
    [expenses, from, to],
  );

  const totalReceivablesPaid = useMemo(
    () => receivablesPaid.reduce((s, r) => s + Number(r.amount), 0),
    [receivablesPaid],
  );
  // Receita de vendas NÃO soma contas a receber pagas: quando a conta veio de um pedido,
  // somar novamente aqui duplicaria a mesma venda. Recebíveis entram apenas no fluxo de caixa.
  const totalRevenue = useMemo(() => orders.reduce((s, o) => s + Number(o.total || 0), 0), [orders]);
  const totalExpenses = useMemo(() => expensesInPeriod.reduce((s, e) => s + Number(e.amount), 0), [expensesInPeriod]);
  const totalCouponDiscount = useMemo(
    () => orders.reduce((s, o: any) => s + Number(o.coupon_discount || 0), 0),
    [orders],
  );
  const ordersWithCoupon = useMemo(() => orders.filter((o: any) => o.coupon_code).length, [orders]);
  const paidExpenses = useMemo(
    () => expensesInPeriod.filter((e) => e.is_paid).reduce((s, e) => s + Number(e.amount), 0),
    [expensesInPeriod],
  );
  const pendingExpenses = useMemo(
    () => expensesInPeriod.filter((e) => !e.is_paid).reduce((s, e) => s + Number(e.amount), 0),
    [expensesInPeriod],
  );

  // --- CUSTO DOS PRODUTOS (CMV) ---
  // O cálculo é por UNIDADE vendida, não por pedido. Itens sem custo não somem do relatório:
  // eles aparecem como cobertura incompleta, para o lucro nunca parecer "exato" quando faltam custos.
  const costed = useMemo(() => {
    let cogs = 0;
    let costedUnits = 0;
    let totalUnits = 0;
    const uncostedProducts = new Set<string>();
    const uncostedOrders = new Set<string>();
    for (const o of orders) {
      const items = orderItems[o.id] ?? [];
      for (const it of items) {
        const qty = Number(it.quantity || 0);
        totalUnits += qty;
        const c = it.product_id ? Number(productCost[it.product_id] ?? 0) : 0;
        if (c > 0) {
          cogs += c * qty;
          costedUnits += qty;
        } else {
          uncostedProducts.add(it.product_name);
          uncostedOrders.add(o.id);
        }
      }
    }
    return {
      cogs,
      totalUnits,
      costedUnits,
      missingCostUnits: Math.max(0, totalUnits - costedUnits),
      costCoveragePct: totalUnits > 0 ? (costedUnits / totalUnits) * 100 : 100,
      ordersCosted: orders.length - uncostedOrders.size,
      ordersUncosted: uncostedOrders.size,
      uncostedProducts: Array.from(uncostedProducts).slice(0, 20),
    };
  }, [orders, orderItems, productCost]);

  // --- TAXAS DAS PLATAFORMAS: quanto foi descontado de comissão/pagamento em cada pedido ---
  // Aplicado sobre o TOTAL do pedido (é assim que iFood/99Food calculam a
  // comissão deles — inclusive sobre a taxa de entrega, não só o subtotal),
  // usando o percentual configurado por origem em /loja/config. Pedidos de
  // origem sem percentual configurado (0%) simplesmente não têm desconto.
  const platformFees = useMemo(() => {
    const bySource: Record<string, { revenue: number; fee: number; orders: number }> = {};
    let totalFee = 0;
    for (const o of orders) {
      const src = o.source || "site";
      const pct = feePct[src] ?? 0;
      const fee = Number(o.total) * (pct / 100);
      totalFee += fee;
      if (!bySource[src]) bySource[src] = { revenue: 0, fee: 0, orders: 0 };
      bySource[src].revenue += Number(o.total);
      bySource[src].fee += fee;
      bySource[src].orders += 1;
    }
    return { bySource, totalFee };
  }, [orders, feePct]);

  // --- RANKING DE PRODUTOS MAIS VENDIDOS ---
  // Usa o mesmo período (from/to) já selecionado no topo da página. Agrupa
  // por nome de produto (mais confiável que product_id — pedidos vindos de
  // plataforma antes de mapear o cardápio, ou produtos já removidos, ainda
  // entram no ranking assim). Categoria vem do cadastro do produto
  // (/loja/produtos) — é o mesmo campo livre que você já usa pra separar
  // "Lanches", "Bebidas", "Sobremesas" etc, então o filtro de sabor/bebida
  // é só escolher a categoria certa aqui, sem precisar de nada hardcoded.
  const [rankingCategory, setRankingCategory] = useState("all");
  const [rankingSort, setRankingSort] = useState<"qty" | "revenue">("qty");
  const [rankingSearch, setRankingSearch] = useState("");
  const [rankingMinQty, setRankingMinQty] = useState("0");

  const rankingData = useMemo(() => {
    const grouped: Record<string, { name: string; category: string; qty: number; revenue: number; orderIds: Set<string> }> = {};
    for (const o of orders) {
      const items = orderItems[o.id] ?? [];
      for (const it of items) {
        const normalizedName = String(it.product_name || "").trim().toLowerCase().replace(/\s+/g, " ");
        const key = it.product_id ? `id:${it.product_id}` : `name:${normalizedName}`;
        const category =
          (it.product_id ? productCategory.byId[it.product_id] : undefined) ??
          productCategory.byName[normalizedName] ??
          "Sem categoria";
        const g = (grouped[key] ||= { name: it.product_name, category, qty: 0, revenue: 0, orderIds: new Set<string>() });
        g.qty += Number(it.quantity || 0);
        g.revenue += Number(it.quantity || 0) * Number(it.unit_price || 0);
        g.orderIds.add(o.id);
      }
    }
    const all = Object.values(grouped).map((p) => ({ ...p, orders: p.orderIds.size }));
    const categories = Array.from(new Set(all.map((p) => p.category))).sort((a, b) => a.localeCompare(b, "pt-BR"));
    const q = rankingSearch.trim().toLowerCase();
    const min = Number(rankingMinQty || 0);
    const filtered = all
      .filter((p) => rankingCategory === "all" || p.category === rankingCategory)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .filter((p) => p.qty >= min);
    filtered.sort((a, b) => (rankingSort === "qty" ? b.qty - a.qty : b.revenue - a.revenue));
    const maxQty = filtered.length ? Math.max(...filtered.map((p) => p.qty)) : 0;
    const maxRevenue = filtered.length ? Math.max(...filtered.map((p) => p.revenue)) : 0;
    const totalUnits = filtered.reduce((sum, p) => sum + p.qty, 0);
    return { list: filtered, categories, maxQty, maxRevenue, totalUnits };
  }, [orders, orderItems, productCategory, rankingCategory, rankingSort, rankingSearch, rankingMinQty]);

  // --- DÍZIMO / CONTRIBUIÇÃO POR PRODUTO ---
  // Receita por produto considera desconto de cupom proporcional e taxa da plataforma.
  // O valor abaixo é contribuição do produto antes das despesas fixas, não lucro líquido da empresa.
  const [dizimoSearch, setDizimoSearch] = useState("");
  const [dizimoSelected, setDizimoSelected] = useState<Set<string>>(new Set());
  const [dizimoHidden, setDizimoHidden] = useState<Set<string>>(new Set());
  const [dizimoOverrides, setDizimoOverrides] = useState<Record<string, number>>({});
  const [dizimoEditKey, setDizimoEditKey] = useState<string | null>(null);

  useEffect(() => {
    setDizimoSelected(new Set());
    setDizimoHidden(new Set());
  }, [from, to]);

  const dizimoAllRows = useMemo(() => {
    const grouped: Record<string, { key: string; productId: string | null; name: string; qty: number; revenue: number }> = {};
    for (const o of orders) {
      const items = orderItems[o.id] ?? [];
      const orderItemsGross = items.reduce((s: number, it: any) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0);
      const discountRate = orderItemsGross > 0 ? Math.min(1, Number(o.coupon_discount || 0) / orderItemsGross) : 0;
      const platformPct = Number(feePct[o.source || "site"] || 0) / 100;
      for (const it of items) {
        const normalizedName = String(it.product_name || "").trim().toLowerCase().replace(/\s+/g, " ");
        const key = it.product_id ? `id:${it.product_id}` : `nome:${normalizedName}`;
        const g = (grouped[key] ||= { key, productId: it.product_id ?? null, name: it.product_name, qty: 0, revenue: 0 });
        const qty = Number(it.quantity || 0);
        const gross = qty * Number(it.unit_price || 0);
        const afterCoupon = gross * (1 - discountRate);
        const afterPlatform = afterCoupon * (1 - platformPct);
        g.qty += qty;
        g.revenue += afterPlatform;
      }
    }
    return Object.values(grouped)
      .map((g) => {
        const registeredUnitCost = g.productId ? Number(productCost[g.productId] ?? 0) : 0;
        const unitCost = dizimoOverrides[g.key] ?? registeredUnitCost;
        const custo = unitCost * g.qty;
        const lucro = g.revenue - custo;
        const lucroPct = g.revenue > 0 ? (lucro / g.revenue) * 100 : 0;
        const dizimo = lucro > 0 ? lucro * 0.1 : 0;
        return { ...g, unitCost, custo, lucroPct, lucro, dizimo, hasOverride: dizimoOverrides[g.key] != null };
      })
      .sort((a, b) => b.lucro - a.lucro);
  }, [orders, orderItems, productCost, dizimoOverrides, feePct]);

  const dizimoVisibleRows = useMemo(
    () =>
      dizimoAllRows
        .filter((r) => !dizimoHidden.has(r.key))
        .filter((r) => r.name.toLowerCase().includes(dizimoSearch.trim().toLowerCase())),
    [dizimoAllRows, dizimoHidden, dizimoSearch],
  );

  // resumo do topo: soma de TODAS as vendas visíveis do período (não só as marcadas)
  const dizimoTotals = useMemo(() => {
    const lucro = dizimoVisibleRows.reduce((s, r) => s + r.lucro, 0);
    return { lucro, dizimo: lucro > 0 ? lucro * 0.1 : 0 };
  }, [dizimoVisibleRows]);

  // soma da linha de rodapé: só as linhas com checkbox marcado
  const dizimoSelectedTotals = useMemo(() => {
    const rows = dizimoVisibleRows.filter((r) => dizimoSelected.has(r.key));
    return {
      count: rows.length,
      custo: rows.reduce((s, r) => s + r.custo, 0),
      lucro: rows.reduce((s, r) => s + r.lucro, 0),
      dizimo: rows.reduce((s, r) => s + r.dizimo, 0),
    };
  }, [dizimoVisibleRows, dizimoSelected]);

  function toggleDizimoRow(key: string) {
    setDizimoSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleDizimoAll() {
    setDizimoSelected((prev) =>
      prev.size === dizimoVisibleRows.length ? new Set() : new Set(dizimoVisibleRows.map((r) => r.key)),
    );
  }
  function removeDizimoRow(key: string) {
    setDizimoHidden((prev) => new Set(prev).add(key));
    setDizimoSelected((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }
  function restoreDizimoRows() {
    setDizimoHidden(new Set());
  }

  // Ingredientes comprados são saída de CAIXA. Como o cost_price dos produtos já é formado pela ficha técnica,
  // subtrair a categoria "ingredientes" novamente do lucro operacional duplicaria o mesmo custo.
  const ingredientPurchases = useMemo(
    () => expensesInPeriod.filter((e) => e.category === "ingredientes").reduce((s, e) => s + Number(e.amount), 0),
    [expensesInPeriod],
  );
  const operatingExpenses = Math.max(0, totalExpenses - ingredientPurchases);
  // O app do entregador usa delivery_fee como valor devido ao entregador. Portanto, quando há entregador próprio vinculado,
  // esse valor precisa sair do lucro; caso contrário a taxa de entrega seria tratada como lucro da loja.
  const delivererPayout = useMemo(
    () => orders.filter((o: any) => !!o.deliverer_id).reduce((s, o: any) => s + Number(o.delivery_fee || 0), 0),
    [orders],
  );
  const realProfit = totalRevenue - costed.cogs - platformFees.totalFee - delivererPayout - operatingExpenses;
  const realMargin = totalRevenue > 0 ? (realProfit / totalRevenue) * 100 : 0;
  const profit = realProfit;
  const margin = realMargin;
  const totalCashIn = cashDaily.reduce((s, d) => s + Number(d.inflow || 0), 0);
  const totalCashOut = cashDaily.reduce((s, d) => s + Number(d.outflow || 0), 0);
  const workingCapital = totalCashIn - totalCashOut;

  const today = todayISO();
  const in7days = new Date();
  in7days.setDate(in7days.getDate() + 7);
  const alertExpenses = expenses.filter((e) => !e.is_paid && e.due_date <= in7days.toISOString().slice(0, 10));

  const expByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expensesInPeriod) {
      map[e.category] = (map[e.category] ?? 0) + Number(e.amount);
    }
    return Object.entries(map)
      .map(([cat, val]) => ({
        name: CATEGORY_LABELS[cat]?.label ?? cat,
        value: val,
      }))
      .sort((a, b) => b.value - a.value);
  }, [expensesInPeriod]);

  const operatingExpByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expensesInPeriod) {
      if (e.category === "ingredientes") continue;
      map[e.category] = (map[e.category] ?? 0) + Number(e.amount);
    }
    return Object.entries(map)
      .map(([cat, val]) => ({ name: CATEGORY_LABELS[cat]?.label ?? cat, value: val }))
      .sort((a, b) => b.value - a.value);
  }, [expensesInPeriod]);

  const cashflowData = useMemo(
    () => cashDaily.map((r) => ({
      dia: new Date(r.day + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      receita: Number(r.inflow || 0),
      despesa: Number(r.outflow || 0),
      saldo: Number(r.inflow || 0) - Number(r.outflow || 0),
    })),
    [cashDaily],
  );

  const avgTicket = orders.length > 0 ? totalRevenue / orders.length : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <BarChart3 className="size-6 text-primary" /> Central Financeira
        </h1>
        <p className="text-sm text-muted-foreground">
          Tudo o que você precisa saber sobre o dinheiro do seu negócio, em um só lugar.
        </p>
      </div>

      {alertExpenses.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          {alertExpenses.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-sm text-amber-900">
              <AlertTriangle className="size-4 shrink-0" />
              <span>
                {CATEGORY_LABELS[e.category]?.emoji} <b>{e.description}</b> — vence em{" "}
                {new Date(e.due_date + "T12:00:00").toLocaleDateString("pt-BR")} ({brl(e.amount)})
              </span>
            </div>
          ))}
        </div>
      )}

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div>
          <Label>De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button variant="outline" onClick={load}>
          <RefreshCw className="mr-1 size-4" /> Atualizar
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {[
            { label: "Hoje", f: todayISO(), t: todayISO() },
            { label: "7 dias", f: brasiliaDateDaysAgo(6), t: todayISO() },
            { label: "15 dias", f: brasiliaDateDaysAgo(14), t: todayISO() },
            { label: "30 dias", f: brasiliaDateDaysAgo(29), t: todayISO() },
            { label: "Este mês", f: monthStart(), t: todayISO() },
          ].map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant="ghost"
              onClick={() => {
                setFrom(p.f);
                setTo(p.t);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap gap-2 border-b">
        {(["dashboard", "despesas", "fluxo", "relatorio", "ranking", "dizimo"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-semibold ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
          >
            {
              {
                dashboard: "📊 Visão Geral",
                despesas: "💸 Despesas",
                fluxo: "💳 Caixa",
                relatorio: "🏆 Resultado",
                ranking: "🔥 Mais Vendidos",
                dizimo: "🙏 Dízimo",
              }[t]
            }
          </button>
        ))}
      </div>

      {tab === "dashboard" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              icon={<ArrowUpCircle className="size-5 text-emerald-600" />}
              label="Faturamento de vendas"
              value={brl(totalRevenue)}
              bg="bg-emerald-50"
              tooltip="Soma do total dos pedidos entregues no período, pela data real de entrega. Não inclui pedidos pendentes, cancelados ou falhos."
              sub={`${orders.length} pedido(s)`}
              positive
            />
            <SummaryCard
              icon={<ArrowDownCircle className="size-5 text-red-600" />}
              label="Despesas do período"
              value={brl(totalExpenses)}
              bg="bg-red-50"
              tooltip="Despesas com vencimento dentro do período. No fluxo de caixa entram somente as que foram efetivamente pagas, pela data do pagamento."
              sub={`${brl(pendingExpenses)} ainda a pagar`}
            />
            <SummaryCard
              icon={
                realProfit >= 0 ? (
                  <TrendingUp className="size-5 text-primary" />
                ) : (
                  <TrendingDown className="size-5 text-destructive" />
                )
              }
              label={costed.costCoveragePct >= 99.999 ? "Lucro operacional" : "Lucro estimado"}
              value={orders.length > 0 ? brl(realProfit) : "—"}
              bg={realProfit >= 0 ? "bg-primary/5" : "bg-destructive/5"}
              tooltip="Faturamento dos pedidos entregues − CMV conhecido − taxas das plataformas − repasses dos entregadores − despesas operacionais. Compras de ingredientes ficam no caixa e não são subtraídas novamente do lucro, pois já compõem o CMV."
              sub={
                orders.length > 0
                  ? `Margem: ${realMargin.toFixed(1)}% · CMV ${brl(costed.cogs)} · Entregadores ${brl(delivererPayout)}`
                  : "Sem vendas entregues"
              }
              positive={realProfit >= 0}
            />
            <SummaryCard
              icon={<Wallet className="size-5 text-violet-600" />}
              label="Movimento líquido de caixa"
              value={brl(workingCapital)}
              bg="bg-violet-50"
              tooltip="Entradas efetivamente registradas como pagas menos despesas efetivamente pagas no período. Não é o saldo bancário total da empresa."
              sub={`${brl(totalCashIn)} entrou · ${brl(totalCashOut)} saiu`}
              positive={workingCapital >= 0}
            />
          </div>

          {costed.ordersUncosted > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="size-4" /> Cobertura de custos: {costed.costCoveragePct.toFixed(1)}% das unidades
              </div>
              <p className="mt-1 text-xs">
                Existem unidades vendidas sem custo cadastrado. O lucro exibido é estimado e pode estar maior que o lucro real até completar os custos.
              </p>
              {costed.uncostedProducts.length > 0 && (
                <p className="mt-1 text-xs">
                  <b>Produtos sem custo:</b> {costed.uncostedProducts.join(", ")}
                </p>
              )}
            </div>
          )}

          {Object.keys(platformFees.bySource).length > 0 && (
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <BarChart3 className="size-4" /> Quanto cada plataforma fica com a taxa
                <Tooltip2 text="Por origem: quanto entrou, quanto foi descontado de comissão/taxa (percentual configurado em /loja/config → Taxas das plataformas) e quanto sobrou líquido." />
              </div>
              <div className="space-y-2">
                {Object.entries(platformFees.bySource).map(([src, raw]) => { const v = raw as { revenue: number; fee: number; orders: number }; return (
                  <div key={src} className="grid grid-cols-2 items-center gap-2 rounded-lg border p-2.5 sm:grid-cols-5">
                    <span className="font-semibold">{SOURCE_LABEL[src] ?? src}</span>
                    <span className="text-xs text-muted-foreground">{v.orders} pedido(s)</span>
                    <span className="text-sm">
                      Bruto: <b>{brl(v.revenue)}</b>
                    </span>
                    <span className="text-sm text-red-600">
                      Taxa: <b>- {brl(v.fee)}</b> ({feePct[src] ?? 0}%)
                    </span>
                    <span className="text-sm font-bold text-emerald-700">Líquido: {brl(v.revenue - v.fee)}</span>
                  </div>
                ); })}
              </div>
              {Object.values(feePct).every((p) => !p) && (
                <p className="mt-2 text-xs text-amber-700">
                  ⚠️ Nenhuma taxa configurada ainda — cadastre o percentual de cada plataforma em{" "}
                  <b>/loja/config → Taxas das plataformas</b> pra esse cálculo ficar correto.
                </p>
              )}
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <DollarSign className="size-4" /> Ticket médio por pedido
                <Tooltip2 text="Valor médio de cada pedido no período." />
              </div>
              <p className="text-3xl font-bold">{brl(avgTicket)}</p>
              <p className="text-xs text-muted-foreground">Em {orders.length} pedido(s) no período</p>
              {avgTicket < 25 && (
                <p className="mt-2 text-xs text-amber-700">💡 Ticket baixo — tente oferecer combos ou bebidas.</p>
              )}
            </Card>

            <Card className="p-4">
              <div className="mb-2 text-sm font-semibold">Receita × Despesas no período</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={[{ name: "Período", Receita: totalRevenue, Despesa: totalExpenses }]}>
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip formatter={(v) => brl(Number(v))} />
                  <Legend />
                  <Bar dataKey="Receita" fill="#22c55e" />
                  <Bar dataKey="Despesa" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {expByCategory.length > 0 && (
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                Para onde vai o dinheiro?
                <Tooltip2 text="Distribuição das suas despesas por categoria." />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={expByCategory} dataKey="value" nameKey="name" outerRadius={90} label>
                      {expByCategory.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => brl(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1">
                  {expByCategory.map((c, i) => (
                    <div key={c.name} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block size-3 rounded"
                          style={{ background: COLORS[i % COLORS.length] }}
                        />
                        {c.name}
                      </span>
                      <b>{brl(c.value)}</b>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <PiggyBank className="size-4" /> Como está a saúde do seu negócio?
            </div>
            <div className="space-y-2">
              <HealthItem
                ok={profit > 0}
                label="Lucro positivo"
                ok_text="Ótimo! Você está ganhando mais do que gasta."
                bad_text="Atenção: despesas maiores que a receita."
              />
              <HealthItem
                ok={margin >= 15}
                label={`Margem de lucro (${margin.toFixed(1)}%)`}
                ok_text="Margem saudável."
                bad_text="Margem baixa — reduza custos ou reajuste preços."
              />
              <HealthItem
                ok={workingCapital > 0}
                label="Movimento de caixa positivo"
                ok_text="As entradas pagas superaram as saídas pagas no período."
                bad_text="As saídas pagas superaram as entradas pagas no período."
              />
            </div>
          </Card>
        </div>
      )}

      {tab === "despesas" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Cadastre aqui tudo que você paga: aluguel, luz, gás, embalagens, etc.
            </p>
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              <Plus className="mr-1 size-4" /> Nova despesa
            </Button>
          </div>

          {expenses.length === 0 ? (
            <Card className="p-8 text-center">
              <Calendar className="mx-auto mb-2 size-8 text-muted-foreground" />
              <p className="font-semibold">Nenhuma despesa cadastrada ainda</p>
              <p className="mb-4 text-sm text-muted-foreground">Comece cadastrando suas despesas fixas.</p>
              <Button
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
              >
                <Plus className="mr-1 size-4" /> Cadastrar primeira despesa
              </Button>
            </Card>
          ) : (
            <div className="space-y-2">
              {expenses.map((e) => {
                const cat = CATEGORY_LABELS[e.category] ?? { label: e.category, emoji: "📌" };
                const overdue = !e.is_paid && e.due_date < today;
                return (
                  <Card key={e.id} className="flex items-center gap-3 p-3">
                    <div className="text-2xl">{cat.emoji}</div>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <b>{e.description}</b>
                        <span className="text-xs text-muted-foreground">{cat.label}</span>
                        {e.recurrence !== "once" && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                            {e.recurrence === "monthly" ? "Todo mês" : "Toda semana"}
                          </span>
                        )}
                        {overdue && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                            ⚠️ Vencida
                          </span>
                        )}
                        {e.is_paid && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            ✅ Pago
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Vence em {new Date(e.due_date + "T12:00:00").toLocaleDateString("pt-BR")}
                        {e.notes ? ` · ${e.notes}` : ""}
                      </div>
                    </div>
                    <div className="text-lg font-bold">{brl(e.amount)}</div>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={e.is_paid}
                        onCheckedChange={async (v) => {
                          await (supabase.from("expenses" as any) as any)
                            .update({ is_paid: v, paid_at: v ? new Date().toISOString() : null })
                            .eq("id", e.id);
                          load();
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditing(e);
                          setShowForm(true);
                        }}
                      >
                        <Edit2 className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={async () => {
                          if (!window.confirm("Remover essa despesa?")) return;
                          await (supabase.from("expenses" as any) as any).delete().eq("id", e.id);
                          load();
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "fluxo" && (
        <div className="space-y-4">
          <FinancialCashLedger from={from} to={to} />
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              Fluxo de caixa realizado
              <Tooltip2 text="Entrada e saída de dinheiro em cada dia do período." />
            </div>
            {cashflowData.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dado no período selecionado.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={cashflowData}>
                  <XAxis dataKey="dia" />
                  <YAxis tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v, n) => [
                      brl(Number(v)),
                      n === "receita" ? "Entrou" : n === "despesa" ? "Saiu" : "Saldo",
                    ]}
                  />
                  <Legend
                    formatter={(v) => (({ receita: "Entrou", despesa: "Saiu", saldo: "Saldo do dia" }) as any)[v] ?? v}
                  />
                  <Bar dataKey="receita" fill="#22c55e" />
                  <Bar dataKey="despesa" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              Acumulado do período
              <Tooltip2 text="Evolução do movimento líquido dentro do período selecionado, começando em zero. Não representa sozinho o saldo bancário da empresa." />
            </div>
            {cashflowData.length > 0 &&
              (() => {
                let acc = 0;
                const accumulated = cashflowData.map((d) => {
                  acc += d.receita - d.despesa;
                  return { dia: d.dia, saldo: acc };
                });
                return (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={accumulated}>
                      <XAxis dataKey="dia" />
                      <YAxis tickFormatter={(v) => `R$${(v / 1000).toFixed(1)}k`} />
                      <Tooltip formatter={(v) => [brl(Number(v)), "Acumulado do período"]} />
                      <Area type="monotone" dataKey="saldo" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                );
              })()}
          </Card>
        </div>
      )}

      {tab === "relatorio" && (
        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
              🏆 Demonstrativo de Resultado
              <Tooltip2 text="Resumo de tudo — receita, despesas por categoria e lucro final." />
            </h2>

            <div className="space-y-1 divide-y">
              <ReportRow
                label="Faturamento líquido dos pedidos"
                value={brl(totalRevenue)}
                positive
                bold
                tooltip="Soma dos pedidos entregues já considerando descontos e taxa de entrega. Contas a receber pagas não são somadas de novo aqui."
              />
              <ReportRow
                label="Cobertura de custo das unidades vendidas"
                value={`${costed.costCoveragePct.toFixed(1)}%`}
                tooltip={`${costed.costedUnits} de ${costed.totalUnits} unidade(s) vendida(s) têm custo cadastrado.`}
              />
              <ReportRow
                label="CMV — custo dos produtos vendidos"
                value={`- ${brl(costed.cogs)}`}
                tooltip="Soma do custo dos ingredientes/produtos vendidos."
              />
              <ReportRow
                label="Taxas das plataformas (iFood/99Food/etc)"
                value={`- ${brl(platformFees.totalFee)}`}
                tooltip="Comissão + taxa de pagamento de cada plataforma, pelo percentual configurado em /loja/config."
              />
              <ReportRow
                label="Repasses dos entregadores"
                value={`- ${brl(delivererPayout)}`}
                tooltip="Taxas de entrega dos pedidos vinculados a entregador próprio, pois esse é o valor que o app contabiliza como ganho do entregador."
              />
              {ingredientPurchases > 0 && (
                <ReportRow
                  label="Compras de ingredientes (somente caixa)"
                  value={brl(ingredientPurchases)}
                  tooltip="Não é subtraído novamente do lucro operacional porque o custo consumido dos ingredientes já está dentro do CMV dos produtos vendidos."
                />
              )}
              {totalCouponDiscount > 0 && (
                <ReportRow
                  label={`Descontos concedidos em cupons (${ordersWithCoupon} pedido(s))`}
                  value={`- ${brl(totalCouponDiscount)}`}
                  tooltip="Soma dos descontos de cupons aplicados nos pedidos do período. Já está descontada do total de cada pedido, então não é subtraída de novo do lucro — é só informativo."
                />
              )}
              <div className="pt-2 text-xs font-semibold uppercase text-muted-foreground">Despesas operacionais (sem compras de ingredientes)</div>
              {operatingExpByCategory.map((c) => (
                <ReportRow key={c.name} label={c.name} value={`- ${brl(c.value)}`} />
              ))}
              <ReportRow label="Total de despesas operacionais" value={`- ${brl(operatingExpenses)}`} bold />
              <ReportRow
                label={costed.costCoveragePct >= 99.999 ? "LUCRO OPERACIONAL" : "LUCRO ESTIMADO"}
                value={orders.length > 0 ? brl(realProfit) : "—"}
                positive={realProfit >= 0}
                bold
                tooltip="Faturamento − CMV conhecido − taxas de plataforma − repasses de entregadores − despesas operacionais."
              />
              {costed.ordersUncosted > 0 && (
                <p className="pt-2 text-xs text-amber-700">
                  ⚠️ {costed.missingCostUnits} unidade(s) vendida(s) ainda estão sem custo cadastrado; o lucro é estimado.
                </p>
              )}
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <MetricCard
                label="Margem de lucro real"
                value={orders.length > 0 ? `${realMargin.toFixed(1)}%` : "—"}
                tooltip="Lucro real sobre a receita com custo cadastrado."
                ok={realMargin >= 15}
              />
              <MetricCard
                label="% de despesas"
                value={totalRevenue > 0 ? `${((operatingExpenses / totalRevenue) * 100).toFixed(1)}%` : "—"}
                tooltip="Quanto das entradas foi para despesas fixas."
                ok={totalRevenue > 0 && operatingExpenses / totalRevenue < 0.85}
              />
              <MetricCard
                label="Ticket médio"
                value={brl(avgTicket)}
                tooltip="Valor médio por pedido."
                ok={avgTicket >= 25}
              />
              {totalCouponDiscount > 0 && (
                <MetricCard
                  label="Descontos em cupons"
                  value={brl(totalCouponDiscount)}
                  tooltip={`${ordersWithCoupon} pedido(s) usaram cupom de desconto neste período.`}
                  ok
                />
              )}
            </div>

            <div className="mt-6 rounded-lg border bg-muted/40 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-bold">
                <Info className="size-4" /> 💡 O que fazer com esse resultado?
              </p>
              {profit < 0 && (
                <p className="text-sm">Seu negócio está no prejuízo neste período. Revise as despesas maiores.</p>
              )}
              {profit >= 0 && margin < 15 && <p className="text-sm">Você tem lucro, mas a margem está baixa.</p>}
              {profit >= 0 && margin >= 15 && margin < 30 && (
                <p className="text-sm">Bom resultado! Foque em aumentar pedidos ou ticket médio.</p>
              )}
              {profit >= 0 && margin >= 30 && <p className="text-sm">Excelente! Margem acima de 30% é muito boa.</p>}
              <p className="mt-2 text-xs text-muted-foreground">Dica: guarde pelo menos 20% do lucro como reserva.</p>
            </div>
          </Card>
        </div>
      )}

      {tab === "ranking" && (
        <div className="space-y-4">
          <Card className="p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Flame className="size-5 text-primary" /> Produtos mais vendidos
                <Tooltip2 text="Ranking de vendas no período selecionado no topo da página. Filtre por categoria (ex: Bebidas) pra ver só os sabores ou só as bebidas mais pedidas." />
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={rankingSearch}
                  onChange={(e) => setRankingSearch(e.target.value)}
                  placeholder="Buscar produto"
                  className="h-9 w-44"
                />
                <Select value={rankingCategory} onValueChange={setRankingCategory}>
                  <SelectTrigger className="h-9 w-48 text-sm">
                    <SelectValue placeholder="Categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as categorias</SelectItem>
                    {rankingData.categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={rankingMinQty} onValueChange={setRankingMinQty}>
                  <SelectTrigger className="h-9 w-40 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Qualquer quantidade</SelectItem>
                    <SelectItem value="2">2+ unidades</SelectItem>
                    <SelectItem value="5">5+ unidades</SelectItem>
                    <SelectItem value="10">10+ unidades</SelectItem>
                    <SelectItem value="20">20+ unidades</SelectItem>
                    <SelectItem value="50">50+ unidades</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRankingSort(rankingSort === "qty" ? "revenue" : "qty")}
                >
                  <ArrowDownUp className="size-3.5" />
                  Ordenar por {rankingSort === "qty" ? "quantidade" : "faturamento"}
                </Button>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard label="Unidades nos filtros" value={String(rankingData.totalUnits)} tooltip="Soma das quantidades vendidas. Se um cliente comprou 5 unidades, são contabilizadas 5." ok />
              <MetricCard label="Produtos diferentes" value={String(rankingData.list.length)} tooltip="Quantidade de produtos distintos que passaram pelos filtros." ok />
              <MetricCard label="Pedidos entregues" value={String(orders.length)} tooltip="Pedidos entregues no período selecionado." ok />
              <MetricCard label="Itens por pedido" value={orders.length ? (costed.totalUnits / orders.length).toFixed(1) : "0"} tooltip="Quantidade média de unidades vendidas por pedido entregue." ok />
            </div>

            {!rankingData.list.length ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma venda encontrada nesse período
                {rankingCategory !== "all" ? ` para a categoria "${rankingCategory}"` : ""}.
              </p>
            ) : (
              <>
                <div className="mb-6 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rankingData.list.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 24 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} interval={0} />
                      <Tooltip
                        formatter={(value: number, key: string) =>
                          key === "qty" ? [`${value}x`, "Quantidade"] : [brl(value), "Faturamento"]
                        }
                      />
                      <Bar dataKey={rankingSort === "qty" ? "qty" : "revenue"} fill="#f97316" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-1.5">
                  {rankingData.list.map((p, idx) => {
                    const pct =
                      (rankingSort === "qty" ? rankingData.maxQty : rankingData.maxRevenue) > 0
                        ? ((rankingSort === "qty" ? p.qty : p.revenue) /
                            (rankingSort === "qty" ? rankingData.maxQty : rankingData.maxRevenue)) *
                          100
                        : 0;
                    return (
                      <div key={p.name} className="rounded-xl border bg-muted/10 px-4 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-black ${idx < 3 ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}
                            >
                              {idx + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold">{p.name}</p>
                              <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                                {p.category}
                              </span>
                            </div>
                          </div>
                          <div className="shrink-0 text-right text-sm">
                            <p className="font-bold">{p.qty}x</p>
                            <p className="text-xs text-muted-foreground">{p.orders} pedido(s) · {brl(p.revenue)}</p>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, pct)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {tab === "dizimo" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="border-0 bg-gradient-to-br from-foreground to-foreground/90 p-5 text-background">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-background/60">
                <TrendingUp className="size-3.5" /> Contribuição dos produtos
              </p>
              <p className="mt-1 text-3xl font-black">{brl(dizimoTotals.lucro)}</p>
              <p className="mt-1 text-[11px] text-background/60">
                Soma da receita dos produtos após cupom e taxa de plataforma, menos CMV, no período de {new Date(from + "T12:00:00").toLocaleDateString("pt-BR")} até{" "}
                {new Date(to + "T12:00:00").toLocaleDateString("pt-BR")}.
              </p>
            </Card>
            <Card className="border-0 bg-gradient-to-br from-primary to-accent p-5 text-primary-foreground">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-primary-foreground/80">
                <HandCoins className="size-3.5" /> Dízimo sobre o lucro (10%)
              </p>
              <p className="mt-1 text-3xl font-black">{brl(dizimoTotals.dizimo)}</p>
              <p className="mt-1 text-[11px] text-primary-foreground/80">
                10% calculado sobre a contribuição positiva dos produtos (após cupom, taxa de plataforma e CMV), antes das despesas fixas.
              </p>
            </Card>
          </div>

          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={dizimoSearch}
                  onChange={(e) => setDizimoSearch(e.target.value)}
                  placeholder="Filtrar por nome do produto..."
                  className="pl-8"
                />
              </div>
              {dizimoHidden.size > 0 && (
                <Button size="sm" variant="outline" onClick={restoreDizimoRows}>
                  <RotateCcw className="mr-1 size-3.5" /> Restaurar {dizimoHidden.size} removido(s)
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                Período usado: filtros "De" / "Até" no topo da página.
              </span>
            </div>

            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
            ) : dizimoVisibleRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma venda encontrada nesse período (ou filtro).
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={dizimoSelected.size > 0 && dizimoSelected.size === dizimoVisibleRows.length}
                        onCheckedChange={toggleDizimoAll}
                      />
                    </TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Margem</TableHead>
                    <TableHead className="text-right">Lucro</TableHead>
                    <TableHead className="text-right">Dízimo (10%)</TableHead>
                    <TableHead className="w-20 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dizimoVisibleRows.map((r) => (
                    <TableRow key={r.key} data-state={dizimoSelected.has(r.key) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox checked={dizimoSelected.has(r.key)} onCheckedChange={() => toggleDizimoRow(r.key)} />
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{r.name}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">({r.qty}x)</span>
                        {r.hasOverride && (
                          <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">
                            custo ajustado
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{brl(r.custo)}</TableCell>
                      <TableCell
                        className={`text-right ${r.lucroPct >= 0 ? "text-emerald-600" : "text-destructive"}`}
                      >
                        {r.lucroPct.toFixed(1)}%
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${r.lucro >= 0 ? "" : "text-destructive"}`}>
                        {brl(r.lucro)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-primary">{brl(r.dizimo)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => setDizimoEditKey(r.key)}>
                            <Edit2 className="size-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => removeDizimoRow(r.key)}>
                            <Trash2 className="size-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2} className="font-semibold">
                      {dizimoSelectedTotals.count > 0
                        ? `Soma das ${dizimoSelectedTotals.count} linha(s) marcada(s)`
                        : "Marque as linhas pra somar aqui"}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{brl(dizimoSelectedTotals.custo)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-semibold">{brl(dizimoSelectedTotals.lucro)}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {brl(dizimoSelectedTotals.dizimo)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </Card>
        </div>
      )}

      {dizimoEditKey && (
        <DizimoEditDialog
          row={dizimoAllRows.find((r) => r.key === dizimoEditKey)!}
          onClose={() => setDizimoEditKey(null)}
          onSave={(unitCost) => {
            setDizimoOverrides((prev) => ({ ...prev, [dizimoEditKey]: unitCost }));
            setDizimoEditKey(null);
          }}
          onClearOverride={() => {
            setDizimoOverrides((prev) => {
              const next = { ...prev };
              delete next[dizimoEditKey];
              return next;
            });
            setDizimoEditKey(null);
          }}
        />
      )}

      {showForm && (
        <ExpenseForm
          initial={editing}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={load}
        />
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, bg, tooltip, sub, positive }: any) {
  return (
    <Card className={`p-4 ${bg}`}>
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        {icon} {label}
        <Tooltip2 text={tooltip} />
      </div>
      <div className={`mt-1 text-2xl font-bold ${positive === false ? "text-destructive" : ""}`}>{value}</div>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function HealthItem({ ok, label, ok_text, bad_text }: any) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      ) : (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
      )}
      <div>
        <b>{label}:</b> <span className="text-muted-foreground">{ok ? ok_text : bad_text}</span>
      </div>
    </div>
  );
}

function ReportRow({ label, value, positive, bold, tooltip }: any) {
  return (
    <div className={`flex items-center justify-between py-1.5 ${bold ? "text-base font-bold" : "text-sm"}`}>
      <span className="flex items-center">
        {label}
        {tooltip && <Tooltip2 text={tooltip} />}
      </span>
      <span className={positive === true ? "text-emerald-600" : positive === false ? "text-destructive" : ""}>
        {value}
      </span>
    </div>
  );
}

function MetricCard({ label, value, tooltip, ok }: any) {
  return (
    <Card className={`p-3 ${ok ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
      <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        {label}
        <Tooltip2 text={tooltip} />
      </p>
      <p className="text-xl font-bold">{value}</p>
    </Card>
  );
}

function DizimoEditDialog({
  row,
  onClose,
  onSave,
  onClearOverride,
}: {
  row: { key: string; name: string; unitCost: number; qty: number; hasOverride: boolean };
  onClose: () => void;
  onSave: (unitCost: number) => void;
  onClearOverride: () => void;
}) {
  const [value, setValue] = useState(String(row.unitCost));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar custo — {row.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Esse valor é o custo por unidade usado só pra esse cálculo de dízimo (não muda a ficha técnica nem o
            cadastro do produto). Use isso se esse produto não tem ficha técnica cadastrada ainda.
          </p>
          <div>
            <Label>Custo por unidade (R$)</Label>
            <Input type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Vendidas {row.qty}x no período → custo total: {brl((Number(value) || 0) * row.qty)}
          </p>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          {row.hasOverride && (
            <Button variant="ghost" onClick={onClearOverride}>
              Remover ajuste
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(Number(value) || 0)}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: Expense | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    description: initial?.description ?? "",
    category: initial?.category ?? "outros",
    amount: initial?.amount ? String(initial.amount) : "",
    competence_date: initial?.competence_date ?? initial?.due_date ?? todayISO(),
    due_date: initial?.due_date ?? todayISO(),
    is_paid: initial?.is_paid ?? false,
    recurrence: initial?.recurrence ?? "once",
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!f.description || !f.amount || !f.due_date) return toast.error("Preencha os campos obrigatórios");
    setSaving(true);
    const payload = { ...f, amount: Number(f.amount), paid_at: f.is_paid ? (initial?.paid_at || new Date().toISOString()) : null };
    const { error } = initial?.id
      ? await (supabase.from("expenses" as any) as any).update(payload).eq("id", initial.id)
      : await (supabase.from("expenses" as any) as any).insert(payload);
    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }
    toast.success(initial?.id ? "Despesa atualizada!" : "Despesa cadastrada!");
    onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Editar despesa" : "Nova despesa"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome da despesa *</Label>
            <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoria</Label>
              <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.emoji} {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor (R$) *</Label>
              <Input
                type="number"
                step="0.01"
                value={f.amount}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Competência *</Label>
              <Input type="date" value={f.competence_date} onChange={(e) => setF({ ...f, competence_date: e.target.value })} />
              <p className="mt-1 text-[11px] text-muted-foreground">Data em que a despesa pertence ao resultado.</p>
            </div>
            <div>
              <Label>Data de vencimento *</Label>
              <Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
            </div>
          </div>
          <div>
              <Label>Repetição</Label>
              <Select value={f.recurrence} onValueChange={(v) => setF({ ...f, recurrence: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Só uma vez</SelectItem>
                  <SelectItem value="monthly">Todo mês</SelectItem>
                  <SelectItem value="weekly">Toda semana</SelectItem>
                </SelectContent>
              </Select>
          </div>
          <div>
            <Label>Observação (opcional)</Label>
            <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={f.is_paid} onCheckedChange={(v) => setF({ ...f, is_paid: v })} />
            <Label>Já foi pago</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
