import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { analyticsHealthFn } from "@/lib/analytics-health.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Eye,
  ShoppingCart,
  CreditCard,
  CheckCircle2,
  Ban,
  Printer,
  RefreshCw,
  TrendingUp,
  MousePointerClick,
  Smartphone,
  Monitor,
  Tablet,
  Search,
  PackageOpen,
  Route,
  CircleDollarSign,
  UserRound,
  Megaphone,
  MapPin,
  Clock3,
  HelpCircle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/loja/analytics")({
  component: AnalyticsPage,
});

type SessionRow = any;
type EventRow = any;

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v || 0);

const pct = (a: number, b: number) =>
  b ? `${((a / b) * 100).toFixed(1)}%` : "0,0%";

const dt = (v: string) =>
  new Date(v).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

const SOURCE_LABEL: Record<string, string> = {
  direct: "Acessou diretamente",
  instagram: "Instagram",
  facebook: "Facebook",
  meta_ads: "Anúncio da Meta (Facebook ou Instagram)",
  google: "Google",
  whatsapp: "WhatsApp",
  bio: "Página da Bio",
  ifood: "iFood",
  "99food": "99Food",
  referral: "Veio de outro site",
  none: "Não identificado",
};

const DEVICE_LABEL: Record<string, string> = {
  mobile: "Celular",
  tablet: "Tablet",
  desktop: "Computador",
};

const PAYMENT_LABEL: Record<string, string> = {
  pix: "Pix",
  card: "Cartão",
  credit: "Cartão",
  debit: "Cartão",
  delivery_card: "Cartão na entrega",
  delivery_pix: "Pix na entrega",
  mercadopago: "Mercado Pago",
  appmax: "Appmax",
  infinitepay: "InfinitePay",
  stripe: "Stripe",
  online: "Pagamento online",
};

const EVENT_LABEL: Record<string, string> = {
  page_view: "Entrou em uma página",
  product_view: "Abriu um produto",
  add_to_cart: "Colocou produto na sacola",
  order_bump_added: "Aceitou uma oferta extra",
  cart_opened: "Abriu a sacola",
  checkout_started: "Começou a finalizar o pedido",
  checkout_created: "Pedido foi preparado para pagamento",
  checkout_submitted: "Enviou os dados do pedido",
  payment_selected: "Escolheu como pagar",
  payment_redirect: "Foi para a tela de pagamento",
  payment_started: "Começou o pagamento",
  payment_failed: "Pagamento no cartão não foi aprovado",
  purchase: "Compra confirmada",
  order_created: "Pedido criado",
  click: "Clicou em um botão ou link",
  lead: "Entrou em contato",
  contact: "Entrou em contato",
};

function niceSource(value: unknown) {
  const raw = String(value || "").trim();
  return SOURCE_LABEL[raw] || raw || "Não identificado";
}

function niceDevice(value: unknown) {
  const raw = String(value || "").trim();
  return DEVICE_LABEL[raw] || raw || "Não identificado";
}

function nicePayment(value: unknown) {
  const raw = String(value || "").trim();
  return PAYMENT_LABEL[raw] || raw || "Não identificado";
}

function niceEvent(value: unknown) {
  const raw = String(value || "").trim();
  return EVENT_LABEL[raw] || "Interagiu com o cardápio";
}

function friendlyPagePath(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "Página não identificada";

  let path = raw;

  try {
    if (/^https?:\/\//i.test(raw)) {
      path = new URL(raw).pathname;
    } else {
      path = raw.split("?")[0].split("#")[0];
    }
  } catch {
    path = raw.split("?")[0].split("#")[0];
  }

  path = path.replace(/\/+$/, "") || "/";

  const exact: Record<string, string> = {
    "/": "Cardápio Digital — página principal",
    "/cardapio": "Cardápio Digital",
    "/bio": "Página da Bio — links da HotBox",
    "/obrigado": "Confirmação após a compra",
    "/avaliacao": "Página de avaliação do pedido",
    "/politica-de-privacidade": "Política de Privacidade",
    "/privacidade": "Política de Privacidade",
    "/termos": "Termos de uso",
    "/checkout": "Finalização do pedido",
    "/sacola": "Sacola de compras",
  };

  if (exact[path]) return exact[path];

  if (/^\/produto\//i.test(path)) {
    const slug = decodeURIComponent(path.split("/").filter(Boolean).slice(1).join(" "));
    return slug
      ? `Produto — ${slug.replace(/[-_]+/g, " ")}`
      : "Detalhes de um produto";
  }

  if (/^\/pedido\//i.test(path)) {
    return "Acompanhamento de pedido";
  }

  if (/^\/avaliacao\//i.test(path)) {
    return "Avaliação de pedido";
  }

  // Nunca exibe uma rota técnica crua para o usuário do painel.
  const readable = decodeURIComponent(path)
    .split("/")
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    )
    .join(" › ");

  return readable ? `Página — ${readable}` : "Página não identificada";
}


function canonicalPageKey(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "/";

  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      return (url.pathname || "/").replace(/\/+$/, "") || "/";
    }
  } catch {
    // segue para limpeza simples
  }

  const path = raw.split("?")[0].split("#")[0];
  return (path || "/").replace(/\/+$/, "") || "/";
}

function EmptyMessage({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [search, setSearch] = useState("");
  const [health, setHealth] = useState<any>(null);

  async function load() {
    setLoading(true);

    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [s, e, h] = await Promise.all([
      (supabase as any)
        .from("analytics_sessions")
        .select("*")
        .gte("first_seen_at", since)
        .order("first_seen_at", { ascending: false })
        .limit(10000),
      (supabase as any)
        .from("analytics_events")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(30000),
      analyticsHealthFn().catch((error: any) => ({
        ok: false,
        exception: error?.message || String(error),
      })),
    ]);

    setSessions(s.data || []);
    setEvents(e.data || []);
    setHealth({
      ...h,
      client_sessions_error: s.error?.message || null,
      client_events_error: e.error?.message || null,
    });
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [days]);

  const eventSet = useMemo(() => {
    const by = new Map<string, Set<string>>();

    events.forEach((e) => {
      if (!by.has(e.session_id)) by.set(e.session_id, new Set());
      by.get(e.session_id)!.add(e.event_name);
    });

    return by;
  }, [events]);

  const countStep = (names: string[]) =>
    sessions.filter((s) =>
      names.some((n) => eventSet.get(s.id)?.has(n)),
    ).length;

  const visitors = new Set(sessions.map((s) => s.visitor_id)).size;
  const converted = sessions.filter((s) => s.converted).length;
  const revenue = sessions.reduce(
    (a, s) => a + Number(s.revenue || 0),
    0,
  );
  const pageViews = events.filter(
    (e) => e.event_name === "page_view",
  ).length;
  const productViews = countStep(["product_view"]);
  const addCart = countStep([
    "add_to_cart",
    "order_bump_added",
  ]);
  const checkout = countStep([
    "checkout_started",
    "checkout_created",
  ]);
  const payment = countStep([
    "payment_selected",
    "payment_redirect",
    "payment_started",
  ]);
  const now = Date.now();

  const abandoned = sessions.filter(
    (s) =>
      !s.converted &&
      now - new Date(s.last_seen_at).getTime() > 15 * 60000 &&
      (eventSet.get(s.id)?.has("add_to_cart") ||
        eventSet.get(s.id)?.has("checkout_started")),
  ).length;

  const rejectedPayments = events.filter(
    (e) => e.event_name === "payment_failed",
  );
  const rejectedCardCount = rejectedPayments.length;
  const rejectedCardValue = rejectedPayments.reduce(
    (sum, e) => sum + Number(e.value || 0),
    0,
  );

  const metaSessions = sessions.filter((s) =>
    ["facebook", "instagram", "meta_ads"].includes(String(s.source || "")),
  );
  const facebookSessions = sessions.filter(
    (s) => String(s.source || "") === "facebook",
  );
  const metaPurchases = metaSessions.filter((s) => s.converted);
  const metaRevenue = metaSessions.reduce(
    (sum, s) => sum + Number(s.revenue || 0),
    0,
  );

  const avgTicket = converted ? revenue / converted : 0;

  function groupSessions(field: string) {
    const m = new Map<
      string,
      { count: number; conv: number; revenue: number }
    >();

    sessions.forEach((s) => {
      const k = String(s[field] || "Não identificado");
      const x = m.get(k) || {
        count: 0,
        conv: 0,
        revenue: 0,
      };
      x.count++;
      if (s.converted) x.conv++;
      x.revenue += Number(s.revenue || 0);
      m.set(k, x);
    });

    return [...m.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 12);
  }

  function groupEvents(name: string, field: string) {
    const m = new Map<
      string,
      { count: number; value: number }
    >();

    events
      .filter((e) => e.event_name === name)
      .forEach((e) => {
        const k = String(
          e[field] ||
            e.properties?.[field] ||
            "Não identificado",
        );
        const x = m.get(k) || { count: 0, value: 0 };
        x.count += Number(e.quantity || 1);
        x.value += Number(e.value || 0);
        m.set(k, x);
      });

    return [...m.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 12);
  }

  function groupPageViews() {
    const m = new Map<
      string,
      { count: number; value: number }
    >();

    events
      .filter((e) => e.event_name === "page_view")
      .forEach((e) => {
        const raw =
          e.page_path ||
          e.properties?.page_path ||
          e.properties?.event_source_url ||
          "/";
        const key = canonicalPageKey(raw);
        const x = m.get(key) || { count: 0, value: 0 };
        x.count += 1;
        x.value += Number(e.value || 0);
        m.set(key, x);
      });

    return [...m.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 12);
  }

  const journey = sessions
    .filter((s) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;

      return [
        s.customer_name,
        s.customer_phone,
        s.source,
        s.campaign,
        s.order_id,
        s.checkout_id,
        s.visitor_id,
      ].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(q),
      );
    })
    .slice(0, 120);

  const funnel = [
    {
      label: "Pessoas que entraram",
      value: sessions.length,
      help: "Cada entrada no cardápio ou na Bio dentro do período escolhido.",
    },
    {
      label: "Abriram algum produto",
      value: productViews,
      help: "Pessoas que tocaram em um produto para ver os detalhes.",
    },
    {
      label: "Colocaram algo na sacola",
      value: addCart,
      help: "Pessoas que demonstraram intenção de compra adicionando um item.",
    },
    {
      label: "Começaram a finalizar",
      value: checkout,
      help: "Pessoas que avançaram para informar dados e concluir o pedido.",
    },
    {
      label: "Começaram o pagamento",
      value: payment,
      help: "Pessoas que chegaram à etapa de escolher ou iniciar o pagamento.",
    },
    {
      label: "Compraram",
      value: converted,
      help: "Pessoas que concluíram uma compra no período.",
    },
  ];

  const cards = [
    {
      title: "Pessoas diferentes",
      value: visitors,
      icon: Users,
      help: "Quantidade aproximada de pessoas diferentes que acessaram suas páginas.",
    },
    {
      title: "Entradas no cardápio",
      value: sessions.length,
      icon: Eye,
      help: "Uma mesma pessoa pode entrar mais de uma vez em momentos diferentes.",
    },
    {
      title: "Compras concluídas",
      value: `${converted} (${pct(converted, sessions.length)})`,
      icon: CheckCircle2,
      help: "Mostra quantas visitas terminaram em compra.",
    },
    {
      title: "Valor das compras",
      value: brl(revenue),
      icon: TrendingUp,
      help: "Total de vendas que o sistema conseguiu ligar às visitas mostradas aqui.",
    },
    {
      title: "Páginas abertas",
      value: pageViews,
      icon: MousePointerClick,
      help: "Total de vezes que as páginas acompanhadas foram abertas.",
    },
    {
      title: "Colocaram na sacola",
      value: addCart,
      icon: ShoppingCart,
      help: "Pessoas que adicionaram pelo menos um produto à sacola.",
    },
    {
      title: "Foram finalizar",
      value: checkout,
      icon: CreditCard,
      help: "Pessoas que chegaram à parte final do pedido.",
    },
    {
      title: "Desistiram no caminho",
      value: abandoned,
      icon: Ban,
      help: "Pessoas que colocaram algo na sacola ou começaram a finalizar, mas não compraram e ficaram mais de 15 minutos sem continuar.",
    },
    {
      title: "Cartões não aprovados",
      value: rejectedCardCount,
      icon: CreditCard,
      help: "Quantidade de tentativas de pagamento no cartão que não foram aprovadas. Uma mesma pessoa pode tentar mais de uma vez.",
    },
    {
      title: "Vieram da Meta",
      value: metaSessions.length,
      icon: Megaphone,
      help: "Visitas identificadas como vindas do Facebook, Instagram ou de um anúncio da Meta.",
    },
  ];

  const connected =
    health?.ok &&
    !health?.client_sessions_error &&
    !health?.client_events_error;

  return (
    <div className="space-y-6 p-4 md:p-6 print:p-0">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-black">
            Entenda seus clientes
          </h1>
          <p className="text-sm text-muted-foreground">
            Veja de onde as pessoas chegam, o que fazem no cardápio
            e em que ponto compram ou desistem.
          </p>
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          {[1, 7, 15, 30, 90].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? "default" : "outline"}
              onClick={() => setDays(d)}
            >
              {d === 1 ? "Hoje" : `Últimos ${d} dias`}
            </Button>
          ))}

          <Button
            size="sm"
            variant="outline"
            onClick={() => void load()}
          >
            <RefreshCw className="mr-2 size-4" />
            Atualizar informações
          </Button>

          <Button
            size="sm"
            onClick={() => window.print()}
          >
            <Printer className="mr-2 size-4" />
            Imprimir
          </Button>
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-2xl font-black">
          HotBox — Relatório de clientes e vendas
        </h1>
        <p>
          Período: últimos {days} dias • Impresso em{" "}
          {new Date().toLocaleString("pt-BR")}
        </p>
      </div>

      {!loading && health && (
        <Card
          className={`p-4 ${
            connected
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-red-500/40 bg-red-500/5"
          }`}
        >
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-black">
                {connected
                  ? "Tudo funcionando normalmente"
                  : "O sistema não conseguiu carregar todas as informações"}
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {connected
                  ? sessions.length || events.length
                    ? "As visitas e ações dos clientes estão sendo registradas."
                    : "O acompanhamento está ativo. Como os dados foram zerados ou ainda não houve novas visitas, os números estão vazios."
                  : "Atualize a página. Se continuar, será necessário revisar a conexão com o banco de dados."}
              </p>

              {!connected &&
                (health.sessions_error ||
                  health.events_error ||
                  health.exception ||
                  health.client_sessions_error ||
                  health.client_events_error) && (
                  <div className="mt-2 rounded-lg border bg-background p-2 text-xs">
                    <b>O que aconteceu:</b>{" "}
                    {health.sessions_error?.message ||
                      health.events_error?.message ||
                      health.exception ||
                      health.client_sessions_error ||
                      health.client_events_error}
                  </div>
                )}
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
            >
              <RefreshCw className="mr-2 size-4" />
              Tentar novamente
            </Button>
          </div>
        </Card>
      )}

      <Card className="border-orange-200 bg-orange-50/50 p-5">
        <div className="flex gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-orange-100">
            <HelpCircle className="size-5" />
          </span>
          <div>
            <h2 className="font-black">
              Como ler esta página
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Comece pelos cartões abaixo. Eles mostram quantas pessoas
              chegaram, quantas demonstraram interesse e quantas compraram.
              Depois veja o caminho da compra para descobrir onde mais pessoas
              estão desistindo. As demais áreas mostram quais canais,
              campanhas, produtos, aparelhos e formas de pagamento trouxeram
              mais resultado.
            </p>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card className="p-10 text-center">
          Carregando as informações dos clientes...
        </Card>
      ) : (
        <>
          {sessions.length === 0 && events.length === 0 && (
            <Card className="border-dashed p-8 text-center">
              <PackageOpen className="mx-auto size-10 text-muted-foreground" />
              <h2 className="mt-3 text-lg font-black">
                Ainda não há dados neste período
              </h2>
              <p className="mx-auto mt-1 max-w-2xl text-sm text-muted-foreground">
                A contagem começa novamente a partir das próximas visitas.
                Quando alguém entrar na Bio ou no Cardápio Digital, esta
                página será preenchida automaticamente.
              </p>
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map(({ title, value, icon: Icon, help }) => (
              <Card key={title} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
                    <Icon className="size-5" />
                  </span>

                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase text-muted-foreground">
                      {title}
                    </p>
                    <p className="text-2xl font-black">{value}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {help}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs font-bold uppercase text-muted-foreground">
                Valor médio de cada compra
              </p>
              <p className="mt-1 text-2xl font-black">
                {brl(avgTicket)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Quanto cada compra concluída valeu em média.
              </p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-bold uppercase text-muted-foreground">
                Quem abriu produto
              </p>
              <p className="mt-1 text-2xl font-black">
                {pct(productViews, sessions.length)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Percentual das visitas que demonstraram interesse em algum produto.
              </p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-bold uppercase text-muted-foreground">
                Quem colocou na sacola
              </p>
              <p className="mt-1 text-2xl font-black">
                {pct(addCart, sessions.length)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Percentual das visitas que chegaram a adicionar algum item.
              </p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-bold uppercase text-muted-foreground">
                Quem comprou
              </p>
              <p className="mt-1 text-2xl font-black">
                {pct(converted, sessions.length)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Percentual das visitas que terminaram em venda.
              </p>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <Route className="mt-0.5 size-5" />
                <div>
                  <h2 className="font-black">
                    Caminho até a compra
                  </h2>
                  <p className="mb-4 text-xs text-muted-foreground">
                    Mostra quantas pessoas avançaram em cada etapa. Quando
                    houver uma queda grande entre duas etapas, é ali que vale
                    investigar primeiro.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {funnel.map((item, i) => {
                  const max = Math.max(1, sessions.length);
                  const previous =
                    i > 0 ? funnel[i - 1].value : item.value;
                  const lost = Math.max(0, previous - item.value);

                  return (
                    <div key={item.label}>
                      <div className="mb-1 flex justify-between gap-3 text-sm">
                        <div>
                          <b>{item.label}</b>
                          <p className="text-[11px] text-muted-foreground">
                            {item.help}
                          </p>
                        </div>
                        <span className="shrink-0 font-bold">
                          {item.value} • {pct(item.value, max)}
                        </span>
                      </div>

                      <div className="h-3 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-foreground"
                          style={{
                            width: `${Math.max(
                              item.value ? 2 : 0,
                              (item.value / max) * 100,
                            )}%`,
                          }}
                        />
                      </div>

                      {i > 0 && previous > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {lost === 0
                            ? "Ninguém foi perdido nesta passagem."
                            : `${lost} pessoa(s) não avançaram para esta etapa (${pct(
                                lost,
                                previous,
                              )}).`}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-start gap-3">
                <Megaphone className="mt-0.5 size-5" />
                <div>
                  <h2 className="font-black">
                    De onde seus clientes estão vindo
                  </h2>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Compare quais canais trouxeram mais visitas, compras e valor vendido. Facebook, Instagram e anúncios da Meta aparecem separados quando a origem pode ser identificada.
                  </p>
                </div>
              </div>

              {groupSessions("source").length === 0 ? (
                <EmptyMessage text="Ainda não há visitas para comparar." />
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2">De onde veio</th>
                        <th>Entradas</th>
                        <th>Compras</th>
                        <th>Compraram</th>
                        <th>Valor vendido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupSessions("source").map(([k, x]) => (
                        <tr key={k} className="border-b">
                          <td className="py-2 font-bold">
                            {niceSource(k)}
                          </td>
                          <td>{x.count}</td>
                          <td>{x.conv}</td>
                          <td>{pct(x.conv, x.count)}</td>
                          <td>{brl(x.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="p-5">
              <h2 className="font-black">
                Onde as pessoas mais entram
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Os endereços com códigos de anúncio são agrupados automaticamente. Você verá apenas o nome real da página.
              </p>

              <div className="mt-3 space-y-2">
                {groupPageViews().length === 0 ? (
                  <EmptyMessage text="Ainda não há páginas registradas." />
                ) : (
                  groupPageViews().map(([k, x], i) => (
                    <div
                      key={k}
                      className="flex justify-between gap-3 border-b pb-2 text-sm"
                    >
                      <span className="max-w-[72%]">
                        <b>
                          {i + 1}. {friendlyPagePath(k)}
                        </b>
                      </span>
                      <span className="shrink-0">
                        {x.count} {x.count === 1 ? "visita" : "visitas"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="font-black">
                Botões e links mais clicados
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Mostra o que mais chama a atenção dos visitantes.
              </p>

              <div className="mt-3 space-y-2">
                {groupEvents("click", "analytics_label").length === 0 ? (
                  <EmptyMessage text="Ainda não há cliques registrados." />
                ) : (
                  groupEvents("click", "analytics_label").map(
                    ([k, x], i) => (
                      <div
                        key={k}
                        className="flex justify-between gap-3 border-b pb-2 text-sm"
                      >
                        <span className="max-w-[68%] truncate">
                          <b>
                            {i + 1}. {k}
                          </b>
                        </span>
                        <span>{x.count} clique(s)</span>
                      </div>
                    ),
                  )
                )}
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2">
                <MapPin className="size-4" />
                <h2 className="font-black">
                  Cidade aproximada
                </h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Local aproximado informado pela conexão do visitante. Pode não ser exato.
              </p>

              <div className="mt-3 space-y-2">
                {groupSessions("city").length === 0 ? (
                  <EmptyMessage text="Ainda não há localização disponível." />
                ) : (
                  groupSessions("city").map(([k, x]) => (
                    <div
                      key={k}
                      className="flex justify-between gap-3 border-b pb-2 text-sm"
                    >
                      <span className="font-bold">{k}</span>
                      <span>
                        {x.count} entrada(s) • {x.conv} compra(s)
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="p-5">
              <h2 className="font-black">
                Campanhas que trouxeram visitas
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Quando o link do anúncio ou postagem identifica a campanha,
                ela aparece aqui.
              </p>

              <div className="mt-3 space-y-2">
                {groupSessions("campaign").length === 0 ? (
                  <EmptyMessage text="Nenhuma campanha identificada neste período." />
                ) : (
                  groupSessions("campaign").map(([k, x]) => (
                    <div
                      key={k}
                      className="flex justify-between gap-3 border-b pb-2 text-sm"
                    >
                      <span className="max-w-[60%] truncate font-bold">
                        {k}
                      </span>
                      <span>
                        {x.count} entrada(s) • {x.conv} compra(s)
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="font-black">
                Como as pessoas acessam
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Mostra se seus clientes usam mais celular, computador ou tablet.
              </p>

              <div className="mt-3 space-y-2">
                {groupSessions("device_type").length === 0 ? (
                  <EmptyMessage text="Ainda não há aparelhos registrados." />
                ) : (
                  groupSessions("device_type").map(([k, x]) => {
                    const Icon =
                      k === "mobile"
                        ? Smartphone
                        : k === "tablet"
                          ? Tablet
                          : Monitor;

                    return (
                      <div
                        key={k}
                        className="flex items-center justify-between gap-3 border-b pb-2 text-sm"
                      >
                        <span className="flex items-center gap-2 font-bold">
                          <Icon className="size-4" />
                          {niceDevice(k)}
                        </span>
                        <span>
                          {x.count} entrada(s) • {x.conv} compra(s)
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2">
                <CircleDollarSign className="size-4" />
                <h2 className="font-black">
                  Como preferem pagar
                </h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Veja quais formas de pagamento aparecem com mais frequência.
              </p>

              <div className="mt-3 space-y-2">
                {groupSessions("payment_method").length === 0 ? (
                  <EmptyMessage text="Ainda não há pagamentos registrados." />
                ) : (
                  groupSessions("payment_method").map(([k, x]) => (
                    <div
                      key={k}
                      className="flex justify-between gap-3 border-b pb-2 text-sm"
                    >
                      <span className="font-bold">
                        {nicePayment(k)}
                      </span>
                      <span>
                        {x.count} registro(s) • {x.conv} compra(s)
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <CreditCard className="mt-0.5 size-5" />
                <div>
                  <h2 className="font-black">
                    Pagamentos no cartão que não foram aprovados
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Aqui você consegue ver quantas tentativas foram recusadas e o motivo informado pelo meio de pagamento. Isso ajuda a diferenciar desistência do cliente de uma venda perdida por recusa do cartão.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border p-3">
                  <p className="text-xs font-bold text-muted-foreground">
                    Tentativas não aprovadas
                  </p>
                  <p className="text-2xl font-black">{rejectedCardCount}</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs font-bold text-muted-foreground">
                    Valor que tentou ser pago
                  </p>
                  <p className="text-2xl font-black">{brl(rejectedCardValue)}</p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {rejectedPayments.length === 0 ? (
                  <EmptyMessage text="Nenhum cartão recusado foi registrado neste período." />
                ) : (
                  rejectedPayments.slice(0, 20).map((e: any) => (
                    <div key={e.id} className="rounded-xl border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <b>
                          {String(
                            e.properties?.reason_friendly ||
                              "Pagamento não aprovado",
                          )}
                        </b>
                        <span className="text-xs text-muted-foreground">
                          {dt(e.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Valor: {brl(Number(e.value || 0))}
                        {e.checkout_id ? ` • Tentativa ligada ao pedido em andamento` : ""}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-start gap-3">
                <Megaphone className="mt-0.5 size-5" />
                <div>
                  <h2 className="font-black">
                    Resultado de quem veio do Facebook e Instagram
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    O sistema identifica Facebook e Instagram quando o link ou a página de origem permite. Quando existe apenas o identificador do anúncio da Meta, sem dizer qual aplicativo abriu o link, mostramos como “Anúncio da Meta (Facebook ou Instagram)” para não dar uma informação errada.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border p-3">
                  <p className="text-xs font-bold text-muted-foreground">
                    Visitas vindas da Meta
                  </p>
                  <p className="text-2xl font-black">{metaSessions.length}</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs font-bold text-muted-foreground">
                    Compras dessas visitas
                  </p>
                  <p className="text-2xl font-black">{metaPurchases.length}</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs font-bold text-muted-foreground">
                    Valor vendido para essas visitas
                  </p>
                  <p className="text-2xl font-black">{brl(metaRevenue)}</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs font-bold text-muted-foreground">
                    Facebook identificado diretamente
                  </p>
                  <p className="text-2xl font-black">{facebookSessions.length}</p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {[
                  ["Facebook", sessions.filter((s) => s.source === "facebook")],
                  ["Instagram", sessions.filter((s) => s.source === "instagram")],
                  ["Anúncio da Meta (Facebook ou Instagram)", sessions.filter((s) => s.source === "meta_ads")],
                ].map(([label, rows]: any) => {
                  const list = rows as any[];
                  const purchases = list.filter((s) => s.converted).length;
                  const value = list.reduce((sum, s) => sum + Number(s.revenue || 0), 0);
                  return (
                    <div key={label} className="flex justify-between gap-3 border-b pb-2 text-sm">
                      <span className="font-bold">{label}</span>
                      <span className="text-right">
                        {list.length} visita(s) • {purchases} compra(s) • {brl(value)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-black">
                Produtos que mais despertaram interesse
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                São os produtos que mais pessoas abriram para ver detalhes.
              </p>

              <div className="mt-3 space-y-2">
                {groupEvents("product_view", "product_name").length ===
                0 ? (
                  <EmptyMessage text="Ainda não há visualizações de produtos." />
                ) : (
                  groupEvents("product_view", "product_name").map(
                    ([k, x], i) => (
                      <div
                        key={k}
                        className="flex justify-between gap-3 border-b pb-2 text-sm"
                      >
                        <span>
                          <b>
                            {i + 1}. {k}
                          </b>
                        </span>
                        <span>{x.count} abertura(s)</span>
                      </div>
                    ),
                  )
                )}
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="font-black">
                Produtos que mais foram para a sacola
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Mostra os itens com maior intenção de compra.
              </p>

              <div className="mt-3 space-y-2">
                {groupEvents("add_to_cart", "product_name").length ===
                0 ? (
                  <EmptyMessage text="Ainda não há itens adicionados à sacola." />
                ) : (
                  groupEvents("add_to_cart", "product_name").map(
                    ([k, x], i) => (
                      <div
                        key={k}
                        className="flex justify-between gap-3 border-b pb-2 text-sm"
                      >
                        <span>
                          <b>
                            {i + 1}. {k}
                          </b>
                        </span>
                        <span>{x.count} unidade(s)</span>
                      </div>
                    ),
                  )
                )}
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <div className="flex flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <UserRound className="size-4" />
                  <h2 className="font-black">
                    O caminho de cada visitante
                  </h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Veja, pessoa por pessoa, quando entrou, de onde veio,
                  o que fez no cardápio e se terminou comprando.
                </p>
              </div>

              <div className="ml-auto flex items-center gap-2 print:hidden">
                <Search className="size-4" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar nome, telefone, pedido ou campanha..."
                  className="w-80 max-w-full"
                />
              </div>
            </div>

            {journey.length === 0 ? (
              <div className="mt-4">
                <EmptyMessage text="Nenhum visitante para mostrar neste período." />
              </div>
            ) : (
              <div className="mt-4 overflow-auto">
                <table className="w-full min-w-[1100px] text-xs">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2">Quando entrou</th>
                      <th>Quem era</th>
                      <th>De onde veio</th>
                      <th>Campanha</th>
                      <th>Aparelho</th>
                      <th>Tempo no site</th>
                      <th>O que fez</th>
                      <th>Pagamento</th>
                      <th>Pedido</th>
                      <th>Resultado</th>
                    </tr>
                  </thead>

                  <tbody>
                    {journey.map((s) => {
                      const ev = events.filter(
                        (e) => e.session_id === s.id,
                      );
                      const duration = Math.max(
                        0,
                        Math.round(
                          (new Date(s.last_seen_at).getTime() -
                            new Date(s.first_seen_at).getTime()) /
                            1000,
                        ),
                      );
                      const isOld =
                        now -
                          new Date(s.last_seen_at).getTime() >
                        15 * 60000;
                      const didAbandon =
                        !s.converted &&
                        isOld &&
                        (eventSet.get(s.id)?.has("add_to_cart") ||
                          eventSet
                            .get(s.id)
                            ?.has("checkout_started"));

                      return (
                        <tr
                          key={s.id}
                          className="border-b align-top"
                        >
                          <td className="py-2">
                            {dt(s.first_seen_at)}
                          </td>

                          <td>
                            <b>
                              {s.customer_name ||
                                "Visitante sem identificação"}
                            </b>
                            <br />
                            <span className="text-muted-foreground">
                              {s.customer_phone ||
                                "Ainda não informou telefone"}
                            </span>
                          </td>

                          <td>
                            <b>{niceSource(s.source)}</b>
                            {s.medium ? (
                              <>
                                <br />
                                <span className="text-muted-foreground">
                                  {String(s.medium)}
                                </span>
                              </>
                            ) : null}
                          </td>

                          <td>{s.campaign || "Sem campanha identificada"}</td>

                          <td>
                            {niceDevice(s.device_type)}
                            {s.browser ? (
                              <>
                                <br />
                                <span className="text-muted-foreground">
                                  Navegador: {s.browser}
                                </span>
                              </>
                            ) : null}
                          </td>

                          <td>
                            <span className="flex items-center gap-1">
                              <Clock3 className="size-3" />
                              {Math.floor(duration / 60)} min{" "}
                              {duration % 60} s
                            </span>
                          </td>

                          <td>
                            <details className="max-w-[380px]">
                              <summary className="cursor-pointer font-bold">
                                Ver {ev.length} ação(ões)
                              </summary>

                              <div className="mt-2 max-h-80 space-y-2 overflow-auto rounded-xl border bg-muted/30 p-2">
                                {[...ev].reverse().map(
                                  (e: any) => (
                                    <div
                                      key={e.id}
                                      className="rounded-lg bg-background p-2"
                                    >
                                      <div className="flex justify-between gap-2">
                                        <b>
                                          {niceEvent(e.event_name)}
                                        </b>
                                        <span className="text-[10px] text-muted-foreground">
                                          {new Date(
                                            e.created_at,
                                          ).toLocaleTimeString(
                                            "pt-BR",
                                          )}
                                        </span>
                                      </div>

                                      <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                                        {e.page_path
                                          ? `Local: ${friendlyPagePath(
                                              e.page_path,
                                            )}`
                                          : ""}
                                        {e.product_name
                                          ? ` • Produto: ${e.product_name}`
                                          : ""}
                                        {e.payment_method
                                          ? ` • Pagamento: ${nicePayment(
                                              e.payment_method,
                                            )}`
                                          : ""}
                                        {e.value != null
                                          ? ` • Valor: ${brl(
                                              Number(e.value),
                                            )}`
                                          : ""}
                                      </div>
                                    </div>
                                  ),
                                )}
                              </div>
                            </details>
                          </td>

                          <td>
                            {s.payment_method
                              ? nicePayment(s.payment_method)
                              : "Ainda não escolheu"}
                          </td>

                          <td>
                            {s.order_id
                              ? String(s.order_id)
                              : "Sem pedido"}
                          </td>

                          <td>
                            {s.converted ? (
                              <Badge>Comprou</Badge>
                            ) : didAbandon ? (
                              <Badge variant="outline">
                                Desistiu no caminho
                              </Badge>
                            ) : (
                              <Badge variant="outline">
                                Ainda navegando
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-5 text-sm leading-relaxed">
            <h2 className="font-black">
              O que esta página registra
            </h2>
            <p className="mt-2 text-muted-foreground">
              O sistema acompanha visitas, páginas abertas, origem da visita,
              aparelho usado, produtos vistos, itens colocados na sacola,
              início da finalização e compra. Ele não deve guardar senha,
              código de segurança do cartão nem número completo do cartão.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
