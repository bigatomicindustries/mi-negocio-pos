"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import MovementForm from "./MovementForm";
import { kinds, localDate, money, periodBounds, periods, summarize, type Kind, type Period, type Summary } from "./budget";
import "./budget.css";

const views = ["Inicio", "Metas", "Historial"] as const;

function PersonalBudget({ owner }: { owner: string }) {
  const [view, setView] = useState<typeof views[number]>("Inicio");
  const budgetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const navbar = document.querySelector("header");
    if (!navbar || !budgetRef.current) return;
    const budget = budgetRef.current;
    const updateOffset = () => budget.style.setProperty("--navbar-height", navbar.getBoundingClientRect().height + "px");
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(navbar);
    return () => observer.disconnect();
  }, []);

  const [day, setDay] = useState(() => localDate(new Date()).slice(0, 10));
  const [period, setPeriod] = useState<Period>("Mes");
  const [filter, setFilter] = useState<Kind | "Todos">("Todos");
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data: Summary | null } | null>(null);
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalNotice, setGoalNotice] = useState("");
  const key = [day, period, revision].join("/");
  const refresh = () => setRevision(n => n + 1);

  useEffect(() => {
    let active = true;
    async function read() {
      try {
        const { data, error } = await supabase.rpc("personal_budget_summary", periodBounds(day, period));
        if (active) setResult({ key, data: error ? null : data });
      } catch {
        if (active) setResult({ key, data: null });
      }
    }
    void read();
    return () => { active = false; };
  }, [key, day, period]);

  async function createGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (goalBusy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setGoalBusy(true);
    setGoalNotice("");
    try {
      const { error } = await supabase.from("personal_goals").insert({
        owner_id: owner, name: String(fields.get("name")).trim(), target: fields.get("target"),
      });
      if (error) throw error;
      form.reset();
      setGoalNotice("Meta creada. Puedes seleccionarla al registrar un ahorro.");
      refresh();
    } catch {
      setGoalNotice("No se pudo confirmar la creación de la meta.");
    } finally { setGoalBusy(false); }
  }

  const data = result?.key === key ? result.data : null;
  const totals = summarize(data?.entries ?? []);
  const history = data?.entries.filter(entry => filter === "Todos" || entry.kind === filter);
  const periodControls = (<><div className="choices">{periods.map(item => <button key={item} aria-pressed={item === period} onClick={() => setPeriod(item)}>{item}</button>)}</div>
            <label>Fecha de referencia<input type="date" value={day} onChange={e => { if (e.target.value && e.target.validity.valid) setDay(e.target.value); }} /></label></>);
  const loadStatus = result?.key === key
    ? <p role="alert">No se pudo cargar tu presupuesto. <button onClick={refresh}>Reintentar</button></p>
    : <p role="status">Cargando presupuesto…</p>;
  return <main ref={budgetRef} className="budget">
    <div className="budget-heading">
      <div><h1>Mi Presupuesto</h1><p className="subtitle">Finanzas personales · MXN</p></div>
      <nav className="choices budget-nav" aria-label="Secciones de Mi Presupuesto">
        {views.map(item => <button type="button" key={item} aria-pressed={item === view} onClick={() => {
          setView(item);
          window.scrollTo({ top: 0, behavior: "instant" });
        }}>{item.toUpperCase()}</button>)}
      </nav>
    </div>
    <div className="layout" hidden={view !== "Inicio"}>
      <aside><MovementForm owner={owner} goals={result?.data?.goals ?? []} onSave={refresh} /></aside>
        <section className="panel"><h2>Resumen del periodo</h2>
          <div className="filters">{periodControls}</div>
          {data ? <>
            <div className="metrics">{[["Ingresos", totals.income], ["Gastos", totals.expense], ["Ahorro apartado", totals.savings], ["Disponible del periodo", totals.available]].map(([label, value]) =>
              <div key={label}><small>{label}</small><strong>{money(Number(value))}</strong></div>)}</div>
            <h3>¿En qué estoy gastando?</h3>
            {totals.ranking.length ? totals.ranking.map(item => <div className="category" key={item.name}>
              <div className="row"><span>{item.name}</span><span>{money(item.amount)} · {item.percent.toFixed(1)}%</span></div>
              <progress aria-label={item.name} max={100} value={item.percent} />
            </div>) : <p>Aún no hay gastos en este periodo.</p>}
          </> : loadStatus}
        </section>
    </div>
    <section className="panel" hidden={view !== "Metas"}><h2>Mis metas de ahorro</h2>
          {!data && loadStatus}
          {data && <><div className="row"><span>Ahorro general acumulado</span><strong>{money(data.general)}</strong></div>
          {data.goals.map(goal => <div className="category" key={goal.id}><div className="row"><b>{goal.name}</b><span>{money(goal.saved)} de {money(goal.target)}</span></div>
            <progress aria-label={goal.name} value={Math.min(goal.saved, goal.target)} max={goal.target} />
            <small>{goal.saved >= goal.target ? "Meta alcanzada" : "Faltan " + money(goal.target - goal.saved)}</small></div>)}</>}
          <details><summary>Crear meta de ahorro</summary><form onSubmit={createGoal}>
            <label>Nombre de la meta<input name="name" required maxLength={80} pattern=".*\S.*" placeholder="Vacaciones" /></label>
            <label>Importe objetivo (MXN)<input type="number" name="target" required step="0.01" min="0.01" max="999999999999.99" inputMode="decimal" /></label>
            <button className="primary" disabled={goalBusy}>{goalBusy ? "Guardando…" : "Crear meta"}</button></form></details><p role="status">{goalNotice}</p>
        </section>
    <section className="panel" hidden={view !== "Historial"}><h2>Historial de movimientos</h2>
          <div className="history-filters">
            <div className="choices">{(["Todos", ...kinds] as const).map(item => <button key={item} aria-pressed={item === filter} onClick={() => setFilter(item)}>{item}</button>)}</div>
            {periodControls}
          </div>
          {!data && loadStatus}
          {history?.length === 0 && <p>Sin movimientos para este filtro.</p>}
          {history?.map(entry => <div className="row entry" key={entry.id}><div><b>{entry.concept || (entry.kind === "Gasto" ? entry.category : entry.kind)}</b>
            <small>{entry.kind} · {entry.kind === "Ahorro" ? data?.goals.find(g => g.id === entry.goal_id)?.name || "Ahorro general" : entry.category} · {entry.method}</small>
            <small>{new Date(entry.occurred_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</small></div>
            <strong data-kind={entry.kind}>{entry.kind === "Gasto" ? "−" : "+"}{money(entry.amount)}</strong></div>)}</section>
  </main>;
}

export default function BudgetPage() {
  const { user } = useAuth();
  return user ? <PersonalBudget key={user.id} owner={user.id} /> : null;
}
