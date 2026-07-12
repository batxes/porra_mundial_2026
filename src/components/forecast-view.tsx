"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Card, PlayerAvatar, RankNumber, SectionHeading, TeamFlag } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { playersById, teamsById } from "@/lib/data";
import { buildAlivePlayoffTeamIds } from "@/lib/playoff-teams";
import { calculatePorraForecast, type ForecastScenario, type ProvisionalElectionHit } from "@/lib/porra-forecast";

type ScenarioKey = keyof ForecastScenario;
const fields: Array<{ key: ScenarioKey; label: string; kind: "team" | "player" }> = [
  { key: "worldChampion", label: "Campeón", kind: "team" },
  { key: "highestScoringTeam", label: "Equipo más goleador", kind: "team" },
  { key: "mostConcededTeam", label: "Equipo más goleado", kind: "team" },
  { key: "mostRedsTeam", label: "Equipo con más rojas", kind: "team" },
  { key: "topScorer", label: "Máximo goleador", kind: "player" },
  { key: "mvp", label: "MVP del Mundial", kind: "player" },
];

function percentage(value: number) {
  if (value > 0 && value < 0.1) return "<0,1 %";
  return `${value.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

export function ForecastView() {
  const { leaderboard, adminResults, ready } = useAppContext();
  const [draft, setDraft] = useState<ForecastScenario>({});
  const [scenario, setScenario] = useState<ForecastScenario>({});
  const [busyAction, setBusyAction] = useState<"apply" | "clear" | null>(null);
  const actionTimer = useRef<number | null>(null);
  const visible = useMemo(() => leaderboard.filter((profile) => !profile.isHidden && profile.prediction), [leaderboard]);
  const activeScenario = Object.values(scenario).filter(Boolean).length > 0;
  const forecast = useMemo(
    () => ready && visible.length ? calculatePorraForecast(visible, adminResults, scenario) : null,
    [adminResults, ready, scenario, visible],
  );
  const shownProfiles = useMemo(() => {
    const rows = visible.slice();
    if (forecast) rows.sort((a, b) => {
      const aRow = forecast.rows.get(a.id); const bRow = forecast.rows.get(b.id);
      const aBonus = activeScenario ? aRow?.scenarioElectionPoints || 0 : aRow?.provisionalElectionPoints || 0;
      const bBonus = activeScenario ? bRow?.scenarioElectionPoints || 0 : bRow?.provisionalElectionPoints || 0;
      return (b.points + bBonus) - (a.points + aBonus) || b.points - a.points || a.name.localeCompare(b.name);
    });
    return rows.slice(0, 5);
  }, [activeScenario, forecast, visible]);

  const optionIds = useMemo(() => {
    const result = Object.fromEntries(fields.map((field) => [field.key, new Set<string>()])) as Record<ScenarioKey, Set<string>>;
    visible.forEach((profile) => fields.forEach((field) => {
      const value = profile.prediction?.extras?.[field.key];
      if (value) result[field.key].add(value);
    }));
    const alive = buildAlivePlayoffTeamIds(adminResults);
    if (alive.size) result.worldChampion = new Set([...result.worldChampion].filter((id) => alive.has(id)));
    return result;
  }, [adminResults, visible]);

  useEffect(() => () => { if (actionTimer.current !== null) window.clearTimeout(actionTimer.current); }, []);
  const runScenarioAction = (action: "apply" | "clear", next: ForecastScenario) => {
    if (busyAction) return;
    setBusyAction(action);
    if (action === "clear") setDraft({});
    actionTimer.current = window.setTimeout(() => {
      setScenario(next);
      actionTimer.current = window.setTimeout(() => { setBusyAction(null); actionTimer.current = null; }, 350);
    }, 60);
  };
  const resetScenario = () => runScenarioAction("clear", {});

  return (
    <div className="space-y-6">
      <SectionHeading eyebrow="Simulación informativa" title="¿Quién ganará la porra?" description="Probabilidad estimada para el top 5 y escenarios personalizados con las elecciones finales." />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label={activeScenario ? "Modo" : "Modelo"} value={activeScenario ? "Escenario" : "Proyección actual"} compact />
        <Metric label="Simulaciones" value={forecast ? forecast.simulations.toLocaleString("es-ES") : "—"} />
        <Metric label="Partidos pendientes" value={forecast ? String(forecast.pendingMatches) : "—"} />
      </div>

      <Card className="space-y-5 border-cyan-400/15 bg-cyan-400/[0.025]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">Laboratorio de escenarios</p><h2 className="mt-1 text-xl font-bold text-white">Construye un final alternativo</h2><p className="mt-1 text-sm text-zinc-400">Este panel no describe la situación actual. Fija resultados hipotéticos y compara cómo cambiaría la porra.</p></div>
          <span className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-1 text-xs font-bold text-cyan-200">Zona interactiva</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((field) => <ScenarioPicker key={field.key} label={field.label} kind={field.kind} value={draft[field.key] || ""} options={[...optionIds[field.key]]} onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value || undefined }))} />)}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => runScenarioAction("apply", { ...draft })} disabled={Boolean(busyAction)} className="inline-flex min-w-44 items-center justify-center gap-2 rounded-xl bg-[#a7f600] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#baff2f] disabled:cursor-wait disabled:opacity-70">{busyAction === "apply" ? <><LoadingSpinner /> Recalculando…</> : "Aplicar y recalcular"}</button>
          <button type="button" onClick={resetScenario} disabled={Boolean(busyAction) || (!activeScenario && !Object.values(draft).some(Boolean))} className="inline-flex min-w-40 items-center justify-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 text-sm font-bold text-zinc-300 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40">{busyAction === "clear" ? <><LoadingSpinner /> Limpiando…</> : "Limpiar escenario"}</button>
        </div>
      </Card>

      {activeScenario ? <ActiveScenario scenario={scenario} onClear={resetScenario} clearing={busyAction === "clear"} /> : null}

      <Card className="overflow-hidden p-0">
        <div className={`border-b px-5 py-4 ${activeScenario ? "border-[#a7f600]/15 bg-[#a7f600]/[0.035]" : "border-white/10"}`}><p className={`text-xs font-bold uppercase tracking-[0.15em] ${activeScenario ? "text-[#a7f600]" : "text-zinc-500"}`}>{activeScenario ? "Resultado condicionado" : "Situación real"}</p><p className="mt-0.5 text-base font-bold text-white">{activeScenario ? "Top 5 si se cumplen tus elecciones" : "Top 5 y elecciones que lideran hoy"}</p></div>
        <div className="hidden grid-cols-[52px_minmax(150px,1fr)_90px_120px_minmax(170px,1fr)_110px] gap-3 border-b border-white/10 px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500 md:grid"><span>Pos.</span><span>Participante</span><span className="text-right">Actual</span><span className="text-right">Total con elecciones</span><span className="text-right">{activeScenario ? "Bonus del escenario" : "Elecciones hoy"}</span><span className="text-right">Victoria</span></div>
        {!ready || !forecast ? <div className="p-8 text-center text-sm text-zinc-400">Calculando escenarios…</div> : shownProfiles.map((profile, index) => {
          const row = forecast.rows.get(profile.id); if (!row) return null;
          return <div key={profile.id} className="grid gap-3 border-b border-white/[0.07] px-4 py-4 last:border-0 md:grid-cols-[52px_minmax(150px,1fr)_90px_120px_minmax(170px,1fr)_110px] md:items-center md:px-5">
            <div className="hidden md:block"><RankNumber position={index + 1} /></div>
            <div className="flex min-w-0 items-center gap-3"><span className="md:hidden"><RankNumber position={index + 1} /></span><Avatar name={profile.name} avatarUrl={profile.avatarUrl} className="size-10" /><div className="min-w-0"><p className="truncate font-semibold text-white">{profile.name}</p></div></div>
            <Cell label="Puntos actuales" value={`${profile.points} pts`} /><ElectionTotalCell current={profile.points} bonus={activeScenario ? row.scenarioElectionPoints : row.provisionalElectionPoints} /><ElectionCell label={activeScenario ? "Bonus del escenario" : "Elecciones hoy"} points={activeScenario ? row.scenarioElectionPoints : row.provisionalElectionPoints} hits={activeScenario ? row.scenarioElectionHits : row.provisionalElectionHits} />
            <div className="space-y-1 text-right"><p className="text-xs text-zinc-500 md:hidden">Victoria</p><p className="text-lg font-bold text-[#a7f600]">{percentage(row.winProbability)}</p><div className="ml-auto h-1.5 max-w-24 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#a7f600]" style={{ width: `${Math.min(100, row.winProbability)}%` }} /></div></div>
          </div>;
        })}
      </Card>

      <Card className="space-y-3 border-cyan-400/15 bg-cyan-400/[0.05]"><p className="font-semibold text-cyan-100">Cómo leer esta estimación</p><p className="text-sm leading-6 text-zinc-400">Se generan 20.000 finales coherentes partiendo de las estadísticas reales. Cada escenario recalcula campeón, equipos más goleador y goleado, rojas, máximo goleador, MVP y puntos futuros del once. Las elecciones fijadas en el panel se cumplen en el 100 % de las simulaciones.</p><p className="text-xs leading-5 text-zinc-500">La proyección pública solo utiliza información visible: el once y “Tus elecciones”. Los marcadores privados y el estratega de otros participantes no se consultan ni intervienen en el cálculo. Esta página no guarda datos ni modifica la clasificación oficial.</p></Card>
    </div>
  );
}

function optionName(id: string, kind: "team" | "player") { return kind === "team" ? teamsById.get(id)?.name || id : playersById.get(id)?.name || id; }
function ActiveScenario({ scenario, onClear, clearing }: { scenario: ForecastScenario; onClear: () => void; clearing: boolean }) {
  const selected = fields.filter((field) => scenario[field.key]);
  return <section className="overflow-hidden rounded-2xl border border-[#a7f600]/25 bg-[linear-gradient(135deg,rgba(167,246,0,0.09),rgba(167,246,0,0.025))]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#a7f600]/15 px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#a7f600]">Escenario activo</p><h2 className="mt-0.5 text-lg font-bold text-white">La clasificación se calcula con este final</h2></div><button type="button" onClick={onClear} disabled={clearing} className="inline-flex min-w-52 items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:bg-white/[0.07] disabled:cursor-wait disabled:opacity-60">{clearing ? <><LoadingSpinner /> Volviendo…</> : "Volver a la proyección actual"}</button></div><div className="grid gap-px bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-3">{selected.map((field) => { const id = scenario[field.key]!; return <div key={field.key} className="flex items-center gap-3 bg-[#11150f] px-4 py-3"><ScenarioIcon id={id} kind={field.kind} /><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">{field.label}</p><p className="truncate text-sm font-bold text-white">{id === "__nobody__" ? "Nadie acierta" : optionName(id, field.kind)}</p></div></div>; })}</div></section>;
}
function LoadingSpinner() { return <span aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" />; }
function normalizeSearch(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function ScenarioPicker({ label, kind, value, options, onChange, allowNobody = true }: { label: string; kind: "team" | "player"; value: string; options: string[]; onChange: (value: string) => void; allowNobody?: boolean }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const rootRef = useRef<HTMLDivElement>(null); const inputRef = useRef<HTMLInputElement>(null);
  const sorted = useMemo(() => options.slice().sort((a, b) => optionName(a, kind).localeCompare(optionName(b, kind))), [kind, options]);
  const filtered = useMemo(() => { const needle = normalizeSearch(query.trim()); return needle ? sorted.filter((id) => normalizeSearch(optionName(id, kind)).includes(needle)) : sorted; }, [kind, query, sorted]);
  useEffect(() => { if (!open) return; const frame = requestAnimationFrame(() => inputRef.current?.focus()); const close = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false); }; const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); }; document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape); return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); }; }, [open]);
  const choose = (id: string) => { onChange(id); setOpen(false); setQuery(""); };
  return <div ref={rootRef} className="relative space-y-1.5"><p className="text-sm font-semibold text-zinc-300">{label}</p><button type="button" aria-expanded={open} onClick={() => { setOpen((current) => !current); setQuery(""); }} className={`flex h-14 w-full items-center gap-3 rounded-xl border px-3 text-left transition ${open ? "border-[#a7f600]/50 bg-[#171b1f] ring-2 ring-[#a7f600]/10" : "border-white/10 bg-[#111419] hover:border-white/20 hover:bg-[#15191e]"}`}><ScenarioIcon id={value} kind={kind} /><span className="min-w-0 flex-1"><span className={`block truncate text-sm font-bold ${value ? "text-white" : "text-zinc-500"}`}>{value === "__nobody__" ? "Otro / nadie acierta" : value ? optionName(value, kind) : "Dejar abierto"}</span><span className="block truncate text-[10px] text-zinc-500">{value ? "Resultado fijado" : "Se resolverá en la simulación"}</span></span><svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 text-zinc-500 transition ${open ? "rotate-180" : ""}`} fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" /></svg></button>
    {open ? <div className="absolute z-50 mt-2 w-full min-w-[260px] overflow-hidden rounded-2xl border border-white/10 bg-[#111419] p-2 shadow-2xl shadow-black/70"><div className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === "team" ? "Buscar selección" : "Buscar jugador"} className="h-10 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600" /></div><div className="team-picker-scroll max-h-64 space-y-1 overflow-y-auto pr-1"><PickerOption id="" kind={kind} active={!value} label="Dejar abierto" subtitle="Mantener la simulación" onClick={() => choose("")} />{filtered.map((id) => <PickerOption key={id} id={id} kind={kind} active={value === id} label={optionName(id, kind)} subtitle={kind === "player" ? teamsById.get(playersById.get(id)?.team || "")?.name : undefined} onClick={() => choose(id)} />)}{allowNobody && !query ? <PickerOption id="__nobody__" kind={kind} active={value === "__nobody__"} label="Otro / nadie acierta" subtitle="0 puntos para todos" onClick={() => choose("__nobody__")} /> : null}{!filtered.length && query ? <p className="px-3 py-5 text-center text-sm text-zinc-500">Sin resultados</p> : null}</div></div> : null}
  </div>;
}
function ScenarioIcon({ id, kind }: { id: string; kind: "team" | "player" }) { if (!id || id === "__nobody__") return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-sm font-bold text-zinc-500">{id ? "?" : "…"}</span>; if (kind === "team") return <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]"><TeamFlag teamId={id} className="h-full w-full" /></span>; const player = playersById.get(id); return player ? <PlayerAvatar player={player} className="h-9 w-9" /> : null; }
function PickerOption({ id, kind, active, label, subtitle, onClick }: { id: string; kind: "team" | "player"; active: boolean; label: string; subtitle?: string; onClick: () => void }) { return <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${active ? "bg-[#a7f600]/10" : "hover:bg-white/[0.06]"}`}><ScenarioIcon id={id} kind={kind} /><span className="min-w-0 flex-1"><span className={`block truncate text-sm font-bold ${active ? "text-[#a7f600]" : "text-zinc-200"}`}>{label}</span>{subtitle ? <span className="block truncate text-[10px] text-zinc-500">{subtitle}</span> : null}</span>{active ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#a7f600] text-xs font-bold text-black">✓</span> : null}</button>; }
const hitLabels: Record<ProvisionalElectionHit["key"], string> = { worldChampion: "campeón", highestScoringTeam: "más goleador", mostConcededTeam: "más goleado", mostRedsTeam: "más rojas", topScorer: "goleador", mvp: "MVP" };
function ElectionCell({ label, points, hits }: { label: string; points: number; hits: ProvisionalElectionHit[] }) {
  return <div className="flex items-start justify-between gap-3 md:block md:text-right"><p className="text-xs text-zinc-500 md:hidden">{label}</p><div><p className="font-bold text-[#a7f600]">+{points}</p>{hits.length ? <div className="mt-1 flex max-w-full flex-wrap justify-end gap-1">{hits.map((hit) => { const player = hit.key === "topScorer" || hit.key === "mvp"; const name = optionName(hit.id, player ? "player" : "team"); return <span key={`${hit.key}-${hit.id}`} title={`${name} · ${hitLabels[hit.key]} · +${hit.points} puntos`} className="max-w-full truncate rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">{name} · {hitLabels[hit.key]}</span>; })}</div> : <p className="mt-1 text-[10px] text-zinc-600">Sin aciertos fijados</p>}</div></div>;
}
function Metric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) { return <Card className="p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p><p className={`mt-2 font-bold text-white ${compact ? "text-xl" : "text-2xl"}`}>{value}</p></Card>; }
function ElectionTotalCell({ current, bonus }: { current: number; bonus: number }) { return <div className="flex items-center justify-between gap-3 md:block md:text-right"><p className="text-xs text-zinc-500 md:hidden">Total con elecciones</p><div><p className="text-lg font-bold tabular-nums text-white">{current + bonus} pts</p><p className="text-[10px] font-semibold text-[#a7f600]">+{bonus} en elecciones</p></div></div>; }
function Cell({ label, value, lime = false }: { label: string; value: string; lime?: boolean }) { return <div className="flex items-center justify-between gap-3 md:block md:text-right"><p className="text-xs text-zinc-500 md:hidden">{label}</p><p className={`font-bold ${lime ? "text-[#a7f600]" : "text-zinc-200"}`}>{value}</p></div>; }


