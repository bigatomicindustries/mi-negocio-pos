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
type Periodo = "7d" | "30d" | "90d" | "all";
type FiltroFuente = "todas" | Fuente;
type PuntoTendencia = { etiqueta: string; desde: string; hasta: string; cantidad: number };
type ResumenFuente = { fuente: Fuente; total: number; convertidos: number };

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
const opcionesPeriodo: { value: Periodo; label: string }[] = [
  { value: "7d", label: "7 días" }, { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" }, { value: "all", label: "Histórico" },
];
const nombresFuente: Record<Fuente, string> = { demo: "Solicitud rápida", lead: "Formulario completo" };
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

function fechaMini(fecha: string) {
  return new Date(fecha + "T12:00:00Z").toLocaleDateString("es-MX", {
    timeZone: timezone, day: "numeric", month: "short",
  });
}

// Ciudad de México no observa horario de verano desde 2022. El corte es medianoche local.
function inicioDiaMexico(fecha: string) {
  return fecha + "T00:00:00-06:00";
}

function inicioPeriodo(periodo: Periodo, hoy: string) {
  if (periodo === "all") return null;
  const dias = periodo === "7d" ? 7 : periodo === "30d" ? 30 : 90;
  return sumarDias(hoy, -(dias - 1));
}

function construirIntervalos(periodo: Periodo, hoy: string): PuntoTendencia[] {
  if (periodo === "all") {
    return Array.from({ length: 6 }, (_, i) => {
      const mes = new Date(hoy + "T12:00:00Z");
      mes.setUTCDate(1);
      mes.setUTCMonth(mes.getUTCMonth() - (5 - i));
      const desde = mes.toISOString().slice(0, 10);
      const etiqueta = mes.toLocaleDateString("es-MX", { timeZone: "UTC", month: "short" });
      mes.setUTCMonth(mes.getUTCMonth() + 1);
      const hasta = i === 5 ? hoy : sumarDias(mes.toISOString().slice(0, 10), -1);
      return { etiqueta, desde, hasta, cantidad: 0 };
    });
  }
  const dias = periodo === "7d" ? 7 : periodo === "30d" ? 30 : 90;
  const paso = periodo === "7d" ? 1 : periodo === "30d" ? 5 : 15;
  const comienzo = sumarDias(hoy, -(dias - 1));
  return Array.from({ length: dias / paso }, (_, i) => {
    const desde = sumarDias(comienzo, i * paso);
    const hasta = sumarDias(desde, paso - 1);
    return { etiqueta: fechaMini(desde), desde, hasta, cantidad: 0 };
  });
}

function porcentaje(parte: number, total: number) {
  return total > 0 ? ((parte / total) * 100).toFixed(1) + "%" : "0%";
}

function celdaCsv(valor: string | number) {
  return '"' + String(valor).replace(/"/g, '""') + '"';
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
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [fuente, setFuente] = useState<FiltroFuente>("todas");
  const [serie, setSerie] = useState<PuntoTendencia[]>([]);
  const [fuentesResumen, setFuentesResumen] = useState<ResumenFuente[]>([]);
  const [ultimaActualizacion, setUltimaActualizacion] = useState<Date | null>(null);
  const [mensajeReporte, setMensajeReporte] = useState("");
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
      const inicio = inicioPeriodo(periodo, hoy);
      const corte = inicioDiaMexico(sumarDias(hoy, 1));
      const basePeriodo = () => {
        let q = supabase.from("crm_prospectos")
          .select("id", { count: "exact", head: true })
          .lt("created_at", corte);
        if (inicio) q = q.gte("created_at", inicioDiaMexico(inicio));
        return q;
      };
      const base = () => {
        let q = basePeriodo();
        if (fuente !== "todas") q = q.eq("fuente", fuente);
        return q;
      };
      const baseAgenda = () => {
        let q = supabase.from("crm_prospectos")
          .select("id", { count: "exact", head: true })
          .in("estado", estadosAbiertos);
        if (fuente !== "todas") q = q.eq("fuente", fuente);
        return q;
      };
      const intervalos = construirIntervalos(periodo, hoy);
      const respuestas = await Promise.all([
        base(),
        ...etapas.map(etapa => base().eq("estado", etapa.key)),
        baseAgenda().lt("crm_proximo_contacto", hoy),
        baseAgenda().eq("crm_proximo_contacto", hoy),
        baseAgenda().gt("crm_proximo_contacto", hoy).lte("crm_proximo_contacto", sumarDias(hoy, 7)),
        baseAgenda().is("crm_proximo_contacto", null),
        baseAgenda().eq("crm_prioridad", "alta"),
        basePeriodo().eq("fuente", "demo"),
        basePeriodo().eq("fuente", "demo").eq("estado", "convertido"),
        basePeriodo().eq("fuente", "lead"),
        basePeriodo().eq("fuente", "lead").eq("estado", "convertido"),
        ...intervalos.map(p => base().gte("created_at", inicioDiaMexico(p.desde))
          .lt("created_at", inicioDiaMexico(sumarDias(p.hasta, 1)))),
      ]);
      if (cancelled) return;
      if (respuestas.some(respuesta => respuesta.error)) {
        setResumen(null);
        setSerie([]);
        setFuentesResumen([]);
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
        setFuentesResumen([
          { fuente: "demo", total: cantidades[12], convertidos: cantidades[13] },
          { fuente: "lead", total: cantidades[14], convertidos: cantidades[15] },
        ]);
        setSerie(intervalos.map((p, i) => ({ ...p, cantidad: cantidades[16 + i] })));
        setUltimaActualizacion(new Date());
      }
      setCargandoResumen(false);
    }
    void cargarResumen();
    return () => { cancelled = true; };
  }, [authLoading, esPlatformAdmin, hoy, periodo, fuente, revision]);

  useEffect(() => {
    if (authLoading || !esPlatformAdmin) return;
    let cancelled = false;

    async function cargarListas() {
      setCargandoListas(true);
      setErrorAgenda("");
      setErrorActividades("");
      const [agendaResult, actividadResult] = await Promise.all([
        (() => {
          let q = supabase.from("crm_prospectos")
            .select("id,fuente,nombre,negocio,estado,crm_prioridad,crm_proximo_contacto")
            .in("estado", estadosAbiertos)
            .lte("crm_proximo_contacto", sumarDias(hoy, 7));
          if (fuente !== "todas") q = q.eq("fuente", fuente);
          return q.order("crm_proximo_contacto", { ascending: true }).limit(8);
        })(),
        (() => {
          let q = supabase.from("crm_actividades")
            .select("id,tipo,detalle,created_at,demo_request_id,lead_id");
          if (fuente === "demo") q = q.not("demo_request_id", "is", null);
          if (fuente === "lead") q = q.not("lead_id", "is", null);
          return q.order("created_at", { ascending: false }).limit(8);
        })(),
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
  }, [authLoading, esPlatformAdmin, hoy, fuente, revision]);

  function exportarCsv() {
    if (!resumen || cargandoResumen) return;
    const periodoTexto = opcionesPeriodo.find(p => p.value === periodo)?.label ?? periodo;
    const origenTexto = fuente === "todas" ? "Todas" : nombresFuente[fuente];
    const filas: (string | number)[][] = [
      ["Mi Negocio", "Reporte comercial CRM 1.3"],
      ["Fecha de corte (CDMX)", hoy],
      ["Periodo de captación", periodoTexto],
      ["Fuente filtrada", origenTexto],
      ["Nota", "Las etapas y conversiones representan estados actuales, no movimientos históricos."],
      ["Nota", "La agenda considera todos los prospectos abiertos de la fuente elegida, sin limitar por fecha de captación."],
      [],
      ["Indicador", "Valor"],
      ["Prospectos captados", resumen.total],
      ["Convertidos", resumen.etapas.convertido],
      ["Conversión actual (%)", porcentaje(resumen.etapas.convertido, resumen.total)],
      ["Seguimientos vencidos", resumen.vencidos],
      ["Seguimientos para hoy", resumen.hoy],
      ["Próximos 7 días", resumen.proximos],
      ["Sin fecha", resumen.sinFecha],
      ["Alta prioridad (abiertos)", resumen.alta],
      [],
      ["Etapa actual", "Prospectos", "Participación (%)"],
      ...etapas.map(etapa => [
        etapa.label, resumen.etapas[etapa.key], porcentaje(resumen.etapas[etapa.key], resumen.total),
      ]),
      [],
      ["Origen (mismo periodo)", "Prospectos", "Convertidos", "Conversión actual (%)"],
      ...fuentesResumen.map(origen => [
        nombresFuente[origen.fuente], origen.total, origen.convertidos,
        porcentaje(origen.convertidos, origen.total),
      ]),
      [],
      ["Tendencia de captación", "Desde", "Hasta", "Prospectos"],
      ...serie.map(p => [p.etiqueta, p.desde, p.hasta, p.cantidad]),
    ];
    const contenido = "\uFEFFsep=;\r\n" + filas.map(fila => fila.map(celdaCsv).join(";")).join("\r\n");
    const archivo = new Blob([contenido], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(archivo);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = "mi-negocio-reporte-comercial-" + hoy + ".csv";
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMensajeReporte("Reporte CSV generado. Solo contiene métricas agregadas, sin datos personales.");
  }

  async function copiarResumen() {
    if (!resumen || cargandoResumen) return;
    const texto = [
      "Mi Negocio · Resumen comercial",
      "Corte: " + fechaCorta(hoy),
      "Periodo: " + (opcionesPeriodo.find(p => p.value === periodo)?.label ?? periodo),
      "Fuente: " + (fuente === "todas" ? "Todas" : nombresFuente[fuente]),
      "Prospectos: " + resumen.total,
      "Convertidos: " + resumen.etapas.convertido,
      "Conversión actual: " + porcentaje(resumen.etapas.convertido, resumen.total),
      "Seguimientos pendientes (vencidos + hoy): " + (resumen.vencidos + resumen.hoy),
      "Alta prioridad (abiertos): " + resumen.alta,
      "Nota: conversión por estado actual, no histórica.",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      setMensajeReporte("Resumen copiado al portapapeles.");
    } catch {
      setMensajeReporte("No se pudo copiar. Puedes descargar el reporte CSV.");
    }
  }

  if (authLoading || !esPlatformAdmin) return null;

  const total = resumen?.total ?? 0;
  const convertidos = resumen?.etapas.convertido ?? 0;
  const tasa = porcentaje(convertidos, total);
  const pendientes = (resumen?.vencidos ?? 0) + (resumen?.hoy ?? 0);
  const maximoTendencia = Math.max(1, ...serie.map(p => p.cantidad));
  const totalFuentes = fuentesResumen.reduce((acc, p) => acc + p.total, 0);
  const periodoTexto = opcionesPeriodo.find(p => p.value === periodo)?.label ?? periodo;
  const hayDatos = !cargandoResumen && resumen !== null;
  const kpis = [
    { label: "Prospectos captados", value: total.toLocaleString("es-MX"), detail: "En el periodo seleccionado", accent: "bg-slate-800", color: "text-slate-900" },
    { label: "Convertidos", value: convertidos.toLocaleString("es-MX"), detail: "Estado comercial actual", accent: "bg-emerald-500", color: "text-emerald-700" },
    { label: "Conversión actual", value: tasa, detail: "Convertidos / captados", accent: "bg-teal-500", color: "text-teal-700" },
    { label: "Seguimientos pendientes", value: pendientes.toLocaleString("es-MX"), detail: "Vencidos + para hoy · agenda global", accent: "bg-amber-400", color: "text-amber-700" },
    { label: "Prioridad alta", value: (resumen?.alta ?? 0).toLocaleString("es-MX"), detail: "Prospectos abiertos · agenda global", accent: "bg-rose-400", color: "text-rose-700" },
  ];
  const agendaKpis = [
    { label: "Vencidos", value: resumen?.vencidos ?? 0, color: "text-rose-700" },
    { label: "Para hoy", value: resumen?.hoy ?? 0, color: "text-amber-700" },
    { label: "Próximos 7 días", value: resumen?.proximos ?? 0, color: "text-emerald-700" },
    { label: "Sin fecha", value: resumen?.sinFecha ?? 0, color: "text-slate-700" },
  ];
  const consejo = !resumen
    ? { titulo: "Tu operación, bajo control", detalle: "Revisa las métricas y los seguimientos pendientes.", tono: "border-slate-200 bg-white" }
    : resumen.vencidos > 0
      ? { titulo: "Atiende primero los vencidos", detalle: "Tienes " + resumen.vencidos + " seguimiento(s) con fecha pasada. Revisa la agenda para recuperar estas oportunidades.", tono: "border-rose-200 bg-rose-50" }
      : resumen.hoy > 0
        ? { titulo: "Hoy tienes contactos por atender", detalle: "Hay " + resumen.hoy + " seguimiento(s) programados para hoy. Registra el resultado en el historial.", tono: "border-amber-200 bg-amber-50" }
        : resumen.sinFecha > 0
          ? { titulo: "Organiza tus próximos contactos", detalle: "Hay " + resumen.sinFecha + " prospecto(s) abierto(s) sin fecha de seguimiento.", tono: "border-sky-200 bg-sky-50" }
          : { titulo: "Agenda al día", detalle: "No hay contactos vencidos ni pendientes para hoy en la fuente seleccionada.", tono: "border-emerald-200 bg-emerald-50" };

  return (
    <main className="min-h-screen bg-[#f5f7f6] px-4 py-8 text-slate-900 sm:px-6 lg:py-10">
      <div className="mx-auto max-w-7xl space-y-7">
        <nav aria-label="Navegación comercial" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-semibold">
          <Link href="/superadmin" className="text-slate-600 transition hover:text-emerald-700">← Administración</Link>
          <Link href="/superadmin/prospectos" className="text-emerald-700 transition hover:text-emerald-900">Seguimiento de prospectos →</Link>
        </nav>

        <header className="relative isolate overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-8 text-white shadow-xl shadow-slate-900/10 sm:px-9 sm:py-10">
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full border border-emerald-400/20 bg-emerald-400/10 blur-2xl" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 right-12 h-40 w-40 rounded-full border border-emerald-200/10" />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.17em] text-emerald-200">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                Mi Negocio · CRM 1.3 · DEV
              </p>
              <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">Tu operación comercial, <span className="text-emerald-300">en perspectiva.</span></h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                Comprende de dónde llegan tus oportunidades, en qué etapa están y qué contactos necesitan atención.
              </p>
            </div>
            <Link href="/superadmin/prospectos"
              className="inline-flex items-center justify-center rounded-xl bg-emerald-400 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200">
              Gestionar prospectos <span aria-hidden="true" className="ml-2">↗</span>
            </Link>
          </div>
          <div className="relative mt-8 flex flex-wrap items-center gap-3 border-t border-white/10 pt-5 text-xs text-slate-300">
            <span className="rounded-full bg-white/10 px-3 py-1.5">Entorno de desarrollo</span>
            <span>Zona horaria: Ciudad de México</span>
            <span aria-hidden="true" className="hidden text-white/30 sm:inline">•</span>
            <span>Último corte: {ultimaActualizacion ? fechaHora(ultimaActualizacion.toISOString()) : "Por calcular"}</span>
          </div>
        </header>

        <section aria-label="Herramientas de análisis" className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label htmlFor="crm-periodo" className="block min-w-[160px] text-xs font-bold text-slate-600">
              Periodo de captación
              <select id="crm-periodo" value={periodo} onChange={e => { setPeriodo(e.target.value as Periodo); setMensajeReporte(""); }}
                className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
                {opcionesPeriodo.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <label htmlFor="crm-fuente" className="block min-w-[190px] text-xs font-bold text-slate-600">
              Fuente de captación
              <select id="crm-fuente" value={fuente} onChange={e => { setFuente(e.target.value as FiltroFuente); setMensajeReporte(""); }}
                className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
                <option value="todas">Todas las fuentes</option>
                <option value="demo">Solicitud rápida</option>
                <option value="lead">Formulario completo</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={actualizar}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">
              ↻ Actualizar
            </button>
            <button type="button" onClick={() => void copiarResumen()} disabled={!hayDatos}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">
              Copiar resumen
            </button>
            <button type="button" onClick={exportarCsv} disabled={!hayDatos}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
              ↓ Exportar CSV
            </button>
          </div>
          <p className="w-full text-xs text-slate-500">
            El periodo filtra prospectos por fecha de registro. La agenda y las actividades recientes se muestran aparte para no perder seguimientos antiguos.
            El CSV contiene métricas, no datos personales.
          </p>
          {mensajeReporte && <p role="status" className="w-full text-sm font-medium text-emerald-700">{mensajeReporte}</p>}
        </section>

        {errorResumen && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800">{errorResumen}</div>}
        <section aria-label="Indicadores clave" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {kpis.map((kpi, index) => (
            <article key={kpi.label} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <span aria-hidden="true" className={"absolute left-0 top-0 h-1 w-full " + kpi.accent} />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{kpi.label}</p>
                <span aria-hidden="true" className="text-xs font-bold text-slate-300">0{index + 1}</span>
              </div>
              <p className={"mt-5 text-3xl font-extrabold tabular-nums tracking-tight " + kpi.color}>{hayDatos ? kpi.value : "—"}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">{kpi.detail}</p>
            </article>
          ))}
        </section>

        <section aria-label="Lectura de prioridades" className={"flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 " + consejo.tono}>
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-lg shadow-sm">◎</span>
            <div>
              <h2 className="font-bold text-slate-900">{consejo.titulo}</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{consejo.detalle}</p>
            </div>
          </div>
          <Link href="/superadmin/prospectos" className="shrink-0 text-sm font-bold text-emerald-800 hover:underline">Ir a seguimiento →</Link>
        </section>

        <div className="grid gap-6 lg:grid-cols-12">
          <section aria-labelledby="embudo-titulo" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:col-span-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">01 · Pipeline</p>
                <h2 id="embudo-titulo" className="mt-2 text-xl font-bold text-slate-900">Distribución del embudo</h2>
                <p className="mt-1 text-sm text-slate-500">Etapa actual de los prospectos captados en {periodoTexto.toLowerCase()}.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">{hayDatos ? total + " prospectos" : "Calculando…"}</span>
            </div>
            <div role="img" aria-label="Distribución porcentual por etapa" className="mt-6 flex h-3 overflow-hidden rounded-full bg-slate-100">
              {etapas.map(etapa => (
                <div key={etapa.key} className={etapa.color}
                  style={{ width: total > 0 ? (resumen?.etapas[etapa.key] ?? 0) / total * 100 + "%" : "0%" }}
                  title={etapa.label + ": " + (resumen?.etapas[etapa.key] ?? 0)} />
              ))}
            </div>
            <div className="mt-7 space-y-4">
              {etapas.map(etapa => {
                const cantidad = resumen?.etapas[etapa.key] ?? 0;
                const valor = total > 0 ? cantidad / total * 100 : 0;
                return (
                  <div key={etapa.key}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 font-medium text-slate-700"><span aria-hidden="true" className={"h-2.5 w-2.5 rounded-full " + etapa.color} />{etapa.label}</span>
                      <span className="font-bold tabular-nums text-slate-800">{hayDatos ? cantidad + " · " + porcentaje(cantidad, total) : "—"}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="meter"
                      aria-label={etapa.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={valor}>
                      <div className={"h-full rounded-full " + etapa.color} style={{ width: valor + "%" }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-7 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              La conversión se calcula con el estado <strong>Convertido</strong> al momento de consultar.
              Este gráfico no muestra transiciones históricas entre etapas ni ingresos.
            </p>
          </section>

          <section aria-labelledby="tendencia-titulo" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:col-span-5">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">02 · Captación</p>
            <h2 id="tendencia-titulo" className="mt-2 text-xl font-bold text-slate-900">Evolución de registros</h2>
            <p className="mt-1 text-sm text-slate-500">
              {periodo === "all" ? "Últimos 6 meses (aunque el resumen sea histórico)." : "Registros nuevos durante el periodo seleccionado."}
            </p>
            <div className="mt-7 flex h-56 items-end gap-2 border-b border-slate-200 pb-1 sm:gap-3" role="img"
              aria-label={"Gráfica de registros nuevos. " + serie.map(p => p.etiqueta + ": " + p.cantidad).join(", ")}>
              {serie.map(p => (
                <div key={p.desde} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-xs font-bold tabular-nums text-slate-600">{hayDatos ? p.cantidad : "—"}</span>
                  <div className="flex h-[174px] w-full items-end justify-center">
                    <div className={"w-full max-w-12 rounded-t-lg transition-all " + (p.cantidad > 0 ? "bg-gradient-to-t from-emerald-700 to-emerald-400" : "bg-slate-100")}
                      style={{ height: p.cantidad > 0 ? Math.max(5, p.cantidad / maximoTendencia * 100) + "%" : "3px" }}
                      title={fechaMini(p.desde) + " – " + fechaMini(p.hasta) + ": " + p.cantidad + " registros"} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2 sm:gap-3">
              {serie.map(p => <span key={p.desde} className="min-w-0 flex-1 text-center text-[10px] font-semibold text-slate-500 sm:text-xs">{p.etiqueta}</span>)}
            </div>
            {!cargandoResumen && total === 0 && <p className="mt-4 text-sm text-slate-500">No hay registros para este filtro.</p>}
            <p className="mt-6 text-xs leading-5 text-slate-500">
              Se cuentan prospectos por fecha de creación, no por fecha de conversión.
            </p>
          </section>
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <section aria-labelledby="origen-titulo" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:col-span-5">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">03 · Origen</p>
            <h2 id="origen-titulo" className="mt-2 text-xl font-bold text-slate-900">Rendimiento por fuente</h2>
            <p className="mt-1 text-sm text-slate-500">Comparación de ambos formularios para {periodoTexto.toLowerCase()}.</p>
            <div className="mt-7 space-y-7">
              {fuentesResumen.map((origen, index) => {
                const participacion = totalFuentes > 0 ? origen.total / totalFuentes * 100 : 0;
                return (
                  <div key={origen.fuente}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-semibold text-slate-800">{nombresFuente[origen.fuente]}</p>
                      <span className="text-sm font-bold tabular-nums text-slate-800">{origen.total} <span className="font-normal text-slate-500">registros</span></span>
                    </div>
                    <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
                      <div className={"h-full rounded-full " + (index === 0 ? "bg-emerald-500" : "bg-sky-500")} style={{ width: participacion + "%" }} />
                    </div>
                    <div className="mt-2 flex justify-between gap-2 text-xs text-slate-500">
                      <span>{porcentaje(origen.total, totalFuentes)} de la captación</span>
                      <span>{origen.convertidos} convertidos · {porcentaje(origen.convertidos, origen.total)}</span>
                    </div>
                  </div>
                );
              })}
              {fuentesResumen.length === 0 && <p className="text-sm text-slate-500">Calculando fuentes…</p>}
            </div>
            <p className="mt-7 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
              Esta comparación siempre incluye ambas fuentes dentro del periodo seleccionado,
              aunque arriba filtres una sola fuente.
            </p>
          </section>

          <section aria-labelledby="agenda-titulo" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:col-span-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">04 · Prioridades</p>
                <h2 id="agenda-titulo" className="mt-2 text-xl font-bold text-slate-900">Agenda de seguimiento</h2>
                <p className="mt-1 text-sm text-slate-500">Prospectos abiertos de cualquier fecha de captación, filtrados por fuente.</p>
              </div>
              <Link href="/superadmin/prospectos" className="text-sm font-bold text-emerald-700 hover:underline">Gestionar agenda →</Link>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {agendaKpis.map(kpi => (
                <div key={kpi.label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
                  <p className={"mt-2 text-2xl font-extrabold tabular-nums " + kpi.color}>{hayDatos ? kpi.value : "—"}</p>
                </div>
              ))}
            </div>
            <div className="mt-7 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-800">Por atender · hasta 8 contactos</h3>
              <span className="text-xs text-slate-500">Ordenados por vencimiento</span>
            </div>
            {errorAgenda && <p role="alert" className="mt-3 text-sm text-rose-700">{errorAgenda}</p>}
            {cargandoListas ? <p className="mt-5 text-sm text-slate-500">Cargando agenda…</p> :
              !errorAgenda && agenda.length === 0 ? <p className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No hay contactos programados para los próximos 7 días ni vencidos.</p> :
              <ul className="mt-3 divide-y divide-slate-100">
                {agenda.map(p => {
                  const fecha = p.crm_proximo_contacto ?? "";
                  const etiqueta = etiquetaAgenda(fecha, hoy);
                  return (
                    <li key={p.fuente + ":" + p.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span aria-hidden="true" className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold " + (p.crm_prioridad === "alta" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600")}>
                          {p.crm_prioridad === "alta" ? "!" : "•"}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{nombreProspecto(p)}</p>
                          <p className="text-xs text-slate-500">{fechaCorta(fecha)} · Prioridad {p.crm_prioridad}</p>
                        </div>
                      </div>
                      <span className={"rounded-full px-3 py-1 text-xs font-bold " + etiqueta.color}>{etiqueta.label}</span>
                    </li>
                  );
                })}
              </ul>
            }
          </section>
        </div>

        <section aria-labelledby="actividad-titulo" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">05 · Historial</p>
              <h2 id="actividad-titulo" className="mt-2 text-xl font-bold text-slate-900">Actividad comercial reciente</h2>
              <p className="mt-1 text-sm text-slate-500">Últimas 8 interacciones, independientemente del periodo de captación.</p>
            </div>
            <Link href="/superadmin/prospectos" className="text-sm font-bold text-emerald-700 hover:underline">Registrar actividad →</Link>
          </div>
          {errorActividades && <p role="alert" className="px-5 py-4 text-sm text-rose-700">{errorActividades}</p>}
          {cargandoListas ? <p className="p-6 text-sm text-slate-500">Cargando historial…</p> :
            !errorActividades && actividades.length === 0 ? <p className="p-6 text-sm text-slate-500">Aún no hay actividades registradas para esta fuente.</p> :
            <ol className="divide-y divide-slate-100">
              {actividades.map(a => {
                const clave = a.demo_request_id ? "demo:" + a.demo_request_id : "lead:" + a.lead_id;
                return (
                  <li key={a.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:gap-4 sm:px-6">
                    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-lg text-emerald-700">↗</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900">{nombresActividad[a.tipo] ?? a.tipo} <span className="font-normal text-slate-400">·</span> {nombres[clave] ?? "Prospecto"}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{a.detalle}</p>
                    </div>
                    <time dateTime={a.created_at} className="shrink-0 text-xs font-medium text-slate-500">{fechaHora(a.created_at)}</time>
                  </li>
                );
              })}
            </ol>
          }
        </section>

        <footer className="flex flex-wrap justify-between gap-3 pb-4 text-xs leading-5 text-slate-500">
          <p>Mi Negocio CRM 1.3 · Entorno DEV · Tablero de consulta, sin cambios automáticos en prospectos.</p>
          <p>Las cifras de conversión son estados actuales; no equivalen a ventas facturadas.</p>
        </footer>
      </div>
    </main>
  );
}
