"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import type { Card } from "./budget";

export default function CardEditor({ card, owner, onClose, onSave }: {
  card: Card; owner: string; onClose: () => void; onSave: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const credit = card.card_type === "Crédito";
  const initialDebt = Math.round((card.credit_limit ?? card.opening_available) * 100) - Math.round(card.opening_available * 100);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const total = Number(values.get("amount"));
    const patch = confirm ? { archived_at: new Date().toISOString() } : {
      name: String(values.get("name")).trim(), cutoff_day: values.get("cutoff") || null,
      credit_limit: credit ? total : null, opening_available: (Math.round(total * 100) - initialDebt) / 100,
    };
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.from("personal_cards").update(patch)
        .eq("id", card.id).eq("owner_id", owner).is("archived_at", null).select("id").single();
      if (error) throw error;
      onClose();
      onSave();
    } catch {
      setError("No se pudo confirmar el cambio. Revisa la tarjeta antes de volver a intentar.");
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="card-editor" aria-labelledby="card-editor-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="row"><h2 id="card-editor-title">{confirm ? "Eliminar tarjeta" : "Editar tarjeta"}</h2>
      <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar">✕</button></div>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <div hidden={confirm}><label>Nombre de la tarjeta<input name="name" defaultValue={card.name} maxLength={60} required={!confirm} /></label>
        <label>{credit ? "Límite de crédito (MXN)" : "Saldo inicial (MXN)"}<input name="amount" type="number" step="0.01"
          min={initialDebt / 100} max="999999999999.99" defaultValue={card.credit_limit ?? card.opening_available} required={!confirm} /></label>
        <label>Día de corte mensual{!credit && " (opcional)"}<input name="cutoff" type="number" min="1" max="31" defaultValue={card.cutoff_day ?? ""} required={credit && !confirm} /></label></div>
      {confirm && <p>¿Eliminar «{card.name}» de Mis tarjetas? Los gastos registrados se conservarán en el historial.</p>}
      <div className="editor-actions">
        <button type="button" onClick={() => { setConfirm(!confirm); setError(""); }}>{confirm ? "Volver" : "Eliminar tarjeta"}</button>
        <button type="submit" className={confirm ? "danger" : "primary"} formNoValidate={confirm}>{busy ? "Guardando…" : confirm ? "Confirmar eliminación" : "Guardar cambios"}</button>
      </div>
    </fieldset></form><p role="status">{error}</p>
  </dialog>;
}
