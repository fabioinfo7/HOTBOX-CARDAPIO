import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl, formatPhone } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Ticket, Percent, DollarSign, Users, ShoppingBag, TrendingUp, History, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/loja/cupons")({ component: CouponsPage });

function statusOf(c: any) {
  const now = new Date();
  if (!c.active) return { label: "Inativo", color: "text-muted-foreground" };
  if (c.valid_until && now > new Date(c.valid_until)) return { label: "Expirado", color: "text-destructive" };
  if (c.valid_from && now < new Date(c.valid_from)) return { label: "Agendado", color: "text-amber-600" };
  if (c.usage_limit != null && (c.usage_count ?? 0) >= c.usage_limit) return { label: "Esgotado", color: "text-destructive" };
  return { label: "Ativo", color: "text-emerald-600" };
}

function Metric({ icon: Icon, label, value, sub }: any) {
  return <Card className="p-4"><div className="flex items-start gap-3"><div className="rounded-xl bg-muted p-2"><Icon className="size-4" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-extrabold">{value}</p>{sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}</div></div></Card>;
}

function CouponsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [redemptions, setRedemptions] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load() {
    const [{ data: coupons, error: cErr }, { data: uses, error: rErr }] = await Promise.all([
      supabase.from("coupons").select("*").order("created_at", { ascending: false }),
      (supabase as any).from("coupon_redemptions").select("*, orders(order_number,customer_name,customer_phone,total,status,created_at)").order("used_at", { ascending: false }),
    ]);
    if (cErr) toast.error(cErr.message); else setRows(coupons ?? []);
    if (rErr) toast.error(rErr.message); else setRedemptions(uses ?? []);
  }

  useEffect(() => {
    load();
    supabase.from("products").select("id,name").eq("active", true).order("name").then(({ data }) => setProducts(data ?? []));
  }, []);

  const activeUses = useMemo(() => redemptions.filter((r) => !r.reversed_at), [redemptions]);
  const totalDiscount = activeUses.reduce((s, r) => s + Number(r.discount_amount || 0), 0);
  const generatedRevenue = activeUses.reduce((s, r) => s + Number(r.order_total || 0), 0);
  const avgTicket = activeUses.length ? generatedRevenue / activeUses.length : 0;
  const selectedUses = redemptions.filter((r) => r.coupon_id === selectedId);
  const selectedCoupon = rows.find((r) => r.id === selectedId);

  async function del(c: any) {
    if ((c.usage_count ?? 0) > 0 || redemptions.some((r) => r.coupon_id === c.id)) {
      toast.error("Este cupom já possui histórico. Desative-o em vez de excluir para preservar os relatórios.");
      return;
    }
    if (!confirm("Excluir este cupom sem histórico?")) return;
    const { error } = await supabase.from("coupons").delete().eq("id", c.id);
    if (error) toast.error(error.message); else { toast.success("Excluído"); load(); }
  }

  async function toggleActive(c: any, active: boolean) {
    const { error } = await supabase.from("coupons").update({ active }).eq("id", c.id);
    if (error) toast.error(error.message); else load();
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Cupons de desconto</h1><p className="text-sm text-muted-foreground">Crie regras, limite abusos e acompanhe o retorno de cada cupom.</p></div>
      <Button onClick={() => setEditing({ discount_type: "percentage", discount_value: 10, active: true, allow_promotion_stack: false, first_order_only: false })} className="rounded-full font-semibold"><Plus className="size-4" /> Novo cupom</Button>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={ShoppingBag} label="Usos válidos" value={activeUses.length} sub={`${redemptions.filter(r => r.reversed_at).length} uso(s) devolvido(s) por cancelamento`} />
      <Metric icon={TrendingUp} label="Faturamento com cupons" value={brl(generatedRevenue)} sub="Total dos pedidos que utilizaram cupom" />
      <Metric icon={Ticket} label="Desconto concedido" value={brl(totalDiscount)} sub="Descontos efetivamente utilizados" />
      <Metric icon={Users} label="Ticket médio" value={brl(avgTicket)} sub="Pedidos com cupom" />
    </div>

    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="bg-muted text-left"><tr><th className="p-3">Código</th><th className="p-3">Desconto</th><th className="p-3">Regras</th><th className="p-3">Uso</th><th className="p-3">Resultado</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead>
        <tbody>{rows.map((c) => {
          const st = statusOf(c); const product = products.find((p) => p.id === c.applicable_product_id);
          const uses = activeUses.filter((r) => r.coupon_id === c.id); const rev = uses.reduce((s,r) => s + Number(r.order_total||0),0); const disc = uses.reduce((s,r) => s + Number(r.discount_amount||0),0);
          return <tr key={c.id} className="border-t align-top">
            <td className="p-3"><p className="font-mono font-bold uppercase">{c.code}</p><p className="max-w-40 text-[11px] text-muted-foreground">{c.description || "Sem descrição"}</p></td>
            <td className="p-3">{c.discount_type === "percentage" ? <span className="flex items-center gap-1"><Percent className="size-3.5" />{c.discount_value}%</span> : <span className="flex items-center gap-1"><DollarSign className="size-3.5" />{brl(c.discount_value)}</span>}{c.min_order_value ? <p className="text-[11px] text-muted-foreground">mín. {brl(c.min_order_value)}</p> : null}</td>
            <td className="p-3 text-xs"><p>{product ? `Somente: ${product.name}` : "Pedido todo"}</p><p>{c.first_order_only ? "Somente 1ª compra" : "Qualquer compra"}</p><p>{c.max_uses_per_customer ? `Máx. ${c.max_uses_per_customer} por cliente` : "Sem limite por cliente"}</p><p>{c.allow_promotion_stack ? "Acumula com promoção" : "Não acumula com promoção"}</p></td>
            <td className="p-3 text-xs"><p className="font-bold">{c.usage_count ?? 0}{c.usage_limit != null ? ` / ${c.usage_limit}` : ""}</p><p className="text-muted-foreground">{c.valid_until ? `até ${new Date(c.valid_until).toLocaleDateString("pt-BR")}` : "sem prazo"}</p></td>
            <td className="p-3 text-xs"><p className="font-bold">{brl(rev)}</p><p className="text-muted-foreground">desconto {brl(disc)}</p><Button variant="link" className="h-auto p-0 text-xs" onClick={() => setSelectedId(c.id)}><History className="mr-1 size-3" />Ver usos</Button></td>
            <td className={`p-3 text-xs font-bold ${st.color}`}>{st.label}</td>
            <td className="p-3 text-right whitespace-nowrap"><Switch checked={c.active} onCheckedChange={(v) => toggleActive(c,v)} className="mr-1 align-middle" /><Button size="icon" variant="ghost" onClick={() => setEditing(c)}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" onClick={() => del(c)}><Trash2 className="size-4" /></Button></td>
          </tr>;
        })}{!rows.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground"><Ticket className="mx-auto mb-2 size-6" />Nenhum cupom cadastrado</td></tr>}</tbody>
      </table>
    </Card>

    <Card className="border-dashed p-4"><div className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 text-emerald-600" /><div><p className="font-semibold">Proteções ativas</p><p className="text-sm text-muted-foreground">O código não fica mais exposto em uma lista pública. O desconto de cupom restrito a produto é calculado somente sobre esse produto, os limites são confirmados atomicamente e cancelamentos devolvem o uso automaticamente.</p></div></div></Card>

    {selectedId && <Dialog open onOpenChange={(o) => !o && setSelectedId(null)}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Histórico — {selectedCoupon?.code}</DialogTitle></DialogHeader><div className="space-y-2">{selectedUses.map((r) => <div key={r.id} className={`rounded-xl border p-3 ${r.reversed_at ? "opacity-55" : ""}`}><div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold">Pedido #{r.orders?.order_number ?? "—"} · {r.orders?.customer_name || "Cliente"}</p><p className="text-xs text-muted-foreground">{formatPhone(r.customer_phone)} · {new Date(r.used_at).toLocaleString("pt-BR")}</p></div><div className="text-right"><p className="font-bold">{brl(r.order_total)}</p><p className="text-xs text-emerald-600">-{brl(r.discount_amount)}</p></div></div>{r.reversed_at && <p className="mt-1 text-xs font-semibold text-destructive">Uso devolvido por cancelamento</p>}</div>)}{!selectedUses.length && <p className="py-8 text-center text-muted-foreground">Este cupom ainda não foi utilizado.</p>}</div></DialogContent></Dialog>}

    {editing && <CouponForm value={editing} products={products} onClose={() => { setEditing(null); load(); }} />}
  </div>;
}

function CouponForm({ value, products, onClose }: { value: any; products: any[]; onClose: () => void }) {
  const [f, setF] = useState<any>(value);
  async function save() {
    const payload: any = {
      code: String(f.code || "").trim().toUpperCase(), description: f.description || null,
      discount_type: f.discount_type === "fixed" ? "fixed" : "percentage", discount_value: Number(f.discount_value || 0), active: !!f.active,
      valid_from: f.valid_from || null, valid_until: f.valid_until || null,
      usage_limit: f.usage_limit ? Number(f.usage_limit) : null, max_uses_per_customer: f.max_uses_per_customer ? Number(f.max_uses_per_customer) : null,
      min_order_value: f.min_order_value ? Number(f.min_order_value) : null, applicable_product_id: f.applicable_product_id || null,
      first_order_only: !!f.first_order_only, allow_promotion_stack: !!f.allow_promotion_stack,
    };
    if (!payload.code) return toast.error("Informe o código do cupom");
    if (!payload.discount_value || payload.discount_value <= 0) return toast.error("Informe o valor do desconto");
    if (payload.discount_type === "percentage" && payload.discount_value > 100) return toast.error("Desconto percentual não pode passar de 100%");
    if (payload.valid_from && payload.valid_until && new Date(payload.valid_from) >= new Date(payload.valid_until)) return toast.error("A data final deve ser posterior à inicial");
    if (payload.usage_limit && payload.max_uses_per_customer && payload.max_uses_per_customer > payload.usage_limit) return toast.error("O limite por cliente não pode ser maior que o limite total");
    const q = f.id ? supabase.from("coupons").update(payload).eq("id", f.id) : supabase.from("coupons").insert(payload);
    const { error } = await q; if (error) return toast.error(error.message.includes("duplicate") ? "Já existe um cupom com esse código" : error.message);
    toast.success("Cupom salvo"); onClose();
  }
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto"><DialogHeader><DialogTitle>{f.id ? "Editar" : "Novo"} cupom</DialogTitle></DialogHeader><div className="space-y-4">
    <div><Label>Código do cupom</Label><Input placeholder="Ex: HOTBOX10" value={f.code || ""} onChange={(e) => setF({...f,code:e.target.value.toUpperCase().replace(/\s/g,"")})} className="font-mono uppercase" /></div>
    <div><Label>Descrição interna</Label><Input placeholder="Ex: Campanha de recompra de agosto" value={f.description || ""} onChange={(e) => setF({...f,description:e.target.value})} /></div>
    <div className="grid grid-cols-2 gap-2"><div><Label>Tipo</Label><Select value={f.discount_type || "percentage"} onValueChange={(v) => setF({...f,discount_type:v})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="percentage">Porcentagem (%)</SelectItem><SelectItem value="fixed">Valor fixo (R$)</SelectItem></SelectContent></Select></div><div><Label>{f.discount_type === "fixed" ? "Valor (R$)" : "Porcentagem (%)"}</Label><Input type="number" min="0" step="0.01" value={f.discount_value ?? ""} onChange={(e) => setF({...f,discount_value:e.target.value})} /></div></div>
    <div className="grid grid-cols-2 gap-2"><div><Label>Pedido mínimo</Label><Input type="number" min="0" step="0.01" placeholder="Sem mínimo" value={f.min_order_value ?? ""} onChange={(e) => setF({...f,min_order_value:e.target.value})} /></div><div><Label>Limite total de usos</Label><Input type="number" min="1" step="1" placeholder="Sem limite" value={f.usage_limit ?? ""} onChange={(e) => setF({...f,usage_limit:e.target.value})} /></div></div>
    <div><Label>Máximo de usos por cliente</Label><Input type="number" min="1" step="1" placeholder="Sem limite por cliente" value={f.max_uses_per_customer ?? ""} onChange={(e) => setF({...f,max_uses_per_customer:e.target.value})} /><p className="mt-1 text-[11px] text-muted-foreground">Identificação pelo telefone informado no pedido.</p></div>
    <div className="grid grid-cols-2 gap-2"><div><Label>Válido de</Label><Input type="datetime-local" value={f.valid_from ? String(f.valid_from).slice(0,16) : ""} onChange={(e) => setF({...f,valid_from:e.target.value ? new Date(e.target.value).toISOString() : ""})} /></div><div><Label>Válido até</Label><Input type="datetime-local" value={f.valid_until ? String(f.valid_until).slice(0,16) : ""} onChange={(e) => setF({...f,valid_until:e.target.value ? new Date(e.target.value).toISOString() : ""})} /></div></div>
    <div><Label>Produto elegível</Label><Select value={f.applicable_product_id || "__all__"} onValueChange={(v) => setF({...f,applicable_product_id:v === "__all__" ? "" : v})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__all__">Vale para o pedido todo</SelectItem>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-[11px] text-muted-foreground">Quando escolher um produto, o desconto é calculado somente sobre ele.</p></div>
    <label className="flex cursor-pointer items-center justify-between rounded-xl border p-3"><div><p className="text-sm font-semibold">Somente primeira compra</p><p className="text-[11px] text-muted-foreground">Bloqueia clientes que já possuem pedido anterior.</p></div><Switch checked={!!f.first_order_only} onCheckedChange={(v) => setF({...f,first_order_only:v})} /></label>
    <label className="flex cursor-pointer items-center justify-between rounded-xl border p-3"><div><p className="text-sm font-semibold">Permitir acumular com promoções</p><p className="text-[11px] text-muted-foreground">Desative para proteger sua margem em produtos já promocionais.</p></div><Switch checked={!!f.allow_promotion_stack} onCheckedChange={(v) => setF({...f,allow_promotion_stack:v})} /></label>
    <label className="flex cursor-pointer items-center justify-between rounded-xl border p-3"><div><p className="text-sm font-semibold">Cupom ativo</p><p className="text-[11px] text-muted-foreground">Desative sem perder o histórico.</p></div><Switch checked={!!f.active} onCheckedChange={(v) => setF({...f,active:v})} /></label>
  </div><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save}>Salvar cupom</Button></DialogFooter></DialogContent></Dialog>;
}
