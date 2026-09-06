// Utilitário compartilhado de horário de atendimento — usado tanto no
// webhook da IA (pra saber quando responder normalmente vs avisar que está
// fechado) quanto nas telas do painel (pra mostrar o horário formatado, ex:
// na nota impressa). Mantido num lugar só pra nunca ter duas lógicas de
// formatação divergentes.

export type BusinessHourRange = { days: number[]; open: string; close: string };

const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => Number(n) || 0);
  return h * 60 + m;
}

export function formatHourLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((n) => Number(n) || 0);
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** Verifica se "agora" (fuso America/Sao_Paulo) cai dentro de alguma faixa configurada.
 *  Trata corretamente faixas que passam da meia-noite (ex: sexta 18h às 00h). */
export function isWithinBusinessHours(ranges: BusinessHourRange[], now: Date): boolean {
  const nowSP = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const day = nowSP.getDay();
  const yesterday = (day + 6) % 7;
  const minutes = nowSP.getHours() * 60 + nowSP.getMinutes();

  for (const r of ranges) {
    if (!r.days?.length || !r.open || !r.close) continue;
    const openMin = parseHHMM(r.open);
    const closeMinRaw = parseHHMM(r.close);
    const wrapsMidnight = closeMinRaw <= openMin;
    const closeMin = wrapsMidnight ? closeMinRaw + 24 * 60 : closeMinRaw;

    if (r.days.includes(day) && minutes >= openMin && minutes < closeMin) return true;
    if (wrapsMidnight && r.days.includes(yesterday) && minutes < closeMin - 24 * 60) return true;
  }
  return false;
}

/** Monta o texto legível dos dias e horários configurados, ex:
 *  "quinta a domingo das 18h às 00h" — agrupa dias consecutivos numa faixa. */
export function formatBusinessHoursText(ranges: BusinessHourRange[]): string {
  const parts = ranges
    .filter((r) => r.days?.length && r.open && r.close)
    .map((r) => {
      const sorted = [...r.days].sort((a, b) => a - b);
      const names = sorted.map((d) => WEEKDAY_NAMES[d]);
      const isConsecutiveBlock =
        sorted.length > 1 &&
        sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1) &&
        sorted.length === new Set(sorted).size;
      const daysText = isConsecutiveBlock
        ? `${names[0]} a ${names[names.length - 1]}`
        : names.length > 1
          ? `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`
          : names[0];
      return `${daysText} das ${formatHourLabel(r.open)} às ${formatHourLabel(r.close)}`;
    });
  return parts.join("; ");
}
