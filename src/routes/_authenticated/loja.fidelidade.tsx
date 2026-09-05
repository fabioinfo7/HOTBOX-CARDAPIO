import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Flame, Gift, RefreshCw, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { getLoyaltyAdminData, saveLoyaltyAdminConfig, setProductLoyaltyEligible } from "@/lib/loyalty.functions";

export const Route = createFileRoute("/_authenticated/loja/fidelidade")({ component: LoyaltyAdminPage });

function LoyaltyAdminPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState("10");
  const [enabled, setEnabled] = useState(true);

  async function token() { return (await supabase.auth.getSession()).data.session?.access_token || null; }
  async function load() {
    setLoading(true);
    const result = await getLoyaltyAdminData({ data: { accessToken: await token() } });
    if (!result.ok) toast.error((result as any).error || "Falha ao carregar fidelidade");
    else {
      setData(result);
      setRequired(String(result.config.required));
      setEnabled(result.config.enabled);
    }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const available = useMemo(() => (data?.rewards || []).filter((r: any) => r.status === "available").length, [data]);
  const redeemed = useMemo(() => (data?.rewards || []).filter((r: any) => r.status === "redeemed").length, [data]);

  async function saveConfig() {
    const result = await saveLoyaltyAdminConfig({ data: { accessToken: await token(), enabled, required: Number(required) } });
    if (!result.ok) return toast.error((result as any).error || "Falha ao salvar");
    toast.success("Programa de fidelidade atualizado.");
    void load();
  }

  async function toggleProduct(id: string, value: boolean) {
    setData((d: any) => ({ ...d, products: d.products.map((p: any) => p.id === id ? { ...p, loyalty_eligible: value } : p) }));
    const result = await setProductLoyaltyEligible({ data: { accessToken: await token(), productId: id, eligible: value } });
    if (!result.ok) { toast.error((result as any).error || "Falha ao atualizar produto"); void load(); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-2xl font-black"><Flame className="size-6 text-orange-500" /> Clube HotBox</h1><p className="text-sm text-muted-foreground">Clientes logados, progresso, recompensas e produtos elegíveis.</p></div>
        <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} /> Atualizar</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><Users className="size-5 text-primary" /><p className="mt-2 text-xs font-bold uppercase text-muted-foreground">Clientes no Clube</p><p className="text-3xl font-black">{data?.accounts?.length || 0}</p></Card>
        <Card className="p-4"><Gift className="size-5 text-emerald-600" /><p className="mt-2 text-xs font-bold uppercase text-muted-foreground">Cupons disponíveis</p><p className="text-3xl font-black">{available}</p></Card>
        <Card className="p-4"><Trophy className="size-5 text-amber-500" /><p className="mt-2 text-xs font-bold uppercase text-muted-foreground">Recompensas usadas</p><p className="text-3xl font-black">{redeemed}</p></Card>
      </div>

      <Card className="p-5">
        <h2 className="font-black">Regras do programa</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-xl border p-3"><div><p className="font-bold">Programa ativo</p><p className="text-xs text-muted-foreground">Somente pedidos pagos e entregues, feitos logado no cardápio, contam.</p></div><Switch checked={enabled} onCheckedChange={setEnabled} /></label>
          <div><label className="text-xs font-bold">Pedidos para ganhar 1 batata</label><Input className="mt-1" type="number" min={1} max={50} value={required} onChange={(e) => setRequired(e.target.value)} /></div>
        </div>
        <Button className="mt-4" onClick={saveConfig}>Salvar regras</Button>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b p-5"><h2 className="font-black">Batatas participantes</h2><p className="text-xs text-muted-foreground">Somente produtos marcados aqui podem ficar grátis pelo cupom de fidelidade.</p></div>
        <div className="divide-y">
          {(data?.products || []).map((p: any) => <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3"><div><p className="font-semibold">{p.name}</p><p className="text-xs text-muted-foreground">{p.category || p.kind || "Sem categoria"}{p.active === false ? " · inativo" : ""}</p></div><Switch checked={p.loyalty_eligible === true} onCheckedChange={(v) => toggleProduct(p.id, v)} /></div>)}
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b p-5"><h2 className="font-black">Clientes e progresso</h2></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground"><th className="p-3">Cliente</th><th className="p-3 text-right">Progresso</th><th className="p-3 text-right">Pedidos válidos</th><th className="p-3 text-right">Prêmios</th></tr></thead><tbody>{(data?.accounts || []).map((a: any) => <tr key={a.user_id} className="border-b last:border-0"><td className="p-3"><b>{a.profile?.full_name || a.profile?.email || "Cliente"}</b><p className="text-xs text-muted-foreground">{a.profile?.phone || a.profile?.email || "—"}</p></td><td className="p-3 text-right font-black">{a.points}/{data?.config?.required || 10}</td><td className="p-3 text-right">{a.lifetime_qualifying_orders}</td><td className="p-3 text-right">{a.rewards_earned}</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
}
