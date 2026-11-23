"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Opportunity = { id:string; titulo:string; etapa:string; valor_estimado:number; fecha_cierre_estimada:string|null };
type Activity = { id:string; tipo:string; detalle:string|null; created_at:string };
const currency=(n:number)=>new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(n);
const stageNames:Record<string,string>={nuevo:"Nuevo",contactado:"Contactado",propuesta:"Propuesta",negociacion:"Negociación",ganado:"Ganado",perdido:"Perdido"};
export default function ContactCommercialSummary({contactId,warnUnsaved=false,mode="summary"}:{contactId:string;warnUnsaved?:boolean;mode?:"summary"|"activity"}){
 const [opportunities,setOpportunities]=useState<Opportunity[]>([]);
 const [activities,setActivities]=useState<Activity[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 useEffect(()=>{
  let cancelled=false;
  async function load(){
   setLoading(true);setError("");
   try{
    const [op,links]=await Promise.all([
     supabase.from("crm_oportunidades").select("id,titulo,etapa,valor_estimado,fecha_cierre_estimada").eq("contacto_id",contactId).order("created_at",{ascending:false}).limit(50),
     supabase.from("crm_prospecto_contactos").select("demo_request_id,lead_id").eq("contacto_id",contactId).limit(100)
    ]);
    if(op.error)throw op.error;
    if(links.error)throw links.error;
    const demos=(links.data||[]).map(x=>x.demo_request_id).filter((x):x is string=>!!x);
    const leads=(links.data||[]).map(x=>x.lead_id).filter((x):x is string=>!!x);
    const [a,b]=await Promise.all([
     demos.length?supabase.from("crm_actividades").select("id,tipo,detalle,created_at").in("demo_request_id",demos).order("created_at",{ascending:false}).limit(20):Promise.resolve({data:[] as Activity[],error:null}),
     leads.length?supabase.from("crm_actividades").select("id,tipo,detalle,created_at").in("lead_id",leads).order("created_at",{ascending:false}).limit(20):Promise.resolve({data:[] as Activity[],error:null})
    ]);
    if(a.error||b.error)throw a.error||b.error;
    if(cancelled)return;
    setOpportunities((op.data||[]) as Opportunity[]);
    setActivities([...(a.data||[]),...(b.data||[])].sort((x,y)=>y.created_at.localeCompare(x.created_at)).slice(0,10) as Activity[]);
   }catch(e){if(!cancelled)setError(e instanceof Error?e.message:"No se pudo cargar el resumen comercial.");}
   finally{if(!cancelled)setLoading(false);}
  }
  void load();return()=>{cancelled=true;};
 },[contactId]);
 const confirmLeave=(e:React.MouseEvent<HTMLAnchorElement>)=>{if(warnUnsaved&&!window.confirm("¿Salir sin guardar los cambios de este contacto?"))e.preventDefault();};
 return <section aria-label="Resumen comercial" className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
  {mode==="summary" && <div className="flex flex-wrap items-center justify-between gap-2">
   <h3 className="text-base font-bold">Resumen comercial</h3>
   <Link href={"/superadmin/oportunidades?contacto="+encodeURIComponent(contactId)} onClick={confirmLeave} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">+ Oportunidad</Link>
  </div>}
  {loading?<p className="text-sm text-slate-500">Cargando actividad comercial…</p>:error?<p role="alert" className="text-sm text-rose-700">{error}</p>:<>
   {mode==="summary" && <div className="grid grid-cols-2 gap-3">
    <div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">Oportunidades (hasta 50)</p><p className="text-xl font-bold">{opportunities.length}</p></div>
    <div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">Valor abierto mostrado</p><p className="text-lg font-bold">{currency(opportunities.filter(x=>x.etapa!=="ganado"&&x.etapa!=="perdido").reduce((s,x)=>s+Number(x.valor_estimado),0))}</p></div>
   </div>}
   {mode==="summary" && <div><h4 className="mb-2 text-sm font-bold">Oportunidades relacionadas</h4>
    {opportunities.length?<ul className="space-y-2">{opportunities.map(o=><li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3 text-sm"><div><p className="font-semibold">{o.titulo}</p><p className="text-xs text-slate-500">{stageNames[o.etapa]||o.etapa}{o.fecha_cierre_estimada?" · Cierre previsto "+o.fecha_cierre_estimada:""}</p></div><span className="font-semibold text-emerald-700">{currency(Number(o.valor_estimado))}</span></li>)}</ul>:<p className="text-sm text-slate-500">Todavía no hay oportunidades para este contacto.</p>}
    {opportunities.length===50&&<p className="mt-2 text-xs text-amber-700">Se muestran las 50 oportunidades más recientes.</p>}
   </div>}
   <div><h4 className="mb-2 text-sm font-bold">Actividad reciente de prospectos vinculados</h4>
    {activities.length?<ul className="space-y-2">{activities.map(a=><li key={a.id} className="rounded-lg bg-white p-3 text-sm"><p className="font-semibold">{a.tipo} <span className="font-normal text-slate-500">· {new Date(a.created_at).toLocaleDateString("es-MX")}</span></p>{a.detalle&&<p className="mt-1 whitespace-pre-wrap text-slate-600">{a.detalle}</p>}</li>)}</ul>:<p className="text-sm text-slate-500">Sin actividades registradas en prospectos vinculados.</p>}
   </div>
  </>}
 </section>;
}
