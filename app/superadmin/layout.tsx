"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";

const sections = [
  { href: "/superadmin/tablero", label: "CRM" },
  { href: "/superadmin/oportunidades", label: "Oportunidades" },
  { href: "/superadmin/prospectos", label: "Prospectos" },
  { href: "/superadmin/centro-trabajo", label: "Centro de trabajo" },
  { href: "/superadmin/contactos", label: "Contactos" },
];

export default function SuperadminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { esPlatformAdmin, cargando } = useAuth();
  const showNav = !cargando && esPlatformAdmin && sections.some(({ href }) => href === pathname);

  return (
    <>
      {showNav && (
        <div className="bg-slate-50 px-4 pt-8 sm:px-6">
          <nav aria-label="Navegación comercial" className="mx-auto flex max-w-7xl flex-col gap-3 text-sm font-semibold md:flex-row md:items-center md:justify-between">
            <Link href="/superadmin" className="text-slate-600 hover:text-emerald-700">← Administración</Link>
            <div className="flex flex-wrap justify-end gap-1 sm:gap-3">
              {sections.map(({ href, label }) => (
                <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}
                  className="whitespace-nowrap rounded-lg px-3 py-2 text-emerald-700 hover:bg-emerald-50 aria-[current=page]:bg-emerald-700 aria-[current=page]:text-white">
                  {label}
                </Link>
              ))}
            </div>
          </nav>
        </div>
      )}
      {children}
    </>
  );
}
