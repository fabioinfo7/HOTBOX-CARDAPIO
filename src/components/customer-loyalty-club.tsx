import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Flame, Gift, LogIn, LogOut, Mail, Sparkles, Trophy } from "lucide-react";
import { toast } from "sonner";
import { getCustomerLoyaltyStatus } from "@/lib/loyalty.functions";

type Props = {
  session: Session | null;
  onSessionChange?: (session: Session | null) => void;
  onUseReward?: (code: string) => void;
};

type Status = any;

function messageFor(points: number, required: number) {
  const missing = Math.max(0, required - points);
  if (points <= 0) return "O forno está frio… faça seu primeiro pedido logado e acenda a chama!";
  if (missing === 1) return "⚠️ Perigo: falta só 1 pedido para uma HotBox grátis.";
  if (missing <= 3) return `O forno está pegando fogo! Faltam só ${missing} pedidos.`;
  if (points >= Math.ceil(required / 2)) return "Já dá para sentir o cheiro… você passou da metade!";
  return "Cada pedido acende mais uma chama no Forno HotBox.";
}

function Oven({ points, required }: { points: number; required: number }) {
  const slots = Array.from({ length: required }, (_, i) => i < points);
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-orange-300 bg-gradient-to-b from-[#24110b] via-[#120806] to-black p-4 shadow-[0_20px_50px_rgba(122,40,0,.22)]">
      <div className="pointer-events-none absolute inset-x-10 -top-8 h-20 rounded-full bg-orange-500/25 blur-3xl" />
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.22em] text-orange-300">Forno da Fidelidade</p>
          <p className="text-lg font-black text-white">{points} de {required} pedidos</p>
        </div>
        <div className="grid size-11 place-items-center rounded-2xl border border-orange-300/30 bg-orange-400/10">
          <Flame className="size-6 text-orange-400" />
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2 rounded-[22px] border border-white/10 bg-black/35 p-3 shadow-inner">
        {slots.map((filled, i) => (
          <div key={i} className={`relative aspect-square rounded-2xl border transition ${filled ? "border-orange-300/60 bg-gradient-to-b from-amber-200 to-orange-500 shadow-[0_0_18px_rgba(249,115,22,.42)]" : "border-white/10 bg-white/5"}`}>
            <div className={`absolute inset-0 grid place-items-center text-xl ${filled ? "animate-[pulse_2.2s_ease-in-out_infinite]" : "opacity-30 grayscale"}`}>
              {filled ? "🥔" : "🔥"}
            </div>
            <span className="absolute bottom-1 right-1 text-[9px] font-black text-white/70">{i + 1}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs font-semibold leading-relaxed text-orange-100">{messageFor(points, required)}</p>
    </div>
  );
}

export function CustomerLoyaltyClub({ session, onSessionChange, onUseReward }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function load() {
    if (!session?.access_token) { setStatus(null); return; }
    setLoading(true);
    try {
      const result = await getCustomerLoyaltyStatus({ data: { accessToken: session.access_token } });
      setStatus(result);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [session?.access_token]);

  const available = useMemo(() => (status?.rewards || []).filter((r: any) => r.status === "available"), [status]);

  async function googleLogin() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) toast.error(error.message);
  }

  async function emailAuth() {
    if (!email || password.length < 6) return toast.error("Informe e-mail e uma senha com pelo menos 6 caracteres.");
    setLoading(true);
    try {
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        toast.success("Conta criada! Se a confirmação de e-mail estiver ativa, confira sua caixa de entrada.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSessionChange?.(data.session);
        setAuthOpen(false);
      }
    } catch (e: any) {
      toast.error(e.message || "Não foi possível entrar.");
    } finally { setLoading(false); }
  }

  async function logout() {
    await supabase.auth.signOut();
    onSessionChange?.(null);
    setStatus(null);
  }

  if (!session) {
    return (
      <div className="rounded-[28px] border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-black text-orange-400 shadow-lg"><Flame className="size-6" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><h2 className="font-display text-lg font-black uppercase">Clube HotBox</h2><Sparkles className="size-4 text-orange-500" /></div>
            <p className="mt-1 text-sm text-muted-foreground">Peça logado. A cada 10 pedidos concluídos, desbloqueie um cupom de <b>1 batata grátis</b>.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button className="rounded-xl" onClick={() => setAuthOpen(true)}><LogIn className="mr-2 size-4" /> Entrar no Clube</Button>
              <Button variant="outline" className="rounded-xl" onClick={() => { setAuthMode("signup"); setAuthOpen(true); }}>Criar conta</Button>
            </div>
          </div>
        </div>
        <Dialog open={authOpen} onOpenChange={setAuthOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>{authMode === "signup" ? "Criar conta no Clube HotBox" : "Entrar no Clube HotBox"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Button variant="outline" className="h-12 w-full rounded-xl text-base font-bold" onClick={googleLogin}>
                <span className="mr-2 text-lg font-black">G</span> Continuar com Google
              </Button>
              <div className="flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" /> ou <div className="h-px flex-1 bg-border" /></div>
              <div className="relative"><Mail className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input className="pl-10" type="email" placeholder="Seu e-mail" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <Input type="password" placeholder="Senha (mínimo 6 caracteres)" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button className="w-full rounded-xl" onClick={emailAuth} disabled={loading}>{authMode === "signup" ? "Criar minha conta" : "Entrar"}</Button>
              <button className="w-full text-center text-xs font-semibold text-primary" onClick={() => setAuthMode(authMode === "signup" ? "login" : "signup")}>{authMode === "signup" ? "Já tenho conta" : "Quero criar uma conta"}</button>
              <p className="text-center text-[11px] text-muted-foreground">Cadastro não é obrigatório para comprar. Ele existe para liberar fidelidade, recompensas e benefícios do Clube.</p>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const required = Math.max(1, Number(status?.required || 10));
  const points = Math.min(required, Math.max(0, Number(status?.points || 0)));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-[11px] font-black uppercase tracking-widest text-primary">Clube HotBox</p><p className="text-sm font-bold">Olá, {status?.user?.name?.split?.(" ")?.[0] || session.user.email?.split("@")[0] || "cliente"} 👋</p></div>
        <Button size="sm" variant="ghost" onClick={logout}><LogOut className="mr-1 size-3.5" /> Sair</Button>
      </div>
      <Oven points={points} required={required} />
      {available.length > 0 && (
        <div className="rounded-[24px] border-2 border-emerald-400 bg-emerald-50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-600 text-white"><Gift className="size-6" /></div>
            <div className="min-w-0 flex-1">
              <p className="font-black text-emerald-950">Você desbloqueou uma HotBox grátis! 🎉</p>
              <p className="mt-1 text-xs text-emerald-800">Use seu cupom em 1 pedido com entrega. Ele vale 1 batata participante e expira depois do resgate.</p>
              {available.map((reward: any) => (
                <div key={reward.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-2.5 ring-1 ring-emerald-200">
                  <code className="font-black tracking-wider text-emerald-800">{reward.code}</code>
                  <Button size="sm" className="rounded-lg bg-emerald-600 hover:bg-emerald-700" onClick={() => onUseReward?.(reward.code)}>Usar meu cupom</Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {status?.rewardsEarned > 0 && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Trophy className="size-3.5 text-amber-500" /> {status.rewardsEarned} recompensa(s) conquistada(s) no Clube.</p>}
    </div>
  );
}
