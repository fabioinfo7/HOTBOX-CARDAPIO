import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { calculateFreightFn } from "@/lib/freight.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  MapPin,
  Navigation,
  Sparkles,
  Calculator,
  AlertTriangle,
  Store,
  Truck,
  Ruler,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/loja/frete")({
  component: FretePage,
});

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Result = Awaited<ReturnType<typeof calculateFreightFn>>;

function FretePage() {
  const calc = useServerFn(calculateFreightFn);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    if (!address.trim()) {
      toast.error("Digite o endereço do cliente");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const r = await calc({ data: { rawAddress: address } });
      setResult(r);
      if ((r as any).error) toast.error((r as any).error);
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao calcular");
    } finally {
      setLoading(false);
    }
  }

  const ok = result && !("error" in result && (result as any).error);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Truck className="size-6 text-primary" /> Calculadora de Frete
        </h1>
        <p className="text-sm text-muted-foreground">
          Cole o endereço do cliente — a IA formata, o sistema mede a distância real da rota e aplica a faixa de km
          configurada em <b>Configurações → Entrega</b>.
        </p>
      </div>

      <Card className="p-5">
        <Label htmlFor="endereco" className="text-sm font-semibold">
          Endereço do cliente
        </Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Pode ser bagunçado (ex: "rua das flores, 123 perto do mercado do zé, bairro centro").
        </p>
        <Textarea
          id="endereco"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Digite ou cole o endereço aqui..."
          rows={3}
          className="mt-2"
        />
        <div className="mt-3 flex gap-2">
          <Button onClick={run} disabled={loading} size="lg" className="gap-2">
            {loading ? (
              <>Calculando...</>
            ) : (
              <>
                <Calculator className="size-4" /> Calcular frete
              </>
            )}
          </Button>
          {result && (
            <Button variant="outline" size="lg" onClick={() => { setAddress(""); setResult(null); }}>
              Limpar
            </Button>
          )}
        </div>
      </Card>

      {result && (result as any).error && (
        <Card className="border-destructive/50 bg-destructive/5 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold text-destructive">Não deu para calcular</p>
              <p className="text-sm text-destructive/90">{(result as any).error}</p>
            </div>
          </div>
        </Card>
      )}

      {ok && (result as any).distanceKm != null && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-5">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Ruler className="size-3.5" /> Distância
            </div>
            <p className="text-3xl font-black">
              {(result as any).distanceKm.toFixed(2)} <span className="text-lg font-bold text-muted-foreground">km</span>
            </p>
            {(result as any).uncertain && (
              <p className="mt-1 text-[11px] text-amber-700">Estimativa aproximada (rota não confirmada)</p>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Truck className="size-3.5" /> Valor do frete
            </div>
            <p className={`text-3xl font-black ${(result as any).outOfArea ? "text-destructive" : "text-primary"}`}>
              {brl((result as any).fee)}
            </p>
            {(result as any).outOfArea && (
              <p className="mt-1 text-[11px] font-semibold text-destructive">Fora da área de entrega</p>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Navigation className="size-3.5" /> Faixa aplicada
            </div>
            {(result as any).appliedTier ? (
              <>
                <p className="text-lg font-bold">
                  {(result as any).appliedTier.km_from} – {(result as any).appliedTier.km_to} km
                </p>
                <p className="text-xs text-muted-foreground">Taxa: {brl((result as any).appliedTier.fee)}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma faixa exata — usando a mais próxima ou reserva.</p>
            )}
          </Card>
        </div>
      )}

      {ok && (
        <Card className="space-y-4 p-5">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Store className="size-3.5" /> Endereço da loja
            </p>
            <p className="mt-1 text-sm">{(result as any).storeAddress ?? "(não configurado)"}</p>
          </div>

          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MapPin className="size-3.5" /> Endereço informado
            </p>
            <p className="mt-1 text-sm">{(result as any).rawAddress}</p>
          </div>

          {(result as any).aiUsed && (result as any).cleanAddress !== (result as any).rawAddress && (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                <Sparkles className="size-3.5" /> Endereço formatado pela IA
              </p>
              <p className="mt-1 text-sm font-semibold">{(result as any).cleanAddress}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                A IA limpou pontos de referência e ajustou o formato antes de mandar pro Google Maps.
              </p>
            </div>
          )}
        </Card>
      )}

      {ok && (result as any).tiers?.length > 0 && (
        <Card className="p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Faixas configuradas
          </p>
          <div className="space-y-1">
            {(result as any).tiers.map((t: any, i: number) => {
              const active =
                (result as any).appliedTier &&
                t.km_from === (result as any).appliedTier.km_from &&
                t.km_to === (result as any).appliedTier.km_to;
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${active ? "bg-primary/10 font-semibold" : "bg-muted/40"}`}
                >
                  <span>
                    {t.km_from} – {t.km_to} km
                  </span>
                  <span>{brl(t.fee)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
