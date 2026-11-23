"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Fuente = "demo" | "lead";
type Prospecto = {
  id: string;
  fuente: Fuente;
  nombre: string | null;
  negocio: string | null;
  email: string | null;
  whatsapp: string | null;
};
type Contacto = {
  id: string;
  nombre: string | null;
  apellido: string | null;
  empresa: string | null;
  archivado_at?: string | null;
};
type Medio = { tipo: "correo" | "telefono"; valor: string; es_principal: boolean };
type Resultado = Contacto & { crm_contacto_medios: Medio[] };
type Modo = "none" | "search" | "create";
type Alta = { nombre: string; apellido: string; empresa: string; correo: string; telefono: string };

const field = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100";
const secondary = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-40";
const primary = "rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40";
const nombreContacto = (c: Contacto) => [c.nombre, c.apellido].filter(Boolean).join(" ") || c.empresa || "Contacto sin nombre";

export default function ProspectContactLink({
  prospecto, disabled = false, onBusyChange, onChange, warnUnsaved = false,
}: {
  prospecto: Prospecto;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onChange?: () => void;
  warnUnsaved?: boolean;
}) {
  const [linked, setLinked] = useState<Contacto | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<Modo>("none");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Resultado[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [alta, setAlta] = useState<Alta>({
    nombre: prospecto.nombre ?? "", apellido: "", empresa: prospecto.negocio ?? "",
    correo: prospecto.email ?? "", telefono: prospecto.whatsapp ?? "",
  });
  const foreignKey = prospecto.fuente === "demo" ? "demo_request_id" : "lead_id";
  const phoneDigits = (prospecto.whatsapp ?? "").replace(/\D/g, "");
  const phoneQuery = /^521\d{10}$/.test(phoneDigits) ? phoneDigits.slice(3)
    : /^52\d{10}$/.test(phoneDigits) ? phoneDigits.slice(2) : phoneDigits;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError("");
      try {
        const { data: relation, error: relationError } = await supabase
          .from("crm_prospecto_contactos").select("contacto_id")
          .eq(foreignKey, prospecto.id).maybeSingle();
        if (relationError) throw relationError;
        if (!relation) {
          if (!cancelled) setLinked(null);
          return;
        }
        const { data: contact, error: contactError } = await supabase
          .from("crm_contactos").select("id,nombre,apellido,empresa,archivado_at")
          .eq("id", relation.contacto_id).eq("ambito", "plataforma").maybeSingle();
        if (contactError || !contact) throw new Error(contactError?.message || "No se encontró el contacto vinculado.");
        if (!cancelled) setLinked(contact as Contacto);
      } catch (err) {
        if (!cancelled) setError("No se pudo consultar el vínculo: " + (err instanceof Error ? err.message : "Error inesperado."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [foreignKey, prospecto.id, revision]);

  useEffect(() => {
    if (mode !== "search" || linked || loading) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const { data, error: err } = await supabase.rpc("crm_listar_contactos_plataforma", {
          p_busqueda: search.trim(), p_archivados: false, p_limite: 10, p_offset: 0,
        });
        if (err) throw err;
        const result = data as { rows: Resultado[]; total: number } | null;
        if (!result || !Array.isArray(result.rows)) throw new Error("Respuesta de búsqueda inválida.");
        if (!cancelled) { setResults(result.rows); setSearchTotal(result.total); }
      } catch (err) {
        if (!cancelled) {
          setResults([]); setSearchTotal(0);
          setError("No se pudo buscar contactos: " + (err instanceof Error ? err.message : "Error inesperado."));
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [mode, search, linked, loading]);

  async function run(action: () => Promise<void>) {
    if (working || disabled || loading) return;
    setWorking(true); onBusyChange(true); setError(""); setNotice("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la operación.");
    } finally {
      setWorking(false); onBusyChange(false);
    }
  }

  function linkExisting(contact: Contacto) {
    if (!window.confirm("¿Vincular este prospecto con «" + nombreContacto(contact) + "»? No se modificarán sus datos ni el estado comercial.")) return;
    void run(async () => {
      const { error: err } = await supabase.from("crm_prospecto_contactos").insert({
        demo_request_id: prospecto.fuente === "demo" ? prospecto.id : null,
        lead_id: prospecto.fuente === "lead" ? prospecto.id : null,
        contacto_id: contact.id,
      });
      if (err) throw new Error(err.code === "23505"
        ? "Este prospecto ya está vinculado. Actualiza el seguimiento."
        : err.message);
      setMode("none");
      setNotice("Prospecto vinculado con el contacto existente.");
      setRevision(v => v + 1); onChange?.();
    });
  }

  function createContact() {
    if (!alta.nombre.trim() && !alta.empresa.trim()) {
      setError("Indica el nombre de la persona o de su empresa antes de crear el contacto.");
      return;
    }
    if (alta.nombre.length > 120 || alta.apellido.length > 120 || alta.empresa.length > 180) {
      setError("El nombre o la empresa excede la longitud permitida.");
      return;
    }
    if (alta.correo.trim() && (alta.correo.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alta.correo.trim()))) {
      setError("Revisa el correo electrónico.");
      return;
    }
    const phoneDigits = alta.telefono.replace(/\D/g, "");
    if (alta.telefono.trim() && (phoneDigits.length < 7 || phoneDigits.length > 15)) {
      setError("El teléfono debe contener entre 7 y 15 dígitos.");
      return;
    }
    void run(async () => {
      const { data, error: err } = await supabase.rpc("crm_crear_contacto_desde_prospecto", {
        p_fuente: prospecto.fuente,
        p_prospecto_id: prospecto.id,
        p_nombre: alta.nombre.trim() || null,
        p_apellido: alta.apellido.trim() || null,
        p_empresa: alta.empresa.trim() || null,
        p_correo: alta.correo.trim() || null,
        p_telefono: alta.telefono.trim() || null,
      });
      if (err) throw new Error(err.code === "23505"
        ? "No se creó el contacto: el correo o teléfono ya está registrado, o el prospecto ya tiene vínculo. Busca y vincula el contacto existente."
        : err.message);
      if (!data) throw new Error("No se obtuvo el identificador del nuevo contacto.");
      setMode("none");
      setNotice("Contacto creado y vinculado. La solicitud y su historial se conservaron.");
      setRevision(v => v + 1); onChange?.();
    });
  }

  function unlink() {
    if (!linked || !window.confirm("¿Desvincular este prospecto del contacto? Ambos registros y el historial se conservarán.")) return;
    void run(async () => {
      const { data, error: err } = await supabase.from("crm_prospecto_contactos")
        .delete().eq(foreignKey, prospecto.id).eq("contacto_id", linked.id).select("id");
      if (err || !data?.length) throw new Error(err?.message || "El vínculo cambió. Actualiza el seguimiento.");
      setNotice("Vínculo eliminado. El contacto y el prospecto siguen registrados.");
      setRevision(v => v + 1); onChange?.();
    });
  }

  return <section aria-label="Contacto del directorio" className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="font-bold text-slate-900">Contacto del directorio</h3>
        <p className="mt-1 text-xs text-slate-600">Vincula esta solicitud sin modificar el estado comercial ni el historial.</p>
      </div>
      {loading && <span className="text-xs text-slate-500">Consultando…</span>}
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-white p-3 text-sm text-emerald-800">{notice}</p>}
    {!loading && linked && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3">
      <div>
        <p className="font-semibold text-slate-900">{nombreContacto(linked)}</p>
        <p className="text-xs text-slate-500">{linked.empresa || "Sin empresa"}{linked.archivado_at ? " · Archivado" : ""}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/superadmin/contactos?contacto=${encodeURIComponent(linked.id)}`} className={secondary}
          onClick={e => { if (warnUnsaved && !window.confirm("¿Salir sin guardar el seguimiento o la actividad pendiente?")) e.preventDefault(); }}>Ver ficha</Link>
        <button type="button" className={secondary} disabled={working || disabled} onClick={unlink}>Desvincular</button>
      </div>
    </div>}
    {!loading && !linked && <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={mode === "search" ? primary : secondary} disabled={working || disabled}
          onClick={() => { if (mode !== "search") setSearch(phoneQuery || prospecto.email || prospecto.nombre || ""); setMode(mode === "search" ? "none" : "search"); setError(""); }}>
          Vincular contacto existente
        </button>
        <button type="button" className={mode === "create" ? primary : secondary} disabled={working || disabled}
          onClick={() => { setMode(mode === "create" ? "none" : "create"); setError(""); }}>
          Crear contacto desde prospecto
        </button>
      </div>
      {mode === "none" && <p className="text-xs text-slate-600">Si el correo o teléfono ya existe en el directorio, elige «Vincular contacto existente».</p>}
      {mode === "search" && <div className="space-y-3 rounded-lg bg-white p-3">
        <div className="flex flex-wrap gap-2">
          {prospecto.whatsapp && <button type="button" className={secondary} disabled={working || disabled}
            onClick={() => setSearch(phoneQuery)}>Buscar teléfono del prospecto</button>}
          {prospecto.email && <button type="button" className={secondary} disabled={working || disabled}
            onClick={() => setSearch(prospecto.email ?? "")}>Buscar correo del prospecto</button>}
          <button type="button" className={secondary} disabled={working || disabled}
            onClick={() => setSearch("")}>Ver recientes</button>
        </div>
        <label className="block text-xs font-semibold text-slate-700">Buscar por nombre, empresa, correo o teléfono
          <input className={field} maxLength={120} value={search} onChange={e => { setSearch(e.target.value); setError(""); }}
            placeholder="Buscar en todo el directorio" disabled={working || disabled}/>
        </label>
        {searchLoading ? <p className="text-sm text-slate-500">Buscando…</p>
          : results.length === 0 ? <p className="text-sm text-slate-500">No hay contactos activos con ese criterio.</p>
          : <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
            {results.map(c => {
              const email = c.crm_contacto_medios.find(m => m.tipo === "correo" && m.es_principal) ??
                c.crm_contacto_medios.find(m => m.tipo === "correo");
              const phone = c.crm_contacto_medios.find(m => m.tipo === "telefono" && m.es_principal) ??
                c.crm_contacto_medios.find(m => m.tipo === "telefono");
              return <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{nombreContacto(c)}</p>
                  <p className="text-xs text-slate-600">{c.empresa || "Sin empresa"}</p>
                  <p className="break-all text-xs text-slate-500">{phone?.valor || "Sin teléfono"} · {email?.valor || "Sin correo"}</p>
                </div>
                <button type="button" className={primary} disabled={working || disabled} onClick={() => linkExisting(c)}>Vincular</button>
              </div>;
            })}
          </div>}
        {searchTotal > 10 && <p className="text-xs text-slate-500">Se muestran 10 de {searchTotal} resultados. Refina la búsqueda para encontrar otro contacto.</p>}
      </div>}
      {mode === "create" && <div className="space-y-3 rounded-lg bg-white p-3">
        <p className="text-xs text-slate-600">Datos precargados desde la solicitud. Revísalos antes de crear. Podrás completar la ficha después.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["nombre", "apellido", "empresa", "correo", "telefono"] as const).map(key =>
            <label key={key} className="block text-xs font-semibold capitalize text-slate-700">{key === "telefono" ? "Teléfono" : key}
              <input className={field} type={key === "correo" ? "email" : key === "telefono" ? "tel" : "text"}
                maxLength={key === "correo" ? 320 : key === "telefono" ? 32 : key === "empresa" ? 180 : 120}
                value={alta[key]} disabled={working || disabled}
                onChange={e => { setAlta(v => ({ ...v, [key]: e.target.value })); setError(""); }} />
            </label>)}
        </div>
        <p className="text-xs text-slate-500">Se requiere nombre o empresa. No se permiten correos ni teléfonos repetidos en el directorio.</p>
        <button type="button" className={primary} disabled={working || disabled}
          onClick={createContact}>{working ? "Creando…" : "Crear y vincular"}</button>
      </div>}
    </div>}
  </section>;
}
