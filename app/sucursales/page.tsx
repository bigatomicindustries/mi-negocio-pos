"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isBusinessPlan } from "@/lib/branch-plan";
import { useAuth } from "@/context/AuthContext";

type Suscripcion = {
  plan_name: string;
  plan_slug: string;
  status: string;
  max_branches: number;
  current_branches: number;
};

type SucursalAdmin = {
  id: string;
  name: string;
  code: string | null;
  is_main: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export default function SucursalesPage() {
  const router = useRouter();

const {
  perfil,
  cargando: cargandoAuth,
  cargandoSucursales,
} = useAuth();

  const [suscripcion, setSuscripcion] =
    useState<Suscripcion | null>(null);

    const [sucursalesAdmin, setSucursalesAdmin] =
  useState<SucursalAdmin[]>([]);

const [loading, setLoading] = useState(true);
const [error, setError] = useState("");

const [mostrarFormulario, setMostrarFormulario] =
  useState(false);

const [nombreSucursal, setNombreSucursal] =
  useState("");

const [codigoSucursal, setCodigoSucursal] =
  useState("");

const [creandoSucursal, setCreandoSucursal] =
  useState(false);

async function desactivarSucursal(
  branchId: string,
  branchName: string
) {
  const confirmar = window.confirm(
    `¿Desactivar "${branchName}"?\n\nLa sucursal dejará de estar disponible para operar, pero su historial se conservará.`
  );

  if (!confirmar) return;

  try {
    setError("");

    const { error } = await supabase.rpc(
      "deactivate_branch",
      {
        p_branch_id: branchId,
      }
    );

    if (error) {
      throw error;
    }

    window.alert(
      `"${branchName}" fue desactivada correctamente.`
    );

    window.location.reload();
  } catch (error: any) {
    console.error(
      "Error desactivando sucursal:",
      error
    );

    setError(
      error?.message ||
        "No se pudo desactivar la sucursal."
    );
  }
}

async function reactivarSucursal(
  branchId: string,
  branchName: string
) {
  const confirmar = window.confirm(
    `¿Reactivar "${branchName}"?\n\nLa sucursal volverá a estar disponible para operar.`
  );

  if (!confirmar) return;

  try {
    setError("");

    const { error } = await supabase.rpc(
      "reactivate_branch",
      {
        p_branch_id: branchId,
      }
    );

    if (error) {
      throw error;
    }

    window.alert(
      `"${branchName}" fue reactivada correctamente.`
    );

    window.location.reload();
  } catch (error: any) {
    console.error(
      "Error reactivando sucursal:",
      error
    );

    setError(
      error?.message ||
        "No se pudo reactivar la sucursal."
    );
  }
}

async function crearSucursal() {
  const nombre = nombreSucursal.trim();
  const codigo = codigoSucursal.trim();

  if (!nombre) {
    setError(
      "Escribe el nombre de la sucursal."
    );
    return;
  }

  try {
    setCreandoSucursal(true);
    setError("");

    const { error } = await supabase.rpc(
      "create_branch",
      {
        p_name: nombre,
        p_code: codigo || null,
      }
    );

    if (error) {
      throw error;
    }

    setNombreSucursal("");
    setCodigoSucursal("");
    setMostrarFormulario(false);

    window.location.reload();
  } catch (error: any) {
    console.error(
      "Error creando sucursal:",
      error
    );

    setError(
      error?.message ||
        "No se pudo crear la sucursal."
    );
  } finally {
    setCreandoSucursal(false);
  }
}

  useEffect(() => {
    if (cargandoAuth || cargandoSucursales) return;

    if (!perfil) return;

    if (perfil.role !== "admin") {
      router.replace("/");
      return;
    }

    async function cargarDatos() {
      try {
        setLoading(true);
        setError("");

const [
  {
    data: suscripcionData,
    error: suscripcionError,
  },
  {
    data: sucursalesData,
    error: sucursalesError,
  },
] = await Promise.all([
  supabase.rpc("get_my_subscription"),
  supabase.rpc("get_business_branches_admin"),
]);

if (suscripcionError) {
  throw suscripcionError;
}

if (sucursalesError) {
  throw sucursalesError;
}

if (
  !suscripcionData ||
  suscripcionData.length === 0
) {
  throw new Error(
    "No encontramos una suscripción para este negocio."
  );
}

if (!isBusinessPlan(suscripcionData[0].plan_slug)) {
  router.replace("/");
  return;
}
setSuscripcion(suscripcionData[0]);

setSucursalesAdmin(
  (sucursalesData ?? []) as SucursalAdmin[]
);

      } catch (error: any) {
        console.error(
          "Error cargando sucursales:",
          error
        );

        setError(
          error?.message ||
            "No se pudo cargar la información de sucursales."
        );
      } finally {
        setLoading(false);
      }
    }

    void cargarDatos();
  }, [
    perfil?.id,
    perfil?.role,
    cargandoAuth,
    cargandoSucursales,
    router,
  ]);

  if (
    cargandoAuth ||
    cargandoSucursales ||
    loading
  ) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <p className="text-slate-500">
            Cargando sucursales...
          </p>
        </div>
      </main>
    );
  }

  if (perfil?.role !== "admin" || !suscripcion) return error ? <p role="alert" className="p-6">{error}</p> : null;

  const maxSucursales =
    Number(suscripcion?.max_branches ?? 0);

  const sucursalesActuales =
    Number(suscripcion?.current_branches ?? 0);

  const puedeCrear =
    sucursalesActuales < maxSucursales;

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-green-600">
              Administración
            </p>

            <h1 className="mt-2 text-3xl font-bold text-slate-900">
              Sucursales
            </h1>

            <p className="mt-2 text-slate-500">
              Administra las ubicaciones de tu negocio.
            </p>
          </div>

          {suscripcion && (
            <div className="rounded-2xl border bg-white px-5 py-4">
              <p className="text-sm text-slate-500">
                Plan {suscripcion.plan_name}
              </p>

              <p className="mt-1 text-xl font-bold text-slate-900">
                {sucursalesActuales} de{" "}
                {maxSucursales} sucursales
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-8 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
            {error}
          </div>
        )}

        <div className="mt-8 space-y-4">
          {sucursalesAdmin.map((sucursal) => (
            <div
              key={sucursal.id}
              className="flex flex-col justify-between gap-4 rounded-2xl border bg-white p-6 sm:flex-row sm:items-center"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">
                    {sucursal.name}
                  </h2>

                  {sucursal.is_main && (
                    <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
                      Principal
                    </span>
                  )}
                </div>

                <p className="mt-2 text-sm text-slate-500">
                  Código:{" "}
                  {sucursal.code || "Sin código"}
                </p>
              </div>

<div className="flex items-center gap-3">
  <span
    className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
      sucursal.active
        ? "bg-green-50 text-green-700"
        : "bg-slate-100 text-slate-500"
    }`}
  >
    {sucursal.active
      ? "Activa"
      : "Inactiva"}
  </span>

{!sucursal.is_main && (
  <>
    {sucursal.active ? (
      <button
        type="button"
        onClick={() =>
          desactivarSucursal(
            sucursal.id,
            sucursal.name
          )
        }
        className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
      >
        Desactivar
      </button>
    ) : (
      <button
        type="button"
        disabled={!puedeCrear}
        onClick={() =>
          reactivarSucursal(
            sucursal.id,
            sucursal.name
          )
        }
        className="rounded-xl border border-green-200 px-4 py-2 text-sm font-semibold text-green-700 transition hover:bg-green-50 disabled:opacity-50"
      >
        Reactivar
      </button>
    )}
  </>
)}

</div>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <button
            type="button"
            onClick={() => setMostrarFormulario(true)}
            disabled={!puedeCrear}
            className={`rounded-xl px-5 py-3 font-semibold transition ${
              puedeCrear
                ? "bg-green-600 text-white hover:bg-green-700"
                : "cursor-not-allowed bg-slate-200 text-slate-500"
            }`}
          >
            + Nueva sucursal
          </button>

          {!puedeCrear && suscripcion && (
            <p className="mt-3 text-sm text-slate-500">
              Has alcanzado el límite de sucursales
              incluido en tu plan{" "}
              {suscripcion.plan_name}.
            </p>
          )}
        </div>

        {mostrarFormulario && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    onClick={() => {
      if (!creandoSucursal) {
        setMostrarFormulario(false);
      }
    }}
  >
    <div
      className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <h2 className="text-2xl font-bold text-slate-900">
        Nueva sucursal
      </h2>

      <p className="mt-2 text-sm text-slate-500">
        Crea una nueva ubicación para tu negocio.
      </p>

      <div className="mt-6">
        <label className="text-sm font-semibold text-slate-700">
          Nombre
        </label>

        <input
          type="text"
          value={nombreSucursal}
          onChange={(e) =>
            setNombreSucursal(e.target.value)
          }
          placeholder="Ej. Sucursal Centro"
          disabled={creandoSucursal}
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-green-500"
        />
      </div>

      <div className="mt-5">
        <label className="text-sm font-semibold text-slate-700">
          Código
        </label>

        <input
          type="text"
          value={codigoSucursal}
          onChange={(e) =>
            setCodigoSucursal(e.target.value)
          }
          placeholder="Ej. CENTRO"
          disabled={creandoSucursal}
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 uppercase text-slate-900 outline-none focus:border-green-500"
        />

        <p className="mt-2 text-xs text-slate-400">
          Opcional. Debe ser único dentro del negocio.
        </p>
      </div>

      <div className="mt-7 flex gap-3">
        <button
          type="button"
          onClick={() =>
            setMostrarFormulario(false)
          }
          disabled={creandoSucursal}
          className="flex-1 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancelar
        </button>

        <button
          type="button"
          onClick={crearSucursal}
          disabled={
            creandoSucursal ||
            !nombreSucursal.trim()
          }
          className="flex-1 rounded-xl bg-green-600 px-4 py-3 font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creandoSucursal
            ? "Creando..."
            : "Crear sucursal"}
        </button>
      </div>
    </div>
  </div>
)}

      </div>
    </main>
  );
}