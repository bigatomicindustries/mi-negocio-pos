"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

const estados = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  demo_agendada: "Demo agendada",
  en_negociacion: "En negociación",
  convertido: "Convertido",
  descartado: "Descartado",
} as const;
const prioridades = { baja: "Baja", media: "Media", alta: "Alta" } as const;
const tiposActividad = {
  llamada: "Llamada",
  whatsapp: "WhatsApp",
  correo: "Correo",
  reunion: "Reunión",
  nota: "Nota",
} as const;

type Estado = keyof typeof estados;
type Prioridad = keyof typeof prioridades;
type TipoActividad = keyof typeof tiposActividad;
type Fuente = "demo" | "lead";
type AgendaFiltro = "todos" | "pendientes" | "vencidos" | "hoy" | "proximos" | "sin_fecha";

type Prospecto = {
  id: string;
  fuente: Fuente;
  origen: string;
  nombre: string | null;
  negocio: string | null;
  whatsapp: string | null;
  email: string | null;
  comentarios: string | null;
  estado: string;
  crm_notas: string | null;
  created_at: string;
  updated_at: string;
  crm_prioridad: Prioridad;
  crm_proximo_contacto: string | null;
};
type Actividad = {
  id: string;
  tipo: TipoActividad;
  detalle: string;
  created_at: string;
};
type Resumen = { total: number; vencidos: number; hoy: number; sinFecha: number };

const pageSize = 50;
const timezone = "America/Mexico_City";

function hoyMexico() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return part("year") + "-" + part("month") + "-" + part("day");
}
function sumarDias(fecha: string, dias: number) {
  const date = new Date(fecha + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + dias);
  return date.toISOString().slice(0, 10);
}
function fechaCorta(fecha: string) {
  return new Date(fecha + "T12:00:00Z").toLocaleDateString("es-MX", {
    timeZone: timezone, day: "numeric", month: "short", year: "numeric",
  });
}
function fechaHora(fecha: string) {
  return new Date(fecha).toLocaleString("es-MX", {
    timeZone: timezone, dateStyle: "medium", timeStyle: "short",
  });
}
function etiquetaAgenda(fecha: string | null, hoy: string) {
  if (!fecha) return "Sin fecha";
  if (fecha < hoy) return "Vencido";
  if (fecha === hoy) return "Hoy";
  return fechaCorta(fecha);
}
function whatsappUrl(value: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  const phone = digits.length === 10 ? "52" + digits : /^52\d{10}$/.test(digits) ? digits : null;
  return phone
    ? "https://wa.me/" + phone + "?text=" + encodeURIComponent("Hola, te contacto de Mi Negocio para dar seguimiento a tu solicitud.")
    : null;
}
function etiquetaEstado(value: string) {
  return estados[value as Estado] ?? value;
}
function etiquetaPrioridad(value: Prioridad) {
  return prioridades[value] ?? value;
}

export default function ProspectosPage() {
  const router = useRouter();
  const { cargando: authLoading, esPlatformAdmin } = useAuth();

  const [hoy, setHoy] = useState(hoyMexico);
  const [rows, setRows] = useState<Prospecto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [agendaFilter, setAgendaFilter] = useState<AgendaFiltro>("todos");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Resumen>({ total: 0, vencidos: 0, hoy: 0, sinFecha: 0 });
  const [summaryError, setSummaryError] = useState("");
  const [selected, setSelected] = useState<Prospecto | null>(null);
  const [editStatus, setEditStatus] = useState<Estado>("nuevo");
  const [editPriority, setEditPriority] = useState<Prioridad>("media");
  const [nextContact, setNextContact] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);

  const [activities, setActivities] = useState<Actividad[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState("");
  const [activityType, setActivityType] = useState<TipoActividad>("llamada");
  const [activityText, setActivityText] = useState("");
  const [activitySaving, setActivitySaving] = useState(false);
  const [activityNotice, setActivityNotice] = useState("");
  const [activityRevision, setActivityRevision] = useState(0);

  const reload = useCallback(() => {
    setHoy(hoyMexico());
    setRevision(value => value + 1);
  }, []);

  useEffect(() => {
    if (!authLoading && !esPlatformAdmin) router.replace("/");
  }, [authLoading, esPlatformAdmin, router]);

  useEffect(() => {
    if (authLoading || !esPlatformAdmin) return;
    let cancelled = false;
    async function loadSummary() {
      const base = () => supabase.from("crm_prospectos").select("id", { count: "exact", head: true });
      const [all, overdue, today, undated] = await Promise.all([
        base(),
        base().lt("crm_proximo_contacto", hoy),
        base().eq("crm_proximo_contacto", hoy),
        base().is("crm_proximo_contacto", null),
      ]);
      if (cancelled) return;
      if (all.error || overdue.error || today.error || undated.error) {
        setSummaryError("No se pudo actualizar el resumen de seguimiento.");
        return;
      }
      setSummaryError("");
      setSummary({
        total: all.count ?? 0,
        vencidos: overdue.count ?? 0,
        hoy: today.count ?? 0,
        sinFecha: undated.count ?? 0,
      });
    }
    void loadSummary();
    return () => { cancelled = true; };
  }, [authLoading, esPlatformAdmin, hoy, revision]);

  useEffect(() => {
    if (authLoading || !esPlatformAdmin) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      let request = supabase.from("crm_prospectos").select("*", { count: "exact" });
      if (status) request = request.eq("estado", status);
      if (source) request = request.eq("fuente", source);
      if (priorityFilter) request = request.eq("crm_prioridad", priorityFilter);
      if (agendaFilter === "pendientes") request = request.lte("crm_proximo_contacto", hoy);
      if (agendaFilter === "vencidos") request = request.lt("crm_proximo_contacto", hoy);
      if (agendaFilter === "hoy") request = request.eq("crm_proximo_contacto", hoy);
      if (agendaFilter === "proximos") request = request.gte("crm_proximo_contacto", hoy).lte("crm_proximo_contacto", sumarDias(hoy, 7));
      if (agendaFilter === "sin_fecha") request = request.is("crm_proximo_contacto", null);
      // Escapar operadores de PostgREST para que el buscador no cambie la consulta.
      const term = query.trim().replace(/[^\p{L}\p{N}\s@.+_-]/gu, " ").trim()
        .replace(/_/g, "\\_").slice(0, 100);
      if (term) request = request.or(["nombre", "negocio", "whatsapp", "email"]
        .map(field => field + ".ilike.%" + term + "%").join(","));
      const { data, error: err, count } = await request
        .order("crm_proximo_contacto", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("fuente").order("id")
        .range(page * pageSize, (page + 1) * pageSize - 1);
      if (cancelled) return;
      if (err) {
        setError("No se pudieron cargar los prospectos: " + err.message);
        setRows([]); setTotal(0);
      } else {
        setRows((data ?? []) as Prospecto[]);
        setTotal(count ?? 0);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [authLoading, esPlatformAdmin, query, status, source, priorityFilter, agendaFilter, hoy, page, revision]);

  useEffect(() => {
    if (!selected || authLoading || !esPlatformAdmin) return;
    let cancelled = false;
    const prospect = selected;
    async function loadActivities() {
      setActivitiesLoading(true);
      setActivitiesError("");
      const foreignKey = prospect.fuente === "demo" ? "demo_request_id" : "lead_id";
      const { data, error: err } = await supabase.from("crm_actividades")
        .select("id, tipo, detalle, created_at")
        .eq(foreignKey, prospect.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (err) {
        setActivitiesError("No se pudo cargar el historial: " + err.message);
        setActivities([]);
      } else {
        setActivities((data ?? []) as Actividad[]);
      }
      setActivitiesLoading(false);
    }
    void loadActivities();
    return () => { cancelled = true; };
  }, [selected, authLoading, esPlatformAdmin, activityRevision]);

  function changeAgenda(value: AgendaFiltro) {
    setAgendaFilter(value);
    setPage(0);
  }

  function open(p: Prospecto) {
    setSelected(p);
    setEditStatus(p.estado in estados ? p.estado as Estado : "nuevo");
    setEditPriority(p.crm_prioridad in prioridades ? p.crm_prioridad : "media");
    setNextContact(p.crm_proximo_contacto ?? "");
    setNotes(p.crm_notas ?? "");
    setEditError("");
    setActivityNotice("");
    setActivitiesError("");
    setActivities([]);
    setActivityType("llamada");
    setActivityText("");
    setNotice("");
  }

  async function save() {
    if (!selected || saving || !esPlatformAdmin) return;
    setSaving(true);
    setEditError("");
    try {
      const { error: err } = await supabase.rpc("crm_actualizar_prospecto_v1_1", {
        p_fuente: selected.fuente,
        p_id: selected.id,
        p_estado: editStatus,
        p_notas: notes,
        p_prioridad: editPriority,
        p_proximo_contacto: nextContact || null,
        p_updated_at: selected.updated_at,
      });
      if (err) { setEditError(err.message); return; }
      setSelected(null);
      setNotice("Seguimiento comercial actualizado.");
      reload();
    } catch {
      setEditError("No se pudo guardar. Intenta nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  async function addActivity() {
    if (!selected || activitySaving || !esPlatformAdmin) return;
    const detail = activityText.trim();
    if (!detail || detail.length > 2000) {
      setActivitiesError("Describe la actividad (máximo 2000 caracteres).");
      return;
    }
    setActivitySaving(true);
    setActivitiesError("");
    setActivityNotice("");
    try {
      const payload = selected.fuente === "demo"
        ? { demo_request_id: selected.id, tipo: activityType, detalle: detail }
        : { lead_id: selected.id, tipo: activityType, detalle: detail };
      const { error: err } = await supabase.from("crm_actividades").insert(payload);
      if (err) { setActivitiesError(err.message); return; }
      setActivityText("");
      setActivityNotice("Actividad registrada en el historial.");
      setActivityRevision(value => value + 1);
    } catch {
      setActivitiesError("No se pudo registrar la actividad. Intenta nuevamente.");
    } finally {
      setActivitySaving(false);
    }
  }

  if (authLoading || !esPlatformAdmin) return null;
  const resumenCards = [
    { label: "Todos los prospectos", count: summary.total, filtro: "todos" as AgendaFiltro, tone: "text-slate-900" },
    { label: "Pendientes (hoy + vencidos)", count: summary.hoy + summary.vencidos, filtro: "pendientes" as AgendaFiltro, tone: "text-amber-700" },
    { label: "Vencidos", count: summary.vencidos, filtro: "vencidos" as AgendaFiltro, tone: "text-red-700" },
    { label: "Sin fecha", count: summary.sinFecha, filtro: "sin_fecha" as AgendaFiltro, tone: "text-slate-600" },
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link href="/superadmin" className="text-sm font-semibold text-green-700">← Negocios</Link>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-green-600">Administración SaaS · CRM 1.1</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">Seguimiento comercial</h1>
            <p className="mt-2 text-slate-500">Prioriza contactos, organiza tu agenda y registra cada interacción.</p>
          </div>
          <button type="button" onClick={reload} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Actualizar</button>
        </header>

        <section aria-label="Resumen de seguimiento" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {resumenCards.map(card => (
            <button key={card.filtro} type="button" onClick={() => changeAgenda(card.filtro)}
              aria-pressed={agendaFilter === card.filtro}
              className={"rounded-2xl border bg-white p-5 text-left transition hover:border-green-500 " +
                (agendaFilter === card.filtro ? "border-green-600 ring-1 ring-green-600" : "border-slate-200")}>
              <p className="text-sm text-slate-500">{card.label}</p>
              <p className={"mt-2 text-3xl font-bold " + card.tone}>{card.count}</p>
            </button>
          ))}
        </section>
        {summaryError && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{summaryError}</p>}

        <section aria-label="Filtros de prospectos" className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-sm font-medium text-slate-700 lg:col-span-2">Buscar
            <input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}
              placeholder="Nombre, negocio o contacto" className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <label className="text-sm font-medium text-slate-700">Estado
            <select value={status} onChange={e => { setStatus(e.target.value); setPage(0); }} className="mt-1 w-full rounded-lg border px-3 py-2">
              <option value="">Todos</option>
              {Object.entries(estados).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">Fuente
            <select value={source} onChange={e => { setSource(e.target.value); setPage(0); }} className="mt-1 w-full rounded-lg border px-3 py-2">
              <option value="">Todas</option><option value="demo">Solicitud rápida</option><option value="lead">Formulario completo</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">Prioridad
            <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(0); }} className="mt-1 w-full rounded-lg border px-3 py-2">
              <option value="">Todas</option>
              {Object.entries(prioridades).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">Agenda
            <select value={agendaFilter} onChange={e => changeAgenda(e.target.value as AgendaFiltro)} className="mt-1 w-full rounded-lg border px-3 py-2">
              <option value="todos">Todos</option><option value="pendientes">Pendientes</option>
              <option value="vencidos">Vencidos</option><option value="hoy">Hoy</option>
              <option value="proximos">Próximos 7 días</option><option value="sin_fecha">Sin fecha</option>
            </select>
          </label>
        </section>

        {notice && <p role="status" className="rounded-xl bg-green-50 p-4 text-green-800">{notice}</p>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
        <section className="overflow-hidden rounded-2xl border bg-white" aria-label="Lista de prospectos">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4">
            <h2 className="font-bold text-slate-900">Prospectos</h2>
            <p className="text-sm text-slate-500">{loading ? "Cargando…" : total + " resultados"}</p>
          </div>
          {loading ? <p className="p-8 text-slate-500">Cargando prospectos…</p> : !error && rows.length === 0
            ? <p className="p-8 text-slate-500">No hay prospectos con estos filtros.</p>
            : !error && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>{["Prospecto", "Contacto", "Estado", "Prioridad", "Próximo contacto", "Fuente", "Acciones"].map(h => <th key={h} scope="col" className="whitespace-nowrap px-4 py-4">{h}</th>)}</tr>
                  </thead>
                  <tbody>{rows.map(p => {
                    const url = whatsappUrl(p.whatsapp);
                    const agendaLabel = etiquetaAgenda(p.crm_proximo_contacto, hoy);
                    const overdue = p.crm_proximo_contacto !== null && p.crm_proximo_contacto < hoy;
                    return <tr key={p.fuente + ":" + p.id} className="border-t">
                      <td className="px-4 py-4"><p className="font-semibold text-slate-900">{p.negocio || p.nombre || "Solicitud de demo"}</p><p className="text-xs text-slate-500">{p.nombre || "Sin nombre"}</p></td>
                      <td className="px-4 py-4 text-slate-600"><p>{p.whatsapp || "—"}</p><p>{p.email || ""}</p></td>
                      <td className="px-4 py-4"><span className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">{etiquetaEstado(p.estado)}</span></td>
                      <td className="px-4 py-4"><span className={"whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold " + (p.crm_prioridad === "alta" ? "bg-red-50 text-red-700" : p.crm_prioridad === "media" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600")}>{etiquetaPrioridad(p.crm_prioridad)}</span></td>
                      <td className={"whitespace-nowrap px-4 py-4 font-medium " + (overdue ? "text-red-700" : "text-slate-600")}>{agendaLabel}</td>
                      <td className="px-4 py-4 text-slate-600">{p.fuente === "demo" ? "Landing" : p.origen}</td>
                      <td className="px-4 py-4"><div className="flex gap-2">
                        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-green-50 px-3 py-2 font-semibold text-green-700">WhatsApp</a>}
                        <button type="button" onClick={() => open(p)} className="whitespace-nowrap rounded-lg bg-slate-100 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-200">Seguimiento</button>
                      </div></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            )}
          <div className="flex items-center justify-between border-t p-4 text-sm text-slate-600">
            <button type="button" disabled={page === 0 || loading} onClick={() => setPage(v => v - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Anterior</button>
            <span>Página {page + 1} de {Math.max(1, Math.ceil(total / pageSize))}</span>
            <button type="button" disabled={loading || (page + 1) * pageSize >= total} onClick={() => setPage(v => v + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Siguiente</button>
          </div>
        </section>

        {selected && <section className="space-y-6 rounded-2xl border bg-white p-5 sm:p-6" aria-label="Seguimiento del prospecto">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{selected.negocio || selected.nombre || "Solicitud de demo"}</h2>
              <p className="mt-1 text-sm text-slate-600">{selected.whatsapp || "Sin WhatsApp"} · {selected.email || "Sin correo"}</p>
            </div>
            <button type="button" disabled={saving || activitySaving} onClick={() => setSelected(null)} className="rounded-lg border px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50">Cerrar</button>
          </div>
          {selected.comentarios && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{selected.comentarios}</p>}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Agenda y prioridad</h3>
              <label className="block text-sm font-medium text-slate-700">Estado comercial
                <select value={editStatus} disabled={saving} onChange={e => setEditStatus(e.target.value as Estado)} className="mt-1 block w-full rounded-lg border p-2">
                  {Object.entries(estados).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">Prioridad
                <select value={editPriority} disabled={saving} onChange={e => setEditPriority(e.target.value as Prioridad)} className="mt-1 block w-full rounded-lg border p-2">
                  {Object.entries(prioridades).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">Próximo contacto (hora de México)
                <input type="date" value={nextContact} disabled={saving} onChange={e => setNextContact(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" />
              </label>
              <label className="block text-sm font-medium text-slate-700">Notas internas
                <textarea value={notes} disabled={saving} onChange={e => setNotes(e.target.value)} maxLength={4000} rows={5} className="mt-1 block w-full rounded-lg border p-3" />
              </label>
              {editError && <p role="alert" className="text-sm text-red-700">{editError}</p>}
              <button type="button" disabled={saving || activitySaving} onClick={save} className="rounded-xl bg-green-700 px-5 py-2 font-semibold text-white hover:bg-green-800 disabled:opacity-50">
                {saving ? "Guardando…" : "Guardar seguimiento"}
              </button>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Registrar actividad</h3>
              <label className="block text-sm font-medium text-slate-700">Tipo de interacción
                <select value={activityType} disabled={activitySaving} onChange={e => setActivityType(e.target.value as TipoActividad)} className="mt-1 block w-full rounded-lg border p-2">
                  {Object.entries(tiposActividad).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">¿Qué ocurrió?
                <textarea value={activityText} disabled={activitySaving} onChange={e => setActivityText(e.target.value)} maxLength={2000} rows={4}
                  placeholder="Ej. Se llamó al prospecto y pidió una demostración para el jueves."
                  className="mt-1 block w-full rounded-lg border p-3" />
              </label>
              <p className="text-xs text-slate-500">El historial se guarda por separado de los cambios de agenda.</p>
              {activitiesError && <p role="alert" className="text-sm text-red-700">{activitiesError}</p>}
              {activityNotice && <p role="status" className="text-sm text-green-700">{activityNotice}</p>}
              <button type="button" disabled={activitySaving || saving || !activityText.trim()} onClick={addActivity}
                className="rounded-xl border border-green-700 px-5 py-2 font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50">
                {activitySaving ? "Registrando…" : "Registrar actividad"}
              </button>
            </div>
          </div>
          <div className="border-t pt-5">
            <h3 className="text-lg font-bold text-slate-900">Historial de actividades</h3>
            <p className="mt-1 text-xs text-slate-500">Últimas 50 interacciones, ordenadas de la más reciente a la más antigua.</p>
            {activitiesLoading ? <p className="mt-4 text-sm text-slate-500">Cargando historial…</p>
              : activities.length === 0 ? <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Todavía no hay actividades registradas.</p>
              : <ol className="mt-4 space-y-3">{activities.map(activity => (
                <li key={activity.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-slate-900">{tiposActividad[activity.tipo] ?? activity.tipo}</strong>
                    <time dateTime={activity.created_at} className="text-xs text-slate-500">{fechaHora(activity.created_at)}</time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{activity.detalle}</p>
                </li>
              ))}</ol>}
          </div>
        </section>}
      </div>
    </main>
  );
}
