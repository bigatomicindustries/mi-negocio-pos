"use client";

import { useRef, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { localDate, money, savingsConcept, type Entry } from "./budget";

export default function MovementDetail({ entry, owner, category, card, onSave }: {
  entry: Entry; owner: string; category: string; card?: string; onSave: () => void;
}) {
  const local = localDate(new Date(entry.occurred_at));
  const [date, setDate] = useState(entry.date_only ?? local.slice(0, 10));
  const [time, setTime] = useState(entry.date_only ? "" : local.slice(11));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  function open() {
    setDate(entry.date_only ?? local.slice(0, 10));
    setTime(entry.date_only ? "" : local.slice(11));
    setNotice("");
    setConfirmDelete(false);
    setEditing(true);
    dialog.current?.showModal();
  }
  async function remove() {
    if (busy || !confirmDelete) return;
    setBusy(true);
    setNotice("");
    try {
      const { error } = await supabase.from("personal_entries").delete()
        .eq("id", entry.id).eq("owner_id", owner).select("id").single();
      if (error) throw error;
      dialog.current?.close();
      onSave();
    } catch {
      setNotice("No se pudo confirmar la eliminación. Revisa el historial antes de volver a intentar.");
    } finally { setBusy(false); }
  }
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
      dialog.current?.close();
      onSave();
    } catch {
      setNotice("No se pudo guardar la fecha del movimiento.");
    } finally { setBusy(false); }
  }
  const title = entry.kind === "Ahorro" ? savingsConcept(entry.goal_id ? category : undefined)
    : entry.concept || (entry.kind === "Gasto" ? entry.category : entry.kind);
  const labelDate = entry.date_only
    ? new Date(entry.date_only + "T12:00").toLocaleDateString("es-MX", {dateStyle:"medium"}) + " · --:--"
    : new Date(entry.occurred_at).toLocaleString("es-MX", {dateStyle:"medium", timeStyle:"short"});
  return <div className="entry movement-detail">
    <button type="button" className="movement-open" onClick={open} aria-haspopup="dialog"><span><b>{title}</b>
      <small>{entry.kind} · {category} · {entry.method}{card && " · " + card}</small><small>{labelDate}</small></span>
      <strong data-kind={entry.kind}>{entry.kind === "Gasto" ? "−" : "+"}{money(entry.amount)}</strong></button>
    <dialog ref={dialog} className="card-editor" aria-labelledby={`movement-title-${entry.id}`}
      onCancel={e => { if (busy) e.preventDefault(); }} onClose={() => setEditing(false)}>
      {editing && <><div className="row"><h2 id={`movement-title-${entry.id}`}>{confirmDelete ? "Eliminar registro" : "Editar fecha y hora"}</h2>
        <button type="button" aria-label="Cerrar" disabled={busy} onClick={() => dialog.current?.close()}>✕</button></div>
      <p><b>{title}</b> · {money(entry.amount)}</p>
    {entry.kind === "Ahorro" && entry.concept && entry.concept !== title && <p>{entry.concept}</p>}
    {confirmDelete ? <>
      <p>¿Eliminar este movimiento del historial? Se actualizarán los saldos correspondientes.</p>
      <div className="editor-actions">
        <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Volver</button>
        <button type="button" className="danger" disabled={busy} onClick={remove}>{busy ? "Eliminando…" : "Confirmar eliminación"}</button>
      </div></> : <form onSubmit={save}><fieldset disabled={busy}>
      <label>Fecha del movimiento<input required type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>Hora (opcional)<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
      {time && <button type="button" onClick={() => setTime("")}>Quitar hora</button>}
      <div className="editor-actions"><button type="button" onClick={() => { setNotice(""); setConfirmDelete(true); }}>Eliminar registro</button>
      <button type="submit" className="primary">{busy ? "Guardando…" : "Guardar cambios"}</button></div>
    </fieldset></form>}<p role="status">{notice}</p></>}
    </dialog>
  </div>;
}
