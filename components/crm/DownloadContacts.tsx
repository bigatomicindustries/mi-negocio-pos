"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

function csvCell(value: string | null) {
  const text = value || "";
  const safe = /^\s*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export default function DownloadContacts({ businessId, disabled }: { businessId: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      type Entry = { valor: string; etiqueta: string | null };
      const contacts: { fields: (string|null)[]; emails: Entry[]; phones: Entry[] }[] = [];
      let emailCount = 1;
      let phoneCount = 1;
      let lastId = "";
      for (;;) {
        let query = supabase.from("crm_contactos")
          .select("id,nombre,apellido,empresa,direccion,notas,fuente,crm_contacto_medios(tipo,valor,etiqueta,es_principal,posicion,id)")
          .eq("business_id", businessId).eq("ambito", "negocio").is("archivado_at", null)
          .order("id").limit(250);
        if (lastId) query = query.gt("id", lastId);
        const {data, error} = await query;
        if (error) throw error;
        for (const row of data) {
          const channels = row.crm_contacto_medios.sort((a,b) =>
            Number(b.es_principal)-Number(a.es_principal) || a.posicion-b.posicion || a.id.localeCompare(b.id));
          const emails = channels.filter(m => m.tipo === "correo");
          const phones = channels.filter(m => m.tipo === "telefono");
          emailCount = Math.max(emailCount,emails.length);
          phoneCount = Math.max(phoneCount,phones.length);
          contacts.push({fields:[row.nombre,row.apellido,row.empresa,row.direccion,row.notas,row.fuente],emails,phones});
        }
        if (data.length < 250) break;
        lastId = data[data.length-1].id;
      }
      const headers = (label: string, count: number) => Array.from({length:count}, (_,i) =>
        [label+" "+(i+1), "Etiqueta de "+label.toLowerCase()+" "+(i+1)]).flat();
      const cells = (entries: Entry[], count: number) => Array.from({length:count}, (_,i) =>
        [entries[i]?.valor ?? "",entries[i]?.etiqueta ?? ""]).flat();
      const csv = [["Nombre","Apellido","Empresa","Dirección","Notas","Fuente",...headers("Correo",emailCount),...headers("Teléfono",phoneCount)].join(",")];
      for(const row of contacts){
        csv.push([...row.fields,...cells(row.emails,emailCount),...cells(row.phones,phoneCount)].map(csvCell).join(","));
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
  return <div><button type="button" disabled={busy || disabled} onClick={download} className="rounded-xl border px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Preparando archivo…" : "Descargar contactos CSV"}</button>{error && <p role="alert">{error}</p>}</div>;
}
