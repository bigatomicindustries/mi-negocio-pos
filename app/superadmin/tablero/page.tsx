"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

const etapas = [
  { key: "nuevo", label: "Nuevos", color: "bg-sky-500" },
  { key: "contactado", label: "Contactados", color: "bg-blue-600" },
  { key: "demo_agendada", label: "Demo agendada", color: "bg-violet-500" },
  { key: "en_negociacion", label: "En negociación", color: "bg-amber-500" },
  { key: "convertido", label: "Convertidos", color: "bg-green-600" },
  { key: "descartado", label: "Descartados", color: "bg-slate-400" },
] as const;

type Estado = (typeof etapas)[number]["key"];
type Fuente = "demo" | "lead";
type Prioridad = "baja" | "media" | "alta";

type Resumen = {
  total: number;
  etapas: Record<Estado, number>;
  vencidos: number;
  hoy: number;
  proximos: number;
  sinFecha: number;
  alta: number;
};

type ProspectoAgenda = {
  id: string;
  fuente: Fuente;
  nombre: string | null;
  negocio: string | null;
  estado: string;
  crm_prioridad: Prioridad;
  crm_proximo_contacto: string | null;
};

type Actividad = {
  id: string;
  tipo: string;
  detalle: string;
  created_at: string;
  demo_request_id: string | null;
  lead_id: string | null;
};

const timezone = "America/Mexico_City";
const estadosAbiertos = ["nuevo", "contactado", "demo_agendada", "en_negociacion"];
const nombresActividad: Record<string, string> = {
  llamada: "Llamada", whatsapp: "WhatsApp", correo: "Correo",
  reunion: "Reunión", nota: "Nota",
};

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

function nombreProspecto(p: { fuente: Fuente; nombre: string | null; negocio: string | null }) {
  return p.negocio || p.nombre || (p.fuente === "demo" ? "Solicitud de demo" : "Prospecto");
}

function etiquetaAgenda(fecha: string, hoy: string) {
  if (fecha < hoy) return { label: "Vencido", color: "bg-red-50 text-red-700" };
  if (fecha === hoy) return { label: "Hoy", color: "bg-amber-50 text-amber-800" };
  return { label: "Próximo", color: "bg-green-50 text-green-700" };
}

export default function TableroComercialPage() {
  const router = useRouter();
  const { cargando: authLoading, esPlatformAdmin } = useAuth();
  const [hoy, setHoy] = useState(hoyMexico);
  const [revision, setRevision] = useState(0);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(true);
  const [errorResumen, setErrorResumen] = useState("");
  const [agenda, setAgenda] = useState<ProspectoAgenda[]>([]);
  const [actividades, setActividades] = useState<Actividad[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [cargandoListas, setCargandoListas] = useState(true);
  const [errorAgenda, setErrorAgenda] = useState("");
  const [errorActividades, setErrorActividades] = useState("");

  const actualizar = useCallback(() => {
    setHoy(hoyMexico());
    setRevision(value => value + 1);
  }, []);

  useEffect(() => {
    if (!authLoading && !esPlatformAdmin) router.replace("/");
  }, [authLoading, esPlatformAdmin, router]);

  useEffect(() => {
    if (authLoading || !esPlatformAdmin) return;
    let cancelled = false;

    async function cargarResumen() {
      setCargandoResumen(true);
      setErrorResumen("");
      const base = () => supabase.from("crm_prospectos").select("id", { count: "exact", head: true });
      const fin = sumarDias(hoy, 7);
      const respuestas = await Promise.all([
        base(),
        ...etapas.map(etapa => base().eq("estado", etapa.key)),
        base().in("estado", estadosAbiertos).lt("crm_proximo_contacto", hoy),
        base().in("estado", estadosAbiertos).eq("crm_proximo_contacto", hoy),
        base().in("estado", estadosAbiertos).gt("crm_proximo_contacto", hoy).lte("crm_proximo_contacto", fin),
        base().in("estado", estadosAbiertos).is("crm_proximo_contacto", null),
        base().in("estado", estadosAbiertos).eq("crm_prioridad", "alta"),
      ]);
      if (cancelled) return;
      if (respuestas.some(respuesta => respuesta.error)) {
        setResumen(null);
        setErrorResumen("No se pudieron calcular los indicadores. Intenta actualizar.");
      } else {
        const cantidades = respuestas.map(respuesta => respuesta.count ?? 0);
        const porEtapa = Object.fromEntries(etapas.map((etapa, i) => [etapa.key, cantidades[i + 1]])) as Record<Estado, number>;
        setResumen({
          total: cantidades[0],
          etapas: porEtapa,
          vencidos: cantidades[7],
          hoy: cantidades[8],
          proximos: cantidades[9],
          sinFecha: cantidades[10],
          alta: cantidades[11],
        });
      }
      setCargandoResumen(false);
    }
    void cargarResumen();
    return () => { cancelled = true; };
  }, [authLoading, esPlatformAdmin, hoy, revision]);

  useEffect(() => {
    if (authLoading || !esPlatformAdmin) return;
    let cancelled = false;

    async function cargarListas() {
      setCargandoListas(true);
      setErrorAgenda("");
      setErrorActividades("");
      const [agendaResult, actividadResult] = await Promise.all([
        supabase.from("crm_prospectos")
          .select("id,fuente,nombre,negocio,estado,crm_prioridad,crm_proximo_contacto")
          .in("estado", estadosAbiertos)
          .lte("crm_proximo_contacto", sumarDias(hoy, 7))
          .order("crm_proximo_contacto", { ascending: true })
          .order("crm_prioridad", { ascending: false })
          .limit(8),
        supabase.from("crm_actividades")
          .select("id,tipo,detalle,created_at,demo_request_id,lead_id")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      if (cancelled) return;
      if (agendaResult.error) {
        setAgenda([]);
        setErrorAgenda("No se pudo cargar la agenda.");
      } else {
        setAgenda((agendaResult.data ?? []) as ProspectoAgenda[]);
      }
      if (actividadResult.error) {
        setActividades([]);
        setNombres({});
        setErrorActividades("No se pudo cargar la actividad reciente.");
      } else {
        const recientes = (actividadResult.data ?? []) as Actividad[];
        setActividades(recientes);
        const ids = [...new Set(recientes.map(a => a.demo_request_id ?? a.lead_id).filter((id): id is string => Boolean(id)))];
        if (ids.length) {
          const { data, error } = await supabase.from("crm_prospectos")
            .select("id,fuente,nombre,negocio").in("id", ids);
          if (cancelled) return;
          if (error) {
            setNombres({});
          } else {
            const mapa: Record<string, string> = {};
            for (const p of data ?? []) {
              mapa[p.fuente + ":" + p.id] = nombreProspecto(p as { fuente: Fuente; nombre: string | null; negocio: string | null });
            }
            setNombres(mapa);
          }
        } else {
          setNombres({});
        }
      }
      setCargandoListas(false);
    }
    void cargarListas();
    return () => { cancelled = true; };
  }, [authLoading, esPlatformAdmin, hoy, revision]);

  if (authLoading || !esPlatformAdmin) return null;

  const total = resumen?.total ?? 0;
  const convertidos = resumen?.etapas.convertido ?? 0;
  const conversion = total > 0 ? ((convertidos / total) * 100).toFixed(1) + "%" : "0%";
  const kpis = [
    { label: "Prospectos totales", value: total, color: "text-slate-900" },
    { label: "Convertidos", value: convertidos, color: "text-green-700" },
    { label: "Conversión actual", value: conversion, color: "text-green-700" },
    { label: "Seguimientos pendientes", value: (resumen?.vencidos ?? 0) + (resumen?.hoy ?? 0), color: "text-amber-700" },
    { label: "Alta prioridad · abiertos", value: resumen?.alta ?? 0, color: "text-red-700" },
  ];
  const agendaKpis = [
    { label: "Vencidos", value: resumen?.vencidos ?? 0, color: "text-red-700" },
    { label: "Para hoy", value: resumen?.hoy ?? 0, color: "text-amber-700" },
    { label: "Próximos 7 días", value: resumen?.proximos ?? 0, color: "text-green-700" },
    { label: "Sin fecha · abiertos", value: resumen?.sinFecha ?? 0, color: "text-slate-600" },
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <nav aria-label="Navegación comercial" className="flex flex-wrap gap-5 text-sm font-semibold">
          <Link href="/superadmin" className="text-green-700 hover:underline">← Negocios</Link>
          <Link href="/superadmin/prospectos" className="text-green-700 hover:underline">Ver prospectos y seguimiento →</Link>
        </nav>

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-green-600">Administración SaaS · CRM 1.2 · DEV</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">Tablero comercial</h1>
            <p className="mt-2 text-slate-500">Tu embudo, agenda y actividad comercial en un solo lugar.</p>
          </div>
          <button type="button" onClick={actualizar}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
            Actualizar
          </button>
        </header>

        {errorResumen && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorResumen}</p>}
        <section aria-label="Indicadores comerciales" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {kpis.map(kpi => (
            <div key={kpi.label} className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-sm text-slate-500">{kpi.label}</p>
              <p className={"mt-2 text-3xl font-bold " + kpi.color}>{cargandoResumen || !resumen ? "—" : kpi.value}</p>
            </div>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-5">
          <section aria-labelledby="embudo-titulo" className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-3">
            <h2 id="embudo-titulo" className="text-xl font-bold text-slate-900">Embudo de ventas</h2>
            <p className="mt-1 text-sm text-slate-500">Distribución por estado actual de los prospectos.</p>
            <div className="mt-6 space-y-5">
              {etapas.map(etapa => {
                const cantidad = resumen?.etapas[etapa.key] ?? 0;
                const porcentaje = total > 0 ? (cantidad / total) * 100 : 0;
                return (
                  <div key={etapa.key}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-slate-700">{etapa.label}</span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        {cargandoResumen || !resumen ? "—" : cantidad + " · " + porcentaje.toFixed(0) + "%"}
                      </span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-slate-100" role="meter"
                      aria-label={etapa.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={porcentaje}>
                      <div className={"h-full rounded-full transition-all " + etapa.color} style={{ width: porcentaje + "%" }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-6 text-xs text-slate-500">
              Conversión actual = prospectos con estado «Convertido» ÷ prospectos totales.
              No representa ingresos ni conversiones históricas.
            </p>
          </section>

          <section aria-labelledby="agenda-titulo" className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2">
            <h2 id="agenda-titulo" className="text-xl font-bold text-slate-900">Agenda comercial</h2>
            <p className="mt-1 text-sm text-slate-500">Seguimientos de prospectos abiertos.</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {agendaKpis.map(kpi => (
                <div key={kpi.label} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{kpi.label}</p>
                  <p className={"mt-1 text-2xl font-bold " + kpi.color}>{cargandoResumen || !resumen ? "—" : kpi.value}</p>
                </div>
              ))}
            </div>
            <h3 className="mt-6 font-bold text-slate-900">Contactos prioritarios por fecha</h3>
            <p className="mt-1 text-xs text-slate-500">Hasta 8 contactos vencidos, de hoy o de los próximos 7 días.</p>
            {errorAgenda && <p role="alert" className="mt-3 text-sm text-red-700">{errorAgenda}</p>}
            {cargandoListas ? <p className="mt-4 text-sm text-slate-500">Cargando agenda…</p> :
              !errorAgenda && agenda.length === 0 ? <p className="mt-4 text-sm text-slate-500">No hay contactos programados en este periodo.</p> :
              <ul className="mt-4 divide-y divide-slate-100">
                {agenda.map(p => {
                  const fecha = p.crm_proximo_contacto ?? "";
                  const etiqueta = etiquetaAgenda(fecha, hoy);
                  return (
                    <li key={p.fuente + ":" + p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{nombreProspecto(p)}</p>
                        <p className="text-xs text-slate-500">{fechaCorta(fecha)} · Prioridad {p.crm_prioridad}</p>
                      </div>
                      <span className={"rounded-full px-2 py-1 text-xs font-semibold " + etiqueta.color}>{etiqueta.label}</span>
                    </li>
                  );
                })}
              </ul>
            }
          </section>
        </div>

        <section aria-labelledby="actividad-titulo" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-5">
            <div>
              <h2 id="actividad-titulo" className="text-xl font-bold text-slate-900">Actividad reciente</h2>
              <p className="mt-1 text-sm text-slate-500">Últimas 8 interacciones registradas en el CRM.</p>
            </div>
            <Link href="/superadmin/prospectos" className="text-sm font-semibold text-green-700 hover:underline">
              Registrar actividad →
            </Link>
          </div>
          {errorActividades && <p role="alert" className="px-5 py-4 text-sm text-red-700">{errorActividades}</p>}
          {cargandoListas ? <p className="p-5 text-sm text-slate-500">Cargando actividad…</p> :
            !errorActividades && actividades.length === 0 ? <p className="p-5 text-sm text-slate-500">Aún no hay actividades registradas.</p> :
            <ul className="divide-y divide-slate-100">
              {actividades.map(a => {
                const clave = (a.demo_request_id ? "demo:" + a.demo_request_id : "lead:" + a.lead_id);
                return (
                  <li key={a.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{nombresActividad[a.tipo] ?? a.tipo} · {nombres[clave] ?? "Prospecto"}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{a.detalle}</p>
                    </div>
                    <time dateTime={a.created_at} className="shrink-0 text-xs text-slate-500">{fechaHora(a.created_at)}</time>
                  </li>
                );
              })}
            </ul>
          }
        </section>
        <p className="text-xs text-slate-500">Datos de Mi Negocio DEV. El tablero es de consulta; los cambios se realizan en Seguimiento comercial.</p>
      </div>
    </main>
  );
}
