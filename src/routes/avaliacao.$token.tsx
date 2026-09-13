import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Heart, Loader2, MessageSquareText, Star } from "lucide-react";
import { getPublicFeedbackFn, submitPublicFeedbackFn } from "@/lib/satisfaction.functions";

import hotboxLogoUrl from "@/assets/logo-hotbox.jpeg";

const HOTBOX_LOGO_URL = hotboxLogoUrl;

export const Route = createFileRoute("/avaliacao/$token")({
  component: FeedbackPage,
});

type Ratings = {
  service: number;
  delivery: number;
  flavor: number;
  appearance: number;
};

const ITEMS: { key: keyof Ratings; label: string; hint: string }[] = [
  { key: "service", label: "Atendimento", hint: "Cordialidade e atenção" },
  { key: "delivery", label: "Tempo de entrega", hint: "Agilidade do seu pedido" },
  { key: "flavor", label: "Sabor", hint: "Qualidade e tempero" },
  { key: "appearance", label: "Aparência", hint: "Apresentação do produto" },
];

function StarPicker({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          aria-label={`${star} ${star === 1 ? "estrela" : "estrelas"}`}
          aria-pressed={value === star}
          onClick={() => onChange(star)}
          className="rounded-lg p-1 transition active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          <Star className={`size-8 ${star <= value ? "fill-amber-400 text-amber-400" : "text-zinc-300"}`} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}

function FeedbackPage() {
  const { token } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [found, setFound] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [ratings, setRatings] = useState<Ratings>({ service: 0, delivery: 0, flavor: 0, appearance: 0 });

  useEffect(() => {
    getPublicFeedbackFn({ data: { token } })
      .then((result) => {
        setFound(result.found);
        if (result.found) {
          setCustomerName(result.customerName);
          setSubmitted(result.submitted);
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  const complete = useMemo(() => [ratings.service, ratings.delivery, ratings.flavor, ratings.appearance].every((value) => value >= 1 && value <= 5), [ratings]);

  async function submit() {
    if (!complete) {
      setError("Para enviar, dê de 1 a 5 estrelas em todos os quatro itens.");
      return;
    }
    setSaving(true);
    setError("");
    const result = await submitPublicFeedbackFn({
      data: {
        token,
        serviceRating: ratings.service,
        deliveryRating: ratings.delivery,
        flavorRating: ratings.flavor,
        appearanceRating: ratings.appearance,
        comment,
      },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error || "Não foi possível enviar sua avaliação.");
      return;
    }
    setSubmitted(true);
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-zinc-950"><Loader2 className="size-8 animate-spin text-amber-400" /></div>;
  }

  if (!found) {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-950 p-5 text-white">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-7 text-center shadow-2xl">
          <img src={HOTBOX_LOGO_URL} alt="HotBox Delivery" className="mx-auto mb-6 h-20 w-auto object-contain" />
          <h1 className="text-2xl font-bold">Link não encontrado</h1>
          <p className="mt-2 text-sm text-zinc-300">Este link de avaliação não é válido.</p>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-950 p-5 text-white">
        <div className="w-full max-w-md rounded-3xl border border-emerald-500/20 bg-white p-8 text-center text-zinc-900 shadow-2xl">
          <img src={HOTBOX_LOGO_URL} alt="HotBox Delivery" className="mx-auto mb-5 h-20 w-auto object-contain" />
          <CheckCircle2 className="mx-auto size-14 text-emerald-500" />
          <h1 className="mt-4 text-2xl font-extrabold">Muito obrigado!</h1>
          <p className="mt-3 text-zinc-600">Sua avaliação foi recebida. Ela nos ajuda a melhorar ainda mais e entregar uma experiência cada vez melhor para você.</p>
          <Heart className="mx-auto mt-5 size-6 fill-red-500 text-red-500" />
        </div>
      </main>
    );
  }

  const firstName = customerName?.trim().split(/\s+/)[0];

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-white sm:py-10">
      <div className="mx-auto w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-white text-zinc-900 shadow-2xl">
        <div className="bg-gradient-to-br from-zinc-950 via-zinc-900 to-red-950 px-6 pb-7 pt-6 text-white">
          <img src={HOTBOX_LOGO_URL} alt="HotBox Delivery" className="h-16 w-auto object-contain" />
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-300 ring-1 ring-amber-400/25">
            <Star className="size-3.5 fill-current" /> Leva cerca de 20 segundos
          </div>
          <h1 className="mt-3 text-2xl font-extrabold leading-tight">{firstName ? `${firstName}, ` : ""}como foi sua experiência?</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">Sua avaliação é muito importante e nos ajuda a melhorar ainda mais. É só tocar nas estrelas.</p>
        </div>

        <div className="space-y-3 p-4 sm:p-5">
          {ITEMS.map((item) => (
            <section key={item.key} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="mb-2">
                <h2 className="font-bold">{item.label}<span className="ml-1 text-red-500">*</span></h2>
                <p className="text-xs text-zinc-500">{item.hint}</p>
              </div>
              <StarPicker
                label={item.label}
                value={ratings[item.key]}
                onChange={(value) => {
                  setRatings((prev) => ({ ...prev, [item.key]: value }));
                  setError("");
                }}
              />
            </section>
          ))}

          <section className="rounded-2xl border border-zinc-200 p-4">
            <label htmlFor="feedback-comment" className="flex items-center gap-2 font-bold">
              <MessageSquareText className="size-4" /> Quer contar algo a mais?
            </label>
            <p className="mt-1 text-xs text-zinc-500">Opcional — elogio, sugestão ou algo que podemos melhorar.</p>
            <textarea
              id="feedback-comment"
              rows={4}
              maxLength={1200}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Escreva aqui se quiser…"
              className="mt-3 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
            />
          </section>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-4 font-extrabold text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <><Loader2 className="size-5 animate-spin" /> Enviando…</> : "Enviar minha avaliação"}
          </button>
          <p className="pb-1 text-center text-[11px] text-zinc-400">As estrelas são obrigatórias. O comentário é opcional.</p>
        </div>
      </div>
    </main>
  );
}
