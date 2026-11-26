"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

const Trial = createContext({ endsAt: "", days: 0 });
export const useBusinessTrial = () => useContext(Trial);

export function BusinessTrial({ children }: { children: ReactNode }) {
  const { user, perfil, negocio } = useAuth();
  const [endsAt, setEndsAt] = useState("");
  const [now, setNow] = useState(Date.now);
  const [welcome, setWelcome] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!user?.email_confirmed_at || !negocio?.id) return;
    let active = true;
    async function refresh() {
      const { data, error } = await supabase.rpc("my_trial_end");
      if (!active || error) return;
      setEndsAt(data || "");
      setNow(Date.now());
    }
    async function initialize() {
      await refresh();
      if (!active) return;
      const { data } = await supabase.rpc("claim_trial_welcome");
      if (active && data) setWelcome(true);
    }
    void initialize();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [negocio?.id, user?.email_confirmed_at, user?.id]);

  useEffect(() => { if (welcome) dialog.current?.showModal(); }, [welcome]);
  const days = endsAt ? Math.max(0, Math.min(30, Math.ceil((Date.parse(endsAt) - now) / 86400000))) : 0;
  const expired = endsAt && days === 0;
  return <Trial.Provider value={{ endsAt, days }}>
    {expired && <aside className="bg-amber-100 px-5 py-3 text-center text-amber-950">Tu prueba terminó. Puedes consultar y descargar tus datos. {perfil?.role === "admin" && <Link href="/plan" className="font-semibold underline">Contrata un plan para volver a operar.</Link>}</aside>}
    {children}
    {welcome && <dialog ref={dialog} onClose={() => setWelcome(false)} aria-labelledby="trial-title" className="fixed inset-0 m-auto w-[min(92vw,30rem)] overflow-hidden rounded-3xl bg-white p-8 text-center text-slate-900 backdrop:bg-slate-950/50">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">{Array.from({length:36}, (_,i) => <i key={i} className="trial-confetti" style={{left:(i*37%100)+"%", backgroundColor:["#168354","#e59c35","#56a5ce","#c46bb3"][i%4],animationDelay:(i%7)*0.06+"s"}} />)}</div>
      <button className="absolute right-4 top-2 text-2xl" aria-label="Cerrar bienvenida" onClick={() => dialog.current?.close()}>×</button>
      <div aria-hidden="true" className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-3xl text-emerald-700">✓</div>
      <p>¡Bienvenido a Mi Negocio!</p><h2 id="trial-title" className="my-3 text-3xl font-bold text-emerald-800">¡Tienes 30 días gratis!</h2>
      <p>Tu negocio está listo. Consulta la fecha de vencimiento de tu prueba en Plan y uso.</p>
      <button autoFocus onClick={() => dialog.current?.close()} className="mt-6 w-full rounded-xl bg-emerald-700 p-3 font-semibold text-white">Comenzar a explorar</button>
      <Link href="/plan" onClick={() => dialog.current?.close()} className="mt-4 inline-block font-semibold text-emerald-800">Conocer mi plan</Link>
    </dialog>}
  </Trial.Provider>;
}
