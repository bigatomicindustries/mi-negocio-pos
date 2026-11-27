"use client";

import { useRef, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { categories, kinds, money, type Card, type Goal, type Kind } from "./budget";

export default function MovementForm({ cards, goals, owner, onSave }: { cards: Card[]; goals: Goal[]; owner: string; onSave: () => void }) {
  const [kind, setKind] = useState<Kind>("Gasto");
  const [method, setMethod] = useState("Efectivo");
  const [category, setCategory] = useState("Otros");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setNotice("");
    try {
      const { error } = await supabase.from("personal_entries").insert({
        owner_id: owner, kind, amount: fields.get("amount"),
        category: kind === "Gasto" ? category : kind,
        method: fields.get("method"), concept: String(fields.get("concept") || "").trim(),
        card_id: kind === "Gasto" && method === "Tarjeta" ? fields.get("card") || null : null,
        goal_id: kind === "Ahorro" ? fields.get("goal") || null : null,
      });
      if (error) throw error;
      form.reset();
      setMethod("Efectivo");
      setNotice("Movimiento guardado.");
      onSave();
      amountRef.current?.focus();
    } catch {
      setNotice("No se pudo confirmar el registro. Revisa el historial antes de volver a intentar.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return <section className="panel"><h2>Nuevo movimiento</h2>
    <form onSubmit={save}>
      <fieldset disabled={busy}>
        <div className="movement-actions">
          <div className="choices">{kinds.map(item => <button key={item} type="button" aria-pressed={kind === item} onClick={() => { setKind(item); setNotice(""); }}>{item}</button>)}</div>
          <button className="primary" type="submit">{busy ? "Guardando…" : "Guardar"}</button>
        </div>
        <label>Importe (MXN)<input ref={amountRef} name="amount" type="number" inputMode="decimal" min="0.01" max="999999999999.99" step="0.01" required placeholder="0.00" /></label>
        <label>Concepto (opcional)<input name="concept" maxLength={160} placeholder={kind === "Gasto" ? "¿Qué compraste?" : "Descripción breve"} /></label>
          <label>Método de pago<select name="method" value={method} onChange={event => setMethod(event.target.value)}><option>Efectivo</option><option>Tarjeta</option><option>Transferencia</option></select></label>
          {kind === "Gasto" && method === "Tarjeta" && <label>Tarjeta utilizada
            <select name="card" defaultValue="" required={cards.length > 0}>
              <option value="">{cards.length ? "Selecciona una tarjeta" : "Sin tarjeta registrada"}</option>
              {cards.map(card => <option key={card.id} value={card.id}>{card.name} · {card.card_type} · {money(card.available)}</option>)}
            </select>
            {!cards.length && <small>Registra tu tarjeta en Tarjetas para llevar su saldo.</small>}
          </label>}
        {kind === "Gasto" && <label>Categoría<select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(name => <option key={name}>{name}</option>)}</select></label>}
        {kind === "Ahorro" && <label>Destino del ahorro<select name="goal"><option value="">Ahorro general</option>{goals.map(goal => <option value={goal.id} key={goal.id}>{goal.name}</option>)}</select></label>}
      </fieldset>
      <p role="status">{notice}</p>
    </form>
  </section>;
}
