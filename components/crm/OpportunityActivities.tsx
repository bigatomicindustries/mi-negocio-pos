"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Activity={id:string;tipo:string;detalle:string;created_at:string};
const types=["llamada","whatsapp","correo","reunion","tarea","nota"] as const;
const labels:Record<string,string>={llamada:"Llamada",whatsapp:"WhatsApp",correo:"Correo",reunion:"Reunión",tarea:"Tarea",nota:"Nota"};
export default function OpportunityActivities({opportunityId}:{opportunityId:string}){
 const [rows,setRows]=useState<Activity[]>([]);
 const [type,setType]=useState<string>("llamada");
 const [detail,setDetail]=useState("");
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const load=useCallback(async()=>{setLoading(true);const {data,error}=await supabase.from("crm_oportunidad_actividades").select("id,tipo,detalle,created_at").eq("oportunidad_id",opportunityId).order("created_at",{ascending:false}).limit(100);if(error)setError("No se pudo consultar el historial: "+error.message);else{setRows((data||[]) as Activity[]);setError("");}setLoading(false);},[opportunityId]);
 useEffect(()=>{void load();},[load]);
 async function save(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(saving)return;const trimmed=detail.trim();if(!trimmed||trimmed.length>3000){setError("Escribe una descripción de 1 a 3000 caracteres.");return;}setSaving(true);setError("");setNotice("");
 const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user){setError("La sesión expiró. Inicia sesión de nuevo.");setSaving(false);return;}
 const {error:saveError}=await supabase.from("crm_oportunidad_actividades").insert({oportunidad_id:opportunityId,tipo:type,detalle:trimmed,creado_por:user.id});
 if(saveError)setError("No se pudo registrar la actividad: "+saveError.message);else{setDetail("");setNotice("Actividad registrada.");await load();}
 setSaving(false);
 }
 return <section className="mt-6 border-t border-slate-200 pt-5" aria-label="Actividades de la oportunidad">
  <h3 className="mb-3 text-base font-bold">Seguimiento de la oportunidad</h3>
  <p className="mb-4 text-xs text-slate-500">Registra las interacciones y consulta el historial de esta negociación. No envía mensajes ni genera recordatorios.</p>
  <form onSubmit={save} className="space-y-3">
   <label className="block text-sm font-medium">Tipo de actividad<select value={type} onChange={e=>setType(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2">{types.map(t=><option key={t} value={t}>{labels[t]}</option>)}</select></label>
   <label className="block text-sm font-medium">Descripción<textarea value={detail} onChange={e=>setDetail(e.target.value)} maxLength={3000} rows={3} placeholder="Ej. Se acordó enviar una propuesta el viernes…" className="mt-1 w-full rounded-lg border border-slate-300 p-2"/></label>
   <button disabled={saving||!detail.trim()} type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving?"Registrando…":"+ Registrar actividad"}</button>
  </form>
  {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="mt-3 text-sm font-medium text-emerald-700">{notice}</p>}
  <h4 className="mt-6 mb-2 text-sm font-bold">Historial reciente</h4>
  {loading?<p className="text-sm text-slate-500">Cargando historial…</p>:rows.length===0?<p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Todavía no hay actividades registradas.</p>:<ul className="max-h-64 space-y-2 overflow-y-auto">{rows.map(a=><li key={a.id} className="rounded-lg border border-slate-200 p-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{labels[a.tipo]||a.tipo}</strong><time className="text-xs text-slate-500">{new Date(a.created_at).toLocaleString("es-MX")}</time></div><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{a.detalle}</p></li>)}</ul>}
  {rows.length===100&&<p className="mt-2 text-xs text-slate-500">Se muestran las 100 actividades más recientes.</p>}
 </section>;
}
