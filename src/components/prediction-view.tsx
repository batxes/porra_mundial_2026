"use client";

import { type CSSProperties, useMemo, useState } from "react";
import { flushSync } from "react-dom";

import { Card, Notice, PlayerAvatar, SectionHeading, TeamBadge, TeamFlag, TeamPicker } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { data, playersById, schedule, sections, teamsById, xiFormations } from "@/lib/data";
import { translateSlot } from "@/lib/format";
import { hasMatchStarted, hasTournamentStarted, isMatchPredictionComplete, isMatchVisibleForPrediction, orderedGroupTeams, resolveSlot, scheduleUtc } from "@/lib/prediction";
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

const positionTabs: Array<{ id: Position; label: string }> = [
  { id: "POR", label: "Portero" },
  { id: "DEF", label: "Defensa" },
  { id: "MED", label: "Centro" },
  { id: "DEL", label: "Delantero" },
];

export function PredictionView() {
  const {
    completion,
    moveGroupTeam,
    prediction,
    savePrediction,
    setPredictionExtra,
    setPredictionScore,
    setXiFormation,
    setXiSelection,
    user,
  } = useAppContext();
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("extras");
  const [message, setMessage] = useState("");

  const visibleMatches = useMemo(() => schedule.filter((match) => isMatchVisibleForPrediction(match, prediction)), [prediction]);
  const tournamentLocked = hasTournamentStarted();

  const persist = async () => {
    const result = await savePrediction(false);
    setMessage(result.message);
  };

  return (
    <div className="mx-auto max-w-3xl pb-28">
      <SectionHeading eyebrow="Porra" title="Juega el Mundial" />

      <div className="space-y-4">
        {!user ? <Notice tone="warm">Puedes rellenar tu porra. Para guardarla necesitas entrar en Perfil.</Notice> : null}
        {tournamentLocked ? <Notice>Elecciones, once y grupos estan cerrados. Los resultados siguen abiertos hasta el inicio de cada partido.</Notice> : null}

        <StepTabs section={section} onSectionChange={setSection} />

        <div className="min-h-[520px]">
          {section === "extras" ? (
            <TusElecciones
              disabled={tournamentLocked}
              prediction={prediction}
              onExtraChange={setPredictionExtra}
            />
          ) : null}

          {section === "xi" ? (
            <LineupBuilder
              formation={prediction.xiFormation}
              selectedPlayerIds={prediction.xi}
              disabled={tournamentLocked}
              onFormationChange={setXiFormation}
              onSelectionChange={setXiSelection}
            />
          ) : null}

          {section === "groups" ? (
            <GroupStage prediction={prediction} disabled={tournamentLocked} onMoveTeam={moveGroupTeam} />
          ) : null}

          {section === "results" ? (
            <ResultsSchedule
              matches={visibleMatches}
              prediction={prediction}
              onScoreChange={setPredictionScore}
            />
          ) : null}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#050505]/92 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center justify-between gap-4 sm:block">
            <p className="text-sm font-semibold text-white">{message || (prediction.updatedAt ? "Progreso guardado" : "Sin guardar")}</p>
            <p className="text-xs text-zinc-500">Completado {completion}%</p>
          </div>
          <button
            type="button"
            onClick={() => void persist()}
            className="rounded-lg bg-[#a7f600] px-5 py-3 text-sm font-black text-black transition hover:bg-[#c7ff43]"
          >
            Guardar progreso
          </button>
        </div>
      </div>
    </div>
  );
}

function StepTabs({
  section,
  onSectionChange,
}: {
  section: (typeof sections)[number]["id"];
  onSectionChange: (section: (typeof sections)[number]["id"]) => void;
}) {
  return (
    <div className="sticky top-[102px] z-30 -mx-1 overflow-x-auto bg-[#050505]/88 px-1 py-2 backdrop-blur">
      <div className="flex min-w-max gap-2">
        {sections.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSectionChange(tab.id)}
            className={`flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-bold transition ${
              section === tab.id ? "bg-white text-black" : "bg-white/[0.08] text-zinc-300 hover:bg-white/[0.12]"
            }`}
          >
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${section === tab.id ? "bg-black text-white" : "bg-white/10 text-zinc-400"}`}>
              {index + 1}
            </span>
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TusElecciones({
  disabled,
  prediction,
  onExtraChange,
}: {
  disabled: boolean;
  prediction: Prediction;
  onExtraChange: (key: keyof Prediction["extras"], value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-white">Tus elecciones</h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceBlock points={25}>
          <TeamPicker
            label="Ganador del mundial"
            value={prediction.extras.worldChampion}
            disabled={disabled}
            controlClassName="mt-4"
            onChange={(value) => onExtraChange("worldChampion", value)}
          />
        </ChoiceBlock>
        <ChoiceBlock points={10}>
          <TeamPicker
            label="Equipo mas goleador"
            value={prediction.extras.highestScoringTeam}
            disabled={disabled}
            controlClassName="mt-4"
            onChange={(value) => onExtraChange("highestScoringTeam", value)}
          />
        </ChoiceBlock>
        <ChoiceBlock points={10}>
          <TeamPicker
            label="Equipo mas goleado"
            value={prediction.extras.mostConcededTeam}
            disabled={disabled}
            controlClassName="mt-4"
            onChange={(value) => onExtraChange("mostConcededTeam", value)}
          />
        </ChoiceBlock>
        <ChoiceBlock points={10}>
          <TeamPicker
            label="Equipo con mas rojas"
            value={prediction.extras.mostRedsTeam}
            disabled={disabled}
            controlClassName="mt-4"
            onChange={(value) => onExtraChange("mostRedsTeam", value)}
          />
        </ChoiceBlock>
        <ChoiceBlock points={20}>
          <ExtraPlayerField
            label="Maximo goleador"
            value={prediction.extras.topScorer}
            disabled={disabled}
            onChange={(value) => onExtraChange("topScorer", value)}
            initialPosition="DEL"
          />
        </ChoiceBlock>
        <ChoiceBlock points={20}>
          <ExtraPlayerField
            label="MVP"
            value={prediction.extras.mvp}
            disabled={disabled}
            onChange={(value) => onExtraChange("mvp", value)}
            initialPosition="MED"
          />
        </ChoiceBlock>
      </div>
    </div>
  );
}

function ChoiceBlock({ points, children }: { points: number; children: React.ReactNode }) {
  return (
    <div className="relative rounded-lg border border-white/10 bg-[#151515] p-4">
      <span className="absolute right-3 top-3 rounded-md bg-[#a7f600] px-2 py-1 text-xs font-black text-black">{points} pts</span>
      <div className="pr-16">{children}</div>
    </div>
  );
}

function ExtraPlayerField({
  label,
  value,
  disabled,
  initialPosition,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  initialPosition: Position;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const player = value ? playersById.get(value) : null;

  return (
    <div className="text-sm text-zinc-300">
      <span>{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        className="mt-4 grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-white/10 bg-[#0f0f0f] px-3 py-2 text-left text-white outline-none ring-[#a7f600] transition hover:border-white/20 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {player ? (
          <PlayerAvatar player={player} className="h-9 w-9 rounded-full bg-zinc-900 text-xs text-lime-100" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-lg font-black text-zinc-500">+</span>
        )}
        <span className="min-w-0">
          <span className={`block truncate text-sm font-bold ${player ? "text-white" : "text-zinc-500"}`}>{player?.name || "Elige un jugador"}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-semibold text-zinc-500">
            {player ? <TeamFlag teamId={player.team} className="h-3.5 w-5 rounded-sm" /> : null}
            <span className="truncate">{player ? teamsById.get(player.team)?.name || "Sin pais" : "Portero, defensa, centro o delantero"}</span>
          </span>
        </span>
        <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] font-black text-zinc-300">{player ? positionLabels[player.position] : "Elegir"}</span>
      </button>

      {isOpen ? (
        <ExtraPlayerPickerModal
          title={label}
          currentPlayer={player || undefined}
          initialPosition={player?.position || initialPosition}
          onClose={() => setIsOpen(false)}
          onRemove={() => {
            onChange("");
            setIsOpen(false);
          }}
          onSelect={(playerId) => {
            onChange(playerId);
            setIsOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ExtraPlayerPickerModal({
  title,
  currentPlayer,
  initialPosition,
  onClose,
  onRemove,
  onSelect,
}: {
  title: string;
  currentPlayer?: Player;
  initialPosition: Position;
  onClose: () => void;
  onRemove: () => void;
  onSelect: (playerId: string) => void;
}) {
  const [activePosition, setActivePosition] = useState<Position>(initialPosition);
  const [query, setQuery] = useState("");

  const visiblePlayers = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return data.players
      .filter((player) => player.position === activePosition)
      .filter((player) => {
        if (!normalized) return true;
        const team = teamsById.get(player.team)?.name || "";
        return `${player.name} ${team}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => {
        const teamCompare = (teamsById.get(a.team)?.name || "").localeCompare(teamsById.get(b.team)?.name || "");
        return teamCompare || a.name.localeCompare(b.name);
      });
  }, [activePosition, query]);

  const groupedPlayers = useMemo(() => {
    const groups = new Map<string, Player[]>();

    visiblePlayers.forEach((player) => {
      const country = teamsById.get(player.team)?.name || "Sin pais";
      groups.set(country, [...(groups.get(country) || []), player]);
    });

    return Array.from(groups.entries());
  }, [visiblePlayers]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-3 py-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[78vh] w-full max-w-[440px] flex-col overflow-hidden rounded-2xl bg-white text-slate-950 shadow-2xl">
        <div className="border-b border-slate-100 p-3">
          <div className="grid grid-cols-4 rounded-xl bg-slate-100 p-1">
            {positionTabs.map((position) => (
              <button
                key={position.id}
                type="button"
                aria-pressed={activePosition === position.id}
                onClick={() => setActivePosition(position.id)}
                className={`h-9 rounded-lg px-1 text-[11px] font-black transition sm:text-xs ${
                  activePosition === position.id ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {position.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-slate-100 px-3 py-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
                placeholder={`Buscar ${positionLabels[activePosition].toLowerCase()}`}
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
              />
            </label>
            <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-sm font-semibold text-emerald-700">
              Cancelar
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3 pt-2">
          {currentPlayer ? (
            <button type="button" onClick={onRemove} className="mb-3 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
              Quitar jugador
            </button>
          ) : null}

          <div className="space-y-2">
            {groupedPlayers.map(([country, countryPlayers]) => (
              <div key={country} className="space-y-1">
                <div className="flex items-center gap-2 py-1 text-xs font-bold uppercase text-slate-500">
                  <TeamFlag teamId={countryPlayers[0]?.team} className="h-4 w-5 rounded-sm" />
                  <span>{country}</span>
                </div>
                {countryPlayers.map((player) => {
                  const selected = player.id === currentPlayer?.id;

                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => onSelect(player.id)}
                      className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2 py-1.5 text-left transition ${
                        selected ? "bg-emerald-50" : "hover:bg-slate-100"
                      }`}
                    >
                      <PlayerAvatar player={player} className="h-8 w-8 rounded-full bg-slate-100 text-[10px] text-emerald-900" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold leading-4 text-slate-950">{player.name}</p>
                        <p className="text-xs leading-4 text-slate-500">{teamsById.get(player.team)?.name || "Sin pais"}</p>
                      </div>
                      {selected ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Elegido</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}

            {!visiblePlayers.length ? <p className="rounded-xl bg-slate-100 px-3 py-4 text-sm text-slate-500">No hay jugadores para esa busqueda.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupStage({
  prediction,
  disabled,
  onMoveTeam,
}: {
  prediction: Prediction;
  disabled: boolean;
  onMoveTeam: (group: string, teamId: string, direction: number) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-2xl font-black tracking-tight text-white">Fase de grupos</h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-5 text-zinc-400">
          <span>Equipo que pasa acertado:</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-1 text-xs font-black text-black">+2 pts</span>
          <span>Orden exacto en el grupo:</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-1 text-xs font-black text-black">+3 pts</span>
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {Object.keys(prediction.groups).map((group) => {
          const ordered = orderedGroupTeams(group, prediction);
          return (
            <Card key={group} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Grupo {group}</h3>
                <span className="text-sm font-semibold text-zinc-500">{Object.values(prediction.groups[group]).filter(Boolean).length}/4</span>
              </div>
              <div className="space-y-2">
                {ordered.map((team, index) => (
                  <div key={team.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-white/[0.06] px-3 py-2">
                    <span className="text-sm font-black text-[#a7f600]">{index + 1}</span>
                    <TeamBadge teamId={team.id} />
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label={`Subir ${team.name}`}
                        disabled={disabled || index === 0}
                        onClick={() => onMoveTeam(group, team.id, -1)}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-sm font-black text-white disabled:opacity-25"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Bajar ${team.name}`}
                        disabled={disabled || index === ordered.length - 1}
                        onClick={() => onMoveTeam(group, team.id, 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-sm font-black text-white disabled:opacity-25"
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

    if (documentWithTransition.startViewTransition) {
      documentWithTransition.startViewTransition(() => {
        flushSync(() => onFormationChange(nextFormation));
      });
      return;
    }

    setIsFormationAnimating(true);
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
    <div className="mx-auto w-full max-w-[620px] space-y-5">
      <div className="space-y-2">
        <h2 className="text-2xl font-black tracking-tight text-white">Tu once</h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-6 text-zinc-400">
          <span>Gol delantero</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-1 text-xs font-black text-black">+2 pts</span>
          <span>centrocampista</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-1 text-xs font-black text-black">+6 pts</span>
          <span>defensa</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-1 text-xs font-black text-black">+11 pts</span>
          <span>portero</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-1 text-xs font-black text-black">+35 pts</span>
        </p>
      </div>

      <div className="overflow-hidden rounded-3xl border border-emerald-300/15 bg-emerald-600 shadow-2xl shadow-emerald-950/30">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-950/20 px-4 py-3">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-50/75">Alineacion</p>
          <div className="flex items-center gap-2">
            <label className="relative w-32">
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
            <div className="rounded-full bg-emerald-950/35 px-3 py-1.5 text-sm font-semibold text-emerald-50">{filledCount}/11</div>
          </div>
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
  onScoreChange,
}: {
  matches: Match[];
  prediction: Prediction;
  onScoreChange: (matchNumber: number, side: "homeScore" | "awayScore", value: string) => void;
}) {
  const matchesByDate = useMemo(() => {
    return matches.reduce<Record<string, Match[]>>((grouped, match) => {
      const dateKey = resultDateKey(match);
      grouped[dateKey] ||= [];
      grouped[dateKey].push(match);
      return grouped;
    }, {});
  }, [matches]);
  const dateKeys = useMemo(() => Array.from(new Set(matches.map(resultDateKey))).sort(), [matches]);
  const completedMatches = matches.filter((match) => isMatchPredictionComplete(match, prediction)).length;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-2xl font-black tracking-tight text-white">Resultados</h2>
          <span className="pb-1 text-sm font-semibold text-zinc-500">{completedMatches}/{matches.length}</span>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-6 text-zinc-400">
          <span>Eleccion acertada</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-1 text-xs font-black text-black">+1 punto</span>
          <span>Resultado exacto suma el valor de todos los</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-1 text-xs font-black text-black">goles del partido</span>
        </p>
      </div>

      <div className="space-y-3">
        {dateKeys.map((dateKey) => {
          const dayMatches = matchesByDate[dateKey] || [];

          return (
            <section key={dateKey} className="scroll-mt-28">
              <h4 className="flex h-16 items-center gap-2 pt-6 pb-4 text-xl/6 font-semibold tracking-[-0.5px] not-first-of-type:mt-4 md:scroll-mt-24">
                <span className="first-letter:capitalize">{formatResultsDay(dateKey)}</span>
              </h4>
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
            </section>
          );
        })}

        {!dateKeys.length ? (
          <div className="rounded-lg border border-white/10 bg-[#151515] px-4 py-6 text-sm text-zinc-400">
            Completa la fase de grupos para desbloquear mas partidos.
          </div>
        ) : null}
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
  const locked = hasMatchStarted(match);
  const home = resolveSlot(match.home, match.number, prediction);
  const away = resolveSlot(match.away, match.number, prediction);
  const complete = isMatchPredictionComplete(match, prediction);

  return (
    <article
      className="overflow-hidden rounded-[22px] text-white"
      style={{
        background:
          "radial-gradient(250px at 0% 0%, rgba(0, 99, 75, 0.2) 0%, rgba(47, 47, 47, 0) 70%), radial-gradient(250px at 100% 0%, rgba(216, 159, 40, 0.2) 0%, rgba(47, 47, 47, 0) 70%), rgb(47, 47, 47)",
      }}
    >
      <div className="flex justify-center px-4 pb-0 pt-4">
        <time className="inline-flex items-center text-sm font-semibold text-zinc-200">{formatResultTime(match)}</time>
      </div>
      <div className="grid min-h-[128px] w-full grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)] items-start py-2 pb-4">
        <ResultTeamColumn teamId={home} fallback={translateSlot(match.home)} />
        <div className="relative flex items-center justify-center gap-2 pt-2">
          <ResultScoreStepper
            label="Goles local"
            value={current.homeScore}
            disabled={locked}
            onChange={(value) => onScoreChange(match.number, "homeScore", value)}
          />
          <span className={`absolute left-1/2 top-10 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-white/20 text-sm font-black ${complete ? "bg-[#a7f600] text-black" : "bg-[#3a3a3a] text-zinc-500"}`}>
            {complete ? "✓" : ""}
          </span>
          <ResultScoreStepper
            label="Goles visitante"
            value={current.awayScore}
            disabled={locked}
            onChange={(value) => onScoreChange(match.number, "awayScore", value)}
          />
        </div>
        <ResultTeamColumn teamId={away} fallback={translateSlot(match.away)} />
      </div>
    </article>
  );
}

function ResultTeamColumn({
  teamId,
  fallback,
}: {
  teamId?: string;
  fallback: string;
}) {
  const teamName = teamId ? teamsById.get(teamId)?.name || fallback : fallback;

  return (
    <div className="flex h-full w-full min-w-0 flex-col items-center justify-start gap-3 px-3 pt-4">
      {teamId ? (
        <TeamFlag teamId={teamId} className="h-8 w-8 rounded-full border border-white/15 object-cover" />
      ) : (
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/10 text-[10px] font-black text-zinc-300">TBD</span>
      )}
      <span className="line-clamp-2 w-full min-w-0 text-center text-xs font-bold leading-4 text-white">{teamName}</span>
    </div>
  );
}

function ResultScoreStepper({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const numericValue = Number(value || 0);
  const increment = () => onChange(String(Math.min(99, numericValue + 1)));
  const decrement = () => onChange(String(Math.max(0, numericValue - 1)));

  return (
    <div className="flex w-14 flex-col overflow-hidden rounded-md">
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={increment}
        className="flex h-7 items-center justify-center bg-[#454545] text-lg font-black leading-none text-zinc-100 transition hover:bg-[#555] disabled:text-zinc-600"
        aria-label={`Subir ${label}`}
      >
        +
      </button>
      <input
        name={label}
        type="number"
        inputMode="numeric"
        min="0"
        max="99"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="score-number-input h-10 w-14 appearance-none bg-[#222] text-center text-xl font-black text-white outline-none placeholder:text-zinc-600 disabled:opacity-60"
        placeholder="?"
        aria-label={label}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={decrement}
        className="flex h-7 items-center justify-center bg-[#454545] text-lg font-black leading-none text-zinc-100 transition hover:bg-[#555] disabled:text-zinc-600"
        aria-label={`Bajar ${label}`}
      >
        -
      </button>
    </div>
  );
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

function formatResultsDay(dateKey: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Madrid",
    weekday: "long",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}
