"use client";
import {Suspense,useCallback,useEffect,useState} from "react";
import {useAuth} from "@/context/AuthContext";
import {supabase} from "@/lib/supabase";
import ProductCatalog, {OpportunityEstimate,type CatalogLine} from "@/components/crm/ProductCatalog";
import BusinessContacts,{type Contact} from "@/components/crm/BusinessContacts";
import CRMWorkspace,{type CRMSection} from "@/components/crm/CRMWorkspace";
import FollowUpForm from "@/components/crm/FollowUpForm";
import FollowUpAgenda from "@/components/crm/FollowUpAgenda";
import CrmModal from "@/components/crm/CrmModal";
import {useBusinessTrial} from "@/app/components/BusinessTrial";
import BusinessOpportunityActivities from "@/components/crm/BusinessOpportunityActivities";
import OpportunityCommercialOverview, {OpportunityContactCard} from "@/components/crm/OpportunityCommercialOverview";
import CRMOpportunityBoard,{type CRMStage} from "@/components/crm/CRMOpportunityBoard";
import {useSearchParams} from "next/navigation";
import Link from "next/link";

type Opportunity={id:string;contacto_id:string;titulo:string;etapa:string;valor_estimado:number;partidas:CatalogLine[];nota_fija:string;updated_at:string;created_at:string};
type Task={id:string;oportunidad_id:string;titulo:string;vence_at:string;completada_at:string|null};
const stages=["nuevo","contactado","propuesta","negociacion","ganado","perdido"];
const money=(v:number)=>new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(v);
const input="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
function ContactPicker({businessId,value,onChange,disabled=false}:{businessId:string;value:string;onChange:(id:string)=>void;disabled?:boolean}){
 const [query,setQuery]=useState(""),[open,setOpen]=useState(false),[page,setPage]=useState(1);
 const [rows,setRows]=useState<Contact[]>([]),[total,setTotal]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{
  if(!open)return;
  let current=true;
  const timer=setTimeout(async()=>{
   try{
    const result=await supabase.rpc("crm_buscar_contactos_negocio",{p_business_id:businessId,p_query:query.trim(),p_page:page});
    if(!current)return;
    if(result.error)throw result.error;
    setRows(result.data.rows);setTotal(Number(result.data.total));
   }catch{if(current)setError("No se pudieron buscar contactos. Intenta nuevamente.");}
   finally{if(current)setBusy(false);}
  },200);
  return ()=>{current=false;clearTimeout(timer);};
 },[open,businessId,query,page]);
 function search(text:string,nextPage=1){
  setBusy(true);setRows([]);setError("");setQuery(text);setPage(nextPage);setOpen(true);
 }
 function choose(c:Contact){
  onChange(c.id);setQuery([c.nombre,c.apellido].filter(Boolean).join(" ")||c.empresa||"Sin nombre");setOpen(false);
 }
 return <div className="space-y-1" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
  <label className="block text-sm font-semibold">Buscar contacto
   <input className={input+" mt-1"} disabled={disabled} autoComplete="off" value={query}
    placeholder="Nombre, empresa, correo o teléfono"
    onFocus={e=>{if(value)e.target.select();else if(!open)search(query);}}
    onChange={e=>{onChange("");search(e.target.value);}}
    onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(open&&rows.length===1)choose(rows[0]);}if(e.key==="Escape"&&open){e.stopPropagation();setOpen(false);}}}/>
  </label>
  {open&&<div className="rounded-xl border bg-white p-2">
   {busy?<p role="status" className="p-2 text-sm">Buscando…</p>:error?<p role="alert">{error}</p>:<>
    <ul aria-label="Resultados de contactos" className="max-h-48 overflow-y-auto">{rows.map(c=><li key={c.id}><button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-emerald-50 focus:bg-emerald-50" onClick={()=>choose(c)}>
     <strong className="block text-sm">{[c.nombre,c.apellido].filter(Boolean).join(" ")||c.empresa||"Sin nombre"}</strong>
     <span className="text-xs text-slate-600">{[c.empresa,...(c.crm_contacto_medios||[]).map(m=>m.valor)].filter(Boolean).join(" · ")}</span>
    </button></li>)}</ul>
    {!rows.length&&<p className="p-2 text-sm">Sin coincidencias.</p>}
    {total>25&&<div className="flex justify-between text-sm"><button type="button" disabled={page===1} onClick={()=>search(query,page-1)}>Anterior</button><span>{page} / {Math.ceil(total/25)}</span><button type="button" disabled={page*25>=total} onClick={()=>search(query,page+1)}>Siguiente</button></div>}
   </>}
  </div>}
 </div>;
}
function NegocioCRMContent(){
 const {negocio,user,perfil,cargando}=useAuth();
 const params=useSearchParams();
 const requested=params.get("seccion");
 const section:CRMSection=requested==="catalogo"||requested==="contactos"||requested==="oportunidades"?requested:"resumen";
 const [profileContact,setProfileContact]=useState<Contact|null>(null);
 const [dialog,setDialog]=useState<"followup"|"opportunity"|null>(null);
 const {endsAt,days}=useBusinessTrial();
 const readOnly=Boolean(endsAt && days===0);
 const filter=params.get("filtro");
 function openDialog(next:"followup"|"opportunity"){
  setProfileContact(null);setCreateLines([]);setError("");setNotice("");setDialog(next);
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
 const [editing,setEditing]=useState<Opportunity|null>(null),[editTitle,setEditTitle]=useState(""),[renaming,setRenaming]=useState(false),[editAmount,setEditAmount]=useState("0"),[editStage,setEditStage]=useState<CRMStage>("nuevo"),[editOriginal,setEditOriginal]=useState(""),[editError,setEditError]=useState("");
 const verifyAccess=useCallback(async()=>{
  if(!negocio?.id||!user?.id)return false;
  const r=await supabase.from("crm_acceso_negocios").select("habilitado").eq("business_id",negocio.id).eq("habilitado",true).maybeSingle();
  if(r.error)throw new Error("No se pudo verificar el acceso. Revisa tu conexión e inténtalo nuevamente.");
  if(!r.data?.habilitado){setAllowed(false);setError("Tu acceso al CRM ya no está habilitado. Consulta al administrador.");return false;}
  return true;
 },[negocio?.id,user?.id]);
 const [createLines,setCreateLines]=useState<CatalogLine[]>([]),[editLines,setEditLines]=useState<CatalogLine[]>([]);
 const changedLines=!!editing&&JSON.stringify(editLines)!==JSON.stringify(editing.partidas??[]);
 const [editNote,setEditNote]=useState("");
 const editSnapshot=(t:string,a:string,s:CRMStage)=>JSON.stringify([t.trim(),Number(a),s]);
 const editDirty=!!editing&&(changedLines||editSnapshot(editTitle,editAmount,editStage)!==editOriginal||editNote!==(editing.nota_fija??""));
 function openOpportunity(id:string){const row=boardRows.find(o=>o.id===id);if(row){setProfileContact(null);showOpportunity(row);}}
 function showOpportunity(row:Opportunity){setEditing(row);setEditLines(row.partidas??[]);setEditNote(row.nota_fija??"");setEditTitle(row.titulo);setRenaming(false);setEditAmount(String(row.valor_estimado));setEditStage(row.etapa as CRMStage);setEditOriginal(editSnapshot(row.titulo,String(row.valor_estimado),row.etapa as CRMStage));setEditError("");}
 function closeOpportunity(){if(saving)return;if(editDirty&&!window.confirm("¿Descartar cambios sin guardar?"))return;setEditing(null);setEditError("");}
 async function saveOpportunity(e:React.FormEvent){e.preventDefault();if(!editing||!editDirty||saving||!allowed||!negocio)return;const value=Number(editAmount);if(!editTitle.trim()||editTitle.trim().length>240||!Number.isFinite(value)||value<0){setEditError("Revisa el nombre y el valor estimado.");return;}setSaving(true);setEditError("");try{if(!await verifyAccess())return;const changedNote=editNote!==(editing.nota_fija??"");
  let request=supabase.from("crm_negocio_oportunidades").update({
    ...(editTitle.trim()!==editing.titulo?{titulo:editTitle.trim()}:{}),
    ...(value!==Number(editing.valor_estimado)?{valor_estimado:value}:{}),
    ...(editStage!==editing.etapa?{etapa:editStage}:{}),
    ...(changedLines?{partidas:editLines}:{}),...(changedNote?{nota_fija:editNote}:{}),updated_at:new Date().toISOString()
  }).eq("id",editing.id).eq("business_id",negocio.id);
  if(changedNote||changedLines||value!==Number(editing.valor_estimado))request=request.eq("updated_at",editing.updated_at);
  const r=await request.select("id");if(r.error)setEditError("No se pudo guardar: "+r.error.message);else if(!r.data?.length)setEditError("No se guardaron los cambios. Vuelve a abrir la oportunidad para consultar la versión actual.");else{setEditing(null);setNotice("Oportunidad actualizada.");await load();}}catch{setEditError("No se pudo completar la operación. Revisa tu conexión y verifica si se guardó antes de reintentar.");}finally{setSaving(false);}}

 const load=useCallback(async()=>{
  if(!negocio?.id)return;
  setLoading(true);setError("");
  try{
  const [count]=await Promise.all([
   supabase.from("crm_contactos").select("id",{count:"exact",head:true}).eq("ambito","negocio").eq("business_id",negocio.id).is("archivado_at",null)
  ]);
  if(count.error){setError("No fue posible cargar el CRM: "+count.error.message);return;}
  const board=section==="oportunidades"?await Promise.all(stages.map(stage=>{const start=((boardPages[stage]||1)-1)*25;return supabase.from("crm_negocio_oportunidades").select("id,contacto_id,titulo,etapa,valor_estimado,partidas,nota_fija,updated_at,created_at",{count:"exact"}).eq("business_id",negocio.id).eq("etapa",stage).order("created_at",{ascending:false}).order("id",{ascending:false}).range(start,start+24);})):null;
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
  try{if(!await verifyAccess())return;const r=await supabase.from("crm_negocio_oportunidades").insert({business_id:negocio.id,contacto_id:contact,titulo:title.trim(),valor_estimado:v,partidas:createLines,created_by:user.id}).select("id");
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
 const boardTotal=Object.values(boardCounts).reduce((a,b)=>a+b,0);
 const totalOpps=Object.values(metrics?.counts||{}).reduce((a,b)=>a+Number(b),0);
 const totalAmount=Object.values(metrics?.amounts||{}).reduce((a,b)=>a+Number(b),0);
 return <CRMWorkspace basePath="/crm" section={section} subtitle={negocio?.name+" · Datos exclusivos de tu negocio"}>
  {error&&!dialog&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
  {section==="resumen"&&<div className="space-y-6">
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
   <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
    {label:"Oportunidades abiertas",count:stages.filter(s=>s!=="ganado"&&s!=="perdido").reduce((n,s)=>n+(boardCounts[s]||0),0),detail:"En seguimiento"},
    {label:"Valor en negociación",count:metrics?money(stages.filter(s=>s!=="ganado"&&s!=="perdido").reduce((n,s)=>n+Number(metrics.amounts[s]||0),0)):"—",detail:"Monto estimado total"},
    {label:"Ganadas",count:boardCounts.ganado||0,detail:metrics?"Monto estimado: "+money(Number(metrics.amounts.ganado||0)):"Sin datos actualizados"},
    {label:"Perdidas",count:boardCounts.perdido||0,detail:"Oportunidades cerradas"}
   ].map(item=><div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 break-words text-2xl font-bold text-slate-900">{item.count}</p><p className="mt-2 text-xs text-slate-500">{item.detail}</p></div>)}</div>

    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4">
     <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold">Tablero comercial</h2>
      <div className="flex flex-wrap items-center gap-2"><span className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600">{boardTotal} {boardTotal===1?"oportunidad":"oportunidades"}</span><button type="button" disabled={readOnly} onClick={()=>openDialog("opportunity")} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Crear oportunidad</button></div>
     </div>
     <p className="mt-1 text-sm text-slate-500">Desliza horizontalmente para ver todas las etapas. Puedes arrastrar tarjetas o cambiar su etapa desde el selector.</p></div><CRMOpportunityBoard rows={boardRows} amounts={metrics?.amounts} counts={boardCounts} pages={boardPages} onPage={(stage,page)=>setBoardPages(old=>({...old,[stage]:page}))} contactName={contactName} busy={saving||loading} onMove={changeStage} onOpen={openOpportunity}/></section>
  </div>}
    <CrmModal open={dialog==="opportunity"} title="Crear oportunidad" description="Vincula una negociación a un contacto existente." onClose={()=>setDialog(null)} busy={saving} alert={error}>
     <form onSubmit={addOpportunity} className="mt-5 space-y-4"><label className="block text-sm font-semibold">Título<input className={input+" mt-1"} maxLength={240} value={title} onChange={e=>setTitle(e.target.value)} required/></label>{profileContact?<p className="text-sm">Contacto: <strong>{[profileContact.nombre,profileContact.apellido].filter(Boolean).join(" ")||profileContact.empresa}</strong></p>:<ContactPicker businessId={negocio!.id} value={contact} onChange={setContact} disabled={saving}/>}<OpportunityEstimate businessId={negocio!.id} lines={createLines} setLines={setCreateLines} amount={amount} setAmount={setAmount} disabled={saving||readOnly}/><button disabled={saving||!contact} className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Crear oportunidad</button>{!contactCount&&<p className="text-sm text-amber-700">Necesitas un contacto registrado para crear oportunidades.</p>}</form>
    </CrmModal>
  {editing&&<div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 pt-10"><div role="dialog" aria-modal="true" aria-label="Editar oportunidad" className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl"><div className="flex flex-wrap items-start justify-between gap-3">
   <h2 className="min-w-0 basis-full text-xl font-bold leading-snug sm:flex-1">
    {renaming ? <textarea autoFocus rows={1} form="crm-edit-opportunity" aria-label="Nombre de la oportunidad"
      required maxLength={240} value={editTitle} onChange={e=>setEditTitle(e.target.value.replace(/[\r\n]+/g," "))}
      className="block w-full resize-none appearance-none border-0 bg-transparent p-0 font-[inherit] text-inherit leading-[inherit] shadow-none outline-none [field-sizing:content]"
      onKeyDown={e=>{
       if(e.key==="Escape"){e.preventDefault();setEditTitle(editing.titulo);setRenaming(false);}
       if(e.key==="Enter"&&!e.nativeEvent.isComposing){e.preventDefault();if(editDirty)e.currentTarget.form?.requestSubmit();else setRenaming(false);}
      }}/> :
     <button type="button" title="Editar nombre" disabled={saving||readOnly} onClick={()=>setRenaming(true)} className="block max-w-full break-words text-left">{editTitle}</button>}
   </h2>
   <div className="flex flex-wrap items-center gap-2">
    {editDirty&&<button form="crm-edit-opportunity" type="submit" disabled={saving} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving?"Guardando…":"Guardar"}</button>}
    <div className="relative">
     <select aria-label="Etapa de la oportunidad" form="crm-edit-opportunity" disabled={saving||readOnly} className="appearance-none rounded-xl border bg-white pl-3 pr-9 py-2 text-sm font-semibold" value={editStage} onChange={e=>setEditStage(e.target.value as CRMStage)}>
     {stages.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
    </select>
     <span aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -mt-1.5 h-2 w-2 rotate-45 border-b-2 border-r-2" />
    </div>
    <button type="button" disabled={saving} onClick={closeOpportunity} className="rounded-xl border px-4 py-2 text-sm font-semibold">{editDirty?"Cancelar":"Cerrar"}</button>
   </div>
  </div>{editError&&<p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{editError}</p>}<form id="crm-edit-opportunity" onSubmit={saveOpportunity} className="mt-5 space-y-4"><div className="grid gap-4 sm:grid-cols-2">
   <OpportunityContactCard contact={contacts.find(c=>c.id===editing.contacto_id)||(profileContact?.id===editing.contacto_id?profileContact:null)}/>
   <label className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <span className="font-bold">Nota fija</span>
    <textarea value={editNote} onChange={e=>setEditNote(e.target.value)} disabled={saving||readOnly} rows={4} placeholder="Escribe una nota sobre esta oportunidad" className="min-h-24 flex-1 resize-y rounded-xl border bg-white p-3 text-sm"/>
   </label>
  </div><OpportunityEstimate businessId={negocio!.id} lines={editLines} original={editing.partidas} setLines={setEditLines} amount={editAmount} setAmount={setEditAmount} disabled={saving||readOnly}/></form>
  <BusinessOpportunityActivities key={editing.id} businessId={negocio!.id} opportunityId={editing.id} userId={user!.id}>
   <OpportunityCommercialOverview key={editing.id} opportunityId={editing.id} revision={agendaRevision} busy={saving} onToggle={t=>void toggleTask(t)} onCreate={(title,due)=>createOpportunityTask(editing.id,title,due)}/>
  </BusinessOpportunityActivities>
  <p className="mt-4 text-xs text-slate-500">Los cambios solo afectan oportunidades de tu negocio.</p></div></div>}
  {section==="catalogo"&&<ProductCatalog key={negocio!.id} businessId={negocio!.id} readOnly={readOnly}/>}
  {section==="contactos"&&<BusinessContacts userId={user!.id} behindDialog={!!editing||dialog==="opportunity"} relationRevision={agendaRevision}
    onCreateOpportunity={c=>{openDialog("opportunity");setContact(c.id);setProfileContact(c);}}
    onOpenOpportunity={(o,c)=>{setProfileContact(c);showOpportunity(o);}} totalContacts={contactCount} businessId={negocio!.id} onSaved={load}/>}
 </CRMWorkspace>;
}
export default function NegocioCRM(){return <Suspense fallback={<main className="p-8">Cargando CRM…</main>}><NegocioCRMContent/></Suspense>;}
