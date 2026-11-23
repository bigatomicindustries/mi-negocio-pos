"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import CrmModal from "@/components/crm/CrmModal";
import ContactProspects from "@/components/crm/ContactProspects";

type Medio = { id: string; tipo: "correo" | "telefono"; valor: string; valor_normalizado: string; es_principal: boolean };
type Contacto = { id: string; nombre: string | null; apellido: string | null; empresa: string | null; direccion: string | null; notas: string | null; created_at: string; updated_at: string; archivado_at: string | null; crm_contacto_medios: Medio[] };
type Form = { nombre: string; apellido: string; empresa: string; direccion: string; notas: string; correos: string[]; telefonos: string[] };
const empty = (): Form => ({ nombre: "", apellido: "", empresa: "", direccion: "", notas: "", correos: [""], telefonos: [""] });
const field = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";
const btn = "rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold hover:border-emerald-400 disabled:opacity-40";
const digits = (v: string) => v.replace(/\D/g, "");
const phoneKey = (v: string) => {
  const d = digits(v);
  return /^521\d{10}$/.test(d) ? d.slice(3) : /^52\d{10}$/.test(d) ? d.slice(2) : d;
};
const nombre = (c: Contacto) => [c.nombre, c.apellido].filter(Boolean).join(" ") || c.empresa || "Sin nombre";
const parseEntries = (values: string[]) => values.map(v => v.trim()).filter(Boolean);
// Compara lo que realmente se guarda: ignora espacios externos y campos de medios vacíos.
const formSnapshot = (value: Form) => JSON.stringify({
  nombre: value.nombre.trim(),
  apellido: value.apellido.trim(),
  empresa: value.empresa.trim(),
  direccion: value.direccion.trim(),
  notas: value.notas.trim(),
  correos: parseEntries(value.correos),
  telefonos: parseEntries(value.telefonos),
});
type ContactosRespuesta = { total: number; rows: Contacto[] };

// La misma consulta paginada sirve al directorio y a la exportación completa.
async function buscarContactos(busqueda: string, archivados: boolean, limite: number, offset: number): Promise<ContactosRespuesta> {
  const { data, error } = await supabase.rpc("crm_listar_contactos_plataforma", {
    p_busqueda: busqueda,
    p_archivados: archivados,
    p_limite: limite,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  const resultado = data as ContactosRespuesta | null;
  if (!resultado || !Array.isArray(resultado.rows) || typeof resultado.total !== "number" ||
    !Number.isSafeInteger(resultado.total) || resultado.total < 0) {
    throw new Error("La respuesta del directorio no tiene el formato esperado.");
  }
  return resultado;
}

// Previene la ejecución de fórmulas al abrir el CSV en Excel u otras hojas de cálculo.
const csvCell = (value: unknown) => {
  const raw = String(value ?? "");
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
};

export default function ContactosPage() {
  const router = useRouter();
  const { cargando, esPlatformAdmin } = useAuth();
  const [rows, setRows] = useState<Contacto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Contacto | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [originalForm, setOriginalForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [matches, setMatches] = useState<string[]>([]);
  const reload = useCallback(() => setRevision(n => n + 1), []);
  const hasChanges = formSnapshot(form) !== formSnapshot(originalForm);

  useEffect(() => { if (!cargando && !esPlatformAdmin) router.replace("/"); }, [cargando, esPlatformAdmin, router]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (cargando || !esPlatformAdmin) return;
    let cancelled = false;
    async function load() {
      setLoading(true); setError("");
      try {
        const result = await buscarContactos(debouncedQuery, archived, 25, page * 25);
        if (cancelled) return;
        if (page > 0 && page * 25 >= result.total) {
          setPage(0);
          return;
        }
        setRows(result.rows);
        setTotal(result.total);
      } catch (err) {
        if (cancelled) return;
        setError("No se pudo cargar el directorio: " + (err instanceof Error ? err.message : "Error inesperado."));
        setRows([]); setTotal(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [cargando, esPlatformAdmin, archived, debouncedQuery, page, revision]);

  useEffect(() => {
    if (cargando || !esPlatformAdmin) return;
    const id = new URLSearchParams(window.location.search).get("contacto");
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
    let cancelled = false;
    async function openLinkedContact() {
      const { data, error: err } = await supabase.from("crm_contactos")
        .select("id,nombre,apellido,empresa,direccion,notas,created_at,updated_at,archivado_at,crm_contacto_medios(id,tipo,valor,valor_normalizado,es_principal)")
        .eq("id", id).eq("ambito", "plataforma").maybeSingle();
      if (cancelled) return;
      if (err || !data) {
        setError(err?.message || "No se encontró el contacto vinculado.");
        return;
      }
      open(data as Contacto);
    }
    void openLinkedContact();
    return () => { cancelled = true; };
  }, [cargando, esPlatformAdmin]);

  function open(c: Contacto | null) {
    setSelected(c);
    const correos = c?.crm_contacto_medios.filter(m => m.tipo === "correo")
      .sort((a, b) => Number(b.es_principal) - Number(a.es_principal)).map(m => m.valor) ?? [];
    const telefonos = c?.crm_contacto_medios.filter(m => m.tipo === "telefono")
      .sort((a, b) => Number(b.es_principal) - Number(a.es_principal)).map(m => m.valor) ?? [];
    const nextForm: Form = c ? {
      nombre: c.nombre ?? "", apellido: c.apellido ?? "", empresa: c.empresa ?? "",
      direccion: c.direccion ?? "", notas: c.notas ?? "",
      correos: correos.length ? correos : [""],
      telefonos: telefonos.length ? telefonos : [""],
    } : empty();
    setForm(nextForm);
    setOriginalForm(nextForm);
    setMatches([]); setFormError(""); setEditing(true);
  }
  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    setMatches([]); setFormError("");
  }
  function cancelEditing() {
    if (saving) return;
    if (hasChanges && !window.confirm("¿Descartar los cambios sin guardar?")) return;
    setEditing(false);
    setMatches([]); setFormError("");
  }
  function validate() {
    if (!form.nombre.trim() && !form.empresa.trim()) return "Indica un nombre o una empresa.";
    if (form.nombre.length > 120 || form.apellido.length > 120 || form.empresa.length > 180 || form.direccion.length > 2000 || form.notas.length > 4000)
      return "Uno de los campos excede la longitud permitida.";
    if (form.correos.length > 10 || form.telefonos.length > 10) return "Máximo 10 correos y 10 teléfonos por contacto.";
    const emails = parseEntries(form.correos).map(s => s.toLowerCase());
    const phones = parseEntries(form.telefonos).map(phoneKey);
    if (emails.some(e => e.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) return "Revisa los correos electrónicos.";
    if (phones.some(p => p.length < 7 || p.length > 15)) return "Los teléfonos deben tener entre 7 y 15 dígitos.";
    if (new Set(emails).size !== emails.length || new Set(phones).size !== phones.length)
      return "Hay correos o teléfonos repetidos en el mismo contacto.";
    return "";
  }
  async function checkDuplicates() {
    const found = new Map<string, { nombre: string; motivos: Set<string> }>();
    const values = [
      ...parseEntries(form.correos).map(v => ({ tipo: "correo", value: v.toLowerCase() })),
      ...parseEntries(form.telefonos).map(v => ({ tipo: "telefono", value: phoneKey(v) })),
    ];
    for (const v of values) {
      const equivalentes = v.tipo === "telefono" && v.value.length === 10
        ? [v.value, "52" + v.value, "521" + v.value] : [v.value];
      const { data, error: err } = await supabase.from("crm_contacto_medios")
        .select("contacto_id,crm_contactos!inner(id,ambito,nombre,apellido,empresa,archivado_at)")
        .eq("tipo", v.tipo).in("valor_normalizado", equivalentes)
        .eq("crm_contactos.ambito", "plataforma").limit(101);
      if (err) throw err;
      if ((data ?? []).length > 100) throw new Error("Hay demasiadas coincidencias. Refina los datos antes de guardar.");
      for (const match of data ?? []) {
        if (match.contacto_id === selected?.id) continue;
        const c = match.crm_contactos as unknown as { nombre: string | null; apellido: string | null; empresa: string | null; archivado_at: string | null };
        const previo = found.get(match.contacto_id) ?? {
          nombre: ([c.nombre, c.apellido].filter(Boolean).join(" ") || c.empresa || "Otro contacto") + (c.archivado_at ? " [archivado]" : ""),
          motivos: new Set<string>(),
        };
        previo.motivos.add(v.tipo === "correo" ? "correo" : "teléfono");
        found.set(match.contacto_id, previo);
      }
    }
    return [...found.values()].map(c => c.nombre + " (coincide " + [...c.motivos].join(" y ") + ")");
  }

  async function save() {
    if (saving || !esPlatformAdmin || !hasChanges || matches.length > 0) return;
    const invalid = validate();
    if (invalid) { setFormError(invalid); return; }
    setSaving(true); setFormError("");
    try {
      // Verificación informativa antes de guardar: también revisa archivados.
      // El trigger de la base de datos bloquea duplicados incluso entre solicitudes simultáneas.
      const found = await checkDuplicates();
      if (found.length) {
        setMatches(found);
        setFormError("No se guardó el contacto. Elimina o cambia los datos repetidos para continuar.");
        return;
      }
      const { data, error: err } = await supabase.rpc("crm_guardar_contacto_plataforma", {
        p_contacto_id: selected?.id ?? null,
        p_expected_updated_at: selected?.updated_at ?? null,
        p_nombre: form.nombre.trim() || null,
        p_apellido: form.apellido.trim() || null,
        p_empresa: form.empresa.trim() || null,
        p_direccion: form.direccion.trim() || null,
        p_notas: form.notas.trim() || null,
        p_correos: parseEntries(form.correos),
        p_telefonos: parseEntries(form.telefonos),
      });
      if (err) {
        if (err.code === "23505") throw new Error("Este correo o teléfono ya está registrado en otro contacto. Modifícalo para poder guardar.");
        throw new Error(err.message);
      }
      if (!data) throw new Error("No se pudo guardar el contacto.");
      setEditing(false); setMatches([]);
      setNotice(selected ? "Contacto actualizado." : "Contacto creado.");
      reload();
    } catch (err) {
      setFormError((err instanceof Error ? err.message : "No se pudo guardar.") +
        " Si se interrumpió la conexión, actualiza el directorio antes de reintentar.");
    } finally { setSaving(false); }
  }

  async function exportCsv() {
    if (exporting || saving || loading || !esPlatformAdmin) return;
    const busqueda = query.trim();
    if (busqueda.length > 120) { setError("La búsqueda no puede exceder 120 caracteres."); return; }
    if (!window.confirm("¿Exportar los contactos " + (archived ? "archivados" : "activos") +
      " que coincidan con el filtro? El CSV incluirá datos personales, notas y direcciones. Guárdalo en un lugar seguro.")) return;
    setExporting(true); setError(""); setNotice("");
    try {
      const primera = await buscarContactos(busqueda, archived, 100, 0);
      if (primera.total === 0) { setNotice("No hay contactos para exportar con este filtro."); return; }
      if (primera.total > 2000) throw new Error("Por seguridad, el CSV admite hasta 2,000 contactos. Acota la búsqueda.");
      const todos = [...primera.rows];
      for (let offset = todos.length; offset < primera.total; offset += 100) {
        const lote = await buscarContactos(busqueda, archived, 100, offset);
        if (lote.total !== primera.total) throw new Error("El directorio cambió durante la exportación. Inténtalo nuevamente.");
        todos.push(...lote.rows);
      }
      if (todos.length !== primera.total || new Set(todos.map(c => c.id)).size !== primera.total)
        throw new Error("No se pudo obtener una exportación consistente. Actualiza el directorio e inténtalo de nuevo.");

      const encabezados = ["Nombre", "Apellido", "Empresa", "Dirección", "Notas", "Correos", "Teléfonos", "Archivado", "Fecha de alta"];
      const lineas = todos.map(c => [
        c.nombre, c.apellido, c.empresa, c.direccion, c.notas,
        c.crm_contacto_medios.filter(m => m.tipo === "correo").map(m => m.valor).join(" | "),
        c.crm_contacto_medios.filter(m => m.tipo === "telefono").map(m => m.valor).join(" | "),
        c.archivado_at ? "Sí" : "No", c.created_at,
      ].map(csvCell).join(","));
      const csv = "\uFEFF" + [encabezados.map(csvCell).join(","), ...lineas].join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = "mi-negocio-contactos-" + (archived ? "archivados-" : "activos-") +
        new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Exportación preparada: " + todos.length + " contactos. Protege el archivo CSV.");
    } catch (err) {
      setError("No se pudo exportar: " + (err instanceof Error ? err.message : "Error inesperado."));
    } finally { setExporting(false); }
  }

  async function setArchive(c: Contacto, archive: boolean) {
    if (saving || !esPlatformAdmin) return;
    if (archive && !window.confirm("¿Archivar este contacto?")) return;
    setSaving(true); setError("");
    const { data, error: err } = await supabase.from("crm_contactos")
      .update({ archivado_at: archive ? new Date().toISOString() : null })
      .eq("id", c.id).eq("updated_at", c.updated_at).eq("ambito", "plataforma").select("id");
    if (err || !data?.length) setError(err?.message || "El contacto cambió. Actualiza la lista.");
    else { setNotice(archive ? "Contacto archivado." : "Contacto recuperado."); reload(); }
    setSaving(false);
  }

  if (cargando || !esPlatformAdmin) return null;
  return (
    <main className="min-h-screen bg-[#f5f7f6] px-4 py-8 text-slate-900 sm:px-6 lg:py-10">
      <div className="mx-auto max-w-7xl space-y-7">
        <nav className="flex flex-wrap gap-5 text-sm font-semibold">
          <Link href="/superadmin/tablero" className="text-slate-600 hover:text-emerald-700">← Tablero comercial</Link>
          <Link href="/superadmin/prospectos" className="text-emerald-700 hover:underline">Seguimiento →</Link>
          <Link href="/superadmin/centro-trabajo" className="text-emerald-700 hover:underline">Centro de trabajo →</Link>
        </nav>
        <header className="rounded-[28px] bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-9 text-white shadow-lg sm:px-9">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Mi Negocio · CRM 1.5 · DEV</p>
          <h1 className="mt-4 text-3xl font-bold sm:text-4xl">Contactos, <span className="text-emerald-300">sin complicaciones.</span></h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Personas y empresas en un solo directorio, con varios teléfonos y correos. El sistema bloquea nuevos datos duplicados.</p>
          <p className="mt-4 text-xs text-emerald-200">Directorio interno · Acceso para clientes desactivado</p>
        </header>
        <section className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="w-full max-w-md text-xs font-bold text-slate-600">Buscar en todos los contactos
            <input value={query} maxLength={120} onChange={e => { setQuery(e.target.value); setPage(0); }} className={field} placeholder="Nombre, empresa, teléfono o correo" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setArchived(v => !v); setPage(0); }} className={btn}>{archived ? "Ver activos" : "Ver archivados"}</button>
            <button type="button" onClick={reload} className={btn}>Actualizar</button>
            <button type="button" disabled={loading || saving || exporting} onClick={() => void exportCsv()} className={btn}>{exporting ? "Exportando…" : "Exportar CSV"}</button>
            <button type="button" onClick={() => open(null)} className="rounded-xl bg-emerald-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-300">+ Nuevo contacto</button>
          </div>
          <p className="w-full text-xs text-slate-500">Búsqueda global por nombre, empresa, teléfono o correo. Resultados paginados de 25 en 25. Exporta los resultados filtrados (máximo 2,000).</p>
        </section>
        {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap justify-between gap-3 border-b p-5">
            <h2 className="text-lg font-bold">Directorio {archived ? "archivado" : "activo"}</h2>
            <span className="text-sm text-slate-500">{loading ? "Cargando…" : total + " contactos"}</span>
          </div>
          {loading ? <p className="p-8 text-sm text-slate-500">Cargando contactos…</p> : rows.length === 0
            ? <p className="p-8 text-sm text-slate-500">No hay contactos con estos criterios.</p>
            : <div className="divide-y divide-slate-100">{rows.map(c => {
              const mail = c.crm_contacto_medios.find(m => m.tipo === "correo" && m.es_principal) ??
                c.crm_contacto_medios.find(m => m.tipo === "correo");
              const phone = c.crm_contacto_medios.find(m => m.tipo === "telefono" && m.es_principal) ??
                c.crm_contacto_medios.find(m => m.tipo === "telefono");
              return <article key={c.id} className="flex flex-wrap items-center justify-between gap-4 p-5 hover:bg-slate-50">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 font-bold text-emerald-800">{nombre(c)[0].toUpperCase()}</div>
                  <div><h3 className="font-bold">{nombre(c)}</h3>
                    <p className="text-sm text-slate-500">{c.empresa || "Sin empresa"}</p>
                    <p className="break-all text-xs text-slate-600">{phone?.valor || "Sin teléfono"} · {mail?.valor || "Sin correo"}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => open(c)} className={btn}>Ver / editar</button>
                  <button type="button" disabled={saving} onClick={() => void setArchive(c, !archived)} className={btn}>{archived ? "Recuperar" : "Archivar"}</button>
                </div>
              </article>;
            })}</div>}
          <div className="flex items-center justify-between border-t p-4 text-sm text-slate-500">
            <button type="button" disabled={loading || page === 0} onClick={() => setPage(p => p - 1)} className={btn}>Anterior</button>
            <span>Página {page + 1} de {Math.max(1, Math.ceil(total / 25))}</span>
            <button type="button" disabled={loading || (page + 1) * 25 >= total} onClick={() => setPage(p => p + 1)} className={btn}>Siguiente</button>
          </div>
        </section>
        <CrmModal
          open={editing}
          title={selected ? "Editar contacto" : "Nuevo contacto"}
          description="Ficha de contacto · Directorio interno"
          onClose={cancelEditing}
          closeLabel={hasChanges ? "Cancelar" : "Cerrar"}
          actions={hasChanges ? <button
            type="button"
            disabled={saving || matches.length > 0}
            onClick={() => void save()}
            className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button> : undefined}
          busy={saving}
          alert={(matches.length > 0 || formError) ? (
            <div className={matches.length > 0
              ? "rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
              : "rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"}>
              <p className="font-bold">{matches.length > 0 ? "Guardado bloqueado: datos duplicados" : "Revisa el formulario"}</p>
              {matches.length > 0 && <ul className="mt-2 list-inside list-disc space-y-1">
                {matches.map(n => <li key={n}>{n}</li>)}
              </ul>}
              {formError && <p className="mt-2">{formError}</p>}
            </div>
          ) : undefined}
        >
          {selected && <ContactProspects key={selected.id} contactId={selected.id} warnUnsaved={hasChanges} />}
          <div className="grid gap-4 sm:grid-cols-2">
            {(["nombre", "apellido", "empresa"] as const).map(key => <label key={key} className="text-sm font-semibold text-slate-700">
              {key === "nombre" ? "Nombre" : key === "apellido" ? "Apellido" : "Empresa o tienda"}
              <input value={form[key]} maxLength={key === "empresa" ? 180 : 120} onChange={e => update(key, e.target.value)} className={field} />
            </label>)}
            <div className="text-sm text-slate-500 sm:self-end">Se requiere un nombre o una empresa.</div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700">Correos electrónicos</p>
              {form.correos.map((valor, index) => <div key={index} className="flex items-center gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{index === 0 ? "Correo principal" : `Correo ${index + 1}`}</span>
                  <input type="email" value={valor} maxLength={320} disabled={saving}
                    onChange={e => update("correos", form.correos.map((v, i) => i === index ? e.target.value : v))}
                    className={field + " mt-0"} placeholder="contacto@empresa.com" />
                </label>
                {form.correos.length > 1 && <button type="button" disabled={saving}
                  aria-label={`Quitar correo ${index + 1}`}
                  onClick={() => update("correos", form.correos.filter((_, i) => i !== index))}
                  className={btn}>Quitar</button>}
              </div>)}
              <button type="button" disabled={saving || form.correos.length >= 10} onClick={() => update("correos", [...form.correos, ""])}
                className="text-sm font-bold text-emerald-700 hover:underline">+ Agregar correo</button>
              <p className="text-xs text-slate-500">El primer correo ingresado será el principal.</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700">Teléfonos</p>
              {form.telefonos.map((valor, index) => <div key={index} className="flex items-center gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{index === 0 ? "Teléfono principal" : `Teléfono ${index + 1}`}</span>
                  <input type="tel" inputMode="tel" value={valor} maxLength={32} disabled={saving}
                    onChange={e => update("telefonos", form.telefonos.map((v, i) => i === index ? e.target.value : v))}
                    className={field + " mt-0"} placeholder="55 1234 5678" />
                </label>
                {form.telefonos.length > 1 && <button type="button" disabled={saving}
                  aria-label={`Quitar teléfono ${index + 1}`}
                  onClick={() => update("telefonos", form.telefonos.filter((_, i) => i !== index))}
                  className={btn}>Quitar</button>}
              </div>)}
              <button type="button" disabled={saving || form.telefonos.length >= 10} onClick={() => update("telefonos", [...form.telefonos, ""])}
                className="text-sm font-bold text-emerald-700 hover:underline">+ Agregar teléfono</button>
              <p className="text-xs text-slate-500">El primer teléfono ingresado será el principal. Puedes incluir la clave de país.</p>
            </div>
            <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Dirección (opcional)
              <textarea value={form.direccion} onChange={e => update("direccion", e.target.value)}
                rows={3} maxLength={2000} disabled={saving} className={field}
                placeholder="Escribe la dirección completa o las referencias que necesites, sin separar campos." />
              <span className="text-xs font-normal text-slate-500">Texto libre: calle, colonia, ciudad y referencias, como prefieras.</span>
            </label>
            <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Notas internas
              <textarea value={form.notas} onChange={e => update("notas", e.target.value)} rows={3} maxLength={4000} className={field} />
            </label>
          </div>
          <p className="mt-4 text-xs text-slate-500">Guardado atómico en DEV: ficha, correos y teléfonos se confirman juntos. Si se pierde la conexión, actualiza la lista antes de reintentar.</p>
        </CrmModal>
        <p className="text-xs text-slate-500">CRM 1.5 · DEV · Directorio interno, búsqueda global, CSV y vinculación con prospectos. Sin importación ni integraciones externas.</p>
      </div>
    </main>
  );
}
