import { createFileRoute, Link, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  Pizza,
  Settings,
  LogOut,
  ShieldCheck,
  Bike,
  Users,
  History,
  MessageCircle,
  Calculator,
  ExternalLink,
  ClipboardList,
  Maximize2,
  Minimize2,
  Expand,
  Shrink,
  ScrollText,
  TrendingUp,
  Truck,
  HandCoins,
  MapPinned,
  ChevronDown,
  ChevronRight,
  Ticket,
  ThumbsUp,
  WalletCards,
  Trophy,
} from "lucide-react";
import { FreightApprovalPopup } from "@/components/freight-approval-popup";
import { AutoPrintReceipt } from "@/components/auto-print-receipt";

const HOTBOX_LOGO_URL = "/images/logo-hotbox.jpeg";

export const Route = createFileRoute("/_authenticated/loja")({
  component: AdminLayout,
});

export const WIDE_MODE_EVENT = "hb:wide-mode-changed";
export function getWideMode() {
  try {
    return localStorage.getItem("hb_wide_mode") === "1";
  } catch {
    return false;
  }
}
export function setWideMode(v: boolean) {
  try {
    localStorage.setItem("hb_wide_mode", v ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(WIDE_MODE_EVENT, { detail: v }));
}

/** Conta conversas com mensagem NÃO LIDA — badge zera quando o admin abre a conversa */
async function countActiveChats(): Promise<number> {
  const { count } = await supabase
    .from("whatsapp_conversations")
    .select("id", { count: "exact", head: true })
    .eq("has_unread", true);
  return count ?? 0;
}

/** Beep alto sintetizado — não depende de nenhum arquivo, sempre funciona */
let __audioCtx: AudioContext | null = null;
function playIncomingBeep() {
  try {
    if (typeof window === "undefined") return;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    __audioCtx ||= new Ctx();
    const ctx = __audioCtx!;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    // dois bipes curtos em 880Hz/1175Hz, volume alto (0.9)
    [0, 0.22].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = i === 0 ? 880 : 1175;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.9, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.2);
    });
  } catch {
    /* som nunca pode quebrar o app */
  }
}

function AdminLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const [checking, setChecking] = useState(true);
  const [unreadChats, setUnreadChats] = useState(0);

  // badge de conversas ativas — atualiza em tempo real e a cada minuto
  useEffect(() => {
    countActiveChats().then(setUnreadChats);
    const interval = setInterval(() => countActiveChats().then(setUnreadChats), 60_000);
    const ch = supabase
      .channel("layout-active-chats")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, () => {
        countActiveChats().then(setUnreadChats);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages" }, () => {
        countActiveChats().then(setUnreadChats);
      })
      .subscribe();
    return () => {
      clearInterval(interval);
      supabase.removeChannel(ch);
    };
  }, []);
  const [isAdmin, setIsAdmin] = useState(false);
  const [anyAdmin, setAnyAdmin] = useState(true);
  const [userId, setUserId] = useState<string>("");
  const [wide, setWide] = useState(getWideMode());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = (e: any) => setWide(!!e.detail);
    window.addEventListener(WIDE_MODE_EVENT, handler);
    return () => window.removeEventListener(WIDE_MODE_EVENT, handler);
  }, []);

  // som alto sempre que chegar mensagem nova de cliente (qualquer tela da loja)
  useEffect(() => {
    const ch = supabase
      .channel("layout-incoming-msg-beep")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whatsapp_messages", filter: "direction=eq.in" },
        () => playIncomingBeep(),
      )
      .subscribe();
    // desbloqueia o AudioContext no 1º gesto do usuário (política do navegador)
    const unlock = () => {
      try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (Ctx) {
          __audioCtx ||= new Ctx();
          __audioCtx?.resume().catch(() => {});
        }
      } catch {
        /* ignore */
      }
      // Desbloqueia também o AudioContext do alarme sintetizado de pedidos
      try {
        const Ctx2 = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (Ctx2) { const tmp = new Ctx2(); tmp.resume().catch(() => {}); }
      } catch { /* ignore */ }
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  function toggleWide() {
    const next = !wide;
    setWide(next);
    setWideMode(next);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => toast.error("Não foi possível entrar em tela cheia"));
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) {
          setChecking(false);
          return;
        }
        setUserId(u.user.id);
        const { data: role } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", u.user.id)
          .eq("role", "store_admin")
          .maybeSingle();
        setIsAdmin(!!role);
        if (!role) {
          const { count } = await supabase
            .from("user_roles")
            .select("*", { count: "exact", head: true })
            .eq("role", "store_admin");
          setAnyAdmin((count ?? 0) > 0);
        }
      } catch (e) {
        console.error("admin check failed", e);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  async function claim() {
    const { data, error } = await supabase.rpc("claim_first_admin");
    if (error) return toast.error("Não foi possível reivindicar");
    if (data) {
      toast.success("Você agora é administrador da loja!");
      setIsAdmin(true);
    } else toast.error("Já existe um administrador");
  }

  async function signOut() {
    await supabase.auth.signOut();
    nav({ to: "/admin/login" });
  }

  // Itens de uso mais frequente ficam soltos, sempre visíveis. O resto entra
  // em grupos — o menu tinha 14 itens soltos e ficou grande demais pra
  // escanear rápido.
  //
  // IMPORTANTE: esse bloco (e o useState/useEffect dele) precisa ficar ANTES
  // dos returns antecipados de "Verificando acesso..." / "Acesso restrito"
  // logo abaixo — hook não pode ser chamado condicionalmente. Colocar depois
  // de um return causava "Rendered more hooks than during the previous
  // render" (erro #310) assim que `checking` virava false.
  const nav_pinned = [
    { to: "/loja/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/loja", label: "Pedidos", icon: ClipboardList, exact: true },
    { to: "/loja/chat", label: "Chat", icon: MessageCircle },
  ];

  const nav_groups: { key: string; label: string; icon: typeof Pizza; items: typeof nav_pinned }[] = [
    {
      key: "cardapio",
      label: "Cardápio",
      icon: Pizza,
      items: [
        { to: "/loja/produtos", label: "Produtos", icon: Pizza },
        { to: "/loja/precificacao", label: "Precificação", icon: Calculator },
        { to: "/loja/cupons", label: "Cupons", icon: Ticket },
      ],
    },
    {
      key: "entrega",
      label: "Entrega",
      icon: Truck,
      items: [
        { to: "/loja/frete", label: "Frete", icon: Truck },
        { to: "/loja/zonas-entrega", label: "Zonas", icon: MapPinned },
        { to: "/loja/entregadores", label: "Entregadores", icon: Bike },
      ],
    },
    {
      key: "comercial",
      label: "Comercial",
      icon: TrendingUp,
      items: [
        { to: "/loja/pedidos", label: "Histórico", icon: History },
        { to: "/loja/financeiro", label: "Financeiro", icon: TrendingUp },
        { to: "/loja/financeiro-cardapio", label: "Financeiro Cardápio", icon: WalletCards },
        { to: "/loja/fidelidade", label: "Clube HotBox", icon: Trophy },
        { to: "/loja/receber", label: "A Receber", icon: HandCoins },
        { to: "/loja/leads", label: "Leads", icon: Users },
        { to: "/loja/avaliacoes", label: "Avaliações", icon: ThumbsUp },
      ],
    },
    {
      key: "sistema",
      label: "Sistema",
      icon: Settings,
      items: [
        { to: "/loja/logs", label: "Logs", icon: ScrollText },
        { to: "/loja/config", label: "Config", icon: Settings },
      ],
    },
  ];

  function isItemActive(n: { to: string; exact?: boolean }) {
    return n.exact ? loc.pathname === n.to : loc.pathname.startsWith(n.to);
  }
  function isGroupActive(group: (typeof nav_groups)[number]) {
    return group.items.some(isItemActive);
  }

  // Grupo com a rota ativa começa aberto; os outros começam fechados. O
  // usuário pode abrir/fechar livremente depois — só reabre sozinho quando a
  // navegação entra num grupo diferente.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const g of nav_groups) initial[g.key] = isGroupActive(g);
    return initial;
  });
  useEffect(() => {
    const active = nav_groups.find(isGroupActive);
    if (active) setOpenGroups((prev) => (prev[active.key] ? prev : { ...prev, [active.key]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);
  function toggleGroup(key: string) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  if (checking)
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Verificando acesso...</div>;

  if (!isAdmin) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4">
        <Card className="w-full max-w-md p-6 text-center">
          <ShieldCheck className="mx-auto mb-3 size-10 text-primary" />
          <h1 className="text-xl font-bold">Acesso restrito</h1>
          {!anyAdmin ? (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                Nenhum administrador cadastrado. Como você é o primeiro, pode se tornar o dono da loja.
              </p>
              <Button className="mt-4 w-full" onClick={claim}>
                Sou o dono da loja
              </Button>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Peça a um administrador para liberar seu acesso.</p>
          )}
          <Button variant="outline" className="mt-3 w-full" onClick={signOut}>
            Sair
          </Button>
        </Card>
      </div>
    );
  }

  const isChatPage = loc.pathname.startsWith("/loja/chat");
  const horizontal = wide || isChatPage;

  return (
    <div className="min-h-screen bg-background lg:flex lg:flex-col">
      <FreightApprovalPopup />
      <AutoPrintReceipt />
      {/* botões de tela larga / tela cheia — fixos, aparecem em qualquer página */}

      <div className="fixed right-3 top-3 z-50 flex gap-1.5">
        <Button
          variant="outline"
          size="icon"
          className="bg-background shadow-md"
          title={wide ? "Mostrar menu" : "Tela larga (esconde o menu)"}
          onClick={toggleWide}
        >
          {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="bg-background shadow-md"
          title={isFullscreen ? "Sair da tela cheia (Esc)" : "Tela cheia (F11)"}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Shrink className="size-4" /> : <Expand className="size-4" />}
        </Button>
      </div>

      {!horizontal && (
        <div className="lg:flex lg:flex-1">
          <aside className="sticky top-0 z-30 hidden h-screen w-64 shrink-0 flex-col justify-between overflow-y-auto bg-foreground px-4 py-5 lg:flex">
            <div>
              <Link to="/loja/dashboard" className="mb-6 flex items-center gap-3 px-1">
                <img src={HOTBOX_LOGO_URL} alt="HotBox Delivery" className="h-14 w-14 rounded-xl object-contain shadow" />
                <div className="leading-tight">
                  <p className="font-display text-lg font-black text-background">
                    HOT<span className="text-primary">BOX</span>
                  </p>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Delivery</p>
                </div>
              </Link>

              <nav className="space-y-1">
                {nav_pinned.map((n) => {
                  const Icon = n.icon;
                  const active = isItemActive(n);
                  const isChat = n.to === "/loja/chat";
                  const hasUnread = isChat && unreadChats > 0;
                  return (
                    <Link
                      key={n.to}
                      to={n.to}
                      className={`group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-background text-foreground shadow-sm" : "text-background/70 hover:bg-background/10 hover:text-background"}`}
                    >
                      <span className="flex items-center gap-3">
                        <span className="relative">
                          <Icon className={`size-[18px] ${hasUnread && !active ? "text-emerald-400" : ""}`} />
                          {hasUnread && (
                            <span className="absolute -right-1 -top-1 flex size-2 items-center justify-center">
                              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                            </span>
                          )}
                        </span>
                        {n.label}
                        {hasUnread && (
                          <span className="ml-1 rounded-full bg-emerald-400 px-1.5 py-0.5 text-[10px] font-bold leading-none text-foreground">
                            {unreadChats}
                          </span>
                        )}
                      </span>
                      {active && <span className="size-1.5 rounded-full bg-primary" />}
                    </Link>
                  );
                })}

                <div className="my-2 border-t border-background/10" />

                {nav_groups.map((group) => {
                  const GroupIcon = group.icon;
                  const groupActive = isGroupActive(group);
                  const open = !!openGroups[group.key];
                  return (
                    <Collapsible key={group.key} open={open} onOpenChange={() => toggleGroup(group.key)}>
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition ${groupActive ? "text-background" : "text-background/70 hover:bg-background/10 hover:text-background"}`}
                        >
                          <span className="flex items-center gap-3">
                            <GroupIcon className="size-[18px]" />
                            {group.label}
                          </span>
                          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-1 py-1 pl-4">
                        {group.items.map((n) => {
                          const Icon = n.icon;
                          const active = isItemActive(n);
                          return (
                            <Link
                              key={n.to}
                              to={n.to}
                              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition ${active ? "bg-background text-foreground shadow-sm" : "text-background/70 hover:bg-background/10 hover:text-background"}`}
                            >
                              <Icon className="size-4" />
                              {n.label}
                            </Link>
                          );
                        })}
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}

                <div className="my-2 border-t border-background/10" />

                <a
                  href="/entregador/login"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold text-background/70 transition hover:bg-background/10 hover:text-background"
                >
                  <span className="flex items-center gap-3">
                    <Bike className="size-[18px]" /> App do Entregador
                  </span>
                  <ExternalLink className="size-3.5 opacity-60" />
                </a>
              </nav>
            </div>

            <Button
              variant="ghost"
              onClick={signOut}
              className="justify-start gap-3 text-background/70 hover:bg-background/10 hover:text-background"
            >
              <LogOut className="size-4" /> Sair
            </Button>
          </aside>

          <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-foreground px-4 py-3 lg:hidden">
            <Link to="/loja/dashboard" className="flex items-center gap-2">
              <img src={HOTBOX_LOGO_URL} alt="HotBox Delivery" className="h-11 w-11 rounded-lg object-contain" />
              <span className="font-display font-bold text-background">
                HOT<span className="text-primary">BOX</span>
              </span>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-background/70 hover:bg-background/10 hover:text-background"
            >
              <LogOut className="size-4" />
            </Button>
          </header>

          <main className="mx-auto max-w-7xl flex-1 px-4 py-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      )}

      {horizontal && (
        <>
          <header className="sticky top-0 z-30 flex items-center gap-1 overflow-x-auto border-b bg-foreground px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link to="/loja/dashboard" className="mr-3 flex shrink-0 items-center gap-2">
              <img src={HOTBOX_LOGO_URL} alt="HotBox Delivery" className="h-10 w-10 rounded-lg object-contain" />
            </Link>
            {nav_pinned.map((n) => {
              const Icon = n.icon;
              const active = isItemActive(n);
              const isChat = n.to === "/loja/chat";
              const hasUnread = isChat && unreadChats > 0;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-background text-foreground" : "text-background/70 hover:bg-background/10 hover:text-background"}`}
                >
                  <span className="relative">
                    <Icon className={`size-3.5 ${hasUnread && !active ? "text-emerald-400" : ""}`} />
                    {hasUnread && (
                      <span className="absolute -right-1 -top-1 flex size-1.5 items-center justify-center">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                      </span>
                    )}
                  </span>
                  {n.label}
                  {hasUnread && (
                    <span className="rounded-full bg-emerald-400 px-1 py-0.5 text-[9px] font-bold leading-none text-foreground">
                      {unreadChats}
                    </span>
                  )}
                </Link>
              );
            })}

            <div className="mx-1 h-4 w-px shrink-0 bg-background/15" />

            {nav_groups.map((group) => {
              const GroupIcon = group.icon;
              const groupActive = isGroupActive(group);
              return (
                <DropdownMenu key={group.key}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${groupActive ? "bg-background text-foreground" : "text-background/70 hover:bg-background/10 hover:text-background"}`}
                    >
                      <GroupIcon className="size-3.5" />
                      {group.label}
                      <ChevronDown className="size-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                    {group.items.map((n) => {
                      const Icon = n.icon;
                      const active = isItemActive(n);
                      return (
                        <DropdownMenuItem key={n.to} asChild className={active ? "bg-accent" : ""}>
                          <Link to={n.to} className="flex items-center gap-2">
                            <Icon className="size-4" /> {n.label}
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="ml-auto shrink-0 text-background/70 hover:bg-background/10 hover:text-background"
            >
              <LogOut className="size-4" />
            </Button>
          </header>
          <main className="flex-1 px-4 py-6">
            <Outlet />
          </main>
        </>
      )}
    </div>
  );
}
