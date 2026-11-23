"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

type Medio = { id: string; tipo: "correo" | "telefono"; valor: string; valor_normalizado: string; es_principal: boolean };
type Contacto = { id: string; nombre: string | null; apellido: string | null; empresa: string | null; notas: string | null; created_at: string; updated_at: string; archivado_at: string | null; crm_contacto_medios: Medio[] };
type Form = { nombre: string; apellido: string; empresa: string; notas: string; correos: string; telefonos: string };
const empty = (): Form => ({ nombre: "", apellido: "", empresa: "", notas: "", correos: "", telefonos: "" });
const field = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";
const btn = "rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold hover:border-emerald-400 disabled:opacity-40";
const digits = (v: string) => v.replace(/\D/g, "");
const nombre = (c: Contacto) => [c.nombre, c.apellido].filter(Boolean).join(" ") || c.empresa || "Sin nombre";
const parseLines = (v: string) => v.split("\n").map(s => s.trim()).filter(Boolean);

export default function ContactosPage() {
  const router = useRouter();
  const { cargando, esPlatformAdmin } = useAuth();
  const [rows, setRows] = useState<Contacto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Contacto | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [matches, setMatches] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const reload = useCallback(() => setRevision(n => n + 1), []);

  useEffect(() => { if (!cargando && !esPlatformAdmin) router.replace("/"); }, [cargando, esPlatformAdmin, router]);
  useEffect(() => {
    if (cargando || !esPlatformAdmin) return;
    let cancelled = false;
    async function load() {
      setLoading(true); setError("");
      const base = supabase.from("crm_contactos")
        .select("id,nombre,apellido,empresa,notas,created_at,updated_at,archivado_at,crm_contacto_medios(id,tipo,valor,valor_normalizado,es_principal)", { count: "exact" })
        .eq("ambito", "plataforma");
      const q = archived ? base.not("archivado_at", "is", null) : base.is("archivado_at", null);
      const { data, error: err, count } = await q.order("created_at", { ascending: false }).range(page * 25, page * 25 + 24);
      if (cancelled) return;
      if (err) { setError("No se pudo cargar el directorio: " + err.message); setRows([]); setTotal(0); }
      else { setRows((data ?? []) as Contacto[]); setTotal(count ?? 0); }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [cargando, esPlatformAdmin, archived, page, revision]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? rows.filter(c => [c.nombre, c.apellido, c.empresa, ...c.crm_contacto_medios.map(m => m.valor)]
      .some(v => (v ?? "").toLowerCase().includes(term))) : rows;
  }, [rows, query]);

  function open(c: Contacto | null) {
    setSelected(c);
    setForm(c ? {
      nombre: c.nombre ?? "", apellido: c.apellido ?? "", empresa: c.empresa ?? "", notas: c.notas ?? "",
      correos: c.crm_contacto_medios.filter(m => m.tipo === "correo").map(m => m.valor).join("\n"),
      telefonos: c.crm_contacto_medios.filter(m => m.tipo === "telefono").map(m => m.valor).join("\n"),
    } : empty());
    setMatches([]); setConfirmed(false); setFormError(""); setEditing(true);
  }
  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    setMatches([]); setConfirmed(false); setFormError("");
  }
  function validate() {
    if (!form.nombre.trim() && !form.empresa.trim()) return "Indica un nombre o una empresa.";
    if (form.nombre.length > 120 || form.apellido.length > 120 || form.empresa.length > 180 || form.notas.length > 4000)
      return "Uno de los campos excede la longitud permitida.";
    const emails = parseLines(form.correos).map(s => s.toLowerCase());
    const phones = parseLines(form.telefonos).map(digits);
    if (emails.some(e => e.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) return "Revisa los correos electrónicos.";
    if (phones.some(p => p.length < 7 || p.length > 15)) return "Los teléfonos deben tener entre 7 y 15 dígitos.";
    if (new Set(emails).size !== emails.length || new Set(phones).size !== phones.length)
      return "Hay correos o teléfonos repetidos en el mismo contacto.";
    return "";
  }
  async function checkDuplicates() {
    const found = new Set<string>();
    const values = [
      ...parseLines(form.correos).map(v => ({ tipo: "correo", value: v.toLowerCase() })),
      ...parseLines(form.telefonos).map(v => ({ tipo: "telefono", value: digits(v) })),
    ];
    for (const v of values) {
      const { data, error: err } = await supabase.from("crm_contacto_medios")
        .select("contacto_id,crm_contactos!inner(id,ambito,nombre,apellido,empresa,archivado_at)")
        .eq("tipo", v.tipo).eq("valor_normalizado", v.value)
        .eq("crm_contactos.ambito", "plataforma").is("crm_contactos.archivado_at", null).limit(30);
      if (err) throw err;
      for (const match of data ?? []) {
        if (match.contacto_id === selected?.id) continue;
        const c = match.crm_contactos as unknown as { nombre: string | null; apellido: string | null; empresa: string | null };
        found.add([c.nombre, c.apellido].filter(Boolean).join(" ") || c.empresa || "Otro contacto");
      }
    }
    return [...found];
  }

  async function save() {
    if (saving || !esPlatformAdmin) return;
    const invalid = validate();
    if (invalid) { setFormError(invalid); return; }
    setSaving(true); setFormError("");
    try {
      if (!confirmed) {
        const found = await checkDuplicates();
        if (found.length) {
          setMatches(found); setConfirmed(true);
          setFormError("Se encontraron posibles duplicados. Revisa antes de confirmar.");
          return;
        }
      }
      const payload = { nombre: form.nombre.trim() || null, apellido: form.apellido.trim() || null,
        empresa: form.empresa.trim() || null, notas: form.notas.trim() || null };
      let id = selected?.id;
      if (selected) {
        const { data, error: err } = await supabase.from("crm_contactos").update(payload)
          .eq("id", selected.id).eq("ambito", "plataforma").eq("updated_at", selected.updated_at)
          .select("id").single();
        if (err || !data) throw new Error(err?.message || "El contacto cambió. Actualiza la página.");
      } else {
        const { data, error: err } = await supabase.from("crm_contactos")
          .insert({ ...payload, ambito: "plataforma" }).select("id").single();
        if (err || !data) throw new Error(err?.message || "No se pudo crear el contacto.");
        id = data.id;
      }
      if (!id) throw new Error("No se obtuvo el identificador.");
      // MVP: sustituye los medios solo después de guardar el contacto.
      // No es una transacción: si falla, avisar que podría haber cambios parciales.
      const old = selected?.crm_contacto_medios ?? [];
      for (const m of old) {
        const { error: err } = await supabase.from("crm_contacto_medios").delete().eq("id", m.id);
        if (err) throw err;
      }
      const emails = parseLines(form.correos).map((valor, index) =>
        ({ contacto_id: id, tipo: "correo", valor, es_principal: index === 0 }));
      const phones = parseLines(form.telefonos).map((valor, index) =>
        ({ contacto_id: id, tipo: "telefono", valor, es_principal: index === 0 }));
      const medios = [...emails, ...phones];
      if (medios.length) {
        const { error: err } = await supabase.from("crm_contacto_medios").insert(medios);
        if (err) throw err;
      }
      setEditing(false); setMatches([]); setConfirmed(false);
      setNotice(selected ? "Contacto actualizado." : "Contacto creado.");
      reload();
    } catch (err) {
      setFormError((err instanceof Error ? err.message : "No se pudo guardar.") +
        " Algunos cambios podrían haberse aplicado; actualiza y revisa antes de reintentar.");
    } finally { setSaving(false); }
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
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Personas y empresas en un solo directorio, con varios teléfonos, correos y revisión de coincidencias.</p>
          <p className="mt-4 text-xs text-emerald-200">Directorio interno · Acceso para clientes desactivado</p>
        </header>
        <section className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="w-full max-w-md text-xs font-bold text-slate-600">Buscar en esta página
            <input value={query} onChange={e => setQuery(e.target.value)} className={field} placeholder="Nombre, empresa, teléfono o correo" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setArchived(v => !v); setPage(0); setQuery(""); }} className={btn}>{archived ? "Ver activos" : "Ver archivados"}</button>
            <button type="button" onClick={reload} className={btn}>Actualizar</button>
            <button type="button" onClick={() => open(null)} className="rounded-xl bg-emerald-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-300">+ Nuevo contacto</button>
          </div>
          <p className="w-full text-xs text-slate-500">La búsqueda filtra los 25 contactos cargados en esta página. La búsqueda global y exportación llegarán después.</p>
        </section>
        {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap justify-between gap-3 border-b p-5">
            <h2 className="text-lg font-bold">Directorio {archived ? "archivado" : "activo"}</h2>
            <span className="text-sm text-slate-500">{loading ? "Cargando…" : total + " contactos"}</span>
          </div>
          {loading ? <p className="p-8 text-sm text-slate-500">Cargando contactos…</p> : visible.length === 0
            ? <p className="p-8 text-sm text-slate-500">No hay contactos con estos criterios.</p>
            : <div className="divide-y divide-slate-100">{visible.map(c => {
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
        {editing && <section aria-label="Formulario de contacto" className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-md sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Ficha de contacto</p>
              <h2 className="mt-2 text-2xl font-bold">{selected ? "Editar contacto" : "Nuevo contacto"}</h2></div>
            <button type="button" disabled={saving} onClick={() => setEditing(false)} className={btn}>Cerrar</button>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {(["nombre", "apellido", "empresa"] as const).map(key => <label key={key} className="text-sm font-semibold text-slate-700">
              {key === "nombre" ? "Nombre" : key === "apellido" ? "Apellido" : "Empresa o tienda"}
              <input value={form[key]} maxLength={key === "empresa" ? 180 : 120} onChange={e => update(key, e.target.value)} className={field} />
            </label>)}
            <div className="text-sm text-slate-500 sm:self-end">Se requiere un nombre o una empresa.</div>
            <label className="text-sm font-semibold text-slate-700">Correos electrónicos
              <textarea value={form.correos} onChange={e => update("correos", e.target.value)} rows={4} className={field} placeholder={"contacto@empresa.com\nventas@empresa.com"} />
              <span className="text-xs font-normal text-slate-500">Un correo por línea. El primero será el principal.</span>
            </label>
            <label className="text-sm font-semibold text-slate-700">Teléfonos
              <textarea value={form.telefonos} onChange={e => update("telefonos", e.target.value)} rows={4} className={field} placeholder={"5512345678\n525512345678"} />
              <span className="text-xs font-normal text-slate-500">Un teléfono por línea. Incluye la clave de país cuando corresponda.</span>
            </label>
            <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Notas internas
              <textarea value={form.notas} onChange={e => update("notas", e.target.value)} rows={3} maxLength={4000} className={field} />
            </label>
          </div>
          {matches.length > 0 && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-bold">Posibles duplicados encontrados:</p>
            <ul className="mt-2 list-inside list-disc">{matches.map(n => <li key={n}>{n}</li>)}</ul>
            <p className="mt-2">No se fusionarán automáticamente. Revisa antes de continuar.</p>
          </div>}
          {formError && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{formError}</p>}
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" disabled={saving} onClick={() => void save()}
              className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              {saving ? "Procesando…" : confirmed ? "Confirmar y guardar" : "Revisar y guardar"}
            </button>
            <button type="button" disabled={saving} onClick={() => setEditing(false)} className={btn}>Cancelar</button>
          </div>
          <p className="mt-4 text-xs text-slate-500">Versión DEV: el guardado de datos y medios no es atómico. Si aparece un error, revisa el contacto antes de reintentar.</p>
        </section>}
        <p className="text-xs text-slate-500">CRM 1.5 · DEV · Directorio interno. Sin exportación, importación ni integración externa todavía.</p>
      </div>
    </main>
  );
}
