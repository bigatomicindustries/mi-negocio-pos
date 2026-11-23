"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

const stages = ["nuevo", "contactado", "propuesta", "negociacion", "ganado", "perdido"] as const;
type Stage = typeof stages[number];
const names: Record<Stage,string> = {nuevo:"Nuevo",contactado:"Contactado",propuesta:"Propuesta",negociacion:"Negociación",ganado:"Ganado",perdido:"Perdido"};
type Contact = {id:string; nombre:string|null; apellido:string|null; empresa:string|null};
type Opportunity = {id:string;contacto_id:string;titulo:string;etapa:Stage;valor_estimado:number;fecha_cierre_estimada:string|null;notas:string|null};
const inputStyle="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none";
const money=(value:number)=>new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(value);
export default function OportunidadesPage(){
 const router=useRouter();
 const {cargando,esPlatformAdmin}=useAuth();
 const [contacts,setContacts]=useState<Contact[]>([]);
 const [rows,setRows]=useState<Opportunity[]>([]);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [movingId,setMovingId]=useState<string|null>(null);
 const [dragId,setDragId]=useState<string|null>(null);
 const [overStage,setOverStage]=useState<Stage|null>(null);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [title,setTitle]=useState("");
 const [contactId,setContactId]=useState("");
 const [value,setValue]=useState("0");
 const [closeDate,setCloseDate]=useState("");
 const [notes,setNotes]=useState("");
 const [search,setSearch]=useState("");
 const [filterContactId,setFilterContactId]=useState("");
 const [showCreate,setShowCreate]=useState(false);
 const modalRef=useRef<HTMLDivElement>(null);
 const openButtonRef=useRef<HTMLButtonElement>(null);
 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const [op,co]=await Promise.all([
   supabase.from("crm_oportunidades").select("id,contacto_id,titulo,etapa,valor_estimado,fecha_cierre_estimada,notas").order("created_at",{ascending:false}).limit(500),
   supabase.from("crm_contactos").select("id,nombre,apellido,empresa").eq("ambito","plataforma").is("archivado_at",null).order("nombre").limit(1000)
  ]);
  if(op.error||co.error)setError(op.error?.message||co.error?.message||"Error al consultar el CRM");
  else {setRows((op.data||[]) as Opportunity[]);setContacts((co.data||[]) as Contact[]);}
  setLoading(false);
 },[]);
 useEffect(()=>{if(!cargando&&!esPlatformAdmin)router.replace("/superadmin");},[cargando,esPlatformAdmin,router]);
 useEffect(()=>{if(!cargando&&esPlatformAdmin)void load();},[cargando,esPlatformAdmin,load]);
 useEffect(()=>{if(!showCreate)return;const previous=document.body.style.overflow;document.body.style.overflow="hidden";const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape"&&!saving)setShowCreate(false);if(e.key==="Tab"&&modalRef.current){const focusable=Array.from(modalRef.current.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])"));if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};document.addEventListener("keydown",onKey);modalRef.current?.querySelector<HTMLElement>("select")?.focus();return()=>{document.body.style.overflow=previous;document.removeEventListener("keydown",onKey);openButtonRef.current?.focus();};},[showCreate,saving]);
 const normalize=(s:string)=>s.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLocaleLowerCase("es-MX");
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get("ver_contacto");if(id)setFilterContactId(id);},[]);
 useEffect(()=>{if(loading||!contacts.length)return;const id=new URLSearchParams(window.location.search).get("contacto");if(!id)return;const found=contacts.some(c=>c.id===id);if(found){setContactId(id);setShowCreate(true);}else setError("El contacto solicitado no está disponible o está archivado.");window.history.replaceState(null,"",window.location.pathname);},[loading,contacts]);
 const contactName=(id:string)=>{const c=contacts.find(x=>x.id===id);return c?[c.nombre,c.apellido].filter(Boolean).join(" ")||c.empresa||"Sin nombre":"Contacto no disponible";};
 async function create(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(saving)return;
  const amount=Number(value);
  if(!title.trim()||!contactId||!Number.isFinite(amount)||amount<0){setError("Completa el contacto, título e importe válido.");return;}
  setSaving(true);setError("");setNotice("");
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user){setError("Tu sesión expiró. Vuelve a iniciar sesión.");setSaving(false);return;}
  const {error:saveError}=await supabase.from("crm_oportunidades").insert({contacto_id:contactId,titulo:title.trim(),valor_estimado:amount,fecha_cierre_estimada:closeDate||null,notas:notes.trim()||null,created_by:user.id});
  if(saveError)setError(saveError.message);
  else {setTitle("");setContactId("");setValue("0");setCloseDate("");setNotes("");setNotice("Oportunidad creada.");setShowCreate(false);await load();}
  setSaving(false);
 }
 async function changeStage(row:Opportunity,stage:Stage){
  if(row.etapa===stage||movingId)return;
  setError("");setNotice("");setMovingId(row.id);
  const {error:saveError}=await supabase.from("crm_oportunidades").update({etapa:stage,updated_at:new Date().toISOString()}).eq("id",row.id).eq("etapa",row.etapa).select("id").single();
  if(saveError){setError("No se pudo mover la oportunidad: "+saveError.message);}
  else {setRows(current=>current.map(x=>x.id===row.id?{...x,etapa:stage}:x));setNotice("Oportunidad movida a "+names[stage]+".");}
  setMovingId(null);
 }
 function dropOn(stage:Stage){
  const row=rows.find(x=>x.id===dragId);
  setDragId(null);setOverStage(null);
  if(row&&row.etapa!==stage)void changeStage(row,stage);
 }
 if(cargando||!esPlatformAdmin)return <main className="p-8 text-slate-600">Verificando acceso…</main>;
 return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
  <div className="mx-auto max-w-7xl space-y-8">
   <nav aria-label="Navegación comercial" className="grid gap-3 text-sm font-semibold md:grid-cols-[1fr_auto_1fr] md:items-center">
    <Link href="/superadmin" className="text-slate-600 hover:text-emerald-700">← Administración</Link>
    <div className="flex flex-wrap items-center justify-center gap-3">
     <Link href="/superadmin/tablero" className="px-2 py-2 text-emerald-700">CRM</Link>
     <Link href="/superadmin/prospectos" className="px-2 py-2 text-emerald-700">Prospectos</Link>
     <Link href="/superadmin/centro-trabajo" className="px-2 py-2 text-emerald-700">Centro de trabajo</Link>
     <Link href="/superadmin/contactos" className="px-2 py-2 text-emerald-700">Contactos</Link>
     <span aria-current="page" className="rounded-lg bg-emerald-700 px-3 py-2 text-white">Oportunidades</span>
    </div><div aria-hidden="true" className="hidden md:block"/>
   </nav>
   {error&&<div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">{error}</div>}
   {notice&&<div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-800">{notice}</div>}
   {filterContactId&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><p><strong>Filtro por contacto:</strong> {contactName(filterContactId)} · {rows.filter(x=>x.contacto_id===filterContactId).length} oportunidades</p><button type="button" className="rounded-lg border border-emerald-300 bg-white px-3 py-2 font-semibold hover:bg-emerald-100" onClick={()=>{setFilterContactId("");window.history.replaceState(null,"",window.location.pathname);}}>Ver todas las oportunidades</button></div>}
   <section aria-label="Herramientas de oportunidades" className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end">
    <label className="min-w-0 flex-1 text-sm font-semibold text-slate-700">Buscar oportunidades
     <input type="search" value={search} onChange={e=>setSearch(e.target.value)} className={inputStyle+" mt-2"} placeholder="Nombre de contacto, empresa u oportunidad…" aria-label="Buscar oportunidades"/>
    </label>
    <button ref={openButtonRef} type="button" onClick={()=>{setError("");setShowCreate(true);}} className="shrink-0 rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white transition hover:bg-emerald-700">+ Nueva oportunidad</button>
   </section>
   {showCreate&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-6" onMouseDown={e=>{if(e.target===e.currentTarget&&!saving)setShowCreate(false);}}>
    <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="create-opportunity-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
     <div className="mb-5 flex items-center justify-between gap-3">
      <h2 id="create-opportunity-title" className="text-xl font-bold">Nueva oportunidad</h2>
      <button type="button" onClick={()=>setShowCreate(false)} disabled={saving} aria-label="Cerrar formulario" className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50">✕</button>
     </div>
     {error&&<p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
     <label className="text-sm font-medium">Contacto existente<select className={inputStyle+" mt-1"} value={contactId} onChange={e=>setContactId(e.target.value)} required><option value="">Selecciona un contacto</option>{contacts.map(c=><option key={c.id} value={c.id}>{[c.nombre,c.apellido].filter(Boolean).join(" ")||c.empresa||"Sin nombre"}{c.empresa&&c.nombre?" · "+c.empresa:""}</option>)}</select></label>
     <label className="text-sm font-medium">Nombre de oportunidad<input className={inputStyle+" mt-1"} value={title} onChange={e=>setTitle(e.target.value)} maxLength={180} required placeholder="Ej. Suscripción anual"/></label>
     <label className="text-sm font-medium">Valor estimado (MXN)<input className={inputStyle+" mt-1"} type="number" min="0" step="0.01" value={value} onChange={e=>setValue(e.target.value)} required/></label>
     <label className="text-sm font-medium">Cierre estimado<input className={inputStyle+" mt-1"} type="date" value={closeDate} onChange={e=>setCloseDate(e.target.value)}/></label>
     <label className="text-sm font-medium sm:col-span-2">Notas<input className={inputStyle+" mt-1"} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Detalles relevantes"/></label>
     <button type="button" onClick={()=>setShowCreate(false)} disabled={saving} className="rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button><button type="submit" disabled={saving||!contacts.length} className="rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{saving?"Guardando…":"+ Crear oportunidad"}</button>
    </form>
    </div>
   </div>}
   <section aria-label="Etapas del pipeline" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
     <h2 className="text-xl font-bold">Tablero comercial</h2>
     <p className="text-sm text-slate-500">Arrastra una tarjeta a otra columna o utiliza «Mover a etapa». Desplázate horizontalmente para ver todas las etapas.</p>
    </div>
    <div className="overflow-x-auto pb-4" tabIndex={0} aria-label="Desplazamiento horizontal del pipeline">
     <div className="flex min-w-max items-start gap-4">
      {stages.map(stage=>{const items=rows.filter(x=>x.etapa===stage&&(!filterContactId||x.contacto_id===filterContactId)&&(!search.trim()||normalize([x.titulo,contactName(x.contacto_id),contacts.find(c=>c.id===x.contacto_id)?.empresa||""].join(" ")).includes(normalize(search.trim()))));return <div key={stage}
       onDragOver={e=>{if(dragId){e.preventDefault();e.dataTransfer.dropEffect="move";setOverStage(stage);}}}
       onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOverStage(null);}}
       onDrop={e=>{e.preventDefault();dropOn(stage);}}
       className={`flex h-[min(70vh,720px)] w-[300px] shrink-0 flex-col rounded-2xl border p-3 transition-colors sm:w-[330px] ${overStage===stage?"border-emerald-500 bg-emerald-50":"border-slate-200 bg-slate-100"}`}>
       <div className="mb-3 shrink-0 border-b border-slate-200 pb-3">
        <div className="flex items-center justify-between"><h3 className="font-bold">{names[stage]}</h3><span className="rounded-full bg-white px-3 py-1 text-sm">{items.length}</span></div>
        <p className="mt-2 text-sm font-semibold text-slate-600">{money(items.reduce((s,x)=>s+Number(x.valor_estimado),0))}</p>
       </div>
       <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {items.map(row=><article key={row.id} draggable={!movingId}
         onDragStart={e=>{setDragId(row.id);e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",row.id);}}
         onDragEnd={()=>{setDragId(null);setOverStage(null);}}
         aria-label={`Oportunidad ${row.titulo}, etapa ${names[row.etapa]}`}
         className={`cursor-grab rounded-xl border border-slate-200 bg-white p-4 shadow-sm active:cursor-grabbing ${dragId===row.id?"opacity-40":""} ${movingId===row.id?"opacity-60":""}`}>
         <h4 className="font-semibold">{row.titulo}</h4><p className="mt-1 text-sm"><Link href={`/superadmin/contactos?contacto=${encodeURIComponent(row.contacto_id)}`} className="font-medium text-emerald-700 underline-offset-2 hover:underline" draggable={false} onDragStart={e=>e.stopPropagation()}>{contactName(row.contacto_id)} ↗</Link></p>
         <p className="mt-2 font-semibold text-emerald-700">{money(Number(row.valor_estimado))}</p>
         {row.fecha_cierre_estimada&&<p className="mt-1 text-xs text-slate-500">Cierre estimado: {row.fecha_cierre_estimada}</p>}
         {row.notas&&<p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{row.notas}</p>}
         <label className="mt-3 block text-xs font-semibold text-slate-600">Mover a etapa
          <select disabled={!!movingId} className={inputStyle+" mt-1"} value={row.etapa} onChange={e=>void changeStage(row,e.target.value as Stage)}>{stages.map(s=><option key={s} value={s}>{names[s]}</option>)}</select>
         </label>
        </article>)}
        {!items.length&&<p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">{loading?"Cargando…":dragId?"Suelta aquí":"Sin oportunidades"}</p>}
       </div>
      </div>})}
     </div>
    </div>
   </section>
   {rows.length===500&&<p className="text-sm text-amber-700">Mostrando las primeras 500 oportunidades. Se agregará paginación en una próxima mejora.</p>}
  </div>
 </main>;
}
