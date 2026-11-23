"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type LinkRow = { demo_request_id: string | null; lead_id: string | null; created_at: string };
type Prospecto = { id: string; fuente: "demo" | "lead"; nombre: string | null; negocio: string | null; estado: string };
type Item = { fuente: "demo" | "lead"; id: string; created_at: string; prospecto: Prospecto | null };

export default function ContactProspects({ contactId }: { contactId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError("");
      try {
        const { data, error: linkError } = await supabase.from("crm_prospecto_contactos")
          .select("demo_request_id,lead_id,created_at").eq("contacto_id", contactId)
          .order("created_at", { ascending: false }).limit(25);
        if (linkError) throw linkError;
        const links = (data ?? []) as LinkRow[];
        const ids = links.map(v => v.demo_request_id ?? v.lead_id).filter((v): v is string => Boolean(v));
        let prospects: Prospecto[] = [];
        if (ids.length) {
          const { data: details, error: detailsError } = await supabase.from("crm_prospectos")
            .select("id,fuente,nombre,negocio,estado").in("id", ids);
          if (detailsError) throw detailsError;
          prospects = (details ?? []) as Prospecto[];
        }
        if (cancelled) return;
        setItems(links.map(v => {
          const fuente = v.demo_request_id ? "demo" : "lead";
          const id = (v.demo_request_id ?? v.lead_id) as string;
          return { fuente, id, created_at: v.created_at,
            prospecto: prospects.find(p => p.fuente === fuente && p.id === id) ?? null };
        }));
      } catch (err) {
        if (!cancelled) setError("No se pudieron cargar las solicitudes vinculadas: " +
          (err instanceof Error ? err.message : "Error inesperado."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [contactId]);

  return <section aria-label="Prospectos vinculados" className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
    <h3 className="text-sm font-bold text-slate-900">Solicitudes comerciales vinculadas</h3>
    {loading ? <p className="mt-2 text-xs text-slate-500">Consultando vínculos…</p>
      : error ? <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>
      : items.length === 0 ? <p className="mt-2 text-xs text-slate-600">Este contacto aún no está vinculado a un prospecto.</p>
      : <ul className="mt-3 space-y-2">{items.map(item => <li key={item.fuente + ":" + item.id}
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {item.prospecto?.negocio || item.prospecto?.nombre || (item.fuente === "demo" ? "Solicitud de demostración" : "Prospecto")}
          </p>
          <p className="text-xs text-slate-500">{item.fuente === "demo" ? "Landing" : "Formulario"} · Estado: {item.prospecto?.estado || "No disponible"}</p>
        </div>
        <Link className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
          href={`/superadmin/prospectos?fuente=${item.fuente}&id=${encodeURIComponent(item.id)}`}>
          Abrir seguimiento
        </Link>
      </li>)}</ul>}
    {items.length === 25 && <p className="mt-2 text-xs text-slate-500">Se muestran las 25 vinculaciones más recientes.</p>}
  </section>;
}
