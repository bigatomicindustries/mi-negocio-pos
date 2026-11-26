"use client";

export type ChannelKind = "correo" | "telefono";
export type ChannelRow = { key: string; tipo: ChannelKind; valor: string; etiqueta: string };

export default function ContactChannelFields({ kind, rows, disabled, onChange }: {
  kind: ChannelKind; rows: ChannelRow[]; disabled: boolean; onChange: (rows: ChannelRow[]) => void;
}) {
  const isEmail = kind === "correo";
  const label = isEmail ? "Correo" : "Teléfono";
  function update(key: string, field: "valor" | "etiqueta", value: string) {
    onChange(rows.map(row => row.key === key ? { ...row, [field]: value } : row));
  }
  const values = rows.filter(row => row.tipo === kind);
  return <fieldset aria-label={label} className="space-y-3 sm:col-span-2">
    {values.map((row, index) => <div key={row.key} className="grid items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
      <label className="text-sm">{index === 0 ? label : label+" "+(index+1)}
        <input type={isEmail ? "email" : "tel"} value={row.valor} disabled={disabled} maxLength={isEmail ? 320 : 40}
          className="mt-1 w-full rounded-xl border px-3 py-2 disabled:bg-slate-50" onChange={e=>update(row.key,"valor",e.target.value)} />
      </label>
      <label className="text-sm">Etiqueta
        <input value={row.etiqueta} disabled={disabled} maxLength={80} placeholder="Ej. Trabajo"
          className="mt-1 w-full rounded-xl border px-3 py-2 disabled:bg-slate-50" onChange={e=>update(row.key,"etiqueta",e.target.value)} />
      </label>
      {!disabled && values.length>1 && <button type="button" aria-label={`Quitar ${label.toLowerCase()} ${index+1}`} className="px-2 py-2 text-sm text-slate-600 underline" onClick={()=>onChange(rows.filter(item=>item.key!==row.key))}>Quitar</button>}
    </div>)}
    {!disabled && <button type="button" className="rounded-lg py-1 text-sm font-semibold text-emerald-700 hover:underline" onClick={()=>onChange([...rows,{key:crypto.randomUUID(),tipo:kind,valor:"",etiqueta:""}])}>{isEmail ? "+ Agregar correo electrónico" : "+ Agregar teléfono"}</button>}
  </fieldset>;
}
