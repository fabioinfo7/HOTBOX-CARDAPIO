export const BRASILIA_TIME_ZONE = "America/Sao_Paulo";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRASILIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BRASILIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsMap(parts: Intl.DateTimeFormatPart[]) {
  const out: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") out[p.type] = p.value;
  return out;
}

export function brasiliaDateISO(date = new Date()): string {
  const p = partsMap(dateFmt.formatToParts(date));
  return `${p.year}-${p.month}-${p.day}`;
}

export function brasiliaDateDaysAgo(days: number): string {
  const [y, m, d] = brasiliaDateISO().split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d - Math.max(0, days)));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

export function brasiliaMonthStart(): string {
  return `${brasiliaDateISO().slice(0, 7)}-01`;
}

/** Converte um horário civil de Brasília em instante UTC ISO para consultas timestamptz. */
export function brasiliaLocalToUtcISO(
  dateISO: string,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);

  // Descobre o offset real de America/Sao_Paulo naquele instante. Faz duas
  // passagens para continuar correto caso a legislação de horário mude no futuro.
  let guess = desiredAsUtc;
  for (let i = 0; i < 2; i++) {
    const p = partsMap(dateTimeFmt.formatToParts(new Date(guess)));
    const representedAsUtc = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour), Number(p.minute), Number(p.second),
    );
    const offsetMs = representedAsUtc - guess;
    guess = desiredAsUtc - offsetMs;
  }
  return new Date(guess).toISOString();
}

export function brasiliaDayRange(from: string, to: string) {
  return {
    since: brasiliaLocalToUtcISO(from, 0, 0, 0, 0),
    until: brasiliaLocalToUtcISO(to, 23, 59, 59, 999),
  };
}

export function brasiliaPeriodStartISO(days: number): string {
  return brasiliaLocalToUtcISO(brasiliaDateDaysAgo(Math.max(0, days - 1)), 0, 0, 0, 0);
}
