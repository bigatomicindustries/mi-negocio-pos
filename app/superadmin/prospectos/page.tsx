"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

const estados = {
  nuevo: "Nuevo", contactado: "Contactado", demo_agendada: "Demo agendada",
  en_negociacion: "En negociación", convertido: "Convertido", descartado: "Descartado",
} as const;
type Estado = keyof typeof estados;
type Prospecto = {
  id: string; fuente: "demo" | "lead"; origen: string;
  nombre: string | null; negocio: string | null; whatsapp: string | null;
  email: string | null; comentarios: string | null; estado: string;
  crm_notas: string | null; created_at: string; updated_at: string;
};
const key = (p: Prospecto) => p.fuente + ":" + p.id;
const pageSize = 50;
function whatsappUrl(value: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  const phone = digits.length === 10 ? "52" + digits : /^52\d{10}$/.test(digits) ? digits : null;
  return phone ? "https://wa.me/" + phone + "?text=" + encodeURIComponent("Hola, te contacto de Mi Negocio para dar seguimiento a tu solicitud.") : null;
}
function labelEstado(value: string) {
  return estados[value as Estado] ?? value;
}
export default function ProspectosPage() {
  const router = useRouter();
  const { cargando: authLoading, esPlatformAdmin } = useAuth();
  const [rows, setRows] = useState<Prospecto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Prospecto | null>(null);
  const [editStatus, setEditStatus] = useState<Estado>("nuevo");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);

  const reload = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (!authLoading && !esPlatformAdmin) router.replace("/");
  }, [authLoading, esPlatformAdmin, router]);

  useEffect(() => {
    if (authLoading || !esPlatformAdmin) return;
    let cancelled = false;
    async function load() {
      setLoading(true); setError("");
      let request = supabase.from("crm_prospectos").select("*", { count: "exact" });
      if (status) request = request.eq("estado", status);
      if (source) request = request.eq("fuente", source);
      // Restrict PostgREST filter grammar characters; keep ordinary contact text.
      const term = query.trim().replace(/[^\p{L}\p{N}\s@.+_-]/gu, " ").trim().replace(/_/g, "\\_").slice(0, 100);
      if (term) request = request.or(["nombre","negocio","whatsapp","email"].map(field => field + ".ilike.%" + term + "%").join(","));
      const { data, error: err, count } = await request
        .order("created_at", { ascending: false }).order("fuente").order("id")
        .range(page * pageSize, (page + 1) * pageSize - 1);
      if (cancelled) return;
      if (err) { setError("No se pudieron cargar los prospectos: " + err.message); setRows([]); setTotal(0); }
      else { setRows((data ?? []) as Prospecto[]); setTotal(count ?? 0); }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [authLoading, esPlatformAdmin, query, status, source, page, revision]);

  function open(p: Prospecto) {
    setSelected(p); setEditStatus(p.estado in estados ? p.estado as Estado : "nuevo");
    setNotes(p.crm_notas ?? ""); setEditError(""); setNotice("");
  }
  async function save() {
    if (!selected || saving || !esPlatformAdmin) return;
    setSaving(true); setEditError("");
    try {
      const { error: err } = await supabase.rpc("crm_actualizar_prospecto", {
        p_fuente: selected.fuente, p_id: selected.id, p_estado: editStatus,
        p_notas: notes, p_updated_at: selected.updated_at,
      });
      if (err) { setEditError(err.message); return; }
      setSelected(null); setNotice("Prospecto actualizado."); reload();
    } catch {
      setEditError("No se pudo guardar. Intenta nuevamente.");
    } finally { setSaving(false); }
  }
  if (authLoading || !esPlatformAdmin) return null;
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link href="/superadmin" className="text-sm font-semibold text-green-700">← Negocios</Link>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-green-600">Administración SaaS · CRM</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">Prospectos</h1>
            <p className="mt-2 text-slate-500">Gestiona las solicitudes comerciales de Mi Negocio.</p>
          </div>
          <button onClick={reload} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold text-slate-700">Actualizar</button>
        </header>
        <div className="rounded-2xl border bg-white p-5">
          <p className="text-sm text-slate-500">Resultados de la búsqueda</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{loading ? "…" : total}</p>
        </div>
        <div className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">Buscar
            <input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Nombre, negocio o contacto" className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <label className="text-sm font-medium text-slate-700">Estado
            <select value={status} onChange={e => { setStatus(e.target.value); setPage(0); }} className="mt-1 w-full rounded-lg border px-3 py-2">
              <option value="">Todos</option>{Object.entries(estados).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">Fuente
            <select value={source} onChange={e => { setSource(e.target.value); setPage(0); }} className="mt-1 w-full rounded-lg border px-3 py-2">
              <option value="">Todas</option><option value="demo">Solicitud rápida</option><option value="lead">Formulario completo</option>
            </select>
          </label>
        </div>
        {notice && <p role="status" className="rounded-xl bg-green-50 p-4 text-green-800">{notice}</p>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
        <section className="overflow-hidden rounded-2xl border bg-white">
          {loading ? <p className="p-8 text-slate-500">Cargando prospectos…</p> : !error && rows.length === 0 ? <p className="p-8 text-slate-500">No hay prospectos con estos filtros.</p> : !error && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Prospecto","Contacto","Fuente","Estado","Registro","Acciones"].map(h => <th key={h} className="px-4 py-4">{h}</th>)}</tr></thead>
                <tbody>{rows.map(p => {
                  const url = whatsappUrl(p.whatsapp);
                  return <tr key={key(p)} className="border-t">
                    <td className="px-4 py-4"><p className="font-semibold text-slate-900">{p.negocio || p.nombre || "Solicitud de demo"}</p><p className="text-xs text-slate-500">{p.nombre || "Sin nombre"}</p></td>
                    <td className="px-4 py-4 text-slate-600"><p>{p.whatsapp || "—"}</p><p>{p.email || ""}</p></td>
                    <td className="px-4 py-4 text-slate-600">{p.fuente === "demo" ? "Landing" : p.origen}</td>
                    <td className="px-4 py-4"><span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">{labelEstado(p.estado)}</span></td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">{new Date(p.created_at).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" })}</td>
                    <td className="px-4 py-4"><div className="flex gap-2">{url && <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-green-50 px-3 py-2 font-semibold text-green-700">WhatsApp</a>}<button onClick={() => open(p)} className="rounded-lg bg-slate-100 px-3 py-2 font-semibold text-slate-700">Ver / editar</button></div></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between border-t p-4 text-sm text-slate-600">
            <button disabled={page === 0 || loading} onClick={() => setPage(v => v - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Anterior</button>
            <span>Página {page + 1} de {Math.max(1, Math.ceil(total / pageSize))}</span>
            <button disabled={loading || (page + 1) * pageSize >= total} onClick={() => setPage(v => v + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Siguiente</button>
          </div>
        </section>
        {selected && <section className="space-y-4 rounded-2xl border bg-white p-6" aria-label="Editar prospecto">
          <h2 className="text-xl font-bold text-slate-900">{selected.negocio || selected.nombre || "Solicitud de demo"}</h2>
          <p className="text-sm text-slate-600">{selected.whatsapp || "Sin WhatsApp"} · {selected.email || "Sin correo"}</p>
          {selected.comentarios && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{selected.comentarios}</p>}
          <label className="block text-sm font-medium text-slate-700">Estado comercial
            <select value={editStatus} disabled={saving} onChange={e => setEditStatus(e.target.value as Estado)} className="mt-1 block w-full rounded-lg border p-2">{Object.entries(estados).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="block text-sm font-medium text-slate-700">Notas internas
            <textarea value={notes} disabled={saving} onChange={e => setNotes(e.target.value)} maxLength={4000} rows={5} className="mt-1 block w-full rounded-lg border p-3" />
          </label>
          {editError && <p role="alert" className="text-sm text-red-700">{editError}</p>}
          <div className="flex gap-3">
            <button disabled={saving} onClick={save} className="rounded-xl bg-green-700 px-5 py-2 font-semibold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar cambios"}</button>
            <button disabled={saving} onClick={() => setSelected(null)} className="rounded-xl border px-5 py-2">Cancelar</button>
          </div>
        </section>}
      </div>
    </main>
  );
}
