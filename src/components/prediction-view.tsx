"use client";

import { type CSSProperties, useMemo, useState } from "react";
import { flushSync } from "react-dom";

import { Card, Notice, PlayerAvatar, ScoreBreakdown, SectionHeading, TeamBadge, TeamFlag, TeamPicker } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { data, knockoutMatches, knockoutStages, playersById, schedule, sections, teamsById, xiFormations } from "@/lib/data";
import { formatScheduleDate, translateSlot } from "@/lib/format";
import { groupTeamAt, hasMatchStarted, isMatchPredictionComplete, isMatchVisibleForPrediction, orderedGroupTeams, resolveSlot, scheduleUtc } from "@/lib/prediction";
import type { Match, Player, Position, Prediction } from "@/lib/types";

type LineupRow = {
  count: number;
  position: Position;
};

type LineupSlot = {
  id: string;
  row: number;
  index: number;
  position: Position;
  playerId?: string;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

const positionLabels: Record<Position, string> = {
  POR: "Portero",
  DEF: "Defensa",
  MED: "Centrocampista",
  DEL: "Delantero",
};

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
    setXiFormation,
    setXiSelection,
    toggleThirdQualifier,
    user,
  } = useAppContext();
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("groups");
  const [message, setMessage] = useState("");

  const visibleMatches = useMemo(() => schedule.filter((match) => isMatchVisibleForPrediction(match, prediction)), [prediction]);

  const persist = async (makeDefinitive = false) => {
    if (makeDefinitive && !window.confirm("Confirmas que esta sera tu porra definitiva?")) {
      return;
    }
    const result = await savePrediction(makeDefinitive);
    setMessage(result.message);
  };

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Pronostico editable"
        title="Construye tu porra"
        description="Completa grupos, cuadro, marcadores, extras y tu once ideal. Los datos se guardan como borrador y puedes hacerlos definitivos al terminar."
      />

      {!user ? <Notice tone="warm">Puedes empezar a rellenar la porra ya mismo, pero necesitas entrar en `Perfil` para guardarla.</Notice> : null}
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
                    <span className="text-sm text-slate-400">{Object.values(prediction.groups[group]).filter(Boolean).length}/4</span>
                  </div>
                  <div className="space-y-3">
                    {ordered.map((team, index) => (
                      <div key={team.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        <span className="w-10 text-sm font-semibold text-cyan-300">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <TeamBadge teamId={team.id} />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={prediction.isDefinitive || index === 0}
                            onClick={() => moveGroupTeam(group, team.id, -1)}
                            className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white disabled:opacity-40"
                          >
                            Subir
                          </button>
                          <button
                            type="button"
                            disabled={prediction.isDefinitive || index === ordered.length - 1}
                            onClick={() => moveGroupTeam(group, team.id, 1)}
                            className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white disabled:opacity-40"
                          >
                            Bajar
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
                      3 grupo {group}
                      {teamId ? ` - ${teamsById.get(teamId)?.name}` : ""}
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
          <ResultsSchedule
            matches={visibleMatches}
            prediction={prediction}
            pendingMatches={schedule.length - visibleMatches.length}
            onScoreChange={setPredictionScore}
          />
        ) : null}

        {section === "extras" ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="space-y-4 bg-slate-950/50">
              <h3 className="text-xl font-semibold text-white">Selecciones</h3>
              <TeamPicker
                label="Equipo mas goleador"
                value={prediction.extras.highestScoringTeam}
                disabled={prediction.isDefinitive}
                onChange={(value) => setPredictionExtra("highestScoringTeam", value)}
              />
              <TeamPicker
                label="Equipo mas goleado"
                value={prediction.extras.mostConcededTeam}
                disabled={prediction.isDefinitive}
                onChange={(value) => setPredictionExtra("mostConcededTeam", value)}
              />
              <TeamPicker
                label="Equipo con mas rojas"
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
              <Notice tone="warm">Las convocatorias cargadas son las del catalogo actual del repo. El panel admin ya esta preparado para contrastarlas con una API externa.</Notice>
              <SelectField
                label="Maximo goleador"
                value={prediction.extras.topScorer}
                disabled={prediction.isDefinitive}
                onChange={(value) => setPredictionExtra("topScorer", value)}
                options={data.players.map((player) => ({ value: player.id, label: `${player.name} - ${teamsById.get(player.team)?.name || ""}` }))}
              />
              <SelectField
                label="MVP del Mundial"
                value={prediction.extras.mvp}
                disabled={prediction.isDefinitive}
                onChange={(value) => setPredictionExtra("mvp", value)}
                options={data.players.map((player) => ({ value: player.id, label: `${player.name} - ${teamsById.get(player.team)?.name || ""}` }))}
              />
            </Card>
          </div>
        ) : null}

        {section === "xi" ? (
          <LineupBuilder
            formation={prediction.xiFormation}
            selectedPlayerIds={prediction.xi}
            disabled={prediction.isDefinitive}
            onFormationChange={setXiFormation}
            onSelectionChange={setXiSelection}
          />
        ) : null}
      </Card>

      {message ? <Notice>{message}</Notice> : null}

      <Card className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-slate-300">
              {prediction.isDefinitive ? "Porra definitiva guardada" : prediction.updatedAt ? "Borrador guardado" : "Tu borrador aun no esta guardado"}
            </p>
            <p className="text-xs text-slate-400">Si la haces definitiva, ya no podras cambiarla desde la app.</p>
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

function formationRows(formation: string): LineupRow[] {
  const parts = formation.split("-").map(Number).filter(Boolean);
  const defense = parts[0] || 4;
  const attack = parts[parts.length - 1] || 2;
  const midfield = parts.slice(1, -1).reverse();

  return [
    { position: "DEL", count: attack },
    ...midfield.map((count) => ({ position: "MED" as const, count })),
    { position: "DEF", count: defense },
    { position: "POR", count: 1 },
  ];
}

function lineupSlots(formation: string) {
  return formationRows(formation).flatMap((row, rowIndex) =>
    Array.from({ length: row.count }, (_, index) => ({
      id: `${rowIndex}-${index}-${row.position}`,
      row: rowIndex,
      index,
      position: row.position,
    })),
  );
}

function assignPlayersToSlots(playerIds: string[], formation: string): LineupSlot[] {
  const baseSlots = lineupSlots(formation);
  const isPositionalSelection = playerIds.length >= baseSlots.length || playerIds.some((playerId) => !playerId);

  if (isPositionalSelection) {
    return baseSlots.map((slot, index) => {
      const playerId = playerIds[index];
      const player = playerId ? playersById.get(playerId) : null;

      return {
        ...slot,
        playerId: player?.position === slot.position ? playerId : undefined,
      };
    });
  }

  const used = new Set<string>();

  return baseSlots.map((slot) => {
    const playerId = playerIds.find((id) => !used.has(id) && playersById.get(id)?.position === slot.position);
    if (playerId) used.add(playerId);
    return { ...slot, playerId };
  });
}

function slotSelection(slots: LineupSlot[]) {
  return slots.map((slot) => slot.playerId || "");
}

function LineupBuilder({
  formation,
  selectedPlayerIds,
  disabled,
  onFormationChange,
  onSelectionChange,
}: {
  formation: string;
  selectedPlayerIds: string[];
  disabled: boolean;
  onFormationChange: (formation: string) => void;
  onSelectionChange: (playerIds: string[]) => void;
}) {
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const slots = useMemo(() => assignPlayersToSlots(selectedPlayerIds, formation), [formation, selectedPlayerIds]);
  const activeSlot = slots.find((slot) => slot.id === activeSlotId) || null;
  const filledCount = slots.filter((slot) => slot.playerId).length;
  const rows = formationRows(formation);
  const [isFormationAnimating, setIsFormationAnimating] = useState(false);

  const closeModal = () => {
    setActiveSlotId(null);
    setQuery("");
  };

  const selectPlayer = (playerId: string) => {
    if (!activeSlot) return;
    const nextSlots = slots.map((slot) => {
      if (slot.id === activeSlot.id) return { ...slot, playerId };
      if (slot.playerId === playerId) return { ...slot, playerId: undefined };
      return slot;
    });
    onSelectionChange(slotSelection(nextSlots));
    closeModal();
  };

  const removePlayer = () => {
    if (!activeSlot) return;
    onSelectionChange(slotSelection(slots.map((slot) => (slot.id === activeSlot.id ? { ...slot, playerId: undefined } : slot))));
    closeModal();
  };

  const changeFormation = (nextFormation: string) => {
    if (nextFormation === formation) return;

    const documentWithTransition = document as ViewTransitionDocument;
    setIsFormationAnimating(true);

    if (documentWithTransition.startViewTransition) {
      const transition = documentWithTransition.startViewTransition(() => {
        flushSync(() => onFormationChange(nextFormation));
      });
      transition.finished.finally(() => setIsFormationAnimating(false));
      return;
    }

    onFormationChange(nextFormation);
    window.setTimeout(() => setIsFormationAnimating(false), 260);
  };

  const visiblePlayers = useMemo(() => {
    if (!activeSlot) return [];
    const normalized = query.trim().toLowerCase();

    return data.players
      .filter((player) => player.position === activeSlot.position)
      .filter((player) => {
        if (!normalized) return true;
        const team = teamsById.get(player.team)?.name || "";
        return `${player.name} ${team}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => {
        const teamCompare = (teamsById.get(a.team)?.name || "").localeCompare(teamsById.get(b.team)?.name || "");
        return teamCompare || a.name.localeCompare(b.name);
      });
  }, [activeSlot, query]);

  return (
    <div className="mx-auto w-full max-w-[620px]">
      <div className="overflow-hidden rounded-3xl border border-emerald-300/15 bg-emerald-600 shadow-2xl shadow-emerald-950/30">
        <div className="flex items-center justify-between gap-3 bg-emerald-950/30 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-100/70">Tu once</p>
            <h3 className="truncate text-lg font-bold text-white">Constructor de alineacion</h3>
          </div>
          <div className="rounded-full bg-emerald-950/35 px-3 py-1.5 text-sm font-semibold text-emerald-50">{filledCount}/11</div>
        </div>

        <div className={`relative mx-3 my-5 aspect-[7/8] overflow-hidden rounded-3xl border border-emerald-200/20 bg-emerald-600 sm:my-6 ${isFormationAnimating ? "lineup-field-animating" : ""}`}>
          <PitchLines />
          <div className="relative z-10 flex h-full flex-col justify-between px-2 py-4 sm:px-5 sm:py-5">
            {rows.map((row, rowIndex) => {
              const rowSlots = slots.filter((slot) => slot.row === rowIndex);
              return (
                <div key={`${row.position}-${rowIndex}`} className="grid items-center gap-1" style={{ gridTemplateColumns: `repeat(${row.count}, minmax(0, 1fr))` }}>
                  {rowSlots.map((slot) => (
                    <LineupPlayerButton
                      key={slot.id}
                      slot={slot}
                      disabled={disabled}
                      onClick={() => {
                        if (!disabled) setActiveSlotId(slot.id);
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
          <label className="relative sm:w-32">
            <span className="sr-only">Formacion</span>
            <select
              value={formation}
              disabled={disabled}
              onChange={(event) => changeFormation(event.target.value)}
              className="h-9 w-full appearance-none rounded-full border border-white/10 bg-emerald-800/70 px-3 pr-8 text-sm font-semibold text-white outline-none ring-white/30 transition focus:ring-2 disabled:opacity-40"
            >
              {xiFormations.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-100">v</span>
          </label>

          <div className="flex flex-wrap gap-1.5">
            {(["POR", "DEF", "MED", "DEL"] as Position[]).map((position) => {
              const count = slots.filter((slot) => slot.position === position && slot.playerId).length;
              const total = slots.filter((slot) => slot.position === position).length;
              return (
                <span key={position} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${count === total ? "bg-white text-emerald-800" : "bg-emerald-800/55 text-emerald-50"}`}>
                  {position} {count}/{total}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {activeSlot ? (
        <PlayerPickerModal
          slot={activeSlot}
          query={query}
          players={visiblePlayers}
          currentPlayer={activeSlot.playerId ? playersById.get(activeSlot.playerId) : undefined}
          selectedPlayerIds={selectedPlayerIds}
          onQueryChange={setQuery}
          onClose={closeModal}
          onRemove={removePlayer}
          onSelect={selectPlayer}
        />
      ) : null}
    </div>
  );
}

function PitchLines() {
  return (
    <div className="pointer-events-none absolute inset-0 text-emerald-100/35">
      <div className="absolute inset-0 border-2 border-current" />
      <div className="absolute left-0 right-0 top-1/2 border-t-2 border-current" />
      <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-current sm:h-32 sm:w-32" />
      <div className="absolute left-1/2 top-0 h-16 w-32 -translate-x-1/2 rounded-b-2xl border-2 border-t-0 border-current sm:h-24 sm:w-48" />
      <div className="absolute left-1/2 top-0 h-8 w-16 -translate-x-1/2 rounded-b-xl border-2 border-t-0 border-current sm:h-12 sm:w-24" />
      <div className="absolute bottom-0 left-1/2 h-16 w-32 -translate-x-1/2 rounded-t-2xl border-2 border-b-0 border-current sm:h-24 sm:w-48" />
      <div className="absolute bottom-0 left-1/2 h-8 w-16 -translate-x-1/2 rounded-t-xl border-2 border-b-0 border-current sm:h-12 sm:w-24" />
    </div>
  );
}

function LineupPlayerButton({ slot, disabled, onClick }: { slot: LineupSlot; disabled: boolean; onClick: () => void }) {
  const player = slot.playerId ? playersById.get(slot.playerId) : null;
  const transitionStyle: CSSProperties & { viewTransitionName?: string } = {
    viewTransitionName: player ? `lineup-player-${player.id}` : `lineup-slot-${slot.id}`,
  };

  return (
    <button type="button" disabled={disabled} onClick={onClick} style={transitionStyle} className="lineup-slot-button mx-auto flex w-16 flex-col items-center gap-0.5 text-center transition hover:scale-105 disabled:opacity-60 sm:w-[4.5rem]">
      <span className="relative inline-flex">
        {player ? (
          <PlayerAvatar player={player} className="h-10 w-10 rounded-full border-2 border-white bg-white text-xs text-emerald-900 shadow-lg sm:h-11 sm:w-11" />
        ) : (
          <span className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-emerald-300 bg-emerald-600 shadow-[0_0_0_3px_#10b981] sm:h-11 sm:w-11">
            <span className="h-7 w-7 rounded-full border border-emerald-100 bg-emerald-700" />
          </span>
        )}
        {player ? (
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center overflow-hidden rounded-full border border-white bg-white shadow">
            <TeamFlag teamId={player.team} className="h-full w-full rounded-full" />
          </span>
        ) : (
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-sm font-black leading-none text-white shadow">
            +
          </span>
        )}
      </span>
      <span className="max-w-full truncate text-[11px] font-bold leading-tight text-white drop-shadow sm:text-xs">{player?.name || positionLabels[slot.position]}</span>
    </button>
  );
}

function PlayerPickerModal({
  slot,
  query,
  players,
  currentPlayer,
  selectedPlayerIds,
  onQueryChange,
  onClose,
  onRemove,
  onSelect,
}: {
  slot: LineupSlot;
  query: string;
  players: Player[];
  currentPlayer?: Player;
  selectedPlayerIds: string[];
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onRemove: () => void;
  onSelect: (playerId: string) => void;
}) {
  const groupedPlayers = useMemo(() => {
    const groups = new Map<string, Player[]>();

    players.forEach((player) => {
      const country = teamsById.get(player.team)?.name || "Sin pais";
      groups.set(country, [...(groups.get(country) || []), player]);
    });

    return Array.from(groups.entries()).map(([country, countryPlayers]) => ({
      country,
      players: countryPlayers.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [players]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-3 py-5 backdrop-blur-sm">
      <div className="flex max-h-[76vh] w-full max-w-[420px] flex-col overflow-hidden rounded-2xl bg-white text-slate-950 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-100 p-3">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-slate-100 px-3 py-2">
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              autoFocus
              placeholder={`Buscar ${positionLabels[slot.position].toLowerCase()}`}
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
            />
          </label>
          <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-sm font-semibold text-emerald-700">
            Cancelar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3 pt-2">
          {currentPlayer ? (
            <button type="button" onClick={onRemove} className="mb-3 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
              Quitar jugador
            </button>
          ) : null}

          <div className="space-y-2">
            {groupedPlayers.map((group) => (
              <div key={group.country} className="space-y-1">
                <div className="flex items-center gap-2 py-1 text-xs font-bold uppercase text-slate-500">
                  <TeamFlag teamId={group.players[0]?.team} className="h-4 w-5 rounded-sm" />
                  <span>{group.country}</span>
                </div>
                {group.players.map((player) => {
                  const alreadySelected = selectedPlayerIds.includes(player.id) && player.id !== currentPlayer?.id;
                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => onSelect(player.id)}
                      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-slate-100"
                    >
                      <PlayerAvatar player={player} className="h-8 w-8 rounded-full bg-slate-100 text-[10px] text-emerald-900" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold leading-4 text-slate-950">{player.name}</p>
                        <p className="text-xs leading-4 text-slate-500">{positionLabels[player.position]}</p>
                      </div>
                      {alreadySelected ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Mover</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}

            {!players.length ? <p className="rounded-xl bg-slate-100 px-3 py-4 text-sm text-slate-500">No hay jugadores para esa busqueda.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultsSchedule({
  matches,
  prediction,
  pendingMatches,
  onScoreChange,
}: {
  matches: Match[];
  prediction: Prediction;
  pendingMatches: number;
  onScoreChange: (matchNumber: number, side: "homeScore" | "awayScore", value: string) => void;
}) {
  const today = useMemo(() => todayDateKey(), []);
  const [activeDate, setActiveDate] = useState(today);
  const matchesByDate = useMemo(() => {
    return matches.reduce<Record<string, Match[]>>((grouped, match) => {
      const dateKey = resultDateKey(match);
      grouped[dateKey] ||= [];
      grouped[dateKey].push(match);
      return grouped;
    }, {});
  }, [matches]);
  const dateKeys = useMemo(() => {
    const matchDateKeys = Array.from(new Set(matches.map(resultDateKey))).sort();
    const futureDates = matchDateKeys.filter((dateKey) => dateKey !== today && dateKey > today);
    const pastDates = matchDateKeys.filter((dateKey) => dateKey < today);
    return [today, ...futureDates, ...pastDates];
  }, [matches, today]);
  const currentDate = dateKeys.includes(activeDate) ? activeDate : dateKeys[0];
  const currentIndex = Math.max(0, dateKeys.indexOf(currentDate));
  const completedMatches = matches.filter((match) => isMatchPredictionComplete(match, prediction)).length;

  const goToDate = (dateKey: string) => {
    setActiveDate(dateKey);
    window.setTimeout(() => {
      document.getElementById(resultDateSectionId(dateKey))?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const previousDate = dateKeys[currentIndex - 1];
  const nextDate = dateKeys[currentIndex + 1];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-slate-950/80 p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-3xl font-black text-white sm:text-4xl">{formatResultsDay(currentDate, today)}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-lg bg-white/10 p-1">
              <button
                type="button"
                disabled={!previousDate}
                onClick={() => previousDate && goToDate(previousDate)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-2xl text-white transition hover:bg-white/10 disabled:opacity-30"
                aria-label="Dia anterior"
              >
                {"<"}
              </button>
              <button
                type="button"
                onClick={() => goToDate(today)}
                className="h-9 rounded-md px-4 text-sm font-bold text-white transition hover:bg-white/10"
              >
                Hoy
              </button>
              <button
                type="button"
                disabled={!nextDate}
                onClick={() => nextDate && goToDate(nextDate)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-2xl text-white transition hover:bg-white/10 disabled:opacity-30"
                aria-label="Dia siguiente"
              >
                {">"}
              </button>
            </div>
            <div className="rounded-lg bg-white/10 px-4 py-2 text-sm font-bold text-white">
              {completedMatches}/{matches.length} marcadores
            </div>
          </div>
        </div>
        {pendingMatches ? <p className="mt-3 text-sm text-slate-400">{pendingMatches} partidos pendientes de cruce.</p> : null}
      </div>

      <div className="max-h-[760px] space-y-5 overflow-y-auto pr-1">
        {dateKeys.map((dateKey) => {
          const dayMatches = matchesByDate[dateKey] || [];

          return (
            <section key={dateKey} id={resultDateSectionId(dateKey)} className="scroll-mt-6 rounded-2xl bg-slate-950/70 p-4">
              <h4 className="mb-4 text-xl font-black text-white">{formatResultsDay(dateKey, today)}</h4>
              {dayMatches.length ? (
                <div className="space-y-3">
                  {dayMatches.map((match) => (
                    <ResultMatchCard
                      key={match.number}
                      match={match}
                      prediction={prediction}
                      onScoreChange={onScoreChange}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-white/10 px-4 py-5">
                  <p className="text-base font-black text-white">{dateKey === today ? "Hoy no hay partidos programados" : "No hay partidos programados"}</p>
                  <p className="mt-1 text-sm text-slate-400">Navega al siguiente dia con partidos para rellenar marcadores.</p>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ResultMatchCard({
  match,
  prediction,
  onScoreChange,
}: {
  match: Match;
  prediction: Prediction;
  onScoreChange: (matchNumber: number, side: "homeScore" | "awayScore", value: string) => void;
}) {
  const current = prediction.matchPredictions[String(match.number)] || { homeScore: "", awayScore: "" };
  const locked = prediction.isDefinitive || hasMatchStarted(match);
  const home = resolveSlot(match.home, match.number, prediction);
  const away = resolveSlot(match.away, match.number, prediction);

  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-[#191919]">
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:items-center">
        <time className="text-center text-2xl font-black text-white sm:text-left">{formatResultTime(match)}</time>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
          <ResultTeamLabel teamId={home} fallback={translateSlot(match.home)} side="home" />
          <ResultScoreInput
            value={current.homeScore}
            disabled={locked}
            onChange={(value) => onScoreChange(match.number, "homeScore", value)}
          />
          <span className="px-1 text-lg font-semibold text-slate-500">-</span>
          <ResultScoreInput
            value={current.awayScore}
            disabled={locked}
            onChange={(value) => onScoreChange(match.number, "awayScore", value)}
          />
          <ResultTeamLabel teamId={away} fallback={translateSlot(match.away)} side="away" />
        </div>
      </div>
      <div className="flex flex-col gap-1 bg-white/[0.03] px-4 py-2 text-xs font-bold uppercase text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <span>Partido {match.number} - {match.stage}</span>
        <span>{match.venue}</span>
      </div>
    </article>
  );
}

function ResultTeamLabel({
  teamId,
  fallback,
  side,
}: {
  teamId?: string;
  fallback: string;
  side: "home" | "away";
}) {
  const teamName = teamId ? teamsById.get(teamId)?.name || fallback : fallback;
  const flag = teamId ? (
    <TeamFlag teamId={teamId} className="h-7 w-7 rounded-full border border-white/20 object-cover" />
  ) : (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/10 text-[10px] font-black text-slate-300">TBD</span>
  );

  return (
    <div className="flex min-w-0 items-center justify-center gap-2 text-center">
      {side === "home" ? flag : null}
      <span className="min-w-0 truncate text-sm font-black text-white sm:text-base">{teamName}</span>
      {side === "away" ? flag : null}
    </div>
  );
}

function ResultScoreInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={2}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-11 rounded-full border border-white/25 bg-transparent text-center text-lg font-black text-white outline-none ring-cyan-400 transition placeholder:text-slate-500 focus:ring-2 disabled:opacity-40 sm:h-11 sm:w-12"
      placeholder="-"
      aria-label="Resultado"
    />
  );
}

function todayDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).format(new Date());
}

function resultDateKey(match: Match) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).format(new Date(scheduleUtc(match)));
}

function formatResultTime(match: Match) {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(new Date(scheduleUtc(match)));
}

function formatResultsDay(dateKey: string, today: string) {
  if (dateKey === today) return "Hoy";

  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Madrid",
    weekday: "long",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

function resultDateSectionId(dateKey: string) {
  return `results-date-${dateKey}`;
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
        <option value="">Elige una opcion</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
