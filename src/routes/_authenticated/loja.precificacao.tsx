import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/formatters";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Info, Sparkles, Save, Calculator } from "lucide-react";

export const Route = createFileRoute("/_authenticated/loja/precificacao")({
  component: PrecificacaoPage,
});

// ============ ajuda de conversão kg/g — insumo pode ser cadastrado em kg ou g ============
function splitGrams(totalGrams: number) {
  return { kg: Math.floor(totalGrams / 1000), g: Math.round(totalGrams % 1000) };
}
function joinGrams(kg: number, g: number) {
  return (kg || 0) * 1000 + (g || 0);
}

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="inline-flex align-middle text-muted-foreground hover:text-foreground">
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-xs leading-relaxed">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function QuantityInput({
  isWeight,
  grams,
  onChange,
}: {
  isWeight: boolean;
  grams: number;
  onChange: (g: number) => void;
}) {
  if (!isWeight) {
    return (
      <Input
        type="number"
        min="0"
        step="1"
        value={grams}
        onChange={(e) => onChange(Number(e.target.value))}
        placeholder="unidades"
        className="w-24"
      />
    );
  }
  const { kg, g } = splitGrams(grams);
  return (
    <div className="flex gap-1.5">
      <div className="w-16">
        <Input
          type="number"
          min="0"
          step="1"
          value={kg}
          onChange={(e) => onChange(joinGrams(Number(e.target.value), g))}
          placeholder="0"
        />
        <p className="mt-0.5 text-center text-[9px] font-semibold text-muted-foreground">kg</p>
      </div>
      <div className="w-16">
        <Input
          type="number"
          min="0"
          max="999"
          step="1"
          value={g}
          onChange={(e) => onChange(joinGrams(kg, Number(e.target.value)))}
          placeholder="0"
        />
        <p className="mt-0.5 text-center text-[9px] font-semibold text-muted-foreground">g</p>
      </div>
    </div>
  );
}

type Ingredient = { id: string; name: string; unit: string; purchase_price: number; purchase_quantity: number };
type Product = {
  id: string;
  name: string;
  cost_price: number;
  sale_price: number;
  target_margin_percent: number | null;
};
type RecipeRow = { ingredient_id: string; quantity: number; unit: string };

function PrecificacaoPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [recipeItems, setRecipeItems] = useState<RecipeRow[]>([]);
  const [operationalCost, setOperationalCost] = useState(0);
  const [marginPercent, setMarginPercent] = useState(30);
  const [feesPercent, setFeesPercent] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("products")
      .select("id,name,cost_price,sale_price,target_margin_percent")
      .eq("kind", "recipe")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setProducts((data as Product[]) ?? []));
    supabase
      .from("ingredients")
      .select("id,name,unit,purchase_price,purchase_quantity")
      .order("name")
      .then(({ data }) => setIngredients((data as Ingredient[]) ?? []));
  }, []);

  useEffect(() => {
    if (!selectedProductId) {
      setRecipeItems([]);
      return;
    }
    supabase
      .from("recipe_items")
      .select("ingredient_id,quantity,unit")
      .eq("product_id", selectedProductId)
      .then(({ data }) =>
        setRecipeItems(
          (data ?? []).map((r: any) => ({
            ingredient_id: r.ingredient_id,
            quantity: Number(r.quantity),
            unit: r.unit || "g",
          })),
        ),
      );
    const p = products.find((x) => x.id === selectedProductId);
    setMarginPercent(p?.target_margin_percent != null ? Number(p.target_margin_percent) : 30);
  }, [selectedProductId, products]);

  const ingredientById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  function costPerUnitOf(ing: Ingredient): number {
    // custo por grama (se comprado em kg/g) ou por unidade (se 'un')
    const purchaseInBaseUnit = ing.unit === "kg" ? ing.purchase_quantity * 1000 : ing.purchase_quantity;
    return purchaseInBaseUnit > 0 ? ing.purchase_price / purchaseInBaseUnit : 0;
  }

  const lineCosts = recipeItems.map((row) => {
    const ing = ingredientById.get(row.ingredient_id);
    if (!ing) return 0;
    return row.quantity * costPerUnitOf(ing);
  });

  const ingredientsCost = lineCosts.reduce((s, v) => s + v, 0);
  const totalBeforeMargin = ingredientsCost + operationalCost;
  const marginMultiplier = 1 + marginPercent / 100;
  const feesDivisor = 1 - feesPercent / 100;
  const suggestedPrice =
    feesDivisor > 0 ? (totalBeforeMargin * marginMultiplier) / feesDivisor : totalBeforeMargin * marginMultiplier;

  function addRow() {
    if (!ingredients.length) return toast.error("Cadastre insumos primeiro em Produtos → Insumos");
    setRecipeItems((prev) => [
      ...prev,
      { ingredient_id: ingredients[0].id, quantity: 0, unit: ingredients[0].unit === "kg" ? "g" : ingredients[0].unit },
    ]);
  }
  function removeRow(idx: number) {
    setRecipeItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateRow(idx: number, patch: Partial<RecipeRow>) {
    setRecipeItems((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function saveRecipe() {
    if (!selectedProductId) return toast.error("Escolhe um produto primeiro");
    setSaving(true);
    try {
      await supabase.from("recipe_items").delete().eq("product_id", selectedProductId);
      if (recipeItems.length) {
        await supabase
          .from("recipe_items")
          .insert(
            recipeItems.map((r) => ({
              product_id: selectedProductId,
              ingredient_id: r.ingredient_id,
              quantity: r.quantity,
              unit: r.unit,
            })),
          );
      }
      await supabase
        .from("products")
        .update({ cost_price: ingredientsCost, target_margin_percent: marginPercent })
        .eq("id", selectedProductId);
      setProducts((prev) =>
        prev.map((p) =>
          p.id === selectedProductId ? { ...p, cost_price: ingredientsCost, target_margin_percent: marginPercent } : p,
        ),
      );
      toast.success("Ficha técnica salva!");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function applyAsSalePrice() {
    if (!selectedProductId) return toast.error("Escolhe um produto primeiro");
    const { error } = await supabase
      .from("products")
      .update({ sale_price: Number(suggestedPrice.toFixed(2)), target_margin_percent: marginPercent })
      .eq("id", selectedProductId);
    if (error) return toast.error(error.message);
    setProducts((prev) =>
      prev.map((p) =>
        p.id === selectedProductId
          ? { ...p, sale_price: Number(suggestedPrice.toFixed(2)), target_margin_percent: marginPercent }
          : p,
      ),
    );
    toast.success("Preço de venda atualizado no cardápio!");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-black uppercase tracking-tight">Precificação</h1>
        <p className="text-sm text-muted-foreground">
          Monta a ficha técnica de um produto e descubra o preço de venda ideal com base no que você realmente gastou.
        </p>
      </div>

      <Card className="p-5">
        <Label>Produto</Label>
        <Select value={selectedProductId} onValueChange={setSelectedProductId}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Escolha um produto do cardápio..." />
          </SelectTrigger>
          <SelectContent>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {selectedProductId && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="space-y-3 p-5 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 font-semibold">
                Ficha técnica — ingredientes usados
                <InfoTip text="Aqui você informa exatamente quais insumos e quanto de cada um entra numa unidade desse produto. O sistema usa o preço de compra cadastrado em cada insumo pra calcular o custo automaticamente." />
              </h2>
              <Button type="button" size="sm" variant="outline" onClick={addRow}>
                <Plus className="size-3.5" /> Adicionar insumo
              </Button>
            </div>

            {!recipeItems.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhum insumo adicionado ainda. Clica em "Adicionar insumo".
              </p>
            ) : (
              <div className="space-y-2">
                {recipeItems.map((row, idx) => {
                  const ing = ingredientById.get(row.ingredient_id);
                  const isWeight = ing?.unit === "kg" || ing?.unit === "g";
                  return (
                    <div key={idx} className="flex items-center gap-2 rounded-lg border p-2.5">
                      <Select
                        value={row.ingredient_id}
                        onValueChange={(v) =>
                          updateRow(idx, {
                            ingredient_id: v,
                            unit: ingredientById.get(v)?.unit === "kg" ? "g" : ingredientById.get(v)?.unit || "g",
                          })
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ingredients.map((i) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <QuantityInput
                        isWeight={isWeight}
                        grams={row.quantity}
                        onChange={(g) => updateRow(idx, { quantity: g })}
                      />
                      <span className="w-20 shrink-0 text-right text-sm font-bold text-primary">
                        {brl(lineCosts[idx] ?? 0)}
                      </span>
                      <Button type="button" size="icon" variant="ghost" onClick={() => removeRow(idx)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <Button type="button" onClick={saveRecipe} disabled={saving} variant="outline" className="w-full">
              <Save className="size-4" /> {saving ? "Salvando..." : "Salvar ficha técnica"}
            </Button>
          </Card>

          <Card className="space-y-4 border-0 bg-gradient-to-br from-foreground to-foreground/90 p-5 text-background">
            <h2 className="flex items-center gap-1.5 font-semibold">
              <Calculator className="size-4" /> Cálculo do preço
            </h2>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-background/70">
                  Custo dos insumos
                  <InfoTip text="Soma do custo de cada ingrediente que você adicionou na ficha técnica ao lado, calculado automaticamente pela quantidade usada × o preço de compra de cada insumo." />
                </span>
                <span className="font-bold">{brl(ingredientsCost)}</span>
              </div>

              <div>
                <Label className="flex items-center gap-1 text-background/70">
                  Custo operacional (R$)
                  <InfoTip text="Um valor fixo em reais pra cobrir gastos que não são ingrediente — embalagem, gás, luz, etc — rateados nesse produto. Se não quiser considerar, deixa 0." />
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={operationalCost}
                  onChange={(e) => setOperationalCost(Number(e.target.value) || 0)}
                  className="mt-1 bg-background text-foreground"
                />
              </div>

              <div>
                <Label className="flex items-center gap-1 text-background/70">
                  Markup desejado — % de lucro sobre o custo
                  <InfoTip text="Quanto de lucro você quer em cima do custo total (insumos + operacional). Ex: 30% significa que o preço final cobre o custo e ainda sobra 30% do valor do custo em lucro. Esse é o número que você controla pra decidir o quanto quer ganhar." />
                </Label>
                <Input
                  type="number"
                  step="1"
                  value={marginPercent}
                  onChange={(e) => setMarginPercent(Number(e.target.value) || 0)}
                  className="mt-1 bg-background text-foreground"
                />
              </div>

              <div>
                <Label className="flex items-center gap-1 text-background/70">
                  Taxas / comissões (%)
                  <InfoTip text="Se esse produto normalmente é vendido com desconto de taxa de cartão, comissão de plataforma (tipo iFood) ou imposto, informa o percentual aqui — o sistema já embute isso no preço final, pra sua margem de lucro não ser corroída por essas taxas." />
                </Label>
                <Input
                  type="number"
                  step="1"
                  value={feesPercent}
                  onChange={(e) => setFeesPercent(Number(e.target.value) || 0)}
                  className="mt-1 bg-background text-foreground"
                />
              </div>

              <p className="rounded-lg bg-background/10 p-2.5 text-[11px] text-background/70">
                Fórmula: (Custo insumos + Operacional) × (1 + Markup) ÷ (1 − Taxas)
              </p>
            </div>

            <div className="border-t border-background/20 pt-4">
              <p className="flex items-center gap-1 text-xs uppercase tracking-wide text-background/60">
                <Sparkles className="size-3.5" /> Valor sugerido de venda
              </p>
              <p className="mt-1 text-3xl font-black">{brl(suggestedPrice)}</p>
              <Button
                type="button"
                onClick={applyAsSalePrice}
                className="mt-3 w-full bg-gradient-to-r from-primary to-accent text-primary-foreground"
              >
                Aplicar como preço de venda
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
