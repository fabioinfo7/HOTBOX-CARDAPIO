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
  Route as RouteIcon,
  CircleDollarSign,
  UserRound,
  Megaphone,
  MapPin,
  Clock3,
  Copy,
  HelpCircle,
  Activity,
  BarChart3,
  Instagram,
  Facebook,
  Globe2,
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
  direct: "Acesso direto ao site",
  none: "Acesso direto ao site",
  referral: "Veio de outro site",
  organic: "Busca orgânica",
  paid_social: "Anúncio em rede social",
  facebook: "Facebook",
  fb: "Facebook",
  facebook_ads: "Anúncio do Facebook",
  instagram: "Instagram",
  ig: "Instagram",
  instagram_ads: "Anúncio do Instagram",
  meta: "Anúncio da Meta",
  meta_ads: "Anúncio da Meta (Facebook ou Instagram)",
  metaads: "Anúncio da Meta (Facebook ou Instagram)",
  google: "Google",
  google_ads: "Anúncio do Google",
  gads: "Anúncio do Google",
  whatsapp: "WhatsApp",
  wa: "WhatsApp",
  bio: "Página da Bio",
  ifood: "iFood",
  "99food": "99Food",
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

function isPaidMedium(value: unknown) {
  const medium = String(value || "").trim().toLowerCase();
  return ["paid_social", "cpc", "paid", "ppc", "social_paid"].includes(medium);
}

function trafficChannel(session: SessionRow) {
  const source = String(session?.source || "").trim().toLowerCase();
  const medium = String(session?.medium || "").trim().toLowerCase();

  if (["instagram", "ig", "instagram_ads"].includes(source)) {
    return isPaidMedium(medium) || source === "instagram_ads"
      ? "Instagram — anúncios"
      : "Instagram — orgânico";
  }

  if (["facebook", "fb", "facebook_ads"].includes(source)) {
    return isPaidMedium(medium) || source === "facebook_ads"
      ? "Facebook — anúncios"
      : "Facebook — orgânico";
  }

  if (["meta_ads", "meta", "metaads"].includes(source)) {
    return "Meta Ads — rede não identificada";
  }

  if (source === "google") {
    return isPaidMedium(medium) || ["cpc", "paid"].includes(medium)
      ? "Google — anúncios"
      : "Google — orgânico";
  }

  if (source === "whatsapp" || source === "wa") return "WhatsApp";
  if (source === "direct" || source === "none" || !source) return "Acesso direto";
  if (source === "bio") return "Página da Bio";

  return niceSource(source);
}

function trafficChannelHelp(channel: string) {
  if (channel === "Instagram — anúncios") return "Identificado por UTM/medium pago ou sinal de anúncio.";
  if (channel === "Instagram — orgânico") return "Clique do Instagram sem indicação de mídia paga.";
  if (channel === "Facebook — anúncios") return "Identificado por UTM/medium pago ou sinal de anúncio.";
  if (channel === "Facebook — orgânico") return "Clique do Facebook sem indicação de mídia paga.";
  if (channel === "Meta Ads — rede não identificada") return "Há sinal de anúncio Meta, mas sem UTM que diga se veio do Instagram ou Facebook.";
  return "";
}

function niceSource(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "Origem não identificada";

  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (SOURCE_LABEL[normalized]) return SOURCE_LABEL[normalized];

  if (/instagram|\big\b/i.test(raw)) return "Instagram";
  if (/facebook|\bfb\b/i.test(raw)) return "Facebook";
  if (/meta/i.test(raw)) return "Anúncio da Meta";
  if (/whatsapp|\bwa\b/i.test(raw)) return "WhatsApp";
  if (/google/i.test(raw)) return "Google";
  if (/ifood/i.test(raw)) return "iFood";
  if (/99.?food/i.test(raw)) return "99Food";

  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}


function niceMedium(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  const labels: Record<string, string> = {
    social: "Rede social",
    organic_social: "Orgânico em rede social",
    paid_social: "Anúncio em rede social",
    organic: "Busca orgânica",
    referral: "Link de outro site",
    none: "Acesso direto",
    cpc: "Anúncio pago",
    paid: "Anúncio pago",
    email: "E-mail",
  };
  return labels[raw] || (raw ? raw.replace(/[_-]+/g, " ") : "");
}

function niceCampaign(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "Sem campanha identificada";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function visitorIdentityLabel(session: SessionRow) {
  if (session.customer_name) return String(session.customer_name);
  if (session.customer_phone) return `Cliente ${String(session.customer_phone)}`;
  return "Visitante ainda não identificado";
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
    "/cardapio": "Cardápio Digital — página principal",
    "/cardapio/area-entrega": "Verificação de CEP / área de entrega",
    "/carrinho": "Carrinho",
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
  const [journeyPage, setJourneyPage] = useState(1);
  const JOURNEY_PAGE_SIZE = 20;
  const [health, setHealth] = useState<any>(null);
  const [liveSessions, setLiveSessions] = useState<SessionRow[]>([]);
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "live" | "campaigns" | "regions" | "behavior" | "journey">("overview");
  const [utmSource, setUtmSource] = useState("instagram");
  const [utmMedium, setUtmMedium] = useState("paid_social");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [utmContent, setUtmContent] = useState("");
  const [utmCopied, setUtmCopied] = useState(false);

  async function loadLive() {
    const cutoff = new Date(Date.now() - 45 * 1000).toISOString();

    const { data, error } = await (supabase as any)
      .from("analytics_sessions")
      .select("*")
      .gte("presence_last_seen_at", cutoff)
      .order("presence_last_seen_at", { ascending: false })
      .limit(500);

    if (error) {
      setLiveError(error.message || "Não foi possível carregar quem está ao vivo.");
      setLiveSessions([]);
    } else {
      setLiveError("");
      setLiveSessions(data || []);
    }

    setLiveLoading(false);
  }

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

  useEffect(() => {
    void loadLive();

    const timer = window.setInterval(() => {
      void loadLive();
    }, 10000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setJourneyPage(1);
  }, [search, days]);

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

  const channelRows = useMemo(() => {
    const grouped = new Map<string, { visits: number; purchases: number; revenue: number }>();
    for (const session of sessions) {
      const channel = trafficChannel(session);
      const row = grouped.get(channel) || { visits: 0, purchases: 0, revenue: 0 };
      row.visits += 1;
      if (session.converted) row.purchases += 1;
      row.revenue += Number(session.revenue || 0);
      grouped.set(channel, row);
    }
    return [...grouped.entries()]
      .map(([channel, data]) => ({ channel, ...data }))
      .sort((a, b) => b.visits - a.visits);
  }, [sessions]);

  const channelTotals = useMemo(() => {
    const get = (name: string) => channelRows.find((row) => row.channel === name) || { visits: 0, purchases: 0, revenue: 0 };
    return {
      instagramOrganic: get("Instagram — orgânico"),
      instagramPaid: get("Instagram — anúncios"),
      facebookOrganic: get("Facebook — orgânico"),
      facebookPaid: get("Facebook — anúncios"),
      metaUnknown: get("Meta Ads — rede não identificada"),
    };
  }, [channelRows]);

  const latestRegionBySession = useMemo(() => {
    const map = new Map<string, { cep: string; neighborhood: string; supported: boolean; created_at: string }>();
    for (const event of events) {
      if (event.event_name !== "delivery_area_checked") continue;
      const sessionId = String(event.session_id || "");
      if (!sessionId || map.has(sessionId)) continue;
      map.set(sessionId, {
        cep: String(event.properties?.cep || "").replace(/\D/g, "").slice(0, 8),
        neighborhood: String(event.properties?.neighborhood || "").trim(),
        supported: event.properties?.supported !== false,
        created_at: String(event.created_at || ""),
      });
    }
    return map;
  }, [events]);

  const liveWithRegion = liveSessions.filter((session) => latestRegionBySession.has(String(session.id))).length;
  const liveAwaitingRegion = Math.max(0, liveSessions.length - liveWithRegion);

  const topProducts = useMemo(() => {
    const grouped = new Map<string, { views: number; carts: number; value: number }>();
    for (const event of events) {
      if (!["product_view", "add_to_cart", "order_bump_added"].includes(String(event.event_name))) continue;
      const name = String(event.product_name || event.properties?.product_name || "Produto não identificado").trim();
      const row = grouped.get(name) || { views: 0, carts: 0, value: 0 };
      if (event.event_name === "product_view") row.views += 1;
      if (["add_to_cart", "order_bump_added"].includes(event.event_name)) row.carts += Number(event.quantity || 1);
      row.value += Number(event.value || 0);
      grouped.set(name, row);
    }
    return [...grouped.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.views - a.views || b.carts - a.carts)
      .slice(0, 12);
  }, [events]);

  const paymentMethodRows = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const session of sessions.filter((s) => s.converted)) {
      const key = nicePayment(session.payment_method);
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }
    return [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  }, [sessions]);


  const liveByPage = useMemo(() => {
    const grouped = new Map<string, number>();

    for (const session of liveSessions) {
      const key = canonicalPageKey(
        session.current_page_path || session.entry_path || "/",
      );
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }

    return [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  }, [liveSessions]);

  const liveIdentified = liveSessions.filter(
    (session) => session.customer_name || session.customer_phone,
  ).length;


  const liveRows = useMemo(() => {
    return liveSessions
      .map((session) => {
        const region = latestRegionBySession.get(String(session.id));
        return {
          ...session,
          currentPageLabel: friendlyPagePath(session.current_page_path || session.entry_path || "/"),
          channelLabel: trafficChannel(session),
          regionLabel: region?.neighborhood || "",
          cep: region?.cep || "",
        };
      })
      .sort((a, b) => new Date(b.presence_last_seen_at || 0).getTime() - new Date(a.presence_last_seen_at || 0).getTime());
  }, [liveSessions, latestRegionBySession]);

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

  const filteredJourney = sessions.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;

    return [
      s.customer_name,
      s.customer_phone,
      s.source,
      s.medium,
      s.campaign,
      s.order_id,
      s.checkout_id,
      s.visitor_id,
    ].some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(q),
    );
  });

  const journeyTotalPages = Math.max(
    1,
    Math.ceil(filteredJourney.length / JOURNEY_PAGE_SIZE),
  );

  const currentJourneyPage = Math.min(journeyPage, journeyTotalPages);

  const journey = filteredJourney.slice(
    (currentJourneyPage - 1) * JOURNEY_PAGE_SIZE,
    currentJourneyPage * JOURNEY_PAGE_SIZE,
  );

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

  const campaignRows = useMemo(() => {
    const grouped = new Map<string, { source: string; medium: string; campaign: string; content: string; visits: number; purchases: number; revenue: number }>();
    for (const session of sessions) {
      const campaign = String(session.campaign || "").trim();
      if (!campaign) continue;
      const source = String(session.source || "direct");
      const medium = String(session.medium || "");
      const content = String(session.content || "");
      const key = `${source}::${medium}::${campaign}::${content}`;
      const row = grouped.get(key) || { source, medium, campaign, content, visits: 0, purchases: 0, revenue: 0 };
      row.visits += 1;
      if (session.converted) row.purchases += 1;
      row.revenue += Number(session.revenue || 0);
      grouped.set(key, row);
    }
    return [...grouped.values()].sort((a, b) => b.purchases - a.purchases || b.visits - a.visits).slice(0, 40);
  }, [sessions]);

  const regionRows = useMemo(() => {
    const purchaseSessions = new Set(sessions.filter((s) => s.converted).map((s) => String(s.id)));
    const cartSessions = new Set(events.filter((e) => ["add_to_cart", "order_bump_added"].includes(String(e.event_name))).map((e) => String(e.session_id)));
    const latestBySession = new Map<string, any>();

    for (const event of events) {
      if (event.event_name !== "delivery_area_checked") continue;
      const sessionId = String(event.session_id || "");
      if (!sessionId || latestBySession.has(sessionId)) continue;
      latestBySession.set(sessionId, event);
    }

    const grouped = new Map<string, any>();
    for (const [sessionId, event] of latestBySession.entries()) {
      const cep = String(event.properties?.cep || "").replace(/\D/g, "").slice(0, 8);
      const neighborhood = String(event.properties?.neighborhood || "Não identificado").trim() || "Não identificado";
      const supported = event.properties?.supported !== false;
      const key = `${cep || "sem_cep"}::${neighborhood.toLowerCase()}`;
      const row = grouped.get(key) || { cep, neighborhood, visits: 0, carts: 0, purchases: 0, outside: 0 };
      row.visits += 1;
      if (cartSessions.has(sessionId)) row.carts += 1;
      if (purchaseSessions.has(sessionId)) row.purchases += 1;
      if (!supported) row.outside += 1;
      grouped.set(key, row);
    }

    return [...grouped.values()].sort((a, b) => b.visits - a.visits).slice(0, 30);
  }, [events, sessions]);

  const regionNeighborhoodRows = useMemo(() => {
    const grouped = new Map<string, { neighborhood: string; visits: number; purchases: number; outside: number }>();
    for (const row of regionRows) {
      const key = row.neighborhood.toLowerCase();
      const current = grouped.get(key) || { neighborhood: row.neighborhood, visits: 0, purchases: 0, outside: 0 };
      current.visits += row.visits;
      current.purchases += row.purchases;
      current.outside += row.outside;
      grouped.set(key, current);
    }
    return [...grouped.values()].sort((a, b) => b.visits - a.visits).slice(0, 10);
  }, [regionRows]);

  const utmUrl = useMemo(() => {
    const base = "https://hotbox.up.railway.app/";
    const url = new URL(base);
    if (utmSource.trim()) url.searchParams.set("utm_source", utmSource.trim().toLowerCase().replace(/\s+/g, "_"));
    if (utmMedium.trim()) url.searchParams.set("utm_medium", utmMedium.trim().toLowerCase().replace(/\s+/g, "_"));
    if (utmCampaign.trim()) url.searchParams.set("utm_campaign", utmCampaign.trim().toLowerCase().replace(/\s+/g, "_"));
    if (utmContent.trim()) url.searchParams.set("utm_content", utmContent.trim().toLowerCase().replace(/\s+/g, "_"));
    return url.toString();
  }, [utmSource, utmMedium, utmCampaign, utmContent]);

  function applyUtmPreset(source: "instagram" | "facebook", paid: boolean) {
    setUtmSource(source);
    setUtmMedium(paid ? "paid_social" : "organic_social");
    if (!utmCampaign.trim()) {
      setUtmCampaign(paid ? "campanha_meta" : source === "instagram" ? "bio_instagram" : "pagina_facebook");
    }
  }

  async function copyUtm() {
    try {
      await navigator.clipboard.writeText(utmUrl);
      setUtmCopied(true);
      window.setTimeout(() => setUtmCopied(false), 1600);
    } catch {
      setUtmCopied(false);
    }
  }

  return (
    <div className="hotbox-admin-page space-y-5 print:p-0">
      <div className="hotbox-admin-header print:hidden">
        <div className="hotbox-admin-title-wrap">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-zinc-950 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-[#ffcf00]">
            <TrendingUp className="size-3.5" /> Analytics HotBox
          </div>
          <h1 className="hotbox-admin-title">O que realmente está trazendo vendas</h1>
          <p className="hotbox-admin-subtitle">
            Ao vivo, origem orgânica e paga, campanhas, produtos, funil, CEP/bairro, pagamentos e jornada até a compra — separados em abas para ficar completo sem ficar poluído.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[1, 7, 30, 90].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
              {d === 1 ? "Hoje" : `${d} dias`}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => { void load(); void loadLive(); }}>
            <RefreshCw className="mr-2 size-4" /> Atualizar
          </Button>
        </div>
      </div>

      {!connected && !loading && (
        <Card className="hotbox-admin-danger p-4 text-sm">
          <b>Alguns dados podem estar temporariamente indisponíveis.</b>
          <p className="mt-1 text-muted-foreground">O cardápio continua funcionando normalmente; esta mensagem afeta apenas os relatórios.</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="hotbox-admin-kpi p-4">
          <p className="text-xs font-bold uppercase text-zinc-500">Pessoas que entraram</p>
          <p className="mt-2 text-3xl font-black">{visitors}</p>
          <p className="mt-1 text-xs text-zinc-500">{sessions.length} visitas no período</p>
        </Card>
        <Card className="hotbox-admin-kpi p-4">
          <p className="text-xs font-bold uppercase text-zinc-500">Compras concluídas</p>
          <p className="mt-2 text-3xl font-black">{converted}</p>
          <p className="mt-1 text-xs text-zinc-500">Conversão de {pct(converted, sessions.length)}</p>
        </Card>
        <Card className="hotbox-admin-kpi p-4">
          <p className="text-xs font-bold uppercase text-zinc-500">Vendas rastreadas</p>
          <p className="mt-2 text-3xl font-black">{brl(revenue)}</p>
          <p className="mt-1 text-xs text-zinc-500">Ticket médio {brl(avgTicket)}</p>
        </Card>
        <Card className="hotbox-admin-kpi p-4">
          <p className="text-xs font-bold uppercase text-zinc-500">Precisam de atenção</p>
          <p className="mt-2 text-3xl font-black">{abandoned + rejectedCardCount}</p>
          <p className="mt-1 text-xs text-zinc-500">{abandoned} abandonos • {rejectedCardCount} cartões recusados</p>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm print:hidden">
        {[
          ["overview", "Visão geral", Eye],
          ["live", "Ao vivo", Activity],
          ["campaigns", "Origem e campanhas", Megaphone],
          ["regions", "Regiões", MapPin],
          ["behavior", "Funil e comportamento", BarChart3],
          ["journey", "Jornada detalhada", RouteIcon],
        ].map(([key, label, Icon]: any) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition ${activeTab === key ? "bg-zinc-950 text-white shadow-sm" : "text-zinc-600 hover:bg-zinc-100"}`}
          >
            <Icon className={`size-4 ${activeTab === key ? "text-[#ffcf00]" : ""}`} /> {label}
          </button>
        ))}
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando informações...</Card>
      ) : (
        <>
          {activeTab === "overview" && (
            <div className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
                <Card className="hotbox-admin-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-black">Resumo do negócio digital</h2>
                      <p className="mt-1 text-sm text-muted-foreground">As métricas mais importantes para entender tráfego, intenção e venda.</p>
                    </div>
                    <Badge variant="secondary">{days === 1 ? "Hoje" : `${days} dias`}</Badge>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-zinc-50 p-4"><p className="text-xs font-black uppercase text-zinc-500">Conversão</p><p className="mt-2 text-2xl font-black">{pct(converted, sessions.length)}</p><p className="text-xs text-zinc-500">{converted} compras</p></div>
                    <div className="rounded-2xl bg-zinc-50 p-4"><p className="text-xs font-black uppercase text-zinc-500">Ticket médio</p><p className="mt-2 text-2xl font-black">{brl(avgTicket)}</p><p className="text-xs text-zinc-500">{brl(revenue)} rastreados</p></div>
                    <div className="rounded-2xl bg-zinc-50 p-4"><p className="text-xs font-black uppercase text-zinc-500">Sacola</p><p className="mt-2 text-2xl font-black">{addCart}</p><p className="text-xs text-zinc-500">{pct(addCart, sessions.length)} das visitas</p></div>
                    <div className="rounded-2xl bg-zinc-50 p-4"><p className="text-xs font-black uppercase text-zinc-500">Abandonos</p><p className="mt-2 text-2xl font-black">{abandoned}</p><p className="text-xs text-zinc-500">sem compra após intenção</p></div>
                  </div>

                  <div className="mt-5">
                    <h3 className="font-black">Principais origens</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {channelRows.slice(0, 6).map((row) => (
                        <div key={row.channel} className="flex items-center justify-between rounded-2xl border bg-white p-3">
                          <div><p className="font-bold">{row.channel}</p><p className="text-xs text-zinc-500">{row.visits} visitas • {row.purchases} compras</p></div>
                          <div className="text-right"><p className="font-black">{pct(row.purchases, row.visits)}</p><p className="text-[11px] text-zinc-500">{brl(row.revenue)}</p></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>

                <div className="space-y-4">
                  <Card className="hotbox-admin-accent p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div><p className="text-xs font-black uppercase text-[#ffcf00]">Agora no cardápio</p><p className="mt-1 text-4xl font-black">{liveSessions.length}</p></div>
                      <Users className="size-8 text-[#ffcf00]" />
                    </div>
                    <p className="mt-3 text-sm text-white/70">{liveWithRegion} com região identificada • {liveAwaitingRegion} ainda na etapa do CEP ou sem região nesta sessão.</p>
                    {liveByPage.slice(0, 4).map(([page, count]) => (
                      <div key={page} className="mt-2 flex justify-between rounded-xl bg-white/10 px-3 py-2 text-sm">
                        <span>{friendlyPagePath(page)}</span><b>{count}</b>
                      </div>
                    ))}
                  </Card>

                  <Card className="hotbox-admin-card p-5">
                    <h2 className="font-black">Alertas que merecem atenção</h2>
                    <div className="mt-4 space-y-3">
                      <div className="flex justify-between rounded-xl bg-amber-50 p-3"><span>Abandonos com intenção</span><b>{abandoned}</b></div>
                      <div className="flex justify-between rounded-xl bg-red-50 p-3"><span>Cartões não aprovados</span><b>{rejectedCardCount}</b></div>
                      <div className="flex justify-between rounded-xl bg-zinc-50 p-3"><span>Procura fora da área</span><b>{regionRows.reduce((sum, row) => sum + Number(row.outside || 0), 0)}</b></div>
                    </div>
                  </Card>
                </div>
              </div>
            </div>
          )}

          {activeTab === "live" && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="hotbox-admin-kpi p-4"><p className="text-xs font-black uppercase text-zinc-500">Ao vivo agora</p><p className="mt-2 text-3xl font-black">{liveSessions.length}</p><p className="text-xs text-zinc-500">últimos 45 segundos</p></Card>
                <Card className="hotbox-admin-kpi p-4"><p className="text-xs font-black uppercase text-zinc-500">Com região</p><p className="mt-2 text-3xl font-black">{liveWithRegion}</p><p className="text-xs text-zinc-500">CEP/bairro desta sessão</p></Card>
                <Card className="hotbox-admin-kpi p-4"><p className="text-xs font-black uppercase text-zinc-500">Aguardando CEP</p><p className="mt-2 text-3xl font-black">{liveAwaitingRegion}</p><p className="text-xs text-zinc-500">ainda não validaram região nesta sessão</p></Card>
                <Card className="hotbox-admin-kpi p-4"><p className="text-xs font-black uppercase text-zinc-500">Identificados</p><p className="mt-2 text-3xl font-black">{liveIdentified}</p><p className="text-xs text-zinc-500">nome ou telefone conhecido</p></Card>
              </div>

              <Card className="hotbox-admin-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black">Onde cada pessoa está agora</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Produto, carrinho, checkout, validação de CEP ou página principal são atualizados em tempo real.</p>
                  </div>
                  <Badge variant="secondary">atualiza a cada 10s</Badge>
                </div>
                {liveError ? <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{liveError}</div> : null}
                <div className="mt-4 overflow-x-auto rounded-2xl border">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500"><tr><th className="p-3">Página atual</th><th className="p-3">Origem</th><th className="p-3">Região</th><th className="p-3">Visitante</th><th className="p-3">Último sinal</th></tr></thead>
                    <tbody>
                      {liveRows.length ? liveRows.map((row) => (
                        <tr key={row.id} className="border-t">
                          <td className="p-3 font-bold">{row.currentPageLabel}</td>
                          <td className="p-3">{row.channelLabel}</td>
                          <td className="p-3">{row.regionLabel ? <><b>{row.regionLabel}</b>{row.cep ? <div className="text-xs text-zinc-500">{row.cep.slice(0,5)}-{row.cep.slice(5)}</div> : null}</> : <span className="text-zinc-400">Ainda não informou CEP</span>}</td>
                          <td className="p-3">{visitorIdentityLabel(row)}</td>
                          <td className="p-3 whitespace-nowrap">{row.presence_last_seen_at ? dt(row.presence_last_seen_at) : "—"}</td>
                        </tr>
                      )) : <tr><td colSpan={5} className="p-8 text-center text-zinc-500">Ninguém no cardápio neste momento.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {activeTab === "campaigns" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  ["Instagram orgânico", channelTotals.instagramOrganic, Instagram],
                  ["Instagram anúncios", channelTotals.instagramPaid, Instagram],
                  ["Facebook orgânico", channelTotals.facebookOrganic, Facebook],
                  ["Facebook anúncios", channelTotals.facebookPaid, Facebook],
                  ["Meta Ads sem rede", channelTotals.metaUnknown, Megaphone],
                ].map(([label, data, Icon]: any) => (
                  <Card key={label} className="hotbox-admin-kpi p-4">
                    <div className="flex items-center justify-between"><p className="text-xs font-black uppercase text-zinc-500">{label}</p><Icon className="size-4 text-zinc-400" /></div>
                    <p className="mt-2 text-2xl font-black">{data.visits}</p>
                    <p className="text-xs text-zinc-500">{data.purchases} compras • {pct(data.purchases, data.visits)}</p>
                  </Card>
                ))}
              </div>

              {channelTotals.metaUnknown.visits > 0 && (
                <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <b>{channelTotals.metaUnknown.visits} visita(s) de anúncio Meta não informaram se vieram do Instagram ou Facebook.</b>
                  <p className="mt-1">Isso acontece quando há sinal de anúncio, como fbclid, mas o link não possui UTM da rede. Use os links gerados abaixo para separar com precisão.</p>
                </Card>
              )}

              <Card className="hotbox-admin-card overflow-hidden">
                <div className="border-b bg-zinc-950 p-5 text-white">
                  <h2 className="text-lg font-black">Gerador de link UTM para campanhas</h2>
                  <p className="mt-1 text-sm text-white/65">Use estes links nos anúncios. O Analytics identifica automaticamente origem, campanha e criativo.</p>
                </div>
                <div className="grid gap-4 p-5 lg:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-black uppercase text-zinc-500">Atalhos corretos de origem</p>
                    <div className="mb-4 flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => applyUtmPreset("instagram", false)}>Instagram orgânico</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => applyUtmPreset("instagram", true)}>Instagram anúncio</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => applyUtmPreset("facebook", false)}>Facebook orgânico</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => applyUtmPreset("facebook", true)}>Facebook anúncio</Button>
                    </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className="mb-1 block text-xs font-black uppercase text-zinc-500">Origem</label><Input value={utmSource} onChange={(e) => setUtmSource(e.target.value)} placeholder="instagram" /></div>
                    <div><label className="mb-1 block text-xs font-black uppercase text-zinc-500">Tipo de tráfego</label><Input value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} placeholder="paid_social" /></div>
                    <div><label className="mb-1 block text-xs font-black uppercase text-zinc-500">Nome da campanha</label><Input value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} placeholder="promo_costela_setembro" /></div>
                    <div><label className="mb-1 block text-xs font-black uppercase text-zinc-500">Criativo / anúncio</label><Input value={utmContent} onChange={(e) => setUtmContent(e.target.value)} placeholder="video_costela_01" /></div>
                  </div>
                  </div>
                  <div className="rounded-2xl border bg-[#fffaf0] p-4">
                    <p className="text-xs font-black uppercase text-zinc-500">Link pronto</p>
                    <p className="mt-2 break-all rounded-xl bg-white p-3 text-sm font-medium shadow-sm">{utmUrl}</p>
                    <Button className="mt-3 w-full bg-zinc-950 font-black text-white hover:bg-zinc-800" onClick={copyUtm}><Copy className="mr-2 size-4" /> {utmCopied ? "Link copiado" : "Copiar link UTM"}</Button>
                  </div>
                </div>
              </Card>

              <Card className="hotbox-admin-card p-5">
                <h2 className="text-lg font-black">Campanhas que trouxeram resultado</h2>
                <p className="mt-1 text-sm text-muted-foreground">Prioriza visitas, compras e vendas. Campanhas sem UTM não aparecem aqui.</p>
                <div className="mt-4 overflow-x-auto rounded-2xl border">
                  <table className="w-full text-sm"><thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500"><tr><th className="p-3">Campanha</th><th className="p-3">Canal</th><th className="p-3">Criativo</th><th className="p-3 text-right">Visitas</th><th className="p-3 text-right">Compras</th><th className="p-3 text-right">Conversão</th><th className="p-3 text-right">Vendas</th></tr></thead>
                    <tbody>{campaignRows.length ? campaignRows.map((row) => <tr key={`${row.source}-${row.campaign}`} className="border-t"><td className="p-3 font-bold">{niceCampaign(row.campaign)}</td><td className="p-3"><div className="font-bold">{trafficChannel({ source: row.source, medium: row.medium })}</div><div className="text-xs text-zinc-500">{niceMedium(row.medium)}</div></td><td className="p-3">{row.content ? niceCampaign(row.content) : "—"}</td><td className="p-3 text-right">{row.visits}</td><td className="p-3 text-right font-bold">{row.purchases}</td><td className="p-3 text-right">{pct(row.purchases, row.visits)}</td><td className="p-3 text-right font-black">{brl(row.revenue)}</td></tr>) : <tr><td colSpan={7} className="p-8 text-center text-zinc-500">Ainda não há campanhas com UTM registradas neste período.</td></tr>}</tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {activeTab === "regions" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="hotbox-admin-kpi p-4"><p className="text-xs font-black uppercase text-zinc-500">Sessões com região</p><p className="mt-2 text-3xl font-black">{new Set(events.filter((e) => e.event_name === "delivery_area_checked").map((e) => String(e.session_id))).size}</p><p className="text-xs text-zinc-500">CEP ou bairro realmente informado</p></Card>
                <Card className="hotbox-admin-kpi p-4"><p className="text-xs font-black uppercase text-zinc-500">CEPs diferentes</p><p className="mt-2 text-3xl font-black">{new Set(regionRows.map((row) => row.cep).filter(Boolean)).size}</p><p className="text-xs text-zinc-500">consultados no período</p></Card>
                <Card className="hotbox-admin-kpi p-4"><p className="text-xs font-black uppercase text-zinc-500">Fora da área</p><p className="mt-2 text-3xl font-black">{regionRows.reduce((sum, row) => sum + Number(row.outside || 0), 0)}</p><p className="text-xs text-zinc-500">oportunidades de expansão</p></Card>
                <Card className="hotbox-admin-kpi p-4"><p className="text-xs font-black uppercase text-zinc-500">Ao vivo sem região</p><p className="mt-2 text-3xl font-black">{liveAwaitingRegion}</p><p className="text-xs text-zinc-500">ainda na tela de CEP ou sem evento nesta sessão</p></Card>
              </div>

              <Card className="border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                <b>Por que o número de pessoas ao vivo pode ser maior que o número de CEPs?</b>
                <p className="mt-1">Uma pessoa aparece ao vivo assim que abre o cardápio, inclusive enquanto ainda está na tela de informar CEP. Depois que valida a região, o CEP/bairro passa a ser ligado à sessão. CEP salvo de uma visita anterior agora também é registrado na sessão atual.</p>
              </Card>
              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="hotbox-admin-card p-5 lg:col-span-2">
                  <h2 className="text-lg font-black">Regiões que mais demonstram interesse</h2>
                  <p className="mt-1 text-sm text-muted-foreground">CEP e bairro são registrados quando o visitante consulta a área de entrega. Não tentamos adivinhar o CEP por IP.</p>
                  <div className="mt-4 overflow-x-auto rounded-2xl border">
                    <table className="w-full text-sm"><thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500"><tr><th className="p-3">CEP</th><th className="p-3">Bairro</th><th className="p-3 text-right">Consultas</th><th className="p-3 text-right">Carrinhos</th><th className="p-3 text-right">Compras</th><th className="p-3 text-right">Conversão</th></tr></thead>
                      <tbody>{regionRows.length ? regionRows.map((row) => <tr key={`${row.cep}-${row.neighborhood}`} className="border-t"><td className="p-3 font-mono text-xs">{row.cep ? `${row.cep.slice(0,5)}-${row.cep.slice(5)}` : "—"}</td><td className="p-3 font-bold">{row.neighborhood}</td><td className="p-3 text-right">{row.visits}</td><td className="p-3 text-right">{row.carts}</td><td className="p-3 text-right font-bold">{row.purchases}</td><td className="p-3 text-right">{pct(row.purchases, row.visits)}</td></tr>) : <tr><td colSpan={6} className="p-8 text-center text-zinc-500">Os dados começam a aparecer quando os visitantes consultarem CEP ou bairro no cardápio.</td></tr>}</tbody>
                    </table>
                  </div>
                </Card>
                <Card className="hotbox-admin-card p-5">
                  <h2 className="font-black">Bairros com mais procura</h2>
                  <p className="mt-1 text-xs text-zinc-500">Ajuda a decidir onde anunciar e onde pode valer expandir entrega.</p>
                  <div className="mt-4 space-y-3">{regionNeighborhoodRows.length ? regionNeighborhoodRows.map((row, i) => <div key={row.neighborhood} className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-full bg-zinc-950 text-xs font-black text-[#ffcf00]">{i+1}</span><div className="min-w-0 flex-1"><p className="truncate font-bold">{row.neighborhood}</p><p className="text-xs text-zinc-500">{row.visits} consultas • {row.purchases} compras{row.outside ? ` • ${row.outside} fora da área` : ""}</p></div></div>) : <p className="text-sm text-zinc-500">Sem consultas de região ainda.</p>}</div>
                </Card>
              </div>
            </div>
          )}

          {activeTab === "behavior" && (
            <div className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
                <Card className="hotbox-admin-card p-5">
                  <h2 className="text-lg font-black">Funil completo</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Veja em qual etapa o cliente está desistindo.</p>
                  <div className="mt-5 space-y-3">
                    {funnel.map((step, index) => {
                      const previous = index === 0 ? step.value : funnel[index - 1].value;
                      const width = sessions.length ? Math.max(3, (step.value / sessions.length) * 100) : 0;
                      return (
                        <div key={step.label}>
                          <div className="mb-1 flex items-end justify-between gap-3">
                            <div><p className="font-bold">{step.label}</p><p className="text-xs text-zinc-500">{index === 0 ? step.help : `${pct(step.value, previous)} avançaram da etapa anterior`}</p></div>
                            <span className="text-lg font-black">{step.value}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-zinc-950" style={{ width: `${width}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                <Card className="hotbox-admin-card p-5">
                  <h2 className="text-lg font-black">Páginas mais vistas</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Agora inclui páginas virtuais do produto, carrinho, checkout e CEP.</p>
                  <div className="mt-4 space-y-3">
                    {groupPageViews().map(([page, data]) => (
                      <div key={page} className="flex items-center justify-between gap-3 border-b pb-3 last:border-0">
                        <p className="font-bold">{friendlyPagePath(page)}</p><b>{data.count}</b>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
                <Card className="hotbox-admin-card p-5">
                  <h2 className="text-lg font-black">Produtos que mais despertam interesse</h2>
                  <div className="mt-4 overflow-x-auto rounded-2xl border">
                    <table className="w-full text-sm"><thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500"><tr><th className="p-3">Produto</th><th className="p-3 text-right">Visualizações</th><th className="p-3 text-right">Adições à sacola</th><th className="p-3 text-right">Taxa de interesse</th></tr></thead>
                      <tbody>{topProducts.length ? topProducts.map((row) => <tr key={row.name} className="border-t"><td className="p-3 font-bold">{row.name}</td><td className="p-3 text-right">{row.views}</td><td className="p-3 text-right">{row.carts}</td><td className="p-3 text-right">{pct(row.carts, row.views)}</td></tr>) : <tr><td colSpan={4} className="p-8 text-center text-zinc-500">Ainda não há visualizações de produtos suficientes.</td></tr>}</tbody>
                    </table>
                  </div>
                </Card>

                <Card className="hotbox-admin-card p-5">
                  <h2 className="text-lg font-black">Pagamentos e problemas</h2>
                  <div className="mt-4 space-y-3">
                    {paymentMethodRows.map(([method, count]) => <div key={method} className="flex justify-between rounded-xl bg-zinc-50 p-3"><span>{method}</span><b>{count}</b></div>)}
                    <div className="flex justify-between rounded-xl bg-red-50 p-3 text-red-800"><span>Cartões não aprovados</span><b>{rejectedCardCount}</b></div>
                    {rejectedCardCount > 0 ? <p className="text-xs text-zinc-500">Tentativas recusadas somaram {brl(rejectedCardValue)}.</p> : null}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {activeTab === "journey" && (
            <div className="space-y-4">
              <Card className="hotbox-admin-card p-5">
                <div className="flex flex-wrap items-center gap-3"><div><h2 className="text-lg font-black">Histórico de visitantes</h2><p className="mt-1 text-sm text-muted-foreground">Use quando precisar investigar uma visita, campanha, pedido ou abandono específico.</p></div><div className="ml-auto w-full max-w-sm"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente, campanha, pedido..." /></div></div>
                <div className="mt-4 overflow-x-auto rounded-2xl border">
                  <table className="w-full text-sm"><thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500"><tr><th className="p-3">Quando</th><th className="p-3">Visitante</th><th className="p-3">Origem</th><th className="p-3">Campanha</th><th className="p-3">Situação</th></tr></thead>
                    <tbody>{journey.length ? journey.map((s) => <tr key={s.id} className="border-t"><td className="p-3 whitespace-nowrap">{dt(s.first_seen_at)}</td><td className="p-3 font-bold">{visitorIdentityLabel(s)}</td><td className="p-3"><div className="font-bold">{trafficChannel(s)}</div><div className="text-xs text-zinc-500">{niceMedium(s.medium)}</div></td><td className="p-3">{s.campaign ? niceCampaign(s.campaign) : "—"}</td><td className="p-3">{s.converted ? <Badge className="bg-emerald-600">Comprou</Badge> : <Badge variant="secondary">Não comprou</Badge>}</td></tr>) : <tr><td colSpan={5} className="p-8 text-center text-zinc-500">Nenhum visitante encontrado.</td></tr>}</tbody>
                  </table>
                </div>
                <div className="mt-4 flex items-center justify-end gap-2"><Button size="sm" variant="outline" disabled={currentJourneyPage <= 1} onClick={() => setJourneyPage((v) => Math.max(1, v - 1))}>Anterior</Button><span className="text-xs font-bold">Página {currentJourneyPage} de {journeyTotalPages}</span><Button size="sm" variant="outline" disabled={currentJourneyPage >= journeyTotalPages} onClick={() => setJourneyPage((v) => Math.min(journeyTotalPages, v + 1))}>Próxima</Button></div>
              </Card>
              {rejectedCardCount > 0 && <Card className="hotbox-admin-danger p-5"><h2 className="font-black">Pagamentos no cartão que merecem atenção</h2><p className="mt-1 text-sm text-muted-foreground">{rejectedCardCount} tentativa(s) não aprovada(s), somando {brl(rejectedCardValue)} em tentativas de compra.</p></Card>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
