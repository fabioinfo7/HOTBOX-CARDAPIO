import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone, formatDateTime, ORDER_STATUS_LABEL, orderDisplayRef } from "@/lib/formatters";
import { sendChatText, sendChatMedia, broadcastMessage, deleteConversation, deleteMessage, sendWindowBroadcast } from "@/lib/chat.functions";
import { generateOrderFromConversation } from "@/lib/generate-order-from-chat.functions";
import { sendSatisfactionRequestFn } from "@/lib/satisfaction.functions";
import { sendOrderArrivalNoticeFn } from "@/lib/order-notifications.functions";
import { EmojiPicker } from "@/components/emoji-picker";
import wallpaperTeal from "@/assets/wallpapers/wallpaper-teal.jpg";
import wallpaperBeige from "@/assets/wallpapers/wallpaper-beige.jpg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Send,
  Paperclip,
  Camera,
  Bot,
  UserCog,
  Radio,
  Clock,
  Search,
  MessageCircle,
  FileText,
  Check,
  CheckCheck,
  CheckCircle2,
  Plus,
  Mic,
  MicOff,
  Phone,
  X,
  PackagePlus,
  Loader2,
  Trash2,
  Pin,
  Zap,
  Pencil,
  User,
  ImagePlus,
  ThumbsUp,
  Package,
  Gift,
  MapPin,
  MoreHorizontal,
  AlertTriangle,
  Eye,
  ChevronDown,
  ChevronUp,
  Copy,
  Navigation,
  UserRoundCheck,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/loja/chat")({
  component: ChatPage,
  validateSearch: (search: Record<string, unknown>) => ({
    phone: typeof search.phone === "string" ? search.phone : undefined,
    name: typeof search.name === "string" ? search.name : undefined,
  }),
});

type Conversation = {
  id: string;
  phone: string;
  customer_name: string | null;
  bot_paused: boolean;
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  pinned: boolean;
};
type Message = {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  sender_type: "customer" | "bot" | "admin";
  body: string | null;
  media_url: string | null;
  media_type: string | null;
  created_at: string;
  external_id: string | null;
  read_at: string | null;
  deleted_at: string | null;
};
type DialogMode = "broadcast" | "newchat" | null;
type ActiveOrder = {
  id: string; customer_phone: string; customer_name: string | null; status: string; created_at: string;
  order_number: number | null; external_display_id: string | null; total: number | null;
  address_street: string | null; address_number: string | null; address_complement: string | null;
  address_neighborhood: string | null; address_city: string | null;
  payment_method?: string | null; delivery_fee?: number | null; notes?: string | null;
  payment_status?: string | null; payment_timing?: string | null;
  assigned_operator_id?: string | null; assigned_operator_email?: string | null; assigned_operator_at?: string | null;
  loyalty_reward_used?: boolean;
};

type GenerateOrderReview = {
  missing: string[];
  missingKeys: string[];
  extracted: any;
};

/**
 * Sanitiza o nome do arquivo para uso como chave no Supabase Storage.
 * Remove acentos, substitui espaços por underscores e remove caracteres inválidos.
 * Ex.: "CARDÁPIO ATUAL.png" → "CARDAPIO_ATUAL.png"
 */
function sanitizeStorageKey(fileName: string): string {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacríticos (acentos)
    .replace(/\s+/g, "_")           // espaços → underscore
    .replace(/[^a-zA-Z0-9._-]/g, "_"); // demais chars especiais → underscore
}

async function getOrCreateConversationByPhone(phone: string, name?: string | null): Promise<Conversation> {
  const { data: existing } = await supabase.from("whatsapp_conversations").select("*").eq("phone", phone).maybeSingle();
  if (existing) {
    if (name && !existing.customer_name) {
      await supabase.from("whatsapp_conversations").update({ customer_name: name }).eq("id", existing.id);
      return { ...existing, customer_name: name };
    }
    return existing as Conversation;
  }
  const { data: created, error } = await supabase
    .from("whatsapp_conversations")
    .insert({ phone, customer_name: name || null })
    .select("*")
    .single();
  if (error) throw error;
  return created as Conversation;
}

const CHAT_TAG_STYLE: Record<string, string> = {
  VIP:          "bg-yellow-100 text-yellow-800 border border-yellow-400",
  Interessado:  "bg-green-100 text-green-800 border border-green-400",
  Frio:         "bg-sky-100 text-sky-800 border border-sky-300",
  Recorrente:   "bg-purple-100 text-purple-800 border border-purple-400",
  Bloqueado:    "bg-red-100 text-red-700 border border-red-400",
  Problemático: "bg-orange-100 text-orange-800 border border-orange-400",
};
function chatTagStyle(t: string) {
  return CHAT_TAG_STYLE[t] ?? "bg-gray-100 text-gray-700 border border-gray-300";
}

function ChatPage() {
  const navigate = useNavigate();
  const { phone: phoneFromLeads, name: nameFromLeads } = Route.useSearch();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [deliveryMinutes, setDeliveryMinutes] = useState(60);
  const [sideTab, setSideTab] = useState<"quick" | "orders">("quick");
  const [timerNow, setTimerNow] = useState(Date.now());
  const [currentOperator, setCurrentOperator] = useState<{ id: string; email: string | null } | null>(null);
  const [orderItemsByOrder, setOrderItemsByOrder] = useState<Record<string, any[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [recording, setRecording] = useState(false);
  const [generatingOrder, setGeneratingOrder] = useState(false);
  const [generateReview, setGenerateReview] = useState<GenerateOrderReview | null>(null);
  const [generateManual, setGenerateManual] = useState<Record<string, string>>({});
  const [showWindowBroadcast, setShowWindowBroadcast] = useState(false);
  const [windowContacts, setWindowContacts]   = useState<{id:string;phone:string;name:string|null;last_message_at:string}[]>([]);
  const [wbSelected, setWbSelected]           = useState<Set<string>>(new Set());
  const [wbText, setWbText]                   = useState("");
  const [wbImageUrl, setWbImageUrl]           = useState("");
  const [wbSending, setWbSending]             = useState(false);
  const [wbProgress, setWbProgress]           = useState<{done:number;total:number}|null>(null);
  const [wbLog, setWbLog]                     = useState<{phone:string;status:"ok"|"skip"|"err"}[]>([]);
  const [wbUploading, setWbUploading]         = useState(false);
  const wbFileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    | { kind: "delete_conversation"; conversationId: string; label: string }
    | { kind: "send_quick_reply"; body: string; title: string; image_url: string | null }
    | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const [satisfactionByPhone, setSatisfactionByPhone] = useState<Record<string, { eligibleOrderId: string | null; eligibleOrderRef: string | null; latestState: "none" | "sent" | "submitted" }>>({});
  const [sendingSatisfactionPhone, setSendingSatisfactionPhone] = useState<string | null>(null);

  // Telefones de clientes que já fecharam pelo menos 1 pedido com a loja —
  // usado pro selo de "cliente com histórico de pedidos" (✓ verde) ao lado
  // do contato na lista de conversas, pra loja já saber de cara que é um
  // cliente recorrente assim que ele mandar mensagem.
  const [repeatCustomers, setRepeatCustomers] = useState<Set<string>>(new Set());
  const [leadTagsMap, setLeadTagsMap] = useState<Map<string, string[]>>(new Map());

  async function loadContactSatisfactionStatuses(rows: Conversation[]) {
    const phones = Array.from(new Set(rows.map((c) => c.phone).filter(Boolean)));
    if (!phones.length) { setSatisfactionByPhone({}); return; }

    const { data: orders } = await supabase
      .from("orders")
      .select("id,customer_phone,order_number,external_display_id,created_at")
      .in("customer_phone", phones)
      .eq("status", "delivered")
      .order("created_at", { ascending: false });

    const orderIds = (orders ?? []).map((o: any) => o.id);
    const { data: feedback } = orderIds.length
      ? await supabase.from("customer_feedback").select("order_id,sent_at,submitted_at").in("order_id", orderIds)
      : { data: [] as any[] };

    const feedbackByOrder = new Map<string, any>();
    for (const f of feedback ?? []) if (f.order_id) feedbackByOrder.set(f.order_id, f);

    const next: Record<string, { eligibleOrderId: string | null; eligibleOrderRef: string | null; latestState: "none" | "sent" | "submitted" }> = {};
    for (const phone of phones) {
      const latest = (orders ?? []).find((o: any) => o.customer_phone === phone) as any;
      const latestFeedback = latest ? feedbackByOrder.get(latest.id) : null;
      next[phone] = {
        eligibleOrderId: latest && !latestFeedback ? latest.id : null,
        eligibleOrderRef: latest ? String(latest.external_display_id || latest.order_number || "") : null,
        latestState: latestFeedback?.submitted_at ? "submitted" : latestFeedback?.sent_at ? "sent" : "none",
      };
    }
    setSatisfactionByPhone(next);
  }

  async function sendSatisfactionFromContactCard(conv: Conversation, e: React.MouseEvent) {
    e.stopPropagation();
    const status = satisfactionByPhone[conv.phone];
    if (!status?.eligibleOrderId || sendingSatisfactionPhone) return;
    setSendingSatisfactionPhone(conv.phone);
    try {
      const result = await sendSatisfactionRequestFn({
        data: { phone: conv.phone, orderId: status.eligibleOrderId },
      });
      if (!result.ok) { toast.error(result.error || "Não foi possível enviar a avaliação."); return; }
      toast.success("Pedido de avaliação enviado pelo WhatsApp!");
      await loadContactSatisfactionStatuses(conversations);
    } catch (error: any) {
      toast.error(String(error?.message ?? "Falha ao enviar pedido de avaliação."));
    } finally {
      setSendingSatisfactionPhone(null);
    }
  }

  async function loadRepeatCustomers() {
    const { data } = await supabase.from("orders").select("customer_phone");
    if (data) setRepeatCustomers(new Set(data.map((o: any) => (o.customer_phone as string).replace(/\D/g, ""))));
  }

  // Papel de parede do chat configurado em Configurações → Aparência do chat.
  const [wallpaperOption, setWallpaperOption] = useState<string>("classic");

  async function loadWallpaper() {
    const { data } = await (supabase as any).from("store_config").select("chat_wallpaper").eq("id", 1).maybeSingle();
    setWallpaperOption(data?.chat_wallpaper || "classic");
  }

  async function loadConversations() {
    const [{ data: convData }, { data: leadsData }, { data: ordersData }, { data: cfgData }] = await Promise.all([
      supabase.from("whatsapp_conversations").select("*").order("last_message_at", { ascending: false }),
      supabase.from("leads").select("phone,tags"),
      (supabase as any).from("orders")
        .select("id,customer_phone,customer_name,status,created_at,order_number,external_display_id,total,address_street,address_number,address_complement,address_neighborhood,address_city,payment_method,delivery_fee,notes,payment_status,payment_timing,assigned_operator_id,assigned_operator_email,assigned_operator_at,loyalty_reward_used")
        .in("status", ["pending_review", "pending", "preparing", "ready_pickup", "out_for_delivery"])
        .order("created_at", { ascending: true }),
      (supabase as any).from("store_config").select("estimated_delivery_time_minutes").eq("id", 1).maybeSingle(),
    ]);
    const rows = (convData as Conversation[]) ?? [];
    setConversations(rows);
    const active = (ordersData as ActiveOrder[]) ?? [];
    setActiveOrders(active);
    if (active.length) {
      const { data: activeItems } = await supabase
        .from("order_items")
        .select("id,order_id,product_name,quantity,unit_price")
        .in("order_id", active.map((o) => o.id));
      const grouped: Record<string, any[]> = {};
      for (const item of activeItems ?? []) (grouped[(item as any).order_id] ||= []).push(item);
      setOrderItemsByOrder(grouped);
    } else {
      setOrderItemsByOrder({});
    }
    setDeliveryMinutes(Number((cfgData as any)?.estimated_delivery_time_minutes) || 60);
    await loadContactSatisfactionStatuses(rows);
    const map = new Map<string, string[]>();
    for (const l of (leadsData ?? []) as any[]) map.set(l.phone, l.tags ?? []);
    setLeadTagsMap(map);
  }

  // Busca TODOS os contatos dentro da janela de 24h segura do WhatsApp (últimas
  // 22h30 desde a última mensagem do cliente — hard cap com margem de segurança
  // antes das 24h, quando a mensagem deixa de ser gratuita/permitida pela Meta).
  async function loadWindowContacts() {
    const now   = Date.now();
    const limit = new Date(now - 22.5 * 60 * 60 * 1000).toISOString();  // 22h30 — hard cap
    const { data } = await supabase
      .from("whatsapp_conversations")
      .select("id,phone,customer_name,last_message_at")
      .gte("last_message_at", limit)         // TODOS os contatos das últimas 22h30, sem limite inferior
      .order("last_message_at", { ascending: false });
    setWindowContacts(
      (data ?? []).map((c: any) => ({
        id: c.id,
        phone: c.phone,
        name: c.customer_name,
        last_message_at: c.last_message_at,
      }))
    );
    setWbSelected(new Set((data ?? []).map((c: any) => c.phone)));
  }

  async function togglePin(conv: Conversation, e: React.MouseEvent) {
    e.stopPropagation();
    const next = !conv.pinned;
    await supabase.from("whatsapp_conversations").update({ pinned: next }).eq("id", conv.id);
    setConversations((prev) => prev.map((c) => c.id === conv.id ? { ...c, pinned: next } : c));
  }

  useEffect(() => {
    const timer = window.setInterval(() => setTimerNow(Date.now()), 1000);
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      setCurrentOperator(u ? { id: u.id, email: u.email ?? null } : null);
    });
    loadConversations();
    loadRepeatCustomers();
    loadWallpaper();
    const ch = supabase
      .channel("chat-conversations")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, loadConversations)
      .subscribe();
    // Sempre que um pedido novo é fechado (por qualquer cliente), atualiza o
    // conjunto de clientes recorrentes — assim o selo aparece imediatamente
    // na conversa dele, sem precisar recarregar a página.
    const ordersCh = supabase
      .channel("chat-orders-repeat")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        loadRepeatCustomers();
        loadConversations();
      })
      .subscribe();
    const feedbackCh = supabase
      .channel("chat-contact-satisfaction")
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_feedback" }, loadConversations)
      .subscribe();
    // Papel de parede: aplica na hora quando muda em Configurações (mesma aba
    // via evento, outra aba/dispositivo via realtime) e ao voltar o foco.
    const wpCh = supabase
      .channel("chat-wallpaper-config")
      .on("postgres_changes", { event: "*", schema: "public", table: "store_config" }, loadWallpaper)
      .subscribe();
    const onWallpaperEvent = () => loadWallpaper();
    window.addEventListener("hb:chat-wallpaper", onWallpaperEvent);
    window.addEventListener("focus", onWallpaperEvent);
    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(ordersCh);
      supabase.removeChannel(feedbackCh);
      supabase.removeChannel(wpCh);
      window.removeEventListener("hb:chat-wallpaper", onWallpaperEvent);
      window.removeEventListener("focus", onWallpaperEvent);
      window.clearInterval(timer);
    };
  }, []);

  const handledDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (!phoneFromLeads || handledDeepLinkRef.current === phoneFromLeads) return;
    handledDeepLinkRef.current = phoneFromLeads;
    (async () => {
      try {
        const conv = await getOrCreateConversationByPhone(phoneFromLeads, nameFromLeads);
        await loadConversations();
        setSelectedId(conv.id);
      } catch (err: any) {
        toast.error("Não foi possível abrir essa conversa: " + (err.message ?? err));
      }
    })();
  }, [phoneFromLeads, nameFromLeads]);


  async function loadMessages(conversationId: string) {
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    setMessages((data as Message[]) ?? []);
    await supabase
      .from("whatsapp_conversations")
      .update({ unread_count: 0, has_unread: false, last_seen_at: new Date().toISOString() })
      .eq("id", conversationId);
  }

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    loadMessages(selectedId);
    const ch = supabase
      .channel(`chat-messages-${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "whatsapp_messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (p) => {
          setMessages((prev) => [...prev, p.new as Message]);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "whatsapp_messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (p) => {
          const updated = p.new as Message;
          // Mensagem apagada — remove da lista em tempo real
          if (updated.deleted_at) {
            setMessages((prev) => prev.filter((m) => m.id !== updated.id));
          } else {
            // Confirmação de leitura chegando em tempo real (check azul sem recarregar)
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [selectedId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const activePhones = useMemo(
    () => new Set(activeOrders.map((o) => String(o.customer_phone || "").replace(/\D/g, ""))),
    [activeOrders],
  );
  const unreadPhones = useMemo(
    () => new Set(
      conversations
        .filter((c) => Number(c.unread_count || 0) > 0)
        .map((c) => String(c.phone || "").replace(/\D/g, "")),
    ),
    [conversations],
  );

  const filtered = useMemo(() => {
    const available = conversations.filter((c) => !activePhones.has(c.phone.replace(/\D/g, "")));
    if (!q) return available;
    const s = q.toLowerCase();
    return available.filter(
      (c) =>
        (c.customer_name ?? "").toLowerCase().includes(s) ||
        c.phone.includes(q.replace(/\D/g, "")) ||
        (c.last_message_preview ?? "").toLowerCase().includes(s),
    );
  }, [conversations, q, activePhones]);

  /** Insere o emoji na posição do cursor do campo de mensagem (ou no final,
   *  se o campo ainda não tiver foco registrado). */
  function insertEmoji(emoji: string) {
    const el = messageInputRef.current;
    if (!el) {
      setText((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleSendText() {
    if (!selected || !text.trim()) return;
    setSending(true);
    const body = text;
    setText("");
    const res = await sendChatText({
      data: { conversationId: selected.id, phone: selected.phone, text: body },
    });
    if ("error" in res && res.error) toast.error(res.error);
    setSending(false);
  }

  async function sendMediaFile(file: File) {
    if (!selected) return;
    setSending(true);
    try {
      const mediaType = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : file.type.startsWith("audio/")
            ? "audio"
            : "document";
      const path = `${selected.id}/${Date.now()}-${sanitizeStorageKey(file.name)}`;
      const { error: upErr } = await supabase.storage.from("chat-media").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("chat-media").getPublicUrl(path);
      const res = await sendChatMedia({
        data: {
          conversationId: selected.id,
          phone: selected.phone,
          mediaUrl: pub.publicUrl,
          mediaType,
        },
      });
      if ("error" in res && res.error) throw new Error(res.error);
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao enviar arquivo");
    } finally {
      setSending(false);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await sendMediaFile(new File([blob], `audio-${Date.now()}.webm`, { type: "audio/webm" }));
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch {
      toast.error("Não foi possível acessar o microfone");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  async function toggleBotPaused(v: boolean) {
    if (!selected) return;
    await supabase.from("whatsapp_conversations").update({ bot_paused: v }).eq("id", selected.id);
  }

  function primeManualFromExtraction(extracted: any) {
    setGenerateManual({
      customer_name: extracted?.customer_name ?? "",
      delivery_mode: extracted?.delivery_mode ?? "",
      address_street: extracted?.address_street ?? "",
      address_number: extracted?.address_number ?? "",
      address_complement: extracted?.address_complement ?? "",
      address_neighborhood: extracted?.address_neighborhood ?? "",
      address_reference: extracted?.address_reference ?? "",
      payment_method: extracted?.payment_method ?? "",
      items_text: Array.isArray(extracted?.items)
        ? extracted.items.map((i: any) => `${Math.max(1, Number(i.quantity) || 1)}x ${i.product_name}`).join("\n")
        : "",
      notes: extracted?.notes ?? "",
    });
  }

  async function runGenerateOrder(overrides?: Record<string, string>) {
    if (!selected || generatingOrder) return;
    setGeneratingOrder(true);
    try {
      const cleanOverrides = overrides
        ? Object.fromEntries(Object.entries(overrides).filter(([, v]) => String(v ?? "").trim()))
        : undefined;
      const result: any = await generateOrderFromConversation({
        data: { conversationId: selected.id, overrides: cleanOverrides as any },
      });
      switch (result.status) {
        case "ok":
          setGenerateReview(null);
          toast.success(`Pedido #${result.order_number} gerado com sucesso!`, {
            action: {
              label: "Ver pedido",
              onClick: () => navigate({ to: "/loja/pedido/$id", params: { id: result.order_id! }, search: {} }),
            },
          });
          break;
        case "missing_fields":
          primeManualFromExtraction(result.extracted);
          setGenerateReview({
            missing: result.missing ?? [],
            missingKeys: result.missingKeys ?? [],
            extracted: result.extracted ?? {},
          });
          break;
        case "unmatched_products": {
          const hint = (result.suggestions ?? [])
            .filter((s: any) => s.closest?.length)
            .map((s: any) => `"${s.raw}" → ${s.closest.join(" ou ")}`)
            .join("; ");
          toast.error(
            `Não encontrei no cardápio: ${result.items?.join(", ")}.${hint ? ` Você quis dizer: ${hint}?` : " Confira o nome do produto."}`,
          );
          break;
        }
        case "out_of_delivery_area":
          toast.error("O endereço identificado está fora da área de entrega.");
          break;
        case "delivery_fee_unavailable":
          toast.error("Não consegui calcular a taxa de entrega agora. Tente de novo em instantes.");
          break;
        case "empty_conversation":
          toast.error("Essa conversa ainda não tem mensagens pra analisar.");
          break;
        case "ai_unavailable":
          toast.error("A IA está indisponível no momento. Tente de novo em instantes.");
          break;
        default:
          toast.error(result.detail || "Não foi possível gerar o pedido.");
      }
    } catch (err: any) {
      toast.error("Erro ao gerar pedido: " + String(err?.message ?? err));
    } finally {
      setGeneratingOrder(false);
    }
  }

  async function handleGenerateOrder() {
    await runGenerateOrder();
  }

  async function claimOrderAndConversation(order: ActiveOrder, conversationId?: string | null) {
    if (!currentOperator) return;
    try {
      await Promise.all([
        (supabase as any).from("orders").update({
          assigned_operator_id: currentOperator.id,
          assigned_operator_email: currentOperator.email,
          assigned_operator_at: new Date().toISOString(),
        }).eq("id", order.id),
        conversationId
          ? (supabase as any).from("whatsapp_conversations").update({
              assigned_operator_id: currentOperator.id,
              assigned_operator_email: currentOperator.email,
              assigned_operator_at: new Date().toISOString(),
            }).eq("id", conversationId)
          : Promise.resolve(),
      ]);
    } catch (err) {
      console.warn("[chat] não foi possível registrar operador responsável", err);
    }
  }

  async function openChatFromOrder(order: ActiveOrder) {
    const digits = String(order.customer_phone || "").replace(/\D/g, "");
    let conv = conversations.find((c) => c.phone.replace(/\D/g, "") === digits) ?? null;
    try {
      if (!conv) {
        conv = await getOrCreateConversationByPhone(order.customer_phone, order.customer_name);
        await loadConversations();
      }
      await claimOrderAndConversation(order, conv.id);
      setSelectedId(conv.id);
      setSideTab("orders");
    } catch (err: any) {
      toast.error("Não foi possível abrir o chat: " + String(err?.message ?? err));
    }
  }

  // agrupa mensagens por data pra mostrar separadores de dia
  const grouped = useMemo(() => {
    const result: { date: string; msgs: Message[] }[] = [];
    let lastDate = "";
    for (const m of messages) {
      const d = new Date(m.created_at).toLocaleDateString("pt-BR");
      if (d !== lastDate) {
        lastDate = d;
        result.push({ date: d, msgs: [] });
      }
      result[result.length - 1].msgs.push(m);
    }
    return result;
  }, [messages]);

  const selectedPhoneDigits = selected ? String(selected.phone || "").replace(/\D/g, "") : "";

  const today = new Date().toLocaleDateString("pt-BR");
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("pt-BR");

  // agrupa a lista de conversas (barra lateral) por data da última mensagem
  const groupedConversations = useMemo(() => {
    const byDate = (a: Conversation, b: Conversation) =>
      new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
    const pinned   = [...filtered].filter((c) => c.pinned).sort(byDate);
    const unpinned = [...filtered].filter((c) => !c.pinned).sort(byDate);
    const result: { date: string; convos: Conversation[]; isPin?: boolean }[] = [];
    if (pinned.length) result.push({ date: "📌 Fixadas", convos: pinned, isPin: true });
    for (const c of unpinned) {
      const d = c.last_message_at ? new Date(c.last_message_at).toLocaleDateString("pt-BR") : "—";
      let bucket = result.find((r) => r.date === d);
      if (!bucket) { bucket = { date: d, convos: [] }; result.push(bucket); }
      bucket.convos.push(c);
    }
    return result;
  }, [filtered]);

  return (
    <div className="flex h-[calc(100vh-5rem)] overflow-hidden md:rounded-2xl md:border md:bg-card md:shadow-lg">
      {/* ============ SIDEBAR ============ */}
      <div
        className={`${selectedId ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r bg-muted/20 md:w-72`}
      >
        {/* cabeçalho da sidebar — visual clássico do WhatsApp (verde-escuro) */}
        <div className="bg-[#075E54] p-3 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 font-bold text-white">
            <MessageCircle className="size-4" /> Conversas
          </h2>
          <div className="mb-2 flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 flex-1 gap-1 rounded-full border-white/30 bg-white/10 text-xs text-white hover:bg-white/20 hover:text-white"
              onClick={() => setDialogMode("newchat")}
            >
              <Plus className="size-3.5" /> Novo
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 flex-1 gap-1 rounded-full text-xs"
              onClick={() => setDialogMode("broadcast")}
            >
              <Radio className="size-3.5" /> Transmissão
            </Button>
          </div>
          {/* Botão Janela 24h */}
          <button
            type="button"
            onClick={() => { loadWindowContacts(); setShowWindowBroadcast(true); setWbLog([]); }}
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-400/35"
          >
            <Clock className="size-3.5" />
            Janela 24h — últimos 2h30
          </button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 rounded-full border-0 bg-muted pl-8 text-sm focus-visible:ring-1"
              placeholder="Buscar cliente, telefone, pedido ou endereço..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        {/* lista */}
        <div className="flex-1 overflow-y-auto">
          {!filtered.length ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <MessageCircle className="size-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">Nenhuma conversa ainda</p>
            </div>
          ) : (
            groupedConversations.map((group) => (
              <div key={group.date}>
                <div className="sticky top-0 z-10 bg-background/95 px-3 py-1.5 backdrop-blur">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.date === today ? "Hoje" : group.date === yesterday ? "Ontem" : group.date}
                  </span>
                </div>
                {group.convos.map((c) => {
                  const active = selectedId === c.id;
                  return (
                    <div
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedId(c.id);
                        }
                      }}
                      className={`group flex w-full cursor-pointer items-start gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-muted/50 ${active ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                    >
                      {/* avatar — mostra a inicial do NOME do cliente (nunca do telefone: todo
                          número no Brasil começa com o DDI "55", então usar o telefone sempre
                          dava a mesma letra "5" pra todo mundo). Sem nome ainda, usa um ícone
                          de pessoa neutro em vez de um número sem sentido. */}
                      <div className="relative shrink-0">
                        <div
                          className={`grid size-10 place-items-center rounded-full text-sm font-bold ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                        >
                          {c.customer_name ? c.customer_name.charAt(0).toUpperCase() : <User className="size-4.5" />}
                        </div>
                        {repeatCustomers.has(c.phone.replace(/\D/g, "")) && (
                          <span
                            className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-emerald-500 text-white ring-2 ring-background"
                            title="Cliente já fechou pedido com a loja"
                          >
                            <Check className="size-2.5" strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="flex min-w-0 items-center gap-1 truncate text-sm font-semibold">
                            <span className="truncate">{c.customer_name || formatPhone(c.phone)}</span>
                          </span>
                          {(c as any).has_unread && (
                            <span className="size-2.5 shrink-0 rounded-full bg-emerald-500" title="Nova mensagem" />
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{c.last_message_preview || "—"}</p>
                        <div className="mt-0.5 flex items-center gap-1">
                          {c.bot_paused ? (
                            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-amber-600">
                              <UserCog className="size-3" /> Atendimento manual
                            </span>
                          ) : (
                            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <Bot className="size-3" /> Robô ativo
                            </span>
                          )}
                        </div>
                        {/* Tags do lead — aparecem na lista de conversas */}
                        {(leadTagsMap.get(c.phone) ?? []).length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-0.5">
                            {(leadTagsMap.get(c.phone) ?? []).map((t) => (
                              <span key={t} className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${chatTagStyle(t)}`}>
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="ml-1 flex shrink-0 flex-col items-center gap-0.5">
                        {/* Avaliação — apenas o joinha, sincronizado com Leads e por pedido */}
                        {repeatCustomers.has(c.phone.replace(/\D/g, "")) && (() => {
                          const sat = satisfactionByPhone[c.phone];
                          const canSend = !!sat?.eligibleOrderId;
                          const title = canSend
                            ? `Enviar avaliação${sat?.eligibleOrderRef ? ` do pedido #${sat.eligibleOrderRef.replace(/^#/, "")}` : ""}`
                            : sat?.latestState === "submitted" ? "Último pedido já foi avaliado" : "Avaliação do último pedido já enviada";
                          return (
                            <button
                              type="button"
                              onClick={(e) => sendSatisfactionFromContactCard(c, e)}
                              disabled={!canSend || sendingSatisfactionPhone === c.phone}
                              className={`grid size-6 place-items-center rounded-full transition ${
                                canSend
                                  ? "text-amber-600 hover:bg-amber-100 hover:text-amber-700"
                                  : sat?.latestState === "submitted"
                                    ? "text-emerald-600"
                                    : "text-muted-foreground/45"
                              } disabled:cursor-default`}
                              title={title}
                            >
                              {sendingSatisfactionPhone === c.phone
                                ? <Loader2 className="size-3 animate-spin" />
                                : <ThumbsUp className={`size-3 ${sat?.latestState === "submitted" ? "fill-current" : ""}`} />}
                            </button>
                          );
                        })()}
                        {/* Pin */}
                        <button
                          type="button"
                          onClick={(e) => togglePin(c, e)}
                          className={`grid size-6 place-items-center rounded-full transition ${
                            c.pinned
                              ? "text-amber-500"
                              : "text-muted-foreground opacity-0 hover:text-amber-500 group-hover:opacity-100"
                          }`}
                          title={c.pinned ? "Desafixar" : "Fixar no topo"}
                        >
                          <Pin className={`size-3 ${c.pinned ? "fill-amber-400" : ""}`} />
                        </button>
                        {/* Delete */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmAction({
                              kind: "delete_conversation",
                              conversationId: c.id,
                              label: c.customer_name || formatPhone(c.phone),
                            });
                          }}
                          className="grid size-6 place-items-center rounded-full text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          title="Excluir conversa"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ============ THREAD ============ */}
      <div className={`${!selectedId ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-hidden`}>
        {!selected ? (
          <div className="grid flex-1 place-items-center">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <MessageCircle className="size-12 opacity-20" />
              <p className="text-sm">Selecione uma conversa</p>
            </div>
          </div>
        ) : (
          <>
            {/* header da conversa — visual clássico do WhatsApp */}
            <div className="flex items-center justify-between bg-[#075E54] px-4 py-3 shadow-sm">
              <div className="flex min-w-0 items-center gap-2 md:gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="-ml-2 shrink-0 text-white hover:bg-white/10 hover:text-white md:hidden"
                  onClick={() => setSelectedId(null)}
                  title="Voltar"
                >
                  <X className="size-5" />
                </Button>
                <div className="relative shrink-0">
                  <div className="grid size-10 place-items-center rounded-full bg-white/15 text-sm font-bold text-white">
                    {selected.customer_name ? (
                      selected.customer_name.charAt(0).toUpperCase()
                    ) : (
                      <User className="size-4.5" />
                    )}
                  </div>
                  {repeatCustomers.has(selected.phone.replace(/\D/g, "")) && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-emerald-500 text-white ring-2 ring-background"
                      title="Cliente já fechou pedido com a loja"
                    >
                      <Check className="size-2.5" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1 truncate font-semibold leading-tight text-white">
                    {selected.customer_name || "Sem nome"}
                    {repeatCustomers.has(selected.phone.replace(/\D/g, "")) && (
                      <span
                        className="ml-1 rounded-full bg-emerald-400/90 px-1.5 py-0.5 text-[10px] font-bold text-emerald-950"
                        title="Cliente já fechou pedido com a loja"
                      >
                        Cliente ✓
                      </span>
                    )}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-white/70">
                    <Phone className="size-3" /> {formatPhone(selected.phone)}
                  </p>
                  {/* Tags do lead no topo da conversa */}
                  {(leadTagsMap.get(selected.phone) ?? []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(leadTagsMap.get(selected.phone) ?? []).map((t) => (
                        <span
                          key={t}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm ${chatTagStyle(t)}`}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                  disabled={generatingOrder}
                  onClick={handleGenerateOrder}
                  title="A IA lê essa conversa inteira e gera o pedido no sistema com os dados que o cliente confirmou"
                >
                  {generatingOrder ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <PackagePlus className="size-3.5" />
                  )}
                  Gerar pedido com IA
                </Button>
                <label className="flex cursor-pointer items-center gap-2">
                  <span className="text-xs font-medium text-white/80">
                    {selected.bot_paused ? (
                      <span className="flex items-center gap-1 font-semibold text-amber-300">
                        <UserCog className="size-3.5" /> Manual
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-300">
                        <Bot className="size-3.5" /> Robô
                      </span>
                    )}
                  </span>
                  <Switch checked={selected.bot_paused} onCheckedChange={toggleBotPaused} />
                </label>
              </div>
            </div>

            {/* mensagens — fundo estilo WhatsApp (papel de parede configurável em Configurações) */}
            <div
              className="flex-1 overflow-y-auto p-4"
              style={
                wallpaperOption === "whatsapp_teal"
                  ? {
                      backgroundImage: `url(${wallpaperTeal})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : wallpaperOption === "whatsapp_beige"
                    ? {
                        backgroundImage: `url(${wallpaperBeige})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                    : {
                        backgroundColor: "#E5DDD5",
                        backgroundImage:
                          "repeating-linear-gradient(135deg, rgba(0,0,0,0.025) 0px, rgba(0,0,0,0.025) 1px, transparent 1px, transparent 20px)",
                      }
              }
            >
              {grouped.map((group) => (
                <div key={group.date}>
                  {/* separador de data */}
                  <div className="my-3 flex items-center justify-center">
                    <span className="rounded-md bg-[#E1F2FB] px-3 py-1 text-[11px] font-semibold text-[#54656F] shadow-sm">
                      {group.date === today ? "Hoje" : group.date === yesterday ? "Ontem" : group.date}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {group.msgs.map((m) => (
                      <MessageBubble
                        key={m.id}
                        m={m}
                        onDelete={async () => {
                          if (!window.confirm("Apagar esta mensagem para você e para o cliente no WhatsApp?")) return;
                          try {
                            const result = await deleteMessage({ data: { messageId: m.id } });
                            if (result?.error) {
                              toast.error(result.error);
                              return;
                            }
                            setMessages((prev) => prev.filter((x) => x.id !== m.id));
                            toast.success("Mensagem apagada para todos.");
                          } catch (err: any) {
                            toast.error(err.message ?? "Falha ao apagar mensagem para todos");
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div ref={threadEndRef} />
            </div>

            {/* input — barra no padrão exato do WhatsApp: pílula branca com
                emoji + texto + anexo + câmera, e o botão redondo verde à parte */}
            <div className="bg-[#F0F0F0] px-2 py-2">
              {recording && (
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">
                  <Mic className="size-4 animate-pulse" /> Gravando... clique em parar para enviar
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      e.target.value = "";
                      await sendMediaFile(f);
                    }
                  }}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      e.target.value = "";
                      await sendMediaFile(f);
                    }
                  }}
                />

                <div className="flex min-h-10 flex-1 items-end gap-1 rounded-3xl bg-white px-1.5 py-1 shadow-sm">
                  <EmojiPicker onSelect={insertEmoji} />

                  <Textarea
                    ref={messageInputRef}
                    rows={1}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendText();
                      }
                    }}
                    placeholder="Mensagem"
                    className="max-h-32 min-h-8 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:ring-0"
                    disabled={recording}
                  />

                  <button
                    type="button"
                    className="grid size-9 shrink-0 place-items-center rounded-full text-[#54656F] hover:bg-black/5"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending || recording}
                    title="Anexar arquivo"
                  >
                    <Paperclip className="size-5" />
                  </button>
                  <button
                    type="button"
                    className="grid size-9 shrink-0 place-items-center rounded-full text-[#54656F] hover:bg-black/5"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={sending || recording}
                    title="Câmera"
                  >
                    <Camera className="size-5" />
                  </button>
                </div>

                {text.trim() ? (
                  <Button
                    size="icon"
                    className="size-10 shrink-0 rounded-full bg-[#25D366] text-white hover:bg-[#20BD5A]"
                    onClick={handleSendText}
                    disabled={sending}
                  >
                    <Send className="size-4" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant={recording ? "destructive" : undefined}
                    className={`size-10 shrink-0 rounded-full ${recording ? "" : "bg-[#25D366] text-white hover:bg-[#20BD5A]"}`}
                    onClick={recording ? stopRecording : startRecording}
                    disabled={sending}
                    title={recording ? "Parar e enviar áudio" : "Gravar áudio"}
                  >
                    {recording ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ============ PAINEL LATERAL: RESPOSTAS / PEDIDOS ============ */}
      <div className="hidden w-72 shrink-0 flex-col border-l md:flex">
        <div className="grid grid-cols-2 border-b bg-card p-2">
          <button
            type="button"
            onClick={() => setSideTab("quick")}
            className={`rounded-lg px-2 py-2 text-xs font-bold ${sideTab === "quick" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            <Zap className="mr-1 inline size-3.5" /> Respostas
          </button>
          <button
            type="button"
            onClick={() => setSideTab("orders")}
            className={`rounded-lg px-2 py-2 text-xs font-bold ${sideTab === "orders" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            <Package className="mr-1 inline size-3.5" /> Pedidos {activeOrders.length ? `(${activeOrders.length})` : ""}{unreadPhones.size ? ` · 💬 ${unreadPhones.size}` : ""}
          </button>
        </div>
        {sideTab === "quick" ? (
          <QuickRepliesPanel
            embedded
            disabled={!selected}
            onPick={(qr) =>
              setConfirmAction({
                kind: "send_quick_reply",
                body: qr.body,
                title: qr.title,
                image_url: qr.image_url,
              })
            }
          />
        ) : (
          <ActiveOrdersPanel
            orders={activeOrders}
            deliveryMinutes={deliveryMinutes}
            now={timerNow}
            onUpdateStatus={async (id, status) => {
              const patch: Record<string, string> = { status };
              const now = new Date().toISOString();
              if (status === "ready_pickup") patch.ready_at = now;
              if (status === "out_for_delivery") patch.out_for_delivery_at = now;
              const { error } = await supabase.from("orders").update(patch).eq("id", id);
              if (error) toast.error("Não foi possível atualizar o pedido.");
              else {
                toast.success(status === "ready_pickup" ? "Pedido marcado como pronto" : "Pedido saiu para entrega");
                loadConversations();
              }
            }}
            onCancelOrder={async (id) => {
              if (!window.confirm("Cancelar este pedido?")) return;
              const { error } = await supabase.from("orders").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", id);
              if (error) toast.error("Não foi possível cancelar o pedido.");
              else { toast.success("Pedido cancelado"); loadConversations(); }
            }}
            onOpenOrder={(id) => navigate({ to: "/loja/pedido/$id", params: { id } })}
            onOpenChat={openChatFromOrder}
            unreadPhones={unreadPhones}
            conversations={conversations}
            orderItemsByOrder={orderItemsByOrder}
            searchQuery={q}
            selectedPhone={selectedPhoneDigits}
            currentOperator={currentOperator}
          />
        )}
      </div>

      <Dialog open={!!generateReview} onOpenChange={(open) => !open && setGenerateReview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Completar dados do pedido</DialogTitle>
          </DialogHeader>
          {generateReview && (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">A IA encontrou parte do pedido, mas ainda faltam dados para gerar com segurança.</p>
                <p className="mt-1">Faltando: <span className="font-bold">{generateReview.missing.join(", ")}</span>.</p>
              </div>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <p className="font-semibold">Dados encontrados com segurança</p>
                <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                  {generateManual.customer_name && <span>✅ Nome: <strong>{generateManual.customer_name}</strong></span>}
                  {generateManual.delivery_mode && <span>✅ Tipo: <strong>{generateManual.delivery_mode === "pickup" ? "Retirada" : "Entrega"}</strong></span>}
                  {generateManual.address_street && <span>✅ Rua: <strong>{generateManual.address_street}</strong></span>}
                  {generateManual.address_number && <span>✅ Número: <strong>{generateManual.address_number}</strong></span>}
                  {generateManual.address_neighborhood && <span>✅ Bairro: <strong>{generateManual.address_neighborhood}</strong></span>}
                  {generateManual.payment_method && <span>✅ Pagamento: <strong>{generateManual.payment_method === "pix" ? "Pix" : "Cartão"}</strong></span>}
                  {generateManual.items_text && <span className="sm:col-span-2">✅ Itens identificados</span>}
                </div>
                <p className="mt-2 text-[11px] text-emerald-800/80">Dados críticos não são inventados: quando houver dúvida, o campo permanece pendente para você confirmar.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold">Nome do cliente</label>
                  <Input value={generateManual.customer_name ?? ""} onChange={(e) => setGenerateManual((p) => ({ ...p, customer_name: e.target.value }))} placeholder="Nome de quem vai receber" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Entrega ou retirada</label>
                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={generateManual.delivery_mode ?? ""} onChange={(e) => setGenerateManual((p) => ({ ...p, delivery_mode: e.target.value }))}>
                    <option value="">Selecione</option>
                    <option value="delivery">Entrega</option>
                    <option value="pickup">Retirada no local</option>
                  </select>
                </div>
                {generateManual.delivery_mode !== "pickup" && (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-semibold">Rua</label>
                      <Input value={generateManual.address_street ?? ""} onChange={(e) => setGenerateManual((p) => ({ ...p, address_street: e.target.value }))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold">Número</label>
                      <Input value={generateManual.address_number ?? ""} onChange={(e) => setGenerateManual((p) => ({ ...p, address_number: e.target.value }))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold">Bairro</label>
                      <Input value={generateManual.address_neighborhood ?? ""} onChange={(e) => setGenerateManual((p) => ({ ...p, address_neighborhood: e.target.value }))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold">Complemento / referência</label>
                      <Input value={generateManual.address_complement ?? ""} onChange={(e) => setGenerateManual((p) => ({ ...p, address_complement: e.target.value }))} />
                    </div>
                  </>
                )}
                <div>
                  <label className="mb-1 block text-xs font-semibold">Forma de pagamento</label>
                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={generateManual.payment_method ?? ""} onChange={(e) => setGenerateManual((p) => ({ ...p, payment_method: e.target.value }))}>
                    <option value="">Selecione</option>
                    <option value="pix">Pix</option>
                    <option value="card">Cartão</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold">Itens do pedido</label>
                  <Textarea rows={3} value={generateManual.items_text ?? ""} onChange={(e) => setGenerateManual((p) => ({ ...p, items_text: e.target.value }))} placeholder={"Ex.:\n1x COSTELA DESFIADA\n1x GUARANÁ ANTARCTICA LATA 350 ML"} />
                  <p className="mt-1 text-[11px] text-muted-foreground">Use uma linha por item. A IA ainda confere o nome com o cardápio real antes de criar.</p>
                </div>
              </div>

              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                Você pode preencher manualmente o que falta e gerar agora, ou fechar esta janela, perguntar ao cliente e clicar em <strong>Gerar pedido com IA</strong> novamente depois.
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setGenerateReview(null)} disabled={generatingOrder}>Vou perguntar ao cliente</Button>
            <Button onClick={() => runGenerateOrder(generateManual)} disabled={generatingOrder}>
              {generatingOrder ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
              Preencher manualmente e gerar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChatDialogs
        mode={dialogMode}
        onClose={() => setDialogMode(null)}
        onPick={async (phone, name) => {
          if (!phone) {
            toast.error("Número inválido");
            return;
          }
          try {
            const conv = await getOrCreateConversationByPhone(phone, name);
            await loadConversations();
            setSelectedId(conv.id);
            setDialogMode(null);
          } catch (err: any) {
            toast.error("Não foi possível iniciar essa conversa: " + (err?.message ?? String(err)));
          }
        }}
      />

      <AlertDialog open={!!confirmAction} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <AlertDialogContent>
          {confirmAction?.kind === "delete_conversation" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir conversa?</AlertDialogTitle>
                <AlertDialogDescription>
                  Todas as mensagens de <span className="font-semibold">{confirmAction.label}</span> serão apagadas
                  permanentemente. Essa ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={async () => {
                    const convId = confirmAction.conversationId;
                    setConfirmAction(null);
                    const res = await deleteConversation({ data: { conversationId: convId } });
                    if ("error" in res && res.error) {
                      toast.error(res.error);
                      return;
                    }
                    toast.success("Conversa excluída");
                    if (selectedId === convId) setSelectedId(null);
                    await loadConversations();
                  }}
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {confirmAction?.kind === "send_quick_reply" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Enviar resposta rápida?</AlertDialogTitle>
                <AlertDialogDescription>
                  <span className="mb-2 block text-xs font-semibold uppercase text-muted-foreground">
                    {confirmAction.title}
                  </span>
                  {confirmAction.image_url && (
                    <img
                      src={confirmAction.image_url}
                      alt=""
                      className="mb-2 max-h-48 w-full rounded-md border object-cover"
                    />
                  )}
                  <span className="block whitespace-pre-wrap rounded-md bg-muted p-3 text-sm text-foreground">
                    {confirmAction.body}
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    if (!selected) {
                      setConfirmAction(null);
                      return;
                    }
                    const body = confirmAction.body;
                    const imageUrl = confirmAction.image_url;
                    setConfirmAction(null);
                    setSending(true);
                    const res = imageUrl
                      ? await sendChatMedia({
                          data: {
                            conversationId: selected.id,
                            phone: selected.phone,
                            mediaUrl: imageUrl,
                            mediaType: "image",
                            caption: body,
                          },
                        })
                      : await sendChatText({
                          data: { conversationId: selected.id, phone: selected.phone, text: body },
                        });
                    setSending(false);
                    if ("error" in res && res.error) toast.error(res.error);
                    else toast.success("Resposta enviada");
                  }}
                >
                  Enviar agora
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Janela 24h — broadcast gratuito dentro da janela do Meta API ── */}
      <Dialog
        open={showWindowBroadcast}
        onOpenChange={(v) => { if (!wbSending) { setShowWindowBroadcast(v); if (!v) { setWbLog([]); setWbProgress(null); } } }}
      >
        <DialogContent className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <div className="flex items-center gap-3 border-b bg-[#075E54] px-5 py-4">
            <Clock className="size-5 text-emerald-300" />
            <div>
              <p className="font-bold text-white">Janela 24h — Meta WhatsApp API</p>
              <p className="text-xs text-emerald-200">
                {windowContacts.length} contato(s) nas últimas 22h30 · mensagens gratuitas dentro da janela
              </p>
            </div>
          </div>
          <div className="flex flex-1 overflow-hidden">
            {/* Lista de contatos */}
            <div className="flex w-56 shrink-0 flex-col border-r">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Contatos</p>
                <button
                  onClick={() =>
                    wbSelected.size === windowContacts.length
                      ? setWbSelected(new Set())
                      : setWbSelected(new Set(windowContacts.map((c) => c.phone)))
                  }
                  className="text-[10px] font-medium text-primary hover:underline"
                >
                  {wbSelected.size === windowContacts.length ? "Desmarcar todos" : "Marcar todos"}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {windowContacts.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    Nenhum contato nas últimas 22h30.
                  </p>
                ) : windowContacts.map((c) => {
                  const log = wbLog.find((l) => l.phone === c.phone);
                  return (
                    <div
                      key={c.phone}
                      onClick={() => {
                        if (wbSending) return;
                        setWbSelected((prev) => {
                          const next = new Set(prev);
                          next.has(c.phone) ? next.delete(c.phone) : next.add(c.phone);
                          return next;
                        });
                      }}
                      className={`flex cursor-pointer items-center gap-2 border-b px-3 py-2.5 transition hover:bg-muted/40 ${wbSelected.has(c.phone) ? "bg-primary/5" : ""}`}
                    >
                      <input type="checkbox" readOnly checked={wbSelected.has(c.phone)} className="size-3.5 accent-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{c.name || "Sem nome"}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{formatPhone(c.phone)}</p>
                      </div>
                      {log && (
                        <span className={`text-[9px] font-bold ${log.status === "ok" ? "text-green-600" : log.status === "skip" ? "text-gray-400" : "text-red-500"}`}>
                          {log.status === "ok" ? "✓" : log.status === "skip" ? "–" : "✗"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
                {wbSelected.size} / {windowContacts.length} selecionados
              </p>
            </div>

            {/* Composer */}
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">Mensagem de texto</label>
                <textarea
                  rows={5}
                  value={wbText}
                  onChange={(e) => setWbText(e.target.value)}
                  disabled={wbSending}
                  placeholder="Digite a mensagem que será enviada para os contatos selecionados…"
                  className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">Imagem (opcional)</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={wbImageUrl}
                    onChange={(e) => setWbImageUrl(e.target.value)}
                    disabled={wbSending || wbUploading}
                    placeholder="Cole uma URL pública ou envie um arquivo →"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                  />
                  <input
                    ref={wbFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setWbUploading(true);
                      try {
                        const path = `broadcast/${Date.now()}-${sanitizeStorageKey(file.name)}`;
                        const { error: upErr } = await supabase.storage.from("chat-media").upload(path, file, { upsert: true });
                        if (upErr) throw upErr;
                        const { data: pub } = supabase.storage.from("chat-media").getPublicUrl(path);
                        setWbImageUrl(pub.publicUrl);
                      } catch (err: any) {
                        toast.error(err.message ?? "Falha ao subir a imagem");
                      } finally {
                        setWbUploading(false);
                        if (wbFileInputRef.current) wbFileInputRef.current.value = "";
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={wbSending || wbUploading}
                    onClick={() => wbFileInputRef.current?.click()}
                    className="shrink-0 gap-1.5"
                  >
                    {wbUploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                    {wbUploading ? "Enviando…" : "Upload"}
                  </Button>
                </div>
                {wbImageUrl && (
                  <div className="relative mt-2 inline-block">
                    <img
                      src={wbImageUrl}
                      alt="preview"
                      className="max-h-32 rounded-lg object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                    <button
                      type="button"
                      onClick={() => setWbImageUrl("")}
                      disabled={wbSending || wbUploading}
                      className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black disabled:opacity-50"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Anti-ban info */}
              <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/80 p-3 text-xs">
                <p className="mb-1.5 font-semibold text-emerald-800">🛡️ Estratégia anti-ban ativa</p>
                <ul className="space-y-0.5 text-emerald-700">
                  <li>• 10–20s aleatório entre cada envio</li>
                  <li>• Pausa de 30–50s a cada 5 mensagens</li>
                  <li>• Pausa de 90–120s a cada 15 mensagens</li>
                  <li>• Variação de ±20% em todos os intervalos</li>
                </ul>
                {wbSelected.size > 0 && (
                  <p className="mt-2 font-semibold text-emerald-800">
                    Tempo estimado: ~{Math.ceil(wbSelected.size * 15 / 60)} min para {wbSelected.size} contato(s)
                  </p>
                )}
              </div>

              {/* Progresso */}
              {wbProgress && (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>Enviando…</span>
                    <span>{wbProgress.done}/{wbProgress.total}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${(wbProgress.done / wbProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <Button
                disabled={wbSending || wbSelected.size === 0 || (!wbText.trim() && !wbImageUrl.trim())}
                className="w-full gap-2 bg-[#075E54] hover:bg-[#065048] text-white"
                onClick={async () => {
                  if (wbSending) return;
                  setWbSending(true);
                  setWbLog([]);
                  setWbProgress({ done: 0, total: wbSelected.size });
                  try {
                    const result = await sendWindowBroadcast({
                      data: { phones: [...wbSelected], text: wbText.trim(), imageUrl: wbImageUrl.trim() },
                    });
                    setWbLog(result.log);
                    setWbProgress({ done: result.log.length, total: wbSelected.size });
                    toast.success(`✅ ${result.sent} enviados · ${result.skipped} pulados · ${result.failed} falhas`);
                  } catch (err: any) {
                    toast.error(err.message ?? "Erro ao enviar");
                  }
                  setWbSending(false);
                }}
              >
                {wbSending
                  ? <><Loader2 className="size-4 animate-spin" /> Enviando — não feche esta janela…</>
                  : <><Send className="size-4" /> Enviar para {wbSelected.size} contato(s)</>
                }
              </Button>

              {!wbSending && wbLog.length > 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  Envio concluído. Você pode fechar esta janela.
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function MessageBubble({ m, onDelete }: { m: Message; onDelete?: () => Promise<void> }) {
  const out = m.direction === "out";
  const [hovered, setHovered] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div
      className={`flex ${out ? "justify-end" : "justify-start"} mb-1`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >

      <div
        className={`relative max-w-[72%] rounded-lg px-2.5 py-1.5 text-[#111B21] shadow-sm ${
          out ? "rounded-tr-none bg-[#DCF8C6]" : "rounded-tl-none bg-white"
        }`}
      >
        {/* ── Botão apagar — aparece no canto do balão ao passar o mouse ── */}
        {out && onDelete && hovered && (
          <button
            onMouseDown={async (e) => {
              e.stopPropagation();
              if (deleting) return;
              setDeleting(true);
              try { await onDelete(); } finally { setDeleting(false); }
            }}
            disabled={deleting}
            className="absolute -right-2 -top-2 z-20 flex size-5 items-center justify-center rounded-full bg-white text-red-400 shadow-md transition-colors hover:bg-red-500 hover:text-white disabled:opacity-50"
            title="Apagar para todos"
          >
            {deleting
              ? <Loader2 className="size-2.5 animate-spin" />
              : <Trash2 className="size-2.5" />}
          </button>
        )}
        {/* imagem */}
        {m.media_url && m.media_type === "image" && (
          <a href={m.media_url} target="_blank" rel="noopener noreferrer">
            <img
              src={m.media_url}
              alt="Imagem"
              className="mb-1.5 max-h-56 w-full rounded-xl object-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 24 24'%3E%3Cpath fill='%23ccc' d='M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z'/%3E%3C/svg%3E";
              }}
            />
          </a>
        )}

        {/* vídeo */}
        {m.media_url && m.media_type === "video" && (
          <video src={m.media_url} controls className="mb-1.5 max-h-56 w-full rounded-xl" preload="metadata" />
        )}

        {/* áudio — player estilizado */}
        {m.media_url && m.media_type === "audio" && (
          <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-black/5 px-2 py-1">
            <Mic className="size-4 shrink-0 text-[#54656F]" />
            <audio src={m.media_url} controls className="h-8 w-48 max-w-full" preload="metadata" />
          </div>
        )}

        {/* documento */}
        {m.media_url && m.media_type === "document" && (
          <a
            href={m.media_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-1.5 flex items-center gap-2 rounded-xl bg-black/5 px-3 py-2 text-sm text-[#111B21] underline"
          >
            <FileText className="size-4 shrink-0" /> Ver documento
          </a>
        )}

        {/* texto */}
        {m.body && <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>}

        {/* timestamp */}
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
          <span>
            {new Date(m.created_at).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {out &&
            (m.read_at ? (
              <span
                title={`Lida às ${new Date(m.read_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
              >
                <CheckCheck className="size-3 text-[#53BDEB]" />
              </span>
            ) : (
              <span title="Enviada, ainda não lida pelo cliente">
                <Check className="size-3" />
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

type Lead = { id: string; name: string | null; phone: string; created_at: string };

/** Agrupa leads por data de criação — Hoje / Ontem / "14 de agosto" */
function groupLeadsByDate(leads: Lead[]) {
  const today     = new Date().toLocaleDateString("pt-BR");
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("pt-BR");
  const groups: { label: string; leads: Lead[] }[] = [];
  for (const l of leads) {
    const d = new Date(l.created_at).toLocaleDateString("pt-BR");
    const label =
      d === today     ? "Hoje" :
      d === yesterday ? "Ontem" :
      new Date(l.created_at).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
    let g = groups.find((g) => g.label === label);
    if (!g) { g = { label, leads: [] }; groups.push(g); }
    g.leads.push(l);
  }
  return groups;
}

function ChatDialogs({
  mode,
  onClose,
  onPick,
}: {
  mode: DialogMode;
  onClose: () => void;
  onPick: (phone: string, name: string | null) => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const bcFileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedPhones, setSelectedPhones] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const [manualName, setManualName] = useState("");

  useEffect(() => {
    if (!mode) return;
    setQ("");
    setText("");
    setImageUrl("");
    setSelectedPhones([]);
    setManualPhone("");
    setManualName("");
    supabase
      .from("leads")
      .select("id,name,phone,created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => setLeads((data as Lead[]) ?? []));
  }, [mode]);

  const filtered = useMemo(() => {
    if (!q) return leads;
    const s = q.toLowerCase();
    return leads.filter((l) => (l.name ?? "").toLowerCase().includes(s) || l.phone.includes(q.replace(/\D/g, "")));
  }, [leads, q]);

  const groupedLeads = useMemo(() => groupLeadsByDate(filtered), [filtered]);
  const allSelected = selectedPhones.length === filtered.length && filtered.length > 0;

  async function uploadBroadcastImage(file: File) {
    setUploading(true);
    try {
      const path = `broadcast/${Date.now()}-${sanitizeStorageKey(file.name)}`;
      const { error: upErr } = await supabase.storage.from("chat-media").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("chat-media").getPublicUrl(path);
      setImageUrl(pub.publicUrl);
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao subir a imagem");
    } finally {
      setUploading(false);
      if (bcFileInputRef.current) bcFileInputRef.current.value = "";
    }
  }

  async function send() {
    if (!selectedPhones.length) return;
    if (!text.trim() && !imageUrl) return toast.error("Digite a mensagem ou adicione uma imagem");
    setSending(true);
    try {
      const res = await broadcastMessage({ data: { phones: selectedPhones, text, imageUrl: imageUrl || undefined } });
      toast.success(
        `Enviado para ${res.sent} contato(s)${res.failed?.length ? `, ${res.failed.length} falharam` : ""}`,
      );
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao enviar transmissão");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      {mode === "broadcast" && (
        <DialogContent className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
          {/* Cabeçalho */}
          <div className="flex items-center gap-3 border-b bg-[#075E54] px-5 py-4">
            <Radio className="size-5 text-emerald-300" />
            <div>
              <p className="font-bold text-white">Lista de transmissão</p>
              <p className="text-xs text-emerald-200">Cada contato recebe individualmente — não é grupo</p>
            </div>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Lista de contatos agrupada por data */}
            <div className="flex w-56 shrink-0 flex-col border-r">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Contatos</p>
                <button
                  type="button"
                  onClick={() => setSelectedPhones(allSelected ? [] : filtered.map((l) => l.phone))}
                  className="text-[10px] font-medium text-primary hover:underline"
                >
                  {allSelected ? "Desmarcar todos" : "Marcar todos"}
                </button>
              </div>
              <div className="px-2 py-1.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-7 pl-6 text-xs"
                    placeholder="Buscar"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {groupedLeads.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">Nenhum contato encontrado</p>
                ) : groupedLeads.map((group) => (
                  <div key={group.label}>
                    {/* Separador de data — mesmo estilo do chat */}
                    <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-muted/80 px-3 py-1 backdrop-blur-sm">
                      <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{group.label}</span>
                    </div>
                    {group.leads.map((l) => (
                      <div
                        key={l.id}
                        onClick={() =>
                          setSelectedPhones((prev) =>
                            prev.includes(l.phone) ? prev.filter((p) => p !== l.phone) : [...prev, l.phone],
                          )
                        }
                        className={`flex cursor-pointer items-center gap-2 border-b px-3 py-2.5 transition hover:bg-muted/40 ${selectedPhones.includes(l.phone) ? "bg-primary/5" : ""}`}
                      >
                        <input type="checkbox" readOnly checked={selectedPhones.includes(l.phone)} className="size-3.5 accent-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{l.name || "Sem nome"}</p>
                          <p className="truncate text-[10px] text-muted-foreground">{formatPhone(l.phone)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <p className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
                {selectedPhones.length} / {filtered.length} selecionados
              </p>
            </div>

            {/* Composer */}
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">Mensagem de texto</label>
                <textarea
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={sending}
                  placeholder="Digite a mensagem que será enviada para os contatos selecionados…"
                  className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
              </div>

              {/* Upload de imagem */}
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">Imagem (opcional)</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    disabled={sending || uploading}
                    placeholder="Cole uma URL pública ou envie um arquivo →"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                  />
                  <input
                    ref={bcFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) await uploadBroadcastImage(file);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={sending || uploading}
                    onClick={() => bcFileInputRef.current?.click()}
                    className="shrink-0 gap-1.5"
                  >
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                    {uploading ? "Enviando…" : "Upload"}
                  </Button>
                </div>
                {imageUrl && (
                  <div className="relative mt-2 inline-block">
                    <img
                      src={imageUrl}
                      alt="preview"
                      className="max-h-28 rounded-lg object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                    <button
                      type="button"
                      onClick={() => setImageUrl("")}
                      disabled={sending || uploading}
                      className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black disabled:opacity-50"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                )}
              </div>

              <Button
                type="button"
                onClick={send}
                disabled={sending || uploading || !selectedPhones.length || (!text.trim() && !imageUrl)}
                className="w-full gap-2"
              >
                {sending
                  ? <><Loader2 className="size-4 animate-spin" /> Enviando…</>
                  : <><Send className="size-4" /> Enviar para {selectedPhones.length} contato(s)</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      )}

      {mode === "newchat" && (
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="size-4 text-primary" /> Nova conversa
            </DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar por nome ou telefone"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border p-1">
            {filtered.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onPick(l.phone, l.name)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-muted"
              >
                <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {(l.name || l.phone).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium">{l.name || "Sem nome"}</p>
                  <p className="text-xs text-muted-foreground">{formatPhone(l.phone)}</p>
                </div>
              </button>
            ))}
            {!filtered.length && (
              <p className="p-4 text-center text-xs text-muted-foreground">Nenhum lead encontrado</p>
            )}
          </div>
          <div className="border-t pt-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Ou iniciar com um número novo:</p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Nome (opcional)" value={manualName} onChange={(e) => setManualName(e.target.value)} />
              <Input
                placeholder="55 11 9 9999-9999"
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
              />
            </div>
            <Button
              type="button"
              className="mt-2 w-full"
              disabled={!manualPhone.trim()}
              onClick={() => onPick(manualPhone.replace(/\D/g, ""), manualName || null)}
            >
              Iniciar conversa
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

type QuickReply = {
  id: string;
  title: string;
  body: string;
  sort_order: number;
  image_url: string | null;
};

function ActiveOrdersPanel({ orders, deliveryMinutes, now, onUpdateStatus, onCancelOrder, onOpenOrder, onOpenChat, unreadPhones, conversations, orderItemsByOrder, searchQuery, selectedPhone, currentOperator }: {
  orders: ActiveOrder[]; deliveryMinutes: number; now: number;
  onUpdateStatus: (id: string, status: "ready_pickup" | "out_for_delivery") => void;
  onCancelOrder: (id: string) => void; onOpenOrder: (id: string) => void;
  onOpenChat: (order: ActiveOrder) => void; unreadPhones: Set<string>;
  conversations: Conversation[]; orderItemsByOrder: Record<string, any[]>; searchQuery: string;
  selectedPhone: string; currentOperator: { id: string; email: string | null } | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sendingArrivalId, setSendingArrivalId] = useState<string | null>(null);
  const conversationByPhone = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const c of conversations) map.set(String(c.phone || "").replace(/\D/g, ""), c);
    return map;
  }, [conversations]);

  const timerFor = (createdAt: string) => {
    const remaining = deliveryMinutes * 60 - Math.floor((now - new Date(createdAt).getTime()) / 1000);
    const late = remaining < 0;
    const abs = Math.abs(remaining);
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const sec = abs % 60;
    return { late, remaining, near: !late && remaining <= 10 * 60, text: `${late ? "-" : ""}${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}` };
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleOrders = useMemo(() => {
    const filtered = !normalizedQuery ? orders : orders.filter((order) => {
      const haystack = [
        order.customer_name, order.customer_phone, order.external_display_id, order.order_number,
        order.address_street, order.address_number, order.address_neighborhood, order.address_city,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalizedQuery) || String(order.customer_phone || "").replace(/\D/g, "").includes(normalizedQuery.replace(/\D/g, ""));
    });
    return [...filtered].sort((a, b) => {
      const pa = String(a.customer_phone || "").replace(/\D/g, "");
      const pb = String(b.customer_phone || "").replace(/\D/g, "");
      const ta = timerFor(a.created_at); const tb = timerFor(b.created_at);
      const score = (o: ActiveOrder, phone: string, t: ReturnType<typeof timerFor>) =>
        (unreadPhones.has(phone) ? 1000 : 0) + (t.late ? 700 : 0) + (t.near ? 400 : 0) + (o.status === "pending_review" ? 300 : 0) + (phone === selectedPhone ? 200 : 0);
      const diff = score(b, pb, tb) - score(a, pa, ta);
      return diff || new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [orders, normalizedQuery, unreadPhones, selectedPhone, now, deliveryMinutes]);

  const attention = visibleOrders.filter((o) => {
    const phone = String(o.customer_phone || "").replace(/\D/g, "");
    const t = timerFor(o.created_at);
    return unreadPhones.has(phone) || t.late || t.near || o.status === "pending_review";
  });

  const copyText = async (value: string, label: string) => {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); toast.success(`${label} copiado`); }
    catch { toast.error(`Não foi possível copiar ${label.toLowerCase()}.`); }
  };

  const sendArrival = async (order: ActiveOrder) => {
    if (sendingArrivalId) return;
    setSendingArrivalId(order.id);
    try {
      const result = await sendOrderArrivalNoticeFn({ data: { orderId: order.id } });
      if (!result.ok) throw new Error(result.error || "Não foi possível avisar o cliente.");
      toast.success("Cliente avisado pelo WhatsApp");
    } catch (err: any) { toast.error(err?.message ?? "Falha ao avisar o cliente"); }
    finally { setSendingArrivalId(null); }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-3">
      {attention.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-extrabold text-amber-900"><AlertTriangle className="size-3.5" /> Precisa de atenção</p>
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-extrabold text-amber-900">{attention.length}</span>
          </div>
          <div className="space-y-1">
            {attention.slice(0, 4).map((order) => {
              const phone = String(order.customer_phone || "").replace(/\D/g, "");
              const t = timerFor(order.created_at);
              const reason = unreadPhones.has(phone) ? "Nova mensagem" : t.late ? `Atrasado ${t.text}` : t.near ? `Prazo próximo · ${t.text}` : "Aguardando revisão";
              return <button key={order.id} type="button" onClick={() => onOpenChat(order)} className="flex w-full items-center justify-between rounded-lg bg-white/70 px-2 py-1.5 text-left text-[11px] hover:bg-white"><span className="truncate font-semibold">{order.customer_name || formatPhone(order.customer_phone)}</span><span className="ml-2 shrink-0 text-amber-800">{reason}</span></button>;
            })}
          </div>
        </div>
      )}

      {!visibleOrders.length ? (
        <div className="flex flex-col items-center gap-2 p-6 text-center text-xs text-muted-foreground">
          <Package className="size-8 opacity-40" /> {orders.length ? "Nenhum pedido corresponde à busca." : "Nenhum pedido em andamento."}
        </div>
      ) : visibleOrders.map((order) => {
        const timer = timerFor(order.created_at);
        const phoneKey = String(order.customer_phone || "").replace(/\D/g, "");
        const conv = conversationByPhone.get(phoneKey);
        const hasUnread = unreadPhones.has(phoneKey);
        const isSelected = selectedPhone === phoneKey;
        const fullAddress = [order.address_street, order.address_number, order.address_complement, order.address_neighborhood, order.address_city].filter(Boolean).join(", ");
        const mapUrl = fullAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}` : null;
        const items = orderItemsByOrder[order.id] ?? [];
        const isExpanded = expandedId === order.id;
        const operatorLabel = order.assigned_operator_email || (isSelected && currentOperator?.email) || null;
        return (
          <div key={order.id} className={`mb-2 rounded-xl border bg-card p-3 shadow-sm transition ${hasUnread ? "order-card-unread border-emerald-500" : timer.late ? "border-red-400" : timer.near ? "border-amber-400" : isSelected ? "border-blue-400 ring-1 ring-blue-200" : "border-border/60"}`}>
            {order.loyalty_reward_used && (
              <div className="-mx-3 -mt-3 mb-3 flex items-center justify-center gap-1.5 rounded-t-xl bg-emerald-600 px-2 py-2 text-center text-[11px] font-black uppercase tracking-wide text-white">
                <Gift className="size-4" /> CLIENTE FIEL — TEM DIREITO A UMA BATATA GRÁTIS
              </div>
            )}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold">{order.customer_name || formatPhone(order.customer_phone)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">{orderDisplayRef(order)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${order.status === "out_for_delivery" ? "bg-blue-100 text-blue-700" : order.status === "ready_pickup" ? "bg-emerald-100 text-emerald-700" : order.status === "preparing" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{ORDER_STATUS_LABEL[order.status] || order.status}</span>
                </div>
              </div>
              <div className="flex items-start gap-1">
                <span className={`shrink-0 rounded-full px-2 py-1 font-mono text-xs font-extrabold ${timer.late ? "bg-red-100 text-red-700" : timer.near ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>{timer.text}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="size-7"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onOpenOrder(order.id)}><Eye className="mr-2 size-4" /> Ver / editar pedido</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onOpenChat(order)}><MessageCircle className="mr-2 size-4" /> Abrir chat</DropdownMenuItem>
                    <DropdownMenuItem disabled={!mapUrl} onClick={() => mapUrl && window.open(mapUrl, "_blank", "noopener,noreferrer")}><Navigation className="mr-2 size-4" /> Abrir mapa</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => copyText(fullAddress, "Endereço")} disabled={!fullAddress}><Copy className="mr-2 size-4" /> Copiar endereço</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => copyText(String(order.customer_phone || ""), "Telefone")}><Copy className="mr-2 size-4" /> Copiar telefone</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onCancelOrder(order.id)}><X className="mr-2 size-4" /> Cancelar pedido</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {operatorLabel && <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><UserRoundCheck className="size-3" /> Atendimento por {operatorLabel}</p>}

            {hasUnread && (
              <button type="button" onClick={() => onOpenChat(order)} className="mt-2 block w-full rounded-lg bg-emerald-50 px-2.5 py-2 text-left hover:bg-emerald-100">
                <span className="flex items-center gap-1.5 text-[11px] font-extrabold text-emerald-700"><MessageCircle className="size-3.5" /> Nova mensagem {conv?.last_message_at ? `· ${formatDateTime(conv.last_message_at)}` : ""}</span>
                {conv?.last_message_preview && <span className="mt-0.5 block truncate text-[11px] text-emerald-800/80">“{conv.last_message_preview}”</span>}
              </button>
            )}

            {(order.address_street || order.address_neighborhood) && <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{fullAddress}</p>}
            <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px]">
              <span>{order.payment_method ? `Pagamento: ${order.payment_method === "pix" ? "Pix" : order.payment_method === "card" ? "Cartão" : order.payment_method}` : "Pagamento não informado"}</span>
              <strong>{order.total != null ? `R$ ${Number(order.total).toFixed(2).replace(".", ",")}` : "—"}</strong>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {!["ready_pickup", "out_for_delivery"].includes(order.status) && <Button size="sm" variant="outline" className="h-8 border-emerald-300 text-[11px] font-bold text-emerald-700" onClick={() => onUpdateStatus(order.id, "ready_pickup")}>Pronto</Button>}
              {order.status === "ready_pickup" && <Button size="sm" variant="outline" className="h-8 border-blue-300 text-[11px] font-bold text-blue-700" onClick={() => onUpdateStatus(order.id, "out_for_delivery")}>Saiu para entrega</Button>}
              {order.status === "out_for_delivery" && <Button size="sm" variant="outline" className="h-8 border-amber-300 bg-amber-50 text-[11px] font-bold text-amber-800" onClick={() => sendArrival(order)} disabled={sendingArrivalId === order.id}><MessageCircle className="mr-1 size-3.5" /> {sendingArrivalId === order.id ? "Avisando..." : "Avisar que chegou"}</Button>}
              <Button size="sm" variant="outline" className="h-8 text-[11px] font-bold" onClick={() => onOpenChat(order)}><MessageCircle className="mr-1 size-3.5" /> Chat</Button>
              <Button size="sm" variant="outline" className="h-8 border-sky-300 text-[11px] font-bold text-sky-700" disabled={!mapUrl} onClick={() => mapUrl && window.open(mapUrl, "_blank", "noopener,noreferrer")}><MapPin className="mr-1 size-3.5" /> Mapa</Button>
            </div>

            <button type="button" onClick={() => setExpandedId(isExpanded ? null : order.id)} className="mt-2 flex w-full items-center justify-center gap-1 rounded-md py-1 text-[10px] font-bold text-muted-foreground hover:bg-muted/60">
              {isExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />} {isExpanded ? "Ocultar resumo" : "Resumo rápido"}
            </button>
            {isExpanded && (
              <div className="mt-1 rounded-lg border bg-background p-2 text-[11px]">
                <p className="mb-1 font-bold">Itens</p>
                {items.length ? items.map((item: any) => <div key={item.id} className="flex justify-between gap-2"><span className="truncate">{item.quantity}x {item.product_name}</span><span className="shrink-0">R$ {(Number(item.quantity) * Number(item.unit_price)).toFixed(2).replace(".", ",")}</span></div>) : <p className="text-muted-foreground">Itens não carregados.</p>}
                <div className="mt-2 border-t pt-1"><strong>Total: R$ {Number(order.total || 0).toFixed(2).replace(".", ",")}</strong></div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuickRepliesPanel({
  disabled,
  onPick,
  embedded = false,
}: {
  disabled: boolean;
  embedded?: boolean;
  onPick: (qr: { title: string; body: string; image_url: string | null }) => void;
}) {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [creating, setCreating] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formImageUrl, setFormImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<QuickReply | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    const { data } = await supabase
      .from("quick_replies")
      .select("id,title,body,sort_order,image_url")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    setItems((data as QuickReply[]) ?? []);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("quick-replies")
      .on("postgres_changes", { event: "*", schema: "public", table: "quick_replies" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  function openCreate() {
    setEditing(null);
    setFormTitle("");
    setFormBody("");
    setFormImageUrl(null);
    setCreating(true);
  }

  function openEdit(qr: QuickReply) {
    setEditing(qr);
    setFormTitle(qr.title);
    setFormBody(qr.body);
    setFormImageUrl(qr.image_url ?? null);
    setCreating(true);
  }

  async function uploadQuickReplyImage(file: File) {
    setUploadingImage(true);
    try {
      const path = `quick-replies/${Date.now()}-${sanitizeStorageKey(file.name)}`;
      const { error: upErr } = await supabase.storage.from("chat-media").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("chat-media").getPublicUrl(path);
      setFormImageUrl(pub.publicUrl);
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao enviar imagem");
    } finally {
      setUploadingImage(false);
    }
  }

  async function save() {
    if (!formTitle.trim() || !formBody.trim()) {
      toast.error("Título e mensagem são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from("quick_replies")
          .update({ title: formTitle.trim(), body: formBody.trim(), image_url: formImageUrl })
          .eq("id", editing.id);
        if (error) throw error;
        toast.success("Resposta atualizada");
      } else {
        const { error } = await supabase.from("quick_replies").insert({
          title: formTitle.trim(),
          body: formBody.trim(),
          image_url: formImageUrl,
          sort_order: items.length,
        });
        if (error) throw error;
        toast.success("Resposta criada");
      }
      setCreating(false);
      setEditing(null);
      await load();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function remove(qr: QuickReply) {
    const { error } = await supabase.from("quick_replies").delete().eq("id", qr.id);
    setConfirmDelete(null);
    if (error) return toast.error(error.message);
    toast.success("Resposta excluída");
    await load();
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col bg-muted/20 ${embedded ? "" : "w-72 shrink-0 border-l"}`}>
      <div className="border-b bg-card p-3 shadow-sm">
        <h2 className="mb-2 flex items-center gap-2 font-bold text-foreground">
          <Zap className="size-4 text-primary" /> Respostas rápidas
        </h2>
        <Button size="sm" variant="outline" className="h-8 w-full gap-1 rounded-full text-xs" onClick={openCreate}>
          <Plus className="size-3.5" /> Nova resposta
        </Button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {!items.length ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <Zap className="size-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              Nenhuma resposta cadastrada. Crie mensagens prontas para enviar com 1 clique.
            </p>
          </div>
        ) : (
          items.map((qr) => (
            <div key={qr.id} className="group rounded-xl border bg-card p-2.5 shadow-sm transition hover:shadow-md">
              <div className="mb-1 flex items-start justify-between gap-1">
                <p className="line-clamp-1 flex-1 text-xs font-bold text-foreground">{qr.title}</p>
                <div className="flex shrink-0 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => openEdit(qr)}
                    className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Editar"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(qr)}
                    className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="Excluir"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
              {qr.image_url && (
                <img src={qr.image_url} alt="" className="mb-2 h-20 w-full rounded-lg border object-cover" />
              )}
              <p className="mb-2 line-clamp-3 whitespace-pre-wrap text-[11px] text-muted-foreground">{qr.body}</p>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 w-full gap-1 rounded-full text-[11px]"
                disabled={disabled}
                onClick={() => onPick({ title: qr.title, body: qr.body, image_url: qr.image_url })}
                title={disabled ? "Selecione uma conversa primeiro" : "Enviar essa resposta"}
              >
                <Send className="size-3" /> Enviar
              </Button>
            </div>
          ))
        )}
      </div>

      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar resposta rápida" : "Nova resposta rápida"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold">Título</label>
              <Input
                placeholder="Ex.: Saudação"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                maxLength={60}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Mensagem</label>
              <Textarea
                rows={5}
                placeholder="Digite a mensagem que será enviada..."
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Imagem (opcional)</label>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) await uploadQuickReplyImage(f);
                }}
              />
              {formImageUrl ? (
                <div className="relative w-fit">
                  <img src={formImageUrl} alt="" className="h-28 rounded-lg border object-cover" />
                  <button
                    type="button"
                    onClick={() => setFormImageUrl(null)}
                    className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-destructive text-destructive-foreground shadow"
                    title="Remover imagem"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1 rounded-full text-xs"
                  disabled={uploadingImage}
                  onClick={() => imageInputRef.current?.click()}
                >
                  <Paperclip className="size-3.5" />
                  {uploadingImage ? "Enviando..." : "Anexar imagem"}
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving || uploadingImage}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir resposta rápida?</AlertDialogTitle>
            <AlertDialogDescription>
              A resposta <span className="font-semibold">{confirmDelete?.title}</span> será removida da lista.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && remove(confirmDelete)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
