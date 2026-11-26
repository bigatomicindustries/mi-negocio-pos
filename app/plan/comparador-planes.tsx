"use client";

import { useRef, useState } from "react";
import { PRICING, type BillingInterval, type CommercialPlan } from "@/lib/pricing-v1";

const planes = ["free", "basic", "pro", "business"] as const;
const detalles = {
  free: ["2 usuarios", "100 productos", "1 sucursal", "Punto de venta e inventario"],
  basic: ["2 usuarios", "100 productos", "1 sucursal", "Punto de venta e inventario", "Historial de ventas y corte de caja", "Reportes básicos"],
  pro: ["10 usuarios", "5,000 productos", "1 sucursal", "Todo lo de Básico", "Compras y proveedores", "Empleados y alertas de stock"],
  business: ["50 usuarios", "50,000 productos", "3 sucursales", "Todo lo de Pro", "Reportes avanzados", "Soporte prioritario"],
};
const moneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

type Props = {
  suscripcion: { plan_slug: string; status: string } | null;
  ventasHabilitadas: boolean;
  obtenerCheckout: (plan: CommercialPlan, intervalo: BillingInterval) => Promise<string>;
};

export default function ComparadorPlanes({ suscripcion, ventasHabilitadas, obtenerCheckout }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const intento = useRef(0);
  const [intervalo, setIntervalo] = useState<BillingInterval>("monthly");
  const [procesando, setProcesando] = useState<CommercialPlan | null>(null);
  const [error, setError] = useState("");
  const vigente = suscripcion && suscripcion.status !== "cancelled" ? suscripcion : null;
  const planActual = vigente?.plan_slug.replace(/-v1$/, "");
  const contratoVigente = Boolean(vigente && planActual !== "free");

  async function contratar(plan: CommercialPlan) {
    if (procesando || contratoVigente || !ventasHabilitadas) return;
    const numero = ++intento.current;
    setError("");
    setProcesando(plan);
    try {
      const url = await obtenerCheckout(plan, intervalo);
      if (numero === intento.current && dialogo.current?.open) window.location.assign(url);
    } catch (e) {
      if (numero === intento.current) {
        setError(e instanceof Error ? e.message : "No se pudo iniciar la contratación.");
        setProcesando(null);
      }
    }
  }

  function cerrar() {
    dialogo.current?.close();
  }

  return <>
    <button type="button" aria-haspopup="dialog" aria-controls="comparador-planes"
      onClick={() => dialogo.current?.showModal()}
      className="shrink-0 rounded-xl bg-green-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-800">
      Ver planes
    </button>

    <dialog ref={dialogo} id="comparador-planes" aria-labelledby="titulo-comparador"
      onClose={() => { intento.current++; setProcesando(null); setError(""); }}
      onClick={event => { if (event.target === event.currentTarget) cerrar(); }}
      className="fixed inset-0 m-auto max-h-none w-[min(72rem,calc(100%-1.5rem))] max-w-none overflow-visible rounded-3xl bg-white text-slate-900 shadow-2xl backdrop:bg-slate-950/50">
      <div className="flex max-h-[90dvh] flex-col overflow-hidden rounded-3xl">
        <header className="shrink-0 border-b border-slate-200 px-5 py-4 sm:px-7">
          <div className="flex items-center justify-between gap-3">
            <h2 id="titulo-comparador" className="text-xl font-bold sm:text-2xl">Comparar planes</h2>
            <button type="button" aria-label="Cerrar comparador" onClick={cerrar}
              className="rounded-full px-3 py-1 text-2xl leading-8 text-slate-600 hover:bg-slate-100">×</button>
          </div>
          <div className="mt-2 inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Periodicidad de cobro">
            {(["monthly", "annual"] as const).map(valor => (
              <button key={valor} type="button" aria-pressed={intervalo === valor} disabled={procesando !== null}
                onClick={() => { setIntervalo(valor); setError(""); }}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${intervalo === valor ? "bg-white text-green-800 shadow-sm" : "text-slate-600"}`}>
                {valor === "monthly" ? "Mensual" : "Anual"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {intervalo === "monthly" ? "Cobro cada mes en MXN, IVA incluido." : "Cobro cada 12 meses en MXN, IVA incluido."}
          </p>
          {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> :
            contratoVigente ? <p className="mt-2 text-sm text-slate-700">Tu negocio ya tiene un contrato vigente.</p> :
            !ventasHabilitadas && <p className="mt-2 text-sm text-slate-700">La contratación está temporalmente deshabilitada.</p>}
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {planes.map(plan => {
              const actual = plan === planActual;
              const nombre = plan === "free" ? "Free" : PRICING[plan].name;
              const precio = plan === "free" ? 0 : PRICING[plan][intervalo];
              return <section key={plan} aria-label={nombre}
                className={`flex flex-col rounded-2xl border p-4 ${actual ? "border-green-600 bg-green-50/40" : "border-slate-200"}`}>
                <h3 className="text-lg font-bold">{nombre}</h3>
                <div className="lg:min-h-7">
                  {actual && <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Este es tu plan</span>}
                </div>
                <p className="mt-3 text-3xl font-bold tracking-tight">
                  {moneda.format(precio / 100)}
                  <span className="ml-1 text-sm font-normal text-slate-600">{plan === "free" ? "sin costo" : intervalo === "monthly" ? "/ mes" : "/ año"}</span>
                </p>
                <ul className="my-4 flex-1 space-y-2 border-t border-slate-200 pt-4 text-sm text-slate-700">
                  {detalles[plan].map(linea => <li key={linea} className="flex gap-2">
                    <span aria-hidden="true" className="text-green-700">✓</span>{linea}
                  </li>)}
                </ul>
                {plan !== "free" && !contratoVigente && <button type="button"
                  disabled={!ventasHabilitadas || procesando !== null}
                  onClick={() => void contratar(plan)}
                  className="w-full rounded-xl bg-green-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-green-800 disabled:bg-slate-200 disabled:text-slate-600">
                  {procesando === plan ? "Abriendo Mercado Pago…" : "Contratar " + nombre}
                </button>}
              </section>;
            })}
          </div>
        </div>
      </div>
    </dialog>
  </>;
}
