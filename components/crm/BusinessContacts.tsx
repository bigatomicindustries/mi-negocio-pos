"use client";
import {useEffect,useState} from "react";
import ContactChannelFields, {type ChannelRow} from "./ContactChannelFields";
import CrmModal from "./CrmModal";
import {ContactActivityForm,readContactActivities,type ContactActivityRow} from "./ContactActivity";
import DownloadContacts from "./DownloadContacts";
import {useBusinessTrial} from "@/app/components/BusinessTrial";
import {supabase} from "@/lib/supabase";
type Medio={tipo:"correo"|"telefono";valor:string;etiqueta?:string|null};
type Opportunity={id:string;contacto_id:string;titulo:string;etapa:string;valor_estimado:number;nota_fija:string;updated_at:string;created_at:string};
type Task={id:string;oportunidad_id:string;titulo:string;vence_at:string;completada_at:string|null};
type Tab="resumen"|"datos"|"actividad";
const money=(n:number)=>new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(n);
export type Contact={fuente?:string|null;id:string;nombre:string|null;apellido:string|null;empresa:string|null;direccion:string|null;notas:string|null;updated_at:string;crm_contacto_medios:Medio[]};
const sources=["Referido","IA","Google","Redes sociales","Página web","WhatsApp","Evento","Visita al negocio","Otro"] as const;
type FormData={fuente:string;nombre:string;apellido:string;empresa:string;direccion:string;notas:string;medios:ChannelRow[]};
const blank:FormData={fuente:"",nombre:"",apellido:"",empresa:"",direccion:"",notas:"",medios:[{key:"correo",tipo:"correo",valor:"",etiqueta:""},{key:"telefono",tipo:"telefono",valor:"",etiqueta:""}]};
const field="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const getForm=(c:Contact|null):FormData=>c?{fuente:c.fuente||"",nombre:c.nombre||"",apellido:c.apellido||"",empresa:c.empresa||"",direccion:c.direccion||"",notas:c.notas||"",medios:blank.medios.flatMap(empty=>{
 const rows=c.crm_contacto_medios.filter(m=>m.tipo===empty.tipo);
 return rows.length?rows.map((m,i)=>({key:m.tipo+i,tipo:m.tipo,valor:m.valor,etiqueta:m.etiqueta||""})):[empty];
})}:{...blank};
export default function BusinessContacts({businessId,totalContacts,onSaved,userId,behindDialog,relationRevision,onCreateOpportunity,onOpenOpportunity}:{
 userId:string;behindDialog:boolean;relationRevision:number;onCreateOpportunity:(c:Contact)=>void;onOpenOpportunity:(o:Opportunity,c:Contact)=>void;businessId:string;totalContacts:number;onSaved:()=>Promise<void>}){
 const {endsAt,days}=useBusinessTrial();
 const readOnly=Boolean(endsAt && days===0);
 const [query,setQuery]=useState(""),[selected,setSelected]=useState<Contact|null>(null),[open,setOpen]=useState(false),[form,setForm]=useState<FormData>({...blank}),[original,setOriginal]=useState<FormData>({...blank}),[saving,setSaving]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [tab,setTab]=useState<Tab>("resumen"),[editMode,setEditMode]=useState(false);
 const [page,setPage]=useState(1);
 const pageSize=25;
 const dirty=JSON.stringify(form)!==JSON.stringify(original);
 const [recording,setRecording]=useState(false),[activityRevision,setActivityRevision]=useState(0);
 const [logs,setLogs]=useState<ContactActivityRow[]>([]);
 const [detail,setDetail]=useState<{title:string;date:string;text:string;opportunityId?:string|null}|null>(null);
 const [linked,setLinked]=useState<Opportunity[]>([]),[linkedTasks,setLinkedTasks]=useState<Task[]>([]),[relationsLoading,setRelationsLoading]=useState(false),[relationsError,setRelationsError]=useState("");
 useEffect(()=>{let cancelled=false;setLinked([]);setLinkedTasks([]);setLogs([]);setRelationsError("");if(!open||!selected||behindDialog||tab==="datos"){setRelationsLoading(false);return;}setRelationsLoading(true);void (async()=>{try{
 const all:Opportunity[]=[];for(let offset=0;;offset+=250){const r=await supabase.from("crm_negocio_oportunidades").select("id,contacto_id,titulo,etapa,valor_estimado,nota_fija,updated_at,created_at").eq("business_id",businessId).eq("contacto_id",selected.id).order("created_at",{ascending:false}).order("id").range(offset,offset+249);if(cancelled)return;if(r.error)throw r.error;all.push(...(r.data||[]));if((r.data||[]).length<250)break;}
 const tasks:Task[]=[];for(let i=0;i<all.length;i+=100){for(let offset=0;;offset+=250){const r=await supabase.from("crm_negocio_tareas").select("id,oportunidad_id,titulo,vence_at,completada_at").in("oportunidad_id",all.slice(i,i+100).map(o=>o.id)).order("vence_at").order("id").range(offset,offset+249);if(cancelled)return;if(r.error)throw r.error;tasks.push(...(r.data||[]));if((r.data||[]).length<250)break;}}
 const history=await readContactActivities(businessId,selected.id);
 if(!cancelled){setLogs(history);setLinked(all);setLinkedTasks(tasks);}
 }catch{if(!cancelled)setRelationsError("No se pudieron cargar las relaciones comerciales. Cierra y vuelve a abrir el contacto.");}finally{if(!cancelled)setRelationsLoading(false);}})();return()=>{cancelled=true;};},[businessId,selected?.id,open,behindDialog,activityRevision,relationRevision,tab]);
 const total=linked.filter(o=>o.etapa!=="perdido").reduce((sum,o)=>sum+Number(o.valor_estimado||0),0);
 function viewTask(task:Task){setDetail({title:task.titulo,date:task.vence_at,text:task.completada_at?"Seguimiento completado":"Seguimiento pendiente",opportunityId:task.oportunidad_id});}
 function viewLog(log:ContactActivityRow){setDetail({title:activityLabel(log.tipo),date:log.created_at,text:log.descripcion,opportunityId:log.oportunidad_id});}
 function activityLabel(tipo:string){return ({llamada:"Llamada",nota:"Nota",mensaje:"Mensaje",reunion:"Reunión",cambio_etapa:"Cambio de etapa"} as Record<string,string>)[tipo]||tipo;}
 const activity=[...logs.map(log=>({id:"a"+log.id,date:log.created_at,label:activityLabel(log.tipo),detail:log.descripcion,show:()=>viewLog(log)})),...linked.map(o=>({id:"o"+o.id,show:()=>onOpenOpportunity(o,selected!),date:o.created_at,label:"Oportunidad creada: "+o.titulo,detail:"Etapa actual: "+o.etapa})),...linkedTasks.map(t=>({id:"t"+t.id,show:()=>viewTask(t),date:t.completada_at||t.vence_at,label:t.completada_at?"Tarea completada: "+t.titulo:"Seguimiento programado: "+t.titulo,detail:t.completada_at?"Completada":"Fecha programada"}))].sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime());
 const [visible,setVisible]=useState<Contact[]>([]),[count,setCount]=useState(0),[listLoading,setListLoading]=useState(true),[listError,setListError]=useState(""),[revision,setRevision]=useState(0);
 const totalPages=Math.max(1,Math.ceil(count/pageSize));
 const currentPage=Math.min(page,totalPages);
 useEffect(()=>{
  let cancelled=false;
  setListLoading(true);setListError("");setVisible([]);
  const timer=setTimeout(async()=>{
   try{
    const r=await supabase.rpc("crm_buscar_contactos_negocio",{p_business_id:businessId,p_query:query.trim(),p_page:page});
    if(cancelled)return;
    if(r.error)throw r.error;
    const n=Number(r.data?.total||0);
    setCount(n);
    if(page>Math.max(1,Math.ceil(n/pageSize))){setPage(Math.max(1,Math.ceil(n/pageSize)));return;}
    setVisible(r.data?.rows||[]);
   }catch{if(!cancelled){setListError("No se pudo cargar el directorio. Intenta nuevamente.");setCount(0);}}
   finally{if(!cancelled)setListLoading(false);}
  },250);
  return()=>{cancelled=true;clearTimeout(timer);};
 },[businessId,query,page,revision]);
 function edit(c:Contact|null){const next=getForm(c);setSelected(c);setForm(next);setOriginal(next);setOpen(true);setDetail(null);setRecording(false);setTab("datos");setEditMode(!c);setError("");setNotice("");}
 function cancel(){if(saving)return;if(dirty&&!window.confirm("¿Descartar cambios sin guardar?"))return;setOpen(false);setEditMode(false);setError("");}
 useEffect(()=>{setOpen(false);setSelected(null);setTab("resumen");setEditMode(false);setQuery("");setPage(1);},[businessId]);
 async function save(e:React.FormEvent){e.preventDefault();if(saving||!dirty&&!selected)return;
  if(!form.nombre.trim()&&!form.empresa.trim()){setError("Indica un nombre o empresa.");return;}
  if(form.nombre.length>120||form.apellido.length>120||form.empresa.length>180||form.direccion.length>2000||form.notas.length>4000){setError("Uno de los campos supera la longitud permitida.");return;}
  const medios=form.medios.filter(m=>m.valor.trim()).map(({tipo,valor,etiqueta})=>({tipo,valor:valor.trim(),etiqueta:etiqueta.trim()}));
  if(form.medios.some(m=>m.etiqueta.trim()&&!m.valor.trim())){setError("Completa el correo o teléfono de la etiqueta.");return;}
  for(const medio of medios){
   if(medio.tipo==="correo"&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(medio.valor)){setError("Revisa el correo "+medio.valor);return;}
   if(medio.tipo==="telefono"&&!/^\+?[\d ().-]+$/.test(medio.valor)){setError("Ingresa un número de teléfono por campo.");return;}
   const digits=medio.valor.replace(/\D/g,"");
   if(medio.tipo==="telefono"&&(digits.length<7||digits.length>15)){setError("Cada teléfono debe tener entre 7 y 15 dígitos.");return;}
  }
  setSaving(true);setError("");setNotice("");
  try{const {error:err}=await supabase.rpc("crm_guardar_contacto_con_medios",{p_fuente:form.fuente||null,p_contacto_id:selected?.id||null,p_nombre:form.nombre,p_apellido:form.apellido,p_empresa:form.empresa,p_direccion:form.direccion,p_notas:form.notas,p_medios:medios,p_expected_updated_at:selected?.updated_at||null});
  if(err){setError(err.code==="23505"?"El correo o teléfono está repetido en este negocio. No se guardaron cambios.":err.message);setSaving(false);return;}
  setOpen(false);setEditMode(false);setNotice(selected?"Contacto actualizado.":"Contacto creado.");setRevision(v=>v+1);await onSaved();}catch{setError("No se pudo confirmar el guardado. Revisa tu conexión y verifica si se guardó antes de reintentar.");}finally{setSaving(false);}
 }
 return <section className="space-y-5">
  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
   <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
    <h2 className="text-lg font-bold">Directorio activo</h2>
    <input type="search" aria-label="Buscar contactos" className="min-w-48 flex-1 rounded-xl border px-3 py-2 text-sm" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} placeholder="Nombre, empresa, teléfono o correo"/>
    <span className="text-sm text-slate-500">{totalContacts} contacto{totalContacts===1?"":"s"}</span>
    <DownloadContacts businessId={businessId} disabled={totalContacts===0}/>
    <button disabled={readOnly} type="button" onClick={()=>edit(null)} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">+ Nuevo contacto</button>
   </header>
   {notice&&<p role="status" className="px-5 py-2 text-sm text-emerald-800">{notice}</p>}
   <div className="divide-y divide-slate-100">{visible.map(c=>{const fullName=[c.nombre,c.apellido].filter(Boolean).join(" ")||c.empresa||"Sin nombre";const initial=fullName.trim().charAt(0).toUpperCase();const phone=c.crm_contacto_medios?.find(m=>m.tipo==="telefono")?.valor;const email=c.crm_contacto_medios?.find(m=>m.tipo==="correo")?.valor;return <button type="button" key={c.id} aria-label={"Ver / editar "+fullName} onClick={()=>edit(c)} className="w-full text-left flex flex-col gap-4 px-5 py-5 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:px-6"><span className="flex min-w-0 items-center gap-4"><span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-lg font-bold text-emerald-800">{initial}</span><span className="min-w-0"><span className="block truncate font-semibold text-slate-900">{fullName}</span><span className="block truncate text-sm text-slate-500">{c.empresa||"Sin empresa"}</span><span className="block break-all text-xs text-slate-600">{phone||"Sin teléfono"} · {email||"Sin correo"}</span></span></span><span className="shrink-0 self-start rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-emerald-50 sm:self-center">Ver / editar</span></button>;})}{listLoading&&<p className="px-6 py-8 text-sm text-slate-500">Cargando contactos…</p>}{listError&&<div role="alert" className="px-6 py-8 text-sm text-red-700">{listError} <button type="button" onClick={()=>setRevision(v=>v+1)} className="underline">Reintentar</button></div>}{!listLoading&&!listError&&!visible.length&&<p className="px-6 py-8 text-sm text-slate-500">No se encontraron contactos.</p>}</div>
   <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 sm:px-6"><button type="button" disabled={listLoading||currentPage===1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Anterior</button><span className="text-sm text-slate-500">Página {currentPage} de {totalPages}</span><button type="button" disabled={listLoading||currentPage===totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Siguiente</button></div>
  </div>
  {open&&!behindDialog&&!detail&&!recording&&<div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 pt-10" role="presentation"><div role="dialog" aria-modal="true" aria-label={selected?"Perfil comercial del contacto":"Nuevo contacto"} className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
   <div className="flex items-center justify-between gap-3"><h3 className="text-xl font-bold">{selected?([selected.nombre,selected.apellido].filter(Boolean).join(" ")||selected.empresa||"Perfil comercial"):"Nuevo contacto"}</h3><div className="flex gap-2">{selected&&tab==="datos"&&!editMode&&!readOnly&&<button type="button" onClick={()=>setEditMode(true)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Editar datos</button>}{(!selected||editMode)&&dirty&&!readOnly&&<button form="crm-contact-form" type="submit" disabled={saving} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving?"Guardando…":"Guardar"}</button>}<button type="button" onClick={cancel} disabled={saving} className="rounded-xl border px-4 py-2 text-sm font-semibold">{dirty?"Cancelar":"Cerrar"}</button></div></div>
   {error&&<p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
   {selected&&<div className="mt-5 flex gap-2 border-b border-slate-200" role="tablist" aria-label="Secciones del contacto">{(["datos","resumen","actividad"] as Tab[]).map(t=><button key={t} type="button" role="tab" aria-selected={tab===t} onClick={()=>{if(dirty&&!window.confirm("¿Descartar cambios sin guardar?"))return;setForm(getForm(selected));setOriginal(getForm(selected));setEditMode(false);setError("");setTab(t);}} className={"rounded-t-lg px-3 py-2 text-sm font-semibold capitalize "+(tab===t?"border-b-2 border-emerald-700 text-emerald-800":"text-slate-500")}>{t}</button>)}</div>}
   {selected&&tab!=="datos"&&relationsLoading&&<p className="mt-5 text-sm text-slate-500">Cargando relaciones comerciales…</p>}{selected&&tab!=="datos"&&relationsError&&<p role="alert" className="mt-5 text-sm text-red-700">{relationsError}</p>}{selected&&!relationsLoading&&!relationsError&&tab==="resumen"&&<div className="mt-5 space-y-4">
    <div className="grid grid-cols-3 gap-2">{[["Oportunidades",linked.length],["Valor estimado",money(total)],["Tareas pendientes",linkedTasks.filter(t=>!t.completada_at).length]].map(([label,value])=><div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words text-lg font-bold">{value}</p></div>)}</div>
    <h4 className="font-semibold">Oportunidades vinculadas</h4>
    <div className="max-h-56 divide-y overflow-y-auto">{linked.map(o=><button type="button" onClick={()=>onOpenOpportunity(o,selected)} key={o.id} className="flex w-full text-left hover:bg-slate-50 items-start justify-between gap-3 py-3 text-sm"><span><strong className="block">{o.titulo}</strong><span className="text-slate-500 capitalize">{o.etapa}</span></span><span className="shrink-0 font-semibold">{money(Number(o.valor_estimado))}</span></button>)}{!linked.length&&<p className="py-3 text-sm text-slate-500">Este contacto todavía no tiene oportunidades.</p>}</div>
    <h4 className="font-semibold">Próximos seguimientos</h4>
    <div className="max-h-44 divide-y overflow-y-auto">{linkedTasks.filter(t=>!t.completada_at).sort((a,b)=>a.vence_at.localeCompare(b.vence_at)).map(t=><button type="button" onClick={()=>viewTask(t)} key={t.id} className="block w-full py-2 text-left text-sm hover:bg-slate-50">{t.titulo}<span className="block text-xs text-slate-500">{new Date(t.vence_at).toLocaleString("es-MX")}</span></button>)}{!linkedTasks.some(t=>!t.completada_at)&&<p className="py-3 text-sm text-slate-500">Sin tareas pendientes.</p>}</div>
    {logs.length>0&&<section><h4 className="font-semibold">Actividades recientes</h4>{logs.slice(0,5).map(log=><button key={log.id} type="button" onClick={()=>viewLog(log)} className="block w-full truncate py-2 text-left text-sm hover:bg-slate-50"><strong>{activityLabel(log.tipo)}</strong> · {log.descripcion}</button>)}</section>}
   </div>}
   {selected&&tab==="actividad"&&<div className="mt-5">
    <div className="flex flex-wrap gap-2"><button type="button" disabled={readOnly} onClick={()=>onCreateOpportunity(selected)} className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50">Registrar oportunidad</button>
    <button type="button" disabled={readOnly} onClick={()=>setRecording(true)} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Registrar actividad</button></div>
    {!relationsLoading&&!relationsError&&<div className="mt-3 max-h-96 divide-y overflow-y-auto">{activity.map(a=><button type="button" onClick={a.show} key={a.id} className="block w-full py-3 text-left hover:bg-slate-50"><strong className="block text-sm">{a.label}</strong><span className="block truncate text-xs text-slate-500">{a.detail} · {new Date(a.date).toLocaleString("es-MX")}</span></button>)}{!activity.length&&<p className="py-4 text-sm text-slate-500">Aún no hay actividad comercial vinculada.</p>}</div>}
   </div>}
   {(!selected||tab==="datos")&&<div className="mt-5">

    <form id="crm-contact-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
    {([["nombre","Nombre",120],["apellido","Apellido",120],["empresa","Empresa",180],["direccion","Dirección",2000]] as const).map(([key,label,max])=><label key={key} className="block text-sm font-medium">{label}<input disabled={!!selected&&!editMode} className={field+" disabled:bg-slate-50"} maxLength={max} value={form[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))}/></label>)}
    {(["correo","telefono"] as const).map(kind=><ContactChannelFields key={kind} kind={kind} rows={form.medios} disabled={saving||readOnly||!!selected&&!editMode} onChange={medios=>setForm(v=>({...v,medios}))}/>)}
    <label className="block text-sm font-medium">Fuente<select className={field+" disabled:bg-slate-50"} value={form.fuente} disabled={saving||readOnly||!!selected&&!editMode} onChange={e=>setForm(v=>({...v,fuente:e.target.value}))}>
      <option value="">Sin especificar</option>
      {sources.map(source=><option key={source} value={source}>{source}</option>)}
    </select></label>
    <label className="block text-sm font-medium sm:col-span-2">Notas<textarea disabled={!!selected&&!editMode} className={field+" disabled:bg-slate-50"} rows={3} maxLength={4000} value={form.notas} onChange={e=>setForm(v=>({...v,notas:e.target.value}))}/></label>
    </form>
   </div>}
   <p className="mt-4 text-xs text-slate-500">El correo y teléfono no pueden repetirse entre contactos del mismo negocio. Los datos de otros negocios permanecen aislados.</p>
  </div></div>}
  {open&&selected&&recording&&<ContactActivityForm businessId={businessId} contactId={selected.id} userId={userId} onClose={()=>setRecording(false)} onSaved={()=>{setRecording(false);setActivityRevision(v=>v+1);}}/>}
  {open&&selected&&detail&&<CrmModal open title={detail.title} onClose={()=>setDetail(null)}>
    <p className="whitespace-pre-wrap break-words">{detail.text}</p><p className="text-sm text-slate-600">{new Date(detail.date).toLocaleString("es-MX")}</p>
    {linked.filter(o=>o.id===detail.opportunityId).map(o=><button type="button" key={o.id} className="font-semibold text-emerald-700 underline" onClick={()=>{setDetail(null);onOpenOpportunity(o,selected);}}>{o.titulo}</button>)}
  </CrmModal>}
 </section>;
}
