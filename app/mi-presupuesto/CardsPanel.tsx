"use client";

import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { money, type Card } from "./budget";

function BalanceChart({ card }: { card: Card }) {
  // Long histories show the most recent charges, each one step along the axis.
  const balances = card.balances.length < 15 ? [card.opening_available, ...card.balances] : card.balances;
  const high = Math.max(...balances);
  const low = Math.min(...balances);
  const points = balances.map((balance, index) => ({
    x: balances.length === 1 ? 8 : 8 + 304 * index / (balances.length - 1),
    y: high === low ? 36 : 64 - 56 * (balance - low) / (high - low),
    balance,
  }));
  return <figure className="balance-chart">
    <figcaption>{card.balances.length ? "Disponible después de cada gasto" : "Disponible inicial"}</figcaption>
    <svg viewBox="0 0 320 72" role="img" aria-label={`Disponible de ${card.name}, de ${money(balances[0])} a ${money(card.available)}`}>
      <path d="M8 64H312" stroke="#cbd5e1" fill="none" />
      <polyline points={points.map(p => p.x + "," + p.y).join(" ")} fill="none" stroke="currentColor" strokeWidth="2.5" />
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill="currentColor"><title>{money(p.balance)}</title></circle>)}
    </svg>
    <small>{card.balances.length ? `${money(balances[0])} → ${money(card.available)} · Últimos ${card.balances.length} gastos` : "El primer gasto iniciará la línea de saldo."}</small>
  </figure>;
}

export default function CardsPanel({ owner, cards, onSave }: { owner: string; cards: Card[]; onSave: () => void }) {
  const [type, setType] = useState<Card["card_type"]>("Crédito");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setNotice("");
    try {
      const { error } = await supabase.from("personal_cards").insert({
        owner_id: owner, name: String(values.get("name")).trim(), card_type: type,
        opening_available: values.get("available"), cutoff_day: values.get("cutoff") || null,
      });
      if (error) throw error;
      form.reset();
      setType("Crédito");
      onSave();
    } catch {
      setNotice("No se pudo confirmar el registro. Revisa tus tarjetas antes de volver a intentar.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <details className="card-form" open={cards.length === 0 || undefined}><summary>Registrar tarjeta</summary>
      <form onSubmit={create}><fieldset disabled={busy}>
        <label>Nombre de la tarjeta<input name="name" maxLength={60} pattern=".*\S.*" placeholder="Ej. BBVA personal" required /></label>
        <label>Tipo de tarjeta<select value={type} onChange={e => setType(e.target.value as Card["card_type"])}><option>Crédito</option><option>Débito</option></select></label>
        <label>{type === "Crédito" ? "Crédito disponible actual (MXN)" : "Saldo disponible actual (MXN)"}<input name="available" type="number" min="0" max="999999999999.99" step="0.01" inputMode="decimal" required /></label>
        <label>Día de corte mensual{type === "Débito" && " (opcional)"}<input type="number" name="cutoff" step="1" min="1" max="31" required={type === "Crédito"} placeholder="1–31" /></label>
        <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Registrar tarjeta"}</button>
      </fieldset></form><p role="status">{notice}</p>
    </details>
    <div className="personal-cards">{cards.map(card => <article key={card.id}>
      <h3>{card.name}</h3><small>{card.card_type}{card.cutoff_day && " · Corte el día " + card.cutoff_day}</small>
      <p>{card.card_type === "Crédito" ? "Crédito disponible" : "Saldo disponible"} <strong>{money(card.available)}</strong></p>
      <BalanceChart card={card} />
    </article>)}</div>
  </>;
}
