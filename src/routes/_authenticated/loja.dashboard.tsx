import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { brasiliaDateDaysAgo, brasiliaDayRange, brasiliaMonthStart } from "@/lib/brasilia-date";
import { brl, ORDER_STATUS_LABEL, orderDisplayRef } from "@/lib/formatters";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ClipboardList,
  DollarSign,
  ChefHat,
  CheckCircle2,
  XCircle,
  Flame,
  Users,
  AlertTriangle,
  Timer,
  Receipt,
  PackageCheck,
  Boxes,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/loja/dashboard")({ component: DashboardPage });

function localISO(offsetDays = 0) { return brasiliaDateDaysAgo(offsetDays); }
function monthStart() { return brasiliaMonthStart(); }
function minutesSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}
function normalizeProductName(v: string) {
  return String(v || "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}

type ProductSale = { name: string; category: string; qty: number; revenue: number; orderIds: Set<string> };

function DashboardPage() {
  const [periodOrders, setPeriodOrders] = useState<any[]>([]);
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [salesItems, setSalesItems] = useState<any[]>([]);
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [deliverers, setDeliverers] = useState<any[]>([]);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [productCategories, setProductCategories] = useState<Record<string, string>>({});
  const [from, setFrom] = useState(localISO(0));
  const [to, setTo] = useState(localISO(0));
  const [productSearch, setProductSearch] = useState("");
  const [productCategory, setProductCategory] = useState("all");
  const [minQty, setMinQty] = useState("0");

  async function load() {
    const { since, until } = brasiliaDayRange(from, to);
    const [opsRes, salesRes, activeRes, delsRes, ingRes, productsRes] = await Promise.all([
      supabase.from("orders").select("id,status,total").gte("created_at", since).lte("created_at", until),
      supabase
        .from("orders")
        .select("id,status,total,subtotal,delivery_fee,coupon_discount,delivered_at")
        .eq("status", "delivered")
        .gte("delivered_at", since)
        .lte("delivered_at", until),
      supabase
        .from("orders")
        .select("id,order_number,status,customer_name,created_at,deliverer_name,source,external_display_id")
        .in("status", ["pending", "pending_review", "preparing", "ready_pickup", "out_for_delivery"])
        .order("created_at", { ascending: true }),
      supabase.from("deliverers").select("id,full_name").eq("active", true),
      supabase.from("ingredients").select("id,name,unit,stock_quantity,low_stock_threshold").eq("track_stock", true),
      supabase.from("products").select("id,name,category"),
    ]);

    setPeriodOrders(opsRes.data ?? []);
    setSalesOrders(salesRes.data ?? []);
    setActiveOrders(activeRes.data ?? []);
    setDeliverers(delsRes.data ?? []);
    setLowStock(
      (ingRes.data ?? []).filter(
        (i: any) => Number(i.low_stock_threshold) > 0 && Number(i.stock_quantity) <= Number(i.low_stock_threshold),
      ),
    );

    const catMap: Record<string, string> = {};
    for (const p of productsRes.data ?? []) {
      catMap[p.id] = (p.category || "Sem categoria").trim();
      catMap[`name:${normalizeProductName(p.name)}`] = (p.category || "Sem categoria").trim();
    }
    setProductCategories(catMap);

    const ids = (salesRes.data ?? []).map((o: any) => o.id);
    if (!ids.length) return setSalesItems([]);
    const { data: items } = await supabase
      .from("order_items")
      .select("order_id,product_id,product_name,quantity,unit_price")
      .in("order_id", ids);
    setSalesItems(items ?? []);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("dashboard-financial-v2")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "deliverers" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "ingredients" }, load)
      .subscribe();
    const poll = setInterval(load, 60_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
    };
  }, [from, to]);

  const sales = useMemo(() => {
    const revenue = salesOrders.reduce((s, o) => s + Number(o.total || 0), 0);
    const units = salesItems.reduce((s, i) => s + Number(i.quantity || 0), 0);
    const distinct = new Set(salesItems.map((i) => i.product_id || normalizeProductName(i.product_name))).size;
    return {
      revenue,
      orders: salesOrders.length,
      units,
      distinct,
      avgTicket: salesOrders.length ? revenue / salesOrders.length : 0,
      unitsPerOrder: salesOrders.length ? units / salesOrders.length : 0,
    };
  }, [salesOrders, salesItems]);

  const productSales = useMemo(() => {
    const grouped: Record<string, ProductSale> = {};
    for (const it of salesItems) {
      const key = it.product_id || `name:${normalizeProductName(it.product_name)}`;
      const category = productCategories[it.product_id] ?? productCategories[`name:${normalizeProductName(it.product_name)}`] ?? "Sem categoria";
      const g = (grouped[key] ||= { name: it.product_name, category, qty: 0, revenue: 0, orderIds: new Set<string>() });
      g.qty += Number(it.quantity || 0);
      g.revenue += Number(it.quantity || 0) * Number(it.unit_price || 0);
      g.orderIds.add(it.order_id);
    }
    const categories = Array.from(new Set(Object.values(grouped).map((p) => p.category))).sort((a, b) => a.localeCompare(b, "pt-BR"));
    const min = Number(minQty || 0);
    const q = productSearch.trim().toLocaleLowerCase("pt-BR");
    const list = Object.values(grouped)
      .filter((p) => productCategory === "all" || p.category === productCategory)
      .filter((p) => !q || p.name.toLocaleLowerCase("pt-BR").includes(q))
      .filter((p) => p.qty >= min)
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
    return { list, categories };
  }, [salesItems, productCategories, productCategory, productSearch, minQty]);

  const operational = {
    created: periodOrders.length,
    pending: periodOrders.filter((o) => ["pending", "pending_review"].includes(o.status)).length,
    production: periodOrders.filter((o) => ["preparing", "ready_pickup", "out_for_delivery"].includes(o.status)).length,
    cancelled: periodOrders.filter((o) => ["cancelled", "failed"].includes(o.status)).length,
  };
  const busyDeliverers = new Set(activeOrders.filter((o) => o.deliverer_name).map((o) => o.deliverer_name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-black uppercase tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Vendas concluídas separadas da operação em andamento.</p>
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div><label className="text-xs font-semibold text-muted-foreground">De</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block rounded-md border bg-background px-2 py-1.5 text-sm" /></div>
        <div><label className="text-xs font-semibold text-muted-foreground">Até</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block rounded-md border bg-background px-2 py-1.5 text-sm" /></div>
        <div className="ml-auto flex flex-wrap gap-2">
          {[
            { label: "Hoje", f: localISO(0), t: localISO(0) },
            { label: "7 dias", f: localISO(6), t: localISO(0) },
            { label: "15 dias", f: localISO(14), t: localISO(0) },
            { label: "30 dias", f: localISO(29), t: localISO(0) },
            { label: "Este mês", f: monthStart(), t: localISO(0) },
          ].map((p) => <button key={p.label} onClick={() => { setFrom(p.f); setTo(p.t); }} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${from === p.f && to === p.t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{p.label}</button>)}
        </div>
      </Card>

      <section className="space-y-3">
        <div><h2 className="font-display text-lg font-black uppercase">Vendas concluídas</h2><p className="text-xs text-muted-foreground">Somente pedidos entregues, pela data de entrega.</p></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="Faturamento" value={brl(sales.revenue)} icon={DollarSign} hero />
          <Metric label="Pedidos entregues" value={sales.orders} icon={CheckCircle2} />
          <Metric label="Unidades vendidas" value={sales.units} icon={Boxes} />
          <Metric label="Produtos diferentes" value={sales.distinct} icon={PackageCheck} />
          <Metric label="Ticket médio" value={brl(sales.avgTicket)} icon={Receipt} />
          <Metric label="Itens por pedido" value={sales.unitsPerOrder.toFixed(1)} icon={ClipboardList} />
        </div>
      </section>

      <section className="space-y-3">
        <div><h2 className="font-display text-lg font-black uppercase">Operação no período</h2><p className="text-xs text-muted-foreground">Esses números não entram no faturamento até o pedido ser entregue.</p></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Pedidos criados" value={operational.created} icon={ClipboardList} />
          <Metric label="Pendentes" value={operational.pending} icon={ChefHat} />
          <Metric label="Em andamento" value={operational.production} icon={Timer} />
          <Metric label="Cancelados / falhos" value={operational.cancelled} icon={XCircle} />
        </div>
      </section>

      {lowStock.length > 0 && <Card className="border-2 border-destructive bg-destructive/5 p-4"><p className="flex items-center gap-2 text-sm font-bold text-destructive"><AlertTriangle className="size-4" /> Estoque baixo: {lowStock.map((i: any) => i.name).join(", ")}</p></Card>}

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="flex items-center gap-2 font-display text-lg font-black uppercase"><Flame className="size-5 text-primary" /> Quantidade de produtos vendidos</h2><p className="text-xs text-muted-foreground">Conta unidades reais. Se um cliente comprar 5 unidades, entram 5 — não 1.</p></div>
          <div className="flex flex-wrap gap-2">
            <Input className="h-9 w-48" placeholder="Buscar produto" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
            <Select value={productCategory} onValueChange={setProductCategory}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas categorias</SelectItem>{productSales.categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
            <Select value={minQty} onValueChange={setMinQty}><SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Qualquer quantidade</SelectItem><SelectItem value="2">2+ unidades</SelectItem><SelectItem value="5">5+ unidades</SelectItem><SelectItem value="10">10+ unidades</SelectItem><SelectItem value="20">20+ unidades</SelectItem><SelectItem value="50">50+ unidades</SelectItem></SelectContent></Select>
          </div>
        </div>
        {!productSales.list.length ? <p className="py-8 text-center text-sm text-muted-foreground">Nenhum produto encontrado para os filtros.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-2">Produto</th><th>Categoria</th><th className="text-right">Unidades</th><th className="text-right">Pedidos</th><th className="text-right">Faturamento dos itens</th></tr></thead><tbody>{productSales.list.map((p) => <tr key={`${p.name}-${p.category}`} className="border-b last:border-0"><td className="py-3 font-semibold">{p.name}</td><td>{p.category}</td><td className="text-right text-lg font-black">{p.qty}</td><td className="text-right">{p.orderIds.size}</td><td className="text-right font-semibold">{brl(p.revenue)}</td></tr>)}</tbody></table></div>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><h2 className="mb-3 flex items-center gap-2 font-display text-lg font-black uppercase"><Users className="size-5 text-primary" /> Entregadores ({deliverers.length})</h2>{!deliverers.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhum entregador ativo.</p> : <div className="space-y-2">{deliverers.map((d: any) => <div key={d.id} className="flex items-center justify-between rounded-xl border bg-muted/20 px-4 py-2.5 text-sm"><span className="font-semibold">{d.full_name}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${busyDeliverers.has(d.full_name) ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"}`}>{busyDeliverers.has(d.full_name) ? "Em entrega" : "Disponível"}</span></div>)}</div>}</Card>
        <Card className="p-5"><h2 className="mb-3 flex items-center gap-2 font-display text-lg font-black uppercase"><Timer className="size-5 text-primary" /> Fila ativa ({activeOrders.length})</h2>{!activeOrders.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhum pedido em andamento.</p> : <div className="max-h-72 space-y-2 overflow-y-auto">{activeOrders.map((o: any) => { const mins = minutesSince(o.created_at); const urgent = mins >= 15 && o.status !== "out_for_delivery"; return <Link key={o.id} to="/loja/pedido/$id" params={{ id: o.id }} className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${urgent ? "bg-destructive/10" : "border bg-muted/20"}`}><div><span className="font-semibold">{orderDisplayRef(o)}</span> — {o.customer_name}<p className="text-[11px] text-muted-foreground">{ORDER_STATUS_LABEL[o.status]}</p></div><span className={`text-xs font-bold ${urgent ? "text-destructive" : "text-muted-foreground"}`}>{mins}min</span></Link>; })}</div>}</Card>
      </div>
    </div>
  );
}

function Metric({ label, value, icon: Icon, hero = false }: { label: string; value: any; icon: any; hero?: boolean }) {
  return <Card className={`p-4 ${hero ? "border-0 bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-md" : ""}`}><div className="flex items-center justify-between"><span className={`text-[11px] font-bold uppercase tracking-wide ${hero ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{label}</span><Icon className={`size-4 ${hero ? "text-primary-foreground/80" : "text-muted-foreground"}`} /></div><p className="mt-2 text-2xl font-black">{value}</p></Card>;
}
