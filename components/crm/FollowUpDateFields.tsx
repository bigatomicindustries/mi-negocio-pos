export default function FollowUpDateFields({value,onChange}:{value:string;onChange:(value:string)=>void}){
 const [date,time=""]=value.split("T");
 const field="mt-1 block min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
 return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
  <label className="text-sm font-semibold">Fecha<input className={field} type="date" required value={date}
   onChange={e=>onChange(e.target.value && time ? e.target.value+"T"+time : e.target.value)}/></label>
  <label className="text-sm font-semibold">Hora (opcional)<input className={field} type="time" disabled={!date} value={time}
   onChange={e=>onChange(e.target.value ? date+"T"+e.target.value : date)}/></label>
 </div>;
}
