"use client";
import {Suspense,useCallback,useEffect,useState} from "react";
import {useAuth} from "@/context/AuthContext";
import {supabase} from "@/lib/supabase";
import BusinessContacts,{type Contact} from "@/components/crm/BusinessContacts";
import CRMWorkspace,{type CRMSection} from "@/components/crm/CRMWorkspace";
import FollowUpForm from "@/components/crm/FollowUpForm";
import FollowUpAgenda from "@/components/crm/FollowUpAgenda";
import CrmModal from "@/components/crm/CrmModal";
import {useBusinessTrial} from "@/app/components/BusinessTrial";
import BusinessOpportunityActivities from "@/components/crm/BusinessOpportunityActivities";
import OpportunityCommercialOverview from "@/components/crm/OpportunityCommercialOverview";
import CRMOpportunityBoard,{type CRMStage} from "@/components/crm/CRMOpportunityBoard";
import {useSearchParams} from "next/navigation";
import Link from "next/link";

type Opportunity={id:string;contacto_id:string;titulo:string;etapa:string;valor_estimado:number;created_at:string};
type Task={id:string;oportunidad_id:string;titulo:string;vence_at:string;completada_at:string|null};
const stages=["nuevo","contactado","propuesta","negociacion","ganado","perdido"];
const money=(v:number)=>new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(v);
const input="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
function ContactPicker({businessId,value,onChange,disabled=false}:{businessId:string;value:string;onChange:(id:string)=>void;disabled?:boolean}){
 const [query,setQuery]=useState(""),[rows,setRows]=useState<Contact[]>([]),[selected,setSelected]=useState<Contact|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[page,setPage]=useState(1),[total,setTotal]=useState(0);
 useEffect(()=>{let cancelled=false;setSelected(null);if(value)void (async()=>{try{const r=await supabase.from("crm_contactos").select("id,nombre,apellido,empresa,direccion,notas,updated_at,crm_contacto_medios(tipo,valor)").eq("id",value).eq("business_id",businessId).eq("ambito","negocio").is("archivado_at",null).maybeSingle();if(!cancelled&&!r.error)setSelected(r.data);}catch{}})();return()=>{cancelled=true;};},[value,businessId]);
 useEffect(()=>{let cancelled=false;setBusy(true);setRows([]);setError("");const timer=setTimeout(async()=>{try{const r=await supabase.rpc("crm_buscar_contactos_negocio",{p_business_id:businessId,p_query:query.trim(),p_page:page});if(cancelled)return;if(r.error)throw r.error;setRows(r.data?.rows||[]);setTotal(Number(r.data?.total||0));}catch{if(!cancelled)setError("No se pudieron consultar los contactos. Cambia la búsqueda para reintentar.");}finally{if(!cancelled)setBusy(false);}},250);return()=>{cancelled=true;clearTimeout(timer);};},[businessId,query,page]);
 const label=(c:Contact)=>[c.nombre,c.apellido,c.empresa].filter(Boolean).join(" · ")||"Sin nombre";
 return <div className="space-y-2"><label className="block text-sm font-semibold">Buscar contacto<input className={input+" mt-1"} value={query} disabled={disabled} onChange={e=>{setQuery(e.target.value);setPage(1);}} placeholder="Nombre, empresa, correo o teléfono"/></label><label className="block text-sm font-semibold">Contacto<select className={input+" mt-1"} required value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}><option value="">Selecciona un contacto</option>{value&&!rows.some(c=>c.id===value)&&<option value={value}>{selected?label(selected):"Contacto seleccionado"}</option>}{rows.map(c=><option key={c.id} value={c.id}>{label(c)}</option>)}</select></label>{busy?<p className="text-xs text-slate-500">Buscando…</p>:error?<p role="alert" className="text-xs text-red-700">{error}</p>:<div className="flex items-center justify-between gap-2 text-xs text-slate-500"><button type="button" disabled={disabled||page===1} onClick={()=>setPage(p=>p-1)} className="disabled:opacity-40">Anterior</button><span>{total} coincidencias · {page}/{Math.max(1,Math.ceil(total/25))}</span><button type="button" disabled={disabled||page>=Math.ceil(total/25)} onClick={()=>setPage(p=>p+1)} className="disabled:opacity-40">Siguiente</button></div>}</div>;
}
function NegocioCRMContent(){
 const {negocio,user,perfil,cargando}=useAuth();
 const params=useSearchParams();
 const requested=params.get("seccion");
 const section:CRMSection=requested==="contactos"||requested==="oportunidades"?requested:"resumen";
 const [dialog,setDialog]=useState<"followup"|"opportunity"|null>(null);
 const {endsAt,days}=useBusinessTrial();
 const readOnly=Boolean(endsAt && days===0);
 const filter=params.get("filtro");
 function openDialog(next:"followup"|"opportunity"){
  setError("");setNotice("");setDialog(next);
  setTitle("");setContact("");setAmount("0");
  setTaskTitle("");setTaskDue("");setTaskOpp("");
 }
 const [allowed,setAllowed]=useState(false),[checking,setChecking]=useState(true),[loading,setLoading]=useState(false);
 const [boardPages,setBoardPages]=useState<Record<string,number>>({}),[boardCounts,setBoardCounts]=useState<Record<string,number>>({}),[boardRows,setBoardRows]=useState<Opportunity[]>([]);
 const [agendaRevision,setAgendaRevision]=useState(0);
 const [metrics,setMetrics]=useState<{counts:Record<string,number>;amounts:Record<string,number>;agenda:{counts:Record<string,number>;rows:(Task&{oportunidad_titulo:string})[]}}|null>(null);
 const [contactCount,setContactCount]=useState(0);
 const [contacts,setContacts]=useState<Contact[]>([]);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[saving,setSaving]=useState(false);
 const [title,setTitle]=useState(""),[contact,setContact]=useState(""),[amount,setAmount]=useState("0");
 const [taskTitle,setTaskTitle]=useState(""),[taskDue,setTaskDue]=useState(""),[taskOpp,setTaskOpp]=useState("");
 const [editing,setEditing]=useState<Opportunity|null>(null),[editTitle,setEditTitle]=useState(""),[editContact,setEditContact]=useState(""),[editAmount,setEditAmount]=useState("0"),[editStage,setEditStage]=useState<CRMStage>("nuevo"),[editOriginal,setEditOriginal]=useState(""),[editError,setEditError]=useState("");
 const verifyAccess=useCallback(async()=>{
  if(!negocio?.id||!user?.id)return false;
  const r=await supabase.from("crm_acceso_negocios").select("habilitado").eq("business_id",negocio.id).eq("habilitado",true).maybeSingle();
  if(r.error)throw new Error("No se pudo verificar el acceso. Revisa tu conexión e inténtalo nuevamente.");
  if(!r.data?.habilitado){setAllowed(false);setError("Tu acceso al CRM ya no está habilitado. Consulta al administrador.");return false;}
  return true;
 },[negocio?.id,user?.id]);
 const editSnapshot=(t:string,c:string,a:string,s:CRMStage)=>JSON.stringify([t.trim(),c,Number(a),s]);
 const editDirty=!!editing&&editSnapshot(editTitle,editContact,editAmount,editStage)!==editOriginal;
 function openOpportunity(id:string){const row=boardRows.find(o=>o.id===id);if(!row)return;setEditing(row);setEditTitle(row.titulo);setEditContact(row.contacto_id);setEditAmount(String(row.valor_estimado));setEditStage(row.etapa as CRMStage);setEditOriginal(editSnapshot(row.titulo,row.contacto_id,String(row.valor_estimado),row.etapa as CRMStage));setEditError("");}
 function closeOpportunity(){if(saving)return;if(editDirty&&!window.confirm("¿Descartar cambios sin guardar?"))return;setEditing(null);setEditError("");}
 async function saveOpportunity(e:React.FormEvent){e.preventDefault();if(!editing||!editDirty||saving||!allowed||!negocio)return;const value=Number(editAmount);if(!editTitle.trim()||editTitle.trim().length>240||!editContact||!Number.isFinite(value)||value<0){setEditError("Revisa título, contacto y valor estimado.");return;}setSaving(true);setEditError("");try{if(!await verifyAccess())return;const r=await supabase.from("crm_negocio_oportunidades").update({titulo:editTitle.trim(),contacto_id:editContact,valor_estimado:value,etapa:editStage,updated_at:new Date().toISOString()}).eq("id",editing.id).eq("business_id",negocio.id).select("id");if(r.error)setEditError("No se pudo guardar: "+r.error.message);else if(!r.data?.length)setEditError("No se actualizó el registro. Revisa tus permisos.");else{setEditing(null);setNotice("Oportunidad actualizada.");await load();}}catch{setEditError("No se pudo completar la operación. Revisa tu conexión y verifica si se guardó antes de reintentar.");}finally{setSaving(false);}}

 const load=useCallback(async()=>{
  if(!negocio?.id)return;
  setLoading(true);setError("");
  try{
  const [count]=await Promise.all([
   supabase.from("crm_contactos").select("id",{count:"exact",head:true}).eq("ambito","negocio").eq("business_id",negocio.id).is("archivado_at",null)
  ]);
  if(count.error){setError("No fue posible cargar el CRM: "+count.error.message);return;}
  const board=section==="oportunidades"?await Promise.all(stages.map(stage=>{const start=((boardPages[stage]||1)-1)*25;return supabase.from("crm_negocio_oportunidades").select("id,contacto_id,titulo,etapa,valor_estimado,created_at",{count:"exact"}).eq("business_id",negocio.id).eq("etapa",stage).order("created_at",{ascending:false}).order("id",{ascending:false}).range(start,start+24);})):null;
  if(board?.some(r=>r.error)){setError("No fue posible cargar el tablero comercial.");return;}
  const nextRows=board?.flatMap(r=>r.data||[])||[];
  if(board){const counts=Object.fromEntries(stages.map((s,i)=>[s,board[i].count||0]));setBoardCounts(counts);const corrected=Object.fromEntries(stages.map(s=>[s,Math.min(boardPages[s]||1,Math.max(1,Math.ceil(counts[s]/25)))]));if(stages.some(s=>corrected[s]!== (boardPages[s]||1)))setBoardPages(corrected);}
  const ids=[...new Set(nextRows.map(row=>row.contacto_id))];
  const batches=await Promise.all(Array.from({length:Math.ceil(ids.length/100)},(_,i)=>supabase.from("crm_contactos").select("id,nombre,apellido,empresa,direccion,notas,updated_at,crm_contacto_medios(tipo,valor)").eq("business_id",negocio.id).eq("ambito","negocio").is("archivado_at",null).in("id",ids.slice(i*100,(i+1)*100))));
  const failed=batches.find(r=>r.error);
  if(failed){setError("No fue posible cargar los contactos vinculados.");return;}
  setAgendaRevision(v=>v+1);setBoardRows(nextRows);setContactCount(count.count||0);setContacts(batches.flatMap(r=>r.data||[]));
  }catch{setError("No fue posible cargar el CRM. Revisa tu conexión.");}finally{setLoading(false);}
 },[negocio?.id,section,boardPages]);
 useEffect(()=>{
  let cancelled=false;
  async function check(){
   if(cargando)return;
   setChecking(true);setAllowed(false);
   if(!user||!negocio||!perfil){setChecking(false);return;}
   try{
   const r=await supabase.from("crm_acceso_negocios").select("habilitado").eq("business_id",negocio.id).eq("habilitado",true).maybeSingle();
   if(cancelled)return;
   if(r.error){setError("No se pudo validar el acceso al CRM.");setChecking(false);return;}
   setAllowed(r.data?.habilitado===true);setChecking(false);
   }catch{if(!cancelled){setError("No se pudo validar el acceso. Revisa tu conexión y recarga la página.");setChecking(false);}}
  }
  void check();return()=>{cancelled=true;};
 },[cargando,user?.id,negocio?.id,perfil?.role]);
 useEffect(()=>{if(allowed)void load();else{setBoardRows([]);setBoardCounts({});setContactCount(0);setContacts([]);}},[allowed,load]);
 async function addOpportunity(e:React.FormEvent){
  e.preventDefault();if(!negocio||!user||saving||!allowed)return;
  const v=Number(amount);
  if(!title.trim()||title.trim().length>240||!contact||!Number.isFinite(v)||v<0){setError("Revisa el título, contacto y valor.");return;}
  setSaving(true);setError("");setNotice("");
  try{if(!await verifyAccess())return;const r=await supabase.from("crm_negocio_oportunidades").insert({business_id:negocio.id,contacto_id:contact,titulo:title.trim(),valor_estimado:v,created_by:user.id}).select("id");
  if(r.error)setError("No se pudo crear la oportunidad: "+r.error.message);
  else if(!r.data?.length)setError("No se confirmó la creación. Revisa tus permisos.");
  else{setTitle("");setContact("");setAmount("0");setDialog(null);setNotice("Oportunidad creada.");await load();}
  }catch{setError("No se pudo completar la operación. Revisa tu conexión y verifica si se guardó antes de reintentar.");}finally{setSaving(false);}
 }
 async function changeStage(id:string,etapa:CRMStage){
  if(!allowed||saving||!stages.includes(etapa))return;setSaving(true);setError("");
  try{if(!await verifyAccess())return;const r=await supabase.from("crm_negocio_oportunidades").update({etapa,updated_at:new Date().toISOString()}).eq("id",id).eq("business_id",negocio!.id).select("id");
  if(r.error)setError("No se pudo actualizar la etapa: "+r.error.message);else if(!r.data?.length)setError("No se actualizó la etapa. Verifica tus permisos o si la oportunidad existe.");else await load();
  }catch{setError("No se pudo completar la operación. Revisa tu conexión y verifica si se guardó antes de reintentar.");}finally{setSaving(false);}
 }
 async function addTask(e:React.FormEvent){
  e.preventDefault();if(!allowed||saving||!user||!taskOpp)return;
  const d=new Date(taskDue);if(!taskTitle.trim()||taskTitle.trim().length>240||!taskDue||Number.isNaN(d.getTime())){setError("Indica tarea y fecha válidas.");return;}
  setSaving(true);setError("");setNotice("");
  try{if(!await verifyAccess())return;const r=await supabase.from("crm_negocio_tareas").insert({oportunidad_id:taskOpp,titulo:taskTitle.trim(),vence_at:d.toISOString(),created_by:user.id}).select("id");
  if(r.error)setError("No se pudo crear la tarea: "+r.error.message);
  else if(!r.data?.length)setError("No se confirmó la creación de la tarea. Revisa tus permisos.");else{setTaskTitle("");setTaskDue("");setTaskOpp("");setDialog(null);setNotice("Seguimiento programado.");await load();}
  }catch{setError("No se pudo completar la operación. Revisa tu conexión y verifica si se guardó antes de reintentar.");}finally{setSaving(false);}
 }
 async function createOpportunityTask(opportunityId:string,taskName:string,dueLocal:string):Promise<string|null>{
  if(!allowed||saving||!user||!negocio||!opportunityId)return "No tienes permiso para crear este seguimiento.";
  const due=new Date(dueLocal);
  if(!taskName.trim()||taskName.trim().length>240||!dueLocal||Number.isNaN(due.getTime()))return "Indica una tarea y una fecha válidas.";
  setSaving(true);
  try{
   if(!await verifyAccess())return "Tu acceso al CRM ya no está habilitado.";
   const result=await supabase.from("crm_negocio_tareas").insert({oportunidad_id:opportunityId,titulo:taskName.trim(),vence_at:due.toISOString(),created_by:user.id}).select("id");
   if(result.error)return "No se pudo crear el seguimiento: "+result.error.message;
   if(!result.data?.length)return "No se confirmó la creación del seguimiento. Revisa tus permisos.";
   await load();
   return null;
  }catch{return "No se pudo guardar el seguimiento. Inténtalo de nuevo.";}
  finally{setSaving(false);}
 }
 async function toggleTask(t:Task){
  if(!allowed||saving)return;setSaving(true);setError("");
  try{if(!await verifyAccess())return;const r=await supabase.from("crm_negocio_tareas").update({completada_at:t.completada_at?null:new Date().toISOString()}).eq("id",t.id).select("id");
  if(r.error)setError("No se pudo actualizar la tarea: "+r.error.message);else if(!r.data?.length)setError("No se actualizó la tarea. Verifica tus permisos o si todavía existe.");else await load();
  }catch{setError("No se pudo completar la operación. Revisa tu conexión y verifica si se guardó antes de reintentar.");}finally{setSaving(false);}
 }
 useEffect(()=>{if(!allowed||!negocio?.id){setMetrics(null);return;}let cancelled=false;async function refreshAlerts(){try{const r=await supabase.rpc("crm_indicadores_negocio",{p_business_id:negocio!.id});if(!cancelled){if(r.error){setMetrics(null);return;}setMetrics(r.data);}}catch{}}void refreshAlerts();const timer=setInterval(refreshAlerts,60000);return()=>{cancelled=true;clearInterval(timer);};},[allowed,negocio?.id,agendaRevision]);
 if(cargando||checking)return <main className="mx-auto max-w-6xl p-8">Validando acceso al CRM…</main>;
 if(!allowed)return <main className="mx-auto max-w-3xl p-8"><h1 className="text-2xl font-bold">CRM no disponible</h1><p className="mt-3 text-slate-600">Tu cuenta no tiene acceso al CRM de este negocio. Consulta al administrador.</p>{error&&<p role="alert" className="mt-3 text-red-700">{error}</p>}</main>;
 const contactName=(id:string)=>{const c=contacts.find(x=>x.id===id);return c?[c.nombre,c.apellido,c.empresa].filter(Boolean).join(" · "):"Contacto no disponible";};
 const totalOpps=Object.values(metrics?.counts||{}).reduce((a,b)=>a+Number(b),0);
 const totalAmount=Object.values(metrics?.amounts||{}).reduce((a,b)=>a+Number(b),0);
 return <CRMWorkspace basePath="/crm" section={section} subtitle={negocio?.name+" · Datos exclusivos de tu negocio"}>
  {error&&!dialog&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
  {section==="resumen"&&<div className="space-y-6">
   <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Resumen comercial</h2><p className="mt-1 text-sm text-slate-500">Indicadores y próximos seguimientos de tu negocio</p></div><Link href="/crm?seccion=contactos" className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Gestionar contactos</Link></div>
   <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
    {label:"Contactos activos",value:contactCount,detail:"Directorio comercial",href:"contactos"},
    {label:"Oportunidades",value:metrics?totalOpps:"—",detail:metrics?money(totalAmount)+" estimados":"Sin datos actualizados",href:"oportunidades"},
    {label:"Tareas pendientes",value:metrics?.agenda.counts.pendientes??"—",detail:"Seguimientos por realizar",href:"resumen&filtro=pendientes#agenda"},
    {label:"Tareas vencidas",value:metrics?.agenda.counts.vencidas??"—",detail:"Requieren atención",href:"resumen&filtro=vencidas#agenda"}
   ].map(item=><Link key={item.label} href={"/crm?seccion="+item.href} className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-emerald-400 hover:bg-emerald-50/30"><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-bold text-slate-900">{item.value}</p><p className="mt-2 text-xs text-slate-500">{item.detail}</p></Link>)}</div>
   <div className="grid gap-6 lg:grid-cols-2">
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold">Estado de oportunidades</h3><Link href="/crm?seccion=oportunidades" className="text-sm font-semibold text-emerald-700 hover:underline">Ver pipeline</Link></div><div className="mt-4 space-y-4">{stages.map(stage=>{const count=Number(metrics?.counts[stage]||0);return <div key={stage}><div className="mb-1 flex justify-between text-sm"><span className="capitalize text-slate-600">{stage}</span><span className="font-semibold">{count}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{width:(totalOpps?count/totalOpps*100:0)+"%"}}/></div></div>;})}</div></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3 flex-wrap"><h3 className="text-lg font-bold">Próximos seguimientos</h3><button type="button" disabled={readOnly} onClick={()=>openDialog("followup")} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Programar seguimiento</button></div><div className="mt-4 divide-y divide-slate-100">{(metrics?.agenda.rows||[]).slice(0,5).map(t=><div key={t.id} className="py-3"><p className="font-semibold text-slate-900">{t.titulo}</p><p className="mt-1 text-sm text-slate-500">{t.oportunidad_titulo}</p><p className={"mt-1 text-xs "+(new Date(t.vence_at).getTime()<Date.now()?"font-semibold text-amber-700":"text-slate-500")}>{new Date(t.vence_at).toLocaleString("es-MX",{dateStyle:"medium",timeStyle:"short"})}{new Date(t.vence_at).getTime()<Date.now()?" · Vencida":""}</p></div>)}{metrics&&!metrics.agenda.counts.pendientes&&<p className="py-4 text-sm text-slate-500">No hay tareas pendientes.</p>}</div></section>
   </div>
   {(filter||requested==="trabajo")&&<div id="agenda" className="scroll-mt-24"><FollowUpAgenda businessId={negocio!.id} revision={agendaRevision} initialFilter={filter} saving={saving||readOnly} onToggle={t=>void toggleTask(t)}/></div>}
   <CrmModal open={dialog==="followup"} title="Programar seguimiento" description="Crea una tarea vinculada a una oportunidad." onClose={()=>setDialog(null)} busy={saving} alert={error}>
    <FollowUpForm businessId={negocio!.id} saving={saving||readOnly} taskTitle={taskTitle} setTaskTitle={setTaskTitle} taskDue={taskDue} setTaskDue={setTaskDue} taskOpp={taskOpp} setTaskOpp={setTaskOpp} onCreate={addTask}/>
   </CrmModal>
  </div>}
  {loading&&<p className="text-sm text-slate-500">Actualizando datos…</p>}
  {section==="oportunidades"&&<div className="space-y-6">
   <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Oportunidades comerciales</h2><p className="mt-1 text-sm text-slate-500">Administra tu pipeline y da seguimiento a cada negociación.</p></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600">{Object.values(boardCounts).reduce((a,b)=>a+b,0)} oportunidades</span><button type="button" disabled={readOnly} onClick={()=>openDialog("opportunity")} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Crear oportunidad</button></div></div>
   <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
    {label:"Oportunidades abiertas",count:stages.filter(s=>s!=="ganado"&&s!=="perdido").reduce((n,s)=>n+(boardCounts[s]||0),0),detail:"En seguimiento"},
    {label:"Valor en negociación",count:metrics?money(stages.filter(s=>s!=="ganado"&&s!=="perdido").reduce((n,s)=>n+Number(metrics.amounts[s]||0),0)):"—",detail:"Monto estimado total"},
    {label:"Ganadas",count:boardCounts.ganado||0,detail:metrics?"Monto estimado: "+money(Number(metrics.amounts.ganado||0)):"Sin datos actualizados"},
    {label:"Perdidas",count:boardCounts.perdido||0,detail:"Oportunidades cerradas"}
   ].map(item=><div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 break-words text-2xl font-bold text-slate-900">{item.count}</p><p className="mt-2 text-xs text-slate-500">{item.detail}</p></div>)}</div>

    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><h3 className="text-lg font-bold">Tablero comercial</h3><p className="mt-1 text-sm text-slate-500">Desliza horizontalmente para ver todas las etapas. Puedes arrastrar tarjetas o cambiar su etapa desde el selector.</p></div><CRMOpportunityBoard rows={boardRows} amounts={metrics?.amounts} counts={boardCounts} pages={boardPages} onPage={(stage,page)=>setBoardPages(old=>({...old,[stage]:page}))} contactName={contactName} busy={saving||loading} onMove={changeStage} onOpen={openOpportunity}/></section>
    <CrmModal open={dialog==="opportunity"} title="Crear oportunidad" description="Vincula una negociación a un contacto existente." onClose={()=>setDialog(null)} busy={saving} alert={error}>
     <form onSubmit={addOpportunity} className="mt-5 space-y-4"><label className="block text-sm font-semibold">Título<input className={input+" mt-1"} maxLength={240} value={title} onChange={e=>setTitle(e.target.value)} required/></label><ContactPicker businessId={negocio!.id} value={contact} onChange={setContact} disabled={saving}/><label className="block text-sm font-semibold">Valor estimado (MXN)<input className={input+" mt-1"} type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required/></label><button disabled={saving||!contact} className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Crear oportunidad</button>{!contactCount&&<p className="text-sm text-amber-700">Necesitas un contacto registrado para crear oportunidades.</p>}</form>
    </CrmModal>
  </div>}
  {editing&&<div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 pt-10"><div role="dialog" aria-modal="true" aria-label="Editar oportunidad" className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Oportunidad comercial</h2><div className="flex gap-2">{editDirty&&<button form="crm-edit-opportunity" type="submit" disabled={saving} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving?"Guardando…":"Guardar"}</button>}<button type="button" disabled={saving} onClick={closeOpportunity} className="rounded-xl border px-4 py-2 text-sm font-semibold">{editDirty?"Cancelar":"Cerrar"}</button></div></div>{editError&&<p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{editError}</p>}<form id="crm-edit-opportunity" onSubmit={saveOpportunity} className="mt-5 space-y-4"><label className="block text-sm font-semibold">Título<input className={input+" mt-1"} maxLength={240} required value={editTitle} onChange={e=>setEditTitle(e.target.value)}/></label><ContactPicker key={editing.id} businessId={negocio!.id} value={editContact} onChange={setEditContact} disabled={saving}/><label className="block text-sm font-semibold">Valor estimado (MXN)<input className={input+" mt-1"} type="number" min="0" step="0.01" required value={editAmount} onChange={e=>setEditAmount(e.target.value)}/></label><label className="block text-sm font-semibold">Etapa<select className={input+" mt-1"} value={editStage} onChange={e=>setEditStage(e.target.value as CRMStage)}>{stages.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}</select></label></form><OpportunityCommercialOverview key={editing.id} opportunityId={editing.id} revision={agendaRevision} contact={contacts.find(c=>c.id===editing.contacto_id)||null} busy={saving} onToggle={t=>void toggleTask(t)} onCreate={(title,due)=>createOpportunityTask(editing.id,title,due)}/><p className="mt-4 text-xs text-slate-500">Los cambios solo afectan oportunidades de tu negocio.</p><BusinessOpportunityActivities businessId={negocio!.id} opportunityId={editing.id} userId={user!.id}/></div></div>}
  {section==="contactos"&&<BusinessContacts totalContacts={contactCount} businessId={negocio!.id} onSaved={load}/>}
 </CRMWorkspace>;
}
export default function NegocioCRM(){return <Suspense fallback={<main className="p-8">Cargando CRM…</main>}><NegocioCRMContent/></Suspense>;}
