import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, PackagePlus } from "lucide-react";
import { brl, onlyDigits } from "@/lib/formatters";
import { brasiliaDateISO } from "@/lib/brasilia-date";

type Product = { id: string; name: string; sale_price: number; cost_price: number };
type Item = { product_id: string | null; product_name: string; quantity: number; unit_price: number; cost_price: number };
type PaymentOption = "pix" | "card" | "later";

const todayStr = () => brasiliaDateISO();

export function ManualOrderDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [payment, setPayment] = useState<PaymentOption>("pix");
  const [dueDate, setDueDate] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayStr());
  const [receivableDescription, setReceivableDescription] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<"delivery" | "pickup">("delivery");
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from("products").select("id,name,sale_price,cost_price").eq("active", true).order("name")
      .then(({ data }) => setProducts((data ?? []) as Product[]));
    supabase.from("store_config").select("default_delivery_fee").maybeSingle()
      .then(({ data }) => setDeliveryFee(Number(data?.default_delivery_fee ?? 0)));
  }, [open]);


  function reset() {
    setName(""); setPhone(""); setStreet(""); setNumber(""); setNeighborhood("");
    setPayment("pix"); setDeliveryMode("delivery"); setNotes(""); setItems([]);
    setDueDate(""); setPurchaseDate(todayStr()); setReceivableDescription("");
  }

  function addItem() {
    setItems([...items, { product_id: null, product_name: "", quantity: 1, unit_price: 0, cost_price: 0 }]);
  }

  function updateItem(i: number, patch: Partial<Item>) {
    setItems(items.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  }

  function pickProduct(i: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    updateItem(i, { product_id: p.id, product_name: p.name, unit_price: Number(p.sale_price), cost_price: Number(p.cost_price ?? 0) });
  }

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const total = subtotal + (deliveryMode === "delivery" ? deliveryFee : 0);
  const payLater = payment === "later";

  async function save() {
    if (!name.trim() || !phone.trim()) return toast.error("Preencha nome e telefone do cliente");
    if (!items.length) return toast.error("Adicione ao menos um item");
    if (deliveryMode === "delivery" && !street.trim()) return toast.error("Informe o endereço");
    if (payLater && !dueDate) return toast.error("Informe a data prevista para o pagamento");
    setSaving(true);
    try {
      const { data: order, error } = await supabase.from("orders").insert({
        source: "site" as const,
        customer_name: name.trim(),
        customer_phone: onlyDigits(phone),
        address_street: deliveryMode === "delivery" ? street : null,
        address_number: deliveryMode === "delivery" ? number : null,
        address_neighborhood: deliveryMode === "delivery" ? neighborhood : null,
        payment_method: (payLater ? "card" : payment) as "pix" | "card" | "link",
        payment_status: "pending",
        payment_timing: payLater ? "later" : payment === "pix" ? "delivery" : null,
        status: "preparing" as const,
        accepted_at: new Date().toISOString(),
        delivery_mode: deliveryMode,
        subtotal,
        delivery_fee: deliveryMode === "delivery" ? deliveryFee : 0,
        total,
        notes: payLater
          ? [notes, `Pagar depois — vencimento ${dueDate}`, receivableDescription].filter(Boolean).join(" | ")
          : notes || null,
      }).select("id").single();
      if (error || !order) throw error;

      const { error: itemsErr } = await supabase.from("order_items").insert(
        items.map((it) => ({
          order_id: order.id,
          product_id: it.product_id,
          product_name: it.product_name,
          quantity: it.quantity,
          unit_price: it.unit_price,
        }))
      );
      if (itemsErr) throw itemsErr;

      if (payLater) {
        const { data: rec, error: recErr } = await supabase.from("receivables").insert({
          order_id: order.id,
          customer_name: name.trim(),
          description: receivableDescription.trim() || `Pedido manual — ${items.length} item(ns)`,
          purchase_date: purchaseDate || todayStr(),
          due_date: dueDate,
          notes: notes.trim() || null,
        }).select("id").single();
        if (recErr || !rec) throw recErr;

        const recItems = items.map((it) => ({
          receivable_id: rec.id,
          product_id: it.product_id,
          description: it.product_name || "Item",
          quantity: it.quantity,
          unit_price: it.unit_price,
          cost_price: it.cost_price ?? 0,
        }));
        if (deliveryMode === "delivery" && deliveryFee > 0) {
          recItems.push({
            receivable_id: rec.id,
            product_id: null,
            description: "Taxa de entrega",
            quantity: 1,
            unit_price: deliveryFee,
            cost_price: 0,
          });
        }
        const { error: recItemsErr } = await supabase.from("receivable_items").insert(recItems);
        if (recItemsErr) throw recItemsErr;
      }

      toast.success(payLater ? "Pedido criado e lançado em A Receber!" : "Pedido manual criado!");
      reset();
      onOpenChange(false);
      onCreated?.();
    } catch (e: any) {
      toast.error(e.message ?? "Falha ao criar pedido");
    } finally {
      setSaving(false);
    }
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PackagePlus className="size-5" /> Novo pedido manual</DialogTitle>
          <DialogDescription>Use quando o cliente ligar, o WhatsApp cair, ou pra iFood improvisado.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Nome do cliente *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Telefone *</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11999999999" /></div>
        </div>

        <div>
          <Label>Modalidade</Label>
          <Select value={deliveryMode} onValueChange={(v: any) => setDeliveryMode(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="delivery">Entrega</SelectItem>
              <SelectItem value="pickup">Retirada no local</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {deliveryMode === "delivery" && (
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr]">
            <div><Label>Rua *</Label><Input value={street} onChange={(e) => setStreet(e.target.value)} /></div>
            <div><Label>Número</Label><Input value={number} onChange={(e) => setNumber(e.target.value)} /></div>
            <div><Label>Bairro</Label><Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} /></div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Itens *</Label>
            <Button type="button" size="sm" variant="outline" onClick={addItem}><Plus className="size-3.5" /> Item</Button>
          </div>
          {items.length === 0 && <p className="text-xs text-muted-foreground">Nenhum item adicionado ainda.</p>}
          {items.map((it, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[2fr_60px_100px_36px]">
              <Select value={it.product_id ?? ""} onValueChange={(v) => pickProduct(i, v)}>
                <SelectTrigger><SelectValue placeholder="Escolha o produto" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — {brl(p.sale_price)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="number" min={1} value={it.quantity} onChange={(e) => updateItem(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} />
              <Input type="number" step="0.01" value={it.unit_price} onChange={(e) => updateItem(i, { unit_price: Number(e.target.value) || 0 })} />
              <Button type="button" size="icon" variant="ghost" onClick={() => setItems(items.filter((_, idx) => idx !== i))}><Trash2 className="size-4 text-destructive" /></Button>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Pagamento</Label>
            <Select value={payment} onValueChange={(v: any) => setPayment(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pix">Pix</SelectItem>
                <SelectItem value="card">Cartão</SelectItem>
                <SelectItem value="later">Pagar depois (A receber)</SelectItem>
              </SelectContent>

            </Select>
          </div>
          {deliveryMode === "delivery" && (
            <div><Label>Taxa de entrega</Label><Input type="number" step="0.01" value={deliveryFee} onChange={(e) => setDeliveryFee(Number(e.target.value) || 0)} /></div>
          )}
        </div>

        {payLater && (
          <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Dados do lançamento em A Receber</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Data da compra</Label><Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></div>
              <div><Label>Data prevista do pagamento *</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={receivableDescription} onChange={(e) => setReceivableDescription(e.target.value)} rows={2} placeholder="Ex.: Venda fiado — cliente do bairro" />
            </div>
          </div>
        )}


        <div><Label>Observações</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>

        <div className="flex items-center justify-between rounded-lg bg-muted p-3">
          <div className="text-sm">
            <p>Subtotal: <span className="font-semibold">{brl(subtotal)}</span></p>
            {deliveryMode === "delivery" && <p className="text-xs text-muted-foreground">+ entrega {brl(deliveryFee)}</p>}
          </div>
          <p className="text-xl font-extrabold text-primary">{brl(total)}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Criar pedido"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
