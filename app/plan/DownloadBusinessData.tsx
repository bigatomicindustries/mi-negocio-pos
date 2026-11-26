"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

const sources = {
  sales: "Ventas", products: "Productos", branch_inventory: "Existencias",
  inventory_movements: "Movimientos de inventario", purchases: "Compras",
  purchase_items: "Partidas de compras", suppliers: "Proveedores",
  cash_sessions: "Sesiones de caja", cash_movements: "Movimientos de caja",
  sale_returns: "Devoluciones de ventas", purchase_returns: "Devoluciones de compras",
  inventory_transfers: "Transferencias de inventario", crm_negocio_oportunidades: "Oportunidades del CRM",
  crm_negocio_actividades: "Actividades del CRM",
} as const;

export default function DownloadBusinessData({ businessId }: { businessId: string }) {
  const [source, setSource] = useState<keyof typeof sources>("sales");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const parts: BlobPart[] = ["[\n"];
      let last = "";
      for (;;) {
        let query = supabase.from(source).select("*").eq("business_id", businessId).order("id").limit(250);
        if (last) query = query.gt("id", last);
        const {data, error} = await query;
        if (error) throw error;
        if (data.length) parts.push((last ? ",\n" : "") + data.map(row => JSON.stringify(row)).join(",\n"));
        if (data.length < 250) break;
        last = data[data.length-1].id;
      }
      parts.push("\n]");
      const url = URL.createObjectURL(new Blob(parts, {type:"application/json"}));
      const link = document.createElement("a");
      link.href = url;
      link.download = source + ".json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("No se pudo completar la descarga. Inténtalo de nuevo."); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 rounded-2xl border bg-white p-6">
    <h2 className="text-xl font-bold">Descargar datos del negocio</h2>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <label>Datos <select disabled={busy} className="rounded-lg border p-2" value={source} onChange={event => setSource(event.target.value as keyof typeof sources)}>
        {Object.entries(sources).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <button disabled={busy} onClick={download} className="rounded-lg border px-4 py-2 font-semibold">{busy ? "Preparando…" : "Descargar JSON"}</button>
      <a className="text-emerald-800 underline" href="/crm?seccion=contactos">Descargar contactos en el CRM</a>
    </div>{error && <p role="alert">{error}</p>}
  </section>;
}
