import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Pizza, GlassWater, Upload, AlertTriangle, Star, Tag, Ticket } from "lucide-react";
import { getEffectivePrice, isPromotionActive, PROMOTION_DAY_LABELS } from "@/lib/promotions";

export const Route = createFileRoute("/_authenticated/loja/produtos")({
  component: ProductsPage,
});

// ============ helpers de peso/quantidade — SEM digitação decimal ambígua ============
// Tudo de peso é guardado internamente em GRAMAS. O admin nunca precisa digitar
// "1,23" pensando em "1kg e 230g" — ele digita 1 no campo Kg e 230 no campo g.
function splitGrams(totalGrams: number) {
  const kg = Math.floor((totalGrams || 0) / 1000);
  const g = Math.round((totalGrams || 0) % 1000);
  return { kg, g };
}
function joinGrams(kg: number, g: number) {
  return Math.max(0, Math.round(kg || 0)) * 1000 + Math.max(0, Math.round(g || 0));
}

function WeightOrCountInput({
  isWeight,
  grams,
  onChange,
}: {
  isWeight: boolean;
  grams: number;
  onChange: (grams: number) => void;
  small?: boolean;
}) {
  if (!isWeight) {
    return (
      <Input
        type="number"
        step="1"
        min="0"
        value={grams}
        onChange={(e) => onChange(Number(e.target.value))}
        placeholder="unidades"
      />
    );
  }
  const { kg, g } = splitGrams(grams);
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <Input
          type="number"
          min="0"
          step="1"
          value={kg}
          onChange={(e) => onChange(joinGrams(Number(e.target.value), g))}
          placeholder="0"
        />
        <p className="mt-0.5 text-[10px] font-semibold text-muted-foreground">quilos (kg)</p>
      </div>
      <div className="flex-1">
        <Input
          type="number"
          min="0"
          max="999"
          step="1"
          value={g}
          onChange={(e) => onChange(joinGrams(kg, Number(e.target.value)))}
          placeholder="0"
        />
        <p className="mt-0.5 text-[10px] font-semibold text-muted-foreground">gramas (g)</p>
      </div>
    </div>
  );
}

function ProfitBadge({ salePrice, costPrice }: { salePrice: number; costPrice: number }) {
  const sale = Number(salePrice) || 0;
  const cost = Number(costPrice) || 0;
  if (sale <= 0) return null;
  if (cost <= 0) {
    return (
      <p className="mt-1.5 text-[11px] font-semibold text-amber-600">
        ⚠ Custo não cadastrado — lucro real desconhecido
      </p>
    );
  }
  // Markup: quanto o lucro representa em cima do custo (lucro ÷ custo).
  // Ex.: custo R$10, venda R$20 → lucro R$10 ÷ custo R$10 = 100%.
  const markupPercent = ((sale - cost) / cost) * 100;
  const healthy = markupPercent >= 43; // equivale a ~30% de margem sobre a venda
  const colorClass = healthy ? "text-emerald-600" : markupPercent >= 0 ? "text-amber-600" : "text-destructive";
  return (
    <div className="mt-1.5 space-y-0.5 text-[11px] font-bold leading-tight">
      <p className="text-muted-foreground">
        Custo: <span className="font-semibold text-foreground">{brl(cost)}</span>
      </p>
      <p className={colorClass}>Lucro: {markupPercent.toFixed(1)}% sobre o custo</p>
      <p className={colorClass}>Valor do lucro: {brl(sale - cost)}</p>
    </div>
  );
}

function PriceWithPromo({ product }: { product: any }) {
  const { price, listPrice, isPromotion } = getEffectivePrice(product);
  if (!isPromotion) return <span className="text-lg font-black text-primary">{brl(listPrice)}</span>;
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground line-through">{brl(listPrice)}</span>
      <span className="text-lg font-black text-fuchsia-600">{brl(price)}</span>
    </span>
  );
}

function ProductsPage() {
  const [tab, setTab] = useState<"recipe" | "beverage" | "ingredients">("recipe");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Cardápio & Insumos</h1>
      <div className="flex gap-2 border-b">
        <button
          className={`px-3 py-2 text-sm font-medium ${tab === "recipe" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
          onClick={() => setTab("recipe")}
        >
          <Pizza className="mr-1 inline size-4" /> Pizzas & Lanches
        </button>
        <button
          className={`px-3 py-2 text-sm font-medium ${tab === "beverage" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
          onClick={() => setTab("beverage")}
        >
          <GlassWater className="mr-1 inline size-4" /> Bebidas
        </button>
        <button
          className={`px-3 py-2 text-sm font-medium ${tab === "ingredients" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
          onClick={() => setTab("ingredients")}
        >
          🥫 Insumos
        </button>
      </div>
      {tab !== "ingredients" ? <ProductList kind={tab} /> : <IngredientList />}
    </div>
  );
}

function ProductList({ kind }: { kind: "recipe" | "beverage" }) {
  const [rows, setRows] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");
  const [editing, setEditing] = useState<any | null>(null);
  const load = () =>
    supabase
      .from("products")
      .select("*")
      .eq("kind", kind)
      .order("category")
      .order("name")
      .then(({ data }) => setRows(data ?? []));
  useEffect(() => {
    load();
  }, [kind]);

  async function del(id: string) {
    if (!confirm("Excluir produto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Excluído");
      load();
    }
  }

  async function toggleActive(p: any, active: boolean) {
    const { error } = await supabase.from("products").update({ active }).eq("id", p.id);
    if (error) toast.error(error.message);
    else load();
  }

  async function toggleFeatured(p: any) {
    const { error } = await supabase.from("products").update({ featured: !p.featured }).eq("id", p.id);
    if (error) toast.error(error.message);
    else load();
  }

  const visibleRows = rows.filter((p) =>
    statusFilter === "all" ? true : statusFilter === "active" ? p.active : !p.active,
  );

  return (
    <div className="space-y-3">
      <Button
        onClick={() => setEditing({ kind, active: true, sale_price: 0, cost_price: 0 })}
        className="rounded-full font-semibold shadow-sm"
      >
        <Plus className="size-4" /> Novo {kind === "recipe" ? "produto" : "bebida"}
      </Button>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["active", "Ativos"],
            ["inactive", "Inativos"],
            ["all", "Todos"],
          ] as const
        ).map(([v, label]) => {
          const count =
            v === "all" ? rows.length : rows.filter((p) => (v === "active" ? p.active : !p.active)).length;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setStatusFilter(v)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                statusFilter === v
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {visibleRows.map((p) => (
          <Card key={p.id} className="flex gap-3 overflow-hidden rounded-2xl p-3 shadow-sm">
            {p.image_url ? (
              <img src={p.image_url} alt={p.name} className="size-24 shrink-0 rounded-xl object-cover" />
            ) : (
              <div className="grid size-24 shrink-0 place-items-center rounded-xl bg-muted text-[10px] text-muted-foreground">
                Sem foto
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[15px] font-extrabold uppercase leading-snug tracking-wide">{p.name}</h3>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`size-7 ${p.featured ? "text-amber-500" : "text-muted-foreground"}`}
                    onClick={() => toggleFeatured(p)}
                    title="Destaque na loja"
                  >
                    <Star className="size-3.5" fill={p.featured ? "currentColor" : "none"} />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditing(p)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive hover:text-destructive"
                    onClick={() => del(p.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
              <div className="mt-2 flex items-center justify-between">
                <PriceWithPromo product={p} />
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={p.active}
                    onChange={(e) => toggleActive(p, e.target.checked)}
                    className="size-3.5 accent-primary"
                  />{" "}
                  Ativo
                </label>
              </div>
              {p.promotion_active && (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-fuchsia-600">
                  <Tag className="size-3" />
                  {isPromotionActive(p) ? "Promoção ativa agora" : "Promoção configurada (fora do horário/período)"}
                </p>
              )}
              <ProfitBadge
                salePrice={getEffectivePrice(p).price}
                costPrice={p.cost_price}
              />
            </div>
          </Card>
        ))}
      </div>
      {editing && (
        <ProductForm
          value={editing}
          onClose={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ProductForm({ value, onClose }: { value: any; onClose: () => void }) {
  const [f, setF] = useState<any>({
    needs_preparation: true,
    is_combo: false,
    ...value,
  });
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [recipeItems, setRecipeItems] = useState<any[]>([]);
  const [comboItems, setComboItems] = useState<any[]>(value.combo_items ?? []);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const isRecipe = f.kind === "recipe";
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [customerIngredientInput, setCustomerIngredientInput] = useState("");
  const [bulkCustomerIngredients, setBulkCustomerIngredients] = useState("");

  const customerIngredientList = String(f.customer_ingredients || "")
    .split(/[,;\n]+/)
    .map((v) => v.trim())
    .filter(Boolean);

  function setCustomerIngredientList(list: string[]) {
    const seen = new Set<string>();
    const clean = list
      .map((v) => v.trim())
      .filter(Boolean)
      .filter((v) => {
        const key = v.toLocaleLowerCase("pt-BR");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    setF((prev: any) => ({ ...prev, customer_ingredients: clean.join(", ") }));
  }

  function addCustomerIngredient() {
    const value = customerIngredientInput.trim();
    if (!value) return;
    setCustomerIngredientList([...customerIngredientList, value]);
    setCustomerIngredientInput("");
  }

  function removeCustomerIngredient(index: number) {
    setCustomerIngredientList(customerIngredientList.filter((_, i) => i !== index));
  }

  function importCustomerIngredients() {
    const imported = bulkCustomerIngredients
      .split(/[,;\n]+/)
      .map((v) => v.replace(/^[\s•▪▫*\-–—]+/, "").trim())
      .filter(Boolean);
    if (!imported.length) return toast.error("Cole pelo menos um ingrediente");
    setCustomerIngredientList([...customerIngredientList, ...imported]);
    setBulkCustomerIngredients("");
    toast.success(`${imported.length} ingrediente(s) importado(s)`);
  }

  async function loadCategories() {
    const { data } = await supabase.from("product_categories").select("name").order("sort_order").order("name");
    setCategories((data ?? []).map((c: any) => c.name));
  }

  useEffect(() => {
    loadCategories();
    supabase
      .from("ingredients")
      .select("*")
      .order("name")
      .then(({ data }) => setIngredients(data ?? []));
    supabase
      .from("products")
      .select("id,name,sale_price,kind")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setAllProducts(data ?? []));
    if (f.id && isRecipe)
      supabase
        .from("recipe_items")
        .select("*")
        .eq("product_id", f.id)
        .then(({ data }) => setRecipeItems(data ?? []));
    if (f.id && f.is_combo)
      supabase
        .from("combo_items")
        .select("*")
        .eq("product_id", f.id)
        .then(({ data }) => setComboItems(data ?? []));
  }, [f.id, isRecipe]);

  async function saveNewCategory() {
    if (!newCategory.trim()) return;
    const { error } = await supabase.from("product_categories").insert({ name: newCategory.trim() });
    if (error) {
      toast.error(error.message);
      return;
    }
    setF({ ...f, category: newCategory.trim() });
    setNewCategory("");
    setAddingCategory(false);
    await loadCategories();
  }

  const computedCost = isRecipe
    ? recipeItems.reduce((s, ri) => {
        const ing = ingredients.find((i) => i.id === ri.ingredient_id);
        if (!ing || !Number(ing.purchase_quantity)) return s;
        const costPerBase = Number(ing.purchase_price || 0) / Number(ing.purchase_quantity);
        return s + Number(ri.quantity || 0) * costPerBase;
      }, 0)
    : Number(f.cost_price || 0);

  async function uploadImage(file: File) {
    setUploadingImage(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
      setF({ ...f, image_url: pub.publicUrl });
      toast.success("Imagem enviada");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao enviar imagem");
    } finally {
      setUploadingImage(false);
    }
  }

  async function save() {
    const payload = {
      name: f.name,
      description: f.description,
      customer_ingredients: (f.customer_ingredients || "").trim() || null,
      category: f.category,
      kind: f.kind,
      sale_price: Number(f.sale_price),
      cost_price: computedCost,
      image_url: f.image_url || null,
      active: f.active,
      needs_preparation: f.needs_preparation !== false, // default true
      is_combo: !!f.is_combo,
      promotion_active: !!f.promotion_active,
      promotion_price: f.promotion_active ? Number(f.promotion_price || 0) : null,
      promotion_type: f.promotion_type || "period",
      promotion_start_at: f.promotion_type === "period" && f.promotion_start_at ? f.promotion_start_at : null,
      promotion_end_at: f.promotion_type === "period" && f.promotion_end_at ? f.promotion_end_at : null,
      promotion_days_of_week: f.promotion_type === "recurring" ? f.promotion_days_of_week || null : null,
      promotion_time_start: f.promotion_type === "recurring" ? f.promotion_time_start || null : null,
      promotion_time_end: f.promotion_type === "recurring" ? f.promotion_time_end || null : null,
      promotion_label: f.promotion_active ? f.promotion_label || null : null,
    };
    if (!payload.name) return toast.error("Informe o nome do produto");
    if (payload.promotion_active && (!payload.promotion_price || payload.promotion_price <= 0))
      return toast.error("Informe o preço promocional");
    if (payload.promotion_active && Number(payload.promotion_price ?? 0) >= Number(payload.sale_price))
      return toast.error("O preço promocional deve ser menor que o preço normal");
    let productId = f.id;
    if (f.id) {
      const { error } = await supabase.from("products").update(payload).eq("id", f.id);
      if (error) return toast.error(error.message);
      if (isRecipe) {
        await supabase.from("recipe_items").delete().eq("product_id", f.id);
        if (recipeItems.length)
          await supabase.from("recipe_items").insert(
            recipeItems.map((r) => ({
              product_id: f.id,
              ingredient_id: r.ingredient_id,
              quantity: Number(r.quantity),
              unit: r.unit || "g",
            })),
          );
      }
    } else {
      const { data, error } = await supabase.from("products").insert(payload).select().single();
      if (error) return toast.error(error.message);
      productId = data.id;
      if (isRecipe && recipeItems.length)
        await supabase.from("recipe_items").insert(
          recipeItems.map((r) => ({
            product_id: productId,
            ingredient_id: r.ingredient_id,
            quantity: Number(r.quantity),
            unit: r.unit || "g",
          })),
        );
    }
    // salva itens do combo
    if (f.is_combo && productId) {
      await supabase.from("combo_items").delete().eq("product_id", productId);
      if (comboItems.length) {
        await supabase.from("combo_items").insert(
          comboItems
            .filter((c) => c.included_product_id)
            .map((c) => ({
              product_id: productId,
              included_product_id: c.included_product_id,
              quantity: Number(c.quantity || 1),
            })),
        );
      }
    }
    toast.success("Salvo");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{f.id ? "Editar" : "Novo"} produto</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={f.name || ""} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="rounded-xl border-2 border-primary/60 bg-primary/5 p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <Label className="text-base font-bold text-primary">Ingredientes do produto</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cadastre aqui os ingredientes que a IA pode informar ao cliente quando ele perguntar o que vem neste produto.
                </p>
              </div>
              <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground">IA / CLIENTE</span>
            </div>

            <div className="flex gap-2">
              <Input
                value={customerIngredientInput}
                onChange={(e) => setCustomerIngredientInput(e.target.value)}
                placeholder="Ex.: Costela desfiada"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomerIngredient();
                  }
                }}
              />
              <Button type="button" onClick={addCustomerIngredient} className="shrink-0 gap-1">
                <Plus className="size-4" /> Adicionar
              </Button>
            </div>

            {customerIngredientList.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {customerIngredientList.map((ingredient, index) => (
                  <div key={`${ingredient}-${index}`} className="flex items-center gap-1 rounded-full border bg-background px-3 py-1.5 text-sm">
                    <span>{ingredient}</span>
                    <button
                      type="button"
                      className="ml-1 text-muted-foreground hover:text-destructive"
                      onClick={() => removeCustomerIngredient(index)}
                      title="Remover ingrediente"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-md border border-dashed bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                Nenhum ingrediente cadastrado neste produto.
              </p>
            )}

            <div className="mt-4 rounded-lg border bg-background p-3">
              <Label className="font-semibold">Cadastrar vários ingredientes de uma vez</Label>
              <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
                Cole um bloco de texto. Pode ser um ingrediente por linha, separado por vírgula ou ponto e vírgula.
              </p>
              <Textarea
                rows={5}
                value={bulkCustomerIngredients}
                onChange={(e) => setBulkCustomerIngredients(e.target.value)}
                placeholder={"Batata\nRequeijão\nCostela desfiada\nMussarela\nBorda com requeijão"}
              />
              <div className="mt-2 flex justify-end">
                <Button type="button" variant="secondary" onClick={importCustomerIngredients}>
                  Importar ingredientes
                </Button>
              </div>
            </div>
          </div>

          <div>
            <Label>Descrição</Label>
            <Textarea
              rows={2}
              value={f.description || ""}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Categoria</Label>
              {addingCategory ? (
                <div className="flex gap-1.5">
                  <Input
                    autoFocus
                    placeholder="Nome da categoria"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveNewCategory();
                      if (e.key === "Escape") setAddingCategory(false);
                    }}
                  />
                  <Button size="sm" onClick={saveNewCategory}>
                    OK
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAddingCategory(false)}>
                    ×
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <Select
                    value={f.category || ""}
                    onValueChange={(v) => {
                      if (v === "__new__") {
                        setAddingCategory(true);
                      } else {
                        setF({ ...f, category: v });
                      }
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                      <SelectItem value="__new__" className="font-semibold text-primary">
                        + Nova categoria
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div>
              <Label>Preço venda (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={f.sale_price}
                onChange={(e) => setF({ ...f, sale_price: e.target.value })}
              />
            </div>
          </div>
          {!isRecipe && (
            <div>
              <Label>Preço de custo (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={f.cost_price}
                onChange={(e) => setF({ ...f, cost_price: e.target.value })}
              />
            </div>
          )}

          <div>
            <Label>Imagem do produto</Label>
            <div className="flex gap-2">
              <Input
                className="flex-1"
                value={f.image_url || ""}
                onChange={(e) => setF({ ...f, image_url: e.target.value })}
                placeholder="Cole uma URL ou envie um arquivo →"
              />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadImage(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => imageInputRef.current?.click()}
                disabled={uploadingImage}
              >
                <Upload className="size-4" /> {uploadingImage ? "Enviando..." : "Upload"}
              </Button>
            </div>
            {f.image_url && (
              <img src={f.image_url} alt="Prévia" className="mt-2 h-24 w-24 rounded-lg border object-cover" />
            )}
          </div>

          {/* flags de comportamento */}
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-semibold">Configurações do produto</p>
            <label className="flex cursor-pointer items-center gap-2">
              <Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} />
              <span className="text-sm">Ativo (visível na loja)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <Switch
                checked={f.needs_preparation !== false}
                onCheckedChange={(v) => setF({ ...f, needs_preparation: v })}
              />
              <div>
                <span className="text-sm">Precisa de preparo</span>
                <p className="text-[11px] text-muted-foreground">
                  Desative para bebidas, águas e refrigerantes — pedidos de retirada só com esses itens vão direto para
                  "Aguardando Retirada" sem passar pela cozinha
                </p>
              </div>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <Switch checked={!!f.is_combo} onCheckedChange={(v) => setF({ ...f, is_combo: v })} />
              <div>
                <span className="text-sm">É um combo</span>
                <p className="text-[11px] text-muted-foreground">
                  Ative para montar este produto como combinação de outros itens do cardápio
                </p>
              </div>
            </label>
          </div>

          {/* promoção */}
          <div className="space-y-3 rounded-lg border border-fuchsia-200 bg-fuchsia-50 p-3">
            <label className="flex cursor-pointer items-center gap-2">
              <Switch
                checked={!!f.promotion_active}
                onCheckedChange={(v) =>
                  setF({
                    ...f,
                    promotion_active: v,
                    promotion_type: f.promotion_type || "period",
                    promotion_price: f.promotion_price ?? f.sale_price,
                  })
                }
              />
              <div>
                <span className="flex items-center gap-1 text-sm font-semibold text-fuchsia-800">
                  <Tag className="size-3.5" /> É uma promoção
                </span>
                <p className="text-[11px] text-fuchsia-700/80">
                  Vale para produto avulso ou combo. O preço promocional pode ser editado a qualquer momento, mesmo
                  com a promoção ligada.
                </p>
              </div>
            </label>

            {f.promotion_active && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Preço promocional (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={f.promotion_price ?? ""}
                      onChange={(e) => setF({ ...f, promotion_price: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Rótulo (opcional)</Label>
                    <Input
                      placeholder="Ex: Combo da Semana"
                      value={f.promotion_label || ""}
                      onChange={(e) => setF({ ...f, promotion_label: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Tipo de promoção</Label>
                  <Select
                    value={f.promotion_type || "period"}
                    onValueChange={(v) => setF({ ...f, promotion_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="period">Período fixo (data/hora início e fim)</SelectItem>
                      <SelectItem value="recurring">Recorrente (dias da semana + horário)</SelectItem>
                      <SelectItem value="always">Sempre ativa (enquanto o interruptor estiver ligado)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {f.promotion_type === "period" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Início</Label>
                      <Input
                        type="datetime-local"
                        value={f.promotion_start_at ? f.promotion_start_at.slice(0, 16) : ""}
                        onChange={(e) =>
                          setF({ ...f, promotion_start_at: e.target.value ? new Date(e.target.value).toISOString() : "" })
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Fim</Label>
                      <Input
                        type="datetime-local"
                        value={f.promotion_end_at ? f.promotion_end_at.slice(0, 16) : ""}
                        onChange={(e) =>
                          setF({ ...f, promotion_end_at: e.target.value ? new Date(e.target.value).toISOString() : "" })
                        }
                      />
                    </div>
                  </div>
                )}

                {f.promotion_type === "recurring" && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">Dias da semana (nenhum marcado = todos os dias)</Label>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {PROMOTION_DAY_LABELS.map((label, idx) => {
                          const days: number[] = f.promotion_days_of_week || [];
                          const checked = days.includes(idx);
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() =>
                                setF({
                                  ...f,
                                  promotion_days_of_week: checked
                                    ? days.filter((d) => d !== idx)
                                    : [...days, idx].sort(),
                                })
                              }
                              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                checked
                                  ? "border-fuchsia-500 bg-fuchsia-500 text-white"
                                  : "border-fuchsia-300 text-fuchsia-700"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Horário início</Label>
                        <Input
                          type="time"
                          value={f.promotion_time_start || ""}
                          onChange={(e) => setF({ ...f, promotion_time_start: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Horário fim</Label>
                        <Input
                          type="time"
                          value={f.promotion_time_end || ""}
                          onChange={(e) => setF({ ...f, promotion_time_end: e.target.value })}
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-fuchsia-700/80">
                      Deixe os horários em branco para valer o dia todo nos dias marcados.
                    </p>
                  </div>
                )}

                {f.promotion_type === "always" && (
                  <p className="text-[11px] text-fuchsia-700/80">
                    Fica ativa continuamente enquanto o interruptor "É uma promoção" estiver ligado — sem data/hora
                    de início ou fim.
                  </p>
                )}
              </>
            )}
          </div>

          {/* itens do combo */}
          {f.is_combo && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-violet-800">Itens do combo</Label>
                <span className="text-[11px] text-violet-600">{comboItems.length} item(s)</span>
              </div>
              {comboItems.map((c, idx) => (
                <div key={idx} className="mb-2 flex items-center gap-2">
                  <Select
                    value={c.included_product_id || ""}
                    onValueChange={(v) =>
                      setComboItems(comboItems.map((x, i) => (i === idx ? { ...x, included_product_id: v } : x)))
                    }
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Selecione o produto" />
                    </SelectTrigger>
                    <SelectContent>
                      {allProducts
                        .filter((p) => p.id !== f.id)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    className="w-16"
                    placeholder="Qtd"
                    value={c.quantity || 1}
                    onChange={(e) =>
                      setComboItems(
                        comboItems.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) } : x)),
                      )
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setComboItems(comboItems.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="border-violet-300 text-violet-700"
                onClick={() => setComboItems([...comboItems, { included_product_id: "", quantity: 1 }])}
              >
                <Plus className="size-3" /> Adicionar item ao combo
              </Button>
            </div>
          )}

          {isRecipe && (
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between">
                <Label>Ficha técnica</Label>
                <span className="text-xs text-muted-foreground">
                  Custo calculado: <b>{brl(computedCost)}</b>
                </span>
              </div>
              {recipeItems.map((r, idx) => {
                const ing = ingredients.find((i) => i.id === r.ingredient_id);
                const isWeight = ing?.unit === "g";
                return (
                  <div key={idx} className="mb-2 space-y-1.5 rounded-md border p-2">
                    <div className="flex gap-2">
                      <Select
                        value={r.ingredient_id}
                        onValueChange={(v) => {
                          const newIng = ingredients.find((i) => i.id === v);
                          setRecipeItems(
                            recipeItems.map((x, i) =>
                              i === idx
                                ? { ...x, ingredient_id: v, unit: newIng?.unit === "un" ? "un" : "g", quantity: 0 }
                                : x,
                            ),
                          );
                        }}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Insumo" />
                        </SelectTrigger>
                        <SelectContent>
                          {ingredients.map((i) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setRecipeItems(recipeItems.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] text-muted-foreground">
                        Quantidade usada nesta receita {isWeight ? "" : "(unidades)"}
                      </p>
                      <WeightOrCountInput
                        isWeight={isWeight}
                        grams={Number(r.quantity || 0)}
                        onChange={(v) =>
                          setRecipeItems(recipeItems.map((x, i) => (i === idx ? { ...x, quantity: v } : x)))
                        }
                        small
                      />
                    </div>
                  </div>
                );
              })}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setRecipeItems([
                    ...recipeItems,
                    {
                      ingredient_id: ingredients[0]?.id,
                      quantity: 0,
                      unit: ingredients[0]?.unit === "un" ? "un" : "g",
                    },
                  ])
                }
              >
                <Plus className="size-3" /> Insumo
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IngredientList() {
  const [rows, setRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const load = () =>
    supabase
      .from("ingredients")
      .select("*")
      .order("name")
      .then(({ data }) => setRows(data ?? []));
  useEffect(() => {
    load();
  }, []);

  async function toggleTrackStock(r: any, track: boolean) {
    const { error } = await supabase.from("ingredients").update({ track_stock: track }).eq("id", r.id);
    if (error) toast.error(error.message);
    else load();
  }

  async function del(id: string) {
    if (!confirm("Excluir?")) return;
    const { error } = await supabase.from("ingredients").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Excluído");
      load();
    }
  }

  const lowStock = rows.filter(
    (r) =>
      r.track_stock && Number(r.stock_quantity) <= Number(r.low_stock_threshold) && Number(r.low_stock_threshold) > 0,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button
          onClick={() =>
            setEditing({
              unit: "un",
              purchase_quantity: 1,
              track_stock: false,
              stock_quantity: 0,
              low_stock_threshold: 0,
            })
          }
        >
          <Plus className="size-4" /> Novo insumo
        </Button>
      </div>

      {lowStock.length > 0 && (
        <Card className="border-2 border-destructive bg-destructive/5 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4" /> {lowStock.length} insumo(s) com estoque baixo
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{lowStock.map((r) => r.name).join(", ")}</p>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="p-2">Nome</th>
              <th className="p-2">Unidade</th>
              <th className="p-2 text-right">Preço pago</th>
              <th className="p-2 text-right">Qtd comprada</th>
              <th className="p-2 text-right">Custo/base</th>
              <th className="p-2 text-right">Estoque</th>
              <th className="p-2">Alerta</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isWeight = r.unit === "g";
              const low =
                r.track_stock &&
                Number(r.stock_quantity) <= Number(r.low_stock_threshold) &&
                Number(r.low_stock_threshold) > 0;
              return (
                <tr key={r.id} className={`border-t ${low ? "bg-destructive/5" : ""}`}>
                  <td className="p-2 font-medium">
                    {r.name}
                    {low && <AlertTriangle className="ml-1 inline size-3.5 text-destructive" />}
                  </td>
                  <td className="p-2">{isWeight ? "Peso (g/kg)" : "Unidade"}</td>
                  <td className="p-2 text-right">{brl(r.purchase_price)}</td>
                  <td className="p-2 text-right">
                    {isWeight ? `${(Number(r.purchase_quantity) / 1000).toFixed(3)} kg` : `${r.purchase_quantity} un`}
                  </td>
                  <td className="p-2 text-right">
                    {brl(Number(r.purchase_price) / Number(r.purchase_quantity || 1))}
                    {isWeight ? "/g" : "/un"}
                  </td>
                  <td className="p-2 text-right">
                    {r.track_stock
                      ? isWeight
                        ? `${(Number(r.stock_quantity) / 1000).toFixed(3)} kg`
                        : `${r.stock_quantity} un`
                      : "—"}
                  </td>
                  <td className="p-2">
                    <Switch checked={r.track_stock} onCheckedChange={(v) => toggleTrackStock(r, v)} />
                  </td>
                  <td className="p-2 text-right">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(r)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => del(r.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
                  Nenhum insumo
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {editing && (
        <IngredientForm
          value={editing}
          onClose={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function IngredientForm({ value, onClose }: { value: any; onClose: () => void }) {
  const [editing, setEditing] = useState<any>(value);
  const isWeight = editing.unit !== "un";

  async function save() {
    const payload = {
      code: editing.code || null,
      name: editing.name,
      unit: isWeight ? "g" : "un",
      purchase_price: Number(editing.purchase_price || 0),
      purchase_quantity: Number(editing.purchase_quantity || 1),
      track_stock: !!editing.track_stock,
      stock_quantity: Number(editing.stock_quantity || 0),
      low_stock_threshold: Number(editing.low_stock_threshold || 0),
    };
    if (!payload.name) return toast.error("Informe o nome do insumo");
    if (!payload.purchase_quantity) return toast.error("Informe a quantidade comprada");
    if (editing.id) {
      const { error } = await supabase.from("ingredients").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("ingredients").insert(payload);
      if (error) return toast.error(error.message);
    }
    toast.success("Salvo");
    onClose();
  }

  const costPreview =
    Number(editing.purchase_quantity) > 0 ? Number(editing.purchase_price || 0) / Number(editing.purchase_quantity) : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing.id ? "Editar" : "Novo"} insumo</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Código</Label>
              <Input value={editing.code || ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select
                value={isWeight ? "peso" : "un"}
                onValueChange={(v) =>
                  setEditing({
                    ...editing,
                    unit: v === "peso" ? "g" : "un",
                    purchase_quantity: 0,
                    stock_quantity: 0,
                    low_stock_threshold: 0,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="peso">Peso (kg / g)</SelectItem>
                  <SelectItem value="un">Unidade (un)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Nome</Label>
            <Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>

          <div className="rounded-lg border p-3">
            <p className="mb-2 text-sm font-semibold">Compra</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Preço pago (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editing.purchase_price ?? 0}
                  onChange={(e) => setEditing({ ...editing, purchase_price: e.target.value })}
                />
              </div>
              <div>
                <Label>Quantidade comprada</Label>
                <WeightOrCountInput
                  isWeight={isWeight}
                  grams={Number(editing.purchase_quantity || 0)}
                  onChange={(v) => setEditing({ ...editing, purchase_quantity: v })}
                  small
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Ex.: pagou R$ 43,00 em 1kg e 230g → digite <b>1</b> no campo kg e <b>230</b> no campo gramas. Custo
              calculado:{" "}
              <b className="text-foreground">
                {brl(costPreview)}
                {isWeight ? "/g" : "/un"}
              </b>
            </p>
          </div>

          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">Controle de estoque</p>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!editing.track_stock}
                  onCheckedChange={(v) => setEditing({ ...editing, track_stock: v })}
                />
                <Label className="text-xs">Controlar</Label>
              </div>
            </div>
            {editing.track_stock && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Estoque atual</Label>
                  <WeightOrCountInput
                    isWeight={isWeight}
                    grams={Number(editing.stock_quantity || 0)}
                    onChange={(v) => setEditing({ ...editing, stock_quantity: v })}
                    small
                  />
                </div>
                <div>
                  <Label className="text-xs">Alertar quando for menor que</Label>
                  <WeightOrCountInput
                    isWeight={isWeight}
                    grams={Number(editing.low_stock_threshold || 0)}
                    onChange={(v) => setEditing({ ...editing, low_stock_threshold: v })}
                    small
                  />
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              O estoque é descontado automaticamente pela ficha técnica sempre que a loja aceita um pedido (status "Em
              preparação").
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
