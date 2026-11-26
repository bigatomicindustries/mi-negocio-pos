"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

function csvCell(value: string | null) {
  const text = value || "";
  const safe = /^\s*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export default function DownloadContacts({ businessId }: { businessId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const csv = ["Nombre,Apellido,Empresa,Dirección,Notas,Correos,Teléfonos"];
      let lastId = "";
      for (;;) {
        let query = supabase.from("crm_contactos")
          .select("id,nombre,apellido,empresa,direccion,notas,crm_contacto_medios(tipo,valor)")
          .eq("business_id", businessId).eq("ambito", "negocio").is("archivado_at", null)
          .order("id").limit(250);
        if (lastId) query = query.gt("id", lastId);
        const {data, error} = await query;
        if (error) throw error;
        for (const row of data) {
          const media = (type: string) => row.crm_contacto_medios.filter(m => m.tipo === type).map(m => m.valor).join(" | ");
          csv.push([row.nombre,row.apellido,row.empresa,row.direccion,row.notas,media("correo"),media("telefono")].map(csvCell).join(","));
        }
        if (data.length < 250) break;
        lastId = data[data.length-1].id;
      }
      const url = URL.createObjectURL(new Blob(["\uFEFF",csv.join("\r\n")], {type:"text/csv;charset=utf-8"}));
      const link = document.createElement("a");
      link.href = url;
      link.download = "contactos.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("No se pudo descargar el directorio. Inténtalo de nuevo.");
    } finally { setBusy(false); }
  }
  return <div><button type="button" disabled={busy} onClick={download} className="rounded-xl border px-4 py-2 font-semibold">{busy ? "Preparando archivo…" : "Descargar contactos CSV"}</button>{error && <p role="alert">{error}</p>}</div>;
}
