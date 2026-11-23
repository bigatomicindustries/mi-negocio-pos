"use client";
import {Suspense,useCallback,useEffect,useState} from "react";
import {useAuth} from "@/context/AuthContext";
import {supabase} from "@/lib/supabase";
import BusinessContacts,{type Contact} from "@/components/crm/BusinessContacts";
import CRMWorkspace,{type CRMSection} from "@/components/crm/CRMWorkspace";
import CRMOpportunityBoard,{type CRMStage} from "@/components/crm/CRMOpportunityBoard";
import {useSearchParams} from "next/navigation";

type Opportunity={id:string;contacto_id:string;titulo:string;etapa:string;valor_estimado:number;created_at:string};
type Task={id:string;oportunidad_id:string;titulo:string;vence_at:string;completada_at:string|null};
const stages=["nuevo","contactado","propuesta","negociacion","ganado","perdido"];
const money=(v:number)=>new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(v);
const input="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
function NegocioCRMContent(){
 const {negocio,user,perfil,cargando}=useAuth();
 const params=useSearchParams();
 const requested=params.get("seccion");
 const section:CRMSection=requested==="contactos"||requested==="oportunidades"||requested==="trabajo"?requested:"resumen";
 const [allowed,setAllowed]=useState(false),[checking,setChecking]=useState(true),[loading,setLoading]=useState(false);
 const [contacts,setContacts]=useState<Contact[]>([]),[opps,setOpps]=useState<Opportunity[]>([]),[tasks,setTasks]=useState<Task[]>([]);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[saving,setSaving]=useState(false);
 const [title,setTitle]=useState(""),[contact,setContact]=useState(""),[amount,setAmount]=useState("0");
 const [taskTitle,setTaskTitle]=useState(""),[taskDue,setTaskDue]=useState(""),[taskOpp,setTaskOpp]=useState("");
 const [editing,setEditing]=useState<Opportunity|null>(null),[editTitle,setEditTitle]=useState(""),[editContact,setEditContact]=useState(""),[editAmount,setEditAmount]=useState("0"),[editStage,setEditStage]=useState<CRMStage>("nuevo"),[editOriginal,setEditOriginal]=useState(""),[editError,setEditError]=useState("");
 const editSnapshot=(t:string,c:string,a:string,s:CRMStage)=>JSON.stringify([t.trim(),c,Number(a),s]);
 const editDirty=!!editing&&editSnapshot(editTitle,editContact,editAmount,editStage)!==editOriginal;
 function openOpportunity(id:string){const row=opps.find(o=>o.id===id);if(!row)return;setEditing(row);setEditTitle(row.titulo);setEditContact(row.contacto_id);setEditAmount(String(row.valor_estimado));setEditStage(row.etapa as CRMStage);setEditOriginal(editSnapshot(row.titulo,row.contacto_id,String(row.valor_estimado),row.etapa as CRMStage));setEditError("");}
 function closeOpportunity(){if(saving)return;if(editDirty&&!window.confirm("¿Descartar cambios sin guardar?"))return;setEditing(null);setEditError("");}
 async function saveOpportunity(e:React.FormEvent){e.preventDefault();if(!editing||!editDirty||saving||!allowed||!negocio)return;const value=Number(editAmount);if(!editTitle.trim()||editTitle.trim().length>240||!contacts.some(c=>c.id===editContact)||!Number.isFinite(value)||value<0){setEditError("Revisa título, contacto y valor estimado.");return;}setSaving(true);setEditError("");const r=await supabase.from("crm_negocio_oportunidades").update({titulo:editTitle.trim(),contacto_id:editContact,valor_estimado:value,etapa:editStage,updated_at:new Date().toISOString()}).eq("id",editing.id).eq("business_id",negocio.id).select("id");if(r.error)setEditError("No se pudo guardar: "+r.error.message);else if(!r.data?.length)setEditError("No se actualizó el registro. Revisa tus permisos.");else{setEditing(null);setNotice("Oportunidad actualizada.");await load();}setSaving(false);}

 const load=useCallback(async()=>{
  if(!negocio?.id)return;
  setLoading(true);setError("");
  const [c,o,t]=await Promise.all([
   supabase.from("crm_contactos").select("id,nombre,apellido,empresa,direccion,notas,updated_at,crm_contacto_medios(tipo,valor)").eq("ambito","negocio").eq("business_id",negocio.id).is("archivado_at",null).order("created_at",{ascending:false}).limit(500),
   supabase.from("crm_negocio_oportunidades").select("id,contacto_id,titulo,etapa,valor_estimado,created_at").eq("business_id",negocio.id).order("created_at",{ascending:false}).limit(500),
   supabase.from("crm_negocio_tareas").select("id,oportunidad_id,titulo,vence_at,completada_at").order("vence_at",{ascending:true}).limit(500)
  ]);
  if(c.error||o.error||t.error){setError("No fue posible cargar el CRM: "+(c.error||o.error||t.error)?.message);}
  else{setContacts(c.data||[]);setOpps(o.data||[]);setTasks(t.data||[]);}
  setLoading(false);
 },[negocio?.id]);
 useEffect(()=>{
  let cancelled=false;
  async function check(){
   if(cargando)return;
   setChecking(true);setAllowed(false);
   if(!user||!negocio||!perfil||!["admin","manager"].includes(perfil.role)){setChecking(false);return;}
   const r=await supabase.from("crm_acceso_negocios").select("habilitado").eq("business_id",negocio.id).eq("habilitado",true).maybeSingle();
   if(cancelled)return;
   if(r.error){setError("No se pudo validar el acceso al CRM.");setChecking(false);return;}
   setAllowed(r.data?.habilitado===true);setChecking(false);
  }
  void check();return()=>{cancelled=true;};
 },[cargando,user?.id,negocio?.id,perfil?.role]);
 useEffect(()=>{if(allowed)void load();else{setContacts([]);setOpps([]);setTasks([]);}},[allowed,load]);
 async function addOpportunity(e:React.FormEvent){
  e.preventDefault();if(!negocio||!user||saving||!allowed)return;
  const v=Number(amount);
  if(!title.trim()||title.trim().length>240||!contacts.some(c=>c.id===contact)||!Number.isFinite(v)||v<0){setError("Revisa el título, contacto y valor.");return;}
  setSaving(true);setError("");setNotice("");
  const r=await supabase.from("crm_negocio_oportunidades").insert({business_id:negocio.id,contacto_id:contact,titulo:title.trim(),valor_estimado:v,created_by:user.id});
  if(r.error)setError("No se pudo crear la oportunidad: "+r.error.message);
  else{setTitle("");setContact("");setAmount("0");setNotice("Oportunidad creada.");await load();}
  setSaving(false);
 }
 async function changeStage(id:string,etapa:CRMStage){
  if(!allowed||saving||!stages.includes(etapa))return;setSaving(true);setError("");
  const r=await supabase.from("crm_negocio_oportunidades").update({etapa,updated_at:new Date().toISOString()}).eq("id",id).eq("business_id",negocio!.id);
  if(r.error)setError("No se pudo actualizar la etapa: "+r.error.message);else await load();
  setSaving(false);
 }
 async function addTask(e:React.FormEvent){
  e.preventDefault();if(!allowed||saving||!user||!opps.some(o=>o.id===taskOpp))return;
  const d=new Date(taskDue);if(!taskTitle.trim()||taskTitle.trim().length>240||!taskDue||Number.isNaN(d.getTime())){setError("Indica tarea y fecha válidas.");return;}
  setSaving(true);setError("");setNotice("");
  const r=await supabase.from("crm_negocio_tareas").insert({oportunidad_id:taskOpp,titulo:taskTitle.trim(),vence_at:d.toISOString(),created_by:user.id});
  if(r.error)setError("No se pudo crear la tarea: "+r.error.message);else{setTaskTitle("");setTaskDue("");setTaskOpp("");setNotice("Tarea programada.");await load();}
  setSaving(false);
 }
 async function toggleTask(t:Task){
  if(!allowed||saving)return;setSaving(true);setError("");
  const r=await supabase.from("crm_negocio_tareas").update({completada_at:t.completada_at?null:new Date().toISOString()}).eq("id",t.id);
  if(r.error)setError("No se pudo actualizar la tarea: "+r.error.message);else await load();
  setSaving(false);
 }
 if(cargando||checking)return <main className="mx-auto max-w-6xl p-8">Validando acceso al CRM…</main>;
 if(!allowed)return <main className="mx-auto max-w-3xl p-8"><h1 className="text-2xl font-bold">CRM no disponible</h1><p className="mt-3 text-slate-600">Tu cuenta no tiene acceso al CRM de este negocio. Consulta al administrador.</p>{error&&<p role="alert" className="mt-3 text-red-700">{error}</p>}</main>;
 const contactName=(id:string)=>{const c=contacts.find(x=>x.id===id);return c?[c.nombre,c.apellido,c.empresa].filter(Boolean).join(" · "):"Contacto no disponible";};
 const opportunityName=(id:string)=>opps.find(o=>o.id===id)?.titulo||"Oportunidad no disponible";
 return <CRMWorkspace basePath="/crm" section={section} subtitle={negocio?.name+" · Datos exclusivos de tu negocio"}>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
  {section==="resumen"&&<div className="grid gap-3 sm:grid-cols-3">{[["Contactos",contacts.length],["Oportunidades",opps.length],["Tareas pendientes",tasks.filter(t=>!t.completada_at).length]].map(([label,value])=><div key={label} className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></div>)}</div>}
  {loading&&<p className="text-sm text-slate-500">Actualizando datos…</p>}
  {section==="oportunidades"&&<>  <div className="grid gap-6 lg:grid-cols-2">
   <section className="rounded-2xl border bg-white p-5"><h2 className="text-xl font-bold">Nueva oportunidad</h2><form onSubmit={addOpportunity} className="mt-4 space-y-3"><label className="block text-sm font-medium">Título<input className={input+" mt-1"} maxLength={240} value={title} onChange={e=>setTitle(e.target.value)} required/></label><label className="block text-sm font-medium">Contacto<select className={input+" mt-1"} value={contact} onChange={e=>setContact(e.target.value)} required><option value="">Selecciona un contacto</option>{contacts.map(c=><option key={c.id} value={c.id}>{contactName(c.id)}</option>)}</select></label><label className="block text-sm font-medium">Valor estimado (MXN)<input className={input+" mt-1"} type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required/></label><button disabled={saving||!contacts.length} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Crear oportunidad</button>{!contacts.length&&<p className="text-sm text-amber-700">Necesitas un contacto registrado para crear oportunidades.</p>}</form></section>
  </div><section className="mt-6 rounded-2xl border bg-white p-5"><h2 className="mb-4 text-xl font-bold">Tablero comercial</h2><CRMOpportunityBoard rows={opps} contactName={contactName} busy={saving} onMove={changeStage} onOpen={openOpportunity}/></section></>}
  {editing&&<div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 pt-10"><div role="dialog" aria-modal="true" aria-label="Editar oportunidad" className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Oportunidad comercial</h2><div className="flex gap-2">{editDirty&&<button form="crm-edit-opportunity" type="submit" disabled={saving} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving?"Guardando…":"Guardar"}</button>}<button type="button" disabled={saving} onClick={closeOpportunity} className="rounded-xl border px-4 py-2 text-sm font-semibold">{editDirty?"Cancelar":"Cerrar"}</button></div></div>{editError&&<p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{editError}</p>}<form id="crm-edit-opportunity" onSubmit={saveOpportunity} className="mt-5 space-y-4"><label className="block text-sm font-semibold">Título<input className={input+" mt-1"} maxLength={240} required value={editTitle} onChange={e=>setEditTitle(e.target.value)}/></label><label className="block text-sm font-semibold">Contacto<select className={input+" mt-1"} required value={editContact} onChange={e=>setEditContact(e.target.value)}>{contacts.map(contact=><option key={contact.id} value={contact.id}>{contactName(contact.id)}</option>)}</select></label><label className="block text-sm font-semibold">Valor estimado (MXN)<input className={input+" mt-1"} type="number" min="0" step="0.01" required value={editAmount} onChange={e=>setEditAmount(e.target.value)}/></label><label className="block text-sm font-semibold">Etapa<select className={input+" mt-1"} value={editStage} onChange={e=>setEditStage(e.target.value as CRMStage)}>{stages.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}</select></label></form><p className="mt-4 text-xs text-slate-500">Los cambios solo afectan oportunidades de tu negocio.</p></div></div>}
  {section==="contactos"&&<BusinessContacts businessId={negocio!.id} contacts={contacts} opportunities={opps} tasks={tasks} onSaved={load}/>}
  {section==="trabajo"&&<div className="grid gap-6 lg:grid-cols-2">   <section className="rounded-2xl border bg-white p-5"><h2 className="text-xl font-bold">Programar seguimiento</h2><form onSubmit={addTask} className="mt-4 space-y-3"><label className="block text-sm font-medium">Oportunidad<select className={input+" mt-1"} value={taskOpp} onChange={e=>setTaskOpp(e.target.value)} required><option value="">Selecciona una oportunidad</option>{opps.map(o=><option key={o.id} value={o.id}>{o.titulo}</option>)}</select></label><label className="block text-sm font-medium">Tarea<input className={input+" mt-1"} maxLength={240} value={taskTitle} onChange={e=>setTaskTitle(e.target.value)} required/></label><label className="block text-sm font-medium">Fecha y hora<input className={input+" mt-1"} type="datetime-local" value={taskDue} onChange={e=>setTaskDue(e.target.value)} required/></label><button disabled={saving||!opps.length} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50">Programar tarea</button></form></section>
<section className="rounded-2xl border bg-white p-5"><h2 className="text-xl font-bold">Seguimientos</h2><div className="mt-3 divide-y">{tasks.filter(t=>opps.some(o=>o.id===t.oportunidad_id)).map(t=><label key={t.id} className="flex items-start gap-3 py-3 text-sm"><input type="checkbox" className="mt-1" checked={!!t.completada_at} disabled={saving} onChange={()=>void toggleTask(t)}/><span><span className={t.completada_at?"line-through text-slate-400":"font-medium"}>{t.titulo}</span><span className="block text-xs text-slate-500">{opportunityName(t.oportunidad_id)} · {new Date(t.vence_at).toLocaleString("es-MX")}</span></span></label>)}{!tasks.length&&<p className="py-3 text-sm text-slate-500">Sin tareas</p>}</div></section></div>}
 </CRMWorkspace>;
}
export default function NegocioCRM(){return <Suspense fallback={<main className="p-8">Cargando CRM…</main>}><NegocioCRMContent/></Suspense>;}
