"use client";

import { useMemo, useState } from "react";

import { Card, Notice, ScoreBreakdown, SectionHeading, TeamBadge, TeamPicker } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { data, knockoutMatches, knockoutStages, schedule, sections, teamsById, xiLabels, xiLimits } from "@/lib/data";
import { formatScheduleDate, translateSlot } from "@/lib/format";
import { groupTeamAt, hasMatchStarted, isMatchPredictionComplete, isMatchVisibleForPrediction, orderedGroupTeams, resolveSlot, xiCounts } from "@/lib/prediction";

export function PredictionView() {
  const {
    chooseMatchWinner,
    completion,
    currentScorecard,
    moveGroupTeam,
    prediction,
    savePrediction,
    setPredictionExtra,
    setPredictionScore,
    toggleThirdQualifier,
    toggleXiPlayer,
    user,
  } = useAppContext();
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("groups");
  const [message, setMessage] = useState("");

  const visibleMatches = useMemo(() => schedule.filter((match) => isMatchVisibleForPrediction(match, prediction)), [prediction]);
  const xiCounter = xiCounts(prediction);

  const persist = async (makeDefinitive = false) => {
    if (makeDefinitive && !window.confirm("¿Confirmas que esta será tu porra definitiva?")) {
      return;
    }
    const result = await savePrediction(makeDefinitive);
    setMessage(result.message);
  };

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Pronóstico editable"
        title="Construye tu porra"
        description="Completa grupos, cuadro, marcadores, extras y tu once ideal. Los datos se guardan como borrador y puedes hacerlos definitivos al terminar."
      />

      {!user ? (
        <Notice tone="warm">Puedes empezar a rellenar la porra ya mismo, pero necesitas entrar en `Perfil` para guardarla.</Notice>
      ) : null}
      {prediction.isDefinitive ? <Notice>Esta porra es definitiva. Ya no admite cambios.</Notice> : null}

      <Card className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {sections.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSection(tab.id)}
              className={`rounded-full px-4 py-2 text-sm ${section === tab.id ? "bg-cyan-400 text-slate-950" : "bg-white/10 text-slate-200"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-4 rounded-2xl bg-white/5 px-4 py-3">
          <div>
            <p className="text-sm text-slate-300">Progreso actual</p>
            <p className="text-xs text-slate-400">Completa toda la porra antes del cierre.</p>
          </div>
          <strong className="text-2xl text-white">{completion}%</strong>
        </div>

        {section === "groups" ? (
          <div className="grid gap-4 xl:grid-cols-3">
            {Object.keys(prediction.groups).map((group) => {
              const ordered = orderedGroupTeams(group, prediction);
              return (
                <Card key={group} className="space-y-4 bg-slate-950/50">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">Grupo {group}</h3>
                    <span className="text-sm text-slate-400">
                      {Object.values(prediction.groups[group]).filter(Boolean).length}/4
                    </span>
                  </div>
                  <div className="space-y-3">
                    {ordered.map((team, index) => (
                      <div key={team.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        <span className="w-10 text-sm font-semibold text-cyan-300">{index + 1}º</span>
                        <div className="flex-1">
                          <TeamBadge teamId={team.id} />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={prediction.isDefinitive || index === 0}
                            onClick={() => moveGroupTeam(group, team.id, -1)}
                            className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white disabled:opacity-40"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={prediction.isDefinitive || index === ordered.length - 1}
                            onClick={() => moveGroupTeam(group, team.id, 1)}
                            className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white disabled:opacity-40"
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        ) : null}

        {section === "knockout" ? (
          <div className="space-y-6">
            <Card className="space-y-4 bg-slate-950/50">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Ocho mejores terceros</h3>
                <span className="text-sm text-slate-400">{prediction.bracket.thirdQualifiers.length} / 8</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {Object.keys(prediction.groups).map((group) => {
                  const teamId = groupTeamAt(group, 3, prediction);
                  const selected = prediction.bracket.thirdQualifiers.includes(group);
                  const disabled = prediction.isDefinitive || !teamId || (!selected && prediction.bracket.thirdQualifiers.length >= 8);
                  return (
                    <button
                      key={group}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleThirdQualifier(group)}
                      className={`rounded-full border px-4 py-3 text-sm transition ${
                        selected ? "border-cyan-300 bg-cyan-400/10 text-cyan-200" : "border-white/10 bg-white/5 text-slate-200"
                      } disabled:opacity-40`}
                    >
                      3º grupo {group}
                      {teamId ? ` · ${teamsById.get(teamId)?.name}` : ""}
                    </button>
                  );
                })}
              </div>
            </Card>

            {knockoutStages.map((stage) => {
              const stageMatches = knockoutMatches.filter((match) => match.stage === stage);
              return (
                <div key={stage} className="space-y-4">
                  <h3 className="text-xl font-semibold text-white">{stage}</h3>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {stageMatches.map((match) => {
                      const home = resolveSlot(match.home, match.number, prediction);
                      const away = resolveSlot(match.away, match.number, prediction);
                      const winner = prediction.bracket.winners[String(match.number)] || "";
                      return (
                        <Card key={match.number} className="space-y-3 bg-slate-950/50">
                          <div className="flex items-center justify-between gap-4 text-sm text-slate-400">
                            <span>Partido {match.number}</span>
                            <span>{formatScheduleDate(match)}</span>
                          </div>
                          {[{ slot: match.home, teamId: home }, { slot: match.away, teamId: away }].map((row) => (
                            <div
                              key={`${match.number}-${row.slot}`}
                              className={`flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 ${
                                winner === row.teamId ? "border-cyan-300 bg-cyan-400/10" : "border-white/10 bg-white/5"
                              }`}
                            >
                              <TeamBadge teamId={row.teamId} fallback={translateSlot(row.slot)} />
                              <button
                                type="button"
                                disabled={prediction.isDefinitive || !row.teamId}
                                onClick={() => chooseMatchWinner(match.number, row.teamId)}
                                className="rounded-full bg-white/10 px-4 py-2 text-sm text-white disabled:opacity-40"
                              >
                                Pasa
                              </button>
                            </div>
                          ))}
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {section === "results" ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between text-sm text-slate-400">
              <span>{visibleMatches.filter((match) => isMatchPredictionComplete(match, prediction)).length} / {visibleMatches.length} marcadores completos</span>
              <span>{schedule.length - visibleMatches.length} partidos pendientes de cruce</span>
            </div>

            {Object.entries(
              visibleMatches.reduce<Record<string, typeof visibleMatches>>((grouped, match) => {
                grouped[match.stage] ||= [];
                grouped[match.stage].push(match);
                return grouped;
              }, {}),
            ).map(([stage, matches]) => (
              <div key={stage} className="space-y-4">
                <h3 className="text-xl font-semibold text-white">{stage}</h3>
                <div className="grid gap-4 xl:grid-cols-2">
                  {matches.map((match) => {
                    const current = prediction.matchPredictions[String(match.number)] || { homeScore: "", awayScore: "" };
                    const locked = prediction.isDefinitive || hasMatchStarted(match);
                    const home = resolveSlot(match.home, match.number, prediction);
                    const away = resolveSlot(match.away, match.number, prediction);

                    return (
                      <Card key={match.number} className="space-y-4 bg-slate-950/50">
                        <div className="flex items-center justify-between gap-4 text-sm text-slate-400">
                          <span>Partido {match.number}</span>
                          <span>{formatScheduleDate(match)}</span>
                        </div>
                        <div className="space-y-3">
                          <ScoreInputRow
                            teamId={home}
                            fallback={translateSlot(match.home)}
                            value={current.homeScore}
                            disabled={locked}
                            onChange={(value) => setPredictionScore(match.number, "homeScore", value)}
                          />
                          <ScoreInputRow
                            teamId={away}
                            fallback={translateSlot(match.away)}
                            value={current.awayScore}
                            disabled={locked}
                            onChange={(value) => setPredictionScore(match.number, "awayScore", value)}
                          />
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {section === "extras" ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="space-y-4 bg-slate-950/50">
              <h3 className="text-xl font-semibold text-white">Selecciones</h3>
              <TeamPicker
                label="Equipo más goleador"
                value={prediction.extras.highestScoringTeam}
                disabled={prediction.isDefinitive}
                onChange={(value) => setPredictionExtra("highestScoringTeam", value)}
              />
              <TeamPicker
                label="Equipo más goleado"
                value={prediction.extras.mostConcededTeam}
                disabled={prediction.isDefinitive}
                onChange={(value) => setPredictionExtra("mostConcededTeam", value)}
              />
              <TeamPicker
                label="Equipo con más rojas"
                value={prediction.extras.mostRedsTeam}
                disabled={prediction.isDefinitive}
                onChange={(value) => setPredictionExtra("mostRedsTeam", value)}
              />
              <TeamPicker
                label="Equipo con menos rojas"
                value={prediction.extras.fewestRedsTeam}
                disabled={prediction.isDefinitive}
                onChange={(value) => setPredictionExtra("fewestRedsTeam", value)}
              />
            </Card>

            <Card className="space-y-4 bg-slate-950/50">
              <h3 className="text-xl font-semibold text-white">Jugadores</h3>
              <Notice tone="warm">Las convocatorias cargadas son las del catálogo actual del repo. El panel admin ya está preparado para contrastarlas con una API externa.</Notice>
              <SelectField
                label="Máximo goleador"
                value={prediction.extras.topScorer}
                disabled={prediction.isDefinitive}
                onChange={(value) => setPredictionExtra("topScorer", value)}
                options={data.players.map((player) => ({ value: player.id, label: `${player.name} · ${teamsById.get(player.team)?.name || ""}` }))}
              />
              <SelectField
                label="MVP del Mundial"
                value={prediction.extras.mvp}
                disabled={prediction.isDefinitive}
                onChange={(value) => setPredictionExtra("mvp", value)}
                options={data.players.map((player) => ({ value: player.id, label: `${player.name} · ${teamsById.get(player.team)?.name || ""}` }))}
              />
            </Card>
          </div>
        ) : null}

        {section === "xi" ? (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3">
              {Object.entries(xiLimits).map(([position, limit]) => (
                <div key={position} className={`rounded-full px-4 py-2 text-sm ${xiCounter[position as keyof typeof xiCounter] === limit ? "bg-cyan-400 text-slate-950" : "bg-white/10 text-slate-200"}`}>
                  {position} · {xiCounter[position as keyof typeof xiCounter]} / {limit}
                </div>
              ))}
            </div>

            {Object.keys(xiLimits).map((position) => (
              <div key={position} className="space-y-4">
                <h3 className="text-xl font-semibold text-white">{xiLabels[position as keyof typeof xiLabels]}</h3>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {data.players
                    .filter((player) => player.position === position)
                    .map((player) => {
                      const selected = prediction.xi.includes(player.id);
                      return (
                        <button
                          key={player.id}
                          type="button"
                          disabled={prediction.isDefinitive}
                          onClick={() => toggleXiPlayer(player.id)}
                          className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                            selected ? "border-cyan-300 bg-cyan-400/10" : "border-white/10 bg-white/5"
                          } disabled:opacity-40`}
                        >
                          <div>
                            <p className="font-semibold text-white">{player.name}</p>
                            <p className="text-sm text-slate-400">{teamsById.get(player.team)?.name}</p>
                          </div>
                          <span className="text-xs uppercase tracking-[0.25em] text-slate-400">{player.position}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {message ? <Notice>{message}</Notice> : null}

      <Card className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-slate-300">
              {prediction.isDefinitive ? "Porra definitiva guardada" : prediction.updatedAt ? "Borrador guardado" : "Tu borrador aún no está guardado"}
            </p>
            <p className="text-xs text-slate-400">Si la haces definitiva, ya no podrás cambiarla desde la app.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void persist(false)}
              disabled={prediction.isDefinitive}
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              Guardar borrador
            </button>
            <button
              type="button"
              onClick={() => void persist(true)}
              disabled={prediction.isDefinitive}
              className="rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-40"
            >
              Hacer definitiva
            </button>
          </div>
        </div>
      </Card>

      <ScoreBreakdown scorecard={currentScorecard} title="Tus puntos conseguidos" />
    </div>
  );
}

function ScoreInputRow({
  teamId,
  fallback,
  value,
  disabled,
  onChange,
}: {
  teamId?: string;
  fallback: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl bg-white/5 px-4 py-3">
      <TeamBadge teamId={teamId} fallback={fallback} />
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-16 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-center text-white outline-none ring-cyan-400 transition focus:ring-2 disabled:opacity-40"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2 text-sm text-slate-300">
      <span>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none ring-cyan-400 transition focus:ring-2 disabled:opacity-40"
      >
        <option value="">Elige una opción</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
