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

function productCurrentPrice(product: any) {
  const base = Math.max(0, Number(product?.sale_price || 0));
  const promo = Number(product?.promotion_price);
  const now = new Date();
  const startsOk = !product?.promotion_start_at || new Date(product.promotion_start_at) <= now;
  const endsOk = !product?.promotion_end_at || new Date(product.promotion_end_at) >= now;
  const dayOk =
    !Array.isArray(product?.promotion_days_of_week) ||
    !product.promotion_days_of_week.length ||
    product.promotion_days_of_week.includes(now.getDay());

  return product?.promotion_active === true &&
    startsOk &&
    endsOk &&
    dayOk &&
    Number.isFinite(promo) &&
    promo >= 0
      ? promo
      : base;
}

function emptyOptionDraft() {
  return {
    source: "manual" as const,
    name: "",
    description: "",
    price: "",
    linked_product_id: "",
    use_linked_product_price: true,
  };
}

export function MenuSalesTools() {
  const [products, setProducts] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [options, setOptions] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [bumps, setBumps] = useState<any[]>([]);
  const [newGroup, setNewGroup] = useState({
    name: "",
    description: "",
    required: false,
    min_select: 0,
    max_select: 1,
    availability: "all" as "all" | "specific",
    product_ids: [] as string[],
  });
  const [newOptionByGroup, setNewOptionByGroup] = useState<Record<string, {
    source: "manual" | "product";
    name: string;
    description: string;
    price: string;
    linked_product_id: string;
    use_linked_product_price: boolean;
  }>>({});
  const [newBump, setNewBump] = useState({ product_id: "", title: "Que tal completar seu pedido?", subtitle: "", placement: "cart", price_override: "" });

  async function load() {
    const [p, g, o, l, b] = await Promise.all([
      supabase.from("products").select("id,name,description,sale_price,active,kind,is_combo,promotion_active,promotion_price,promotion_type,promotion_start_at,promotion_end_at,promotion_days_of_week,promotion_time_start,promotion_time_end").eq("active", true).order("name"),
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

  const allProductIds = useMemo(() => products.map((p) => String(p.id)), [products]);

  function groupLinkedProductIds(groupId: string) {
    return new Set(
      links
        .filter((link) => String(link.group_id) === String(groupId))
        .map((link) => String(link.product_id)),
    );
  }

  function groupAvailability(groupId: string): "all" | "specific" {
    if (!allProductIds.length) return "specific";
    const linked = groupLinkedProductIds(groupId);
    return allProductIds.every((id) => linked.has(id)) ? "all" : "specific";
  }

  async function applyGroupToAllProducts(groupId: string) {
    if (!allProductIds.length) return toast.error("Cadastre ao menos um produto antes de aplicar o adicional a todos.");

    const rows = allProductIds.map((productId, index) => ({
      product_id: productId,
      group_id: groupId,
      sort_order: index,
    }));

    const { error } = await (supabase as any)
      .from("product_addon_groups")
      .upsert(rows, { onConflict: "product_id,group_id" });

    if (error) return toast.error(error.message);

    toast.success("Adicional disponível em todos os produtos.");
    await load();
  }

  async function changeGroupAvailability(groupId: string, mode: "all" | "specific") {
    if (mode === "all") return applyGroupToAllProducts(groupId);

    const { error } = await (supabase as any)
      .from("product_addon_groups")
      .delete()
      .eq("group_id", groupId);

    if (error) return toast.error(error.message);

    toast.info("Produtos específicos ativado. Marque abaixo onde este adicional deve aparecer.");
    await load();
  }

  async function createGroup() {
    const name = newGroup.name.trim();
    if (!name) return toast.error("Informe o nome do grupo de adicionais.");

    const min = Math.max(0, num(newGroup.min_select));
    const max = Math.max(1, num(newGroup.max_select, 1));

    if (min > max) return toast.error("O mínimo não pode ser maior que o máximo.");
    if (newGroup.availability === "specific" && !newGroup.product_ids.length) {
      return toast.error("Escolha pelo menos um produto ou selecione “Todos os produtos”.");
    }

    const { data: created, error } = await (supabase as any)
      .from("menu_addon_groups")
      .insert({
        name,
        description: newGroup.description.trim() || null,
        required: newGroup.required,
        min_select: newGroup.required ? Math.max(1, min) : min,
        max_select: max,
        active: true,
        sort_order: groups.length,
      })
      .select("id")
      .single();

    if (error || !created?.id) return toast.error(error?.message || "Não foi possível criar o grupo.");

    const targetIds =
      newGroup.availability === "all" ? allProductIds : newGroup.product_ids;

    if (targetIds.length) {
      const rows = targetIds.map((productId, index) => ({
        product_id: productId,
        group_id: created.id,
        sort_order: index,
      }));

      const { error: linkError } = await (supabase as any)
        .from("product_addon_groups")
        .upsert(rows, { onConflict: "product_id,group_id" });

      if (linkError) {
        await (supabase as any).from("menu_addon_groups").delete().eq("id", created.id);
        return toast.error(`O grupo não foi salvo porque o vínculo com os produtos falhou: ${linkError.message}`);
      }
    }

    setNewGroup({
      name: "",
      description: "",
      required: false,
      min_select: 0,
      max_select: 1,
      availability: "all",
      product_ids: [],
    });

    toast.success(
      newGroup.availability === "all"
        ? "Grupo criado para todos os produtos."
        : "Grupo criado para os produtos selecionados.",
    );
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
    if (error) toast.error(error.message); else { toast.success("Alterações do grupo salvas."); await load(); }
  }

  async function deleteGroup(id: string) {
    if (!confirm("Excluir este grupo e todas as opções dele?")) return;
    const { error } = await (supabase as any).from("menu_addon_groups").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Grupo excluído."); await load(); }
  }

  async function addOption(groupId: string) {
    const draft = newOptionByGroup[groupId] || emptyOptionDraft();
    const linkedProduct =
      draft.source === "product"
        ? products.find((product) => String(product.id) === String(draft.linked_product_id))
        : null;

    if (draft.source === "product" && !linkedProduct) {
      return toast.error("Escolha qual produto existente será usado como adicional.");
    }

    const name =
      draft.source === "product"
        ? String(linkedProduct?.name || "").trim()
        : draft.name.trim();

    if (!name) return toast.error("Informe o nome do adicional.");

    const price =
      draft.source === "product" && draft.use_linked_product_price
        ? productCurrentPrice(linkedProduct)
        : Math.max(0, num(String(draft.price).replace(",", ".")));

    const description =
      draft.source === "product"
        ? String(draft.description || linkedProduct?.description || "").trim() || null
        : draft.description.trim() || null;

    const { error } = await (supabase as any).from("menu_addon_options").insert({
      group_id: groupId,
      name,
      description,
      price,
      linked_product_id: draft.source === "product" ? linkedProduct.id : null,
      use_linked_product_price: draft.source === "product" ? draft.use_linked_product_price : false,
      active: true,
      sort_order: options.filter((o) => o.group_id === groupId).length,
    });

    if (error) return toast.error(error.message);

    setNewOptionByGroup((state) => ({ ...state, [groupId]: emptyOptionDraft() }));
    toast.success(
      draft.source === "product"
        ? `${name} também pode ser vendido como adicional.`
        : "Adicional criado.",
    );
    await load();
  }

  async function updateOption(option: any, patch: any) {
    const next = { ...option, ...patch };
    const linkedProduct = next.linked_product_id
      ? products.find((product) => String(product.id) === String(next.linked_product_id))
      : null;

    const price =
      next.linked_product_id && next.use_linked_product_price === true && linkedProduct
        ? productCurrentPrice(linkedProduct)
        : Math.max(0, num(next.price));

    const { error } = await (supabase as any).from("menu_addon_options").update({
      name: String(next.name || linkedProduct?.name || "").trim(),
      description: String(next.description || "").trim() || null,
      price,
      linked_product_id: next.linked_product_id || null,
      use_linked_product_price: !!next.linked_product_id && next.use_linked_product_price === true,
      active: next.active !== false,
    }).eq("id", option.id);

    if (error) toast.error(error.message); else { toast.success("Alterações do adicional salvas."); await load(); }
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
            <div className="grid grid-cols-2 gap-2"><div><Label>Mínimo</Label><Input type="number" min="0" value={newGroup.min_select} onChange={(e) => setNewGroup({ ...newGroup, min_select: num(e.target.value) })} /></div><div><Label>Máximo de unidades</Label><Input type="number" min="1" value={newGroup.max_select} onChange={(e) => setNewGroup({ ...newGroup, max_select: num(e.target.value, 1) })} /></div></div>
            <div className="rounded-xl border bg-background p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Tipo do grupo</Label>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {newGroup.required ? "Obrigatório: o cliente precisa escolher antes de adicionar." : "Opcional: o cliente escolhe somente se quiser."}
                  </p>
                </div>
                <Switch
                  checked={newGroup.required}
                  onCheckedChange={(v) => setNewGroup({ ...newGroup, required: v, min_select: v ? Math.max(1, newGroup.min_select) : 0 })}
                />
              </div>
              <div className="mt-2 flex gap-2">
                <span className={`rounded-full px-2 py-1 text-[10px] font-black ${newGroup.required ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-500"}`}>OBRIGATÓRIO</span>
                <span className={`rounded-full px-2 py-1 text-[10px] font-black ${!newGroup.required ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>OPCIONAL</span>
              </div>
            </div>

            <div className="md:col-span-2 rounded-2xl border bg-background p-4">
              <Label>Em quais produtos este adicional deve aparecer?</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Escolha se este grupo vale para todos os produtos ou somente para produtos específicos.
              </p>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setNewGroup({ ...newGroup, availability: "all", product_ids: [] })}
                  className={`rounded-xl border p-3 text-left transition ${newGroup.availability === "all" ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "bg-muted/20 hover:bg-muted/40"}`}
                >
                  <p className="text-sm font-black">Todos os produtos</p>
                  <p className="mt-1 text-xs text-muted-foreground">Disponível em todo o cardápio ativo.</p>
                </button>

                <button
                  type="button"
                  onClick={() => setNewGroup({ ...newGroup, availability: "specific" })}
                  className={`rounded-xl border p-3 text-left transition ${newGroup.availability === "specific" ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "bg-muted/20 hover:bg-muted/40"}`}
                >
                  <p className="text-sm font-black">Produtos específicos</p>
                  <p className="mt-1 text-xs text-muted-foreground">Escolha exatamente onde o grupo deve aparecer.</p>
                </button>
              </div>

              {newGroup.availability === "specific" && (
                <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto rounded-xl border bg-muted/10 p-2 sm:grid-cols-2">
                  {products.map((product) => {
                    const id = String(product.id);
                    const checked = newGroup.product_ids.includes(id);

                    return (
                      <label key={id} className="flex items-center justify-between gap-2 rounded-xl border bg-background p-2.5 text-sm">
                        <span className="min-w-0 truncate font-semibold">{product.name}</span>
                        <Switch
                          checked={checked}
                          onCheckedChange={(value) =>
                            setNewGroup((current) => ({
                              ...current,
                              product_ids: value
                                ? Array.from(new Set([...current.product_ids, id]))
                                : current.product_ids.filter((productId) => productId !== id),
                            }))
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <Button onClick={createGroup} className="md:col-span-2"><Plus className="mr-2 size-4" /> Criar grupo de adicionais</Button>
          </div>

          {groups.map((group) => {
            const groupOptions = options.filter((o) => o.group_id === group.id);
            const linkedProducts = new Set(links.filter((l) => l.group_id === group.id).map((l) => String(l.product_id)));
            const draft = newOptionByGroup[group.id] || emptyOptionDraft();
            return (
              <div key={group.id} className="rounded-2xl border bg-background p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="min-w-[180px] flex-1 font-bold" value={group.name} onChange={(e) => setGroups((gs) => gs.map((g) => g.id === group.id ? { ...g, name: e.target.value } : g))} />
                  <label className="flex items-center gap-2 text-xs font-bold"><Switch checked={group.active !== false} onCheckedChange={(v) => setGroups((gs) => gs.map((g) => g.id === group.id ? { ...g, active: v } : g))} /> Ativo</label>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteGroup(group.id)}><Trash2 className="size-4" /></Button>
                </div>
                <div className="mt-3">
                  <Label className="text-[11px]">Descrição exibida no cardápio</Label>
                  <Input
                    className="mt-1"
                    value={group.description || ""}
                    onChange={(e) => setGroups((gs) => gs.map((g) => g.id === group.id ? { ...g, description: e.target.value } : g))}
                    placeholder="Ex.: escolha sua borda preferida"
                  />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div><Label className="text-[11px]">Mínimo</Label><Input type="number" min="0" value={group.min_select} onChange={(e) => setGroups((gs) => gs.map((g) => g.id === group.id ? { ...g, min_select: num(e.target.value) } : g))} /></div>
                  <div><Label className="text-[11px]">Máximo de unidades</Label><Input type="number" min="1" value={group.max_select} onChange={(e) => setGroups((gs) => gs.map((g) => g.id === group.id ? { ...g, max_select: num(e.target.value, 1) } : g))} /></div>
                  <div className="rounded-xl border p-3 sm:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black">Tipo do grupo</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {group.required ? "Obrigatório — precisa escolher." : "Opcional — pode ignorar."}
                        </p>
                      </div>
                      <Switch
                        checked={group.required === true}
                        onCheckedChange={(v) => setGroups((gs) => gs.map((g) => g.id === group.id ? { ...g, required: v, min_select: v ? Math.max(1, num(g.min_select)) : 0 } : g))}
                      />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-black ${group.required ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-500"}`}>OBRIGATÓRIO</span>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-black ${!group.required ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>OPCIONAL</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    className="rounded-xl px-5 font-black"
                    onClick={() => {
                      const current = groups.find((g) => g.id === group.id) || group;
                      void updateGroup(current, {});
                    }}
                  >
                    Salvar alterações do grupo
                  </Button>
                </div>

                <div className="mt-4 space-y-2">
                  <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Opções deste grupo</p>
                  {groupOptions.map((option) => {
                    const linkedProduct = option.linked_product_id
                      ? products.find((product) => String(product.id) === String(option.linked_product_id))
                      : null;
                    return (
                      <div key={option.id} className="rounded-xl border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-1 text-[10px] font-black ${linkedProduct ? "bg-sky-100 text-sky-800" : "bg-muted text-muted-foreground"}`}>
                            {linkedProduct ? "PRODUTO DO CARDÁPIO" : "ADICIONAL MANUAL"}
                          </span>
                          <span className="ml-auto flex items-center gap-2 text-xs font-bold">
                            Ativo <Switch checked={option.active !== false} onCheckedChange={(v) => setOptions((os) => os.map((o) => o.id === option.id ? { ...o, active: v } : o))} />
                          </span>
                          <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteOption(option.id)}><Trash2 className="size-4" /></Button>
                        </div>

                        {linkedProduct ? (
                          <div className="mt-3 grid gap-2 md:grid-cols-[1.2fr_1fr]">
                            <div className="rounded-xl border bg-muted/20 p-3">
                              <p className="text-xs text-muted-foreground">Produto associado</p>
                              <p className="font-black">{linkedProduct.name}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Preço atual: {brl(productCurrentPrice(linkedProduct))}
                              </p>
                            </div>
                            <div className="space-y-2">
                              <label className="flex items-center justify-between rounded-xl border p-3 text-xs font-bold">
                                Usar preço atual do produto
                                <Switch
                                  checked={option.use_linked_product_price === true}
                                  onCheckedChange={(value) => setOptions((os) => os.map((o) => o.id === option.id ? { ...o, use_linked_product_price: value } : o))}
                                />
                              </label>
                              {option.use_linked_product_price !== true && (
                                <div>
                                  <Label className="text-[11px]">Preço especial como adicional</Label>
                                  <Input
                                    className="mt-1"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={option.price}
                                    onChange={(e) => setOptions((os) => os.map((o) => o.id === option.id ? { ...o, price: e.target.value } : o))}
                                  />
                                </div>
                              )}
                            </div>
                            <div className="md:col-span-2">
                              <Label className="text-[11px]">Descrição no cardápio</Label>
                              <Input
                                className="mt-1"
                                value={option.description || ""}
                                onChange={(e) => setOptions((os) => os.map((o) => o.id === option.id ? { ...o, description: e.target.value } : o))}
                                placeholder="Descrição curta (opcional)"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_140px]">
                            <Input value={option.name} onChange={(e) => setOptions((os) => os.map((o) => o.id === option.id ? { ...o, name: e.target.value } : o))} placeholder="Nome" />
                            <Input value={option.description || ""} onChange={(e) => setOptions((os) => os.map((o) => o.id === option.id ? { ...o, description: e.target.value } : o))} placeholder="Descrição curta (opcional)" />
                            <Input type="number" step="0.01" min="0" value={option.price} onChange={(e) => setOptions((os) => os.map((o) => o.id === option.id ? { ...o, price: e.target.value } : o))} />
                          </div>
                        )}

                        <div className="mt-3 flex justify-end border-t pt-3">
                          <Button
                            type="button"
                            size="sm"
                            className="rounded-xl px-4 font-black"
                            onClick={() => {
                              const current = options.find((o) => o.id === option.id) || option;
                              void updateOption(current, {});
                            }}
                          >
                            Salvar alterações
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="rounded-2xl border bg-muted/10 p-3">
                    <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Criar nova opção</p>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setNewOptionByGroup((state) => ({ ...state, [group.id]: { ...draft, source: "manual", linked_product_id: "" } }))}
                        className={`rounded-xl border p-3 text-left ${draft.source === "manual" ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "bg-background"}`}
                      >
                        <p className="text-sm font-black">Adicional manual</p>
                        <p className="mt-1 text-xs text-muted-foreground">Ex.: bacon extra, borda, molho.</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setNewOptionByGroup((state) => ({ ...state, [group.id]: { ...draft, source: "product", name: "", price: "", use_linked_product_price: true } }))}
                        className={`rounded-xl border p-3 text-left ${draft.source === "product" ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "bg-background"}`}
                      >
                        <p className="text-sm font-black">Produto existente</p>
                        <p className="mt-1 text-xs text-muted-foreground">Ex.: refrigerante, sobremesa ou outro item já cadastrado.</p>
                      </button>
                    </div>

                    {draft.source === "product" ? (
                      <div className="mt-3 grid gap-2">
                        <div>
                          <Label>Produto que será oferecido como adicional</Label>
                          <Select
                            value={draft.linked_product_id || undefined}
                            onValueChange={(productId) => {
                              const product = products.find((item) => String(item.id) === productId);
                              setNewOptionByGroup((state) => ({
                                ...state,
                                [group.id]: {
                                  ...draft,
                                  linked_product_id: productId,
                                  description: draft.description || String(product?.description || ""),
                                  price: String(productCurrentPrice(product)),
                                },
                              }));
                            }}
                          >
                            <SelectTrigger className="mt-1"><SelectValue placeholder="Escolha um produto do cardápio" /></SelectTrigger>
                            <SelectContent>
                              {products.map((product) => (
                                <SelectItem key={product.id} value={String(product.id)}>
                                  {product.name} — {brl(productCurrentPrice(product))}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <label className="flex items-center justify-between rounded-xl border bg-background p-3 text-sm font-bold">
                          Usar automaticamente o preço atual do produto
                          <Switch
                            checked={draft.use_linked_product_price}
                            onCheckedChange={(value) => setNewOptionByGroup((state) => ({
                              ...state,
                              [group.id]: { ...draft, use_linked_product_price: value },
                            }))}
                          />
                        </label>

                        {!draft.use_linked_product_price && (
                          <div>
                            <Label>Preço especial quando vendido como adicional</Label>
                            <Input
                              className="mt-1"
                              value={draft.price}
                              onChange={(e) => setNewOptionByGroup((state) => ({ ...state, [group.id]: { ...draft, price: e.target.value } }))}
                              placeholder="0,00"
                              inputMode="decimal"
                            />
                          </div>
                        )}

                        <Input
                          value={draft.description}
                          onChange={(e) => setNewOptionByGroup((state) => ({ ...state, [group.id]: { ...draft, description: e.target.value } }))}
                          placeholder="Descrição curta no cardápio (opcional)"
                        />
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_120px]">
                        <Input value={draft.name} onChange={(e) => setNewOptionByGroup((state) => ({ ...state, [group.id]: { ...draft, name: e.target.value } }))} placeholder="Ex.: Borda de requeijão" />
                        <Input value={draft.description} onChange={(e) => setNewOptionByGroup((state) => ({ ...state, [group.id]: { ...draft, description: e.target.value } }))} placeholder="Descrição curta (opcional)" />
                        <Input value={draft.price} onChange={(e) => setNewOptionByGroup((state) => ({ ...state, [group.id]: { ...draft, price: e.target.value } }))} placeholder="Preço" inputMode="decimal" />
                      </div>
                    )}

                    <Button className="mt-3 w-full" onClick={() => addOption(group.id)}>
                      <Plus className="mr-1 size-4" /> Adicionar opção
                    </Button>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border bg-muted/20 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-black">Disponibilidade no cardápio</p>
                      <p className="text-xs text-muted-foreground">Todos os produtos ou somente os que você escolher.</p>
                    </div>

                    <Select
                      value={groupAvailability(group.id)}
                      onValueChange={(value) =>
                        changeGroupAvailability(group.id, value as "all" | "specific")
                      }
                    >
                      <SelectTrigger className="w-full sm:w-[220px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os produtos</SelectItem>
                        <SelectItem value="specific">Produtos específicos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {groupAvailability(group.id) === "all" ? (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
                      Este grupo está disponível em todos os {allProductIds.length} produtos ativos.
                    </div>
                  ) : (
                    <details className="mt-3 rounded-xl border bg-background p-3" open={linkedProducts.size === 0}>
                      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-black">
                        <span>Escolher produtos ({linkedProducts.size} selecionados)</span>
                        <ChevronDown className="size-4" />
                      </summary>

                      <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
                        {products.map((product) => (
                          <label key={product.id} className="flex items-center justify-between gap-2 rounded-xl border bg-background p-2.5 text-sm">
                            <span className="min-w-0 truncate font-semibold">{product.name}</span>
                            <Switch
                              checked={linkedProducts.has(String(product.id))}
                              onCheckedChange={(v) => toggleProductGroup(product.id, group.id, v)}
                            />
                          </label>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
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
