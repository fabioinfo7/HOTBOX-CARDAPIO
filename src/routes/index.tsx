import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import {
  ShoppingCart,
  Minus,
  Plus,
  Trash2,
  MapPin,
  CreditCard,
  QrCode,
  ShieldCheck,
  Star,
  ChevronRight,
  Flame,
  ClipboardList,
  Search,
  ArrowLeft,
  Bike,
  Store,
  Clock,
  Ticket,
  X,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  MessageCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl, formatPhone, onlyDigits } from "@/lib/formatters";
import { getEffectivePrice } from "@/lib/promotions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CustomerLoyaltyClub } from "@/components/customer-loyalty-club";
import { MercadoPagoPayment } from "@/components/mercadopago-payment";
import { AppmaxPayment } from "@/components/appmax-payment";
import { quoteLoyaltyReward } from "@/lib/loyalty.functions";
import { quoteSiteDelivery } from "@/lib/site-checkout.functions";
import { getPublicTestimonialsFn } from "@/lib/satisfaction.functions";
import { trackAnalytics, analyticsIdentity } from "@/lib/analytics";

export const Route = createFileRoute("/")({
  component: CustomerHome,
});

type Product = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  sale_price: number;
  image_url: string | null;
  kind: string;
  featured: boolean;
  active: boolean;
  promotion_active?: boolean | null;
  promotion_price?: number | null;
  promotion_type?: string | null;
  promotion_start_at?: string | null;
  promotion_end_at?: string | null;
  promotion_days_of_week?: number[] | null;
  promotion_time_start?: string | null;
  promotion_time_end?: string | null;
  promotion_label?: string | null;
  is_combo?: boolean | null;
  sort_order?: number | null;
};

type AddonOption = {
  id: string;
  group_id: string;
  name: string;
  display_name?: string | null;
  description?: string | null;
  display_description?: string | null;
  image_url?: string | null;
  price: number;
  linked_product_id?: string | null;
  use_linked_product_price?: boolean | null;
  active: boolean;
  sort_order?: number | null;
};

type AddonGroup = {
  id: string;
  name: string;
  display_title?: string | null;
  description?: string | null;
  display_subtitle?: string | null;
  required: boolean;
  min_select: number;
  max_select: number;
  active: boolean;
  sort_order?: number | null;
  options: AddonOption[];
};

type OrderBump = {
  id: string;
  product_id: string;
  title: string;
  subtitle?: string | null;
  placement: "cart" | "checkout";
  price_override?: number | null;
  active: boolean;
  sort_order?: number | null;
};

type CartAddon = { option_id: string; group_id: string; name: string; price: number; qty: number };
type CartItem = {
  product: Product;
  qty: number;
  notes: string;
  addons: CartAddon[];
  orderBumpId?: string | null;
  bumpPrice?: number | null;
};
type View = "list" | "detail" | "cart" | "checkout";
type ActiveFilter = "ativos" | "inativos" | "todos";
type CheckoutPayment = "infinitepay" | "mercadopago" | "appmax";
type PaymentChoice = "online" | "delivery_card" | "delivery_pix";
type AreaStatus = "idle" | "checking" | "needs_number" | "supported" | "unsupported" | "error";

type ActiveOrderSummary = {
  id: string;
  order_number: number | null;
  status: string;
  created_at: string;
  delivery_mode?: string | null;
};

import hotboxLogoUrl from "@/assets/logo-hotbox.jpeg";

const HOTBOX_LOGO_URL = hotboxLogoUrl;
const WHATSAPP_URL = "https://wa.me/5521984296288?text=" + encodeURIComponent("Olá! Preciso de ajuda com meu pedido no cardápio digital da Hotbox.");
const NFOOD_URL = "https://oia.99app.com/dlp9/3SsCkm?area=BR";

const MY_ORDERS_KEY = "hb_my_orders";
const CART_STORAGE_KEY = "hb_cart_v1";
const AREA_ACCESS_SESSION_KEY = "hb_area_access_session";

type SavedAreaAccess = {
  cep?: string;
  street?: string;
  number?: string;
  neighborhood: string;
  city?: string;
  deliveryFee: number;
  deliveryCutoffTime?: string | null;
  outsideDeliveryHours?: boolean;
  schedulingEnabled?: boolean;
  savedAt: number;
};

function saveAreaAccess(data: SavedAreaAccess) {
  try {
    sessionStorage.setItem(AREA_ACCESS_SESSION_KEY, JSON.stringify(data));
  } catch {
    /* sessionStorage indisponível */
  }
}

function readAreaAccess(): SavedAreaAccess | null {
  try {
    const raw = sessionStorage.getItem(AREA_ACCESS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedAreaAccess;
    if (!parsed?.neighborhood || !Number.isFinite(Number(parsed.deliveryFee))) return null;
    // Mantém a validação apenas durante a sessão atual do navegador.
    return parsed;
  } catch {
    return null;
  }
}

function clearAreaAccess() {
  try {
    sessionStorage.removeItem(AREA_ACCESS_SESSION_KEY);
  } catch {
    /* sessionStorage indisponível */
  }
}

function pushMyOrder(id: string) {
  try {
    const raw = localStorage.getItem(MY_ORDERS_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(id)) ids.unshift(id);
    localStorage.setItem(MY_ORDERS_KEY, JSON.stringify(ids.slice(0, 30)));
  } catch {
    /* localStorage indisponível */
  }
}

const ACTIVE_ORDER_STATUSES = new Set([
  "pending_review",
  "pending",
  "preparing",
  "ready",
  "ready_pickup",
  "out_for_delivery",
]);

function readMyOrderIds(): string[] {
  try {
    const raw = localStorage.getItem(MY_ORDERS_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.map(String).filter(Boolean).slice(0, 30) : [];
  } catch {
    return [];
  }
}

function activeOrderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending_review: "Aguardando confirmação",
    pending: "Pedido confirmado",
    preparing: "Em preparação",
    ready_pickup: "Pedido pronto",
    out_for_delivery: "Saiu para entrega",
  };
  return labels[status] || "Pedido em andamento";
}


type PublicReview = {
  id: string;
  customerName: string;
  phoneMasked: string;
  submittedAt: string;
  rating: number;
  comment: string | null;
};

function PublicReviewStars({ value }: { value: number }) {
  const rounded = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`size-3.5 ${star <= rounded ? "fill-amber-400 text-amber-400" : "text-zinc-200"}`}
        />
      ))}
    </span>
  );
}

function publicReviewDate(value: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}


function PublicReviewCard({ review }: { review: PublicReview }) {
  return (
    <article className="rounded-2xl border border-black/5 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-zinc-900">{review.customerName}</p>
          <p className="mt-0.5 text-[10px] font-medium text-zinc-400">
            {review.phoneMasked} • {publicReviewDate(review.submittedAt)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
          {review.rating.toFixed(1)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <PublicReviewStars value={review.rating} />
        <span className="text-[9px] font-bold uppercase tracking-wide text-zinc-400">Compra verificada</span>
      </div>

      {review.comment && (
        <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-zinc-700">“{review.comment}”</p>
      )}
    </article>
  );
}

function CompactInlineReview({ review }: { review: PublicReview }) {
  return (
    <div className="my-3 rounded-2xl border border-amber-200/70 bg-amber-50/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <PublicReviewStars value={review.rating} />
        <span className="text-xs font-black text-zinc-800">{review.rating.toFixed(1)}</span>
        <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-zinc-400">Compra verificada</span>
      </div>
      {review.comment && (
        <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-zinc-700">“{review.comment}”</p>
      )}
      <p className="mt-1 text-[10px] text-zinc-400">
        {review.customerName} • {publicReviewDate(review.submittedAt)}
      </p>
    </div>
  );
}

function PublicReviewsModal({
  open,
  onClose,
  reviews,
  average,
}: {
  open: boolean;
  onClose: () => void;
  reviews: PublicReview[];
  average: number;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/45 p-3 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-auto mt-8 flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-[26px] bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">Avaliações reais</p>
            <div className="mt-0.5 flex items-center gap-2">
              <PublicReviewStars value={average} />
              <span className="text-sm font-black">{average.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">• {reviews.length} avaliações</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full border bg-background"
            aria-label="Fechar avaliações"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-2.5 overflow-y-auto p-3">
          {reviews.map((review) => (
            <PublicReviewCard key={review.id} review={review} />
          ))}
        </div>
      </div>
    </div>
  );
}


type StoreBusinessRange = { days: number[]; open: string; close: string };
type PublicStoreStatus = {
  manual_store_status?: "open" | "closed" | null;
  business_hours_enabled?: boolean;
  business_hours?: StoreBusinessRange[];
  business_hours_closed_message?: string | null;
  closed_reservations_enabled?: boolean;
};

function productMenuGroupPriority(product: Product) {
  const normalize = (value: unknown) =>
    String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const category = normalize(product.category);
  const name = normalize(product.name);

  if (category.includes("batata") || name.includes("batata recheada")) return 0;
  if (
    product.kind === "beverage" ||
    category.includes("bebida") ||
    category.includes("refrigerante") ||
    category.includes("suco")
  ) return 1;
  return 2;
}

function storeTimeToMinutes(value: unknown) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function brasiliaClockNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const weekday = String(parts.find((part) => part.type === "weekday")?.value || "Sun");
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return { day: map[weekday] ?? 0, minutes: hour * 60 + minute };
}

function isStoreOpenByBusinessHours(config: PublicStoreStatus | null) {
  if (!config) return true;
  if (config.manual_store_status === "open") return true;
  if (config.manual_store_status === "closed") return false;
  if (config.business_hours_enabled !== true) return true;

  const ranges = Array.isArray(config.business_hours) ? config.business_hours : [];
  if (!ranges.length) return false;

  const now = brasiliaClockNow();
  const previousDay = (now.day + 6) % 7;

  return ranges.some((range) => {
    const days = Array.isArray(range.days) ? range.days.map(Number) : [];
    const open = storeTimeToMinutes(range.open);
    const close = storeTimeToMinutes(range.close);
    if (open == null || close == null || !days.length) return false;

    if (open === close) return days.includes(now.day);
    if (close > open) return days.includes(now.day) && now.minutes >= open && now.minutes < close;

    return (days.includes(now.day) && now.minutes >= open) ||
      (days.includes(previousDay) && now.minutes < close);
  });
}


function brasiliaDatePartsNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const weekday = String(parts.find((part) => part.type === "weekday")?.value || "Sun");
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.find((part) => part.type === "year")?.value || 0),
    month: Number(parts.find((part) => part.type === "month")?.value || 1),
    day: Number(parts.find((part) => part.type === "day")?.value || 1),
    weekday: map[weekday] ?? 0,
    hour: Number(parts.find((part) => part.type === "hour")?.value || 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value || 0),
  };
}

function ymdFromUTCDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function reservationDayAllowed(config: PublicStoreStatus | null, ymd: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [year, month, day] = ymd.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (config?.business_hours_enabled !== true) return true;
  const ranges = Array.isArray(config?.business_hours) ? config!.business_hours! : [];
  return ranges.some((range) => Array.isArray(range.days) && range.days.map(Number).includes(weekday));
}

function nextReservationDate(config: PublicStoreStatus | null) {
  const now = brasiliaDatePartsNow();
  const base = new Date(Date.UTC(now.year, now.month - 1, now.day));
  const currentMinutes = now.hour * 60 + now.minute;
  const ranges = Array.isArray(config?.business_hours) ? config!.business_hours! : [];

  for (let offset = 0; offset <= 30; offset += 1) {
    const candidate = new Date(base.getTime() + offset * 86400000);
    const ymd = ymdFromUTCDate(candidate);
    if (!reservationDayAllowed(config, ymd)) continue;

    if (offset === 0 && config?.business_hours_enabled === true) {
      const weekday = candidate.getUTCDay();
      const hasFutureOpening = ranges.some((range) => {
        if (!Array.isArray(range.days) || !range.days.map(Number).includes(weekday)) return false;
        const open = storeTimeToMinutes(range.open);
        return open != null && open > currentMinutes;
      });
      if (!hasFutureOpening) continue;
    }
    return ymd;
  }

  const tomorrow = new Date(base.getTime() + 86400000);
  return ymdFromUTCDate(tomorrow);
}

function maxReservationDate() {
  const now = brasiliaDatePartsNow();
  const base = new Date(Date.UTC(now.year, now.month - 1, now.day));
  return ymdFromUTCDate(new Date(base.getTime() + 30 * 86400000));
}

function formatReservationDate(ymd: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [year, month, day] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatStoreBusinessHours(config: PublicStoreStatus | null) {
  const ranges = Array.isArray(config?.business_hours) ? config!.business_hours! : [];
  if (!ranges.length) return "horário não informado";

  const names = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  return ranges
    .filter((r) => Array.isArray(r.days) && r.days.length && r.open && r.close)
    .map((r) => {
      const days = [...r.days].map(Number).sort((a, b) => a - b);
      return `${days.map((d) => names[d] || "").filter(Boolean).join(", ")}: ${String(r.open).slice(0, 5)} às ${String(r.close).slice(0, 5)}`;
    })
    .join(" • ");
}

function CustomerHome() {
  const nav = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [publicReviews, setPublicReviews] = useState<PublicReview[]>([]);
  const [publicReviewsAverage, setPublicReviewsAverage] = useState(0);
  const [showPublicReviews, setShowPublicReviews] = useState(false);
  const [storeName, setStoreName] = useState("HotBox Delivery");
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartHydrated, setCartHydrated] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [activeOrders, setActiveOrders] = useState<ActiveOrderSummary[]>([]);
  const [checkingActiveOrders, setCheckingActiveOrders] = useState(false);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerTagline, setBannerTagline] = useState(
    "Somos uma batataria apaixonada por capricho: batatas recheadas de verdade, com muito recheio e muito sabor. Peça agora e descubra por que a HotBox quer ser lembrada entre as mais bem recheadas de Duque de Caxias.",
  );
  const [deliveryTime, setDeliveryTime] = useState<number | null>(null);
  const [infinitepayEnabled, setInfinitepayEnabled] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState<CheckoutPayment>("infinitepay");
  const [paymentAvailable, setPaymentAvailable] = useState(false);
  const [mercadoPagoPublicKey, setMercadoPagoPublicKey] = useState("");
  const [mercadoPagoMaxInstallments, setMercadoPagoMaxInstallments] = useState(1);
  const [mpCheckout, setMpCheckout] = useState<{ id: string; total: number } | null>(null);
  const [appmaxCheckout, setAppmaxCheckout] = useState<{ id: string; total: number } | null>(null);
  const [appmaxExternalId, setAppmaxExternalId] = useState("");
  const [appmaxMaxInstallments, setAppmaxMaxInstallments] = useState(1);
  const [ifoodStoreLink, setIfoodStoreLink] = useState("");
  const [pixEnabled, setPixEnabled] = useState(true);
  const [cardEnabled, setCardEnabled] = useState(true);
  const [payOnDeliveryEnabled, setPayOnDeliveryEnabled] = useState(false);
  const [payOnDeliveryCardEnabled, setPayOnDeliveryCardEnabled] = useState(true);
  const [payOnDeliveryPixEnabled, setPayOnDeliveryPixEnabled] = useState(true);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("online");
  const [digitalMenuEnabled, setDigitalMenuEnabled] = useState(true);
  const [publicStoreStatus, setPublicStoreStatus] = useState<PublicStoreStatus | null>(null);
  const [, setStoreClockTick] = useState(0);
  const [closedStoreReservationMode, setClosedStoreReservationMode] = useState(false);
  const [reservationDate, setReservationDate] = useState("");
  const [reservationAccepted, setReservationAccepted] = useState(false);
  const [showReservationEntryModal, setShowReservationEntryModal] = useState(false);
  const [showReservationPaymentConfirm, setShowReservationPaymentConfirm] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [customerSession, setCustomerSession] = useState<Session | null>(null);
  const [areaStatus, setAreaStatus] = useState<AreaStatus>("idle");
  const [accessCep, setAccessCep] = useState("");
  const [accessNumber, setAccessNumber] = useState("");
  const [deliveryPricingMode, setDeliveryPricingMode] = useState<"neighborhood" | "distance">("neighborhood");
  const [deliveryDistanceKm, setDeliveryDistanceKm] = useState<number | null>(null);
  const [manualNeighborhood, setManualNeighborhood] = useState("");
  const [manualAreaMode, setManualAreaMode] = useState(false);
  const [areaMessage, setAreaMessage] = useState("");
  const [validatedNeighborhood, setValidatedNeighborhood] = useState("");
  const [deliveryCutoffTime, setDeliveryCutoffTime] = useState<string | null>(null);
  const [outsideDeliveryHours, setOutsideDeliveryHours] = useState(false);
  const [schedulingEnabled, setSchedulingEnabled] = useState(false);
  const [scheduleAccepted, setScheduleAccepted] = useState(false);


  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discount: number; loyalty?: boolean } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  const [view, setView] = useState<View>("list");
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("Batata");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("todos");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [detailQty, setDetailQty] = useState(1);
  const [detailNotes, setDetailNotes] = useState("");
  const [detailAddonIds, setDetailAddonIds] = useState<string[]>([]);
  const [detailAddonQty, setDetailAddonQty] = useState<Record<string, number>>({});
  const [detailOrderBumpId, setDetailOrderBumpId] = useState<string | null>(null);
  const [detailReturnView, setDetailReturnView] = useState<"list" | "cart" | "checkout">("list");
  const [addonGroupsByProduct, setAddonGroupsByProduct] = useState<Record<string, AddonGroup[]>>({});
  const [orderBumps, setOrderBumps] = useState<OrderBump[]>([]);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    deliveryMode: "delivery" as "delivery" | "pickup",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    cep: "",
    payment: "infinitepay" as CheckoutPayment,
  });

  // Atualiza automaticamente o indicador Aberto/Fechado conforme o horário da loja.
  useEffect(() => {
    const timer = window.setInterval(() => setStoreClockTick((value) => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // Mantém a sacola mesmo se o cliente atualizar ou fechar/abrir a página.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) {
          const safe = saved
            .filter((item: any) => item?.product?.id && Number(item?.qty || 0) > 0)
            .map((item: any) => ({
              ...item,
              qty: Math.max(1, Number(item.qty || 1)),
              notes: String(item.notes || ""),
              addons: Array.isArray(item.addons) ? item.addons : [],
            }));
          setCart(safe);
        }
      }
    } catch {
      window.localStorage.removeItem(CART_STORAGE_KEY);
    } finally {
      setCartHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!cartHydrated) return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Se o navegador bloquear storage, a sacola continua funcionando nesta sessão.
    }
  }, [cart, cartHydrated]);

  // Ao recarregar, atualiza os dados dos produtos e remove da sacola qualquer item que ficou inativo.
  useEffect(() => {
    if (!cartHydrated || !products.length) return;
    setCart((current) => {
      let changed = false;
      const next = current.flatMap((item) => {
        const latest = products.find((product) => String(product.id) === String(item.product.id));
        if (!latest || latest.active !== true) {
          changed = true;
          return [];
        }
        if (latest !== item.product) changed = true;
        return [{ ...item, product: latest }];
      });
      return changed ? next : current;
    });
  }, [products, cartHydrated]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setCustomerSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setCustomerSession(session));
    return () => listener.subscription.unsubscribe();
  }, []);

  // O login OAuth do Google sai do site e volta para a página inicial.
  // Preservamos a área que JÁ foi validada nesta mesma aba para não obrigar
  // o cliente a digitar o CEP novamente depois de entrar no Clube HotBox.
  useEffect(() => {
    const saved = readAreaAccess();
    if (!saved) return;
    setAccessCep(saved.cep || "");
    setAccessNumber(saved.number || "");
    setValidatedNeighborhood(saved.neighborhood);
    setDeliveryFee(Number(saved.deliveryFee || 0));
    setDeliveryCutoffTime(saved.deliveryCutoffTime || null);
    setOutsideDeliveryHours(saved.outsideDeliveryHours === true);
    setSchedulingEnabled(saved.schedulingEnabled === true);
    setScheduleAccepted(false);
    setForm((current) => ({
      ...current,
      deliveryMode: "delivery",
      cep: saved.cep || current.cep,
      street: saved.street || current.street,
      number: saved.number || current.number,
      neighborhood: saved.neighborhood,
      city: saved.city || current.city,
    }));
    setManualAreaMode(false);
    setAreaMessage("");
    setAreaStatus("supported");
  }, []);

  useEffect(() => {
    getPublicTestimonialsFn()
      .then((result: any) => {
        if (!result?.ok) return;
        setPublicReviews((result.reviews as PublicReview[]) ?? []);
        setPublicReviewsAverage(Number(result.average || 0));
      })
      .catch((error) => {
        console.error("[cardapio] falha ao carregar avaliações públicas", error);
      });
  }, []);

  async function refreshActiveOrders() {
    const ids = readMyOrderIds();
    if (!ids.length) {
      setActiveOrders([]);
      return;
    }

    setCheckingActiveOrders(true);
    try {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("id,order_number,status,created_at,delivery_mode")
        .in("id", ids)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[cardapio] não foi possível verificar pedidos em andamento", error);
        return;
      }

      setActiveOrders(
        (((data as ActiveOrderSummary[]) || []).filter((order) =>
          ACTIVE_ORDER_STATUSES.has(String(order.status || "")),
        )),
      );
    } finally {
      setCheckingActiveOrders(false);
    }
  }

  useEffect(() => {
    void refreshActiveOrders();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshActiveOrders();
    }, 15000);

    const onFocus = () => void refreshActiveOrders();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshActiveOrders();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    supabase
      .from("products")
      .select(
        "id,name,description,category,sale_price,image_url,kind,featured,active,promotion_active,promotion_price,promotion_type,promotion_start_at,promotion_end_at,promotion_days_of_week,promotion_time_start,promotion_time_end,promotion_label,is_combo,sort_order",
      )
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name")
      .then(({ data }) => setProducts((data as Product[]) ?? []));
    Promise.all([
      supabase
        .from("store_config_public")
        .select(
          "store_name,default_delivery_fee,estimated_delivery_time_minutes,banner_image_url,banner_tagline,digital_menu_enabled,digital_menu_pix_enabled,digital_menu_card_enabled,infinitepay_enabled,ifood_store_link",
        )
        .maybeSingle(),
      (supabase as any).rpc("get_public_payment_config"),
      (supabase as any).rpc("get_public_store_status"),
      (supabase as any).from("menu_addon_groups").select("id,name,display_title,description,display_subtitle,required,min_select,max_select,active,sort_order").eq("active", true).order("sort_order"),
      (supabase as any).from("menu_addon_options").select("id,group_id,name,display_name,description,display_description,image_url,price,linked_product_id,use_linked_product_price,active,sort_order").eq("active", true).order("sort_order"),
      (supabase as any).from("product_addon_groups").select("product_id,group_id,sort_order").order("sort_order"),
      (supabase as any).from("menu_order_bumps").select("id,product_id,title,subtitle,placement,price_override,active,sort_order").eq("active", true).order("sort_order"),
    ]).then(([storeResult, paymentResult, storeStatusResult, groupResult, optionResult, linkResult, bumpResult]: any[]) => {
      const data = storeResult?.data;
      if (data) {
        setStoreName(data.store_name ?? "HotBox Delivery");

        // Não sobrescreve a taxa que já foi calculada pelo CEP/bairro.
        // O carregamento assíncrono da configuração da loja podia terminar DEPOIS
        // da validação do endereço e trocar a taxa real pelo default (muitas vezes 0).
        const savedArea = readAreaAccess();
        setDeliveryFee((currentFee) => {
          if (savedArea && Number.isFinite(Number(savedArea.deliveryFee))) {
            return Number(savedArea.deliveryFee);
          }
          if (areaStatus === "supported" && Number.isFinite(Number(currentFee))) {
            return Number(currentFee);
          }
          return Number(data.default_delivery_fee ?? 0);
        });

        setDeliveryTime(data.estimated_delivery_time_minutes ?? null);
        setBannerUrl(data.banner_image_url ?? null);
        setInfinitepayEnabled((data as any).infinitepay_enabled === true);
        setIfoodStoreLink(String((data as any).ifood_store_link || ""));
        setDigitalMenuEnabled((data as any).digital_menu_enabled !== false);
        setPixEnabled((data as any).digital_menu_pix_enabled !== false);
        setCardEnabled((data as any).digital_menu_card_enabled !== false);
        if (data.banner_tagline) setBannerTagline(data.banner_tagline);
      }
      const loadedStoreStatus = (storeStatusResult?.data || {}) as PublicStoreStatus;
      setPublicStoreStatus(loadedStoreStatus);
      if (!isStoreOpenByBusinessHours(loadedStoreStatus) && loadedStoreStatus.closed_reservations_enabled === true) {
        setReservationDate((current) => current || nextReservationDate(loadedStoreStatus));
      }

      const pay = paymentResult?.data || {};
      const provider: CheckoutPayment = pay.provider === "mercadopago" ? "mercadopago" : pay.provider === "appmax" ? "appmax" : "infinitepay";
      setPaymentProvider(provider);
      setPaymentAvailable(pay.payment_available === true);
      setMercadoPagoPublicKey(String(pay.mercadopago_public_key || ""));
      setMercadoPagoMaxInstallments(Math.min(12, Math.max(1, Number(pay.mercadopago_max_installments || 1))));
      setAppmaxExternalId(String(pay.appmax_external_id || ""));
      setAppmaxMaxInstallments(Math.min(12, Math.max(1, Number(pay.appmax_max_installments || 1))));
      setPayOnDeliveryEnabled(pay.pay_on_delivery_enabled === true);
      setPayOnDeliveryCardEnabled(pay.pay_on_delivery_card_enabled !== false);
      setPayOnDeliveryPixEnabled(pay.pay_on_delivery_pix_enabled !== false);
      const onlineMethodsEnabled = (data as any)?.digital_menu_pix_enabled !== false || (data as any)?.digital_menu_card_enabled !== false;
      if ((!onlineMethodsEnabled || pay.payment_available !== true) && pay.pay_on_delivery_enabled === true) {
        setPaymentChoice(pay.pay_on_delivery_card_enabled !== false ? "delivery_card" : "delivery_pix");
      } else {
        setPaymentChoice("online");
      }
      setForm((current) => ({ ...current, payment: provider }));

      const groups = (groupResult?.data || []) as AddonGroup[];
      const options = (optionResult?.data || []) as AddonOption[];
      const links = (linkResult?.data || []) as Array<{ product_id: string; group_id: string; sort_order?: number }>;
      const groupMap = new Map(groups.map((g) => [String(g.id), { ...g, options: options.filter((o) => String(o.group_id) === String(g.id)) }]));
      const byProduct: Record<string, AddonGroup[]> = {};
      for (const link of links) {
        const group = groupMap.get(String(link.group_id));
        if (!group) continue;
        const productId = String(link.product_id);
        byProduct[productId] ||= [];
        byProduct[productId].push(group);
      }
      setAddonGroupsByProduct(byProduct);
      setOrderBumps((bumpResult?.data || []) as OrderBump[]);
      setConfigLoaded(true);
    }).catch((error) => {
      console.error("[cardapio] falha ao carregar configurações", error);
      setConfigLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (form.payment !== paymentProvider) setForm((current) => ({ ...current, payment: paymentProvider }));
  }, [form.payment, paymentProvider]);

  useEffect(() => {
    if (form.deliveryMode === "pickup") {
      if (paymentChoice !== "online") setPaymentChoice("online");
      setScheduleAccepted(false);
    }
  }, [form.deliveryMode, paymentChoice]);

  useEffect(() => {
    if (areaStatus !== "supported") return;
    const saved = readAreaAccess();
    if (!saved) return;
    const savedFee = Number(saved.deliveryFee);
    if (!Number.isFinite(savedFee)) return;
    if (Number(deliveryFee) !== savedFee) setDeliveryFee(savedFee);
  }, [areaStatus, deliveryFee]);

  useEffect(() => {
    const n = String(customerSession?.user?.user_metadata?.full_name || customerSession?.user?.user_metadata?.name || "").trim();
    if (n) setForm((current) => current.name ? current : { ...current, name: n });
  }, [customerSession?.user?.id]);



  function redirectOutsideArea() {
    const target = ifoodStoreLink.trim();
    if (target) {
      window.location.replace(target);
      return;
    }
    window.location.replace(WHATSAPP_URL);
  }
  async function checkDeliveryArea(neighborhood: string, street?: string, number?: string, city?: string) {
    const result = await quoteSiteDelivery({
      data: { neighborhood, street: street || null, number: number || null, city: city || null },
    });
    return result as any;
  }

  function applyDeliveryWindowFromQuote(quote: any) {
    setDeliveryCutoffTime(quote?.deliveryCutoffTime || null);
    setOutsideDeliveryHours(quote?.outsideDeliveryHours === true);
    setSchedulingEnabled(quote?.schedulingEnabled === true);
    setScheduleAccepted(false);
  }

  function deliveryWindowMessage(neighborhood?: string) {
    const name = neighborhood || validatedNeighborhood || form.neighborhood || "seu bairro";
    if (!deliveryCutoffTime) return "";
    if (!outsideDeliveryHours) {
      return `Entregas para ${name} disponíveis hoje até ${deliveryCutoffTime} (horário de Brasília).`;
    }
    if (schedulingEnabled) {
      return `O horário de entrega para ${name} encerrou às ${deliveryCutoffTime} (horário de Brasília). Você pode agendar o pedido para o próximo horário disponível; a HotBox entrará em contato para confirmar a entrega.`;
    }
    return `O horário de entrega para ${name} encerrou às ${deliveryCutoffTime} (horário de Brasília). Não é possível finalizar pedidos para este bairro agora.`;
  }

  async function validateCepAccess() {
    const cep = onlyDigits(accessCep);
    if (cep.length !== 8) {
      setAreaStatus("error");
      setAreaMessage("Digite um CEP válido com 8 números.");
      return;
    }
    setAreaStatus("checking");
    setAreaMessage("");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (!response.ok) throw new Error("Falha ao consultar CEP");
      const address = await response.json();
      if (address?.erro) throw new Error("CEP não encontrado");
      if (!address?.bairro) {
        setManualAreaMode(true);
        setAreaStatus("error");
        setAreaMessage("Encontramos o CEP, mas ele não informou o bairro. Digite seu bairro abaixo para continuar.");
        setForm((current) => ({
          ...current,
          cep,
          street: address?.logradouro || current.street,
          city: address?.localidade || current.city,
        }));
        return;
      }
      const quote = await checkDeliveryArea(address.bairro, address.logradouro || undefined, accessNumber || undefined, address.localidade || undefined);
      applyDeliveryWindowFromQuote(quote);
      if (quote?.supported && quote?.needsNumber) {
        const supportedNeighborhood = String(quote.neighborhood || address.bairro);
        setDeliveryPricingMode("distance");
        setValidatedNeighborhood(supportedNeighborhood);
        setForm((current) => ({
          ...current,
          deliveryMode: "delivery",
          cep,
          street: address.logradouro || current.street,
          neighborhood: supportedNeighborhood,
          city: address.localidade || current.city,
        }));
        setAreaStatus("needs_number");
        setAreaMessage("Para calcular a taxa por quilometragem com precisão, informe o número do endereço.");
        return;
      }
      if (!quote?.supported) {
        setValidatedNeighborhood(address.bairro);
        redirectOutsideArea();
        return;
      }
      if (quote?.quoteUnavailable) {
        setAreaStatus("error");
        setAreaMessage("Não conseguimos calcular a distância desse endereço com segurança. Confira o número e tente novamente.");
        return;
      }
      setDeliveryPricingMode(quote?.pricingMode === "distance" ? "distance" : "neighborhood");
      setDeliveryDistanceKm(quote?.distanceKm == null ? null : Number(quote.distanceKm));
      const fee = Number(quote.fee ?? deliveryFee ?? 0);
      setDeliveryFee(Number.isFinite(fee) ? fee : 0);
      setValidatedNeighborhood(String(quote.neighborhood || address.bairro));
      const supportedNeighborhood = String(quote.neighborhood || address.bairro);
      setForm((current) => ({
        ...current,
        deliveryMode: "delivery",
        cep,
        street: address.logradouro || current.street,
        number: accessNumber || current.number,
        neighborhood: supportedNeighborhood,
        city: address.localidade || current.city,
      }));
      saveAreaAccess({
        cep,
        street: address.logradouro || "",
        number: accessNumber || "",
        neighborhood: supportedNeighborhood,
        city: address.localidade || "",
        deliveryFee: Number.isFinite(fee) ? fee : 0,
        deliveryCutoffTime: quote?.deliveryCutoffTime || null,
        outsideDeliveryHours: quote?.outsideDeliveryHours === true,
        schedulingEnabled: quote?.schedulingEnabled === true,
        savedAt: Date.now(),
      });
      setAreaStatus("supported");
      setAreaMessage("");
      toast.success("Entrega disponível para o seu endereço!");
    } catch (error) {
      console.error(error);
      setAreaStatus("error");
      setManualAreaMode(true);
      setAreaMessage("Não conseguimos consultar esse CEP agora. Você pode informar seu bairro manualmente.");
    }
  }

  async function validateManualNeighborhood() {
    const neighborhood = manualNeighborhood.trim();
    if (neighborhood.length < 3) {
      setAreaStatus("error");
      setAreaMessage("Informe o nome do bairro para continuar.");
      return;
    }
    setAreaStatus("checking");
    try {
      const quote = await checkDeliveryArea(neighborhood);
      applyDeliveryWindowFromQuote(quote);
      if (!quote?.supported) {
        setValidatedNeighborhood(neighborhood);
        redirectOutsideArea();
        return;
      }
      if (quote?.needsNumber || quote?.pricingMode === "distance") {
        setDeliveryPricingMode("distance");
        setAreaStatus("error");
        setAreaMessage("A loja está cobrando por quilometragem. Para calcular a taxa corretamente, informe o CEP e o número do endereço.");
        return;
      }
      setDeliveryPricingMode("neighborhood");
      const fee = Number(quote.fee ?? deliveryFee ?? 0);
      setDeliveryFee(Number.isFinite(fee) ? fee : 0);
      setValidatedNeighborhood(String(quote.neighborhood || neighborhood));
      const supportedNeighborhood = String(quote.neighborhood || neighborhood);
      setForm((current) => ({
        ...current,
        deliveryMode: "delivery",
        neighborhood: supportedNeighborhood,
      }));
      saveAreaAccess({
        neighborhood: supportedNeighborhood,
        deliveryFee: Number.isFinite(fee) ? fee : 0,
        deliveryCutoffTime: quote?.deliveryCutoffTime || null,
        outsideDeliveryHours: quote?.outsideDeliveryHours === true,
        schedulingEnabled: quote?.schedulingEnabled === true,
        savedAt: Date.now(),
      });
      setAreaStatus("supported");
      setAreaMessage("");
      toast.success("Pronto! Confira o cardápio disponível para você.");
    } catch (error) {
      console.error(error);
      setAreaStatus("error");
      setAreaMessage("Não foi possível validar o bairro agora. Tente novamente.");
    }
  }

  async function refreshDeliveryQuoteForCheckout(nextNumber?: string) {
    if (form.deliveryMode !== "delivery" || !form.neighborhood || !form.street) return;
    const number = String(nextNumber ?? form.number ?? "").trim();
    if (!number) return;
    try {
      const quote = await checkDeliveryArea(form.neighborhood, form.street, number, form.city);
      applyDeliveryWindowFromQuote(quote);
      if (quote?.supported && quote?.fee != null && !quote?.quoteUnavailable) {
        const fee = Number(quote.fee);
        if (Number.isFinite(fee)) {
          setDeliveryFee(fee);
          saveAreaAccess({
            cep: form.cep || accessCep || "",
            street: form.street || "",
            number,
            neighborhood: String(quote.neighborhood || form.neighborhood || validatedNeighborhood || ""),
            city: form.city || "",
            deliveryFee: fee,
            deliveryCutoffTime: quote?.deliveryCutoffTime || null,
            outsideDeliveryHours: quote?.outsideDeliveryHours === true,
            schedulingEnabled: quote?.schedulingEnabled === true,
            savedAt: Date.now(),
          });
        }
        setDeliveryPricingMode(quote?.pricingMode === "distance" ? "distance" : "neighborhood");
        setDeliveryDistanceKm(quote?.distanceKm == null ? null : Number(quote.distanceKm));
      }
    } catch (error) {
      console.error("[cardapio] falha ao recalcular taxa", error);
    }
  }

  function resetAreaAccess() {
    clearAreaAccess();
    setAreaStatus("idle");
    setAreaMessage("");
    setValidatedNeighborhood("");
    setAccessCep("");
    setAccessNumber("");
    setDeliveryDistanceKm(null);
    setDeliveryCutoffTime(null);
    setOutsideDeliveryHours(false);
    setSchedulingEnabled(false);
    setScheduleAccepted(false);
    setManualNeighborhood("");
    setManualAreaMode(false);
    setCart([]);
    setView("list");
    setForm((current) => ({ ...current, street: "", number: "", complement: "", neighborhood: "", city: "", cep: "" }));
  }

  const categories = useMemo(() => {
    const normalize = (value: unknown) =>
      String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    const remaining = Array.from(
      new Set(
        products
          .map((p) => p.category || "Outros")
          .filter((category) => !normalize(category).includes("batata")),
      ),
    );

    return ["Batata", "Tudo", ...remaining];
  }, [products]);
  const featured = useMemo(
    () =>
      products
        .filter((p) => p.featured && p.active)
        .sort((a, b) => {
          const groupDiff = productMenuGroupPriority(a) - productMenuGroupPriority(b);
          if (groupDiff !== 0) return groupDiff;
          const aOrder = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 999999;
          const bOrder = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999999;
          return aOrder - bOrder;
        }),
    [products],
  );

  const reviewsWithComments = useMemo(
    () => publicReviews.filter((review) => !!review.comment),
    [publicReviews],
  );
  const reviewsWithoutComments = useMemo(
    () => publicReviews.filter((review) => !review.comment),
    [publicReviews],
  );
  const filtered = useMemo(() => {
    return products
      .filter((p) => {
        const normalizedCategory = String(p.category || "Outros")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        const matchesCategory =
          activeCategory === "Tudo" ||
          (activeCategory === "Batata"
            ? normalizedCategory.includes("batata")
            : (p.category || "Outros") === activeCategory);
        const matchesQuery = !query.trim() || p.name.toLowerCase().includes(query.toLowerCase());
        const matchesStatus =
          activeFilter === "todos" || (activeFilter === "ativos" && p.active) || (activeFilter === "inativos" && !p.active);
        return matchesCategory && matchesQuery && matchesStatus;
      })
      .sort((a, b) => {
        const groupDiff = productMenuGroupPriority(a) - productMenuGroupPriority(b);
        if (groupDiff !== 0) return groupDiff;

        const activeDiff = Number(b.active) - Number(a.active);
        if (activeDiff !== 0) return activeDiff;

        const aOrder = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 999999;
        const bOrder = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999999;
        return aOrder - bOrder || String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
      });
  }, [products, activeCategory, query, activeFilter]);

  function basePriceForCartItem(item: CartItem) {
    if (item.orderBumpId && item.bumpPrice != null && Number.isFinite(Number(item.bumpPrice))) return Number(item.bumpPrice);
    return Number(getEffectivePrice(item.product).price);
  }

  function cartUnitPrice(item: CartItem) {
    return Number((basePriceForCartItem(item) + item.addons.reduce((sum, a) => sum + Number(a.price || 0) * Math.max(1, Number(a.qty || 1)), 0)).toFixed(2));
  }

  const subtotal = cart.reduce((s, i) => s + cartUnitPrice(i) * i.qty, 0);
  const isDelivery = form.deliveryMode === "delivery";
  const couponDiscount = appliedCoupon?.discount ?? 0;
  const total = Math.max(0, subtotal - couponDiscount) + (cart.length && isDelivery ? deliveryFee : 0);

  function deliveryFeeLabel() {
    if (!isDelivery) return "Retirada";
    if (areaStatus !== "supported") return "A calcular";
    return brl(Number(deliveryFee || 0));
  }

  function scrollToCheckoutSection(id: string) {
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  useEffect(() => {
    if (!mpCheckout) return;
    scrollToCheckoutSection("payment-section");
  }, [mpCheckout?.id]);

  const paymentSupportWhatsappUrl = useMemo(() => {
    const itemLines = cart.map((item) => {
      const addons = item.addons.length
        ? ` | Adicionais: ${item.addons.map((a) => `${Math.max(1, Number(a.qty || 1))}x ${a.name}`).join(", ")}`
        : "";
      const notes = item.notes?.trim() ? ` | Obs.: ${item.notes.trim()}` : "";
      return `• ${item.qty}x ${item.product.name} — ${brl(cartUnitPrice(item) * item.qty)}${addons}${notes}`;
    });

    const address = isDelivery
      ? [
          `${form.street || "—"}, ${form.number || "—"}`,
          form.complement?.trim() ? `Complemento: ${form.complement.trim()}` : null,
          form.neighborhood || null,
          form.city || null,
          form.cep ? `CEP: ${form.cep}` : null,
        ].filter(Boolean).join(" | ")
      : "Retirada no local";

    const lines = [
      "Olá, vim pelo cardápio digital da Hotbox e preciso de ajuda para concluir o pagamento.",
      "",
      "*DADOS DO PEDIDO*",
      `Nome: ${form.name || "—"}`,
      `Telefone: ${formatPhone(form.phone) || form.phone || "—"}`,
      `Endereço: ${address}`,
      "",
      "*ITENS*",
      ...(itemLines.length ? itemLines : ["• Pedido sem itens carregados"]),
      "",
      `Subtotal: ${brl(subtotal)}`,
      ...(appliedCoupon?.code ? [`Cupom: ${appliedCoupon.code} (-${brl(couponDiscount)})`] : []),
      `Taxa de entrega: ${isDelivery ? brl(deliveryFee) : "R$ 0,00"}`,
      `*Total: ${brl(mpCheckout?.total ?? total)}*`,
      ...(mpCheckout?.id ? [`Referência do checkout: ${mpCheckout.id}`] : []),
      "",
      "Meu pagamento não foi autorizado. Preciso receber um link de pagamento.",
    ];

    return `https://wa.me/5521984296288?text=${encodeURIComponent(lines.join("\\n"))}`;
  }, [cart, form, isDelivery, subtotal, couponDiscount, appliedCoupon?.code, deliveryFee, total, mpCheckout?.total, mpCheckout?.id]);

  const couponCartPayload = () =>
    cart.map((i) => {
      const eff = getEffectivePrice(i.product);
      return {
        product_id: i.product.id,
        product_name: i.product.name,
        qty: i.qty,
        unit_price: cartUnitPrice(i),
        list_price: eff.listPrice,
        is_promotion_price: eff.isPromotion,
        notes: i.notes || null,
      };
    });
  const totalQty = cart.reduce((s, i) => s + i.qty, 0);

  async function applyCoupon(explicitCode?: string) {
    const code = String(explicitCode || couponInput).trim().toUpperCase();
    if (!code) return;
    const couponPhone = onlyDigits(form.phone);
    if (couponPhone.length < 10) {
      setCouponInput(code);
      setCouponError("Informe seu WhatsApp para validar o cupom. O número já ficará preenchido no checkout.");
      setView("cart");
      return;
    }
    setCheckingCoupon(true);
    setCouponError("");
    try {
      if (code.startsWith("HB-FIEL-")) {
        const quoted = await quoteLoyaltyReward({
          data: {
            accessToken: customerSession?.access_token || null,
            code,
            deliveryMode: form.deliveryMode,
            items: cart.map((i) => ({ product_id: i.product.id, qty: i.qty })),
          },
        });
        if (!quoted.ok) {
          setAppliedCoupon(null);
          setCouponInput(code);
          setCouponError((quoted as any).reason || "Cupom de fidelidade indisponível.");
          return;
        }
        setCouponInput(code);
        setAppliedCoupon({ code: quoted.code, discount: Number(quoted.discount || 0), loyalty: true });
        toast.success(`🔥 Recompensa aplicada: ${quoted.productName} grátis!`);
        return;
      }

      const { data, error } = await (supabase as any).rpc("validate_coupon_public", {
        p_code: code,
        p_subtotal: subtotal,
        p_customer_phone: couponPhone,
        p_cart: couponCartPayload(),
      });
      if (error) throw error;
      if (!data?.ok) {
        setAppliedCoupon(null);
        setCouponError(data?.reason || "Cupom inválido");
        return;
      }
      setCouponInput(code);
      setAppliedCoupon({ code: data.code, discount: Number(data.discount || 0), loyalty: false });
      toast.success("Cupom aplicado!");
    } catch (err) {
      console.error(err);
      setAppliedCoupon(null);
      setCouponError("Não foi possível validar o cupom. Tente novamente.");
    } finally {
      setCheckingCoupon(false);
    }
  }

  function removeCoupon() {
    setAppliedCoupon(null);
    setCouponInput("");
    setCouponError("");
  }

  useEffect(() => {
    if (!appliedCoupon?.code || !cart.length) return;
    const couponPhone = onlyDigits(form.phone);
    if (couponPhone.length < 10) return;
    const timer = window.setTimeout(async () => {
      if (appliedCoupon.loyalty || appliedCoupon.code.startsWith("HB-FIEL-")) {
        const quoted = await quoteLoyaltyReward({
          data: {
            accessToken: customerSession?.access_token || null,
            code: appliedCoupon.code,
            deliveryMode: form.deliveryMode,
            items: cart.map((i) => ({ product_id: i.product.id, qty: i.qty })),
          },
        });
        if (!quoted.ok) {
          setAppliedCoupon(null);
          setCouponError((quoted as any).reason || "A recompensa deixou de ser válida para este carrinho.");
          return;
        }
        const nextDiscount = Number(quoted.discount || 0);
        setAppliedCoupon((current) => current ? { ...current, discount: nextDiscount, loyalty: true } : current);
        setCouponError("");
        return;
      }
      const { data, error } = await (supabase as any).rpc("validate_coupon_public", {
        p_code: appliedCoupon.code,
        p_subtotal: subtotal,
        p_customer_phone: couponPhone,
        p_cart: couponCartPayload(),
      });
      if (error || !data?.ok) {
        setAppliedCoupon(null);
        setCouponError(data?.reason || "O cupom deixou de ser válido para este carrinho.");
        return;
      }
      const nextDiscount = Number(data.discount || 0);
      setAppliedCoupon((current) => current ? { ...current, discount: nextDiscount } : current);
      setCouponError("");
    }, 250);
    return () => window.clearTimeout(timer);
  }, [subtotal, form.phone, form.deliveryMode, cart, appliedCoupon?.code, customerSession?.access_token]);

  function openDetail(p: Product, orderBumpId?: string | null, returnView: "list" | "cart" | "checkout" = "list") {
    trackAnalytics("product_view", { event_category: "commerce", product_id: p.id, product_name: p.name, value: Number(getEffectivePrice(p).price || 0), properties: { category: p.category, featured: p.featured, order_bump: Boolean(orderBumpId) } });
    setSelectedProduct(p);
    setDetailQty(1);
    setDetailNotes("");
    setDetailAddonIds([]);
    setDetailAddonQty({});
    setDetailOrderBumpId(orderBumpId || null);
    setDetailReturnView(returnView);
    setView("detail");
  }

  function addonQty(optionId: string) {
    return Math.max(0, Number(detailAddonQty[optionId] || (detailAddonIds.includes(optionId) ? 1 : 0)));
  }

  function groupSelectedUnits(group: AddonGroup) {
    return group.options.reduce((sum, option) => sum + addonQty(String(option.id)), 0);
  }

  function setDetailAddonQuantity(group: AddonGroup, option: AddonOption, nextQty: number) {
    const optionId = String(option.id);
    const currentQty = addonQty(optionId);
    const currentGroupTotal = groupSelectedUnits(group);
    const max = Math.max(1, Number(group.max_select || 1));
    const clamped = Math.max(0, Math.floor(nextQty));

    if (clamped > currentQty && currentGroupTotal + (clamped - currentQty) > max) {
      toast.error(`Você pode adicionar no máximo ${max} unidade(s) em ${group.name}.`);
      return;
    }

    setDetailAddonQty((current) => ({ ...current, [optionId]: clamped }));
    setDetailAddonIds((current) => {
      if (clamped <= 0) return current.filter((id) => id !== optionId);
      if (current.includes(optionId)) return current;
      return [...current, optionId];
    });
  }

  function toggleDetailAddon(group: AddonGroup, option: AddonOption) {
    const optionId = String(option.id);
    const currentQty = addonQty(optionId);

    if (group.max_select === 1) {
      const groupOptionIds = new Set(group.options.map((o) => String(o.id)));
      setDetailAddonIds((current) => [
        ...current.filter((id) => !groupOptionIds.has(id)),
        ...(currentQty > 0 ? [] : [optionId]),
      ]);
      setDetailAddonQty((current) => {
        const next = { ...current };
        for (const id of groupOptionIds) delete next[id];
        if (currentQty <= 0) next[optionId] = 1;
        return next;
      });
      return;
    }

    setDetailAddonQuantity(group, option, currentQty > 0 ? 0 : 1);
  }

  function effectiveAddonOptionPrice(option: AddonOption) {
    if (option.linked_product_id && option.use_linked_product_price === true) {
      const linked = products.find((product) => String(product.id) === String(option.linked_product_id));
      if (linked) return Number(getEffectivePrice(linked).price || 0);
    }
    return Number(option.price || 0);
  }

  function selectedDetailAddons(productId: string): CartAddon[] {
    const groups = addonGroupsByProduct[productId] || [];
    const options = groups.flatMap((g) => g.options);
    return detailAddonIds
      .map((id) => options.find((o) => String(o.id) === id))
      .filter(Boolean)
      .map((o: AddonOption) => ({
        option_id: String(o.id),
        group_id: String(o.group_id),
        name: String(o.name),
        price: effectiveAddonOptionPrice(o),
        qty: Math.max(1, addonQty(String(o.id))),
      }));
  }

  function validateDetailAddons(productId: string) {
    for (const group of addonGroupsByProduct[productId] || []) {
      const selected = groupSelectedUnits(group);
      const min = Math.max(0, Number(group.min_select || 0), group.required ? 1 : 0);
      const max = Math.max(1, Number(group.max_select || 1));
      if (selected < min) {
        toast.error(`Escolha pelo menos ${min} unidade(s) em ${group.name}.`);
        return false;
      }
      if (selected > max) {
        toast.error(`Escolha no máximo ${max} unidade(s) em ${group.name}.`);
        return false;
      }
    }
    return true;
  }

  function goToCheckoutFromCart() {
    trackAnalytics("begin_checkout", {
      event_category: "commerce",
      value: total,
      properties: { items_count: totalQty },
    });

    const storeOpenNow = isStoreOpenByBusinessHours(publicStoreStatus);
    if (!storeOpenNow && publicStoreStatus?.closed_reservations_enabled === true) {
      setClosedStoreReservationMode(true);
      setReservationDate((current) => current || nextReservationDate(publicStoreStatus));
      setReservationAccepted(false);
      setShowReservationEntryModal(true);
      return;
    }

    setView("checkout");
  }

  function canStartPurchaseNow() {
    if (isStoreOpenByBusinessHours(publicStoreStatus)) return true;

    const hours = formatStoreBusinessHours(publicStoreStatus);
    const custom = String(publicStoreStatus?.business_hours_closed_message || "").trim();

    if (publicStoreStatus?.closed_reservations_enabled === true) {
      setClosedStoreReservationMode(true);
      setReservationDate((current) => current || nextReservationDate(publicStoreStatus));
      toast.info(
        custom
          ? `${custom} Você pode reservar seu pedido agora para receber quando estivermos em funcionamento.`
          : "A loja está fechada agora, mas você pode reservar seu pedido e garantir sua posição na fila do próximo atendimento.",
        { duration: 6500 },
      );
      return true;
    }

    toast.error(
      custom
        ? `${custom} Horário de funcionamento: ${hours}.`
        : `Loja fechada no momento. Horário de funcionamento: ${hours}.`,
      { duration: 7000 },
    );
    return false;
  }

  function addToCartFromDetail() {
    if (!selectedProduct) return;
    if (!canStartPurchaseNow()) return;
    if (!selectedProduct.active) {
      toast.error("Este produto está esgotado por hoje.");
      return;
    }
    if (!validateDetailAddons(selectedProduct.id)) return;
    const addons = selectedDetailAddons(selectedProduct.id);
    const bump = detailOrderBumpId ? orderBumps.find((b) => String(b.id) === detailOrderBumpId) : null;
    const bumpPrice = bump?.price_override == null ? null : Number(bump.price_override);
    const signature = addons.map((a) => `${a.option_id}:${Math.max(1, Number(a.qty || 1))}`).sort().join(",");
    setCart((c) => {
      const ex = c.find((i) =>
        i.product.id === selectedProduct.id &&
        i.notes === detailNotes &&
        (i.orderBumpId || "") === (detailOrderBumpId || "") &&
        i.addons.map((a) => `${a.option_id}:${Math.max(1, Number(a.qty || 1))}`).sort().join(",") === signature
      );
      if (ex) return c.map((i) => (i === ex ? { ...i, qty: i.qty + detailQty } : i));
      return [...c, { product: selectedProduct, qty: detailQty, notes: detailNotes, addons, orderBumpId: detailOrderBumpId, bumpPrice }];
    });
    trackAnalytics("add_to_cart", { event_category: "commerce", product_id: selectedProduct.id, product_name: selectedProduct.name, quantity: detailQty, value: Number(getEffectivePrice(selectedProduct).price || 0), properties: { addons: addons.map(a => a.name), addon_total: addons.reduce((sum,a)=>sum+Number(a.price||0)*Math.max(1,Number(a.qty||1)),0), order_bump_id: detailOrderBumpId || null } });
    toast.success(`${selectedProduct.name} adicionado`);
    setDetailOrderBumpId(null);
    setView(detailReturnView);
  }

  function addOrderBump(bump: OrderBump) {
    if (!canStartPurchaseNow()) return;
    const product = products.find((p) => String(p.id) === String(bump.product_id));
    if (!product || !product.active) return;
    if ((addonGroupsByProduct[product.id] || []).length) {
      openDetail(product, bump.id, view === "checkout" ? "checkout" : "cart");
      return;
    }
    const bumpPrice = bump.price_override == null ? null : Number(bump.price_override);
    setCart((current) => {
      const existing = current.find((i) => i.orderBumpId === bump.id);
      if (existing) return current.map((i) => i === existing ? { ...i, qty: i.qty + 1 } : i);
      return [...current, { product, qty: 1, notes: "", addons: [], orderBumpId: bump.id, bumpPrice }];
    });
    trackAnalytics("order_bump_added", { event_category: "commerce", product_id: product.id, product_name: product.name, quantity: 1, value: Number(bumpPrice ?? getEffectivePrice(product).price ?? 0), properties: { bump_id: bump.id, placement: bump.placement } });
    toast.success(`${product.name} adicionado à sacola`);
  }

  const changeQty = (idx: number, d: number) =>
    setCart((c) => c.map((i, ix) => (ix === idx ? { ...i, qty: Math.max(0, i.qty + d) } : i)).filter((i) => i.qty > 0));
  const updateNotes = (idx: number, notes: string) =>
    setCart((c) => c.map((i, ix) => (ix === idx ? { ...i, notes } : i)));
  const removeItem = (idx: number) => setCart((c) => c.filter((_, ix) => ix !== idx));

  function requestPlaceOrder() {
    const storeOpenNow = isStoreOpenByBusinessHours(publicStoreStatus);
    const isReservation =
      !storeOpenNow &&
      publicStoreStatus?.closed_reservations_enabled === true &&
      closedStoreReservationMode;

    if (isReservation) {
      if (!reservationDate) {
        toast.error("Escolha a data da sua reserva antes de continuar.");
        return;
      }
      if (!reservationDayAllowed(publicStoreStatus, reservationDate)) {
        toast.error("Escolha um dia em que a HotBox esteja em funcionamento.");
        return;
      }
      setShowReservationPaymentConfirm(true);
      return;
    }

    void placeOrder();
  }

  async function placeOrder(reservationConfirmedNow = false) {
    if (!cart.length) return toast.error("Seu carrinho está vazio");
    if (!form.name || !form.phone) return toast.error("Preencha nome e telefone");
    if (isDelivery && (!form.street || !form.number || !form.neighborhood)) return toast.error("Preencha rua, número e bairro");
    const storeOpenNow = isStoreOpenByBusinessHours(publicStoreStatus);
    if (!storeOpenNow) {
      if (publicStoreStatus?.closed_reservations_enabled !== true) {
        canStartPurchaseNow();
        return;
      }
      if (!closedStoreReservationMode) setClosedStoreReservationMode(true);
      if (!reservationDate) return toast.error("Escolha a data da sua reserva.");
      if (!reservationDayAllowed(publicStoreStatus, reservationDate)) {
        return toast.error("Escolha um dia em que a HotBox esteja em funcionamento.");
      }
      if (!reservationAccepted && !reservationConfirmedNow) {
        setShowReservationPaymentConfirm(true);
        return;
      }
    }
    if (isDelivery && areaStatus !== "supported") return toast.error("Valide sua área de entrega antes de finalizar");
    if (isDelivery && outsideDeliveryHours && !schedulingEnabled) {
      return toast.error(deliveryWindowMessage());
    }
    if (isDelivery && outsideDeliveryHours && schedulingEnabled && !scheduleAccepted) {
      return toast.error("Confirme o agendamento para o próximo horário disponível antes de finalizar.");
    }
    if (paymentChoice === "online" && (!(pixEnabled || cardEnabled) || !paymentAvailable)) return toast.error("Pagamento online indisponível no momento");
    if (paymentChoice !== "online" && !isDelivery) return toast.error("Pagamento na entrega só está disponível quando você escolhe entrega.");
    if (paymentChoice === "delivery_card" && (!payOnDeliveryEnabled || !payOnDeliveryCardEnabled)) return toast.error("Cartão na entrega está indisponível.");
    if (paymentChoice === "delivery_pix" && (!payOnDeliveryEnabled || !payOnDeliveryPixEnabled)) return toast.error("Pix na entrega está indisponível.");

    trackAnalytics("checkout_started", {
      event_category: "commerce", value: total, customer_name: form.name, customer_phone: onlyDigits(form.phone), payment_method: paymentChoice === "online" ? paymentProvider : paymentChoice,
      properties: { reservation: !isStoreOpenByBusinessHours(publicStoreStatus) && closedStoreReservationMode, reservation_date: reservationDate || null, delivery_mode: form.deliveryMode, neighborhood: form.neighborhood, cep_prefix: onlyDigits(form.cep).slice(0,5), delivery_fee: deliveryFee, subtotal, discount: couponDiscount, coupon: appliedCoupon?.code || null, items: cart.map(i => ({ product_id: i.product.id, product_name: i.product.name, qty: i.qty, unit_price: cartUnitPrice(i) })) }
    });
    setPlacing(true);
    try {
      const { createSiteCheckout } = await import("@/lib/site-checkout.functions");
      const created: any = await createSiteCheckout({
        data: {
          customer_name: form.name,
          customer_phone: onlyDigits(form.phone),
          delivery_mode: form.deliveryMode,
          address_street: isDelivery ? form.street : null,
          address_number: isDelivery ? form.number : null,
          address_complement: isDelivery ? form.complement || null : null,
          address_neighborhood: isDelivery ? form.neighborhood || null : null,
          address_city: isDelivery ? form.city || null : null,
          address_cep: isDelivery ? form.cep || null : null,
          payment_kind: paymentChoice === "online" ? paymentProvider : paymentChoice,
          scheduled: isDelivery && outsideDeliveryHours && schedulingEnabled && scheduleAccepted,
          store_reservation: !storeOpenNow && publicStoreStatus?.closed_reservations_enabled === true && closedStoreReservationMode,
          reservation_date: !storeOpenNow && closedStoreReservationMode ? reservationDate : null,
          reservation_acknowledged: !storeOpenNow && closedStoreReservationMode ? reservationConfirmedNow === true : false,
          coupon_code: appliedCoupon?.code || null,
          access_token: customerSession?.access_token || null,
          items: cart.map((i) => ({
            product_id: i.product.id,
            qty: i.qty,
            notes: i.notes || null,
            addons: i.addons.map((a) => ({ option_id: a.option_id, qty: Math.max(1, Number(a.qty || 1)) })),
            order_bump_id: i.orderBumpId || null,
          })),
        },
      });
      if (created?.error) throw new Error(created.error);
      if (!created?.checkout?.id) throw new Error("Checkout não criado");
      trackAnalytics("checkout_created", { event_category: "commerce", checkout_id: String(created.checkout.id), order_id: created?.order_id ? String(created.order_id) : null, customer_name: form.name, customer_phone: onlyDigits(form.phone), payment_method: paymentChoice === "online" ? paymentProvider : paymentChoice, value: Number(created.checkout.total || total), properties: { pay_on_delivery: Boolean(created?.pay_on_delivery), provider: created.checkout.payment_provider || paymentProvider } });

      if (created?.pay_on_delivery && created?.order_id) {
        trackAnalytics("purchase", { event_category: "commerce", checkout_id: String(created.checkout.id), order_id: String(created.order_id), customer_name: form.name, customer_phone: onlyDigits(form.phone), payment_method: String(created.payment_method || paymentChoice), value: Number(created.checkout.total || total), properties: { payment_timing: "delivery" } });
        pushMyOrder(String(created.order_id));
        void refreshActiveOrders();
        setCart([]);
        removeCoupon();
        window.location.href = `/obrigado?provider=delivery&order_id=${encodeURIComponent(String(created.order_id))}&method=${encodeURIComponent(String(created.payment_method || ""))}`;
        return;
      }

      const provider: CheckoutPayment = created.checkout.payment_provider === "mercadopago" ? "mercadopago" : created.checkout.payment_provider === "appmax" ? "appmax" : "infinitepay";
      if (provider === "mercadopago") {
        setPaymentProvider("mercadopago");
        setForm((current) => ({ ...current, payment: "mercadopago" }));
        trackAnalytics("payment_started", { event_category: "payment", checkout_id: String(created.checkout.id), payment_method: "mercadopago", value: Number(created.checkout.total || total) });
        setMpCheckout({ id: String(created.checkout.id), total: Number(created.checkout.total || total) });
        scrollToCheckoutSection("payment-section");
        return;
      }

      if (provider === "appmax") {
        setPaymentProvider("appmax");
        setForm((current) => ({ ...current, payment: "appmax" }));
        trackAnalytics("payment_started", { event_category: "payment", checkout_id: String(created.checkout.id), payment_method: "appmax", value: Number(created.checkout.total || total) });
        setAppmaxCheckout({ id: String(created.checkout.id), total: Number(created.checkout.total || total) });
        scrollToCheckoutSection("payment-section");
        return;
      }

      const { createInfinitePayCheckout } = await import("@/lib/infinitepay.functions");
      const payment = await createInfinitePayCheckout({
        data: { checkoutId: created.checkout.id, origin: window.location.origin },
      });
      if (!("url" in payment) || !payment.url) {
        const { cancelSiteCheckout } = await import("@/lib/site-checkout.functions");
        await cancelSiteCheckout({ data: { checkoutId: created.checkout.id, access_token: customerSession?.access_token || null } });
        throw new Error(("error" in payment && payment.error) || "Não foi possível abrir o pagamento");
      }

      trackAnalytics("payment_redirect", { event_category: "payment", checkout_id: String(created.checkout.id), payment_method: "infinitepay", value: Number(created.checkout.total || total) });
      setCart([]);
      removeCoupon();
      window.location.href = payment.url;
    } catch (err: any) {
      console.error(err);
      const message = String(err?.message || "Não foi possível iniciar o pagamento.");
      trackAnalytics("checkout_error", { event_category: "error", value: total, payment_method: paymentChoice === "online" ? paymentProvider : paymentChoice, properties: { message: message.slice(0,300) } });
      if (/fora da área|fora da area|bairro|entrega/i.test(message)) redirectOutsideArea();
      toast.error(message);
    } finally {
      setPlacing(false);
    }
  }

  async function cancelMercadoPagoCheckout() {
    if (!mpCheckout) return;
    try {
      const { cancelSiteCheckout } = await import("@/lib/site-checkout.functions");
      await cancelSiteCheckout({ data: { checkoutId: mpCheckout.id, access_token: customerSession?.access_token || null } });
    } catch {}
    setMpCheckout(null);
  }

  function finishMercadoPago(orderId?: string | null) {
    if (orderId) { pushMyOrder(orderId); void refreshActiveOrders(); }
    const checkoutId = mpCheckout?.id || "";
    setCart([]);
    removeCoupon();
    setMpCheckout(null);
    window.location.href = `/obrigado?provider=mercadopago&checkout_id=${encodeURIComponent(checkoutId)}`;
  }

  async function cancelAppmaxCheckout() {
    if (!appmaxCheckout) return;
    try {
      const { cancelSiteCheckout } = await import("@/lib/site-checkout.functions");
      await cancelSiteCheckout({ data: { checkoutId: appmaxCheckout.id, access_token: customerSession?.access_token || null } });
    } catch {}
    setAppmaxCheckout(null);
  }

  function finishAppmax(orderId?: string | null) {
    if (orderId) { pushMyOrder(orderId); void refreshActiveOrders(); }
    const checkoutId = appmaxCheckout?.id || "";
    setCart([]);
    removeCoupon();
    setAppmaxCheckout(null);
    window.location.href = `/obrigado?provider=appmax&checkout_id=${encodeURIComponent(checkoutId)}`;
  }

  const currentActiveOrder = activeOrders[0] || null;

  const activeOrderBanner = currentActiveOrder ? (
    <button
      type="button"
      onClick={() => nav({ to: "/pedido/$id", params: { id: currentActiveOrder.id } })}
      className="w-full text-left"
    >
      <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-orange-50 px-4 py-3 shadow-sm ring-1 ring-amber-100 transition hover:shadow-md">
        <div className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-[#ffd400] text-black shadow-sm">
          <Bike className="size-5" />
          <span className="absolute -right-1 -top-1 size-3 rounded-full bg-emerald-500 ring-2 ring-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-black text-foreground">Você tem um pedido em andamento</p>
            {currentActiveOrder.order_number != null && (
              <span className="rounded-full bg-black px-2 py-0.5 text-[10px] font-black text-white">
                #{currentActiveOrder.order_number}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs font-semibold text-amber-900">
            {activeOrderStatusLabel(currentActiveOrder.status)}
            {activeOrders.length > 1 ? ` • +${activeOrders.length - 1} pedido(s)` : ""}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Toque para acompanhar em tempo real.</p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-amber-700" />
      </div>
    </button>
  ) : null;

  if (!configLoaded) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f7f7] px-6">
        <div className="text-center">
          <Loader2 className="mx-auto size-7 animate-spin text-primary" />
          <p className="mt-3 text-sm font-semibold text-muted-foreground">Carregando o cardápio...</p>
        </div>
      </div>
    );
  }

  if (!digitalMenuEnabled) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f7f7] px-5">
        <div className="w-full max-w-md rounded-[32px] border bg-white p-7 text-center shadow-xl">
          <img src={HOTBOX_LOGO_URL} alt="HotBox Delivery" className="mx-auto h-24 w-24 rounded-3xl object-contain shadow-sm" />
          <h1 className="mt-5 font-display text-3xl font-black">Cardápio temporariamente indisponível</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Nosso atendimento pelo WhatsApp continua funcionando normalmente. Fale com a Hotbox e fazemos seu pedido por lá.
          </p>
          <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-3.5 text-sm font-black text-white">
            <MessageCircle className="size-5" /> Pedir pelo WhatsApp
          </a>
        </div>
      </div>
    );
  }

  if (areaStatus !== "supported") {
    const outside = areaStatus === "unsupported";
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#160805] via-[#4f0f0c] to-[#f7f7f7] px-4 py-8 sm:py-12">
        {activeOrderBanner && <div className="mx-auto mb-4 max-w-2xl">{activeOrderBanner}</div>}
        <div className="mx-auto max-w-lg">
          <div className="rounded-[34px] border border-white/10 bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center gap-3">
              <img src={HOTBOX_LOGO_URL} alt="HotBox Delivery" className="h-20 w-20 rounded-3xl object-contain shadow-md" />
              <div>
                <p className="font-display text-2xl font-black leading-none">HOT<span className="text-[#d92d20]">BOX</span></p>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.22em] text-[#d92d20]">Delivery</p>
              </div>
            </div>

            {!outside ? (
              <>
                <div className="mt-6 rounded-3xl bg-gradient-to-br from-amber-50 to-orange-50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#ffd400] text-black">
                      <MapPin className="size-5" />
                    </div>
                    <div>
                      <h1 className="font-display text-xl font-black leading-tight">Veja o cardápio da sua região</h1>
                      <p className="mt-0.5 text-sm text-muted-foreground">Informe seu CEP para ver produtos, ofertas e valores disponíveis para você.</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5">
                  <Label>Seu CEP</Label>
                  <div className="mt-2 flex gap-2">
                    <Input
                      inputMode="numeric"
                      autoComplete="postal-code"
                      className="h-12 rounded-2xl text-base"
                      placeholder="00000-000"
                      value={accessCep}
                      onChange={(e) => setAccessCep(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void validateCepAccess(); }}
                    />
                    <Button onClick={validateCepAccess} disabled={areaStatus === "checking"} className="h-12 rounded-2xl px-5 font-black">
                      {areaStatus === "checking" ? <Loader2 className="size-4 animate-spin" /> : "Continuar"}
                    </Button>
                  </div>
                </div>

                {areaStatus === "needs_number" && (
                  <div className="mt-4 rounded-2xl border-2 border-primary/30 bg-primary/5 p-4">
                    <Label>Número do endereço</Label>
                    <p className="mt-1 text-xs text-muted-foreground">Seu CEP foi localizado. Agora precisamos do número para medir a rota e aplicar a faixa de km correta.</p>
                    <div className="mt-2 flex gap-2">
                      <Input
                        inputMode="numeric"
                        className="h-11 rounded-xl"
                        placeholder="Ex.: 492"
                        value={accessNumber}
                        onChange={(e) => setAccessNumber(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void validateCepAccess(); }}
                        autoFocus
                      />
                      <Button onClick={validateCepAccess} disabled={areaStatus === "checking"} className="h-11 rounded-xl font-black">Calcular taxa</Button>
                    </div>
                  </div>
                )}

                {(manualAreaMode || areaStatus === "error") && (
                  <div className="mt-4 rounded-2xl border bg-muted/30 p-4">
                    <Label>Ou informe seu bairro</Label>
                    <div className="mt-2 flex gap-2">
                      <Input
                        className="h-11 rounded-xl"
                        placeholder="Ex.: Itatiaia"
                        value={manualNeighborhood}
                        onChange={(e) => setManualNeighborhood(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void validateManualNeighborhood(); }}
                      />
                      <Button variant="outline" onClick={validateManualNeighborhood} disabled={areaStatus === "checking"} className="h-11 rounded-xl">Validar</Button>
                    </div>
                  </div>
                )}

                {areaMessage && (
                  <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {areaMessage}
                  </div>
                )}

                {!manualAreaMode && (
                  <button type="button" onClick={() => setManualAreaMode(true)} className="mt-4 w-full text-center text-xs font-semibold text-muted-foreground underline underline-offset-4">
                    Não sei meu CEP
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="mt-7 rounded-3xl border border-orange-200 bg-orange-50 p-5">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-6 shrink-0 text-orange-600" />
                    <div>
                      <h1 className="font-display text-2xl font-black">Entrega própria indisponível nessa região</h1>
                      <p className="mt-1 text-sm leading-relaxed text-orange-950/70">{areaMessage}</p>
                      {validatedNeighborhood && <p className="mt-2 text-sm font-bold text-orange-950">Bairro identificado: {validatedNeighborhood}</p>}
                    </div>
                  </div>
                </div>

                <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                  Você não precisa desistir do pedido. Para regiões mais distantes, confira a disponibilidade pelas plataformas parceiras.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <a href={ifoodStoreLink || WHATSAPP_URL} target="_blank" rel="noreferrer" className="rounded-2xl bg-[#ea1d2c] px-4 py-3 text-center text-sm font-black text-white">Pedir pelo iFood</a>
                  <a href={NFOOD_URL} target="_blank" rel="noreferrer" className="rounded-2xl bg-[#ff7a00] px-4 py-3 text-center text-sm font-black text-white">Pedir pela 99Food</a>
                </div>
                <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="mt-2 flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold">
                  <MessageCircle className="size-4" /> Tirar uma dúvida no WhatsApp
                </a>
                <button type="button" onClick={resetAreaAccess} className="mt-4 w-full text-center text-xs font-bold text-muted-foreground underline underline-offset-4">Verificar outro CEP ou bairro</button>
              </>
            )}

            <div className="mt-6 flex items-center justify-center gap-2 border-t pt-5 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-emerald-600" /> Seus dados são usados apenas para atendimento e entrega.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === "detail" && selectedProduct) {
    const p = selectedProduct;
    return (
      <div className={`min-h-screen bg-background pb-28 ${!p.active ? "grayscale opacity-70" : ""}`}>
        <div className="relative">
          <button
            onClick={() => setView("list")}
            className="absolute left-4 top-4 z-10 grid size-9 place-items-center rounded-full bg-black/50 text-white backdrop-blur"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-2xl bg-white/95 p-1.5 shadow-lg backdrop-blur">
            <img src={HOTBOX_LOGO_URL} alt="HotBox Delivery" className="size-9 rounded-xl object-contain" />
          </div>
          {p.image_url ? (
            <img src={p.image_url} alt={p.name} className="h-64 w-full object-cover sm:h-80" />
          ) : (
            <div className="grid h-64 w-full place-items-center bg-muted text-sm text-muted-foreground sm:h-80">
              Sem foto
            </div>
          )}
        </div>

        <div className="mx-auto max-w-2xl px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-black uppercase tracking-tight">{p.name}</h1>
            {p.is_combo && <span className="rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-black">Combo</span>}
          </div>
          {(() => {
            const eff = getEffectivePrice(p);
            return eff.isPromotion ? (
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-base font-semibold text-muted-foreground line-through">
                  {brl(eff.listPrice)}
                </span>
                <span className="text-2xl font-extrabold text-fuchsia-600">{brl(eff.price)}</span>
                {p.promotion_label && (
                  <span className="flex items-center gap-1 rounded-full bg-fuchsia-100 px-2 py-0.5 text-[11px] font-bold text-fuchsia-700">
                    <Ticket className="size-3" /> {p.promotion_label}
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-1 text-2xl font-extrabold text-primary">{brl(eff.price)}</p>
            );
          })()}

          {publicReviews.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPublicReviews(true)}
              className="mt-3 flex w-full items-center gap-2 rounded-2xl border border-amber-200/70 bg-amber-50/60 px-3 py-2.5 text-left shadow-sm transition hover:bg-amber-50"
            >
              <PublicReviewStars value={publicReviewsAverage} />
              <span className="text-sm font-black text-zinc-900">{publicReviewsAverage.toFixed(1)}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
                {publicReviews.length} {publicReviews.length === 1 ? "avaliação" : "avaliações"} de clientes
              </span>
              <span className="shrink-0 text-[11px] font-black text-primary">Ver avaliações</span>
              <ChevronRight className="size-3.5 shrink-0 text-primary" />
            </button>
          )}

          {p.description && <p className="mt-3 text-sm leading-relaxed text-foreground/75">{p.description}</p>}
          {!p.active && (
            <div className="mt-4 rounded-2xl border border-zinc-300 bg-zinc-100 px-4 py-3 text-center">
              <p className="font-black uppercase tracking-wide text-zinc-700">Esgotado por hoje</p>
            </div>
          )}

          {(addonGroupsByProduct[p.id] || []).length > 0 && (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl bg-zinc-950 px-4 py-3 text-white shadow-sm">
                <p className="text-sm font-black">Personalize seu pedido</p>
                <p className="mt-0.5 text-[11px] text-white/70">Escolha adicionais e quantidades do seu jeito.</p>
              </div>

              {(addonGroupsByProduct[p.id] || []).map((group) => {
                const selectedCount = groupSelectedUnits(group);
                const min = Math.max(0, Number(group.min_select || 0), group.required ? 1 : 0);
                const max = Math.max(1, Number(group.max_select || 1));
                return (
                  <div key={group.id} className="overflow-hidden rounded-[22px] border border-black/5 bg-white shadow-sm">
                    <div className="flex items-start justify-between gap-3 border-b bg-zinc-50/80 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-zinc-950">{group.display_title || group.name}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                            group.required
                              ? "bg-red-100 text-red-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}>
                            {group.required ? "Obrigatório" : "Opcional"}
                          </span>
                        </div>
                        {(group.display_subtitle || group.description) && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{group.display_subtitle || group.description}</p>}
                        <p className="mt-1 text-[10px] font-semibold text-zinc-400">
                          {group.required
                            ? `Escolha de ${min} até ${max} unidade(s)`
                            : `Você pode adicionar até ${max} unidade(s)`}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-zinc-900 px-2.5 py-1 text-[10px] font-black text-white">
                        {selectedCount}/{max}
                      </span>
                    </div>

                    <div className="divide-y">
                      {group.options.map((option) => {
                        const optionId = String(option.id);
                        const quantity = addonQty(optionId);
                        const selected = quantity > 0;
                        const unitPrice = effectiveAddonOptionPrice(option);
                        return (
                          <div
                            key={option.id}
                            className={`flex items-center gap-3 px-4 py-3 transition ${selected ? "bg-amber-50/60" : "bg-white"}`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleDetailAddon(group, option)}
                              className={`grid size-6 shrink-0 place-items-center border-2 ${
                                group.max_select === 1 ? "rounded-full" : "rounded-lg"
                              } ${
                                selected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-zinc-300 bg-white"
                              }`}
                              aria-label={selected ? `Remover ${option.display_name || option.name}` : `Adicionar ${option.display_name || option.name}`}
                            >
                              {selected && <CheckCircle2 className="size-4" />}
                            </button>

                            {(() => {
                              const linkedProduct = option.linked_product_id
                                ? products.find((product) => String(product.id) === String(option.linked_product_id))
                                : null;
                              const optionImage = String(option.image_url || linkedProduct?.image_url || "").trim();
                              return optionImage ? (
                                <img
                                  src={optionImage}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  className="size-14 shrink-0 rounded-xl border object-cover"
                                />
                              ) : null;
                            })()}

                            <button
                              type="button"
                              onClick={() => toggleDetailAddon(group, option)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="text-sm font-bold text-zinc-900">{option.display_name || option.name}</p>
                                {option.linked_product_id && (
                                  <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-sky-700">
                                    Produto do cardápio
                                  </span>
                                )}
                              </div>
                              {(option.display_description || option.description) && <p className="mt-0.5 text-[11px] text-muted-foreground">{option.display_description || option.description}</p>}
                              <p className="mt-0.5 text-xs font-black text-primary">
                                {unitPrice > 0 ? `+ ${brl(unitPrice)} cada` : "Sem acréscimo"}
                              </p>
                            </button>

                            {max > 1 && (
                              <div className="flex shrink-0 items-center gap-1 rounded-full border bg-white p-1 shadow-sm">
                                <button
                                  type="button"
                                  onClick={() => setDetailAddonQuantity(group, option, quantity - 1)}
                                  disabled={quantity <= 0}
                                  className="grid size-7 place-items-center rounded-full text-zinc-700 disabled:opacity-30"
                                  aria-label={`Diminuir ${option.display_name || option.name}`}
                                >
                                  <Minus className="size-3.5" />
                                </button>
                                <span className="w-5 text-center text-xs font-black">{quantity}</span>
                                <button
                                  type="button"
                                  onClick={() => setDetailAddonQuantity(group, option, quantity + 1)}
                                  disabled={selectedCount >= max}
                                  className="grid size-7 place-items-center rounded-full bg-zinc-900 text-white disabled:opacity-30"
                                  aria-label={`Aumentar ${option.display_name || option.name}`}
                                >
                                  <Plus className="size-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {selectedCount < min && (
                      <p className="border-t bg-red-50 px-4 py-2 text-[11px] font-bold text-red-700">
                        Obrigatório: falta escolher {min - selectedCount} unidade(s).
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4">
            <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Observações</Label>
            <Textarea
              rows={2}
              className="mt-1"
              placeholder="Ex: sem cebola, ponto da carne, etc."
              value={detailNotes}
              onChange={(e) => setDetailNotes(e.target.value)}
            />
          </div>

          {publicReviews.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPublicReviews(true)}
              className="mt-6 w-full rounded-[22px] border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 text-left shadow-sm transition hover:border-amber-300"
            >
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">
                Aprovado pelos clientes
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <PublicReviewStars value={publicReviewsAverage} />
                <span className="text-lg font-black text-zinc-950">{publicReviewsAverage.toFixed(1)} de 5</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-zinc-700">
                Avaliado com {publicReviewsAverage.toFixed(1)} estrelas pelos clientes
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  Baseado em {publicReviews.length} {publicReviews.length === 1 ? "avaliação" : "avaliações"}
                </span>
                <span className="flex items-center gap-1 text-xs font-black text-primary">
                  Ver avaliações <ChevronRight className="size-3.5" />
                </span>
              </div>
            </button>
          )}
        </div>

        <PublicReviewsModal
          open={showPublicReviews}
          onClose={() => setShowPublicReviews(false)}
          reviews={publicReviews}
          average={publicReviewsAverage}
        />

        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-5 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="flex items-center gap-3 rounded-full border px-3 py-2">
              <button
                onClick={() => setDetailQty((q) => Math.max(1, q - 1))}
                disabled={!p.active}
                className="grid size-6 place-items-center disabled:opacity-30"
              >
                <Minus className="size-4" />
              </button>
              <span className="w-4 text-center font-bold">{detailQty}</span>
              <button onClick={() => setDetailQty((q) => q + 1)} disabled={!p.active} className="grid size-6 place-items-center disabled:opacity-30">
                <Plus className="size-4" />
              </button>
            </div>
            <Button
              onClick={addToCartFromDetail}
              disabled={!p.active}
              className="flex-1 justify-between rounded-full bg-[#ffd400] py-6 text-base font-black text-black shadow-md hover:bg-[#f4ca00] disabled:bg-zinc-300 disabled:text-zinc-600"
            >
              <span>{p.active ? "Adicionar" : "Esgotado"}</span>
              <span>{brl((
                (detailOrderBumpId
                  ? Number(orderBumps.find((b) => b.id === detailOrderBumpId)?.price_override ?? getEffectivePrice(p).price)
                  : getEffectivePrice(p).price) +
                selectedDetailAddons(p.id).reduce((sum, a) => sum + Number(a.price || 0) * Math.max(1, Number(a.qty || 1)), 0)
              ) * detailQty)}</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const reservationEntryModal = (showReservationEntryModal && (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-[28px] border border-amber-300 bg-white p-6 shadow-2xl">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-amber-100 text-3xl">🗓️</div>
        <p className="mt-4 text-center text-xs font-black uppercase tracking-[0.16em] text-amber-700">
          Loja fechada no momento
        </p>
        <h2 className="mt-1 text-center text-2xl font-black text-zinc-950">
          Seu pedido pode ficar reservado
        </h2>
        <p className="mt-3 text-center text-sm leading-relaxed text-zinc-700">
          A HotBox está fora do horário de funcionamento agora, mas você pode continuar normalmente.
          Seu pagamento será realizado agora e o pedido ficará como <strong>AGENDADO / RESERVADO</strong> para entrega posterior.
        </p>
        <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-black text-amber-950">Antes da entrega</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-900">
            A <strong>HotBox irá fazer contato com você antes da entrega para confirmar a entrega e o horário</strong>.
          </p>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-zinc-500">
          Ao continuar, você confirma que entendeu que este pedido não será preparado nem entregue agora.
        </p>
        <div className="mt-5 grid gap-2">
          <Button
            type="button"
            onClick={() => {
              setReservationAccepted(true);
              setShowReservationEntryModal(false);
              setView("checkout");
            }}
            className="w-full rounded-full bg-[#ffd400] py-6 font-black text-black hover:bg-[#f4ca00]"
          >
            Estou ciente • continuar
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowReservationEntryModal(false)}
            className="w-full rounded-full"
          >
            Voltar ao carrinho
          </Button>
        </div>
      </div>
    </div>
  ));

  const reservationPaymentConfirmModal = (showReservationPaymentConfirm && (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 px-4">
      <div className="w-full max-w-md rounded-[28px] border-2 border-amber-400 bg-white p-6 shadow-2xl">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-amber-100 text-3xl">⚠️</div>
        <p className="mt-4 text-center text-xs font-black uppercase tracking-[0.16em] text-amber-700">
          Confirmação de agendamento
        </p>
        <h2 className="mt-1 text-center text-2xl font-black text-zinc-950">
          Confirme antes de pagar
        </h2>
        <p className="mt-3 text-center text-sm leading-relaxed text-zinc-700">
          Você está finalizando um <strong>PEDIDO AGENDADO / RESERVADO</strong>.
          O pagamento será feito agora, mas a entrega acontecerá posteriormente, dentro do horário de funcionamento.
        </p>
        {reservationDate && (
          <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Data escolhida</p>
            <p className="mt-1 text-base font-black text-zinc-950">{formatReservationDate(reservationDate)}</p>
          </div>
        )}
        <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-black text-amber-950">Importante</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-900">
            A <strong>HotBox irá fazer contato antes da entrega para confirmar a entrega e o horário com você</strong>.
          </p>
        </div>
        <div className="mt-5 grid gap-2">
          <Button
            type="button"
            onClick={() => {
              setReservationAccepted(true);
              setShowReservationPaymentConfirm(false);
              void placeOrder(true);
            }}
            className="w-full rounded-full bg-[#ffd400] py-6 font-black text-black hover:bg-[#f4ca00]"
          >
            Confirmo que estou ciente • pagar agora
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowReservationPaymentConfirm(false)}
            className="w-full rounded-full"
          >
            Revisar pedido
          </Button>
        </div>
      </div>
    </div>
  ));

  if (view === "cart") {
    return (
      <div className="min-h-screen bg-background pb-28">
        {reservationEntryModal}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/95 px-4 py-4 backdrop-blur">
          <button onClick={() => setView("list")}>
            <ArrowLeft className="size-5" />
          </button>
          <img src={HOTBOX_LOGO_URL} alt="HotBox" className="size-9 rounded-xl object-contain" />
          <h1 className="font-display text-lg font-black tracking-tight">Sua sacola</h1>
        </header>

        <div className="mx-auto max-w-2xl space-y-3 px-4 py-4">
          {!cart.length ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Seu carrinho está vazio.</p>
          ) : (
            cart.map((i, idx) => (
              <div key={idx} className="rounded-2xl border bg-card p-3">
                <div className="flex gap-3">
                  {i.product.image_url ? (
                    <img
                      src={i.product.image_url}
                      alt={i.product.name}
                      className="size-24 shrink-0 rounded-2xl object-contain"
                    />
                  ) : (
                    <div className="grid size-16 shrink-0 place-items-center rounded-xl bg-muted text-[9px] text-muted-foreground">
                      Sem foto
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-bold uppercase leading-tight">{i.product.name}</h4>
                      <button
                        onClick={() => removeItem(idx)}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <p className="mt-0.5 font-black text-primary">{brl(cartUnitPrice(i))}</p>
                    {i.orderBumpId && <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800">Oferta especial</span>}
                    {i.addons.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {i.addons.map((addon) => (
                          <p key={addon.option_id} className="text-xs text-muted-foreground">
                            + {Math.max(1, Number(addon.qty || 1)) > 1 ? `${Math.max(1, Number(addon.qty || 1))}x ` : ""}{addon.name}{Number(addon.price || 0) > 0 ? ` • ${brl(Number(addon.price) * Math.max(1, Number(addon.qty || 1)))}` : ""}
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="mt-1.5 flex w-fit items-center gap-3 rounded-full border px-2.5 py-1">
                      <button onClick={() => changeQty(idx, -1)} className="grid size-5 place-items-center">
                        <Minus className="size-3.5" />
                      </button>
                      <span className="w-4 text-center text-sm font-bold">{i.qty}</span>
                      <button onClick={() => changeQty(idx, 1)} className="grid size-5 place-items-center">
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
                <Input
                  className="mt-2.5 rounded-full text-sm"
                  placeholder="Observações"
                  value={i.notes}
                  onChange={(e) => updateNotes(idx, e.target.value)}
                />
              </div>
            ))
          )}

          {cart.length > 0 && orderBumps.filter((b) =>
            b.placement === "cart" &&
            !cart.some((i) => String(i.product.id) === String(b.product_id))
          ).slice(0, 3).length > 0 && (
            <div className="rounded-3xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 p-4 shadow-sm">
              <div className="mb-3 flex items-start gap-2">
                <Flame className="mt-0.5 size-5 text-orange-600" />
                <div>
                  <p className="font-black">Complete seu pedido 🔥</p>
                  <p className="text-xs text-muted-foreground">Pequenos extras que combinam com o que você escolheu.</p>
                </div>
              </div>
              <div className="space-y-2">
                {orderBumps.filter((b) =>
                  b.placement === "cart" &&
                  !cart.some((i) => String(i.product.id) === String(b.product_id))
                ).slice(0, 3).map((bump) => {
                  const product = products.find((p) => String(p.id) === String(bump.product_id));
                  if (!product) return null;
                  const bumpPrice = bump.price_override == null ? getEffectivePrice(product).price : Number(bump.price_override);
                  return (
                    <div key={bump.id} className="flex items-center gap-3 rounded-2xl border bg-white p-3">
                      {product.image_url ? <img src={product.image_url} alt={product.name} className="size-14 rounded-xl object-cover" /> : <div className="size-14 rounded-xl bg-muted" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black uppercase text-amber-700">{bump.title}</p>
                        <p className="truncate text-sm font-black">{product.name}</p>
                        {bump.subtitle && <p className="truncate text-[11px] text-muted-foreground">{bump.subtitle}</p>}
                      </div>
                      <Button size="sm" className="shrink-0 rounded-full bg-amber-500 font-black text-white hover:bg-amber-600" onClick={() => addOrderBump(bump)}>
                        + {brl(bumpPrice)}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {cart.length > 0 && (
            <div className="rounded-2xl border bg-card p-4">
              <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Cupom de desconto
              </Label>
              {appliedCoupon ? (
                <div className="mt-1.5 flex items-center justify-between rounded-full border border-emerald-300 bg-emerald-50 px-3 py-2">
                  <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-700">
                    <Ticket className="size-4" /> {appliedCoupon.code}
                  </span>
                  <button onClick={removeCoupon} className="text-emerald-700 hover:text-destructive">
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="mt-2 space-y-2.5">
                  <div className="flex gap-2">
                    <Input
                      className="rounded-full uppercase"
                      placeholder="Código do cupom"
                      value={couponInput}
                      onChange={(e) => {
                        setCouponInput(e.target.value.toUpperCase());
                        if (couponError) setCouponError("");
                      }}
                      onKeyDown={(e) => e.key === "Enter" && applyCoupon()}
                    />
                    <Button variant="outline" className="rounded-full" onClick={() => void applyCoupon()} disabled={checkingCoupon}>
                      {checkingCoupon ? <Loader2 className="size-4 animate-spin" /> : "Aplicar"}
                    </Button>
                  </div>
                  <div className="rounded-2xl bg-muted/35 p-3">
                    <Label className="text-xs font-bold">WhatsApp para validar o cupom</Label>
                    <Input
                      inputMode="tel"
                      autoComplete="tel"
                      className="mt-1.5 rounded-full bg-background"
                      placeholder="(00) 00000-0000"
                      value={formatPhone(form.phone)}
                      onChange={(e) => {
                        setForm((current) => ({ ...current, phone: e.target.value }));
                        if (couponError) setCouponError("");
                      }}
                      onKeyDown={(e) => e.key === "Enter" && applyCoupon()}
                    />
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      Usamos o número apenas para validar as regras do cupom. Ele já ficará preenchido na finalização do pedido.
                    </p>
                  </div>
                </div>
              )}
              {couponError && <p className="mt-2 text-xs font-semibold text-destructive">{couponError}</p>}

              <div className="mt-3 flex justify-between text-sm text-foreground/70">
                <span>Subtotal</span>
                <span>{brl(subtotal)}</span>
              </div>
              {couponDiscount > 0 && (
                <div className="flex justify-between text-sm font-semibold text-emerald-600">
                  <span>Desconto ({appliedCoupon?.code})</span>
                  <span>-{brl(couponDiscount)}</span>
                </div>
              )}
              <div className="mt-4 flex items-center justify-between rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
                <div>
                  <span className="block text-xs font-black uppercase tracking-wide text-amber-900">Taxa de entrega</span>
                  <span className="text-[11px] text-amber-800/80">Já incluída no total abaixo</span>
                </div>
                <span className="text-xl font-black text-amber-950">{deliveryFeeLabel()}</span>
              </div>
              <div className="mt-2 flex justify-between border-t pt-2 text-lg font-extrabold">
                <span>Total</span>
                <span>{brl(total)}</span>
              </div>
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div id="checkout-action" className="fixed inset-x-0 bottom-0 z-40 scroll-mt-24 border-t bg-background/95 px-4 py-3 backdrop-blur">
            <div className="mx-auto max-w-2xl">
              <Button
                onClick={goToCheckoutFromCart}
                className="w-full justify-between rounded-full bg-[#ffd400] py-6 text-base font-black text-black shadow-md hover:bg-[#f4ca00]"
              >
                <span>Finalizar pedido</span>
                <span>{brl(total)}</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }


  if (view === "checkout") {
    return (
      <div className="min-h-screen bg-background pb-32">
        {reservationPaymentConfirmModal}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/95 px-4 py-4 backdrop-blur">
          <button onClick={() => setView("cart")}>
            <ArrowLeft className="size-5" />
          </button>
          <img src={HOTBOX_LOGO_URL} alt="HotBox" className="size-9 rounded-xl object-contain" />
          <h1 className="font-display text-lg font-black tracking-tight">Finalizar compra</h1>
        </header>

        <div className="mx-auto max-w-2xl space-y-6 px-4 py-5">
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Seus dados</h3>
            <div className="space-y-3">
              <div>
                <Label>Nome</Label>
                <Input
                  className="mt-1 rounded-xl"
                  placeholder="Como podemos chamar você?"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input
                  className="mt-1 rounded-xl"
                  placeholder="(00) 00000-0000"
                  value={formatPhone(form.phone)}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Modo de entrega</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setForm({ ...form, deliveryMode: "delivery" })}
                className={`flex items-center justify-center gap-2 rounded-full py-3 text-sm font-bold transition ${isDelivery ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md" : "border text-foreground/70"}`}
              >
                <Bike className="size-4" /> Entrega
              </button>
              <button
                onClick={() => setForm({ ...form, deliveryMode: "pickup" })}
                className={`flex items-center justify-center gap-2 rounded-full py-3 text-sm font-bold transition ${!isDelivery ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md" : "border text-foreground/70"}`}
              >
                <Store className="size-4" /> Retirada
              </button>
            </div>
          </div>

          {isDelivery && (
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Endereço</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Label>Rua</Label>
                    <Input
                      className="mt-1 rounded-xl"
                      value={form.street}
                      onChange={(e) => setForm({ ...form, street: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Número</Label>
                    <Input
                      className="mt-1 rounded-xl"
                      value={form.number}
                      onChange={(e) => setForm({ ...form, number: e.target.value })}
                      onBlur={(e) => void refreshDeliveryQuoteForCheckout(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label>Complemento</Label>
                  <Input
                    className="mt-1 rounded-xl"
                    placeholder="Apto, bloco..."
                    value={form.complement}
                    onChange={(e) => setForm({ ...form, complement: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Bairro</Label>
                    <Input
                      className="mt-1 rounded-xl bg-muted/40"
                      value={form.neighborhood}
                      readOnly={areaStatus === "supported"}
                      onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Cidade</Label>
                    <Input
                      className="mt-1 rounded-xl bg-muted/40"
                      value={form.city}
                      readOnly={!!form.city && areaStatus === "supported"}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label>CEP</Label>
                    <button type="button" onClick={resetAreaAccess} className="text-[11px] font-bold text-primary underline underline-offset-2">Trocar CEP/bairro</button>
                  </div>
                  <Input
                    className="mt-1 rounded-xl bg-muted/40"
                    placeholder="00000-000"
                    value={form.cep}
                    readOnly={!!form.cep && areaStatus === "supported"}
                    onChange={(e) => setForm({ ...form, cep: e.target.value })}
                  />
                  <div className="mt-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-black text-emerald-900">
                      <CheckCircle2 className="size-5" /> Entregamos no seu endereço
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wide text-emerald-800">Taxa de entrega</span>
                        <p className="mt-0.5 text-[11px] font-semibold text-emerald-700">
                          {deliveryPricingMode === "distance"
                            ? `Calculada por km${deliveryDistanceKm != null ? ` • ${deliveryDistanceKm.toFixed(1)} km` : ""}`
                            : "Valor configurado para o bairro"}
                        </p>
                      </div>
                      <span className="text-2xl font-black text-emerald-950">{brl(deliveryFee)}</span>
                    </div>
                  </div>

                  {!isStoreOpenByBusinessHours(publicStoreStatus) && publicStoreStatus?.closed_reservations_enabled === true && (
          <div className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm font-black text-amber-950">🗓️ Loja fechada agora — reservas abertas</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900">
              Você pode montar e pagar seu pedido normalmente. Ele ficará reservado para a data escolhida e a HotBox entrará em contato antes da entrega.
            </p>
          </div>
        )}

        {deliveryCutoffTime && (
                    <div className={`mt-3 rounded-2xl border-2 p-4 ${
                      outsideDeliveryHours
                        ? schedulingEnabled
                          ? "border-violet-300 bg-violet-50"
                          : "border-red-300 bg-red-50"
                        : "border-sky-200 bg-sky-50"
                    }`}>
                      <p className={`text-sm font-black ${
                        outsideDeliveryHours
                          ? schedulingEnabled ? "text-violet-900" : "text-red-900"
                          : "text-sky-900"
                      }`}>
                        {outsideDeliveryHours
                          ? `Entrega encerrada às ${deliveryCutoffTime} para ${validatedNeighborhood || form.neighborhood}`
                          : `Entrega disponível até ${deliveryCutoffTime}`}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {deliveryWindowMessage()}
                      </p>

                      {outsideDeliveryHours && schedulingEnabled && (
                        <label className={`mt-3 flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                          scheduleAccepted ? "border-violet-400 bg-white" : "border-violet-200 bg-white/70"
                        }`}>
                          <input
                            type="checkbox"
                            checked={scheduleAccepted}
                            onChange={(e) => setScheduleAccepted(e.target.checked)}
                            className="mt-0.5 size-5 accent-violet-600"
                          />
                          <span>
                            <span className="block text-sm font-black text-violet-950">
                              Agendar meu pedido
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-relaxed text-violet-800">
                              Estou ciente de que este é um AGENDAMENTO. A HotBox entrará em contato para informar a entrega no próximo horário disponível.
                            </span>
                          </span>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {orderBumps.filter((b) =>
            b.placement === "checkout" &&
            !cart.some((i) => String(i.product.id) === String(b.product_id))
          ).slice(0, 2).length > 0 && (
            <div className="rounded-3xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-amber-800">Última chance de completar</p>
              <p className="mt-1 text-sm font-black">Quer adicionar algo antes de fechar?</p>
              <div className="mt-3 space-y-2">
                {orderBumps.filter((b) =>
                  b.placement === "checkout" &&
                  !cart.some((i) => String(i.product.id) === String(b.product_id))
                ).slice(0, 2).map((bump) => {
                  const product = products.find((p) => String(p.id) === String(bump.product_id));
                  if (!product) return null;
                  const bumpPrice = bump.price_override == null ? getEffectivePrice(product).price : Number(bump.price_override);
                  return (
                    <div key={bump.id} className="flex items-center gap-3 rounded-2xl border bg-white p-3">
                      {product.image_url ? <img src={product.image_url} alt={product.name} className="size-12 rounded-xl object-cover" /> : <div className="size-12 rounded-xl bg-muted" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black">{product.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{bump.subtitle || bump.title}</p>
                      </div>
                      <Button size="sm" variant="outline" className="shrink-0 rounded-full border-amber-400 font-black text-amber-800" onClick={() => addOrderBump(bump)}>
                        + {brl(bumpPrice)}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div id="payment-section" className="scroll-mt-24">
            {mpCheckout ? (
              <MercadoPagoPayment
                checkoutId={mpCheckout.id}
                amount={mpCheckout.total}
                publicKey={mercadoPagoPublicKey}
                maxInstallments={mercadoPagoMaxInstallments}
                customerEmail={customerSession?.user?.email || null}
                origin={typeof window !== "undefined" ? window.location.origin : ""}
                supportWhatsappUrl={paymentSupportWhatsappUrl}
                onPaid={finishMercadoPago}
                onCancel={cancelMercadoPagoCheckout}
              />
            ) : appmaxCheckout ? (
              <AppmaxPayment
                checkoutId={appmaxCheckout.id}
                amount={appmaxCheckout.total}
                externalId={appmaxExternalId}
                maxInstallments={appmaxMaxInstallments}
                customerName={form.name}
                customerEmail={customerSession?.user?.email || null}
                supportWhatsappUrl={paymentSupportWhatsappUrl}
                onPaid={finishAppmax}
                onCancel={cancelAppmaxCheckout}
              />
            ) : (
              <div className="space-y-3">
                {isDelivery && payOnDeliveryEnabled && payOnDeliveryCardEnabled && (
                  <button
                    type="button"
                    onClick={() => { setPaymentChoice("delivery_card"); trackAnalytics("payment_selected", { event_category: "payment", payment_method: "delivery_card" }); scrollToCheckoutSection("checkout-action"); }}
                    className={`w-full rounded-2xl border-2 p-4 text-left transition ${paymentChoice === "delivery_card" ? "border-amber-500 bg-amber-50 shadow-sm" : "border-border bg-white hover:border-amber-300"}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-500 text-white"><CreditCard className="size-5" /></span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-black">Cartão na entrega</p>
                          {paymentChoice === "delivery_card" && <span className="rounded-full bg-amber-500 px-2 py-1 text-[10px] font-black text-white">SELECIONADO</span>}
                        </div>
                        <p className="text-[11px] text-muted-foreground">Pague ao entregador com cartão. Nenhuma cobrança é feita agora.</p>
                      </div>
                    </div>
                  </button>
                )}

                {isDelivery && payOnDeliveryEnabled && payOnDeliveryPixEnabled && (
                  <button
                    type="button"
                    onClick={() => { setPaymentChoice("delivery_pix"); trackAnalytics("payment_selected", { event_category: "payment", payment_method: "delivery_pix" }); scrollToCheckoutSection("checkout-action"); }}
                    className={`w-full rounded-2xl border-2 p-4 text-left transition ${paymentChoice === "delivery_pix" ? "border-amber-500 bg-amber-50 shadow-sm" : "border-border bg-white hover:border-amber-300"}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-500 text-white"><QrCode className="size-5" /></span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-black">Pix na entrega</p>
                          {paymentChoice === "delivery_pix" && <span className="rounded-full bg-amber-500 px-2 py-1 text-[10px] font-black text-white">SELECIONADO</span>}
                        </div>
                        <p className="text-[11px] text-muted-foreground">Faça o Pix quando o pedido chegar. Nenhuma cobrança é feita agora.</p>
                      </div>
                    </div>
                  </button>
                )}

                {isDelivery && payOnDeliveryEnabled && paymentChoice !== "online" && (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-950">
                    <b>Pagamento na entrega:</b> seu pedido será criado imediatamente e ficará marcado como pagamento pendente até o recebimento.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {!mpCheckout && !appmaxCheckout && (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur">
            <div className="mx-auto max-w-2xl">
              <Button
                onClick={requestPlaceOrder}
                disabled={
                  placing ||
                  (paymentChoice === "online" && (!(pixEnabled || cardEnabled) || !paymentAvailable)) ||
                  (paymentChoice === "delivery_card" && (!payOnDeliveryEnabled || !payOnDeliveryCardEnabled)) ||
                  (paymentChoice === "delivery_pix" && (!payOnDeliveryEnabled || !payOnDeliveryPixEnabled))
                }
                className="w-full justify-between rounded-full bg-[#ffd400] py-6 text-base font-black text-black shadow-md hover:bg-[#f4ca00]"
              >
                <span>
                  {placing
                    ? "Finalizando..."
                    : paymentChoice === "delivery_card"
                      ? "Confirmar • pagar no cartão na entrega"
                      : paymentChoice === "delivery_pix"
                        ? "Confirmar • pagar Pix na entrega"
                        : paymentProvider === "mercadopago" || paymentProvider === "appmax"
                          ? "Pagar com Pix ou cartão"
                          : "Continuar para pagamento"}
                </span>
                <span>{brl(total)}</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-[#f7f7f7] pb-28">
      <div className="sticky top-0 z-50 border-b border-black/5 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Link to="/" className="flex min-w-0 items-center gap-2.5">
            <img src={HOTBOX_LOGO_URL} alt="HotBox Delivery" className="h-12 w-12 rounded-2xl object-contain shadow-sm ring-1 ring-black/10" />
            <div className="min-w-0 leading-tight">
              <p className="font-display text-lg font-black">HOT<span className="text-[#d92d20]">BOX</span></p>
              <p className="truncate text-[10px] font-bold uppercase tracking-widest text-[#d92d20]">{validatedNeighborhood || "Delivery"}</p>
            </div>
          </Link>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={resetAreaAccess} title="Trocar endereço" className="grid size-9 place-items-center rounded-full border bg-white text-muted-foreground transition hover:text-foreground">
              <MapPin className="size-4" />
            </button>
            <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" title="Ajuda pelo WhatsApp" className="grid size-9 place-items-center rounded-full bg-[#25D366] text-white shadow-sm">
              <MessageCircle className="size-4" />
            </a>
          </div>
        </div>
      </div>

      {activeOrderBanner && (
        <div className="bg-white px-4 pb-3 pt-2">
          {activeOrderBanner}
        </div>
      )}

      {/* ============ BANNER ============ */}
      <div
        className="relative overflow-hidden bg-gradient-to-br from-[#1c0f0b] via-[#7f1d1d] to-[#f97316] px-5 py-8 text-white"
        style={
          bannerUrl
            ? {
                backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.55)), url(${bannerUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        <div className="mx-auto max-w-2xl">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide backdrop-blur ${
            isStoreOpenByBusinessHours(publicStoreStatus)
              ? "bg-emerald-500/90 text-white"
              : "bg-black/55 text-white"
          }`}>
            <Flame className="size-3.5" />
            {isStoreOpenByBusinessHours(publicStoreStatus) ? "Aberto agora" : "Fechado agora"}
          </span>
          <h1 className="mt-3 font-display text-3xl font-black uppercase leading-[1.05] tracking-tight sm:text-4xl">
            Sua fome pediu.
            <br />
            A Hotbox caprichou.
          </h1>
          <p className="mt-3 max-w-md text-sm text-white/85">{bannerTagline}</p>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm font-semibold">
            {deliveryTime && (
              <span className="flex items-center gap-1.5">
                <Clock className="size-4" /> {deliveryTime}-{deliveryTime + 15} min
              </span>
            )}
            <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 backdrop-blur">
              <MapPin className="size-4" /> {validatedNeighborhood || "Entrega"}
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-[#ffd400] px-3 py-1.5 font-black text-black shadow-sm">
              <Bike className="size-4" /> Taxa de entrega: {deliveryFeeLabel()}
            </span>
          </div>
        </div>
      </div>

      <header className="sticky top-0 z-40 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="rounded-full border-none bg-muted pl-11"
              placeholder="Buscar produtos..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${activeCategory === cat ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md" : "border bg-card text-foreground/70"}`}
              >
                {cat === "Batata" && <Flame className="size-3.5" />}
                {cat === "Tudo" && <Flame className="size-3.5" />} {cat}
              </button>
            ))}
          </div>


        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-5">
        {!query && (activeCategory === "Tudo" || activeCategory === "Batata") && (
          <div className="mb-5">
            <CustomerLoyaltyClub
              session={customerSession}
              onSessionChange={setCustomerSession}
              onUseReward={(code) => {
                setCouponInput(code);
                if (!cart.length) {
                  toast.info("Adicione sua batata ao carrinho e depois use o cupom no carrinho.");
                  return;
                }
                setView("cart");
                window.setTimeout(() => void applyCoupon(code), 0);
              }}
            />
          </div>
        )}
        {deliveryCutoffTime && (
          <div className={`mb-3 rounded-2xl border px-4 py-3 ${
            outsideDeliveryHours
              ? schedulingEnabled
                ? "border-violet-200 bg-violet-50"
                : "border-red-200 bg-red-50"
              : "border-sky-200 bg-sky-50"
          }`}>
            <p className="text-sm font-black">
              {outsideDeliveryHours
                ? `⏰ Entregas para ${validatedNeighborhood || form.neighborhood} encerradas às ${deliveryCutoffTime}`
                : `🕒 Entregas para ${validatedNeighborhood || form.neighborhood} até ${deliveryCutoffTime}`}
            </p>
            {outsideDeliveryHours && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {schedulingEnabled
                  ? "Você pode montar seu pedido normalmente e, ao finalizar, escolher AGENDAR para o próximo horário disponível."
                  : "No momento não é possível finalizar um pedido para este bairro."}
              </p>
            )}
          </div>
        )}

        {!query && (activeCategory === "Tudo" || activeCategory === "Batata") && publicReviews.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPublicReviews(true)}
            className="mb-3 flex w-full items-center gap-2 rounded-2xl border border-black/5 bg-white px-3 py-2 shadow-sm transition hover:bg-muted/30"
          >
            <PublicReviewStars value={publicReviewsAverage} />
            <span className="text-xs font-black">{publicReviewsAverage.toFixed(1)}</span>
            <span className="min-w-0 flex-1 truncate text-left text-[11px] text-muted-foreground">
              {publicReviews.length} {publicReviews.length === 1 ? "avaliação" : "avaliações"} de clientes
            </span>
            <span className="shrink-0 text-[11px] font-black text-primary">Ver avaliações</span>
            <ChevronRight className="size-3.5 shrink-0 text-primary" />
          </button>
        )}

        {!products.length ? (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <p className="text-muted-foreground">Cardápio vazio. Volte em breve!</p>
          </div>
        ) : (
          <div className="space-y-8">

            {!query && activeCategory === "Tudo" && featured.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-1.5 font-display text-xl font-black uppercase tracking-tight">
                  <Flame className="size-5 text-primary" /> Ofertas e preferidos
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  {featured.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => openDetail(p)}
                      className="group relative aspect-[4/5] overflow-hidden rounded-[24px] bg-white text-left shadow-sm ring-1 ring-black/5"
                    >
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="absolute inset-0 size-full object-cover transition group-hover:scale-105"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-muted" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 p-3">
                        <div className="flex items-center gap-1.5"><p className="text-[13px] font-extrabold uppercase leading-tight text-white">{p.name}</p>{p.is_combo && <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-black text-black">COMBO</span>}</div>
                        {(() => {
                          const eff = getEffectivePrice(p);
                          return eff.isPromotion ? (
                            <p className="mt-0.5 flex items-baseline gap-1.5">
                              <span className="text-[10px] text-white/60 line-through">{brl(eff.listPrice)}</span>
                              <span className="font-bold text-fuchsia-400">{brl(eff.price)}</span>
                            </p>
                          ) : (
                            <p className="mt-0.5 font-bold text-amber-400">{brl(eff.price)}</p>
                          );
                        })()}
                      </div>
                      <span className={`grid size-9 shrink-0 place-items-center rounded-full shadow-sm ${p.active ? "bg-[#ffd400] text-black" : "bg-zinc-200 text-zinc-500"}`}>
                        {p.active ? <Plus className="size-5 stroke-[3]" /> : <X className="size-4" />}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}


            <section>
              <h2 className="mb-3 font-display text-xl font-black uppercase tracking-tight">Cardápio</h2>
              {!filtered.length ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nenhum produto encontrado.</p>
              ) : (
                <div className="space-y-2.5">
                  {filtered.map((p, index) => (
                    <div key={p.id}>
                    <button
                      onClick={() => openDetail(p)}
                      className={`flex w-full items-center gap-4 rounded-[24px] border border-black/5 bg-white p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${!p.active ? "grayscale opacity-55" : ""}`}
                    >
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="size-24 shrink-0 rounded-2xl object-contain" />
                      ) : (
                        <div className="grid size-16 shrink-0 place-items-center rounded-xl bg-muted text-[9px] text-muted-foreground">
                          Sem foto
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5"><h4 className="font-bold uppercase leading-tight">{p.name}</h4>{p.is_combo && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-800">COMBO</span>}</div>
                        {p.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                        )}
                        {(() => {
                          const eff = getEffectivePrice(p);
                          return eff.isPromotion ? (
                            <p className="mt-1 flex items-baseline gap-1.5">
                              <span className="text-xs text-muted-foreground line-through">{brl(eff.listPrice)}</span>
                              <span className="font-extrabold text-fuchsia-600">{brl(eff.price)}</span>
                              {p.promotion_label && (
                                <span className="flex items-center gap-1 rounded-full bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-bold text-fuchsia-700">
                                  <Ticket className="size-2.5" /> {p.promotion_label}
                                </span>
                              )}
                            </p>
                          ) : (
                            <p className="mt-1 font-extrabold text-primary">{brl(eff.price)}</p>
                          );
                        })()}
                      </div>
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ffd400] text-black shadow-sm">
                        <Plus className="size-5 stroke-[3]" />
                      </span>
                    </button>
                    {!query && activeCategory === "Tudo" && reviewsWithComments.length > 0 && index === 3 && (
                      <CompactInlineReview review={reviewsWithComments[0]} />
                    )}
                    {!query && activeCategory === "Tudo" && reviewsWithComments.length > 1 && index === 7 && (
                      <CompactInlineReview review={reviewsWithComments[1]} />
                    )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {!query && activeCategory === "Tudo" && publicReviews.length > 0 && (
              <button
                type="button"
                onClick={() => setShowPublicReviews(true)}
                className="flex w-full items-center justify-between rounded-2xl border border-black/5 bg-white px-4 py-3 text-left shadow-sm"
              >
                <div>
                  <p className="text-xs font-black">Veja todas as avaliações</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Comentários primeiro • {publicReviews.length} avaliações no total
                  </p>
                </div>
                <ChevronRight className="size-4 text-primary" />
              </button>
            )}
          </div>
        )}
      </main>

      <PublicReviewsModal
        open={showPublicReviews}
        onClose={() => setShowPublicReviews(false)}
        reviews={publicReviews}
        average={publicReviewsAverage}
      />

      <footer className="mt-10 border-t bg-muted/40 py-6 text-center text-xs text-muted-foreground">
        <MapPin className="mx-auto mb-1 size-4" />
        {storeName} • Todos os direitos reservados
        <div className="mt-1">
          <Link to="/politica-de-privacidade" className="underline hover:text-foreground">
            Política de Privacidade
          </Link>
        </div>
      </footer>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-stretch gap-2 px-3 py-2">
          <Link
            to="/meus-pedidos"
            className="flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold text-foreground/80 transition hover:bg-muted"
          >
            <ClipboardList className="size-4" /> Meus pedidos
          </Link>
          <Button
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#ffd400] py-2.5 font-black text-black hover:bg-[#f4ca00]"
            onClick={() => setView("cart")}
          >
            <ShoppingCart className="size-4" />
            {totalQty > 0 ? `Sacola • ${totalQty} • ${brl(subtotal)}` : "Ver sacola"}
          </Button>
        </div>
      </nav>
    </div>
  );
}
