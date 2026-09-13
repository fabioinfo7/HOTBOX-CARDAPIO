import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { primeAlarmUnlock } from "@/lib/alarm-audio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Bike } from "lucide-react";

export const Route = createFileRoute("/entregador/login")({
  component: DelivererLoginPage,
});

function DelivererLoginPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/entregador" });
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    primeAlarmUnlock(); // destrava o som do alarme aqui, ainda dentro do clique/gesto do usuário
    setLoading(true);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/entregador/login",
        });
        if (error) throw error;
        toast.success("Enviamos um e-mail com instruções para redefinir sua senha.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        nav({ to: "/entregador" });
      }
    } catch (err: any) {
      toast.error(err.message || "Falha no login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-primary/10 via-background to-accent/10 px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-4 flex items-center gap-2">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Bike className="size-5" /></div>
          <div>
            <h1 className="font-bold">Entregador</h1>
            <p className="text-xs text-muted-foreground">HotBox Delivery</p>
          </div>
        </div>

        {mode === "forgot" ? (
          <form onSubmit={submit} className="space-y-3">
            <div><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <Button type="submit" className="w-full" disabled={loading}>{loading ? "Enviando..." : "Enviar link de redefinição"}</Button>
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setMode("login")}>Voltar ao login</Button>
          </form>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div><Label>Senha</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            <Button type="submit" className="w-full" disabled={loading}>{loading ? "Entrando..." : "Entrar"}</Button>
            <Button type="button" variant="link" size="sm" className="w-full" onClick={() => setMode("forgot")}>Esqueci minha senha</Button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Ainda não é entregador? <a href="/app" className="underline">Cadastre-se aqui</a>
        </p>
      </Card>
    </div>
  );
}
