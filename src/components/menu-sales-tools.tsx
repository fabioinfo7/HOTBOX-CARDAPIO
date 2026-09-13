import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Sparkles, ShoppingBasket, Save, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function MenuSalesTools() {
  const [products, setProducts] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [options, setOptions] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [bumps, setBumps] = useState<any[]>([]);
  const [newGroup, setNewGroup] = useState({ name: "", description: "", required: false, min_select: 0, max_select: 1 });
  const [newOptionByGroup, setNewOptionByGroup] = useState<Record<string, { name: string; price: string }>>({});
  const [newBump, setNewBump] = useState({ product_id: "", title: "Que tal completar seu pedido?", subtitle: "", placement: "cart", price_override: "" });

  async function load() {
    const [p, g, o, l, b] = await Promise.all([
      supabase.from("products").select("id,name,sale_price,active,kind,is_combo").eq("active", true).order("name"),
      (supabase as any).from("menu_addon_groups").select("*").order("sort_order").order("name"),
      (supabase as any).from("menu_addon_options").select("*").order("sort_order").order("name"),
      (supabase as any).from("product_addon_groups").select("*").order("sort_order"),
      (supabase as any).from("menu_order_bumps").select("*").order("placement").order("sort_order"),
    ]);
    setProducts((p.data as any[]) ?? []);
    setGroups((g.data as any[]) ?? []);
    setOptions((o.data as any[]) ?? []);
    setLinks((l.data as any[]) ?? []);
    setBumps((b.data as any[]) ?? []);
  }

  useEffect(() => { void load(); }, []);

  const productsById = useMemo(() => new Map(products.map((p) => [String(p.id), p])), [products]);

  async function createGroup() {
    const name = newGroup.name.trim();
    if (!name) return toast.error("Informe o nome do grupo de adicionais.");
    const min = Math.max(0, num(newGroup.min_select));
    const max = Math.max(1, num(newGroup.max_select, 1));
    if (min > max) return toast.error("O mínimo não pode ser maior que o máximo.");
    const { error } = await (supabase as any).from("menu_addon_groups").insert({
      name,
      description: newGroup.description.trim() || null,
      required: newGroup.required,
      min_select: newGroup.required ? Math.max(1, min) : min,
      max_select: max,
      active: true,
      sort_order: groups.length,
    });
    if (error) return toast.error(error.message);
    setNewGroup({ name: "", description: "", required: false, min_select: 0, max_select: 1 });
    toast.success("Grupo de adicionais criado.");
    await load();
  }

  async function updateGroup(group: any, patch: any) {
    const next = { ...group, ...patch };
    const min = Math.max(0, num(next.min_select));
    const max = Math.max(1, num(next.max_select, 1));
    if (min > max) return toast.error("O mínimo não pode ser maior que o máximo.");
    const { error } = await (supabase as any).from("menu_addon_groups").update({
      name: String(next.name || "").trim(),
      description: String(next.description || "").trim() || null,
      required: !!next.required,
      min_select: next.required ? Math.max(1, min) : min,
      max_select: max,
      active: next.active !== false,
    }).eq("id", group.id);
    if (error) toast.error(error.message); else await load();
  }

  async function deleteGroup(id: string) {
    if (!confirm("Excluir este grupo e todas as opções dele?")) return;
    const { error } = await (supabase as any).from("menu_addon_groups").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Grupo excluído."); await load(); }
  }

  async function addOption(groupId: string) {
    const draft = newOptionByGroup[groupId] || { name: "", price: "" };
    const name = draft.name.trim();
    if (!name) return toast.error("Informe o nome do adicional.");
    const price = Math.max(0, num(String(draft.price).replace(",", ".")));
    const { error } = await (supabase as any).from("menu_addon_options").insert({
      group_id: groupId,
      name,
      price,
      active: true,
      sort_order: options.filter((o) => o.group_id === groupId).length,
    });
    if (error) return toast.error(error.message);
    setNewOptionByGroup((s) => ({ ...s, [groupId]: { name: "", price: "" } }));
    await load();
  }

  async function updateOption(option: any, patch: any) {
    const next = { ...option, ...patch };
    const { error } = await (supabase as any).from("menu_addon_options").update({
      name: String(next.name || "").trim(),
      price: Math.max(0, num(next.price)),
      active: next.active !== false,
    }).eq("id", option.id);
    if (error) toast.error(error.message); else await load();
  }

  async function deleteOption(id: string) {
    const { error } = await (supabase as any).from("menu_addon_options").delete().eq("id", id);
    if (error) toast.error(error.message); else await load();
  }

  async function toggleProductGroup(productId: string, groupId: string, checked: boolean) {
    if (checked) {
      const { error } = await (supabase as any).from("product_addon_groups").upsert({ product_id: productId, group_id: groupId });
      if (error) return toast.error(error.message);
    } else {
      const { error } = await (supabase as any).from("product_addon_groups").delete().eq("product_id", productId).eq("group_id", groupId);
      if (error) return toast.error(error.message);
    }
    await load();
  }

  async function createBump() {
    if (!newBump.product_id) return toast.error("Escolha o produto do order bump.");
    const priceOverride = newBump.price_override.trim() === "" ? null : Math.max(0, num(newBump.price_override.replace(",", ".")));
    const { error } = await (supabase as any).from("menu_order_bumps").insert({
      product_id: newBump.product_id,
      title: newBump.title.trim() || "Complete seu pedido",
      subtitle: newBump.subtitle.trim() || null,
      placement: newBump.placement,
      price_override: priceOverride,
      active: true,
      sort_order: bumps.length,
    });
    if (error) return toast.error(error.message);
    setNewBump({ product_id: "", title: "Que tal completar seu pedido?", subtitle: "", placement: "cart", price_override: "" });
    toast.success("Order bump criado.");
    await load();
  }

  async function updateBump(bump: any, patch: any) {
    const next = { ...bump, ...patch };
    const { error } = await (supabase as any).from("menu_order_bumps").update({
      title: String(next.title || "").trim() || "Complete seu pedido",
      subtitle: String(next.subtitle || "").trim() || null,
      placement: next.placement === "checkout" ? "checkout" : "cart",
      price_override: next.price_override === "" || next.price_override == null ? null : Math.max(0, num(next.price_override)),
      active: next.active !== false,
    }).eq("id", bump.id);
    if (error) toast.error(error.message); else await load();
  }

  async function deleteBump(id: string) {
    if (!confirm("Excluir esta oferta rápida?")) return;
    const { error } = await (supabase as any).from("menu_order_bumps").delete().eq("id", id);
    if (error) toast.error(error.message); else await load();
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden rounded-3xl border-2 border-primary/20">
        <div className="bg-gradient-to-r from-primary/10 to-amber-100/60 p-5">
          <div className="flex items-start gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground"><Sparkles className="size-5" /></div>
            <div>
              <h2 className="text-lg font-black">Adicionais inteligentes</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Crie grupos como “Escolha a borda”, “Adicione mais recheio” ou “Molhos extras” e defina em quais produtos eles aparecem. O preço é validado novamente no servidor antes do pagamento.</p>
            </div>
          </div>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid gap-3 rounded-2xl border bg-muted/20 p-4 md:grid-cols-2">
            <div><Label>Nome do grupo</Label><Input value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} placeholder="Ex.: Escolha sua borda" /></div>
            <div><Label>Descrição</Label><Input value={newGroup.description} onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })} placeholder="Ex.: deixe ainda mais cremoso" /></div>
            <div className="grid grid-cols-2 gap-2"><div><Label>Mínimo</Label><Input type="number" min="0" value={newGroup.min_select} onChange={(e) => setNewGroup({ ...newGroup, min_select: num(e.target.value) })} /></div><div><Label>Máximo</Label><Input type="number" min="1" value={newGroup.max_select} onChange={(e) => setNewGroup({ ...newGroup, max_select: num(e.target.value, 1) })} /></div></div>
            <label className="flex items-center justify-between rounded-xl border bg-background p-3 text-sm font-bold">Obrigatório <Switch checked={newGroup.required} onCheckedChange={(v) => setNewGroup({ ...newGroup, required: v, min_select: v ? Math.max(1, newGroup.min_select) : newGroup.min_select })} /></label>
            <Button onClick={createGroup} className="md:col-span-2"><Plus className="mr-2 size-4" /> Criar grupo de adicionais</Button>
          </div>

          {groups.map((group) => {
            const groupOptions = options.filter((o) => o.group_id === group.id);
            const linkedProducts = new Set(links.filter((l) => l.group_id === group.id).map((l) => String(l.product_id)));
            const draft = newOptionByGroup[group.id] || { name: "", price: "" };
            return (
              <div key={group.id} className="rounded-2xl border bg-background p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="min-w-[180px] flex-1 font-bold" value={group.name} onChange={(e) => setGroups((gs) => gs.map((g) => g.id === group.id ? { ...g, name: e.target.value } : g))} onBlur={() => updateGroup(group, { name: groups.find((g) => g.id === group.id)?.name })} />
                  <label className="flex items-center gap-2 text-xs font-bold"><Switch checked={group.active !== false} onCheckedChange={(v) => updateGroup(group, { active: v })} /> Ativo</label>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteGroup(group.id)}><Trash2 className="size-4" /></Button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div><Label className="text-[11px]">Mínimo</Label><Input type="number" min="0" value={group.min_select} onChange={(e) => setGroups((gs) => gs.map((g) => g.id === group.id ? { ...g, min_select: num(e.target.value) } : g))} onBlur={() => updateGroup(group, { min_select: groups.find((g) => g.id === group.id)?.min_select })} /></div>
                  <div><Label className="text-[11px]">Máximo</Label><Input type="number" min="1" value={group.max_select} onChange={(e) => setGroups((gs) => gs.map((g) => g.id === group.id ? { ...g, max_select: num(e.target.value, 1) } : g))} onBlur={() => updateGroup(group, { max_select: groups.find((g) => g.id === group.id)?.max_select })} /></div>
                  <label className="flex items-center justify-between rounded-xl border p-3 text-xs font-bold sm:col-span-2">Obrigatório <Switch checked={group.required === true} onCheckedChange={(v) => updateGroup(group, { required: v, min_select: v ? Math.max(1, num(group.min_select)) : num(group.min_select) })} /></label>
                </div>

                <div className="mt-4 space-y-2">
                  <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Opções deste grupo</p>
                  {groupOptions.map((option) => (
                    <div key={option.id} className="grid gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_140px_auto_auto] sm:items-center">
                      <Input value={option.name} onChange={(e) => setOptions((os) => os.map((o) => o.id === option.id ? { ...o, name: e.target.value } : o))} onBlur={() => updateOption(option, { name: options.find((o) => o.id === option.id)?.name })} />
                      <Input type="number" step="0.01" min="0" value={option.price} onChange={(e) => setOptions((os) => os.map((o) => o.id === option.id ? { ...o, price: e.target.value } : o))} onBlur={() => updateOption(option, { price: options.find((o) => o.id === option.id)?.price })} />
                      <Switch checked={option.active !== false} onCheckedChange={(v) => updateOption(option, { active: v })} />
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteOption(option.id)}><Trash2 className="size-4" /></Button>
                    </div>
                  ))}
                  <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
                    <Input value={draft.name} onChange={(e) => setNewOptionByGroup((s) => ({ ...s, [group.id]: { ...draft, name: e.target.value } }))} placeholder="Ex.: Borda de requeijão" />
                    <Input value={draft.price} onChange={(e) => setNewOptionByGroup((s) => ({ ...s, [group.id]: { ...draft, price: e.target.value } }))} placeholder="Preço" inputMode="decimal" />
                    <Button onClick={() => addOption(group.id)}><Plus className="mr-1 size-4" /> Adicionar</Button>
                  </div>
                </div>

                <details className="mt-4 rounded-xl border bg-muted/20 p-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-black"><span>Produtos que usam este grupo ({linkedProducts.size})</span><ChevronDown className="size-4" /></summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {products.filter((p) => p.kind !== "beverage").map((product) => (
                      <label key={product.id} className="flex items-center justify-between gap-2 rounded-xl border bg-background p-2.5 text-sm">
                        <span className="min-w-0 truncate font-semibold">{product.name}</span>
                        <Switch checked={linkedProducts.has(String(product.id))} onCheckedChange={(v) => toggleProductGroup(product.id, group.id, v)} />
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-hidden rounded-3xl border-2 border-amber-300/70">
        <div className="bg-gradient-to-r from-amber-100 to-orange-50 p-5">
          <div className="flex items-start gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-amber-500 text-white"><ShoppingBasket className="size-5" /></div>
            <div><h2 className="text-lg font-black">Order bumps — oferta de 1 clique</h2><p className="mt-1 text-sm text-muted-foreground">Ofereça bebida, sobremesa ou outro complemento na sacola/checkout. Use pouco e com alta relevância para aumentar o ticket sem poluir a experiência.</p></div>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-3 rounded-2xl border bg-muted/20 p-4 md:grid-cols-2">
            <div className="md:col-span-2"><Label>Produto ofertado</Label><Select value={newBump.product_id} onValueChange={(v) => setNewBump({ ...newBump, product_id: v })}><SelectTrigger><SelectValue placeholder="Escolha um produto" /></SelectTrigger><SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — {brl(p.sale_price)}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Chamada</Label><Input value={newBump.title} onChange={(e) => setNewBump({ ...newBump, title: e.target.value })} /></div>
            <div><Label>Texto curto</Label><Input value={newBump.subtitle} onChange={(e) => setNewBump({ ...newBump, subtitle: e.target.value })} placeholder="Ex.: combina perfeitamente com sua batata" /></div>
            <div><Label>Onde aparece</Label><Select value={newBump.placement} onValueChange={(v) => setNewBump({ ...newBump, placement: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cart">Na sacola</SelectItem><SelectItem value="checkout">No checkout</SelectItem></SelectContent></Select></div>
            <div><Label>Preço especial (opcional)</Label><Input value={newBump.price_override} onChange={(e) => setNewBump({ ...newBump, price_override: e.target.value })} placeholder="Vazio = preço normal" /></div>
            <Button className="md:col-span-2" onClick={createBump}><Plus className="mr-2 size-4" /> Criar order bump</Button>
          </div>

          {bumps.map((bump) => {
            const product = productsById.get(String(bump.product_id));
            return <div key={bump.id} className="grid gap-3 rounded-2xl border bg-background p-4 md:grid-cols-[1fr_160px_130px_auto] md:items-center">
              <div><p className="font-black">{bump.title}</p><p className="text-xs text-muted-foreground">{product?.name || "Produto removido"}{bump.subtitle ? ` • ${bump.subtitle}` : ""}</p></div>
              <div><Label className="text-[10px]">Preço especial</Label><Input value={bump.price_override ?? ""} onChange={(e) => setBumps((bs) => bs.map((b) => b.id === bump.id ? { ...b, price_override: e.target.value } : b))} onBlur={() => updateBump(bump, { price_override: bumps.find((b) => b.id === bump.id)?.price_override })} placeholder="Preço normal" /></div>
              <div><Label className="text-[10px]">Local</Label><Select value={bump.placement} onValueChange={(v) => updateBump(bump, { placement: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cart">Sacola</SelectItem><SelectItem value="checkout">Checkout</SelectItem></SelectContent></Select></div>
              <div className="flex items-center justify-end gap-2"><Switch checked={bump.active !== false} onCheckedChange={(v) => updateBump(bump, { active: v })} /><Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteBump(bump.id)}><Trash2 className="size-4" /></Button></div>
            </div>;
          })}
        </div>
      </Card>

      <Card className="rounded-3xl border-emerald-200 bg-emerald-50/60 p-5">
        <div className="flex items-start gap-3"><Save className="mt-0.5 size-5 text-emerald-700" /><div><p className="font-black text-emerald-950">Combos continuam no cadastro normal de produtos</p><p className="mt-1 text-sm text-emerald-900/80">Ao editar um produto, ative “Este produto é um combo” e escolha os itens incluídos. No cardápio o combo recebe destaque visual automaticamente.</p></div></div>
      </Card>
    </div>
  );
}
