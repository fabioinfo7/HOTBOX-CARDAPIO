import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl, formatDateTime } from "@/lib/formatters";
import { brasiliaDateISO } from "@/lib/brasilia-date";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { HandCoins, Plus, CheckCircle2, Trash2, AlertTriangle, Pencil } from "lucide-react";

export const Route = createFileRoute("/_authenticated/loja/receber")({
  component: ReceivablesPage,
});

type Receivable = {
  id: string;
  customer_name: string;
  description: string | null;
  amount: number;
  purchase_date: string;
  due_date: string | null;
  notes: string | null;
  status: "pending" | "paid";
  paid_at: string | null;
  created_at: string;
};

type ReceivableItem = {
  id?: string;
  product_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  cost_price: string;
};

type ProductOption = { id: string; name: string; sale_price: number; cost_price: number };

const today = () => brasiliaDateISO();

function emptyItem(): ReceivableItem {
  return { product_id: null, description: "", quantity: "1", unit_price: "", cost_price: "" };
}

function itemsTotal(items: ReceivableItem[]) {
  return items.reduce(
    (s, it) =>
      s + (Number(String(it.quantity).replace(",", ".")) || 0) * (Number(String(it.unit_price).replace(",", ".")) || 0),
    0,
  );
}

function ReceivablesPage() {
  const [rows, setRows] = useState<Receivable[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [openForm, setOpenForm] = useState(false);
  const [editingReceivable, setEditingReceivable] = useState<Receivable | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);

  const [header, setHeader] = useState({
    customer_name: "",
    purchase_date: today(),
    due_date: "",
    notes: "",
  });
  const [items, setItems] = useState<ReceivableItem[]>([emptyItem()]);

  async function reload() {
    setLoading(true);
    const { data, error } = await supabase
      .from("receivables")
      .select("*")
      .order("status", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    const list = (data as Receivable[]) ?? [];
    setRows(list);
    setLoading(false);

    if (list.length) {
      const { data: itemRows } = await supabase
        .from("receivable_items")
        .select("receivable_id")
        .in(
          "receivable_id",
          list.map((r) => r.id),
        );
      const counts: Record<string, number> = {};
      for (const it of (itemRows as any[]) ?? []) counts[it.receivable_id] = (counts[it.receivable_id] ?? 0) + 1;
      setItemCounts(counts);
    } else {
      setItemCounts({});
    }
  }

  useEffect(() => {
    reload();
    supabase
      .from("products")
      .select("id,name,sale_price,cost_price")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setProducts((data as ProductOption[]) ?? []));
  }, []);

  function openNew() {
    setEditingReceivable(null);
    setHeader({ customer_name: "", purchase_date: today(), due_date: "", notes: "" });
    setItems([emptyItem()]);
    setOpenForm(true);
  }

  async function openEdit(r: Receivable) {
    setEditingReceivable(r);
    setHeader({
      customer_name: r.customer_name,
      purchase_date: r.purchase_date,
      due_date: r.due_date ?? "",
      notes: r.notes ?? "",
    });
    setOpenForm(true);
    setLoadingItems(true);
    const { data, error } = await supabase
      .from("receivable_items")
      .select("id,product_id,description,quantity,unit_price,cost_price")
      .eq("receivable_id", r.id)
      .order("created_at", { ascending: true });
    setLoadingItems(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const loaded = ((data as any[]) ?? []).map((it) => ({
      id: it.id,
      product_id: it.product_id,
      description: it.description,
      quantity: String(it.quantity),
      unit_price: String(it.unit_price),
      cost_price: String(it.cost_price),
    }));
    setItems(loaded.length ? loaded : [emptyItem()]);
  }

  function addItemRow() {
    setItems((prev) => [...prev, emptyItem()]);
  }
  function removeItemRow(idx: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }
  function updateItemRow(idx: number, patch: Partial<ReceivableItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function applyProductToItem(idx: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    updateItemRow(idx, {
      product_id: p.id,
      description: p.name,
      unit_price: String(p.sale_price ?? 0),
      cost_price: String(p.cost_price ?? 0),
    });
  }

  const total = useMemo(() => itemsTotal(items), [items]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter(
      (it) => it.description.trim() && Number(String(it.unit_price).replace(",", ".")) >= 0,
    );
    if (!header.customer_name.trim() || !validItems.length) {
      toast.error("Preencha o nome do cliente e ao menos um item.");
      return;
    }
    setSaving(true);
    try {
      let receivableId = editingReceivable?.id;
      if (receivableId) {
        const { error } = await supabase
          .from("receivables")
          .update({
            customer_name: header.customer_name.trim(),
            purchase_date: header.purchase_date || today(),
            due_date: header.due_date || null,
            notes: header.notes.trim() || null,
            amount: total,
          })
          .eq("id", receivableId);
        if (error) throw error;
        await supabase.from("receivable_items").delete().eq("receivable_id", receivableId);
      } else {
        const { data, error } = await supabase
          .from("receivables")
          .insert({
            customer_name: header.customer_name.trim(),
            purchase_date: header.purchase_date || today(),
            due_date: header.due_date || null,
            notes: header.notes.trim() || null,
            amount: total,
          })
          .select("id")
          .single();
        if (error) throw error;
        receivableId = (data as any).id;
      }

      const { error: itemsError } = await supabase.from("receivable_items").insert(
        validItems.map((it) => ({
          receivable_id: receivableId as string,
          product_id: it.product_id,
          description: it.description.trim(),
          quantity: Number(String(it.quantity).replace(",", ".")) || 1,
          unit_price: Number(String(it.unit_price).replace(",", ".")) || 0,
          cost_price: Number(String(it.cost_price).replace(",", ".")) || 0,
        })),
      );
      if (itemsError) throw itemsError;

      toast.success(editingReceivable ? "Lançamento atualizado." : "Registrado como pendente.");
      setOpenForm(false);
      reload();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function markPaid(r: Receivable) {
    const { error } = await supabase
      .from("receivables")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Pagamento de ${brl(r.amount)} entrou no caixa.`);
    reload();
  }

  async function markPending(r: Receivable) {
    const { error } = await supabase.from("receivables").update({ status: "pending", paid_at: null }).eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    reload();
  }

  async function remove(r: Receivable) {
    if (r.status === "paid") {
      toast.error("Um recebimento já pago não deve ser apagado do histórico financeiro. Se houve devolução, registre uma saída/estorno no Caixa.");
      return;
    }
    if (!confirm(`Excluir lançamento pendente de ${r.customer_name}?`)) return;
    const { error } = await supabase.from("receivables").delete().eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    reload();
  }

  const pending = rows.filter((r) => r.status === "pending");
  const paid = rows.filter((r) => r.status === "paid");
  const totalPending = pending.reduce((s, r) => s + Number(r.amount), 0);
  const totalPaid = paid.reduce((s, r) => s + Number(r.amount), 0);
  const overdue = pending.filter((r) => r.due_date && r.due_date < today());
  const selectedRows = rows.filter((r) => selected.includes(r.id));
  const selectedTotal = selectedRows.reduce((s, r) => s + Number(r.amount), 0);

  function toggleSelected(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleGroup(list: Receivable[], checked: boolean) {
    const ids = list.map((r) => r.id);
    setSelected((prev) => (checked ? Array.from(new Set([...prev, ...ids])) : prev.filter((x) => !ids.includes(x))));
  }



  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <HandCoins className="size-6" /> Contas a Receber
          </h1>
          <p className="text-sm text-muted-foreground">
            Valores previstos para receber. Enquanto estiver pendente, não entra no caixa. Ao marcar como pago, vira uma entrada realizada no Fluxo de Caixa sem duplicar o faturamento da venda.
          </p>
        </div>
        <Dialog
          open={openForm}
          onOpenChange={(o) => {
            setOpenForm(o);
            if (!o) setEditingReceivable(null);
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={openNew}>
              <Plus className="size-4" /> Novo lançamento
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingReceivable ? "Editar lançamento" : "Registrar valor a receber"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Nome do cliente *</Label>
                  <Input
                    value={header.customer_name}
                    onChange={(e) => setHeader((f) => ({ ...f, customer_name: e.target.value }))}
                    placeholder="Ex.: João da Silva"
                  />
                </div>
                <div>
                  <Label>Data da compra</Label>
                  <Input
                    type="date"
                    value={header.purchase_date}
                    onChange={(e) => setHeader((f) => ({ ...f, purchase_date: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <Label>Data prevista para pagamento</Label>
                <Input
                  type="date"
                  value={header.due_date}
                  onChange={(e) => setHeader((f) => ({ ...f, due_date: e.target.value }))}
                />
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">
                    Itens comprados por {header.customer_name.trim() || "esse cliente"} *
                  </Label>
                  <Button type="button" size="sm" variant="outline" onClick={addItemRow}>
                    <Plus className="size-3.5" /> Adicionar item
                  </Button>
                </div>
                {loadingItems ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">Carregando itens...</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((it, idx) => (
                      <div key={idx} className="grid grid-cols-12 items-end gap-2 rounded-md border bg-muted/20 p-2">
                        <div className="col-span-12 sm:col-span-4">
                          <Label className="text-[11px]">Produto (opcional)</Label>
                          <Select
                            value={it.product_id ?? "none"}
                            onValueChange={(v) =>
                              v === "none" ? updateItemRow(idx, { product_id: null }) : applyProductToItem(idx, v)
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Vincular a um produto..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— avulso —</SelectItem>
                              {products.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-12 sm:col-span-3">
                          <Label className="text-[11px]">Descrição *</Label>
                          <Input
                            className="h-8 text-xs"
                            value={it.description}
                            onChange={(e) => updateItemRow(idx, { description: e.target.value })}
                            placeholder="Ex.: Pizza grande"
                          />
                        </div>
                        <div className="col-span-4 sm:col-span-1">
                          <Label className="text-[11px]">Qtd</Label>
                          <Input
                            className="h-8 text-xs"
                            inputMode="decimal"
                            value={it.quantity}
                            onChange={(e) => updateItemRow(idx, { quantity: e.target.value })}
                          />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <Label className="text-[11px]">Valor unit. (R$) *</Label>
                          <Input
                            className="h-8 text-xs"
                            inputMode="decimal"
                            value={it.unit_price}
                            onChange={(e) => updateItemRow(idx, { unit_price: e.target.value })}
                            placeholder="0,00"
                          />
                        </div>
                        <div className="col-span-3 sm:col-span-1">
                          <Label className="text-[11px]">Custo (R$)</Label>
                          <Input
                            className="h-8 text-xs"
                            inputMode="decimal"
                            value={it.cost_price}
                            onChange={(e) => updateItemRow(idx, { cost_price: e.target.value })}
                            placeholder="0,00"
                          />
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => removeItemRow(idx)}
                            disabled={items.length === 1}
                          >
                            <Trash2 className="size-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  O custo é usado só internamente pra calcular o lucro real na Central Financeira — não aparece pro
                  cliente.
                </p>
                <div className="flex items-center justify-end gap-2 border-t pt-2 text-sm font-bold">
                  Total: <span className="text-lg text-primary">{brl(total)}</span>
                </div>
              </div>

              <div>
                <Label>Observação</Label>
                <Textarea
                  rows={2}
                  value={header.notes}
                  onChange={(e) => setHeader((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Detalhes, combinado com o cliente, etc."
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpenForm(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Pendente</p>
          <p className="text-2xl font-bold text-warning">{brl(totalPending)}</p>
          <p className="text-xs text-muted-foreground">{pending.length} lançamento(s)</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Recebido</p>
          <p className="text-2xl font-bold text-success">{brl(totalPaid)}</p>
          <p className="text-xs text-muted-foreground">{paid.length} lançamento(s)</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="size-3" /> Atrasados
          </p>
          <p className="text-2xl font-bold text-destructive">{overdue.length}</p>
          <p className="text-xs text-muted-foreground">passaram da data prevista</p>
        </Card>
      </div>

      {selected.length > 0 && (
        <Card className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 border-primary/40 bg-primary/5 p-4">
          <div>
            <p className="text-xs text-muted-foreground">{selected.length} lançamento(s) selecionado(s)</p>
            <p className="text-2xl font-bold text-primary">{brl(selectedTotal)}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setSelected([])}>
            Limpar seleção
          </Button>
        </Card>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Pendentes</h2>
          {pending.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={pending.every((r) => selected.includes(r.id))}
                onCheckedChange={(c) => toggleGroup(pending, c === true)}
              />
              Selecionar todos
            </label>
          )}
        </div>
        {loading ? (
          <Card className="p-6 text-sm text-muted-foreground">Carregando...</Card>
        ) : pending.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">Nenhum valor pendente. 🎉</Card>
        ) : (
          <Card className="divide-y">
            {pending.map((r) => {
              const isOverdue = r.due_date && r.due_date < today();
              return (
                <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <Checkbox
                    className="mt-1"
                    checked={selected.includes(r.id)}
                    onCheckedChange={() => toggleSelected(r.id)}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{r.customer_name}</p>
                      {isOverdue && (
                        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                          ATRASADO
                        </span>
                      )}
                      {itemCounts[r.id] > 1 && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {itemCounts[r.id]} itens
                        </span>
                      )}
                    </div>
                    <p className="text-sm">{r.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Compra: {new Date(r.purchase_date + "T00:00:00").toLocaleDateString("pt-BR")}
                      {r.due_date && <> • Previsto: {new Date(r.due_date + "T00:00:00").toLocaleDateString("pt-BR")}</>}
                    </p>
                    {r.notes && <p className="mt-1 text-xs italic text-muted-foreground">"{r.notes}"</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-bold text-warning">{brl(r.amount)}</p>
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button size="sm" onClick={() => markPaid(r)}>
                      <CheckCircle2 className="size-4" /> Pago
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(r)} title="Excluir lançamento pendente">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </section>

      {paid.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recebidos</h2>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={paid.slice(0, 50).every((r) => selected.includes(r.id))}
                onCheckedChange={(c) => toggleGroup(paid.slice(0, 50), c === true)}
              />
              Selecionar todos
            </label>
          </div>
          <Card className="divide-y">
            {paid.slice(0, 50).map((r) => (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <Checkbox
                  className="mt-1"
                  checked={selected.includes(r.id)}
                  onCheckedChange={() => toggleSelected(r.id)}
                />
                <div className="min-w-0 flex-1">

                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{r.customer_name}</p>
                    {itemCounts[r.id] > 1 && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {itemCounts[r.id]} itens
                      </span>
                    )}
                  </div>
                  <p className="text-sm">{r.description}</p>
                  <p className="text-xs text-muted-foreground">Pago em {r.paid_at ? formatDateTime(r.paid_at) : "—"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-bold text-success">{brl(r.amount)}</p>
                  <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => markPending(r)}>
                    Reabrir
                  </Button>

                </div>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
