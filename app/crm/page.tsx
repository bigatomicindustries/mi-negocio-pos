"use client";
import {Suspense,useCallback,useEffect,useState} from "react";
import {useAuth} from "@/context/AuthContext";
import {supabase} from "@/lib/supabase";
import BusinessContacts,{type Contact} from "@/components/crm/BusinessContacts";
import CRMWorkspace,{type CRMSection} from "@/components/crm/CRMWorkspace";
import BusinessTaskCenter from "@/components/crm/BusinessTaskCenter";
import CRMOpportunityBoard,{type CRMStage} from "@/components/crm/CRMOpportunityBoard";
import {useSearchParams} from "next/navigation";
import Link from "next/link";

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
  {section==="resumen"&&<div className="space-y-6">
   <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Resumen comercial</h2><p className="mt-1 text-sm text-slate-500">Indicadores y próximos seguimientos de tu negocio</p></div><Link href="/crm?seccion=contactos" className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Gestionar contactos</Link></div>
   <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
    {label:"Contactos activos",value:contacts.length,detail:"Directorio comercial",href:"contactos"},
    {label:"Oportunidades",value:opps.length,detail:money(opps.reduce((sum,o)=>sum+Number(o.valor_estimado||0),0))+" estimados",href:"oportunidades"},
    {label:"Tareas pendientes",value:tasks.filter(t=>!t.completada_at).length,detail:"Seguimientos por realizar",href:"trabajo"},
    {label:"Tareas vencidas",value:tasks.filter(t=>!t.completada_at&&new Date(t.vence_at).getTime()<Date.now()).length,detail:"Requieren atención",href:"trabajo"}
   ].map(item=><Link key={item.label} href={"/crm?seccion="+item.href} className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-emerald-400 hover:bg-emerald-50/30"><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-bold text-slate-900">{item.value}</p><p className="mt-2 text-xs text-slate-500">{item.detail}</p></Link>)}</div>
   <div className="grid gap-6 lg:grid-cols-2">
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold">Estado de oportunidades</h3><Link href="/crm?seccion=oportunidades" className="text-sm font-semibold text-emerald-700 hover:underline">Ver pipeline</Link></div><div className="mt-4 space-y-4">{stages.map(stage=>{const count=opps.filter(o=>o.etapa===stage).length;return <div key={stage}><div className="mb-1 flex justify-between text-sm"><span className="capitalize text-slate-600">{stage}</span><span className="font-semibold">{count}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{width:(opps.length?count/opps.length*100:0)+"%"}}/></div></div>;})}</div></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold">Próximos seguimientos</h3><Link href="/crm?seccion=trabajo" className="text-sm font-semibold text-emerald-700 hover:underline">Centro de trabajo</Link></div><div className="mt-4 divide-y divide-slate-100">{tasks.filter(t=>!t.completada_at).slice().sort((a,b)=>new Date(a.vence_at).getTime()-new Date(b.vence_at).getTime()).slice(0,5).map(t=><div key={t.id} className="py-3"><p className="font-semibold text-slate-900">{t.titulo}</p><p className="mt-1 text-sm text-slate-500">{opportunityName(t.oportunidad_id)}</p><p className={"mt-1 text-xs "+(new Date(t.vence_at).getTime()<Date.now()?"font-semibold text-amber-700":"text-slate-500")}>{new Date(t.vence_at).toLocaleString("es-MX",{dateStyle:"medium",timeStyle:"short"})}{new Date(t.vence_at).getTime()<Date.now()?" · Vencida":""}</p></div>)}{!tasks.some(t=>!t.completada_at)&&<p className="py-4 text-sm text-slate-500">No hay tareas pendientes.</p>}</div></section>
   </div>
  </div>}
  {loading&&<p className="text-sm text-slate-500">Actualizando datos…</p>}
  {section==="oportunidades"&&<div className="space-y-6">
   <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Oportunidades comerciales</h2><p className="mt-1 text-sm text-slate-500">Administra tu pipeline y da seguimiento a cada negociación.</p></div><span className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600">{opps.length} oportunidad{opps.length===1?"":"es"}</span></div>
   <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
    {label:"Oportunidades abiertas",count:opps.filter(o=>o.etapa!=="ganado"&&o.etapa!=="perdido").length,detail:"En seguimiento"},
    {label:"Valor en negociación",count:money(opps.filter(o=>o.etapa!=="ganado"&&o.etapa!=="perdido").reduce((sum,o)=>sum+Number(o.valor_estimado||0),0)),detail:"Monto estimado"},
    {label:"Ganadas",count:opps.filter(o=>o.etapa==="ganado").length,detail:money(opps.filter(o=>o.etapa==="ganado").reduce((sum,o)=>sum+Number(o.valor_estimado||0),0))},
    {label:"Perdidas",count:opps.filter(o=>o.etapa==="perdido").length,detail:"Oportunidades cerradas"}
   ].map(item=><div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 break-words text-2xl font-bold text-slate-900">{item.count}</p><p className="mt-2 text-xs text-slate-500">{item.detail}</p></div>)}</div>
   <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(300px,350px)]">
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><h3 className="text-lg font-bold">Tablero comercial</h3><p className="mt-1 text-sm text-slate-500">Desliza horizontalmente para ver todas las etapas. Puedes arrastrar tarjetas o cambiar su etapa desde el selector.</p></div><CRMOpportunityBoard rows={opps} contactName={contactName} busy={saving} onMove={changeStage} onOpen={openOpportunity}/></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-lg font-bold">Nueva oportunidad</h3><p className="mt-1 text-sm text-slate-500">Vincula una negociación a un contacto existente.</p><form onSubmit={addOpportunity} className="mt-5 space-y-4"><label className="block text-sm font-semibold">Título<input className={input+" mt-1"} maxLength={240} value={title} onChange={e=>setTitle(e.target.value)} required/></label><label className="block text-sm font-semibold">Contacto<select className={input+" mt-1"} value={contact} onChange={e=>setContact(e.target.value)} required><option value="">Selecciona un contacto</option>{contacts.map(c=><option key={c.id} value={c.id}>{contactName(c.id)}</option>)}</select></label><label className="block text-sm font-semibold">Valor estimado (MXN)<input className={input+" mt-1"} type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required/></label><button disabled={saving||!contacts.length} className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Crear oportunidad</button>{!contacts.length&&<p className="text-sm text-amber-700">Necesitas un contacto registrado para crear oportunidades.</p>}</form></section>
   </div>
  </div>}
  {editing&&<div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 pt-10"><div role="dialog" aria-modal="true" aria-label="Editar oportunidad" className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Oportunidad comercial</h2><div className="flex gap-2">{editDirty&&<button form="crm-edit-opportunity" type="submit" disabled={saving} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving?"Guardando…":"Guardar"}</button>}<button type="button" disabled={saving} onClick={closeOpportunity} className="rounded-xl border px-4 py-2 text-sm font-semibold">{editDirty?"Cancelar":"Cerrar"}</button></div></div>{editError&&<p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{editError}</p>}<form id="crm-edit-opportunity" onSubmit={saveOpportunity} className="mt-5 space-y-4"><label className="block text-sm font-semibold">Título<input className={input+" mt-1"} maxLength={240} required value={editTitle} onChange={e=>setEditTitle(e.target.value)}/></label><label className="block text-sm font-semibold">Contacto<select className={input+" mt-1"} required value={editContact} onChange={e=>setEditContact(e.target.value)}>{contacts.map(contact=><option key={contact.id} value={contact.id}>{contactName(contact.id)}</option>)}</select></label><label className="block text-sm font-semibold">Valor estimado (MXN)<input className={input+" mt-1"} type="number" min="0" step="0.01" required value={editAmount} onChange={e=>setEditAmount(e.target.value)}/></label><label className="block text-sm font-semibold">Etapa<select className={input+" mt-1"} value={editStage} onChange={e=>setEditStage(e.target.value as CRMStage)}>{stages.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}</select></label></form><p className="mt-4 text-xs text-slate-500">Los cambios solo afectan oportunidades de tu negocio.</p></div></div>}
  {section==="contactos"&&<BusinessContacts businessId={negocio!.id} contacts={contacts} opportunities={opps} tasks={tasks} onSaved={load}/>}
  {section==="trabajo"&&<BusinessTaskCenter tasks={tasks} opportunities={opps} saving={saving} taskTitle={taskTitle} setTaskTitle={setTaskTitle} taskDue={taskDue} setTaskDue={setTaskDue} taskOpp={taskOpp} setTaskOpp={setTaskOpp} onCreate={addTask} onToggle={t=>void toggleTask(t)}/> }
 </CRMWorkspace>;
}
export default function NegocioCRM(){return <Suspense fallback={<main className="p-8">Cargando CRM…</main>}><NegocioCRMContent/></Suspense>;}
