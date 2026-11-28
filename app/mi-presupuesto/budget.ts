export const periods = ["Día", "Semana", "Mes", "Año"] as const;
export type Period = typeof periods[number];
export const kinds = ["Gasto", "Ingreso", "Ahorro"] as const;
export type Kind = typeof kinds[number];
export const categories = ["Alimentos", "Transporte", "Entretenimiento", "Cuidado personal", "Salud", "Hogar", "Suscripciones", "Ropa", "Otros"];
export const money = (value: number) => value.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

export function savingsConcept(goalName?: string) {
  return ("Ahorro " + (goalName || "general")).toLocaleUpperCase("es-MX");
}

export function localDate(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function periodBounds(day: string, period: Period) {
  const start = new Date(day + "T00:00:00");
  if (period === "Semana") start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  if (period === "Mes" || period === "Año") start.setDate(1);
  if (period === "Año") start.setMonth(0);
  const end = new Date(start);
  if (period === "Año") end.setFullYear(start.getFullYear() + 1);
  else if (period === "Mes") end.setMonth(start.getMonth() + 1);
  else end.setDate(start.getDate() + (period === "Semana" ? 7 : 1));
  return { period_start: start.toISOString(), period_end: end.toISOString() };
}

export type Entry = { id: string; kind: Kind; amount: number; category: string; occurred_at: string; concept: string; method: string; date_only: string | null; card_id: string | null; goal_id: string | null };
export type Goal = { id: string; name: string; target: number; saved: number; completed_at: string | null };
export type Card = { id: string; name: string; card_type: "Crédito" | "Débito"; cutoff_day: number | null; archived_at: string | null; credit_limit: number | null; opening_available: number; available: number; balances: number[] };
export type Summary = { cards: Card[]; entries: Entry[]; goals: Goal[]; general: number };

export function summarize(entries: Entry[]) {
  const totals = { Gasto: 0, Ingreso: 0, Ahorro: 0 };
  const spending = new Map<string, number>();
  for (const entry of entries) {
    const cents = Math.round(entry.amount * 100);
    totals[entry.kind] += cents;
    if (entry.kind === "Gasto") spending.set(entry.category, (spending.get(entry.category) ?? 0) + cents);
  }
  return {
    expense: totals.Gasto / 100, income: totals.Ingreso / 100, savings: totals.Ahorro / 100,
    available: (totals.Ingreso - totals.Gasto - totals.Ahorro) / 100,
    ranking: Array.from(spending).sort((a, b) => b[1] - a[1]).map(([name, cents]) => ({
      name, amount: cents / 100, percent: cents * 100 / totals.Gasto,
    })),
  };
}
