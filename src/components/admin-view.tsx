"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useState } from "react";

import { Card, EmptyState, Notice, SectionHeading, TeamBadge, TeamPicker } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { data, schedule, teamsById } from "@/lib/data";
import type { ProviderSummary } from "@/lib/types";

export function AdminView() {
  const {
    adminResults,
    addAdminEvent,
    clearAdminResults,
    deleteAdminEvent,
    leaderboard,
    playerName,
    saveAdminResult,
    teamName,
    user,
    usingSupabase,
  } = useAppContext();
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [providerSummary, setProviderSummary] = useState<ProviderSummary | null>(null);
  const [adminMessage, setAdminMessage] = useState("");
  const [homeTeamId, setHomeTeamId] = useState("");
  const [awayTeamId, setAwayTeamId] = useState("");

  if (!user?.isAdmin) {
    return (
      <EmptyState
        icon="26"
        title="Zona reservada"
        description="Este panel solo está disponible para el administrador de la porra."
      />
    );
  }

  const loadProvider = async () => {
    setProviderBusy(true);
    setProviderError("");
    try {
      const response = await fetch("/api/provider/world-cup", { cache: "no-store" });
      const payload = (await response.json()) as ProviderSummary & { error?: string };
      if (!response.ok) {
        setProviderError(payload.error || "No se ha podido consultar la API.");
        return;
      }
      setProviderSummary(payload);
    } finally {
      setProviderBusy(false);
    }
  };

  const submitResult = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const matchNumber = String(form.get("matchNumber") || "");
    await saveAdminResult(matchNumber, {
      homeScore: String(form.get("homeScore") || ""),
      awayScore: String(form.get("awayScore") || ""),
      homeTeamId,
      awayTeamId,
      events: adminResults[matchNumber]?.events || [],
      source: "manual",
    });
    setAdminMessage(`Resultado del partido ${matchNumber} guardado.`);
  };

  const submitEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const matchNumber = String(form.get("matchNumber") || "");
    const playerId = String(form.get("playerId") || "");
    await addAdminEvent(matchNumber, {
      id: crypto.randomUUID(),
      playerId,
      teamId: teamsById.get(playersTeam(playerId)) ? playersTeam(playerId) : undefined,
      type: String(form.get("type") || ""),
      minute: Number(form.get("minute") || 0),
      source: "manual",
    });
    setAdminMessage(`Evento añadido al partido ${matchNumber}.`);
  };

  const savedEntries = Object.entries(adminResults).sort((a, b) => Number(a[0]) - Number(b[0]));

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Zona privada"
        title="Administración"
        description="Publica resultados, añade eventos y consulta la API externa desde servidor. La clave nunca toca el navegador."
      />

      <Notice>{usingSupabase ? "Modo Supabase activo." : "Modo demo local activo."}</Notice>
      {adminMessage ? <Notice>{adminMessage}</Notice> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-white">Proveedor externo</h3>
              <p className="text-sm text-slate-400">API-Football vía ruta server-side.</p>
            </div>
            <button
              type="button"
              onClick={() => void loadProvider()}
              disabled={providerBusy}
              className="w-full rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60 sm:w-auto"
            >
              {providerBusy ? "Cargando…" : "Consultar API"}
            </button>
          </div>

          {providerError ? <Notice tone="danger">{providerError}</Notice> : null}

          {providerSummary ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <ProviderFlag label="Eventos" active={Boolean(providerSummary.coverage?.fixtures.events)} />
                <ProviderFlag label="Lineups" active={Boolean(providerSummary.coverage?.fixtures.lineups)} />
                <ProviderFlag label="Stats de partido" active={Boolean(providerSummary.coverage?.fixtures.statistics_fixtures)} />
                <ProviderFlag label="Stats de jugador" active={Boolean(providerSummary.coverage?.fixtures.statistics_players)} />
                <ProviderFlag label="Top scorers" active={Boolean(providerSummary.coverage?.top_scorers)} />
                <ProviderFlag label="Top cards" active={Boolean(providerSummary.coverage?.top_cards)} />
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-white">Últimos fixtures</h4>
                <div className="space-y-2">
                  {providerSummary.fixtures.slice(0, 8).map((fixture: any) => (
                    <div key={fixture.fixture.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                      <p className="font-medium text-white">
                        {fixture.teams.home.name} {fixture.goals.home ?? "-"} · {fixture.goals.away ?? "-"} {fixture.teams.away.name}
                      </p>
                      <p className="text-slate-400">
                        {fixture.league.round} · {fixture.fixture.status.short}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <ProviderList
                  title="Top goleadores"
                  items={providerSummary.topScorers.slice(0, 5).map((item: any) => `${item.player?.name || "Jugador"} · ${item.statistics?.[0]?.goals?.total ?? 0}`)}
                />
                <ProviderList
                  title="Top tarjetas"
                  items={providerSummary.topCards.slice(0, 5).map((item: any) => `${item.player?.name || "Jugador"} · ${item.statistics?.[0]?.cards?.yellow ?? 0}A / ${item.statistics?.[0]?.cards?.red ?? 0}R`)}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Pulsa “Consultar API” para cargar cobertura, resultados, goleadores y tarjetas.</p>
          )}
        </Card>

        <Card className="space-y-4">
          <h3 className="text-xl font-semibold text-white">Guardar o corregir resultado</h3>
          <form className="space-y-4" onSubmit={submitResult}>
            <label className="space-y-2 text-sm text-slate-300">
              <span>Partido</span>
              <select name="matchNumber" required className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white">
                {schedule.map((match) => (
                  <option key={match.number} value={match.number}>
                    Partido {match.number} · {match.home} vs {match.away} · {match.date}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <TeamPicker label="Equipo local real, opcional" value={homeTeamId} onChange={setHomeTeamId} placeholder="Según calendario" />
              <TeamPicker label="Equipo visitante real, opcional" value={awayTeamId} onChange={setAwayTeamId} placeholder="Según calendario" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FieldInput name="homeScore" label="Goles local" />
              <FieldInput name="awayScore" label="Goles visitante" />
            </div>
            <button type="submit" className="w-full rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 sm:w-auto">
              Guardar resultado y recalcular
            </button>
          </form>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="space-y-4">
          <h3 className="text-xl font-semibold text-white">Añadir evento</h3>
          <form className="space-y-4" onSubmit={submitEvent}>
            <label className="space-y-2 text-sm text-slate-300">
              <span>Partido</span>
              <select name="matchNumber" required className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white">
                {schedule.map((match) => (
                  <option key={match.number} value={match.number}>
                    Partido {match.number}
                  </option>
                ))}
              </select>
            </label>
            <FieldSelect
              name="playerId"
              label="Jugador"
              options={data.players.map((player) => ({ value: player.id, label: `${player.name} · ${teamName(player.team)}` }))}
            />
            <FieldSelect
              name="type"
              label="Tipo"
              options={[
                { value: "gol", label: "Gol" },
                { value: "penalti marcado", label: "Penalti marcado" },
                { value: "penalti fallado", label: "Penalti fallado" },
                { value: "penalti parado", label: "Penalti parado" },
                { value: "roja", label: "Tarjeta roja" },
                { value: "MVP", label: "MVP del partido" },
              ]}
            />
            <FieldInput name="minute" label="Minuto" />
            <button type="submit" className="w-full rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 sm:w-auto">
              Añadir evento
            </button>
          </form>
        </Card>

        <Card className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-xl font-semibold text-white">Puntuaciones recalculadas</h3>
            {savedEntries.length ? (
              <button
                type="button"
                onClick={() => void clearAdminResults()}
                className="w-full rounded-full border border-white/15 px-4 py-2 text-sm text-white sm:w-auto"
              >
                Vaciar demo
              </button>
            ) : null}
          </div>
          <div className="space-y-3">
            {leaderboard.length ? (
              leaderboard.map((profile) => (
                <div key={profile.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-3 text-sm">
                  <span className="min-w-0 truncate text-slate-200">{profile.name}</span>
                  <strong className="shrink-0 text-cyan-300">{profile.points} pts</strong>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">Aún no hay participantes.</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="space-y-4">
        <h3 className="text-xl font-semibold text-white">Partidos publicados</h3>
        {savedEntries.length ? (
          <div className="space-y-4">
            {savedEntries.map(([matchNumber, result]) => (
              <div key={matchNumber} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-white">
                      Partido {matchNumber} · {result.homeScore} - {result.awayScore}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
                      {result.homeTeamId ? <TeamBadge teamId={result.homeTeamId} /> : <span>Local</span>}
                      <span>vs</span>
                      {result.awayTeamId ? <TeamBadge teamId={result.awayTeamId} /> : <span>Visitante</span>}
                    </div>
                  </div>
                </div>
                {result.events?.length ? (
                  <div className="space-y-2">
                    {result.events.map((event) => (
                      <div key={event.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl bg-slate-950/40 px-4 py-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                        <span className="text-slate-400">{event.minute}&apos;</span>
                        <span className="min-w-0 text-slate-200">
                          {playerName(event.playerId)} · {event.type}
                        </span>
                        <button
                          type="button"
                          onClick={() => void deleteAdminEvent(matchNumber, event.id)}
                          className="col-span-2 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white sm:col-auto"
                        >
                          Eliminar
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Sin eventos publicados.</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Todavía no has publicado resultados.</p>
        )}
      </Card>
    </div>
  );
}

function FieldInput({ name, label }: { name: string; label: string }) {
  return (
    <label className="space-y-2 text-sm text-slate-300">
      <span>{label}</span>
      <input
        name={name}
        type="text"
        inputMode="numeric"
        pattern="\d+"
        required
        className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white"
      />
    </label>
  );
}

function FieldSelect({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="space-y-2 text-sm text-slate-300">
      <span>{label}</span>
      <select name={name} className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white">
        <option value="">Sin seleccionar</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProviderFlag({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${active ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/5 text-slate-300"}`}>
      {label}: {active ? "sí" : "no"}
    </div>
  );
}

function ProviderList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <h4 className="font-semibold text-white">{title}</h4>
      <div className="mt-3 space-y-2 text-sm text-slate-300">
        {items.length ? items.map((item) => <p key={item}>{item}</p>) : <p className="text-slate-400">Sin datos.</p>}
      </div>
    </div>
  );
}

function playersTeam(playerId: string) {
  return data.players.find((player) => player.id === playerId)?.team || "";
}
