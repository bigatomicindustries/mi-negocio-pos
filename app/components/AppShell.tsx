"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Navbar from "./Navbar";
import AuthGuard from "./AuthGuard";
import {
  AuthProvider,
  useAuth,
} from "@/context/AuthContext";

function ContenidoPrivado({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();

const {
  puedeOperar,
  negocioSuspendido,
  esPlatformAdmin,
  cargando,
  cerrandoSesion,
} = useAuth();

  const esRutaSuperAdmin =
    pathname.startsWith("/superadmin");

  const esRutaPlan =
    pathname === "/plan";

  // El CRM tiene su propia autorización por negocio y RLS.
  const esRutaCRM = pathname === "/crm" || pathname.startsWith("/crm/");

  // El Platform Admin puede administrar la
  // plataforma aunque su tenant esté suspendido.
  if (
    esRutaSuperAdmin &&
    esPlatformAdmin
  ) {
    return (
      <>
        <Navbar />
        {children}
      </>
    );
  }

  // No mostramos bloqueos falsos mientras
  // AuthContext está revalidando.
  if (!cargando && negocioSuspendido) {
    return (
      <>
        <Navbar />

        <main className="min-h-screen bg-slate-50 px-6 py-12">
          <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
            <h1 className="text-2xl font-bold text-slate-900">
              Tu negocio está suspendido
            </h1>

            <p className="mt-3 text-slate-600">
              Las funciones del POS están temporalmente
              bloqueadas.
            </p>
          </div>
        </main>
      </>
    );
  }

const mostrarBloqueoSuscripcion =
  !cargando &&
  !cerrandoSesion &&
  !puedeOperar &&
  !esRutaPlan &&
  !esRutaCRM;

return (
  <>
    <Navbar />

    <div className="relative">
      {children}

      {mostrarBloqueoSuscripcion && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-amber-200 bg-white p-8 shadow-2xl">
            <h1 className="text-2xl font-bold text-slate-900">
              Tu suscripción no permite operar
            </h1>

            <p className="mt-3 text-slate-600">
              Tu cuenta sigue disponible, pero las
              funciones operativas del POS están
              temporalmente bloqueadas.
            </p>

            <a
              href="/plan"
              className="mt-6 inline-flex rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white transition hover:bg-slate-800"
            >
              Ver planes
            </a>
          </div>
        </div>
      )}
    </div>
  </>
);
}

export default function AppShell({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();

  const esRutaPublica =
    pathname === "/login" ||
    pathname === "/registro";

  return (
    <AuthProvider>
      {esRutaPublica ? (
        children
      ) : (
<AuthGuard>
  <ContenidoPrivado>
    {children}
  </ContenidoPrivado>
</AuthGuard>
      )}
    </AuthProvider>
  );
}