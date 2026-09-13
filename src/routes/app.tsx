import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { primeAlarmUnlock } from "@/lib/alarm-audio";
import { formatPhone, onlyDigits } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bike, Camera, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/app")({
  component: DelivererAppEntry,
});

function DelivererAppEntry() {
  const nav = useNavigate();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [alreadyDeliverer, setAlreadyDeliverer] = useState(false);

  const [account, setAccount] = useState({ email: "", password: "" });
  const [form, setForm] = useState({ full_name: "", phone: "", vehicle: "moto" });
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const selfieFile = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setHasSession(true);
        const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", data.session.user.id).eq("role", "deliverer").maybeSingle();
        if (role) { setAlreadyDeliverer(true); nav({ to: "/entregador" }); return; }
      }
      setChecking(false);
    })();
  }, []);

  function onSelfieChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    selfieFile.current = file;
    const reader = new FileReader();
    reader.onload = () => setSelfiePreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    primeAlarmUnlock(); // destrava o som do alarme aqui, ainda dentro do clique/gesto do usuário
    if (!selfieFile.current) {
      toast.error("A selfie é obrigatória para concluir o cadastro");
      return;
    }
    setSubmitting(true);
    try {
      let userId: string | undefined;

      if (!hasSession) {
        if (!account.email || !account.password) throw new Error("Preencha e-mail e senha");
        const { data, error } = await supabase.auth.signUp({
          email: account.email,
          password: account.password,
          options: { data: { full_name: form.full_name } },
        });
        if (error) throw error;
        userId = data.user?.id;
        if (!data.session) {
          // e-mail confirmation still enabled on the project — try immediate sign-in as fallback
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: account.email, password: account.password,
          });
          if (signInError) throw new Error("Conta criada. Faça login para concluir o cadastro.");
          userId = signInData.user?.id;
        }
      } else {
        const { data } = await supabase.auth.getUser();
        userId = data.user?.id;
      }
      if (!userId) throw new Error("Não foi possível identificar sua conta");

      const ext = selfieFile.current.name.split(".").pop() || "jpg";
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("deliverer-selfies").upload(path, selfieFile.current, { upsert: true });
      if (upErr) throw new Error("Falha ao enviar a selfie: " + upErr.message);
      const { data: pub } = supabase.storage.from("deliverer-selfies").getPublicUrl(path);

      const { error: rpcErr } = await supabase.rpc("register_deliverer", {
        _full_name: form.full_name,
        _phone: onlyDigits(form.phone),
        _vehicle: form.vehicle,
        _selfie_url: pub.publicUrl,
      });
      if (rpcErr) throw rpcErr;

      toast.success("Cadastro enviado! Aguarde a loja ativar seu acesso para começar a receber pedidos.");
      nav({ to: "/entregador" });
    } catch (err: any) {
      toast.error(err.message ?? "Não foi possível concluir o cadastro");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) return <div className="grid min-h-screen place-items-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-primary/10 via-background to-accent/10 px-4 py-8">
      <Card className="w-full max-w-md p-6">
        <div className="mb-4 flex items-center gap-2">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Bike className="size-5" /></div>
          <div>
            <h1 className="text-lg font-bold">Cadastro de entregador</h1>
            <p className="text-xs text-muted-foreground">HotBox Delivery</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {!hasSession && (
            <>
              <div><Label>E-mail</Label><Input type="email" value={account.email} onChange={(e) => setAccount({ ...account, email: e.target.value })} required /></div>
              <div><Label>Senha</Label><Input type="password" value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} required minLength={6} /></div>
            </>
          )}
          <div><Label>Nome completo</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
          <div><Label>WhatsApp</Label><Input value={formatPhone(form.phone)} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(11) 99999-9999" required /></div>
          <div>
            <Label>Forma de entrega</Label>
            <Select value={form.vehicle} onValueChange={(v) => setForm({ ...form, vehicle: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="moto">Moto</SelectItem>
                <SelectItem value="bike">Bicicleta</SelectItem>
                <SelectItem value="carro">Carro</SelectItem>
                <SelectItem value="pe">A pé</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Selfie (obrigatória)</Label>
            <input ref={fileInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onSelfieChange} />
            {selfiePreview ? (
              <div className="mt-2 flex items-center gap-3">
                <img src={selfiePreview} alt="Selfie" className="size-20 rounded-lg object-cover" />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <RotateCcw className="size-4" /> Tirar outra
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => fileInputRef.current?.click()}>
                <Camera className="size-4" /> Tirar selfie
              </Button>
            )}
            <p className="mt-1 text-xs text-muted-foreground">Sem a selfie não é possível concluir o cadastro.</p>
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Enviando..." : "Concluir cadastro"}</Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Já é cadastrado? <a href="/entregador/login" className="underline">Entrar</a>
        </p>
      </Card>
    </div>
  );
}
