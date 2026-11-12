"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";

type NegocioPlataforma = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  created_at: string;
};

export default function SuperAdminPage() {
  const router = useRouter();

  const {
    cargando: cargandoAuth,
    esPlatformAdmin,
  } = useAuth();

  const [negocios, setNegocios] = useState<
    NegocioPlataforma[]
  >([]);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [actualizando, setActualizando] =
  useState<string | null>(null);

useEffect(() => {
  if (cargandoAuth) return;

  if (!esPlatformAdmin) {
    router.replace("/");
    return;
  }

  async function cargarNegocios() {
      try {
        setCargando(true);
        setError("");

        const {
          data,
          error: rpcError,
        } = await supabase.rpc(
          "get_platform_businesses"
        );

        if (rpcError) {
          throw rpcError;
        }

        setNegocios(
          (data as NegocioPlataforma[]) ?? []
        );
      } catch (error: any) {
console.error(
  "Error cambiando estado:",
  error
);

        setError(
          error?.message ||
            "No se pudieron cargar los negocios."
        );
      } finally {
        setCargando(false);
      }
    }

    cargarNegocios();
}, [
  cargandoAuth,
  esPlatformAdmin,
  router,
]);

  async function cambiarEstado(
  negocio: NegocioPlataforma
) {
  const accion = negocio.active
    ? "suspender"
    : "reactivar";

  const confirmado = window.confirm(
    `¿Seguro que quieres ${accion} "${negocio.name}"?`
  );

  if (!confirmado) return;

  try {
    setActualizando(negocio.id);
    setError("");

    const { error: rpcError } =
      await supabase.rpc(
        "set_business_active",
        {
          target_business_id: negocio.id,
          new_active: !negocio.active,
        }
      );

    if (rpcError) {
      throw rpcError;
    }

    setNegocios((actuales) =>
      actuales.map((item) =>
        item.id === negocio.id
          ? {
              ...item,
              active: !item.active,
            }
          : item
      )
    );
  } catch (error: any) {
    console.error(
      "Error cambiando estado:",
      error
    );

    setError(
      error?.message ||
        "No se pudo cambiar el estado del negocio."
    );
  } finally {
    setActualizando(null);
  }
}

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-6xl">
        {esPlatformAdmin && <div className="mb-6 flex justify-end">
          <Link href="/superadmin/prospectos" className="rounded-xl bg-green-700 px-5 py-3 text-sm font-semibold text-white hover:bg-green-800">Prospectos · CRM →</Link>
        </div>}

        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-green-600">
            Administración SaaS
          </p>

          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            Negocios
          </h1>

          <p className="mt-2 text-slate-500">
            Administra los negocios registrados en la
            plataforma.
          </p>
        </div>

        {cargando && (
          <div className="mt-10 rounded-2xl border bg-white p-6">
            <p className="text-slate-500">
              Cargando negocios...
            </p>
          </div>
        )}

        {error && (
          <div className="mt-10 rounded-2xl border border-red-200 bg-red-50 p-6">
            <p className="font-semibold text-red-700">
              Acceso no disponible
            </p>

            <p className="mt-1 text-sm text-red-600">
              {error}
            </p>
          </div>
        )}

        {!cargando && !error && (
          <>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border bg-white p-6">
                <p className="text-sm text-slate-500">
                  Negocios
                </p>

                <p className="mt-2 text-3xl font-bold text-slate-900">
                  {negocios.length}
                </p>
              </div>

              <div className="rounded-2xl border bg-white p-6">
                <p className="text-sm text-slate-500">
                  Activos
                </p>

                <p className="mt-2 text-3xl font-bold text-green-600">
                  {
                    negocios.filter(
                      (negocio) => negocio.active
                    ).length
                  }
                </p>
              </div>

              <div className="rounded-2xl border bg-white p-6">
                <p className="text-sm text-slate-500">
                  Suspendidos
                </p>

                <p className="mt-2 text-3xl font-bold text-amber-600">
                  {
                    negocios.filter(
                      (negocio) => !negocio.active
                    ).length
                  }
                </p>
              </div>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border bg-white">
              <div className="border-b px-6 py-5">
                <h2 className="font-bold text-slate-900">
                  Negocios registrados
                </h2>
              </div>

              {negocios.length === 0 ? (
                <div className="px-6 py-12 text-center text-slate-500">
                  No hay negocios registrados.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-6 py-4">
                          Negocio
                        </th>

                        <th className="px-6 py-4">
                          Slug
                        </th>

                        <th className="px-6 py-4">
                          Estado
                        </th>

                        <th className="px-6 py-4">
                          Registro
                        </th>

                        <th className="px-6 py-4 text-right">
  Acciones
</th>

                      </tr>
                    </thead>

                    <tbody>
                      {negocios.map((negocio) => (
                        <tr
                          key={negocio.id}
                          className="border-t"
                        >
                          <td className="px-6 py-4">
                            <p className="font-semibold text-slate-900">
                              {negocio.name}
                            </p>

                            <p className="mt-1 text-xs text-slate-400">
                              {negocio.id}
                            </p>
                          </td>

                          <td className="px-6 py-4 text-sm text-slate-600">
                            {negocio.slug}
                          </td>

                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                                negocio.active
                                  ? "bg-green-50 text-green-700"
                                  : "bg-amber-50 text-amber-700"
                              }`}
                            >
                              {negocio.active
                                ? "Activo"
                                : "Suspendido"}
                            </span>
                          </td>

<td className="px-6 py-4 text-sm text-slate-500">
  {new Date(
    negocio.created_at
  ).toLocaleDateString(
    "es-MX"
  )}
</td>

<td className="px-6 py-4">
  <div className="flex justify-end gap-2">
    <Link
      href={`/superadmin/negocios/${negocio.id}`}
      className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
    >
      Ver
    </Link>

    <button
      type="button"
      onClick={() =>
        cambiarEstado(negocio)
      }
      disabled={
        actualizando === negocio.id
      }
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        negocio.active
          ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
          : "bg-green-50 text-green-700 hover:bg-green-100"
      }`}
    >
      {actualizando === negocio.id
        ? "Guardando..."
        : negocio.active
          ? "Suspender"
          : "Reactivar"}
    </button>
  </div>
</td>

                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}