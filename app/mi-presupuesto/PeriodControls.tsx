import { periods, type Period } from "./budget";

const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const pad = (value: number) => String(value).padStart(2, "0");
const monthLength = (year: number, month: number) => new Date(year, month, 0).getDate();

export default function PeriodControls({ period, day, onPeriod, onDay }: {
  period: Period; day: string; onPeriod: (period: Period) => void; onDay: (day: string) => void;
}) {
  const [year, month, date] = day.split("-").map(Number);
  const chooseDay = period === "Día" || period === "Semana";
  const chooseMonth = period !== "Año";
  function change(y: number, m: number, d: number) {
    onDay([y, pad(m), pad(Math.min(d, monthLength(y, m)))].join("-"));
  }
  return <div className="period-controls">
    <div className="choices" role="group" aria-label="Periodo">{periods.map(item =>
      <button type="button" key={item} aria-pressed={item === period} onClick={() => onPeriod(item)}>{item}</button>)}</div>
    <div className="reference-parts" role="group" aria-label="Fecha de referencia">
      <label>Día<select disabled={!chooseDay} value={chooseDay ? date : ""} onChange={e => change(year, month, Number(e.target.value))}>
        {!chooseDay && <option value="">--</option>}
        {Array.from({ length: monthLength(year, month) }, (_, i) => <option value={i+1} key={i}>{pad(i+1)}</option>)}
      </select></label>
      <label>Mes<select disabled={!chooseMonth} value={chooseMonth ? month : ""} onChange={e => change(year, Number(e.target.value), date)}>
        {!chooseMonth && <option value="">--</option>}
        {months.map((name,i) => <option value={i+1} key={name}>{name}</option>)}
      </select></label>
      <label>Año<select value={year} onChange={e => change(Number(e.target.value), month, date)}>
        {Array.from({length:41}, (_,i) => year + 20 - i).filter(y => y >= 1000 && y <= 9998).map(y => <option key={y}>{y}</option>)}
      </select></label>
    </div>
  </div>;
}
