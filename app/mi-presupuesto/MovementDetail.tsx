"use client";

import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { localDate, money, type Entry } from "./budget";

export default function MovementDetail({ entry, owner, category, card, onSave }: {
  entry: Entry; owner: string; category: string; card?: string; onSave: () => void;
}) {
  const local = localDate(new Date(entry.occurred_at));
  const [date, setDate] = useState(entry.date_only ?? local.slice(0, 10));
  const [time, setTime] = useState(entry.date_only ? "" : local.slice(11));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const instant = new Date(date + "T" + (time || "12:00"));
      const { error } = await supabase.from("personal_entries").update({
        occurred_at: instant.toISOString(), date_only: time ? null : date,
      }).eq("id", entry.id).eq("owner_id", owner).select("id").single();
      if (error) throw error;
      onSave();
    } catch {
      setNotice("No se pudo guardar la fecha del movimiento.");
    } finally { setBusy(false); }
  }
  const labelDate = entry.date_only
    ? new Date(entry.date_only + "T12:00").toLocaleDateString("es-MX", {dateStyle:"medium"}) + " · --:--"
    : new Date(entry.occurred_at).toLocaleString("es-MX", {dateStyle:"medium", timeStyle:"short"});
  return <details className="entry movement-detail">
    <summary><span><b>{entry.concept || (entry.kind === "Gasto" ? entry.category : entry.kind)}</b>
      <small>{entry.kind} · {category} · {entry.method}{card && " · " + card}</small><small>{labelDate}</small></span>
      <strong data-kind={entry.kind}>{entry.kind === "Gasto" ? "−" : "+"}{money(entry.amount)}</strong></summary>
    <form onSubmit={save}><fieldset disabled={busy}>
      <legend>Editar fecha y hora</legend>
      <label>Fecha del movimiento<input required type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>Hora (opcional)<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
      {time && <button type="button" onClick={() => setTime("")}>Quitar hora</button>}
      <button type="submit" className="primary">{busy ? "Guardando…" : "Guardar cambios"}</button>
    </fieldset></form><p role="status">{notice}</p>
  </details>;
}
