import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { brasiliaDateISO, brasiliaDayRange } from "@/lib/brasilia-date";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, Clock3, Edit3, Plus, Trash2, WalletCards } from "lucide-react";

const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (v?: string | null) => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const SOURCE_LABEL: Record<string,string> = { order:"Pedido", receivable:"A receber", expense:"Despesa", manual:"Manual", adjustment:"Ajuste" };
const CATEGORY_LABEL: Record<string,string> = {
  venda:"Venda", contas_receber:"Conta a receber", repasse_plataforma:"Repasse de plataforma",
  aluguel:"Aluguel", energia:"Energia", gas:"Gás", agua:"Água", embalagens:"Embalagens",
  ingredientes:"Ingredientes / Insumos", pessoal:"Pessoal", impostos:"Impostos / Taxas", marketing:"Marketing",
  manutencao:"Manutenção", transporte:"Transporte", outros:"Outros", aporte:"Aporte", retirada:"Retirada",
};

type Tx = {
  id:string; direction:"in"|"out"; status:"forecast"|"paid"|"cancelled"; amount:number; category:string;
  description:string; account:string|null; payment_method:string|null; source_type:string; source_id:string|null;
  customer_name:string|null; due_date:string|null; competence_date:string|null; occurred_at:string|null; paid_at:string|null;
  notes:string|null; is_system:boolean; created_at:string;
};

type Draft = {
  direction:"in"|"out"; status:"paid"|"forecast"; amount:string; category:string; description:string;
  account:string; payment_method:string; date:string; due_date:string; notes:string;
};

const blank = (): Draft => ({ direction:"in", status:"paid", amount:"", category:"outros", description:"", account:"Operação", payment_method:"", date:brasiliaDateISO(), due_date:"", notes:"" });

export function FinancialCashLedger({ from, to }: { from:string; to:string }) {
  const [rows,setRows]=useState<Tx[]>([]);
  const [loading,setLoading]=useState(false);
  const [status,setStatus]=useState<"all"|"paid"|"forecast">("all");
  const [direction,setDirection]=useState<"all"|"in"|"out">("all");
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(1);
  const [count,setCount]=useState(0);
  const [summary,setSummary]=useState<any>({});
  const [open,setOpen]=useState(false);
  const [editing,setEditing]=useState<Tx|null>(null);
  const [draft,setDraft]=useState<Draft>(blank());
  const [saving,setSaving]=useState(false);
  const pageSize=20;

  async function load(target=page){
    setLoading(true);
    const {since,until}=brasiliaDayRange(from,to);
    let q=(supabase.from("financial_transactions" as any) as any)
      .select("id,direction,status,amount,category,description,account,payment_method,source_type,source_id,customer_name,due_date,competence_date,occurred_at,paid_at,notes,is_system,created_at",{count:"exact"})
      .neq("status","cancelled")
      .order("paid_at",{ascending:false,nullsFirst:false})
      .order("due_date",{ascending:true,nullsFirst:false})
      .range((target-1)*pageSize,target*pageSize-1);
    if(status==="paid") q=q.eq("status","paid").gte("paid_at",since).lte("paid_at",until);
    else if(status==="forecast") q=q.eq("status","forecast");
    else q=q.or(`and(status.eq.paid,paid_at.gte.${since},paid_at.lte.${until}),status.eq.forecast`);
    if(direction!=="all") q=q.eq("direction",direction);
    if(search.trim()) q=q.ilike("description",`%${search.trim()}%`);
    const [{data,error,count:c},{data:sum,error:sumErr}]=await Promise.all([
      q,
      (supabase as any).rpc("financial_position_summary",{p_from:from,p_to:to}),
    ]);
    if(error) toast.error(error.message); else {setRows((data??[]) as Tx[]); setCount(c??0); setPage(target);}
    if(sumErr) toast.error(sumErr.message); else setSummary(sum??{});
    setLoading(false);
  }
  useEffect(()=>{setPage(1);void load(1)},[from,to,status,direction]);

  const totalPages=Math.max(1,Math.ceil(count/pageSize));
  const filtered=useMemo(()=>rows,[rows]);

  function openNew(){ setEditing(null); setDraft(blank()); setOpen(true); }
  function openEdit(tx:Tx){
    if(tx.is_system){toast.info("Lançamentos automáticos são conciliados pela origem. Você pode marcar previsões como recebidas/pagas, mas não alterar o valor de origem.");return;}
    setEditing(tx);
    setDraft({direction:tx.direction,status:tx.status==="forecast"?"forecast":"paid",amount:String(tx.amount),category:tx.category,description:tx.description,account:tx.account||"Operação",payment_method:tx.payment_method||"",date:(tx.paid_at||tx.occurred_at||tx.created_at).slice(0,10),due_date:tx.due_date||"",notes:tx.notes||""});
    setOpen(true);
  }
  async function save(){
    const amount=Number(String(draft.amount).replace(",","."));
    if(!draft.description.trim()||!Number.isFinite(amount)||amount<=0){toast.error("Informe descrição e valor válido.");return;}
    setSaving(true);
    const when=new Date(`${draft.date}T12:00:00-03:00`).toISOString();
    const payload:any={direction:draft.direction,status:draft.status,amount,category:draft.category,description:draft.description.trim(),account:draft.account.trim()||null,payment_method:draft.payment_method||null,source_type:"manual",customer_name:null,competence_date:draft.date,due_date:draft.status==="forecast"?(draft.due_date||draft.date):null,occurred_at:draft.status==="paid"?when:null,paid_at:draft.status==="paid"?when:null,notes:draft.notes.trim()||null,is_system:false};
    const {error}=editing
      ? await (supabase.from("financial_transactions" as any) as any).update(payload).eq("id",editing.id).eq("is_system",false)
      : await (supabase.from("financial_transactions" as any) as any).insert(payload);
    setSaving(false);
    if(error){toast.error(error.message);return;}
    toast.success(editing?"Movimentação atualizada.":"Movimentação registrada no caixa.");
    setOpen(false); void load(1);
  }
  async function settle(tx:Tx){
    const label=tx.direction==="in"?"recebido":"pago";
    if(!confirm(`Confirmar que ${brl(tx.amount)} foi realmente ${label} agora?`)) return;
    const now=new Date().toISOString();
    const {error}=await (supabase.from("financial_transactions" as any) as any).update({status:"paid",paid_at:now,occurred_at:now,due_date:null}).eq("id",tx.id).eq("status","forecast");
    if(error){toast.error(error.message);return;}
    toast.success(tx.direction==="in"?"Entrada confirmada no caixa.":"Saída confirmada no caixa."); void load(page);
  }
  async function remove(tx:Tx){
    if(tx.is_system){toast.error("Lançamento automático não pode ser excluído. Corrija o pedido, a conta a receber ou a despesa de origem.");return;}
    if(!confirm("Excluir esta movimentação manual?")) return;
    const {error}=await (supabase.from("financial_transactions" as any) as any).delete().eq("id",tx.id).eq("is_system",false);
    if(error) toast.error(error.message); else {toast.success("Movimentação excluída.");void load(page);}
  }

  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Mini title="Entradas realizadas" value={brl(summary.cash_in)} icon={<ArrowUpCircle className="size-4 text-emerald-600"/>} sub="Somente dinheiro efetivamente recebido"/>
      <Mini title="Saídas realizadas" value={brl(summary.cash_out)} icon={<ArrowDownCircle className="size-4 text-red-600"/>} sub="Somente dinheiro efetivamente pago"/>
      <Mini title="Movimento líquido" value={brl(summary.cash_net)} icon={<WalletCards className="size-4"/>} sub="Entradas − saídas no período"/>
      <Mini title="A receber" value={brl(summary.receivable)} icon={<Clock3 className="size-4 text-amber-600"/>} sub={summary.receivable_overdue>0?`${brl(summary.receivable_overdue)} vencido`:"Valores previstos, ainda fora do caixa"}/>
      <Mini title="A pagar" value={brl(summary.payable)} icon={<Clock3 className="size-4 text-orange-600"/>} sub={summary.payable_overdue>0?`${brl(summary.payable_overdue)} vencido`:"Compromissos previstos, ainda fora do caixa"}/>
    </div>

    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-end">
        <div className="flex-1"><p className="font-black">Livro-caixa</p><p className="text-xs text-muted-foreground">Uma única lista para tudo que entrou, saiu ou ainda está previsto. Pedidos, InfinitePay, A Receber e despesas entram automaticamente.</p></div>
        <Input className="lg:w-56" placeholder="Buscar movimentação" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load(1)}/>
        <Select value={status} onValueChange={v=>setStatus(v as any)}><SelectTrigger className="lg:w-40"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Realizado + previsto</SelectItem><SelectItem value="paid">Somente realizado</SelectItem><SelectItem value="forecast">Somente previsto</SelectItem></SelectContent></Select>
        <Select value={direction} onValueChange={v=>setDirection(v as any)}><SelectTrigger className="lg:w-36"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Entradas + saídas</SelectItem><SelectItem value="in">Entradas</SelectItem><SelectItem value="out">Saídas</SelectItem></SelectContent></Select>
        <Button variant="outline" onClick={()=>load(1)} disabled={loading}>Atualizar</Button>
        <Button onClick={openNew}><Plus className="mr-1 size-4"/> Nova movimentação</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Movimentação</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3 text-right">Valor</th><th className="px-4 py-3 text-right">Ações</th></tr></thead>
        <tbody>{filtered.length?filtered.map(tx=><tr key={tx.id} className="border-t hover:bg-muted/20"><td className="whitespace-nowrap px-4 py-3"><b>{tx.status==="paid"?fmt(tx.paid_at).split(",")[0]:(tx.due_date?new Date(tx.due_date+"T12:00:00").toLocaleDateString("pt-BR"):"Sem data")}</b><div className="text-[11px] text-muted-foreground">{tx.status==="paid"?fmt(tx.paid_at).split(",").slice(1).join(","):"previsão"}</div></td><td className="px-4 py-3"><div className="font-semibold">{tx.description}</div><div className="text-[11px] text-muted-foreground">{CATEGORY_LABEL[tx.category]||tx.category} · {SOURCE_LABEL[tx.source_type]||tx.source_type}{tx.account?` · ${tx.account}`:""}</div></td><td className="px-4 py-3">{tx.status==="paid"?<span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="size-3"/> Realizado</span>:<span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700"><Clock3 className="size-3"/> Previsto</span>}</td><td className={`px-4 py-3 text-right text-base font-black ${tx.direction==="in"?"text-emerald-700":"text-red-600"}`}>{tx.direction==="in"?"+ ":"− "}{brl(tx.amount)}</td><td className="px-4 py-3"><div className="flex justify-end gap-1">{tx.status==="forecast"&&<Button size="sm" variant="outline" onClick={()=>settle(tx)}>{tx.direction==="in"?"Receber":"Pagar"}</Button>}<Button size="icon" variant="ghost" title={tx.is_system?"Origem automática":"Editar"} onClick={()=>openEdit(tx)}><Edit3 className="size-4"/></Button>{!tx.is_system&&<Button size="icon" variant="ghost" onClick={()=>remove(tx)}><Trash2 className="size-4 text-destructive"/></Button>}</div></td></tr>):<tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Nenhuma movimentação encontrada.</td></tr>}</tbody></table>
      </div>
      <div className="flex items-center justify-between border-t px-4 py-3 text-xs"><span>{count} registro(s)</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page<=1||loading} onClick={()=>load(page-1)}>Anterior</Button><b>{page} / {totalPages}</b><Button size="sm" variant="outline" disabled={page>=totalPages||loading} onClick={()=>load(page+1)}>Próxima</Button></div></div>
    </Card>

    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{editing?"Editar movimentação":"Nova movimentação de caixa"}</DialogTitle></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div><Label>Tipo</Label><Select value={draft.direction} onValueChange={v=>setDraft({...draft,direction:v as any})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="in">Entrada</SelectItem><SelectItem value="out">Saída</SelectItem></SelectContent></Select></div><div><Label>Situação</Label><Select value={draft.status} onValueChange={v=>setDraft({...draft,status:v as any})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="paid">Já realizado</SelectItem><SelectItem value="forecast">Previsto</SelectItem></SelectContent></Select></div><div className="sm:col-span-2"><Label>Descrição *</Label><Input value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})} placeholder="Ex.: compra de embalagens, aporte, reembolso..."/></div><div><Label>Valor *</Label><Input inputMode="decimal" value={draft.amount} onChange={e=>setDraft({...draft,amount:e.target.value})} placeholder="0,00"/></div><div><Label>Categoria</Label><Select value={draft.category} onValueChange={v=>setDraft({...draft,category:v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{Object.entries(CATEGORY_LABEL).map(([k,v])=><SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div><div><Label>{draft.status==="paid"?"Data do movimento":"Data de referência"}</Label><Input type="date" value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/></div>{draft.status==="forecast"&&<div><Label>Vencimento / previsão</Label><Input type="date" value={draft.due_date} onChange={e=>setDraft({...draft,due_date:e.target.value})}/></div>}<div><Label>Conta / origem</Label><Input value={draft.account} onChange={e=>setDraft({...draft,account:e.target.value})} placeholder="Operação, banco, InfinitePay..."/></div><div><Label>Forma de pagamento</Label><Input value={draft.payment_method} onChange={e=>setDraft({...draft,payment_method:e.target.value})} placeholder="Pix, cartão, transferência..."/></div><div className="sm:col-span-2"><Label>Observação</Label><textarea className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm" value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></div></div><DialogFooter><Button variant="outline" onClick={()=>setOpen(false)}>Cancelar</Button><Button onClick={save} disabled={saving}>{saving?"Salvando...":"Salvar"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Mini({title,value,sub,icon}:{title:string;value:string;sub:string;icon:any}){return <Card className="p-4"><div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-muted-foreground"><span>{title}</span>{icon}</div><p className="mt-2 text-2xl font-black">{value}</p><p className="mt-1 text-[11px] leading-snug text-muted-foreground">{sub}</p></Card>}
