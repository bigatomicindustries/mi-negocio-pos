"use client";
import Link from "next/link";
export type CRMSection="resumen"|"contactos"|"oportunidades"|"trabajo";
const tabs:{id:CRMSection;label:string}[]=[{id:"resumen",label:"Resumen"},{id:"contactos",label:"Contactos"},{id:"oportunidades",label:"Oportunidades"},{id:"trabajo",label:"Centro de trabajo"}];
export default function CRMWorkspace({basePath,section,children,subtitle,pendingAlerts=0}:{basePath:string;section:CRMSection;children:React.ReactNode;subtitle:string;pendingAlerts?:number}){
 return <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 md:px-8">
  <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
   <header className="min-w-0 shrink-0"><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Mi Negocio · CRM</p><h1 className="mt-2 text-3xl font-bold text-slate-900">Relaciones comerciales</h1><p className="mt-1 text-slate-600">{subtitle}</p></header>
   <nav aria-label="Secciones del CRM" className="flex flex-wrap items-center gap-2 lg:justify-end">{tabs.map(tab=><Link key={tab.id} href={basePath+"?seccion="+tab.id} aria-current={section===tab.id?"page":undefined} className={"whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition-colors "+(section===tab.id?"bg-slate-900 text-white":"bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-800")}>{tab.label}{tab.id==="trabajo"&&pendingAlerts>0&&<span aria-label={pendingAlerts+" seguimientos vencidos o próximos"} className={"ml-2 inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold "+(section===tab.id?"bg-white text-slate-900":"bg-amber-100 text-amber-900")}>{pendingAlerts}</span>}</Link>)}</nav>
  </div>
  <div className="border-b border-slate-200" aria-hidden="true"/>
  {children}
 </main>;
}
