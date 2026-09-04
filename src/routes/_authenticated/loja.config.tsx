import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Save,
  Upload,
  Volume2,
  Zap,
  Plus,
  Trash2,
  AlertTriangle,
  RefreshCw,
  FlaskConical,
  CheckCircle2,
  Bell,
  ScrollText,
  Info,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { geocodeStoreAddressFn } from "@/lib/geocode.functions";
import { wipeDataFn, type WipeCategory } from "@/lib/wipe-data.functions";
import { runPaymentDiagnosticsFn } from "@/lib/payment-diagnostics.functions";
import { testAlertFn } from "@/lib/test-alert.functions";
import { usePopulateZonas } from "@/lib/use-populate-zonas";
import wallpaperTeal from "@/assets/wallpapers/wallpaper-teal.jpg";
import wallpaperBeige from "@/assets/wallpapers/wallpaper-beige.jpg";

const WIPE_OPTIONS: { value: WipeCategory; label: string }[] = [
  { value: "pedidos", label: "Pedidos ativos e itens" },
  { value: "historico", label: "Histórico (entregues, cancelados, com falha)" },
  { value: "leads", label: "Leads" },
  { value: "insumos", label: "Insumos (ficha técnica)" },
  { value: "produtos", label: "Produtos (cardápio)" },
  { value: "entregadores", label: "Entregadores" },
  { value: "chat", label: "Conversas do chat" },
];

/** Mesmo componente de dica usado em loja.zonas-entrega.tsx e
 *  loja.precificacao.tsx — ícone "?" que explica o termo em palavras simples. */
function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="align-middle text-muted-foreground/70 hover:text-foreground" tabIndex={-1}>
            <Info className="inline size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-xs leading-relaxed">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const Route = createFileRoute("/_authenticated/loja/config")({
  component: ConfigPage,
});

function ConfigPage() {
  const [c, setC] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [uploadingAdmin, setUploadingAdmin] = useState(false);
  const [wipeSelected, setWipeSelected] = useState<WipeCategory[]>([]);
  const [wipeConfirmText, setWipeConfirmText] = useState("");
  const [wiping, setWiping] = useState(false);
  const [ifoodMap, setIfoodMap] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("geral");

  useEffect(() => {
    supabase
      .from("ifood_product_map")
      .select("*")
      .order("ifood_item_name")
      .then(({ data }) => setIfoodMap(data ?? []));
    supabase
      .from("products")
      .select("id,name")
      .order("name")
      .then(({ data }) => setProducts(data ?? []));
  }, []);

  async function updateIfoodMap(ifoodItemId: string, productId: string | null) {
    const { error } = await supabase
      .from("ifood_product_map")
      .update({ product_id: productId })
      .eq("ifood_item_id", ifoodItemId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setIfoodMap((prev) => prev.map((r) => (r.ifood_item_id === ifoodItemId ? { ...r, product_id: productId } : r)));
    toast.success("Vínculo atualizado");
  }

  async function rescheduleIfoodPolling() {
    await save();
    const { error } = await supabase.rpc("reschedule_ifood_polling");
    if (error) toast.error("Falha ao (re)agendar: " + error.message);
    else toast.success(c.ifood_polling_enabled ? "Polling ativado!" : "Polling desativado.");
  }

  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [diagnosticsResults, setDiagnosticsResults] = useState<{ name: string; ok: boolean; detail?: string }[] | null>(
    null,
  );
  const [testingAlert, setTestingAlert] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  async function changePassword() {
    if (newPassword.length < 6) return toast.error("A senha precisa ter pelo menos 6 caracteres");
    if (newPassword !== confirmPassword) return toast.error("As senhas não coincidem");
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Senha alterada com sucesso!");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao trocar senha");
    } finally {
      setChangingPassword(false);
    }
  }

  async function testAlert() {
    setTestingAlert(true);
    try {
      const res = await testAlertFn();
      if (!res.ok) throw new Error(res.error);
      toast.success("Alerta de teste enviado! Confere seu WhatsApp em alguns segundos.");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao testar alerta");
    } finally {
      setTestingAlert(false);
    }
  }

  async function runDiagnostics() {
    setDiagnosticsRunning(true);
    setDiagnosticsResults(null);
    try {
      const res = await runPaymentDiagnosticsFn();
      setDiagnosticsResults(res.results);
      const failed = res.results.filter((r) => !r.ok).length;
      if (failed) toast.error(`${failed} cenário(s) falharam — confira abaixo`);
      else toast.success("Todos os cenários de pagamento passaram!");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao rodar diagnóstico");
    } finally {
      setDiagnosticsRunning(false);
    }
  }

  function toggleWipe(v: WipeCategory) {
    setWipeSelected((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  async function runWipe() {
    if (wipeConfirmText !== "APAGAR" || !wipeSelected.length) return;
    if (
      !window.confirm(`Tem certeza? Isso vai apagar permanentemente: ${wipeSelected.join(", ")}. Não dá pra desfazer.`)
    )
      return;
    setWiping(true);
    try {
      const res = await wipeDataFn({ data: { categories: wipeSelected } });
      if (!res.ok) throw new Error(res.error);
      toast.success("Dados apagados com sucesso!");
      setWipeSelected([]);
      setWipeConfirmText("");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao apagar dados");
    } finally {
      setWiping(false);
    }
  }

  const [uploadingDeliverer, setUploadingDeliverer] = useState(false);
  const [uploadingHandoff, setUploadingHandoff] = useState(false);
  const adminFileRef = useRef<HTMLInputElement | null>(null);
  const handoffFileRef = useRef<HTMLInputElement | null>(null);
  const bannerFileRef = useRef<HTMLInputElement | null>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  async function uploadBanner(file: File) {
    setUploadingBanner(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `banner-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
      setC((prev: any) => ({ ...prev, banner_image_url: pub.publicUrl }));
      toast.success("Banner enviado!");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao enviar banner");
    } finally {
      setUploadingBanner(false);
    }
  }
  const delivererFileRef = useRef<HTMLInputElement | null>(null);
  const [geocodingStore, setGeocodingStore] = useState(false);
  const populateZonas = usePopulateZonas();

  async function geocodeStore() {
    if (!c.store_address?.trim()) {
      toast.error("Preencha o endereço da loja primeiro");
      return;
    }
    setGeocodingStore(true);
    try {
      const res = await geocodeStoreAddressFn({
        data: { address: c.store_address, googleMapsApiKey: c.google_maps_api_key },
      });
      if ("error" in res && res.error) throw new Error(res.error);
      setC({ ...c, store_lat: res.lat, store_lng: res.lng });
      toast.success("Coordenadas encontradas!");

      // Salva as coordenadas já de cara (sem esperar o botão "Salvar" geral)
      // porque a varredura de ruas abaixo lê store_lat/store_lng direto do
      // banco — se não salvar antes, ela buscaria a coordenada antiga (ou
      // nenhuma, na primeira vez).
      await supabase.from("store_config").update({ store_lat: res.lat, store_lng: res.lng }).eq("id", 1);

      // Dispara a varredura automática de ruas ao redor do novo endereço.
      // Roda em segundo plano (com toasts de progresso) — não trava a tela.
      populateZonas.run();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao buscar coordenadas");
    } finally {
      setGeocodingStore(false);
    }
  }

  function addTier() {
    const tiers = c.delivery_fee_tiers || [];
    const last = tiers[tiers.length - 1];
    setC({
      ...c,
      delivery_fee_tiers: [...tiers, { km_from: last ? last.km_to : 0, km_to: (last ? last.km_to : 0) + 3, fee: 0 }],
    });
  }
  function updateTier(idx: number, field: "km_from" | "km_to" | "fee", value: string) {
    const tiers = [...(c.delivery_fee_tiers || [])];
    tiers[idx] = { ...tiers[idx], [field]: Number(value) };
    setC({ ...c, delivery_fee_tiers: tiers });
  }
  function removeTier(idx: number) {
    setC({
      ...c,
      delivery_fee_tiers: (c.delivery_fee_tiers || []).filter((_: any, i: number) => i !== idx),
    });
  }

  useEffect(() => {
    supabase
      .from("store_config")
      .select("*")
      .maybeSingle()
      .then(({ data }) => setC(data ?? { id: 1, pix_mode: "static" }));
  }, []);



  async function save() {
    const provider = c.digital_payment_provider === "mercadopago" ? "mercadopago" : "infinitepay";
    if (provider === "mercadopago") {
      if (c.mercadopago_enabled !== true) return toast.error("Ative o Mercado Pago antes de defini-lo como provedor principal.");
      if (!String(c.mercadopago_public_key || "").trim()) return toast.error("Informe a Public Key do Mercado Pago.");
      if (!String(c.mercadopago_access_token || "").trim()) return toast.error("Informe o Access Token do Mercado Pago.");
    } else {
      if (c.infinitepay_enabled !== true) return toast.error("Ative a InfinitePay antes de defini-la como provedor principal.");
      if (!String(c.infinitepay_handle || "").trim()) return toast.error("Informe a InfiniteTag / Handle da InfinitePay.");
    }

    setSaving(true);
    const payload = stripCardOwnedFields({
      ...c,
      id: 1,
      digital_payment_provider: provider,
      mercadopago_max_installments: Math.min(12, Math.max(1, Number(c.mercadopago_max_installments || 1))),
      default_delivery_fee: Number(c.default_delivery_fee || 0),
      delivery_cost_per_km: Number(c.delivery_cost_per_km ?? 0.9),
    });
    const { error } = await supabase.from("store_config").upsert(payload);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success(`Configurações salvas. ${provider === "mercadopago" ? "Mercado Pago" : "InfinitePay"} está ativo para novos checkouts.`);
  }


  async function uploadAlarm(
    file: File,
    target: "alarm_sound_url" | "deliverer_alarm_sound_url" | "handoff_alarm_sound_url",
  ) {
    const setUploading =
      target === "alarm_sound_url" ? setUploadingAdmin : target === "deliverer_alarm_sound_url" ? setUploadingDeliverer : setUploadingHandoff;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "mp3";
      const path = `${target}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("alarm-sounds").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("alarm-sounds").getPublicUrl(path);
      const payload = stripCardOwnedFields({
        ...c,
        id: 1,
        [target]: pub.publicUrl,
        default_delivery_fee: Number(c.default_delivery_fee || 0),
      });
      const { error } = await supabase.from("store_config").upsert(payload);

      if (error) throw error;
      setC(payload);
      toast.success("Som de alarme enviado e salvo");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao enviar o áudio");
    } finally {
      setUploading(false);
    }
  }

  const CONFIG_TABS = [
    { key: "geral", label: "Geral" },
    { key: "entrega", label: "Entrega" },
    { key: "pagamentos", label: "Pagamentos" },
    { key: "integracoes", label: "Integrações" },
    { key: "ia", label: "IA & Atendimento" },
    { key: "atendimento", label: "Horário de atendimento" },
    { key: "notificacoes", label: "Notificações" },
    { key: "sistema", label: "Sistema" },
  ];
  /** Mantém o card montado (sem perder o que já foi digitado) e só esconde
   *  visualmente quando a aba não é a ativa — mais simples e seguro do que
   *  mover os blocos de código de lugar. */
  function tabStyle(key: string) {
    return activeTab === key ? {} : { display: "none" as const };
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Configurações da loja</h1>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
          {CONFIG_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="rounded-full border data-[state=active]:shadow-sm">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="space-y-3 p-5" style={tabStyle("geral")}>
        <h2 className="font-semibold">Loja</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Nome da loja</Label>
            <Input value={c.store_name || ""} onChange={(e) => setC({ ...c, store_name: e.target.value })} />
          </div>
          <div>
            <Label>E-mail de contato (política de privacidade)</Label>
            <Input
              type="email"
              value={c.privacy_contact_email || ""}
              onChange={(e) => setC({ ...c, privacy_contact_email: e.target.value })}
              placeholder="opcional — se vazio, mostra só o WhatsApp"
            />
          </div>
          <div>
            <Label>Taxa de entrega padrão (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={c.default_delivery_fee ?? 0}
              onChange={(e) => setC({ ...c, default_delivery_fee: e.target.value })}
            />
          </div>
          <div>
            <Label>Tempo estimado de entrega (minutos)</Label>
            <Input
              type="number"
              step="1"
              value={c.estimated_delivery_time_minutes ?? ""}
              onChange={(e) =>
                setC({
                  ...c,
                  estimated_delivery_time_minutes: e.target.value ? Number(e.target.value) : null,
                })
              }
              placeholder="Ex: 40"
            />
          </div>
          <div>
            <Label>Cidade das entregas</Label>
            <Input
              value={c.fixed_delivery_city || ""}
              onChange={(e) => setC({ ...c, fixed_delivery_city: e.target.value })}
              placeholder="Ex: Duque de Caxias"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Como só entrega nessa cidade, a IA não pergunta isso ao cliente — já preenche sozinha.
            </p>
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("geral")}>
        <h2 className="font-semibold">Banner da loja (topo do site do cliente)</h2>
        <div>
          <Label>Imagem do banner</Label>
          <div className="flex gap-2">
            <Input
              className="flex-1"
              value={c.banner_image_url || ""}
              onChange={(e) => setC({ ...c, banner_image_url: e.target.value })}
              placeholder="Cole uma URL ou envie um arquivo →"
            />
            <input
              ref={bannerFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadBanner(f);
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => bannerFileRef.current?.click()}
              disabled={uploadingBanner}
            >
              <Upload className="size-4" /> {uploadingBanner ? "Enviando..." : "Upload"}
            </Button>
          </div>
          {c.banner_image_url && (
            <img
              src={c.banner_image_url}
              alt="Prévia do banner"
              className="mt-2 h-28 w-full rounded-lg border object-cover"
            />
          )}
          <p className="mt-1 text-xs text-muted-foreground">Se deixar em branco, usa o degradê padrão da marca.</p>
        </div>
        <div>
          <Label>Texto abaixo do título (opcional)</Label>
          <Input
            value={c.banner_tagline || ""}
            onChange={(e) => setC({ ...c, banner_tagline: e.target.value })}
            placeholder="Ex: Batatas recheadas, hambúrgueres artesanais..."
          />
        </div>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("entrega")}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Frete por distância (km)</h2>
          <div className="flex items-center gap-2">
            <Switch
              checked={c.delivery_pricing_mode === "distance"}
              onCheckedChange={(v) => setC({ ...c, delivery_pricing_mode: v ? "distance" : "flat" })}
            />
            <span className="text-xs text-muted-foreground">
              {c.delivery_pricing_mode === "distance" ? "Ativo" : "Desativado"}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Quando ativado, a IA calcula sozinha a distância até o cliente assim que ele passa o endereço, e cobra a faixa
          de km correspondente — em vez da taxa fixa acima. Se o endereço não puder ser localizado, ou estiver fora de
          todas as faixas, a taxa fixa é usada como reserva.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Endereço da loja (ponto de partida)</Label>
            <div className="flex gap-2">
              <Input
                value={c.store_address || ""}
                onChange={(e) => setC({ ...c, store_address: e.target.value })}
                placeholder="Rua, número, bairro, cidade"
              />
              <Button type="button" variant="outline" size="sm" disabled={geocodingStore} onClick={geocodeStore}>
                {geocodingStore ? "Buscando..." : "Buscar coordenadas"}
              </Button>
            </div>
            {c.store_lat && c.store_lng && (
              <p className="mt-1 text-xs text-muted-foreground">
                📍 Coordenadas: {Number(c.store_lat).toFixed(5)}, {Number(c.store_lng).toFixed(5)}
              </p>
            )}
            {populateZonas.running && (
              <p className="mt-1 text-xs text-muted-foreground">
                🔎 Varrendo as ruas da região
                {populateZonas.progress
                  ? ` (${populateZonas.progress.processed}/${populateZonas.progress.total})`
                  : "..."}{" "}
                — pode levar alguns minutos, você pode continuar navegando.
              </p>
            )}
          </div>
          <div>
            <Label>Chave da API do Google Maps (opcional)</Label>
            <Input
              type="password"
              value={c.google_maps_api_key || ""}
              onChange={(e) => setC({ ...c, google_maps_api_key: e.target.value })}
              placeholder="AIza..."
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Sem chave, o sistema usa um serviço gratuito (OpenStreetMap) — funciona, mas é mais lento e menos preciso.
            </p>
          </div>
          <div>
            <Label>
              Custo por km rodado (R$){" "}
              <InfoTip text="Digite o custo de 1 km rodado (o que você paga ao entregador por km, ou o gasto de combustível do seu carro por km). NÃO precisa dobrar pra ida e volta aqui — o sistema já faz isso sozinho em todo lugar que mostra custo/margem (popup de aprovação e tela de Zonas de entrega)." />
            </Label>
            <Input
              type="number"
              step="0.01"
              value={c.delivery_cost_per_km ?? 0.9}
              onChange={(e) => setC({ ...c, delivery_cost_per_km: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Valor de 1 km rodado (o que você paga ao entregador por km, ou o custo de combustível do seu carro por
              km). Usado pra calcular o custo real de cada entrega e a margem em Zonas de entrega — o sistema já soma
              ida e volta sozinho, não precisa dobrar esse número aqui.
            </p>
          </div>

          <div className="rounded-lg border border-dashed p-3 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">
              Prefere calcular pelo gasto de combustível em vez de digitar um valor fixo?{" "}
              <InfoTip text="O sistema calcula o custo de 1 km rodado (preço do litro ÷ consumo do carro). A ida e volta é somada automaticamente depois, em todo lugar que mostra custo — não precisa fazer essa conta aqui." />
            </Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Preço do litro (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={c.combustivel_preco_litro ?? ""}
                  onChange={(e) => setC({ ...c, combustivel_preco_litro: e.target.value })}
                  placeholder="6,50"
                />
              </div>
              <div>
                <Label className="text-xs">Consumo do veículo (km por litro)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={c.veiculo_consumo_kml ?? ""}
                  onChange={(e) => setC({ ...c, veiculo_consumo_kml: e.target.value })}
                  placeholder="8,9"
                />
              </div>
            </div>
            {Number(c.combustivel_preco_litro) > 0 && Number(c.veiculo_consumo_kml) > 0 ? (
              (() => {
                // Aqui é só o custo de 1 km rodado (preço do litro ÷ consumo).
                // NÃO dobra pra ida e volta aqui — quem faz essa conta agora é
                // o próprio sistema, em todo lugar que mostra custo/margem, pra
                // nunca depender de alguém lembrar de dobrar manualmente.
                const custoPorKmRodado = Number(c.combustivel_preco_litro) / Number(c.veiculo_consumo_kml);
                return (
                  <div className="mt-2 flex items-center justify-between rounded-md bg-muted px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      Custo por km rodado:{" "}
                      <span className="font-semibold text-foreground">
                        R$ {custoPorKmRodado.toLocaleString("pt-BR", { minimumFractionDigits: 4 })}
                      </span>
                      <br />
                      <span className="text-[11px]">
                        (o sistema já calcula ida e volta sozinho ao usar esse valor — não precisa fazer essa conta você
                        mesmo)
                      </span>
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setC({ ...c, delivery_cost_per_km: custoPorKmRodado.toFixed(4) })}
                    >
                      Usar esse valor
                    </Button>
                  </div>
                );
              })()
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Preencha os dois campos acima pra calcular o custo por km automaticamente. O sistema já soma a volta
                sozinho depois — aqui é só o valor de 1 km.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-800">Faixas de km e valor mudaram de lugar</p>
          <p className="mt-1 text-xs text-amber-700">
            Pra evitar ter dois lugares diferentes controlando a mesma coisa, as faixas de distância e valor agora só
            são configuradas na página <b>Zonas de entrega</b> — é lá também que você vê a margem de cada faixa em tempo
            real.
          </p>
          <Button asChild type="button" size="sm" variant="outline" className="mt-2">
            <Link to="/loja/zonas-entrega">Ir para Zonas de entrega</Link>
          </Button>
        </div>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("notificacoes")}>
        <h2 className="font-semibold">Som de alarme</h2>
        <p className="text-xs text-muted-foreground">
          Envie um arquivo .mp3. Por padrão o alarme já vem <b>ativado</b> tanto no painel quanto no app do entregador —
          toca sozinho enquanto houver pedidos aguardando. Dá pra desativar aqui ou clicando no sininho na tela.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <Label>Alarme do painel (admin)</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={c.admin_alarm_default_on ?? true}
                  onCheckedChange={(v) => setC({ ...c, admin_alarm_default_on: v })}
                />
                <span className="text-xs text-muted-foreground">
                  {(c.admin_alarm_default_on ?? true) ? "Ativado" : "Desativado"}
                </span>
              </div>
            </div>
            <input
              ref={adminFileRef}
              type="file"
              accept="audio/mpeg,audio/mp3,.mp3"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAlarm(f, "alarm_sound_url");
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => adminFileRef.current?.click()}
              disabled={uploadingAdmin}
            >
              <Upload className="size-4" /> {uploadingAdmin ? "Enviando..." : "Enviar .mp3"}
            </Button>
            {c.alarm_sound_url && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Volume2 className="size-3.5" /> <audio src={c.alarm_sound_url} controls className="h-8 w-full" />
              </div>
            )}
          </div>
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <Label>Alarme do app do entregador</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={c.deliverer_alarm_default_on ?? true}
                  onCheckedChange={(v) => setC({ ...c, deliverer_alarm_default_on: v })}
                />
                <span className="text-xs text-muted-foreground">
                  {(c.deliverer_alarm_default_on ?? true) ? "Ativado" : "Desativado"}
                </span>
              </div>
            </div>
            <input
              ref={delivererFileRef}
              type="file"
              accept="audio/mpeg,audio/mp3,.mp3"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAlarm(f, "deliverer_alarm_sound_url");
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => delivererFileRef.current?.click()}
              disabled={uploadingDeliverer}
            >
              <Upload className="size-4" /> {uploadingDeliverer ? "Enviando..." : "Enviar .mp3"}
            </Button>
            {c.deliverer_alarm_sound_url && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Volume2 className="size-3.5" />{" "}
                <audio src={c.deliverer_alarm_sound_url} controls className="h-8 w-full" />
              </div>
            )}
          </div>
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <Label>IA pediu atendimento humano</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={c.handoff_alarm_default_on ?? true}
                  onCheckedChange={(v) => setC({ ...c, handoff_alarm_default_on: v })}
                />
                <span className="text-xs text-muted-foreground">
                  {(c.handoff_alarm_default_on ?? true) ? "Ativado" : "Desativado"}
                </span>
              </div>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              Toca continuamente sempre que a IA não souber responder um cliente com segurança e pedir pra um
              atendente assumir a conversa. Som próprio, diferente do alarme de pedidos — assim dá pra diferenciar
              qual alerta está tocando.
            </p>
            <input
              ref={handoffFileRef}
              type="file"
              accept="audio/mpeg,audio/mp3,.mp3"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAlarm(f, "handoff_alarm_sound_url");
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => handoffFileRef.current?.click()}
              disabled={uploadingHandoff}
            >
              <Upload className="size-4" /> {uploadingHandoff ? "Enviando..." : "Enviar .mp3"}
            </Button>
            {c.handoff_alarm_sound_url && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Volume2 className="size-3.5" />{" "}
                <audio src={c.handoff_alarm_sound_url} controls className="h-8 w-full" />
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("pagamentos")}>
        <h2 className="font-semibold">Pix da loja</h2>
        <p className="text-xs text-muted-foreground">Esta chave continua disponível para os fluxos atuais do WhatsApp/manual. No cardápio digital, Pix e cartão usam o provedor online selecionado abaixo e são confirmados automaticamente antes de o pedido entrar na operação.</p>
        <div>
          <Label>Modo</Label>
          <Select value={c.pix_mode || "static"} onValueChange={(v) => setC({ ...c, pix_mode: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="static">Estático (chave copia-e-cola fixa)</SelectItem>
              <SelectItem value="dynamic">Dinâmico (gera código por pedido — em breve)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Chave Pix</Label>
          <Input value={c.pix_key || ""} onChange={(e) => setC({ ...c, pix_key: e.target.value })} />
        </div>
        <div>
          <Label>Código Pix Copia-e-Cola</Label>
          <Textarea
            rows={3}
            value={c.pix_copia_cola || ""}
            onChange={(e) => setC({ ...c, pix_copia_cola: e.target.value })}
          />
        </div>
      </Card>

      <Card className="space-y-4 border-2 border-primary/20 p-5" style={tabStyle("pagamentos")}>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">Continuidade da operação</p>
          <h2 className="mt-1 text-lg font-black">Provedor ativo do cardápio digital</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">O cliente nunca escolhe a empresa de pagamento: ele vê apenas Pix ou cartão. A troca abaixo afeta somente novos checkouts. Pagamentos já iniciados continuam vinculados ao provedor original.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { key: "mercadopago", name: "Mercado Pago", ready: c.mercadopago_enabled === true && !!String(c.mercadopago_public_key || "").trim() && !!String(c.mercadopago_access_token || "").trim(), detail: "Checkout transparente: Pix e cartão dentro da HotBox." },
            { key: "infinitepay", name: "InfinitePay", ready: c.infinitepay_enabled === true && !!String(c.infinitepay_handle || "").trim(), detail: "Checkout externo mantido como contingência." },
          ].map((item) => {
            const active = (c.digital_payment_provider || "infinitepay") === item.key;
            return (
              <button
                type="button"
                key={item.key}
                onClick={() => setC({ ...c, digital_payment_provider: item.key })}
                className={`rounded-2xl border-2 p-4 text-left transition ${active ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black">{item.name}</span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-black ${item.ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{item.ready ? "CONFIGURADO" : "CONFIGURAR"}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
                {active && <p className="mt-3 text-xs font-black text-primary">● Ativo para novos pagamentos</p>}
              </button>
            );
          })}
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-950">
          Troca manual é intencional. O sistema não muda automaticamente de empresa após timeout ou recusa, evitando duas cobranças para o mesmo checkout.
        </div>
      </Card>

      <Card className="space-y-4 p-5" style={tabStyle("pagamentos")}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Mercado Pago — checkout transparente</h2>
            <p className="mt-1 text-xs text-muted-foreground">Pix com QR Code dentro da HotBox e cartão pelo Payment Brick. O Access Token fica restrito ao backend.</p>
          </div>
          <Switch checked={c.mercadopago_enabled === true} onCheckedChange={(v) => setC({ ...c, mercadopago_enabled: v })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Public Key</Label>
            <Input value={c.mercadopago_public_key || ""} onChange={(e) => setC({ ...c, mercadopago_public_key: e.target.value.trim() })} placeholder="APP_USR-..." autoComplete="off" />
          </div>
          <div>
            <Label>Access Token</Label>
            <Input type="password" value={c.mercadopago_access_token || ""} onChange={(e) => setC({ ...c, mercadopago_access_token: e.target.value.trim() })} placeholder="APP_USR-..." autoComplete="new-password" />
          </div>
        </div>
        <div>
          <Label>Máximo de parcelas no cartão</Label>
          <Select value={String(c.mercadopago_max_installments || 1)} onValueChange={(v) => setC({ ...c, mercadopago_max_installments: Number(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Somente 1x — recomendado para delivery</SelectItem>
              <SelectItem value="2">Até 2x</SelectItem>
              <SelectItem value="3">Até 3x</SelectItem>
              <SelectItem value="6">Até 6x</SelectItem>
              <SelectItem value="12">Até 12x</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-xl border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          Notificação de pagamento enviada automaticamente para <code>{typeof window !== "undefined" ? `${window.location.origin}/api/public/webhooks/mercadopago` : "/api/public/webhooks/mercadopago"}</code>. Mesmo com o webhook, a HotBox consulta o pagamento diretamente no Mercado Pago e confere valor, moeda e referência antes de criar o pedido.
        </div>
      </Card>

      <Card className="space-y-4 p-5" style={tabStyle("pagamentos")}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">InfinitePay — contingência do cardápio digital</h2>
            <p className="mt-1 text-xs text-muted-foreground">O cliente paga no checkout seguro da InfinitePay. O pedido só é criado depois da confirmação real do pagamento.</p>
          </div>
          <Switch checked={c.infinitepay_enabled === true} onCheckedChange={(v) => setC({ ...c, infinitepay_enabled: v })} />
        </div>
        <div>
          <Label>InfiniteTag / Handle</Label>
          <Input value={c.infinitepay_handle || ""} onChange={(e) => setC({ ...c, infinitepay_handle: e.target.value.replace(/^\$/, "") })} placeholder="Ex.: hotboxdelivery" />
          <p className="mt-1 text-[11px] text-muted-foreground">Use sua InfiniteTag sem o símbolo $. A integração oficial do Checkout Integrado usa a InfiniteTag para identificar sua conta.</p>
        </div>
        <div className="rounded-xl border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          Webhook configurado automaticamente em <code>{typeof window !== "undefined" ? `${window.location.origin}/api/public/webhooks/infinitepay` : "/api/public/webhooks/infinitepay"}</code>. O sistema também consulta a InfinitePay para confirmar valor e status antes de criar o pedido.
        </div>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("geral")}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Cardápio digital (site do cliente)</h2>
          <div className="flex items-center gap-2">
            <Switch
              checked={c.digital_menu_enabled !== false}
              onCheckedChange={(v) => setC({ ...c, digital_menu_enabled: v })}
            />
            <span className="text-xs text-muted-foreground">
              {c.digital_menu_enabled !== false ? "Ativo" : "Desativado"}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Quando ativo, o cliente monta o pedido sozinho pela página pública e o pedido cai no sistema marcado como{" "}
          <b>cardápio digital</b>. Quando desativado, a página mostra um aviso pedindo pra chamar no WhatsApp.
        </p>
        <div>
          <Label>Formas aceitas no cardápio digital</Label>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {[
              ["digital_menu_pix_enabled", "Pix"],
              ["digital_menu_card_enabled", "Cartão de crédito"],
            ].map(([field, label]) => (
              <label key={field} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm font-medium">
                {label}
                <Switch checked={c[field] !== false} onCheckedChange={(v) => setC({ ...c, [field]: v })} />
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">No cardápio digital, Pix e cartão são processados pelo provedor que estiver ativo acima. O pedido não aparece na operação antes da confirmação real do pagamento.</p>
        </div>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("notificacoes")}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Impressão</h2>
          <div className="flex items-center gap-2">
            <Switch
              checked={c.auto_print_on_accept === true}
              onCheckedChange={(v) => setC({ ...c, auto_print_on_accept: v })}
            />
            <span className="text-xs text-muted-foreground">
              {c.auto_print_on_accept === true ? "Ativa" : "Desativada"}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Quando ativa, a nota do cliente imprime sozinha assim que você clicar em <b>"Aceitar"</b> num pedido (tanto na
          fila quanto na tela do pedido).
        </p>
        <p className="text-xs text-muted-foreground">
          ⚠️ Navegador não tem permissão do tipo câmera/microfone pra impressora — então mesmo com isso ativo, o Chrome
          ainda abre a caixinha de impressão do sistema (é uma proteção do próprio navegador, nenhum site consegue pular
          isso). Na primeira vez que você entrar na loja com essa opção ligada, aparece um aviso explicando isso. Pra
          imprimir sem essa caixa aparecer (impressão silenciosa de verdade), configure o computador da loja pra abrir o
          Chrome em modo kiosk, apontando pra impressora térmica — me chama que eu te passo o comando exato pro seu
          sistema operacional.
        </p>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("integracoes")}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">WhatsApp (Evolution API)</h2>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <div>
            <Label className="text-destructive">🚨 Desabilitar Evolution por completo</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Botão de emergência — desliga QUALQUER ligação com a Evolution API, tanto envio quanto recebimento de
              mensagem, sem precisar apagar as credenciais nem mexer no seletor de provedor abaixo. Use se a instância
              travar, ficar instável, ou correndo risco de bloqueio. Enquanto estiver ligado, nenhuma mensagem sai nem
              entra pela Evolution — o canal da Meta (se configurado) continua funcionando normalmente.
            </p>
          </div>
          <Switch
            checked={c.evolution_disabled === true}
            onCheckedChange={(v) => setC({ ...c, evolution_disabled: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <Label>Atendimento automático (IA) ativo globalmente</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Desligue aqui se por algum motivo o robô parar de funcionar direito, ou se quiser assumir tudo na mão. Com
              isso desligado, as mensagens continuam chegando normalmente no chat — só que a IA não responde mais
              nenhuma conversa automaticamente, você quem responde. Pra pausar só um cliente específico sem afetar os
              outros, use o interruptor dentro da própria conversa em <b>Chat</b>.
            </p>
          </div>
          <Switch
            checked={c.bot_global_active !== false}
            onCheckedChange={(v) => setC({ ...c, bot_global_active: v })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Configure sua instância Evolution API (hospede no Railway) e cole a URL abaixo como webhook.
        </p>
        <p className="text-xs text-muted-foreground">
          ⚠️ Para a IA ler comprovantes de Pix enviados por foto, ative a opção <b>"Webhook Base64"</b> na sua instância
          Evolution (envia a imagem já em base64 no payload).
        </p>
        <div className="rounded-md bg-muted p-3 text-xs">
          <p className="mb-1 font-semibold">URL do webhook (cole na Evolution):</p>
          <code className="break-all">
            {typeof window !== "undefined" ? `${window.location.origin}/api/public/webhooks/evolution` : ""}
          </code>
        </div>
        <div>
          <Label>Número do WhatsApp da loja</Label>
          <Input
            value={c.whatsapp_number || ""}
            onChange={(e) => setC({ ...c, whatsapp_number: e.target.value })}
            placeholder="5511999999999"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>URL Evolution API</Label>
            <Input
              value={c.evolution_api_url || ""}
              onChange={(e) => setC({ ...c, evolution_api_url: e.target.value })}
              placeholder="https://evolution.railway.app"
            />
          </div>
          <div>
            <Label>Instância</Label>
            <Input
              value={c.evolution_instance || ""}
              onChange={(e) => setC({ ...c, evolution_instance: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label>Token Evolution</Label>
          <Input
            type="password"
            value={c.evolution_api_token || ""}
            onChange={(e) => setC({ ...c, evolution_api_token: e.target.value })}
          />
        </div>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("integracoes")}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">WhatsApp — API oficial da Meta (Cloud API)</h2>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            Sem risco de bloqueio
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Alternativa oficial à Evolution API — usa diretamente a API do WhatsApp mantida pela própria Meta, sem simular
          um celular conectado. Preencha as credenciais do seu App (Meta for Developers) abaixo.
        </p>

        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <Label>Provedor ativo</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Decide por onde TODA mensagem sai e entra — respostas automáticas da IA, respostas manuais do Chat, e
              transmissões. Só uma pode estar ativa por vez.
            </p>
          </div>
          <Select
            value={c.whatsapp_provider || "evolution"}
            onValueChange={(v) => setC({ ...c, whatsapp_provider: v })}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="evolution">Evolution API</SelectItem>
              <SelectItem value="meta">Meta Cloud API (oficial)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md bg-muted p-3 text-xs">
          <p className="mb-1 font-semibold">URL do webhook (cole no App da Meta → WhatsApp → Configuration):</p>
          <code className="break-all">
            {typeof window !== "undefined" ? `${window.location.origin}/api/public/webhooks/meta` : ""}
          </code>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Token de Acesso Permanente</Label>
            <Input
              type="password"
              value={c.meta_access_token || ""}
              onChange={(e) => setC({ ...c, meta_access_token: e.target.value })}
              placeholder="EAAO..."
            />
          </div>
          <div>
            <Label>Phone Number ID</Label>
            <Input
              value={c.meta_phone_number_id || ""}
              onChange={(e) => setC({ ...c, meta_phone_number_id: e.target.value })}
            />
          </div>
          <div>
            <Label>WABA ID (Conta WhatsApp)</Label>
            <Input value={c.meta_waba_id || ""} onChange={(e) => setC({ ...c, meta_waba_id: e.target.value })} />
          </div>
          <div>
            <Label>App ID</Label>
            <Input value={c.meta_app_id || ""} onChange={(e) => setC({ ...c, meta_app_id: e.target.value })} />
          </div>
          <div>
            <Label>App Secret</Label>
            <Input
              type="password"
              value={c.meta_app_secret || ""}
              onChange={(e) => setC({ ...c, meta_app_secret: e.target.value })}
              placeholder="Meta for Developers → seu App → Configurações básicas"
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Verify Token</Label>
            <Input
              value={c.meta_verify_token || ""}
              onChange={(e) => setC({ ...c, meta_verify_token: e.target.value })}
              placeholder="crie uma palavra/senha qualquer — é só pra confirmar o webhook com a Meta"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Esse valor você inventa aqui e cola de novo no campo "Verify token" ao cadastrar o webhook no App da Meta
              — os dois precisam ser idênticos.
            </p>
          </div>
        </div>

        {/* ── Conversions API (CAPI) ── */}
        <div className="mt-4 border-t pt-4">
          <p className="mb-3 text-sm font-semibold">Rastreamento de Campanhas (Conversions API)</p>
          <p className="mb-3 text-[11px] text-muted-foreground">
            Permite enviar eventos de Lead e Compra para o Facebook quando um cliente chega pelo anúncio Click-to-WhatsApp.
            Configure no <strong>Events Manager → Conjuntos de dados → Definições → API de Conversões</strong>.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Pixel ID (ID do conjunto de dados)</Label>
              <Input
                value={(c as any).meta_pixel_id || ""}
                onChange={(e) => setC({ ...c, meta_pixel_id: e.target.value } as any)}
                placeholder="Ex: 1774242074004447"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Events Manager → Conjuntos de dados → Identificação
              </p>
            </div>
            <div>
              <Label>Token de Acesso do CAPI</Label>
              <Input
                type="password"
                value={(c as any).meta_capi_access_token || ""}
                onChange={(e) => setC({ ...c, meta_capi_access_token: e.target.value } as any)}
                placeholder="Token gerado em Definições → API de Conversões"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Diferente do token do WhatsApp — gerado especificamente para o CAPI
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label>Código de Evento de Teste <span className="font-normal text-muted-foreground">(opcional — só durante testes)</span></Label>
              <Input
                value={(c as any).meta_test_event_code || ""}
                onChange={(e) => setC({ ...c, meta_test_event_code: e.target.value } as any)}
                placeholder="Ex: TEST12345 — deixe vazio em produção"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Events Manager → Testar eventos → código TEST... — apague após validar que os eventos chegam
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("integracoes")}>
        <h2 className="font-semibold">99Food (Open Delivery)</h2>
        <p className="text-xs text-muted-foreground">
          A 99Food usa o padrão aberto <b>Open Delivery</b> (o mesmo da Keeta) em vez de uma API própria só dela. Peça
          as credenciais abaixo pra 99Food depois do seu cadastro (portal{" "}
          <span className="font-mono">developer-food.99app.com</span> ou{" "}
          <span className="font-mono">99FoodTechSupport@didiglobal.com</span>). Essa integração é totalmente
          independente da do iFood — desligar ou errar algo aqui não afeta o iFood, e vice-versa.
        </p>
        <div className="rounded-md bg-muted p-3 text-xs">
          <p className="mb-1 font-semibold">URL do webhook (cole no cadastro da 99Food):</p>
          <code className="break-all">
            {typeof window !== "undefined" ? `${window.location.origin}/api/public/webhooks/nfood` : ""}
          </code>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Client ID</Label>
            <Input value={c.nfood_client_id || ""} onChange={(e) => setC({ ...c, nfood_client_id: e.target.value })} />
          </div>
          <div>
            <Label>Client Secret</Label>
            <Input
              type="password"
              value={c.nfood_client_secret || ""}
              onChange={(e) => setC({ ...c, nfood_client_secret: e.target.value })}
            />
          </div>
          <div>
            <Label>Merchant ID (AppShopID da loja)</Label>
            <Input
              value={c.nfood_merchant_id || ""}
              onChange={(e) => setC({ ...c, nfood_merchant_id: e.target.value })}
            />
          </div>
          <div>
            <Label>App ID</Label>
            <Input value={c.nfood_app_id || ""} onChange={(e) => setC({ ...c, nfood_app_id: e.target.value })} />
          </div>
          <div>
            <Label>URL base da API</Label>
            <Input
              value={c.nfood_api_base_url || ""}
              onChange={(e) => setC({ ...c, nfood_api_base_url: e.target.value })}
              placeholder="fornecida pelo suporte técnico da 99Food"
            />
          </div>
          <div>
            <Label>URL de autenticação (OAuth token)</Label>
            <Input
              value={c.nfood_oauth_token_url || ""}
              onChange={(e) => setC({ ...c, nfood_oauth_token_url: e.target.value })}
              placeholder="fornecida pelo suporte técnico da 99Food"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <Label>Entrega feita pela própria 99Food</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Ligado: a 99Food usa o entregador dela pra esses pedidos, e eles não aparecem no seu app de entregador —
              igual já acontece com o iFood. Desligue só se você escolheu o modo "Entrega Estabelecimento" no cadastro
              da 99Food (você mesmo entrega, pelo HotBox).
            </p>
          </div>
          <Switch
            checked={c.nfood_own_delivery !== false}
            onCheckedChange={(v) => setC({ ...c, nfood_own_delivery: v })}
          />
        </div>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("notificacoes")}>
        <h2 className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="size-4 text-amber-600" /> Monitoramento & alertas
        </h2>
        <p className="text-xs text-muted-foreground">
          A loja envia um alerta pelo WhatsApp quando detecta falhas repetidas (ex: webhook do WhatsApp caindo) e quando
          pedidos Pix são cancelados automaticamente.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>WhatsApp para receber alertas</Label>
            <Input
              value={c.admin_alert_phone || ""}
              onChange={(e) => setC({ ...c, admin_alert_phone: e.target.value })}
              placeholder="5511999999999"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Só com DDI+DDD, sem espaços. Envio via sua Evolution API.
            </p>
          </div>
          <div>
            <Label>
              E-mail para alertas <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              type="email"
              value={c.admin_alert_email || ""}
              onChange={(e) => setC({ ...c, admin_alert_email: e.target.value })}
              placeholder="voce@sualoja.com"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Requer domínio de e-mail configurado no projeto.</p>
          </div>
          <div>
            <Label>Cancelar Pix não pago após (minutos)</Label>
            <Input
              type="number"
              min={5}
              max={120}
              value={c.pix_auto_cancel_minutes ?? 15}
              onChange={(e) => setC({ ...c, pix_auto_cancel_minutes: Number(e.target.value) || 15 })}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">0 ou vazio desativa o cancelamento automático.</p>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={testAlert} disabled={testingAlert}>
          <Bell className="size-4" /> {testingAlert ? "Enviando..." : "Testar alerta agora"}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Manda um alerta de teste de verdade pro seu WhatsApp configurado acima — confirma que a corrente inteira
          (banco → job → Evolution) está funcionando.
        </p>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("sistema")}>
        <h2 className="flex items-center gap-2 font-semibold">
          <FlaskConical className="size-4 text-violet-600" /> Diagnóstico de pagamentos
        </h2>
        <p className="text-xs text-muted-foreground">
          Cria e apaga pedidos de teste no banco para confirmar que Pix e cartão estão
          funcionando de verdade — não é simulação, testa o banco real. Roda em segundos e não deixa rastro. Bom pra
          rodar sempre depois de qualquer atualização do sistema.
        </p>
        <Button type="button" variant="outline" onClick={runDiagnostics} disabled={diagnosticsRunning}>
          <FlaskConical className="size-4" /> {diagnosticsRunning ? "Testando..." : "Rodar diagnóstico agora"}
        </Button>
        {diagnosticsResults && (
          <div className="space-y-1.5 rounded-lg border p-3">
            {diagnosticsResults.map((r, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 text-sm ${r.ok ? "text-emerald-700" : "text-destructive"}`}
              >
                {r.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
                <span className="font-medium">{r.name}</span>
                {!r.ok && r.detail && <span className="text-xs text-muted-foreground">— {r.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("sistema")}>
        <h2 className="flex items-center gap-2 font-semibold">
          <ScrollText className="size-4 text-slate-600" /> Logs de API
        </h2>
        <p className="text-xs text-muted-foreground">
          Tudo que acontece nas integrações externas (iFood, WhatsApp) fica registrado lá — inclusive testes de pedido
          que não chegaram — e tem uma IA que te ajuda a interpretar o que aconteceu.
        </p>
        <Link to="/loja/logs">
          <Button type="button" variant="outline">
            <ScrollText className="size-4" /> Ver logs de API
          </Button>
        </Link>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("integracoes")}>
        <h2 className="font-semibold">iFood</h2>
        <p className="text-xs text-muted-foreground">
          Cole a URL abaixo no seu integrador/homologação do iFood (Portal do Parceiro). Pedidos chegam automaticamente
          com status "Aguardando Revisão" para você conferir antes de entrar na fila.
        </p>
        <div className="rounded-md bg-muted p-3 text-xs">
          <p className="mb-1 font-semibold">URL do webhook (homologação/teste):</p>
          <code className="break-all">
            {typeof window !== "undefined"
              ? `${window.location.origin}/api/public/webhooks/ifood?token=${c.ifood_webhook_secret || "SEU_TOKEN"}`
              : ""}
          </code>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Merchant ID (iFood)</Label>
            <Input
              value={c.ifood_merchant_id || ""}
              onChange={(e) => setC({ ...c, ifood_merchant_id: e.target.value })}
            />
          </div>
          <div>
            <Label>Token do webhook</Label>
            <div className="flex gap-2">
              <Input
                value={c.ifood_webhook_secret || ""}
                onChange={(e) => setC({ ...c, ifood_webhook_secret: e.target.value })}
                placeholder="gere um token seguro"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setC({ ...c, ifood_webhook_secret: crypto.randomUUID().replace(/-/g, "") })}
              >
                Gerar
              </Button>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Client ID</Label>
            <Input value={c.ifood_client_id || ""} onChange={(e) => setC({ ...c, ifood_client_id: e.target.value })} />
          </div>
          <div>
            <Label>Client Secret</Label>
            <Input
              type="password"
              value={c.ifood_client_secret || ""}
              onChange={(e) => setC({ ...c, ifood_client_secret: e.target.value })}
            />
          </div>
        </div>

        <div className="border-t pt-3">
          <h3 className="mb-2 text-sm font-semibold">Produção — envio de status e polling</h3>
          <div>
            <Label>URL pública do seu site</Label>
            <Input
              value={c.app_public_url || ""}
              onChange={(e) => setC({ ...c, app_public_url: e.target.value })}
              placeholder="https://seu-dominio.com"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Necessária pro sistema avisar a iFood quando você mudar o status de um pedido.
            </p>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-semibold">Polling automático de pedidos</p>
              <p className="text-[11px] text-muted-foreground">
                Liga a busca automática de novos pedidos direto na API da iFood, a cada minuto — necessário pra produção
                real (a URL de webhook sozinha não é suficiente pra homologação oficial).
              </p>
            </div>
            <Switch
              checked={!!c.ifood_polling_enabled}
              onCheckedChange={(v) => setC({ ...c, ifood_polling_enabled: v })}
            />
          </div>

          <div className="mt-2">
            <Label>Token de segurança do polling</Label>
            <div className="flex gap-2">
              <Input
                value={c.ifood_polling_token || ""}
                onChange={(e) => setC({ ...c, ifood_polling_token: e.target.value })}
                placeholder="gere um token seguro"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setC({ ...c, ifood_polling_token: crypto.randomUUID().replace(/-/g, "") })}
              >
                Gerar
              </Button>
            </div>
          </div>

          {c.ifood_last_poll_at && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Última busca: {new Date(c.ifood_last_poll_at).toLocaleString("pt-BR")}
              {c.ifood_last_poll_error && (
                <span className="ml-2 font-semibold text-destructive">⚠ {c.ifood_last_poll_error}</span>
              )}
            </p>
          )}

          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={rescheduleIfoodPolling}>
            <RefreshCw className="size-3.5" /> Salvar e (re)ativar polling agora
          </Button>
        </div>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("integracoes")}>
        <h2 className="font-semibold">🚗 Fora da área de entrega — redirecionar pro iFood/99Food</h2>
        <p className="text-xs text-muted-foreground">
          Quando um cliente pedir entrega pra um endereço fora da área do seu entregador fixo (bairro/rua não
          atendidos, ou fora do raio calculado por distância), a IA não vai mais dizer só "não entregamos aí". Se você
          cadastrar pelo menos um dos links abaixo, ela explica com educação que o pedido pode ser feito pela sua loja
          no iFood ou na 99Food — que têm entregadores próprios cobrindo essa região — e só envia o link se o cliente
          confirmar que quer. Sem nenhum link cadastrado aqui, o comportamento volta a ser o antigo (avisa que não
          entrega, sem mencionar nenhuma plataforma).
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Link da loja no iFood</Label>
            <Input
              value={c.ifood_store_link || ""}
              onChange={(e) => setC({ ...c, ifood_store_link: e.target.value })}
              placeholder="https://www.ifood.com.br/delivery/.../sua-loja"
            />
          </div>
          <div>
            <Label>Link da loja na 99Food</Label>
            <Input
              value={c.nfood_store_link || ""}
              onChange={(e) => setC({ ...c, nfood_store_link: e.target.value })}
              placeholder="https://food.99app.com/.../sua-loja"
            />
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("integracoes")}>
        <h2 className="font-semibold">iFood — mapeamento de cardápio</h2>
        <p className="text-xs text-muted-foreground">
          Vincule cada item do cardápio da iFood a um produto seu — sem isso, o desconto automático de estoque e os
          relatórios de venda não funcionam corretamente pra pedidos da iFood. Itens novos aparecem aqui sozinhos assim
          que chega um pedido com eles.
        </p>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {ifoodMap.map((row) => (
            <div key={row.ifood_item_id} className="grid grid-cols-2 items-center gap-2 rounded-lg border p-2.5">
              <span className="truncate text-sm font-medium">{row.ifood_item_name || row.ifood_item_id}</span>
              <Select
                value={row.product_id || "none"}
                onValueChange={(v) => updateIfoodMap(row.ifood_item_id, v === "none" ? null : v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Vincular a um produto..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— não vinculado —</SelectItem>
                  {products.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          {!ifoodMap.length && (
            <p className="py-4 text-center text-xs text-muted-foreground">Nenhum item da iFood recebido ainda.</p>
          )}
        </div>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("pagamentos")}>
        <h2 className="font-semibold">Taxas das plataformas (pra calcular o lucro real)</h2>
        <p className="text-xs text-muted-foreground">
          Cada plataforma cobra um percentual sobre o valor do pedido (comissão + taxa de pagamento online, quando
          aplicável). Preencha aqui o percentual <b>efetivo</b> que você paga em cada uma — dá pra ver isso no seu
          extrato/repasse de cada plataforma. Isso é usado só em <b>/loja/financeiro</b>, pra descontar essas taxas do
          lucro real de cada pedido — sem isso, o financeiro contaria o valor cheio do pedido como se fosse todo seu, o
          que não é verdade.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>WhatsApp (%)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              value={c.fee_pct_whatsapp ?? ""}
              onChange={(e) =>
                setC({
                  ...c,
                  fee_pct_whatsapp: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              placeholder="0"
            />
          </div>
          <div>
            <Label>Site próprio (%)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              value={c.fee_pct_site ?? ""}
              onChange={(e) => setC({ ...c, fee_pct_site: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="0"
            />
          </div>
          <div>
            <Label>iFood (%)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              value={c.fee_pct_ifood ?? ""}
              onChange={(e) => setC({ ...c, fee_pct_ifood: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="ex: 15.2"
            />
          </div>
          <div>
            <Label>99Food (%)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              value={c.fee_pct_99food ?? ""}
              onChange={(e) =>
                setC({
                  ...c,
                  fee_pct_99food: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              placeholder="ex: 12.1"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Dica: se a plataforma cobra comissão + taxa de pagamento separadas (ex: 12% + 3,2%), some as duas aqui — o
          campo é um percentual único aplicado sobre o valor total de cada pedido dessa origem.
        </p>
      </Card>

      <Card className="space-y-3 p-5" style={tabStyle("ia")}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">IA / Failover</h2>
          <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
            <Zap className="size-3.5" />
            Principal: ChatGPT
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          O atendimento por IA no WhatsApp usa o <b>ChatGPT (OpenAI)</b> como provedor principal — cole sua chave abaixo
          pra ativar. Cadastrar também uma chave do Groq cria um <b>backup automático</b>: se o ChatGPT falhar ou ficar
          sem crédito, o sistema tenta o Groq na mesma conversa, sem o cliente perceber.
        </p>
        <div>
          <Label>Chave do ChatGPT (OpenAI) — principal</Label>
          <Input
            type="password"
            value={c.openai_api_key || ""}
            onChange={(e) => setC({ ...c, openai_api_key: e.target.value })}
            placeholder="sk-..."
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Pegue em <span className="font-mono">platform.openai.com/api-keys</span>. Sem essa chave, o sistema tenta
            direto o Groq (se cadastrado).
          </p>
        </div>
        <div>
          <Label>Chave do Groq — reserva</Label>
          <Input
            type="password"
            value={c.groq_api_key || ""}
            onChange={(e) => setC({ ...c, groq_api_key: e.target.value })}
            placeholder="gsk_..."
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Pegue de graça em <span className="font-mono">console.groq.com/keys</span>. Só é usada se o ChatGPT falhar
            ou não estiver configurado.
          </p>
        </div>
        <div>
          <Label className="flex items-center gap-1">
            Temperatura da IA
            <InfoTip text="Controla o quanto a IA pode 'variar' ou improvisar nas respostas. Quanto mais baixo, mais previsível e fiel ao script ela fica — recomendado para atendimento comercial. Quanto mais alto, mais natural e solta a conversa fica, mas com mais risco de fugir do combinado." />
          </Label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { value: 0.1, label: "Muito precisa", desc: "Segue o script à risca" },
              { value: 0.3, label: "Precisa", desc: "Recomendado" },
              { value: 0.5, label: "Equilibrada", desc: "Meio-termo" },
              { value: 0.7, label: "Natural", desc: "Mais solta" },
              { value: 0.9, label: "Criativa", desc: "Maior risco de fugir do script" },
            ].map((opt) => {
              const active = Number(c.ai_temperature ?? 0.3) === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setC({ ...c, ai_temperature: opt.value })}
                  className={`rounded-lg border p-2.5 text-left text-xs transition-colors ${
                    active
                      ? "border-primary bg-primary/10 font-semibold text-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <div>{opt.label}</div>
                  <div className="mt-0.5 text-[10px] font-normal text-muted-foreground">{opt.desc}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{opt.value}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Ou defina um valor exato (0 a 1):</Label>
            <Input
              type="number"
              step="0.05"
              min="0"
              max="1"
              className="w-24"
              value={c.ai_temperature ?? 0.3}
              onChange={(e) =>
                setC({
                  ...c,
                  ai_temperature: e.target.value === "" ? 0.3 : Math.max(0, Math.min(1, Number(e.target.value))),
                })
              }
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Para atendimento comercial (pedidos, valores, endereços), recomendamos manter em <b>0,1 a 0,3</b> — reduz
            bastante a chance da IA sair do script ou "inventar" alguma resposta.
          </p>
        </div>
      </Card>

      <div style={tabStyle("ia")}>
        <MenuImagesCard />
      </div>

      <div style={tabStyle("ia")}>
        <AiInstructionsCard />
      </div>

      <div style={tabStyle("entrega")}>
        <BairrosAtendidosCard />
      </div>

      <div style={tabStyle("entrega")}>
        <BairrosNaoAtendidosCard />
      </div>

      <div style={tabStyle("entrega")}>
        <RuasNaoAtendidasCard />
      </div>

      <div style={tabStyle("atendimento")}>
        <ManualStoreStatusCard />
      </div>

      <div style={tabStyle("atendimento")}>
        <BusinessHoursCard />
      </div>

      <div style={tabStyle("geral")}>
        <ChatWallpaperCard />
      </div>

      <Card className="space-y-3 p-5" style={tabStyle("sistema")}>
        <h2 className="font-semibold">Alterar senha</h2>
        <p className="text-xs text-muted-foreground">Troca a senha do seu acesso administrativo.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Nova senha</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="mínimo 6 caracteres"
            />
          </div>
          <div>
            <Label>Confirmar nova senha</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
        </div>
        <Button type="button" variant="outline" onClick={changePassword} disabled={changingPassword}>
          {changingPassword ? "Trocando..." : "Trocar senha"}
        </Button>
      </Card>

      <Card className="space-y-3 border-2 border-destructive p-5" style={tabStyle("sistema")}>
        <h2 className="flex items-center gap-2 font-semibold text-destructive">
          <AlertTriangle className="size-4" /> Zona de perigo — limpar dados de teste
        </h2>
        <p className="text-xs text-muted-foreground">
          Use isso antes de entrar em produção, pra tirar os dados de teste sem mexer no restante da configuração.
          Escolha só o que quiser apagar — cada categoria é independente. <b>Essa ação não pode ser desfeita.</b>
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {WIPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm hover:bg-muted"
            >
              <Checkbox checked={wipeSelected.includes(opt.value)} onCheckedChange={() => toggleWipe(opt.value)} />
              {opt.label}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setWipeSelected(wipeSelected.length === WIPE_OPTIONS.length ? [] : WIPE_OPTIONS.map((o) => o.value))
            }
          >
            {wipeSelected.length === WIPE_OPTIONS.length ? "Desmarcar tudo" : "Selecionar tudo"}
          </Button>
          <Input
            className="max-w-xs"
            placeholder='Digite "APAGAR" para confirmar'
            value={wipeConfirmText}
            onChange={(e) => setWipeConfirmText(e.target.value)}
          />
          <Button
            type="button"
            variant="destructive"
            disabled={!wipeSelected.length || wipeConfirmText !== "APAGAR" || wiping}
            onClick={runWipe}
          >
            <Trash2 className="size-4" /> {wiping ? "Apagando..." : "Apagar selecionados"}
          </Button>
        </div>
      </Card>

      <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
        <Save className="size-4" /> {saving ? "Salvando..." : "Salvar tudo"}
      </Button>
    </div>
  );
}

// ============================================================
// Card de instruções da IA (diárias + globais)
// ============================================================
function AiInstructionsCard() {
  const [instructions, setInstructions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState("");
  const [newType, setNewType] = useState<"daily" | "global">("global");
  const [adding, setAdding] = useState(false);

  // data de hoje no fuso de Brasília
  const todayBR = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("ai_instructions").select("*").order("created_at", { ascending: false });
    setInstructions(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!newText.trim()) return;
    setAdding(true);
    const { error } = await supabase.from("ai_instructions").insert({
      type: newType,
      content: newText.trim(),
      active: true,
      valid_date: newType === "daily" ? todayBR : null,
    });
    if (error) {
      toast.error(error.message);
      setAdding(false);
      return;
    }
    setNewText("");
    toast.success(newType === "daily" ? "Instrução do dia adicionada!" : "Instrução global adicionada!");
    setAdding(false);
    load();
  }

  async function toggle(id: string, active: boolean) {
    await supabase.from("ai_instructions").update({ active: !active }).eq("id", id);
    load();
  }

  async function remove(id: string) {
    if (!window.confirm("Remover essa instrução?")) return;
    await supabase.from("ai_instructions").delete().eq("id", id);
    load();
  }

  const globals = instructions.filter((i) => i.type === "global");
  const todays = instructions.filter((i) => i.type === "daily" && i.valid_date === todayBR);
  const past = instructions.filter((i) => i.type === "daily" && i.valid_date !== todayBR);

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">🧠 Instruções para a IA</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Ensine a IA a seguir regras específicas. <strong>Globais</strong> valem todos os dias. <strong>Do dia</strong>{" "}
          valem só hoje (fuso Brasília) e somem automaticamente.
        </p>
      </div>

      {/* form para adicionar */}
      <div className="space-y-2 rounded-xl border border-dashed p-3">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={newType === "global" ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setNewType("global")}
          >
            🌍 Global
          </Button>
          <Button
            size="sm"
            variant={newType === "daily" ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setNewType("daily")}
          >
            📅 Só hoje
          </Button>
        </div>
        <Textarea
          rows={2}
          placeholder={
            newType === "daily"
              ? `Ex: Hoje estamos sem batata frita. Se pedirem, avise com educação e ofereça o onion rings como alternativa.`
              : `Ex: Sempre pergunte se o cliente tem o cartão fidelidade antes de fechar o pedido.`
          }
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          className="resize-none rounded-xl text-sm"
        />
        <Button size="sm" onClick={add} disabled={adding || !newText.trim()}>
          {adding ? "Adicionando..." : `Adicionar instrução ${newType === "daily" ? "do dia" : "global"}`}
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : (
        <div className="space-y-4">
          {/* globais */}
          {globals.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                🌍 Globais — sempre ativas
              </p>
              <div className="space-y-2">
                {globals.map((i) => (
                  <div
                    key={i.id}
                    className={`flex items-start gap-2 rounded-xl border p-2.5 ${i.active ? "bg-emerald-50 border-emerald-200" : "opacity-50"}`}
                  >
                    <Switch
                      checked={i.active}
                      onCheckedChange={() => toggle(i.id, i.active)}
                      className="mt-0.5 shrink-0"
                    />
                    <p className="flex-1 text-sm leading-snug">{i.content}</p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0 text-destructive"
                      onClick={() => remove(i.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* do dia */}
          {todays.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                📅 Hoje — somem à meia-noite
              </p>
              <div className="space-y-2">
                {todays.map((i) => (
                  <div
                    key={i.id}
                    className={`flex items-start gap-2 rounded-xl border p-2.5 ${i.active ? "bg-blue-50 border-blue-200" : "opacity-50"}`}
                  >
                    <Switch
                      checked={i.active}
                      onCheckedChange={() => toggle(i.id, i.active)}
                      className="mt-0.5 shrink-0"
                    />
                    <p className="flex-1 text-sm leading-snug">{i.content}</p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0 text-destructive"
                      onClick={() => remove(i.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* dias anteriores */}
          {past.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                🗓️ Dias anteriores (expiradas)
              </p>
              <div className="space-y-2">
                {past.map((i) => (
                  <div key={i.id} className="flex items-start gap-2 rounded-xl border p-2.5 opacity-40">
                    <span className="mt-0.5 text-xs text-muted-foreground">{i.valid_date}</span>
                    <p className="flex-1 text-sm leading-snug line-through">{i.content}</p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0 text-destructive"
                      onClick={() => remove(i.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {globals.length === 0 && todays.length === 0 && past.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhuma instrução cadastrada ainda.</p>
          )}
        </div>
      )}
    </Card>
  );
}

// ============================================================
// Card de bairros atendidos (lista oficial, usada pelo sistema pra decidir
// área de entrega — tem prioridade sobre o cálculo por distância/km)
// ============================================================
function BairrosAtendidosCard() {
  const [bairros, setBairros] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNome, setNewNome] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNome, setEditingNome] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await (supabase as any).from("bairros_atendidos").select("*").order("nome", { ascending: true });
    setBairros(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    const nome = newNome.trim();
    if (!nome) return;
    setAdding(true);
    const { error } = await (supabase as any).from("bairros_atendidos").insert({ nome, ativo: true });
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Esse bairro já está cadastrado." : error.message);
      setAdding(false);
      return;
    }
    setNewNome("");
    toast.success("Bairro adicionado!");
    setAdding(false);
    load();
  }

  async function toggle(id: string, ativo: boolean) {
    await (supabase as any).from("bairros_atendidos").update({ ativo: !ativo }).eq("id", id);
    load();
  }

  function startEdit(b: any) {
    setEditingId(b.id);
    setEditingNome(b.nome);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingNome("");
  }

  async function saveEdit(id: string) {
    const nome = editingNome.trim();
    if (!nome) return;
    setSaving(true);
    const { error } = await (supabase as any).from("bairros_atendidos").update({ nome }).eq("id", id);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Esse bairro já está cadastrado." : error.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    cancelEdit();
    toast.success("Bairro atualizado!");
    load();
  }

  async function remove(id: string) {
    if (!window.confirm("Remover esse bairro da lista de atendidos?")) return;
    await (supabase as any).from("bairros_atendidos").delete().eq("id", id);
    load();
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">📍 Bairros atendidos</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Lista oficial de bairros atendidos pelo entregador fixo (WhatsApp). Enquanto houver pelo menos 1 bairro{" "}
          <strong>ativo</strong> aqui, ela vira a fonte de verdade do sistema: um endereço num bairro desta lista{" "}
          <strong>nunca</strong> é marcado como fora de área — mesmo que o cálculo por distância (km) diga o contrário.
          Endereços em bairros fora desta lista são tratados como fora de área e a IA direciona o cliente pro iFood.
        </p>
      </div>

      {/* form para adicionar */}
      <div className="flex gap-2">
        <Input
          placeholder="Nome do bairro (ex: Vila São Luís)"
          value={newNome}
          onChange={(e) => setNewNome(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="rounded-xl text-sm"
        />
        <Button size="sm" onClick={add} disabled={adding || !newNome.trim()}>
          <Plus className="size-4" /> Adicionar
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : bairros.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum bairro cadastrado ainda — enquanto a lista estiver vazia, a área de entrega continua decidida só pelo
          cálculo de distância.
        </p>
      ) : (
        <div className="space-y-2">
          {bairros.map((b) => (
            <div
              key={b.id}
              className={`flex items-center gap-2 rounded-xl border p-2.5 ${b.ativo ? "bg-emerald-50 border-emerald-200" : "opacity-50"}`}
            >
              <Switch checked={b.ativo} onCheckedChange={() => toggle(b.id, b.ativo)} className="shrink-0" />
              {editingId === b.id ? (
                <>
                  <Input
                    value={editingNome}
                    onChange={(e) => setEditingNome(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(b.id)}
                    className="h-8 flex-1 rounded-lg text-sm"
                    autoFocus
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-emerald-600"
                    onClick={() => saveEdit(b.id)}
                    disabled={saving || !editingNome.trim()}
                  >
                    <Check className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={cancelEdit}>
                    <X className="size-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <p className="flex-1 text-sm leading-snug">{b.nome}</p>
                  <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => startEdit(b)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-destructive"
                    onClick={() => remove(b.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ============================================================
// Card de bairros NÃO atendidos (bloqueio explícito — prioridade máxima,
// vale mais até que a lista de bairros atendidos e que qualquer cálculo
// por distância/km). Ver applyBairroOverride() em webhooks.evolution.ts.
// ============================================================
function BairrosNaoAtendidosCard() {
  const [bairros, setBairros] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNome, setNewNome] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNome, setEditingNome] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("bairros_nao_atendidos")
      .select("*")
      .order("nome", { ascending: true });
    setBairros(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    const nome = newNome.trim();
    if (!nome) return;
    setAdding(true);
    const { error } = await (supabase as any).from("bairros_nao_atendidos").insert({ nome, ativo: true });
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Esse bairro já está cadastrado." : error.message);
      setAdding(false);
      return;
    }
    setNewNome("");
    toast.success("Bairro adicionado à lista de não atendidos!");
    setAdding(false);
    load();
  }

  async function toggle(id: string, ativo: boolean) {
    await (supabase as any).from("bairros_nao_atendidos").update({ ativo: !ativo }).eq("id", id);
    load();
  }

  function startEdit(b: any) {
    setEditingId(b.id);
    setEditingNome(b.nome);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingNome("");
  }

  async function saveEdit(id: string) {
    const nome = editingNome.trim();
    if (!nome) return;
    setSaving(true);
    const { error } = await (supabase as any).from("bairros_nao_atendidos").update({ nome }).eq("id", id);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Esse bairro já está cadastrado." : error.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    cancelEdit();
    toast.success("Bairro atualizado!");
    load();
  }

  async function remove(id: string) {
    if (!window.confirm("Remover esse bairro da lista de não atendidos?")) return;
    await (supabase as any).from("bairros_nao_atendidos").delete().eq("id", id);
    load();
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">🚫 Bairros não atendidos</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Bairros onde a loja <strong>nunca</strong> entrega, mesmo que pareçam próximos ou dentro do raio de
          distância. Um bairro cadastrado aqui tem <strong>prioridade máxima</strong>: a IA nunca vai dizer que
          entrega nele, mesmo que ele também esteja (por engano) na lista de bairros atendidos, ou que o cálculo por
          km diga que está dentro da área.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Nome do bairro (ex: Parque Fluminense)"
          value={newNome}
          onChange={(e) => setNewNome(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="rounded-xl text-sm"
        />
        <Button size="sm" onClick={add} disabled={adding || !newNome.trim()}>
          <Plus className="size-4" /> Adicionar
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : bairros.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum bairro bloqueado cadastrado ainda.</p>
      ) : (
        <div className="space-y-2">
          {bairros.map((b) => (
            <div
              key={b.id}
              className={`flex items-center gap-2 rounded-xl border p-2.5 ${b.ativo ? "bg-red-50 border-red-200" : "opacity-50"}`}
            >
              <Switch checked={b.ativo} onCheckedChange={() => toggle(b.id, b.ativo)} className="shrink-0" />
              {editingId === b.id ? (
                <>
                  <Input
                    value={editingNome}
                    onChange={(e) => setEditingNome(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(b.id)}
                    className="h-8 flex-1 rounded-lg text-sm"
                    autoFocus
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-emerald-600"
                    onClick={() => saveEdit(b.id)}
                    disabled={saving || !editingNome.trim()}
                  >
                    <Check className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={cancelEdit}>
                    <X className="size-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <p className="flex-1 text-sm leading-snug">{b.nome}</p>
                  <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => startEdit(b)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-destructive"
                    onClick={() => remove(b.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ============================================================
// Card de ruas NÃO atendidas (bloqueio explícito por rua específica —
// mesma prioridade máxima do card de bairros não atendidos, útil quando só
// um trecho/rua específica de um bairro atendido não pode ser entregue).
// ============================================================
function RuasNaoAtendidasCard() {
  const [ruas, setRuas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNome, setNewNome] = useState("");
  const [newBairro, setNewBairro] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNome, setEditingNome] = useState("");
  const [editingBairro, setEditingBairro] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("ruas_nao_atendidas")
      .select("*")
      .order("nome", { ascending: true });
    setRuas(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    const nome = newNome.trim();
    if (!nome) return;
    setAdding(true);
    const { error } = await (supabase as any)
      .from("ruas_nao_atendidas")
      .insert({ nome, bairro: newBairro.trim() || null, ativo: true });
    if (error) {
      toast.error(error.message);
      setAdding(false);
      return;
    }
    setNewNome("");
    setNewBairro("");
    toast.success("Rua adicionada à lista de não atendidas!");
    setAdding(false);
    load();
  }

  async function toggle(id: string, ativo: boolean) {
    await (supabase as any).from("ruas_nao_atendidas").update({ ativo: !ativo }).eq("id", id);
    load();
  }

  function startEdit(r: any) {
    setEditingId(r.id);
    setEditingNome(r.nome);
    setEditingBairro(r.bairro ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingNome("");
    setEditingBairro("");
  }

  async function saveEdit(id: string) {
    const nome = editingNome.trim();
    if (!nome) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("ruas_nao_atendidas")
      .update({ nome, bairro: editingBairro.trim() || null })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    cancelEdit();
    toast.success("Rua atualizada!");
    load();
  }

  async function remove(id: string) {
    if (!window.confirm("Remover essa rua da lista de não atendidas?")) return;
    await (supabase as any).from("ruas_nao_atendidas").delete().eq("id", id);
    load();
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">🚫 Ruas não atendidas</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Ruas específicas onde a loja <strong>nunca</strong> entrega — mesma prioridade máxima do card de bairros
          não atendidos. Use quando o problema é só uma rua/trecho específico, não o bairro inteiro (que pode
          continuar sendo atendido normalmente). O campo de bairro é opcional, só ajuda a organizar a lista.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Nome da rua (ex: Rua das Palmeiras)"
          value={newNome}
          onChange={(e) => setNewNome(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="rounded-xl text-sm"
        />
        <Input
          placeholder="Bairro (opcional)"
          value={newBairro}
          onChange={(e) => setNewBairro(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="w-40 rounded-xl text-sm"
        />
        <Button size="sm" onClick={add} disabled={adding || !newNome.trim()}>
          <Plus className="size-4" /> Adicionar
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : ruas.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma rua bloqueada cadastrada ainda.</p>
      ) : (
        <div className="space-y-2">
          {ruas.map((r) => (
            <div
              key={r.id}
              className={`flex items-center gap-2 rounded-xl border p-2.5 ${r.ativo ? "bg-red-50 border-red-200" : "opacity-50"}`}
            >
              <Switch checked={r.ativo} onCheckedChange={() => toggle(r.id, r.ativo)} className="shrink-0" />
              {editingId === r.id ? (
                <>
                  <Input
                    value={editingNome}
                    onChange={(e) => setEditingNome(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(r.id)}
                    className="h-8 flex-1 rounded-lg text-sm"
                    autoFocus
                  />
                  <Input
                    value={editingBairro}
                    onChange={(e) => setEditingBairro(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(r.id)}
                    placeholder="Bairro (opcional)"
                    className="h-8 w-36 rounded-lg text-sm"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-emerald-600"
                    onClick={() => saveEdit(r.id)}
                    disabled={saving || !editingNome.trim()}
                  >
                    <Check className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={cancelEdit}>
                    <X className="size-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <p className="flex-1 text-sm leading-snug">
                    {r.nome}
                    {r.bairro ? <span className="text-muted-foreground"> — {r.bairro}</span> : null}
                  </p>
                  <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => startEdit(r)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-destructive"
                    onClick={() => remove(r.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

type BusinessHourRange = { days: number[]; open: string; close: string };

function formatRangeDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const labels = sorted.map((d) => WEEKDAYS.find((w) => w.value === d)?.label ?? "");
  return labels.join(", ");
}

/** Botão de abrir/fechar a loja manualmente — sobrepõe o horário automático
 *  abaixo. Enquanto estiver em "Aberta manualmente" ou "Fechada
 *  manualmente", o horário configurado no card abaixo é ignorado pela IA. */
function ManualStoreStatusCard() {
  const [status, setStatus] = useState<"auto" | "open" | "closed">("auto");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("store_config")
      .select("manual_store_status")
      .eq("id", 1)
      .maybeSingle();
    setStatus((data?.manual_store_status as "open" | "closed" | null) || "auto");
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function setManualStatus(next: "auto" | "open" | "closed") {
    setSaving(true);
    const { error } = await (supabase as any)
      .from("store_config")
      .upsert({ id: 1, manual_store_status: next === "auto" ? null : next });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setStatus(next);
    toast.success(
      next === "auto"
        ? "Voltou a seguir o horário automático."
        : next === "open"
          ? "Loja aberta manualmente — a IA atende normalmente, mesmo fora do horário configurado."
          : "Loja fechada manualmente — a IA vai avisar que está fechada, mesmo dentro do horário configurado.",
    );
  }

  const OPTIONS: { value: "auto" | "open" | "closed"; label: string; desc: string }[] = [
    { value: "auto", label: "Automático", desc: "Segue o horário configurado abaixo" },
    { value: "open", label: "Forçar aberta", desc: "IA atende, mesmo fora do horário" },
    { value: "closed", label: "Forçar fechada", desc: "IA informa que está fechada, mesmo no horário" },
  ];

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Abrir/fechar loja agora</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Sobrepõe o horário de atendimento configurado abaixo — sempre que você abrir ou fechar a loja por aqui,
            essa escolha manda na hora, e a IA acata ela.
          </p>
        </div>
        {!loading && status !== "auto" && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
              status === "open" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
            }`}
          >
            {status === "open" ? "Aberta manualmente" : "Fechada manualmente"}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {OPTIONS.map((opt) => {
              const active = status === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={saving}
                  onClick={() => setManualStatus(opt.value)}
                  className={`rounded-lg border p-3 text-left text-xs transition-colors disabled:opacity-60 ${
                    active ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border hover:bg-muted"
                  }`}
                >
                  <div>{opt.label}</div>
                  <div className="mt-0.5 text-[10px] font-normal text-muted-foreground">{opt.desc}</div>
                </button>
              );
            })}
          </div>
          {status === "closed" && (
            <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">
              Enquanto estiver em "Forçar fechada", a IA responde a qualquer contato com: <br />
              <span className="italic">
                "Estamos fechados devido a problemas na nossa operação. Amanhã abriremos normalmente."
              </span>
            </p>
          )}
        </>
      )}
    </Card>
  );
}


function BusinessHoursCard() {
  const [enabled, setEnabled] = useState(false);
  const [ranges, setRanges] = useState<BusinessHourRange[]>([]);
  const [closedMessage, setClosedMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("store_config")
      .select("business_hours, business_hours_enabled, business_hours_closed_message")
      .eq("id", 1)
      .maybeSingle();
    setEnabled(!!data?.business_hours_enabled);
    setRanges(Array.isArray(data?.business_hours) ? data.business_hours : []);
    setClosedMessage(data?.business_hours_closed_message || "");
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function addRange() {
    setRanges((prev) => [...prev, { days: [4, 5, 6, 0], open: "18:00", close: "00:00" }]);
  }

  function removeRange(idx: number) {
    setRanges((prev) => prev.filter((_, i) => i !== idx));
  }

  function toggleDay(idx: number, day: number) {
    setRanges((prev) =>
      prev.map((r, i) =>
        i !== idx
          ? r
          : {
              ...r,
              days: r.days.includes(day) ? r.days.filter((d) => d !== day) : [...r.days, day],
            },
      ),
    );
  }

  function updateRange(idx: number, field: "open" | "close", value: string) {
    setRanges((prev) => prev.map((r, i) => (i !== idx ? r : { ...r, [field]: value })));
  }

  async function save() {
    setSaving(true);
    const cleanRanges = ranges.filter((r) => r.days.length > 0 && r.open && r.close);
    const { error } = await (supabase as any).from("store_config").upsert({
      id: 1,
      business_hours_enabled: enabled,
      business_hours: cleanRanges,
      business_hours_closed_message: closedMessage.trim() || null,
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      setRanges(cleanRanges);
      toast.success("Horário de atendimento salvo!");
    }
  }

  const previewText = ranges.length
    ? ranges.map((r) => `${formatRangeDays(r.days)} das ${r.open} às ${r.close}`).join(" · ")
    : "nenhum horário cadastrado ainda";

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Horário de atendimento</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure os dias e horários em que a loja atende. Fora desse horário, a IA avisa automaticamente que a loja
            está fechada e informa quando volta a atender — sem processar pedido novo enquanto estiver fechada.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Label className="text-xs">{enabled ? "Ativado" : "Desativado"}</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : (
        <>
          <div className="space-y-3">
            {ranges.map((r, idx) => (
              <div key={idx} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((wd) => {
                    const active = r.days.includes(wd.value);
                    return (
                      <button
                        key={wd.value}
                        type="button"
                        onClick={() => toggleDay(idx, wd.value)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {wd.label}
                      </button>
                    );
                  })}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="ml-auto size-7 text-destructive"
                    onClick={() => removeRange(idx)}
                    title="Remover essa faixa de horário"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Abre às</Label>
                    <Input type="time" value={r.open} onChange={(e) => updateRange(idx, "open", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Fecha às</Label>
                    <Input type="time" value={r.close} onChange={(e) => updateRange(idx, "close", e.target.value)} />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Se fechar depois da meia-noite, use 00:00 — o sistema entende que é no dia seguinte.
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Button type="button" variant="outline" size="sm" onClick={addRange} className="gap-1">
            + Adicionar faixa de horário
          </Button>

          <div>
            <Label>Mensagem de fora de horário (opcional)</Label>
            <Textarea
              rows={3}
              value={closedMessage}
              onChange={(e) => setClosedMessage(e.target.value)}
              placeholder={`Olá, obrigado pelo seu contato! Nossos dias e horários de funcionamento são: ${previewText}. Assim que abrirmos, respondemos por aqui.`}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Deixe em branco pra usar a mensagem padrão do sistema, que já cita os dias e horários acima
              automaticamente.
            </p>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Horário configurado: </span>
            {previewText}
          </div>

          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar horário de atendimento"}
          </Button>
        </>
      )}
    </Card>
  );
}

const WALLPAPER_OPTIONS = [
  { value: "classic", label: "Bege clássico (cor sólida)", thumb: null as string | null },
  { value: "whatsapp_teal", label: "Oficial do WhatsApp — verde escuro", thumb: wallpaperTeal },
  { value: "whatsapp_beige", label: "Oficial do WhatsApp — bege claro", thumb: wallpaperBeige },
];

/** Card de aparência do chat: escolha do papel de parede da conversa em
 *  /loja/chat, incluindo os dois papéis de parede oficiais do WhatsApp. */
function ChatWallpaperCard() {
  const [wallpaper, setWallpaper] = useState("classic");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await (supabase as any).from("store_config").select("chat_wallpaper").eq("id", 1).maybeSingle();
    setWallpaper(data?.chat_wallpaper || "classic");
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(value: string) {
    setWallpaper(value);
    setSaving(true);
    const { error } = await (supabase as any)
      .from("store_config")
      .upsert({ id: 1, chat_wallpaper: value }, { onConflict: "id" });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      // avisa a tela de chat (mesma aba) para trocar o fundo na hora
      window.dispatchEvent(new CustomEvent("hb:chat-wallpaper", { detail: value }));
      toast.success("Papel de parede do chat atualizado!");
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Aparência do chat</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Escolha o papel de parede da tela de conversas em /loja/chat — inclui os dois papéis de parede oficiais do
          WhatsApp.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {WALLPAPER_OPTIONS.map((opt) => {
            const active = wallpaper === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={saving}
                onClick={() => save(opt.value)}
                className={`overflow-hidden rounded-lg border-2 text-left transition ${
                  active ? "border-primary ring-2 ring-primary/30" : "border-input hover:border-primary/50"
                }`}
              >
                <div
                  className="h-20 w-full"
                  style={
                    opt.thumb
                      ? {
                          backgroundImage: `url(${opt.thumb})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : { backgroundColor: "#E5DDD5" }
                  }
                />
                <div className="flex items-center gap-1 p-2">
                  {active && <Check className="size-3.5 shrink-0 text-primary" />}
                  <span className="text-[11px] font-medium leading-tight">{opt.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function MenuImagesCard() {
  const [images, setImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("menu_images").select("*").order("created_at", { ascending: true });
    setImages(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `cardapio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("cardapio-imagens")
          .upload(path, file, { upsert: false, contentType: file.type });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("cardapio-imagens").getPublicUrl(path);
        const { error: insErr } = await supabase.from("menu_images").insert({
          url: pub.publicUrl,
          storage_path: path,
          filename: file.name,
        });
        if (insErr) throw insErr;
      }
      toast.success("Imagem(ns) enviada(s)!");
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao enviar imagem");
    } finally {
      setUploading(false);
    }
  }

  async function remove(img: any) {
    if (!window.confirm("Remover essa imagem do cardápio?")) return;
    try {
      if (img.storage_path) {
        await supabase.storage.from("cardapio-imagens").remove([img.storage_path]);
      }
      await supabase.from("menu_images").delete().eq("id", img.id);
      load();
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao remover imagem");
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">🖼️ Imagens do cardápio</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Envie fotos ou prints do cardápio. Quando um cliente pedir o cardápio pelo WhatsApp, a IA envia essas imagens
          automaticamente antes de continuar o atendimento. Você pode adicionar mais de uma (ex: página 1, página 2).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="gap-2"
        >
          <Upload className="size-4" />
          {uploading ? "Enviando..." : "Enviar imagem(ns)"}
        </Button>
        <p className="text-xs text-muted-foreground">JPG ou PNG. Envie na ordem que devem aparecer.</p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : images.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
          Nenhuma imagem cadastrada ainda.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {images.map((img) => (
            <div key={img.id} className="group relative overflow-hidden rounded-xl border">
              <img src={img.url} alt={img.filename ?? "cardápio"} className="aspect-square w-full object-cover" />
              <Button
                size="icon"
                variant="destructive"
                className="absolute right-1.5 top-1.5 size-7 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => remove(img)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Campos que têm card próprio (com salvamento independente). O formulário geral
 *  carrega a config uma vez ao abrir a tela, então salvar o form depois de mudar
 *  esses cards regravaria os valores antigos — por isso eles são removidos aqui. */
const CARD_OWNED_FIELDS = [
  "business_hours",
  "business_hours_enabled",
  "business_hours_closed_message",
  "manual_store_status",
  "chat_wallpaper",
] as const;

function stripCardOwnedFields<T extends Record<string, any>>(payload: T): T {
  const clone: Record<string, any> = { ...payload };
  for (const key of CARD_OWNED_FIELDS) delete clone[key];
  return clone as T;
}
