"use client";
import {useEffect,useState} from "react";
import {supabase} from "@/lib/supabase";
type Medio={tipo:"correo"|"telefono";valor:string};
export type Contact={id:string;nombre:string|null;apellido:string|null;empresa:string|null;direccion:string|null;notas:string|null;updated_at:string;crm_contacto_medios:Medio[]};
type FormData={nombre:string;apellido:string;empresa:string;direccion:string;notas:string;correo:string;telefono:string};
const blank:FormData={nombre:"",apellido:"",empresa:"",direccion:"",notas:"",correo:"",telefono:""};
const field="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const getForm=(c:Contact|null):FormData=>c?{nombre:c.nombre||"",apellido:c.apellido||"",empresa:c.empresa||"",direccion:c.direccion||"",notas:c.notas||"",correo:c.crm_contacto_medios?.find(m=>m.tipo==="correo")?.valor||"",telefono:c.crm_contacto_medios?.find(m=>m.tipo==="telefono")?.valor||""}:{...blank};
export default function BusinessContacts({businessId,contacts,onSaved}:{businessId:string;contacts:Contact[];onSaved:()=>Promise<void>}){
 const [query,setQuery]=useState(""),[selected,setSelected]=useState<Contact|null>(null),[open,setOpen]=useState(false),[form,setForm]=useState<FormData>({...blank}),[original,setOriginal]=useState<FormData>({...blank}),[saving,setSaving]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const dirty=JSON.stringify(form)!==JSON.stringify(original);
 const filtered=contacts.filter(c=>[c.nombre,c.apellido,c.empresa,...(c.crm_contacto_medios||[]).map(m=>m.valor)].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
 function edit(c:Contact|null){const next=getForm(c);setSelected(c);setForm(next);setOriginal(next);setOpen(true);setError("");setNotice("");}
 function cancel(){if(saving)return;if(dirty&&!window.confirm("¿Descartar cambios sin guardar?"))return;setOpen(false);setError("");}
 useEffect(()=>{setOpen(false);setSelected(null);setQuery("");},[businessId]);
 async function save(e:React.FormEvent){e.preventDefault();if(saving||!dirty&&!selected)return;
  if(!form.nombre.trim()&&!form.empresa.trim()){setError("Indica un nombre o empresa.");return;}
  if(form.nombre.length>120||form.apellido.length>120||form.empresa.length>180||form.direccion.length>2000||form.notas.length>4000){setError("Uno de los campos supera la longitud permitida.");return;}
  if(form.correo.trim()&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo.trim())){setError("Revisa el correo.");return;}
  const digits=form.telefono.replace(/\D/g,"");if(form.telefono.trim()&&(digits.length<7||digits.length>15)){setError("El teléfono debe tener entre 7 y 15 dígitos.");return;}
  setSaving(true);setError("");setNotice("");
  const {error:err}=await supabase.rpc("crm_guardar_contacto_negocio",{p_contacto_id:selected?.id||null,p_nombre:form.nombre,p_apellido:form.apellido,p_empresa:form.empresa,p_direccion:form.direccion,p_notas:form.notas,p_correo:form.correo,p_telefono:form.telefono,p_expected_updated_at:selected?.updated_at||null});
  if(err){setError(err.code==="23505"?"El correo o teléfono ya está registrado en otro contacto de este negocio. No se guardaron cambios.":err.message);setSaving(false);return;}
  setOpen(false);setNotice(selected?"Contacto actualizado.":"Contacto creado.");await onSaved();setSaving(false);
 }
 return <section className="rounded-2xl border bg-white p-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Contactos</h2><p className="mt-1 text-sm text-slate-500">Directorio de clientes y prospectos</p></div><button type="button" onClick={()=>edit(null)} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">+ Nuevo contacto</button></div>
  {notice&&<p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
  <label className="mt-4 block text-sm text-slate-600">Buscar por nombre, empresa, correo o teléfono<input className={field} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar contactos…"/></label>
  <div className="mt-4 max-h-96 divide-y overflow-y-auto">{filtered.map(c=><button type="button" key={c.id} onClick={()=>edit(c)} className="flex w-full items-center justify-between gap-2 py-3 text-left hover:bg-slate-50"><span><span className="block font-medium">{[c.nombre,c.apellido].filter(Boolean).join(" ")||c.empresa}</span>{c.empresa&&c.nombre&&<span className="block text-xs text-slate-500">{c.empresa}</span>}<span className="block text-xs text-slate-500">{(c.crm_contacto_medios||[]).map(m=>m.valor).join(" · ")}</span></span><span className="shrink-0 text-xs font-semibold text-emerald-700">Editar</span></button>)}{!filtered.length&&<p className="py-4 text-sm text-slate-500">No se encontraron contactos.</p>}</div>
  {open&&<div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 pt-10" role="presentation"><div role="dialog" aria-modal="true" aria-label={selected?"Editar contacto":"Nuevo contacto"} className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
   <div className="flex items-center justify-between gap-3"><h3 className="text-xl font-bold">{selected?"Editar contacto":"Nuevo contacto"}</h3><div className="flex gap-2">{(dirty||!selected)&&<button form="crm-contact-form" type="submit" disabled={saving} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving?"Guardando…":"Guardar"}</button>}<button type="button" onClick={cancel} disabled={saving} className="rounded-xl border px-4 py-2 text-sm font-semibold">{dirty?"Cancelar":"Cerrar"}</button></div></div>
   {error&&<p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
   <form id="crm-contact-form" onSubmit={save} className="mt-5 grid gap-3 sm:grid-cols-2">
   {([["nombre","Nombre",120],["apellido","Apellido",120],["empresa","Empresa",180],["correo","Correo",320],["telefono","Teléfono",25],["direccion","Dirección",2000]] as const).map(([key,label,max])=><label key={key} className="block text-sm font-medium">{label}<input className={field} maxLength={max} value={form[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))}/></label>)}
   <label className="block text-sm font-medium sm:col-span-2">Notas<textarea className={field} rows={3} maxLength={4000} value={form.notas} onChange={e=>setForm(v=>({...v,notas:e.target.value}))}/></label>
   </form>
   <p className="mt-4 text-xs text-slate-500">El correo y teléfono no pueden repetirse entre contactos del mismo negocio. Los datos de otros negocios permanecen aislados.</p>
  </div></div>}
 </section>;
}
