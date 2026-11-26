"use client";
import {useState} from "react";
import Link from "next/link";
type Task={id:string;oportunidad_id:string;titulo:string;vence_at:string;completada_at:string|null};
type Opportunity={id:string;titulo:string};
export default function CRMTaskNotifications({tasks,opportunities,onRefresh,loading}:{tasks:Task[];opportunities:Opportunity[];onRefresh:()=>void;loading:boolean}){
 const [open,setOpen]=useState(false);
 const now=Date.now(),limit=now+7*24*60*60*1000;
 const ids=new Set(opportunities.map(o=>o.id));
 const active=tasks.filter(t=>!t.completada_at&&ids.has(t.oportunidad_id));
 const overdue=active.filter(t=>new Date(t.vence_at).getTime()<now);
 const upcoming=active.filter(t=>{const d=new Date(t.vence_at).getTime();return d>=now&&d<=limit;});
 const alerts=[...overdue,...upcoming].sort((a,b)=>new Date(a.vence_at).getTime()-new Date(b.vence_at).getTime());
 const name=(id:string)=>opportunities.find(o=>o.id===id)?.titulo||"Oportunidad";
 return <section className="relative">
  <div className="flex flex-wrap items-center gap-2">
   <button type="button" aria-expanded={open} aria-controls="crm-notifications-panel" onClick={()=>setOpen(!open)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:border-emerald-400"><span aria-hidden="true">🔔</span> Recordatorios {alerts.length>0&&<span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">{alerts.length}</span>}</button>
   <button type="button" disabled={loading} onClick={onRefresh} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">{loading?"Actualizando…":"Actualizar"}</button>
  </div>
  {open&&<div id="crm-notifications-panel" className="mt-3 w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
   <div className="flex items-center justify-between gap-2"><h2 className="font-bold text-slate-900">Avisos de seguimiento</h2><button type="button" onClick={()=>setOpen(false)} aria-label="Cerrar avisos" className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">Cerrar</button></div>
   <p className="mt-1 text-xs text-slate-500">{overdue.length} vencida{overdue.length===1?"":"s"} · {upcoming.length} en los próximos 7 días</p>
   <div className="mt-3 max-h-72 divide-y divide-slate-100 overflow-y-auto">{alerts.slice(0,10).map(t=>{const late=new Date(t.vence_at).getTime()<now;return <div key={t.id} className="py-3"><p className="text-sm font-semibold text-slate-900">{t.titulo}</p><p className="mt-1 text-xs text-slate-500">{name(t.oportunidad_id)}</p><p className={"mt-1 text-xs "+(late?"font-semibold text-amber-700":"text-slate-500")}>{late?"Vencida · ":"Próxima · "}{new Date(t.vence_at).toLocaleString("es-MX",{dateStyle:"medium",timeStyle:"short"})}</p></div>;})}{!alerts.length&&<p className="py-4 text-sm text-slate-500">No tienes tareas vencidas ni próximas a vencer.</p>}</div>
   <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3"><Link href="/crm?seccion=resumen&filtro=vencidas#agenda" className="text-sm font-semibold text-emerald-700 hover:underline">Ver vencidas ({overdue.length})</Link><Link href="/crm?seccion=resumen&filtro=proximas#agenda" className="text-sm font-semibold text-emerald-700 hover:underline">Ver próximas ({upcoming.length})</Link></div>
  </div>}
 </section>;
}
