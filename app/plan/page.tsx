"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { PRICING, type BillingInterval, type CommercialPlan } from "@/lib/pricing-v1";

type Suscripcion = {
  plan_name: string;
  plan_slug: string;
  status: string;
  max_users: number;
  max_products: number;
  current_users: number;
  current_products: number;
  starts_at: string;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
};

export default function PlanPage() {
  return <Suspense fallback={<main className="p-6">Cargando plan…</main>}><PlanContent /></Suspense>;
}

async function billingPost(path: string, body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "No pudimos completar la operación.");
  return result;
}

function PlanContent() {
  const router = useRouter();
  const params = useSearchParams();
  const preapproval = params.get("preapproval_id");
  const checkout = params.get("checkout_v1");
  const { perfil, negocio } = useAuth();
  const [suscripcion, setSuscripcion] = useState<Suscripcion | null>(null);
  const [loading, setLoading] = useState(true);
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [enabled, setEnabled] = useState(false);
  const [procesandoPlan, setProcesandoPlan] = useState<CommercialPlan | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!perfil?.id) return;
    if (perfil.role !== "admin") { router.replace("/"); return; }
    let current = true;
    async function load() {
      try {
        if (preapproval || checkout) {
          try {
            const legacyId = checkout ? null : sessionStorage.getItem("mercadopago_checkout_id");
            const result = await billingPost(checkout ? "/api/mercadopago/v1/confirm" : "/api/mercadopago/confirm-subscription", {
              preapproval_id: preapproval, checkout_id: checkout || legacyId,
            });
            if (!current) return;
            if (!checkout) sessionStorage.removeItem("mercadopago_checkout_id");
            const messages: Record<string,string> = {
              pending: "Mercado Pago aún está esperando la autorización. Puedes retomar la contratación del mismo plan.",
              authorized: "Mercado Pago confirmó la autorización de tu suscripción.",
              cancelled: "La contratación se canceló.", paused: "La suscripción está pausada.",
            };
            setNotice(messages[result.status] || "Suscripción confirmada.");
            router.replace("/plan");
          } catch (e) { if (current) setError(e instanceof Error ? e.message : "No se pudo confirmar la suscripción."); }
        }
        const { data, error: dbError } = await supabase.rpc("get_my_subscription");
        if (dbError || !data?.[0]) throw new Error("No se pudo consultar la suscripción del negocio.");
        if (current) setSuscripcion(data[0]);
        const ready = await fetch("/api/mercadopago/subscribe", {cache:"no-store"});
        if (ready.ok) {
          const settings = await ready.json();
          if (current) setEnabled(settings.enabled === true);
        }
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : "No se pudo consultar el plan.");
      } finally { if (current) setLoading(false); }
    }
    void load();
    return () => { current = false; };
  }, [perfil?.id, perfil?.role, router, checkout, preapproval]);

  async function contratarPlan(plan: CommercialPlan) {
    setProcesandoPlan(plan);
    setError("");
    setNotice("");
    try {
      const result = await billingPost("/api/mercadopago/subscribe", {plan, interval});
      if (!result.success || !result.checkout_url) throw new Error("No se recibió el enlace de contratación.");
      window.location.assign(result.checkout_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar la contratación.");
      setProcesandoPlan(null);
    }
  }

  function porcentaje(
    actual: number,
    maximo: number
  ) {
    if (maximo <= 0) return 0;

    return Math.min(
      100,
      Math.round((actual / maximo) * 100)
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <p className="text-slate-500">
            Cargando plan...
          </p>
        </div>
      </main>
    );
  }

  if (!suscripcion) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">
            {error ||
              "No se pudo cargar el plan."}
          </div>
        </div>
      </main>
    );
  }

  const porcentajeUsuarios = porcentaje(
    Number(suscripcion.current_users),
    Number(suscripcion.max_users)
  );

  const porcentajeProductos = porcentaje(
    Number(suscripcion.current_products),
    Number(suscripcion.max_products)
  );

  const usuariosAlLimite =
    Number(suscripcion.current_users) >=
    Number(suscripcion.max_users);

  const productosAlLimite =
    Number(suscripcion.current_products) >=
    Number(suscripcion.max_products);

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-5xl">
        {/* ENCABEZADO */}

        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-green-600">
            {negocio?.name || "Mi negocio"}
          </p>

          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            Plan y uso
          </h1>

          <p className="mt-2 text-slate-500">
            Consulta tu plan actual y el uso de
            los recursos incluidos.
          </p>
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
        {notice && <p role="status" className="mt-4 rounded-xl bg-green-50 p-4 text-green-800">{notice}</p>}

        {/* PLAN ACTUAL */}

        <div className="mt-10 rounded-3xl border bg-white p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">
                Plan actual
              </p>

              <h2 className="mt-2 text-3xl font-bold text-slate-900">
                {suscripcion.plan_name}
              </h2>

              <p className="mt-2 text-sm text-slate-500">
                Tu negocio está utilizando el plan{" "}
                {suscripcion.plan_name}.
              </p>
            </div>

            <span className="w-fit rounded-full bg-green-100 px-4 py-2 text-sm font-semibold text-green-700">
              {suscripcion.status === "active"
                ? "Activo"
                : suscripcion.status}
            </span>
          </div>
        </div>

        {/* USO */}

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {/* USUARIOS */}

          <div className="rounded-3xl border bg-white p-7">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  Usuarios
                </p>

                <p className="mt-2 text-3xl font-bold text-slate-900">
                  {suscripcion.current_users}
                  <span className="text-lg font-medium text-slate-400">
                    {" "}
                    / {suscripcion.max_users}
                  </span>
                </p>
              </div>

              <p className="text-sm font-semibold text-slate-500">
                {porcentajeUsuarios}%
              </p>
            </div>

            <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className={
                  usuariosAlLimite
                    ? "h-full rounded-full bg-amber-500 transition-all"
                    : "h-full rounded-full bg-green-600 transition-all"
                }
                style={{
                  width: `${porcentajeUsuarios}%`,
                }}
              />
            </div>

            <p
              className={`mt-4 text-sm ${
                usuariosAlLimite
                  ? "font-medium text-amber-700"
                  : "text-slate-500"
              }`}
            >
              {usuariosAlLimite
                ? "Has alcanzado el límite de usuarios de tu plan."
                : `Puedes agregar ${
                    Number(
                      suscripcion.max_users
                    ) -
                    Number(
                      suscripcion.current_users
                    )
                  } usuario(s) más.`}
            </p>
          </div>

          {/* PRODUCTOS */}

          <div className="rounded-3xl border bg-white p-7">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  Productos
                </p>

                <p className="mt-2 text-3xl font-bold text-slate-900">
                  {suscripcion.current_products}
                  <span className="text-lg font-medium text-slate-400">
                    {" "}
                    / {suscripcion.max_products}
                  </span>
                </p>
              </div>

              <p className="text-sm font-semibold text-slate-500">
                {porcentajeProductos}%
              </p>
            </div>

            <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className={
                  productosAlLimite
                    ? "h-full rounded-full bg-amber-500 transition-all"
                    : "h-full rounded-full bg-green-600 transition-all"
                }
                style={{
                  width: `${porcentajeProductos}%`,
                }}
              />
            </div>

            <p
              className={`mt-4 text-sm ${
                productosAlLimite
                  ? "font-medium text-amber-700"
                  : "text-slate-500"
              }`}
            >
              {productosAlLimite
                ? "Has alcanzado el límite de productos de tu plan."
                : `Puedes agregar ${
                    Number(
                      suscripcion.max_products
                    ) -
                    Number(
                      suscripcion.current_products
                    )
                  } producto(s) más.`}
            </p>
          </div>
        </div>

        {/* CAMBIAR DE PLAN */}

<div className="mt-6">
  <div className="mb-5">
    <h2 className="text-xl font-bold text-slate-900">
      ¿Necesitas más capacidad?
    </h2>

    <p className="mt-2 text-slate-500">
      Elige el plan que mejor se adapte a tu negocio.
    </p>
  </div>

  <div className="mb-5 flex gap-2">
    {(["monthly", "annual"] as const).map(value => (
      <button key={value} type="button" aria-pressed={interval === value}
        onClick={() => setInterval(value)}
        className={`rounded-xl border px-4 py-2 ${interval === value ? "bg-green-700 text-white" : "bg-white text-slate-700"}`}>
        {value === "monthly" ? "Mensual" : "Anual"}
      </button>
    ))}
  </div>
  <p className="mb-4 text-sm text-slate-500">{enabled ? "La suscripción se renueva con la periodicidad que elijas." : "La contratación de estas tarifas estará disponible próximamente."}</p>
  <div className="grid gap-5 md:grid-cols-3">
    {(Object.keys(PRICING) as CommercialPlan[]).map(key => {
      const offer = PRICING[key];
      return (
        <div key={key} className="rounded-3xl border border-slate-200 bg-white p-7">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{offer.name}</p>
          <div className="mt-3 text-4xl font-bold text-slate-900">
            {(offer[interval] / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 })}
          </div>
          <p className="mt-2 text-sm text-slate-500">MXN / {interval === "monthly" ? "mes" : "año"} · IVA incluido</p>
          <button type="button" disabled={!enabled || procesandoPlan !== null}
            onClick={() => void contratarPlan(key)}
            className="mt-7 w-full rounded-xl bg-green-700 px-5 py-3 text-white disabled:bg-slate-200 disabled:text-slate-600">
            {procesandoPlan === key ? "Abriendo Mercado Pago…" : enabled ? "Contratar " + offer.name : "Próximamente"}
          </button>
        </div>
      );
    })}
  </div>
</div>

      </div>
    </main>
  );
}