"use client";
import Link from "next/link";
export type CRMSection="resumen"|"contactos"|"oportunidades"|"catalogo";
const tabs:{id:CRMSection;label:string}[]=[{id:"resumen",label:"Inicio"},{id:"oportunidades",label:"Oportunidades"},{id:"contactos",label:"Contactos"},{id:"catalogo",label:"Catálogo"}];
export default function CRMWorkspace({basePath,section,children,subtitle}:{basePath:string;section:CRMSection;children:React.ReactNode;subtitle:string}){
 return <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 md:px-8">
  <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
   <header className="min-w-0 shrink-0"><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Mi Negocio · CRM</p><h1 className="mt-2 text-3xl font-bold text-slate-900">Relaciones comerciales</h1><p className="mt-1 text-slate-600">{subtitle}</p></header>
   <nav aria-label="Secciones del CRM" className="flex flex-wrap items-center gap-2 lg:justify-end">{tabs.map(tab=><Link key={tab.id} href={basePath+"?seccion="+tab.id} aria-current={section===tab.id?"page":undefined} className={"whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition-colors "+(section===tab.id?"bg-slate-900 text-white":"bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-800")}>{tab.label}</Link>)}</nav>
  </div>
  <div className="border-b border-slate-200" aria-hidden="true"/>
  {children}
 </main>;
}
