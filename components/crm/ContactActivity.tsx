"use client";

import {useState} from "react";
import {supabase} from "@/lib/supabase";
import CrmModal from "./CrmModal";

export type ContactActivityRow = {id:string; tipo:string; descripcion:string; created_at:string; oportunidad_id:string|null};

export async function readContactActivities(businessId:string, contactId:string) {
  async function read(byOpportunity:boolean) {
    const rows:ContactActivityRow[]=[];
    for(let offset=0;;offset+=250){
      const columns="id,tipo,descripcion,created_at,oportunidad_id";
      const query=byOpportunity
        ? supabase.from("crm_negocio_actividades").select(columns+",crm_negocio_oportunidades!inner(contacto_id)").eq("crm_negocio_oportunidades.contacto_id",contactId)
        : supabase.from("crm_negocio_actividades").select(columns).eq("contacto_id",contactId);
      const result=await query.eq("business_id",businessId).order("created_at",{ascending:false}).order("id").range(offset,offset+249);
      if(result.error) throw result.error;
      const page=result.data as unknown as ContactActivityRow[];
      rows.push(...page);
      if(page.length<250)return rows;
    }
  }
  return (await Promise.all([read(false),read(true)])).flat().sort((a,b)=>b.created_at.localeCompare(a.created_at));
}

export function ContactActivityForm({businessId,contactId,userId,onClose,onSaved}:{
  businessId:string;contactId:string;userId:string;onClose:()=>void;onSaved:()=>void;
}){
  const [kind,setKind]=useState("nota"),[description,setDescription]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function save(e:React.FormEvent){
    e.preventDefault();
    if(busy||!description.trim())return;
    setBusy(true);setError("");
    try{
      const result=await supabase.from("crm_negocio_actividades").insert({business_id:businessId,contacto_id:contactId,created_by:userId,tipo:kind,descripcion:description.trim()}).select("id").single();
      if(result.error)throw result.error;
      onSaved();
    }catch{setError("No se pudo confirmar el registro de la actividad. Revisa el historial antes de reintentar.");}
    finally{setBusy(false);}
  }
  return <CrmModal open title="Registrar actividad" onClose={onClose} busy={busy} alert={error}>
    <form onSubmit={save} className="space-y-4">
      <label className="block text-sm font-semibold">Tipo de actividad<select value={kind} onChange={e=>setKind(e.target.value)} className="mt-1 block w-full rounded-xl border p-3">
        <option value="nota">Nota</option><option value="llamada">Llamada</option><option value="mensaje">Mensaje</option><option value="reunion">Reunión</option>
      </select></label>
      <label className="block text-sm font-semibold">Descripción<textarea value={description} onChange={e=>setDescription(e.target.value)} required maxLength={2000} rows={3} className="mt-1 block w-full rounded-xl border p-3"/></label>
      <button disabled={busy||!description.trim()} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy?"Guardando…":"Guardar actividad"}</button>
    </form>
  </CrmModal>;
}
