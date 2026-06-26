"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Image from "next/image";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import {
  TrainerFullArtCard,
  trainerDemoCards,
  type TrainerDemoCard,
} from "@/components/trainer-full-art-card";
import { teamsById } from "@/lib/data";
import { flagUrl } from "@/lib/format";

type IconType = "ball" | "glove" | "bolt" | "target" | "red-card" | "whistle";

type Tactic = {
  id: string;
  title: string;
  name: string;
  short: string;
  points: number;
  rarity: "comun" | "dificil" | "rara";
  color: string;
  icon: IconType;
};

type PlayoffMatch = {
  id: string;
  stage: string;
  date: string;
  venue: string;
  trainers: [string, string];
};

type PlayoffPhase = {
  id: string;
  title: string;
  short: string;
  matches: PlayoffMatch[];
};

type Pick = {
  tacticId: string;
  trainerId: string;
};

type MatchResult = {
  homeGoals?: string;
  awayGoals?: string;
};

type ActiveDrag = {
  matchId: string;
  tacticId: string;
} | null;

type TacticStyle = CSSProperties & {
  "--tactic-color": string;
  "--tactic-index"?: number;
};

const tactics: Tactic[] = [
  {
    id: "over-25",
    title: "Goleador",
    name: "Si el partido supera 2.5 goles.",
    short: "Over 2.5",
    points: 2,
    rarity: "comun",
    color: "#ff3b24",
    icon: "ball",
  },
  {
    id: "clean-sheet",
    title: "Portería a 0",
    name: "Si no encaja gol.",
    short: "Cero",
    points: 3,
    rarity: "dificil",
    color: "#69d744",
    icon: "glove",
  },
  {
    id: "first-goal",
    title: "Primer gol",
    name: "Si marca el primero.",
    short: "Primero",
    points: 2,
    rarity: "comun",
    color: "#d946ef",
    icon: "bolt",
  },
  {
    id: "set-piece",
    title: "Balón parado",
    name: "Si marca a balón parado.",
    short: "ABP",
    points: 4,
    rarity: "dificil",
    color: "#38bdf8",
    icon: "target",
  },
  {
    id: "red-card",
    title: "Tarjeta roja",
    name: "Si hay expulsión.",
    short: "Roja",
    points: 4,
    rarity: "dificil",
    color: "#ff4d2d",
    icon: "red-card",
  },
  {
    id: "penalty",
    title: "Penalti",
    name: "Si se señala penalti.",
    short: "Penalti",
    points: 3,
    rarity: "dificil",
    color: "#f5c518",
    icon: "whistle",
  },
];

const playoffPhases: PlayoffPhase[] = [
  {
    id: "round32",
    title: "Dieciseisavos",
    short: "D16",
    matches: [
      {
        id: "r32-1",
        stage: "Dieciseisavos",
        date: "28 JUN 2026",
        venue: "Ciudad de México",
        trainers: ["brasil-ancelotti", "espana-de-la-fuente"],
      },
      {
        id: "r32-2",
        stage: "Dieciseisavos",
        date: "29 JUN 2026",
        venue: "Toronto",
        trainers: ["francia-deschamps", "brasil-ancelotti"],
      },
      {
        id: "r32-3",
        stage: "Dieciseisavos",
        date: "29 JUN 2026",
        venue: "Miami",
        trainers: ["espana-de-la-fuente", "francia-deschamps"],
      },
      {
        id: "r32-4",
        stage: "Dieciseisavos",
        date: "30 JUN 2026",
        venue: "Seattle",
        trainers: ["brasil-ancelotti", "francia-deschamps"],
      },
    ],
  },
  {
    id: "round16",
    title: "Octavos",
    short: "OCT",
    matches: [
      {
        id: "r16-1",
        stage: "Octavos",
        date: "4 JUL 2026",
        venue: "Dallas",
        trainers: ["espana-de-la-fuente", "brasil-ancelotti"],
      },
      {
        id: "r16-2",
        stage: "Octavos",
        date: "5 JUL 2026",
        venue: "Los Angeles",
        trainers: ["francia-deschamps", "espana-de-la-fuente"],
      },
      {
        id: "r16-3",
        stage: "Octavos",
        date: "6 JUL 2026",
        venue: "New York",
        trainers: ["brasil-ancelotti", "francia-deschamps"],
      },
    ],
  },
  {
    id: "quarterfinals",
    title: "Cuartos",
    short: "QF",
    matches: [
      {
        id: "qf-1",
        stage: "Cuartos",
        date: "9 JUL 2026",
        venue: "Kansas City",
        trainers: ["brasil-ancelotti", "espana-de-la-fuente"],
      },
      {
        id: "qf-2",
        stage: "Cuartos",
        date: "10 JUL 2026",
        venue: "Philadelphia",
        trainers: ["francia-deschamps", "brasil-ancelotti"],
      },
    ],
  },
  {
    id: "semifinals",
    title: "Semifinales",
    short: "SF",
    matches: [
      {
        id: "sf-1",
        stage: "Semifinal",
        date: "14 JUL 2026",
        venue: "Dallas",
        trainers: ["espana-de-la-fuente", "francia-deschamps"],
      },
      {
        id: "sf-2",
        stage: "Semifinal",
        date: "15 JUL 2026",
        venue: "Atlanta",
        trainers: ["brasil-ancelotti", "espana-de-la-fuente"],
      },
    ],
  },
  {
    id: "final",
    title: "Final",
    short: "FIN",
    matches: [
      {
        id: "final-1",
        stage: "Final",
        date: "19 JUL 2026",
        venue: "New Jersey",
        trainers: ["espana-de-la-fuente", "francia-deschamps"],
      },
    ],
  },
];

const trainerById = new Map(
  trainerDemoCards.map((trainer) => [trainer.id, trainer]),
);
const tacticById = new Map(tactics.map((tactic) => [tactic.id, tactic]));
const tacticIconAssets: Record<IconType, string> = {
  ball: "/prediction-icons/over25.png",
  glove: "/prediction-icons/clean-sheet.png",
  bolt: "/prediction-icons/first-goal.png",
  target: "/prediction-icons/set-piece.png",
  "red-card": "/prediction-icons/red-card.png",
  whistle: "/prediction-icons/penalty.png",
};

function getTrainers(match: PlayoffMatch) {
  return match.trainers
    .map((trainerId) => trainerById.get(trainerId))
    .filter(Boolean) as TrainerDemoCard[];
}

function PredictionIcon({ type }: { type: IconType }) {
  return (
    <Image
      src={tacticIconAssets[type]}
      alt=""
      fill
      sizes="(max-width: 760px) 44vw, 128px"
      className="playoff-battle-tactic-icon-img"
      priority
      unoptimized
    />
  );
}

function arcadeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function PredictionCard({
  active = false,
  activeTrainer,
  dragId,
  draggingTacticId,
  matchId,
  onSelect,
  orderIndex,
  tactic,
}: {
  active?: boolean;
  activeTrainer?: TrainerDemoCard | null;
  dragId: string;
  draggingTacticId?: string | null;
  matchId: string;
  onSelect: (matchId: string, tacticId: string) => void;
  orderIndex: number;
  tactic: Tactic;
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform } =
    useDraggable({
      id: dragId,
      data: { matchId, tacticId: tactic.id, type: "tactic" },
    });
  const style = {
    "--tactic-color": tactic.color,
    "--tactic-index": orderIndex,
    transform: CSS.Translate.toString(transform),
  } as TacticStyle;
  const isSource = draggingTacticId === tactic.id;
  const isMuted = Boolean(draggingTacticId && !isSource);

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onSelect(matchId, tactic.id)}
      className={`playoff-battle-tactic ${
        active ? "playoff-battle-tactic--picked" : ""
      } ${
        isSource || isDragging ? "playoff-battle-tactic--source" : ""
      } ${isMuted ? "playoff-battle-tactic--muted" : ""} ${
        draggingTacticId ? "playoff-battle-tactic--dragging" : ""
      }`}
      style={style}
      {...listeners}
      {...attributes}
    >
      <span className="playoff-battle-tactic-title">{arcadeText(tactic.title)}</span>
      <span className="playoff-battle-tactic-icon">
        <PredictionIcon type={tactic.icon} />
      </span>
      <span className="playoff-battle-tactic-copy">{arcadeText(tactic.name)}</span>
      <span className="playoff-battle-tactic-points">
        {tactic.points} puntos
      </span>
      {active ? (
        <span className="playoff-battle-tactic-stamp">
          <span>En carta</span>
          {activeTrainer ? (
            <RoundTeamFlag
              teamId={activeTrainer.teamId}
              className="playoff-battle-tactic-stamp-flag"
              size={22}
            />
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

function DragPreview({ tactic }: { tactic: Tactic }) {
  return (
    <div
      className="playoff-battle-tactic playoff-battle-tactic--preview"
      style={{ "--tactic-color": tactic.color } as TacticStyle}
    >
      <span className="playoff-battle-tactic-title">{arcadeText(tactic.title)}</span>
      <span className="playoff-battle-tactic-icon">
        <PredictionIcon type={tactic.icon} />
      </span>
      <span className="playoff-battle-tactic-copy">{arcadeText(tactic.name)}</span>
      <span className="playoff-battle-tactic-points">
        {tactic.points} puntos
      </span>
    </div>
  );
}

function CoachCardHeader({ trainer }: { trainer: TrainerDemoCard }) {
  return (
    <span className="playoff-battle-coach-header">
      <RoundTeamFlag
        teamId={trainer.teamId}
        className="playoff-battle-coach-header-flag"
        size={34}
      />
      <span className="playoff-battle-coach-header-name">{trainer.coach}</span>
    </span>
  );
}

function tacticEffectText(tactic: Tactic) {
  const detail = arcadeText(tactic.name).replace(/^Si\s+/i, "si ");
  return `+${tactic.points} puntos ${detail}`;
}

function CoachCardStylePanel({
  canAssign,
  tactic,
}: {
  canAssign: boolean;
  tactic?: Tactic | null;
}) {
  const selected = Boolean(tactic);
  const style = tactic
    ? ({ "--tactic-color": tactic.color } as TacticStyle)
    : undefined;

  return (
    <span
      aria-live="polite"
      className={`playoff-battle-coach-style ${
        selected ? "playoff-battle-coach-style--picked" : ""
      } ${canAssign && !selected ? "playoff-battle-coach-style--ready" : ""}`}
      style={style}
    >
      {selected && tactic ? (
        <strong className="playoff-battle-coach-style-title">
          {arcadeText(tactic.title)}
        </strong>
      ) : null}
      <span className="playoff-battle-coach-style-text">
        {selected && tactic
          ? tacticEffectText(tactic)
          : canAssign
            ? "Suelta aqu\u00ed el estilo elegido."
            : "Elige un estilo de juego."}
      </span>
      <span
        className={`playoff-battle-coach-style-flash ${
          selected ? "is-active" : ""
        }`}
        aria-hidden="true"
      />
    </span>
  );
}

function HeroTrainerDrop({
  activeDrag,
  align,
  hoveredTrainerId,
  match,
  onTapTrainer,
  pick,
  targeted,
  trainer,
}: {
  activeDrag: ActiveDrag;
  align: "left" | "right";
  hoveredTrainerId?: string | null;
  match: PlayoffMatch;
  onTapTrainer: (matchId: string, trainerId: string) => void;
  pick?: Pick;
  targeted: boolean;
  trainer: TrainerDemoCard;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `drop:${match.id}:${trainer.id}`,
    data: { matchId: match.id, trainerId: trainer.id, type: "trainer-drop" },
  });
  const selected = pick?.trainerId === trainer.id;
  const tactic = selected && pick?.tacticId ? tacticById.get(pick.tacticId) : null;
  const canDrop = activeDrag?.matchId === match.id;
  const canAssign = canDrop;
  const dropDimmed =
    canDrop && hoveredTrainerId != null && hoveredTrainerId !== trainer.id;
  const actionLabel = tactic
    ? `${trainer.country}: ${tactic.title}, ${tactic.points} puntos`
    : targeted
      ? `Asignar predicción a ${trainer.country}`
      : `Seleccionar DT ${trainer.country}`;

  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label={actionLabel}
      onClick={() => onTapTrainer(match.id, trainer.id)}
      className={`playoff-battle-coach playoff-battle-coach--${align} ${
        selected ? "playoff-battle-coach--picked" : ""
      } ${targeted ? "playoff-battle-coach--targeted" : ""} ${
        pick && !selected && !targeted ? "playoff-battle-coach--unpicked" : ""
      } ${
        dropDimmed ? "playoff-battle-coach--drop-dimmed" : ""
      } ${
        isOver ? "playoff-battle-coach--over" : ""
      } ${canDrop ? "playoff-battle-coach--drop-ready" : ""}`}
    >
      <TrainerFullArtCard card={trainer} />
      <CoachCardHeader trainer={trainer} />
      <CoachCardStylePanel
        key={`${match.id}-${trainer.id}-${tactic?.id ?? (canAssign ? "ready" : "empty")}`}
        tactic={tactic}
        canAssign={canAssign}
      />
      {selected ? (
        <span className="playoff-battle-coach-picked-marker" aria-hidden="true">
          Elegido
        </span>
      ) : targeted ? (
        <span className="playoff-battle-coach-picked-marker" aria-hidden="true">
          Activo
        </span>
      ) : null}
      {false ? (
        <span className="playoff-battle-coach-lock">
          <span>Soltar aquí</span>
        </span>
      ) : null}
    </button>
  );
}

const playoffMonthIndex: Record<string, number> = {
  JUN: 5,
  JUL: 6,
};

function playoffKickoffMs(match: PlayoffMatch) {
  const [dayText, monthText, yearText] = match.date.split(" ");
  const day = Number.parseInt(dayText, 10);
  const month = playoffMonthIndex[monthText] ?? 0;
  const year = Number.parseInt(yearText, 10);

  // Demo playoff dates do not include kickoff time. Use 20:00 Madrid summer
  // time, matching the product rule that picks close just before kickoff.
  return Date.UTC(year, month, day, 18, 0, 0);
}

function formatPlayoffCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function PlayoffCountdown({ match }: { match: PlayoffMatch }) {
  const kickoff = useMemo(() => playoffKickoffMs(match), [match]);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (kickoff - current > 0) {
        timer = window.setTimeout(tick, 1000);
      }
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [kickoff]);

  if (now === null) return null;

  const remaining = kickoff - now;

  return (
    <span className="playoff-battle-countdown">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5V12l3 2" />
      </svg>
      <span>
        {remaining > 0
          ? `Cierra en ${formatPlayoffCountdown(remaining)}`
          : "Cerrado"}
      </span>
    </span>
  );
}

function ScoreStepper({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value?: string;
}) {
  const numericValue = Number.parseInt(value ?? "0", 10);
  const score = Number.isFinite(numericValue) ? numericValue : 0;
  const setScore = (delta: number) => {
    onChange(String(Math.max(0, Math.min(99, score + delta))));
  };

  return (
    <div className="playoff-battle-score-control" aria-label={label}>
      <button
        className="playoff-battle-score-button"
        type="button"
        onClick={() => setScore(1)}
        aria-label={`${label} +1`}
      >
        +
      </button>
      <span className="playoff-battle-score-value">{score}</span>
      <button
        className="playoff-battle-score-button"
        type="button"
        onClick={() => setScore(-1)}
        aria-label={`${label} -1`}
      >
        -
      </button>
    </div>
  );
}

function RoundTeamFlag({
  className = "",
  size = 32,
  teamId,
}: {
  className?: string;
  size?: number;
  teamId?: string;
}) {
  const team = teamId ? teamsById.get(teamId) : null;
  if (!team) return null;

  return (
    <Image
      className={className}
      src={flagUrl(team)}
      alt=""
      width={size}
      height={size}
      unoptimized
    />
  );
}

function PhaseSelector({
  activePhaseId,
  onSelect,
}: {
  activePhaseId: string;
  onSelect: (phaseId: string) => void;
}) {
  return (
    <div className="playoff-battle-phase-selector" aria-label="Fases playoff">
      {playoffPhases.map((phase) => (
        <button
          key={phase.id}
          type="button"
          onClick={() => onSelect(phase.id)}
          className={activePhaseId === phase.id ? "is-active" : ""}
        >
          <span>{phase.short}</span>
          <strong>{phase.title}</strong>
        </button>
      ))}
    </div>
  );
}

function MatchSelector({
  activeMatchId,
  matches,
  onSelect,
}: {
  activeMatchId: string;
  matches: PlayoffMatch[];
  onSelect: (matchId: string) => void;
}) {
  return (
    <div className="playoff-battle-selector" aria-label="Partidos de la fase">
      {matches.map((match, index) => {
        const trainers = getTrainers(match);
        return (
          <button
            key={match.id}
            type="button"
            onClick={() => onSelect(match.id)}
            className={activeMatchId === match.id ? "is-active" : ""}
          >
            <span>Partido {index + 1}</span>
            <strong>
              {trainers[0]?.country} vs {trainers[1]?.country}
            </strong>
          </button>
        );
      })}
    </div>
  );
}

function MatchResultControls({
  match,
  onUpdate,
  result,
  trainers,
}: {
  match: PlayoffMatch;
  onUpdate: (matchId: string, patch: Partial<MatchResult>) => void;
  result?: MatchResult;
  trainers: TrainerDemoCard[];
}) {
  return (
    <div className="playoff-battle-scoreboard">
      <div className="playoff-battle-score-row">
        {trainers[0] ? (
          <RoundTeamFlag
            teamId={trainers[0].teamId}
            className="playoff-battle-score-flag"
          />
        ) : null}
        <ScoreStepper
          label={`Goles ${trainers[0]?.country ?? "local"}`}
          value={result?.homeGoals}
          onChange={(value) => onUpdate(match.id, { homeGoals: value })}
        />
        <span className="playoff-battle-score-divider" aria-hidden="true">
          -
        </span>
        <ScoreStepper
          label={`Goles ${trainers[1]?.country ?? "visitante"}`}
          value={result?.awayGoals}
          onChange={(value) => onUpdate(match.id, { awayGoals: value })}
        />
        {trainers[1] ? (
          <RoundTeamFlag
            teamId={trainers[1].teamId}
            className="playoff-battle-score-flag"
          />
        ) : null}
      </div>
    </div>
  );
}

function PickState({
  tactic,
  trainer,
}: {
  tactic?: Tactic | null;
  trainer?: TrainerDemoCard | null;
}) {
  const isPicked = Boolean(tactic && trainer);
  const style = tactic
    ? ({
        "--tactic-color": tactic.color,
      } as TacticStyle)
    : undefined;

  return (
    <div
      key={isPicked ? `${trainer?.id}-${tactic?.id}` : "empty"}
      aria-live="polite"
      className={`playoff-battle-pick-state ${
        isPicked
          ? "playoff-battle-pick-state--picked"
          : "playoff-battle-pick-state--empty"
      }`}
      style={style}
    >
      {isPicked ? (
        <>
          {trainer ? (
            <RoundTeamFlag
              teamId={trainer.teamId}
              className="playoff-battle-pick-flag"
              size={22}
            />
          ) : null}
          <span>{tactic ? arcadeText(tactic.title) : ""}</span>
          <strong>+{tactic?.points}</strong>
        </>
      ) : (
        <>
          <span>Elige chip</span>
          <span>+</span>
          <span>DT</span>
        </>
      )}
    </div>
  );
}

export function PlayoffsBalatroDemo() {
  const [activePhaseId, setActivePhaseId] = useState(playoffPhases[0].id);
  const [activeMatchByPhase, setActiveMatchByPhase] = useState<
    Record<string, string>
  >({});
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null);
  const [hoveredTrainerId, setHoveredTrainerId] = useState<string | null>(null);
  const [activeTrainerByMatch, setActiveTrainerByMatch] = useState<
    Record<string, string>
  >({});
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [results, setResults] = useState<Record<string, MatchResult>>({});
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 140, tolerance: 8 },
    }),
  );

  const activePhase =
    playoffPhases.find((phase) => phase.id === activePhaseId) ??
    playoffPhases[0];
  const activeMatchId =
    activeMatchByPhase[activePhase.id] ?? activePhase.matches[0].id;
  const activeMatch =
    activePhase.matches.find((match) => match.id === activeMatchId) ??
    activePhase.matches[0];
  const trainers = getTrainers(activeMatch);
  const activePick = picks[activeMatch.id];
  const activeResult = results[activeMatch.id];
  const activeTactic = activeDrag ? tacticById.get(activeDrag.tacticId) : null;
  const pickedTactic = activePick ? tacticById.get(activePick.tacticId) : null;
  const pickedTrainer = activePick ? trainerById.get(activePick.trainerId) : null;
  const trainerDisplayPick =
    activeDrag?.matchId === activeMatch.id ? undefined : activePick;
  const activeTrainerId =
    activeTrainerByMatch[activeMatch.id] ??
    activePick?.trainerId ??
    trainers[0]?.id;
  const visibleTactics = tactics;

  const setPhase = (phaseId: string) => {
    setActivePhaseId(phaseId);
    setActiveDrag(null);
    setHoveredTrainerId(null);
  };

  const setMatch = (matchId: string) => {
    setActiveMatchByPhase((current) => ({
      ...current,
      [activePhase.id]: matchId,
    }));
    setActiveDrag(null);
    setHoveredTrainerId(null);
  };

  const assignPick = (matchId: string, trainerId: string, tacticId: string) => {
    setActiveTrainerByMatch((current) => ({
      ...current,
      [matchId]: trainerId,
    }));
    setPicks((current) => ({
      ...current,
      [matchId]: { tacticId, trainerId },
    }));
  };

  const updateResult = (matchId: string, patch: Partial<MatchResult>) => {
    setResults((current) => ({
      ...current,
      [matchId]: {
        ...current[matchId],
        ...patch,
      },
    }));
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type !== "tactic") return;
    setActiveDrag({
      matchId: String(data.matchId),
      tacticId: String(data.tacticId),
    });
    setHoveredTrainerId(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const active = event.active.data.current;
    const over = event.over?.data.current;
    if (active?.type !== "tactic" || over?.type !== "trainer-drop") {
      setHoveredTrainerId(null);
      return;
    }
    if (String(active.matchId) !== String(over.matchId)) {
      setHoveredTrainerId(null);
      return;
    }
    setHoveredTrainerId(String(over.trainerId));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const active = event.active.data.current;
    const over = event.over?.data.current;
    setActiveDrag(null);
    setHoveredTrainerId(null);
    if (active?.type !== "tactic" || over?.type !== "trainer-drop") return;
    if (String(active.matchId) !== String(over.matchId)) return;
    assignPick(
      String(over.matchId),
      String(over.trainerId),
      String(active.tacticId),
    );
  };

  const handleSelectTactic = (matchId: string, tacticId: string) => {
    if (!activeTrainerId) return;
    assignPick(matchId, activeTrainerId, tacticId);
  };

  const handleTapTrainer = (matchId: string, trainerId: string) => {
    setActiveTrainerByMatch((current) => ({
      ...current,
      [matchId]: trainerId,
    }));
  };

  const handleDragCancel = () => {
    setActiveDrag(null);
    setHoveredTrainerId(null);
  };

  return (
    <section className="playoff-battle-shell theme-dark">
      <div className="playoff-battle-stadium" aria-hidden="true" />
      <PhaseSelector activePhaseId={activePhase.id} onSelect={setPhase} />
      <MatchSelector
        activeMatchId={activeMatch.id}
        matches={activePhase.matches}
        onSelect={setMatch}
      />

      <DndContext
        id="playoffs-balatro-dnd"
        sensors={sensors}
        collisionDetection={(args) => {
          const pointerCollisions = pointerWithin(args);
          return pointerCollisions.length > 0
            ? pointerCollisions
            : closestCenter(args);
        }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          className={`playoff-battle-stage ${
            activeDrag ? "playoff-battle-stage--dragging" : ""
          }`}
        >
          {trainers[0] ? (
            <HeroTrainerDrop
              activeDrag={activeDrag}
              align="left"
              hoveredTrainerId={hoveredTrainerId}
              match={activeMatch}
              onTapTrainer={handleTapTrainer}
              pick={trainerDisplayPick}
              targeted={activeTrainerId === trainers[0].id}
              trainer={trainers[0]}
            />
          ) : null}

          {trainers[1] ? (
            <HeroTrainerDrop
              activeDrag={activeDrag}
              align="right"
              hoveredTrainerId={hoveredTrainerId}
              match={activeMatch}
              onTapTrainer={handleTapTrainer}
              pick={trainerDisplayPick}
              targeted={activeTrainerId === trainers[1].id}
              trainer={trainers[1]}
            />
          ) : null}

          <div
            className={`playoff-battle-hand ${
              activeDrag ? "playoff-battle-hand--dragging" : ""
            } ${activePick ? "playoff-battle-hand--has-pick" : ""}`}
          >
            {visibleTactics.map((tactic, index) => (
              <PredictionCard
              key={tactic.id}
              active={activePick?.tacticId === tactic.id}
              activeTrainer={
                activePick?.tacticId === tactic.id ? pickedTrainer : null
              }
              dragId={`tactic:${activeMatch.id}:${tactic.id}`}
              draggingTacticId={activeDrag?.tacticId ?? null}
              matchId={activeMatch.id}
                onSelect={handleSelectTactic}
                orderIndex={index}
                tactic={tactic}
              />
            ))}
          </div>

          <div className="playoff-battle-center">
            <div className="playoff-battle-match-card">
              <div className="playoff-battle-vs">VS</div>
              <div className="playoff-battle-date-block">
                <time className="playoff-battle-match-date">
                  {activeMatch.date}
                </time>
                <PlayoffCountdown match={activeMatch} />
              </div>

              <MatchResultControls
                match={activeMatch}
                onUpdate={updateResult}
                result={activeResult}
                trainers={trainers}
              />

              <div className="playoff-battle-pick-row">
                <PickState tactic={pickedTactic} trainer={pickedTrainer} />
              </div>
            </div>
          </div>
        </div>

        <DragOverlay dropAnimation={null} zIndex={90}>
          {activeTactic ? <DragPreview tactic={activeTactic} /> : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}
