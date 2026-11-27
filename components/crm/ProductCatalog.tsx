"use client";

import {useEffect,useRef,useState} from "react";
import {supabase} from "@/lib/supabase";
import CrmModal from "./CrmModal";

const availability=["Disponible","Sobre pedido","Importación","Sin disponibilidad"] as const;
type Draft={nombre:string;tipo:string;precio:string;sku:string;categoria:string;descripcion:string;disponibilidad:string;activo:boolean};
type Item=Omit<Draft,"precio">&{id:string;precio:number;updated_at:string;campos:Record<string,string>};
export type CatalogLine={id:string;nombre:string;precio:number;cantidad:number};
const empty:Draft={nombre:"",tipo:"Producto",precio:"",sku:"",categoria:"",descripcion:"",disponibilidad:"Disponible",activo:true};
const field="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50";
const btn="rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50";
const primary="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const pageSize=24;
const highlightDuration=5000;
const money=(n:number)=>n.toLocaleString("es-MX",{style:"currency",currency:"MXN"});
const maxPrice=999999999999.99;
const validPrice=(value:string)=>/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)&&Number(value)<=maxPrice;
export const catalogTotal=(lines:CatalogLine[])=>lines.reduce((sum,l)=>sum+Math.round(Number(l.precio)*100)*l.cantidad,0)/100;

function useCatalog(businessId:string){
 const [items,setItems]=useState<Item[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(""),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let current=true;
  setBusy(true);setError("");setItems([]);
  async function load(){
   const all:Item[]=[];
   let last="";
   for(;;){
    let query=supabase.from("crm_catalogo").select("id,nombre,sku,tipo,categoria,descripcion,precio,disponibilidad,activo,campos,updated_at").eq("business_id",businessId).order("id").limit(250);
    if(last)query=query.gt("id",last);
    const result=await query;
    if(!current)return;
    if(result.error)throw result.error;
    all.push(...result.data);
    if(result.data.length<250)break;
    last=result.data[result.data.length-1].id;
   }
   if(current)setItems(all.sort((a,b)=>a.nombre.localeCompare(b.nombre,"es")));
  }
  load().catch(()=>{if(current)setError("No se pudo cargar el catálogo.");}).finally(()=>{if(current)setBusy(false);});
  return ()=>{current=false;};
 },[businessId,revision]);
 return {items,busy,error,reload:()=>setRevision(v=>v+1)};
}

export function OpportunityEstimate({businessId,lines,setLines,amount,setAmount,disabled,original=[]}:{
 businessId:string;lines:CatalogLine[];setLines:(lines:CatalogLine[])=>void;amount:string;setAmount:(s:string)=>void;disabled:boolean;original?:CatalogLine[];
}){
 const {items,busy,error,reload}=useCatalog(businessId);
 function change(next:CatalogLine[]){setLines(next);setAmount(String(catalogTotal(next)));}
 return <div className="space-y-3">
  <div className="grid gap-3 sm:grid-cols-2">
   <label className="block text-sm font-semibold">Productos o servicios de interés
    <select value="" disabled={disabled||busy||!!error} className={field} onChange={e=>{
     const item=items.find(i=>i.id===e.target.value);
     if(!item)return;
     const snapshot=original.find(line=>line.id===item.id);
     change([...lines,{id:item.id,nombre:snapshot?.nombre??item.nombre,precio:snapshot?.precio??item.precio,cantidad:1}]);
    }}><option value="">{busy?"Cargando catálogo…":"Agregar del catálogo"}</option>
    {items.filter(i=>i.activo&&!lines.some(l=>l.id===i.id)).map(i=><option key={i.id} value={i.id}>{i.nombre}{i.sku?" · "+i.sku:""} · {money(original.find(line=>line.id===i.id)?.precio??i.precio)}</option>)}</select>
   </label>
   <label className="block text-sm font-semibold">Valor estimado (MXN)<input type="number" min="0" step="0.01" required readOnly={lines.length>0} disabled={disabled} value={amount} onChange={e=>setAmount(e.target.value)} className={field+" read-only:bg-slate-50"}/></label>
  </div>
  {error&&<p role="alert">{error} <button type="button" className="underline" onClick={reload}>Reintentar</button></p>}
  {!busy&&!error&&!items.some(i=>i.activo)&&<p className="text-xs text-slate-600">Añade productos o servicios en la pestaña Catálogo para seleccionarlos aquí.</p>}
  {lines.map((line,index)=><div key={line.id} className="flex flex-wrap items-end gap-3 rounded-xl bg-slate-50 p-3">
   <div className="min-w-36 flex-1"><strong className="block text-sm">{line.nombre}</strong><span className="text-xs">{money(line.precio)} por unidad</span></div>
   <label className="text-xs">Cantidad<input type="number" min="1" max="2147483647" step="1" required disabled={disabled} value={line.cantidad||""} className={field+" max-w-24"} onChange={e=>change(lines.map((l,i)=>i===index?{...l,cantidad:Number(e.target.value)}:l))}/></label>
   <span className="py-2 text-sm font-semibold">{money(catalogTotal([line]))}</span>
   <button type="button" disabled={disabled} aria-label={"Quitar "+line.nombre} className={btn} onClick={()=>change(lines.filter(l=>l.id!==line.id))}>Quitar</button>
  </div>)}
 </div>;
}

export default function ProductCatalog({businessId,readOnly}:{businessId:string;readOnly:boolean}){
 const {items,busy,error,reload}=useCatalog(businessId);
 const [query,setQuery]=useState(""),[category,setCategory]=useState(""),[status,setStatus]=useState(""),[archived,setArchived]=useState(false),[page,setPage]=useState(1);
 const [opened,setOpened]=useState(false),[editing,setEditing]=useState<Item|null>(null),[draft,setDraft]=useState<Draft>(empty);
 const [priceFocused,setPriceFocused]=useState(false);
 const [fields,setFields]=useState<{name:string;value:string}[]>([]),[saving,setSaving]=useState(false),[problem,setProblem]=useState("");
 const [pendingItemId,setPendingItemId]=useState<string|null>(null);
 const [highlightedItemId,setHighlightedItemId]=useState<string|null>(null);
 const highlightedCard=useRef<HTMLButtonElement>(null);
 const categories=[...new Set(items.map(i=>i.categoria).filter(Boolean))].sort();
 const names=[...new Set(items.flatMap(i=>Object.keys(i.campos)))].sort();
 const search=query.trim().toLocaleLowerCase("es");
 const filtered=items
  .filter(i=>i.activo!==archived&&(!category||category===i.categoria)&&(!status||status===i.disponibilidad)&&[i.nombre,i.sku,i.categoria].some(v=>v.toLocaleLowerCase("es").includes(search)))
  .sort((a,b)=>a.precio-b.precio);
 const pages=Math.max(1,Math.ceil(filtered.length/pageSize)),current=Math.min(page,pages);
 const [photo,setPhoto]=useState<File|null>(null),[urls,setUrls]=useState<Record<string,string>>({});
 if(pendingItemId&&!opened&&!busy){
  const index=filtered.findIndex(item=>item.id===pendingItemId);
  if(index>=0){
   setPage(Math.floor(index/pageSize)+1);
   setHighlightedItemId(pendingItemId);
   setPendingItemId(null);
  }
 }
 useEffect(()=>{
  if(!highlightedItemId)return;
  highlightedCard.current?.scrollIntoView({block:"nearest"});
  const timer=window.setTimeout(()=>setHighlightedItemId(null),highlightDuration);
  return ()=>window.clearTimeout(timer);
 },[highlightedItemId]);
 const visibleItems=filtered.slice((current-1)*pageSize,current*pageSize);
 const paths=visibleItems.map(i=>businessId+"/"+i.id).join(",");
 useEffect(()=>{
  let live=true;
  async function images(){
   if(!paths){if(live)setUrls({});return;}
   const files=await supabase.rpc("crm_catalogo_fotos",{rutas:paths.split(",")});
   if(!live)return;
   if(files.error||!files.data?.length){setUrls({});return;}
   const signed=await supabase.storage.from("crm-catalogo").createSignedUrls(files.data,3600);
   if(live)setUrls(Object.fromEntries((signed.data||[]).filter(f=>f.path&&f.signedUrl).map(f=>[f.path,f.signedUrl])));
  }
  const refresh=()=>{void images().catch(()=>{if(live)setUrls({});});};
  refresh();const timer=setInterval(refresh,3000000);
  return ()=>{live=false;clearInterval(timer);};
 },[paths,items]);
 function open(item:Item|null){
  setPriceFocused(false);
  setPhoto(null);setEditing(item);setDraft(item?{...item,precio:String(item.precio)}:{...empty});setFields(Object.entries(item?.campos||{}).map(([name,value])=>({name,value})));setProblem("");setOpened(true);
 }
 function update(key:keyof Draft,value:string|boolean){setDraft(old=>({...old,[key]:value}));}
 async function save(e:React.FormEvent){
  e.preventDefault();if(saving||readOnly)return;
  if(photo&&(!["image/jpeg","image/png","image/webp"].includes(photo.type)||photo.size>2097152)){setProblem("Elige una foto JPG, PNG o WebP de hasta 2 MB.");return;}
  const specs=fields.filter(f=>f.name.trim()||f.value.trim());
  if(specs.some(f=>!f.name.trim()||!f.value.trim())||new Set(specs.map(f=>f.name.trim().toLowerCase())).size!==specs.length){setProblem("Cada campo personalizado necesita un nombre único y un valor.");return;}
  if(!draft.nombre.trim()){setProblem("Escribe el nombre del artículo.");return;}
  if(!validPrice(draft.precio)){setProblem("Escribe un precio entre "+money(0)+" y "+money(maxPrice)+", con hasta dos decimales.");return;}
  setSaving(true);setProblem("");
  const data={nombre:draft.nombre.trim(),tipo:draft.tipo,precio:Number(draft.precio),sku:draft.sku.trim(),categoria:draft.categoria.trim(),descripcion:draft.descripcion.trim(),disponibilidad:draft.disponibilidad,activo:draft.activo,campos:Object.fromEntries(specs.map(f=>[f.name.trim(),f.value.trim()]))};
  try{
   const table=supabase.from("crm_catalogo");
   const mutation=editing?table.update(data).eq("id",editing.id).eq("business_id",businessId).eq("updated_at",editing.updated_at):table.insert({...data,business_id:businessId});
   const r=await mutation.select("id,updated_at").maybeSingle();
   if(r.error){setProblem(r.error.code==="23505"?"Ese SKU ya está registrado.":r.error.message);return;}
   if(!r.data){setProblem("El artículo cambió. Cierra la ficha y vuelve a abrirla.");reload();return;}
   if(!editing){
    setQuery("");
    setCategory("");
    setStatus("");
    setArchived(false);
    setPendingItemId(r.data.id);
    setHighlightedItemId(null);
   }
   if(photo){
    const savedItem={...data,...r.data};
    setEditing(savedItem);
    try{
     const uploaded=await supabase.storage.from("crm-catalogo").upload(businessId+"/"+savedItem.id,photo,{upsert:true,contentType:photo.type,cacheControl:"0"});
     if(uploaded.error)throw uploaded.error;
    }catch{setProblem("La ficha se guardó. Vuelve a intentar guardar la foto.");reload();return;}
   }
   setOpened(false);reload();
  }catch{setProblem("No se pudo confirmar el guardado. Revisa el catálogo antes de reintentar.");}finally{setSaving(false);}
 }
 async function removeItem(){
  if (!editing || readOnly || saving) return;
  if (!window.confirm("¿Eliminar «"+editing.nombre+"» del catálogo?")) return;
  setSaving(true);
  setProblem("");
  try {
   const result = await supabase.rpc("crm_catalogo_eliminar", {
    articulo: editing.id, version_esperada: editing.updated_at,
   });
   if (result.error) throw result.error;
   if (!result.data) {
    setProblem("No se pudo eliminar. Actualiza la ficha y verifica tu acceso.");
    reload();
    return;
   }
   setOpened(false);
   reload();
  } catch {
   setProblem("No se pudo confirmar la eliminación. Revisa el catálogo antes de reintentar.");
  } finally {
   setSaving(false);
  }
 }
 return <section className="space-y-4 rounded-2xl border bg-white p-5">
  <h2 className="text-xl font-bold">Catálogo de productos y servicios</h2>
  <div className="flex flex-wrap items-center gap-2">
   <input type="search" aria-label="Buscar en el catálogo" placeholder="Buscar por nombre, SKU o categoría" className="min-w-0 grow basis-48 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/>
   <select aria-label="Categoría" className={btn} value={category} onChange={e=>{setCategory(e.target.value);setPage(1);}}><option value="">Todas las categorías</option>{categories.map(c=><option key={c}>{c}</option>)}</select>
   <select aria-label="Disponibilidad" className={btn} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">Toda disponibilidad</option>{availability.map(a=><option key={a}>{a}</option>)}</select>
   <div className="flex max-w-full flex-wrap items-center gap-2">
    <label className="text-sm"><input type="checkbox" checked={archived} onChange={e=>{setArchived(e.target.checked);setPage(1);}}/> Archivados</label>
    <button type="button" disabled={readOnly} className={primary} onClick={()=>open(null)}>+ Nuevo producto o servicio</button>
   </div>
  </div>
  {busy?<p>Cargando catálogo…</p>:error?<p role="alert">{error} <button onClick={reload}>Reintentar</button></p>:!filtered.length?<p className="py-6 text-sm text-slate-600">{items.length?"Sin coincidencias.":"Todavía no hay productos ni servicios en el catálogo."}</p>:
   <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleItems.map(i=><button key={i.id} type="button" onClick={()=>open(i)}
    ref={i.id===highlightedItemId?highlightedCard:undefined}
    className={`min-w-0 rounded-xl border p-4 text-left hover:border-emerald-600 ${i.id===highlightedItemId?"border-emerald-500 bg-emerald-50":"bg-white"}`}>
    {urls[businessId+"/"+i.id]&&<img loading="lazy" src={urls[businessId+"/"+i.id]} alt={i.nombre} className="mb-3 h-36 w-full rounded-lg object-contain"/>}
    <span className="text-xs text-slate-600">{[i.tipo,i.categoria].filter(Boolean).join(" · ")}</span><strong className="my-1 block break-words">{i.nombre}</strong>{i.sku&&<span className="block text-xs">SKU {i.sku}</span>}
    <span className="mt-3 block font-semibold">{money(i.precio)}</span><span className="text-sm text-slate-600">{i.disponibilidad}</span>
   </button>)}</div>}
  {pages>1&&<div className="flex justify-between"><button disabled={current<=1} onClick={()=>setPage(current-1)}>Anterior</button>{current} / {pages}<button disabled={current>=pages} onClick={()=>setPage(current+1)}>Siguiente</button></div>}
  <CrmModal open={opened} busy={saving} title={editing?editing.nombre:"Nuevo producto o servicio"} onClose={()=>setOpened(false)} alert={problem}
   actions={!readOnly&&<button type="submit" form="catalog-item-form" disabled={saving} className={primary}>Guardar</button>}>
   <form id="catalog-item-form" onSubmit={save}><fieldset disabled={saving||readOnly} className="grid gap-3 sm:grid-cols-2">
    <label>Nombre<input className={field} required maxLength={240} value={draft.nombre} onChange={e=>update("nombre",e.target.value)}/></label>
    <label>Precio unitario (MXN)
     <input className={field} required inputMode="decimal"
      value={!priceFocused&&validPrice(draft.precio)?money(Number(draft.precio)):draft.precio}
      onFocus={()=>setPriceFocused(true)} onBlur={()=>setPriceFocused(false)}
      onChange={e=>{
       const value=e.target.value.trim().replace(/^\$\s*/,"");
       const ungrouped=/^\d{1,3}(?:,\d{3})+(?:\.\d{0,2})?$/.test(value)?value.replaceAll(",",""):value;
       update("precio",ungrouped);
      }}/>
    </label>
    {editing&&urls[businessId+"/"+editing.id]&&<img src={urls[businessId+"/"+editing.id]} alt={editing.nombre} className="max-h-64 w-full object-contain sm:col-span-2"/>}
    {!readOnly&&<label className="sm:col-span-2">Foto principal (opcional, hasta 2 MB)<input type="file" accept="image/jpeg,image/png,image/webp" className={field} onChange={e=>setPhoto(e.target.files?.[0]||null)}/></label>}
    <label>Tipo<select className={field} value={draft.tipo} onChange={e=>update("tipo",e.target.value)}><option>Producto</option><option>Servicio</option></select></label>
    <label>SKU<input className={field} value={draft.sku} onChange={e=>update("sku",e.target.value)}/></label>
    <label>Categoría<input className={field} list="catalog-categories" value={draft.categoria} onChange={e=>update("categoria",e.target.value)}/></label>
    <datalist id="catalog-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist>
    <label>Disponibilidad<select className={field} value={draft.disponibilidad} onChange={e=>update("disponibilidad",e.target.value)}>{availability.map(a=><option key={a}>{a}</option>)}</select></label>
    <label className="sm:col-span-2">Descripción<textarea className={field} value={draft.descripcion} onChange={e=>update("descripcion",e.target.value)}/></label>
    <div className="space-y-3 sm:col-span-2"><h3 className="font-semibold">Campos personalizados</h3>
     <datalist id="catalog-fields">{names.map(n=><option key={n} value={n}/>)}</datalist>
     {fields.map((f,index)=><div key={index} className="flex flex-wrap items-end gap-2">
      <label className="min-w-28 flex-1 text-sm">Campo<input className={field} list="catalog-fields" placeholder="Ej. Medidas o duración" value={f.name} onChange={e=>setFields(rows=>rows.map((r,i)=>i===index?{...r,name:e.target.value}:r))}/></label>
      <label className="min-w-28 flex-1 text-sm">Valor<input className={field} value={f.value} onChange={e=>setFields(rows=>rows.map((r,i)=>i===index?{...r,value:e.target.value}:r))}/></label>
      {!readOnly&&<button type="button" className={btn} onClick={()=>setFields(rows=>rows.filter((_,i)=>i!==index))}>Quitar</button>}
     </div>)}
     {!readOnly&&<button type="button" className={btn} onClick={()=>setFields(rows=>[...rows,{name:"",value:""}])}>+ Agregar campo</button>}
    </div>
    {editing&&<label><input type="checkbox" checked={draft.activo} onChange={e=>update("activo",e.target.checked)}/> Activo en el catálogo</label>}
    {editing&&!readOnly&&<div className="border-t border-slate-200 pt-4 sm:col-span-2"><button type="button" className={btn+" border-red-200 text-red-700 hover:bg-red-50"} onClick={removeItem}>{editing.tipo==="Servicio"?"Eliminar servicio":"Eliminar producto"}</button></div>}
   </fieldset></form>
  </CrmModal>
 </section>;
}
