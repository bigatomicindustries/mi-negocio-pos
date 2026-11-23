"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

type Fuente = "demo" | "lead";
type Prioridad = "baja" | "media" | "alta";
type Filtro = "todos" | "vencidos" | "hoy" | "proximos" | "sin_fecha";
type Tarea = {
  id: string;
  fuente: Fuente;
  nombre: string | null;
  negocio: string | null;
  whatsapp: string | null;
  estado: string;
  crm_prioridad: Prioridad | null;
  crm_proximo_contacto: string | null;
};
const abiertos = ["nuevo", "contactado", "demo_agendada", "en_negociacion"];
const nombresPrioridad: Record<Prioridad, string> = { alta: "Alta", media: "Media", baja: "Baja" };
const rango: Record<Prioridad, number> = { alta: 0, media: 1, baja: 2 };
const zona = "America/Mexico_City";

function diaMexico() {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const valor = (tipo: string) => partes.find(p => p.type === tipo)?.value ?? "";
  return valor("year") + "-" + valor("month") + "-" + valor("day");
}
function agregarDias(dia: string, n: number) {
  const fecha = new Date(dia + "T12:00:00Z");
  fecha.setUTCDate(fecha.getUTCDate() + n);
  return fecha.toISOString().slice(0, 10);
}
function fechaLocal(iso: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: zona }).format(new Date(iso));
}
function categoria(t: Tarea, hoy: string): Filtro {
  if (!t.crm_proximo_contacto) return "sin_fecha";
  const dia = t.crm_proximo_contacto.slice(0, 10);
  if (dia < hoy) return "vencidos";
  if (dia === hoy) return "hoy";
  return "proximos";
}
function textoCategoria(c: Filtro) {
  return { todos: "Todos", vencidos: "Vencido", hoy: "Hoy", proximos: "Próximo", sin_fecha: "Sin fecha" }[c];
}
export default function CentroTrabajoPage() {
  const router = useRouter();
  const { cargando: authLoading, esPlatformAdmin } = useAuth();
  const [hoy, setHoy] = useState(diaMexico);
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [revision, setRevision] = useState(0);

  const actualizar = useCallback(() => { setHoy(diaMexico()); setRevision(n => n + 1); }, []);
  useEffect(() => { if (!authLoading && !esPlatformAdmin) router.replace("/"); }, [authLoading, esPlatformAdmin, router]);
  useEffect(() => {
    if (authLoading || !esPlatformAdmin) return;
    let cancelado = false;
    async function cargar() {
      setCargando(true);
      setError("");
      // Limite deliberado: no presentar una lista incompleta como si fuera exhaustiva.
      const resultado = await supabase.from("crm_prospectos")
        .select("id,fuente,nombre,negocio,whatsapp,estado,crm_prioridad,crm_proximo_contacto")
        .in("estado", abiertos)
        .order("created_at", { ascending: false })
        .limit(1001);
      if (cancelado) return;
      if (resultado.error) {
        setError("No se pudo consultar el centro de trabajo. Intenta actualizar.");
        setTareas([]);
      } else if ((resultado.data?.length ?? 0) > 1000) {
        setError("Hay más de 1000 prospectos abiertos. Se necesita paginación antes de mostrar un listado completo.");
        setTareas([]);
      } else {
        setTareas((resultado.data ?? []) as Tarea[]);
      }
      setCargando(false);
    }
    void cargar();
    return () => { cancelado = true; };
  }, [authLoading, esPlatformAdmin, revision]);

  const ordenadas = useMemo(() => [...tareas].sort((a, b) => {
    const orden = { vencidos: 0, hoy: 1, proximos: 2, sin_fecha: 3, todos: 4 };
    const ca = categoria(a, hoy), cb = categoria(b, hoy);
    if (orden[ca] !== orden[cb]) return orden[ca] - orden[cb];
    if (ca !== "sin_fecha" && a.crm_proximo_contacto !== b.crm_proximo_contacto) {
      return (a.crm_proximo_contacto ?? "").localeCompare(b.crm_proximo_contacto ?? "");
    }
    return rango[a.crm_prioridad ?? "media"] - rango[b.crm_prioridad ?? "media"];
  }), [tareas, hoy]);

  const conteos = useMemo(() => ({
    todos: tareas.length,
    vencidos: tareas.filter(t => categoria(t, hoy) === "vencidos").length,
    hoy: tareas.filter(t => categoria(t, hoy) === "hoy").length,
    proximos: tareas.filter(t => categoria(t, hoy) === "proximos" && (t.crm_proximo_contacto ?? "").slice(0, 10) <= agregarDias(hoy, 7)).length,
    sin_fecha: tareas.filter(t => categoria(t, hoy) === "sin_fecha").length,
  }), [tareas, hoy]);
  const visibles = useMemo(() => ordenadas.filter(t => {
    const c = categoria(t, hoy);
    if (filtro === "proximos" && (c !== "proximos" || (t.crm_proximo_contacto ?? "").slice(0, 10) > agregarDias(hoy, 7))) return false;
    if (filtro !== "todos" && filtro !== "proximos" && c !== filtro) return false;
    const q = busqueda.trim().toLocaleLowerCase("es-MX");
    return !q || [t.nombre, t.negocio, t.whatsapp].some(v => v?.toLocaleLowerCase("es-MX").includes(q));
  }), [ordenadas, filtro, busqueda, hoy]);

  if (authLoading || !esPlatformAdmin) return <main className="mx-auto max-w-6xl p-8 text-slate-600">Verificando acceso…</main>;
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-7">
        <nav aria-label="Navegación comercial" className="grid gap-3 text-sm font-semibold md:grid-cols-[1fr_auto_1fr] md:items-center">
          <Link href="/superadmin" className="text-slate-600 transition hover:text-emerald-700">← Administración</Link>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 sm:gap-x-5">
            <Link href="/superadmin/tablero" className="rounded-lg px-2 py-2 text-emerald-700 transition hover:bg-emerald-50 hover:text-emerald-900">CRM</Link>
            <Link href="/superadmin/prospectos" className="rounded-lg px-2 py-2 text-emerald-700 transition hover:bg-emerald-50 hover:text-emerald-900">Prospectos</Link>
            <span aria-current="page" className="rounded-lg bg-emerald-700 px-3 py-2 text-white">Centro de trabajo</span>
            <Link href="/superadmin/contactos" className="rounded-lg px-2 py-2 text-emerald-700 transition hover:bg-emerald-50 hover:text-emerald-900">Contactos</Link>
          </div>
          <div aria-hidden="true" className="hidden md:block" />
        </nav>
        <header className="rounded-3xl bg-gradient-to-br from-slate-950 to-emerald-950 px-6 py-9 text-white sm:px-9">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Mi Negocio · CRM 1.4 · DEV</p>
          <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Centro de trabajo comercial</h1>
          <p className="mt-3 max-w-2xl text-slate-300">Empieza por los contactos vencidos, continúa con los de hoy y organiza los próximos seguimientos.</p>
          <p className="mt-4 text-xs text-slate-400">Zona horaria: Ciudad de México · Fecha de referencia: {hoy}</p>
        </header>
        <section aria-label="Prioridades del día" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {([
            ["todos", "Abiertos"], ["vencidos", "Vencidos"], ["hoy", "Para hoy"],
            ["proximos", "Próximos 7 días"], ["sin_fecha", "Sin fecha"],
          ] as [Filtro, string][]).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFiltro(key)} aria-pressed={filtro === key}
              className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-emerald-400 ${filtro === key ? "border-emerald-500 ring-2 ring-emerald-100" : "border-slate-200"}`}>
              <span className="block text-xs font-semibold text-slate-600">{label}</span>
              <strong className="mt-2 block text-3xl">{cargando ? "…" : conteos[key]}</strong>
            </button>
          ))}
        </section>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 p-5">
            <div>
              <h2 className="text-xl font-bold">Contactos por atender</h2>
              <p className="mt-1 text-sm text-slate-500">Ordenados por fecha y prioridad · {visibles.length} resultados</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input aria-label="Buscar prospectos" value={busqueda} onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar nombre, negocio o teléfono" className="min-w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button type="button" onClick={actualizar} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Actualizar</button>
            </div>
          </div>
          {error && <p role="alert" className="m-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
          {cargando ? <p className="p-6 text-sm text-slate-500">Cargando prospectos…</p> :
            !error && visibles.length === 0 ? <p className="p-6 text-sm text-slate-500">No hay contactos para este filtro.</p> :
            !error && <ul className="divide-y divide-slate-100">
              {visibles.map(t => {
                const cat = categoria(t, hoy);
                const telefono = t.whatsapp?.replace(/\D/g, "") ?? "";
                const telefonoValido = /^(?:52)?\d{10}$/.test(telefono) && !/^0+$/.test(telefono.replace(/^52/, ""));
                return <li key={t.fuente + ":" + t.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-base">{t.negocio || t.nombre || "Solicitud de demo"}</strong>
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${cat === "vencidos" ? "bg-red-100 text-red-800" : cat === "hoy" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{textoCategoria(cat)}</span>
                      <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">{nombresPrioridad[t.crm_prioridad ?? "media"]}</span>
                    </div>
                    <p className="text-sm text-slate-500">{t.fuente === "demo" ? "Solicitud rápida" : "Formulario completo"} · {t.estado.replaceAll("_", " ")}</p>
                    <p className="text-sm text-slate-600">{t.crm_proximo_contacto ? "Próximo contacto: " + fechaLocal(t.crm_proximo_contacto) : "Sin fecha de seguimiento"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {telefonoValido && <a href={`https://wa.me/${telefono.length === 10 ? "52" + telefono : telefono}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100">WhatsApp</a>}
                    <Link href="/superadmin/prospectos" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Abrir seguimiento</Link>
                  </div>
                </li>;
              })}
            </ul>}
        </section>
        <p className="text-xs text-slate-500">Versión inicial de solo lectura. Las modificaciones y el historial se gestionan en Seguimiento de prospectos. No envía mensajes ni crea recordatorios automáticamente.</p>
      </div>
    </main>
  );
}
