"use client";

import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { money, type Card } from "./budget";

function CardTile({ card }: { card: Card }) {
  const credit = card.card_type === "Crédito";
  const total = card.credit_limit ?? card.opening_available;
  const used = (Math.round(total * 100) - Math.round(card.available * 100)) / 100;
  const percent = total > 0 ? Math.min(100, Math.max(0, 100 * card.available / total)) : used === 0 ? 100 : 0;
  const baseLabel = credit ? (card.credit_limit == null ? "Crédito inicial registrado" : "Límite de crédito") : "Saldo inicial";
  return <article>
    <header><h3>{card.name}</h3><small>{card.card_type}{card.cutoff_day && " · Corte el día " + card.cutoff_day}</small></header>
    <div className="card-amounts">
      <div><small>{baseLabel}</small><strong>{money(total)}</strong></div>
      <div><small>Utilizado</small><strong>{money(used)}</strong></div>
    </div>
    <div><div className="row"><span>Disponible</span><b>{money(card.available)}</b></div>
      <progress aria-label={`Disponible de ${card.name}`} value={percent} max={100} />
    </div>
  </article>;
}

export default function CardsPanel({ owner, cards, onSave }: { owner: string; cards: Card[]; onSave: () => void }) {
  const [open, setOpen] = useState(false);
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
      const limit = type === "Crédito" ? Number(values.get("limit")) : null;
      const available = Number(values.get("available") || limit || 0);
      if (limit !== null && available > limit) {
        setNotice("El disponible no puede superar el límite de crédito.");
        return;
      }
      const { error } = await supabase.from("personal_cards").insert({
        owner_id: owner, name: String(values.get("name")).trim(), card_type: type,
        credit_limit: limit, opening_available: available, cutoff_day: values.get("cutoff") || null,
      });
      if (error) throw error;
      form.reset();
      setType("Crédito");
      setOpen(false);
      onSave();
    } catch {
      setNotice("No se pudo confirmar el registro. Revisa tus tarjetas antes de volver a intentar.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="goal-heading"><h2>Mis tarjetas</h2>
      <button type="button" className="primary" aria-controls="card-form" aria-expanded={open}
        onClick={() => setOpen(value => !value)}>Nueva tarjeta</button></div>
    <form className="card-form" id="card-form" hidden={!open} onSubmit={create}><fieldset disabled={busy}>
        <label>Nombre de la tarjeta<input name="name" maxLength={60} pattern=".*\S.*" placeholder="Ej. BBVA personal" required /></label>
        <label>Tipo de tarjeta<select value={type} onChange={e => setType(e.target.value as Card["card_type"])}><option>Crédito</option><option>Débito</option></select></label>
        {type === "Crédito" && <label>Límite de crédito (MXN)<input name="limit" type="number" min="0" max="999999999999.99" step="0.01" inputMode="decimal" required /></label>}
        <label>{type === "Crédito" ? "Crédito disponible actual (opcional)" : "Saldo disponible actual (MXN)"}<input name="available" type="number" min="0" max="999999999999.99" step="0.01" inputMode="decimal" required={type === "Débito"} placeholder={type === "Crédito" ? "Por defecto, el límite completo" : "0.00"} /></label>
        <label>Día de corte mensual{type === "Débito" && " (opcional)"}<input type="number" name="cutoff" step="1" min="1" max="31" required={type === "Crédito"} placeholder="1–31" /></label>
        <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar tarjeta"}</button>
      </fieldset><p role="status">{notice}</p></form>
    <div className="personal-cards">{cards.map(card => <CardTile key={card.id} card={card} />)}</div>
  </>;
}
