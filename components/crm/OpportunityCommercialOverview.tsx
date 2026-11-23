"use client";
import Link from "next/link";
type Task={id:string;oportunidad_id:string;titulo:string;vence_at:string;completada_at:string|null};
type Contact={id:string;nombre:string|null;apellido:string|null;empresa:string|null;direccion:string|null;notas:string|null;crm_contacto_medios:{tipo:"correo"|"telefono";valor:string}[]};
export default function OpportunityCommercialOverview({contact,tasks,busy,onToggle}:{contact:Contact|null;tasks:Task[];busy:boolean;onToggle:(t:Task)=>void}){
 const name=contact?[contact.nombre,contact.apellido].filter(Boolean).join(" ")||contact.empresa||"Sin nombre":"Contacto no disponible";
 const phone=contact?.crm_contacto_medios?.find(m=>m.tipo==="telefono")?.valor;
 const email=contact?.crm_contacto_medios?.find(m=>m.tipo==="correo")?.valor;
 const pending=tasks.filter(t=>!t.completada_at).sort((a,b)=>new Date(a.vence_at).getTime()-new Date(b.vence_at).getTime());
 const completed=tasks.filter(t=>!!t.completada_at);
 return <div className="mt-5 grid gap-4 md:grid-cols-2">
  <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-base font-bold text-slate-900">Contacto vinculado</h3><p className="mt-3 font-semibold text-slate-900">{name}</p>{contact?.empresa&&<p className="mt-1 text-sm text-slate-600">{contact.empresa}</p>}
   <div className="mt-3 space-y-2 text-sm">{phone?<p className="break-all"><span className="text-slate-500">Teléfono: </span><a className="font-semibold text-emerald-700 hover:underline" href={"tel:"+phone}>{phone}</a></p>:<p className="text-slate-500">Sin teléfono registrado</p>}{email?<p className="break-all"><span className="text-slate-500">Correo: </span><a className="font-semibold text-emerald-700 hover:underline" href={"mailto:"+email}>{email}</a></p>:<p className="text-slate-500">Sin correo registrado</p>}{contact?.direccion&&<p className="text-slate-600">Dirección: {contact.direccion}</p>}</div>
  </section>
  <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-bold text-slate-900">Seguimientos</h3><span className="text-xs font-semibold text-slate-500">{pending.length} pendiente{pending.length===1?"":"s"} · {completed.length} completada{completed.length===1?"":"s"}</span></div>
   <div className="mt-3 max-h-48 divide-y divide-slate-200 overflow-y-auto">{pending.slice(0,5).map(t=>{const overdue=new Date(t.vence_at).getTime()<Date.now();return <label key={t.id} className="flex cursor-pointer items-start gap-2 py-2 text-sm"><input type="checkbox" checked={false} disabled={busy} onChange={()=>onToggle(t)} className="mt-1 accent-emerald-700"/><span className="min-w-0"><span className="block font-medium text-slate-900">{t.titulo}</span><span className={"block text-xs "+(overdue?"font-semibold text-amber-700":"text-slate-500")}>{new Date(t.vence_at).toLocaleString("es-MX",{dateStyle:"medium",timeStyle:"short"})}{overdue?" · Vencida":""}</span></span></label>)}{!pending.length&&<p className="py-3 text-sm text-slate-500">Sin seguimientos pendientes.</p>}</div>
   <Link href="/crm?seccion=trabajo" className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:underline">Ir al Centro de trabajo</Link>
  </section>
 </div>;
}
