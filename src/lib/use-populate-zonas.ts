import { useState } from "react";
import { toast } from "sonner";
import {
  fetchBairrosAtendidosFn,
  fetchOverpassCandidatesFn,
  fetchOverpassCandidatesForBairroFn,
  resolveZonaBatchFn,
  type ZonaCandidate,
} from "@/lib/zonas-populate.functions";

const BATCH_SIZE = 15;

export type PopulateProgress = { processed: number; total: number; label?: string } | null;

function dedupeKey(c: ZonaCandidate): string {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  return `${norm(c.bairro ?? "")}||${norm(c.rua)}`;
}

export function usePopulateZonas(onDone?: () => void) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PopulateProgress>(null);

  async function run() {
    setRunning(true);
    setProgress(null);
    try {
      // Se já existem bairros atendidos cadastrados (Configurações →
      // Bairros atendidos), a varredura busca o MÁXIMO de ruas dentro de
      // cada um deles (um bairro de cada vez), em vez de um raio a partir
      // da loja — cobre muito mais ruas e nunca traz rua de bairro errado.
      const { bairros } = await fetchBairrosAtendidosFn();

      let candidates: ZonaCandidate[] = [];

      if (bairros.length > 0) {
        toast.info(`Buscando ruas em ${bairros.length} bairro(s) atendido(s), um de cada vez...`);
        const seen = new Set<string>();
        const failedBairros: string[] = [];
        const emptyBairros: string[] = [];

        for (let i = 0; i < bairros.length; i++) {
          const bairro = bairros[i];
          setProgress({ processed: i, total: bairros.length, label: `Buscando em "${bairro}"...` });
          const res = await fetchOverpassCandidatesForBairroFn({ data: { bairro } });
          if ("error" in res && res.error) {
            failedBairros.push(bairro);
            continue;
          }
          const found = (res as { candidates: ZonaCandidate[] }).candidates ?? [];
          if (!found.length) {
            emptyBairros.push(bairro);
            continue;
          }
          for (const c of found) {
            const key = dedupeKey(c);
            if (seen.has(key)) continue;
            seen.add(key);
            candidates.push(c);
          }
        }
        setProgress(null);

        if (failedBairros.length) {
          toast.warning(`Não deu pra localizar: ${failedBairros.join(", ")}. Os outros bairros foram buscados normalmente.`);
        }
        if (emptyBairros.length) {
          toast.warning(
            `Localizei mas não achei nenhuma rua nomeada em: ${emptyBairros.join(", ")}. O OpenStreetMap pode não ter essas ruas mapeadas ainda — dá pra cadastrar manualmente essas ruas na tela.`,
          );
        }
        if (!candidates.length) {
          toast.error("Nenhuma rua encontrada nos bairros atendidos. Confira se os nomes estão corretos.");
          return;
        }
        toast.info(
          `Encontrei ${candidates.length} rua(s) nos bairros atendidos. Calculando distância de cada uma (pode demorar alguns minutos)...`,
        );
      } else {
        // sem bairro cadastrado ainda: cai pro modo antigo, por raio a
        // partir da loja (é o que orienta a pessoa a cadastrar os bairros
        // primeiro, pra próxima varredura já vir muito mais completa)
        const step1 = await fetchOverpassCandidatesFn();
        if ("error" in step1 && step1.error) {
          toast.error(step1.error);
          return;
        }
        candidates = (step1 as { candidates: ZonaCandidate[] }).candidates;
        if (!candidates?.length) {
          toast.error("Nenhuma rua encontrada nessa região. Confira as coordenadas da loja.");
          return;
        }
        toast.info(
          `Encontrei ${candidates.length} ruas na região (varredura por raio — cadastre os bairros atendidos em Configurações pra próxima vez ser mais precisa). Calculando distância e bairro de cada uma...`,
        );
      }

      let added = 0;
      let updated = 0;
      let outOfRange = 0;
      let foraDoBairro = 0;
      let assignedMaxTier = 0;
      let failed = 0;
      let suspicious = 0;

      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        const res = await resolveZonaBatchFn({ data: { candidates: batch } });
        if ("error" in res && res.error) {
          toast.error(res.error);
          break;
        }
        const r = res as {
          added: number;
          updated: number;
          outOfRange: number;
          foraDoBairro?: number;
          assignedMaxTier?: number;
          failed: number;
          suspicious?: number;
        };
        added += r.added;
        updated += r.updated;
        outOfRange += r.outOfRange;
        foraDoBairro += r.foraDoBairro ?? 0;
        assignedMaxTier += r.assignedMaxTier ?? 0;
        failed += r.failed;
        suspicious += r.suspicious ?? 0;
        setProgress({ processed: Math.min(i + BATCH_SIZE, candidates.length), total: candidates.length });
      }

      toast.success(
        `Varredura concluída: ${added} rua(s) nova(s), ${updated} atualizada(s)` +
          (outOfRange ? `, ${outOfRange} fora do raio de entrega` : "") +
          (foraDoBairro ? `, ${foraDoBairro} descartada(s) por não estarem nos bairros atendidos` : "") +
          (failed ? `, ${failed} não puderam ser medidas (tente repovoar de novo depois)` : "") +
          ".",
      );
      if (assignedMaxTier) {
        toast.info(
          `${assignedMaxTier} rua(s) do bairro atendido ficaram mais longe do que a maior faixa de km cadastrada — foram incluídas mesmo assim, usando o preço da faixa mais alta. Vale conferir se essa faixa cobre bem essas ruas.`,
        );
      }
      if (suspicious) {
        toast.warning(
          `${suspicious} rua(s) com distância suspeita (rota muito maior que a linha reta) — dá pra ver quais na tela, filtrando por "Distância suspeita". Vale conferir manualmente.`,
        );
      }
      onDone?.();
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao povoar a lista de ruas.");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return { run, running, progress };
}
