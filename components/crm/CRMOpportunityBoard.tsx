"use client";
import {useState} from "react";
export const CRM_STAGES=["nuevo","contactado","propuesta","negociacion","ganado","perdido"] as const;
export type CRMStage=typeof CRM_STAGES[number];
export const CRM_STAGE_NAMES:Record<CRMStage,string>={nuevo:"Nuevo",contactado:"Contactado",propuesta:"Propuesta",negociacion:"Negociación",ganado:"Ganado",perdido:"Perdido"};
export type CRMBoardOpportunity={id:string;contacto_id:string;titulo:string;etapa:string;valor_estimado:number};
const money=(value:number)=>new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(value);
export default function CRMOpportunityBoard({rows,contactName,onMove,onOpen,busy=false}:{rows:CRMBoardOpportunity[];contactName:(id:string)=>string;onMove:(id:string,stage:CRMStage)=>Promise<void>;onOpen?:(id:string)=>void;busy?:boolean}){
 const [dragId,setDragId]=useState<string|null>(null),[over,setOver]=useState<CRMStage|null>(null);
 return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Pipeline comercial">
 {CRM_STAGES.map(stage=>{const items=rows.filter(row=>row.etapa===stage);return <section key={stage} aria-label={CRM_STAGE_NAMES[stage]} onDragOver={e=>{if(!dragId||busy)return;e.preventDefault();e.dataTransfer.dropEffect="move";setOver(stage);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOver(null);}} onDrop={e=>{e.preventDefault();if(dragId&&!busy&&rows.some(row=>row.id===dragId&&row.etapa!==stage))void onMove(dragId,stage);setDragId(null);setOver(null);}} className={"min-h-44 rounded-2xl border p-4 "+(over===stage?"border-emerald-500 bg-emerald-50":"border-transparent bg-slate-50")}>
  <div className="flex items-center justify-between gap-2"><h3 className="font-bold">{CRM_STAGE_NAMES[stage]}</h3><span className="rounded-full bg-white px-2 py-1 text-xs font-semibold">{items.length}</span></div><p className="mt-2 text-sm font-semibold text-slate-600">{money(items.reduce((sum,row)=>sum+Number(row.valor_estimado||0),0))}</p>
  <div className="mt-3 space-y-3">{items.map(row=><article key={row.id} draggable={!busy} onDragStart={e=>{setDragId(row.id);e.dataTransfer.setData("text/plain",row.id);e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>{setDragId(null);setOver(null);}} className={"rounded-xl border border-slate-200 bg-white p-4 shadow-sm "+(dragId===row.id?"opacity-50":"")}>
   <div className="flex items-start justify-between gap-2"><p className="font-semibold">{row.titulo}</p>{onOpen&&<button type="button" onClick={()=>onOpen(row.id)} className="shrink-0 text-xs font-bold text-emerald-700 hover:underline">Abrir</button>}</div>
   <p className="mt-1 text-sm text-slate-500">{contactName(row.contacto_id)}</p><p className="mt-2 font-semibold">{money(Number(row.valor_estimado||0))}</p>
   <label className="mt-3 block text-xs text-slate-500">Etapa<select aria-label={"Etapa de "+row.titulo} disabled={busy} value={stage} onChange={e=>void onMove(row.id,e.target.value as CRMStage)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">{CRM_STAGES.map(s=><option key={s} value={s}>{CRM_STAGE_NAMES[s]}</option>)}</select></label>
  </article>)}{!items.length&&<p className="py-3 text-sm text-slate-400">Sin oportunidades</p>}</div>
 </section>;})}
 </div>;
}
