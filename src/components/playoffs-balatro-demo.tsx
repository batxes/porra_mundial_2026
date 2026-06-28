"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import {
  FinishedMatchCard,
  hasFinishedScore,
  trainerResultChipForMatch,
} from "@/components/common";
import {
  TrainerFullArtCard,
  trainerDemoCards,
  type TrainerDemoCard,
} from "@/components/trainer-full-art-card";
import { data, schedule, teamsById } from "@/lib/data";
import { flagUrl } from "@/lib/format";
import {
  buildPredictionPlayoffTeams,
  buildResolvedPlayoffTeams,
  type ResolvedPlayoffTeams,
} from "@/lib/playoff-teams";
import {
  hasMatchStarted as hasScheduledMatchStarted,
  scheduleUtc,
} from "@/lib/prediction";
import { createEngine } from "@/lib/scoring";
import type { AdminResults, Match, Prediction } from "@/lib/types";

type IconType = "ball" | "glove" | "bolt" | "target" | "red-card" | "comeback";

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
  time: string;
  venue: string;
  trainers: [string, string];
};

type PlayoffDateGroup = {
  date: string;
  matches: PlayoffMatch[];
};

type PlayoffPhase = {
  id: string;
  title: string;
  short: string;
  matches: PlayoffMatch[];
};

type PlayoffResultsProgress = {
  done: number;
  total: number;
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
    name: "MARCA 3 GOLES O MAS",
    short: "Over 2.5",
    points: 3,
    rarity: "comun",
    color: "#ff3b24",
    icon: "ball",
  },
  {
    id: "clean-sheet",
    title: "Muro",
    name: "No encaja gol.",
    short: "Muro",
    points: 2,
    rarity: "dificil",
    color: "#69d744",
    icon: "glove",
  },
  {
    id: "first-goal",
    title: "Abrelatas",
    name: "Marca primero.",
    short: "Abrelatas",
    points: 1,
    rarity: "comun",
    color: "#d946ef",
    icon: "bolt",
  },
  {
    id: "set-piece",
    title: "Estratega",
    name: "Gol a balón parado.",
    short: "Estratega",
    points: 3,
    rarity: "dificil",
    color: "#38bdf8",
    icon: "target",
  },
  {
    id: "red-card",
    title: "Carnicero",
    name: "Expulsan tu jugador.",
    short: "Carnicero",
    points: 5,
    rarity: "dificil",
    color: "#ff4d2d",
    icon: "red-card",
  },
  {
    id: "penalty",
    title: "Remontada",
    name: "VAS PERDIENDO Y GANAS",
    short: "Remontada",
    points: 6,
    rarity: "dificil",
    color: "#f5c518",
    icon: "comeback",
  },
];

const pendingTrainer = (matchNumber: number, side: "home" | "away") =>
  `placeholder-coach-${matchNumber}-${side}`;

const playoffPhases: PlayoffPhase[] = [
  {
    id: "round32",
    title: "Dieciseisavos",
    short: "D16",
    matches: [
      {
        id: "73",
        stage: "Dieciseisavos",
        date: "28 JUN 2026",
        time: "21:00",
        venue: "SoFi Stadium, Inglewood",
        trainers: ["sudafrica-broos", "canada-marsch"],
      },
      {
        id: "76",
        stage: "Dieciseisavos",
        date: "29 JUN 2026",
        time: "19:00",
        venue: "NRG Stadium, Houston",
        trainers: ["brasil-ancelotti", "japon-moriyasu"],
      },
      {
        id: "74",
        stage: "Dieciseisavos",
        date: "29 JUN 2026",
        time: "22:30",
        venue: "Gillette Stadium, Foxborough",
        trainers: ["alemania-nagelsmann", pendingTrainer(74, "away")],
      },
      {
        id: "75",
        stage: "Dieciseisavos",
        date: "30 JUN 2026",
        time: "03:00",
        venue: "Estadio BBVA, Guadalupe",
        trainers: ["paises-bajos-koeman", "marruecos-ouahbi"],
      },
      {
        id: "78",
        stage: "Dieciseisavos",
        date: "30 JUN 2026",
        time: "19:00",
        venue: "AT&T Stadium, Arlington",
        trainers: ["costa-de-marfil-fae", "noruega-solbakken"],
      },
      {
        id: "77",
        stage: "Dieciseisavos",
        date: "30 JUN 2026",
        time: "23:00",
        venue: "MetLife Stadium, East Rutherford",
        trainers: ["francia-deschamps", pendingTrainer(77, "away")],
      },
      {
        id: "79",
        stage: "Dieciseisavos",
        date: "1 JUL 2026",
        time: "03:00",
        venue: "Estadio Azteca, Mexico City",
        trainers: ["mexico-aguirre", pendingTrainer(79, "away")],
      },
      {
        id: "80",
        stage: "Dieciseisavos",
        date: "1 JUL 2026",
        time: "18:00",
        venue: "Mercedes-Benz Stadium, Atlanta",
        trainers: [pendingTrainer(80, "home"), pendingTrainer(80, "away")],
      },
      {
        id: "82",
        stage: "Dieciseisavos",
        date: "1 JUL 2026",
        time: "22:00",
        venue: "Lumen Field, Seattle",
        trainers: ["belgica-garcia", pendingTrainer(82, "away")],
      },
      {
        id: "81",
        stage: "Dieciseisavos",
        date: "2 JUL 2026",
        time: "02:00",
        venue: "Levi's Stadium, Santa Clara",
        trainers: ["estados-unidos-pochettino", pendingTrainer(81, "away")],
      },
      {
        id: "84",
        stage: "Dieciseisavos",
        date: "2 JUL 2026",
        time: "21:00",
        venue: "SoFi Stadium, Inglewood",
        trainers: ["espana-de-la-fuente", pendingTrainer(84, "away")],
      },
      {
        id: "83",
        stage: "Dieciseisavos",
        date: "3 JUL 2026",
        time: "01:00",
        venue: "BMO Field, Toronto",
        trainers: [pendingTrainer(83, "home"), pendingTrainer(83, "away")],
      },
      {
        id: "85",
        stage: "Dieciseisavos",
        date: "3 JUL 2026",
        time: "05:00",
        venue: "BC Place, Vancouver",
        trainers: ["suiza-yakin", pendingTrainer(85, "away")],
      },
      {
        id: "88",
        stage: "Dieciseisavos",
        date: "3 JUL 2026",
        time: "20:00",
        venue: "AT&T Stadium, Arlington",
        trainers: ["australia-popovic", "egipto-hassan"],
      },
      {
        id: "86",
        stage: "Dieciseisavos",
        date: "4 JUL 2026",
        time: "00:00",
        venue: "Hard Rock Stadium, Miami Gardens",
        trainers: [pendingTrainer(86, "home"), "cabo-verde-bubista"],
      },
      {
        id: "87",
        stage: "Dieciseisavos",
        date: "4 JUL 2026",
        time: "03:30",
        venue: "Arrowhead Stadium, Kansas City",
        trainers: [pendingTrainer(87, "home"), pendingTrainer(87, "away")],
      },
    ],
  },
  {
    id: "round16",
    title: "Octavos",
    short: "OCT",
    matches: [
      {
        id: "90",
        stage: "Octavos",
        date: "4 JUL 2026",
        time: "19:00",
        venue: "NRG Stadium, Houston",
        trainers: [pendingTrainer(90, "home"), pendingTrainer(90, "away")],
      },
      {
        id: "89",
        stage: "Octavos",
        date: "4 JUL 2026",
        time: "23:00",
        venue: "Lincoln Financial Field, Philadelphia",
        trainers: [pendingTrainer(89, "home"), pendingTrainer(89, "away")],
      },
      {
        id: "91",
        stage: "Octavos",
        date: "5 JUL 2026",
        time: "22:00",
        venue: "MetLife Stadium, East Rutherford",
        trainers: [pendingTrainer(91, "home"), pendingTrainer(91, "away")],
      },
      {
        id: "92",
        stage: "Octavos",
        date: "6 JUL 2026",
        time: "02:00",
        venue: "Estadio Azteca, Mexico City",
        trainers: [pendingTrainer(92, "home"), pendingTrainer(92, "away")],
      },
      {
        id: "93",
        stage: "Octavos",
        date: "6 JUL 2026",
        time: "21:00",
        venue: "AT&T Stadium, Arlington",
        trainers: [pendingTrainer(93, "home"), pendingTrainer(93, "away")],
      },
      {
        id: "94",
        stage: "Octavos",
        date: "7 JUL 2026",
        time: "02:00",
        venue: "Lumen Field, Seattle",
        trainers: [pendingTrainer(94, "home"), pendingTrainer(94, "away")],
      },
      {
        id: "95",
        stage: "Octavos",
        date: "7 JUL 2026",
        time: "18:00",
        venue: "Mercedes-Benz Stadium, Atlanta",
        trainers: [pendingTrainer(95, "home"), pendingTrainer(95, "away")],
      },
      {
        id: "96",
        stage: "Octavos",
        date: "7 JUL 2026",
        time: "22:00",
        venue: "BC Place, Vancouver",
        trainers: [pendingTrainer(96, "home"), pendingTrainer(96, "away")],
      },
    ],
  },
  {
    id: "quarterfinals",
    title: "Cuartos",
    short: "QF",
    matches: [
      {
        id: "97",
        stage: "Cuartos",
        date: "9 JUL 2026",
        time: "22:00",
        venue: "Gillette Stadium, Foxborough",
        trainers: [pendingTrainer(97, "home"), pendingTrainer(97, "away")],
      },
      {
        id: "98",
        stage: "Cuartos",
        date: "10 JUL 2026",
        time: "21:00",
        venue: "SoFi Stadium, Inglewood",
        trainers: [pendingTrainer(98, "home"), pendingTrainer(98, "away")],
      },
      {
        id: "99",
        stage: "Cuartos",
        date: "11 JUL 2026",
        time: "23:00",
        venue: "Hard Rock Stadium, Miami Gardens",
        trainers: [pendingTrainer(99, "home"), pendingTrainer(99, "away")],
      },
      {
        id: "100",
        stage: "Cuartos",
        date: "12 JUL 2026",
        time: "03:00",
        venue: "Arrowhead Stadium, Kansas City",
        trainers: [pendingTrainer(100, "home"), pendingTrainer(100, "away")],
      },
    ],
  },
  {
    id: "semifinals",
    title: "Semifinales",
    short: "SF",
    matches: [
      {
        id: "101",
        stage: "Semifinales",
        date: "14 JUL 2026",
        time: "21:00",
        venue: "AT&T Stadium, Arlington",
        trainers: [pendingTrainer(101, "home"), pendingTrainer(101, "away")],
      },
      {
        id: "102",
        stage: "Semifinales",
        date: "15 JUL 2026",
        time: "21:00",
        venue: "Mercedes-Benz Stadium, Atlanta",
        trainers: [pendingTrainer(102, "home"), pendingTrainer(102, "away")],
      },
    ],
  },
  {
    id: "third-place",
    title: "Tercer puesto",
    short: "3/4",
    matches: [
      {
        id: "103",
        stage: "Tercer puesto",
        date: "18 JUL 2026",
        time: "23:00",
        venue: "Hard Rock Stadium, Miami Gardens",
        trainers: [pendingTrainer(103, "home"), pendingTrainer(103, "away")],
      },
    ],
  },
  {
    id: "final",
    title: "Final",
    short: "FIN",
    matches: [
      {
        id: "104",
        stage: "Final",
        date: "19 JUL 2026",
        time: "21:00",
        venue: "MetLife Stadium, East Rutherford",
        trainers: [pendingTrainer(104, "home"), pendingTrainer(104, "away")],
      },
    ],
  },
];

const initialPlayoffPhase = playoffPhases[0];
const allPlayoffMatches = playoffPhases.flatMap((phase) => phase.matches);
export const playoffResultsMatchCount = allPlayoffMatches.length;
const defaultPlayoffScheduleMatches = schedule.filter(
  (match) => match.number >= 73,
);
const defaultPlayoffScheduleByNumber = new Map(
  defaultPlayoffScheduleMatches.map((match) => [match.number, match]),
);
const scoringEngine = createEngine({ data, schedule });
const trainerById = new Map(
  trainerDemoCards.map((trainer) => [trainer.id, trainer]),
);
const trainerIdByTeamId = new Map(
  trainerDemoCards
    .filter((trainer) => trainer.teamId)
    .map((trainer) => [trainer.teamId, trainer.id]),
);
const placeholderTrainer = trainerById.get("placeholder-coach");
const genericTrainerPrefix = "team-coach-";
const emptyAdminResults: AdminResults = {};
const tacticById = new Map(tactics.map((tactic) => [tactic.id, tactic]));
const tacticIconAssets: Record<IconType, string> = {
  ball: "/prediction-icons/over25.png",
  glove: "/prediction-icons/clean-sheet.png",
  bolt: "/prediction-icons/first-goal.png",
  target: "/prediction-icons/set-piece.png",
  "red-card": "/prediction-icons/red-card.png",
  comeback: "/prediction-icons/comeback.png",
};

function getTrainerCard(trainerId: string) {
  const trainer = trainerById.get(trainerId);
  if (trainer) return trainer;
  if (trainerId.startsWith("placeholder-coach-") && placeholderTrainer) {
    return { ...placeholderTrainer, id: trainerId };
  }
  if (trainerId.startsWith(genericTrainerPrefix) && placeholderTrainer) {
    const teamId = trainerId.slice(genericTrainerPrefix.length);
    const team = teamsById.get(teamId);
    if (team) {
      return {
        ...placeholderTrainer,
        id: trainerId,
        coach: "Seleccionador",
        country: team.name,
        teamId,
        points: 80,
      };
    }
  }
  return undefined;
}

function trainerIdForTeam(teamId?: string, fallbackTrainerId = "") {
  if (!teamId || !teamsById.has(teamId)) return fallbackTrainerId;
  return trainerIdByTeamId.get(teamId) || `${genericTrainerPrefix}${teamId}`;
}

function getTrainers(match: PlayoffMatch) {
  return match.trainers
    .map((trainerId) => getTrainerCard(trainerId))
    .filter(Boolean) as TrainerDemoCard[];
}

function applyResolvedTeamsToPhases(
  phases: PlayoffPhase[],
  resolvedTeams: ResolvedPlayoffTeams,
  options: { useFallbackTrainers?: boolean } = {},
) {
  const useFallbackTrainers = options.useFallbackTrainers ?? true;

  return phases.map((phase) => ({
    ...phase,
    matches: phase.matches.map((match) => {
      const teams = resolvedTeams[match.id];
      const fallbackHome = useFallbackTrainers
        ? match.trainers[0]
        : pendingTrainer(playoffMatchNumber(match), "home");
      const fallbackAway = useFallbackTrainers
        ? match.trainers[1]
        : pendingTrainer(playoffMatchNumber(match), "away");

      return {
        ...match,
        trainers: [
          trainerIdForTeam(teams?.home, fallbackHome),
          trainerIdForTeam(teams?.away, fallbackAway),
        ] as [string, string],
      };
    }),
  }));
}

function hasResolvedPlayoffTrainers(match: PlayoffMatch) {
  const trainers = getTrainers(match);
  return Boolean(trainers[0]?.teamId && trainers[1]?.teamId);
}

function playoffMatchNumber(match: PlayoffMatch) {
  return Number.parseInt(match.id, 10);
}

function playoffScheduleMatch(
  match: PlayoffMatch,
  scheduleByNumber = defaultPlayoffScheduleByNumber,
) {
  const number = playoffMatchNumber(match);
  return Number.isFinite(number) ? scheduleByNumber.get(number) : undefined;
}

function playoffMatchKickoffMs(
  match: PlayoffMatch,
  scheduleByNumber = defaultPlayoffScheduleByNumber,
) {
  const scheduledMatch = playoffScheduleMatch(match, scheduleByNumber);
  return scheduledMatch
    ? new Date(scheduleUtc(scheduledMatch)).getTime()
    : playoffKickoffMs(match);
}

function actualPlayoffTeamId(
  match: Match | undefined,
  result: AdminResults[string] | undefined,
  side: "home" | "away",
) {
  const override = result?.[`${side}TeamId`];
  if (override && teamsById.has(override)) return override;

  const scheduled = match?.[side];
  return scheduled && teamsById.has(scheduled) ? scheduled : undefined;
}

function getPredictionPick(match: PlayoffMatch, prediction?: Prediction) {
  const current =
    prediction?.matchPredictions[String(playoffMatchNumber(match))];
  if (!current?.trainerTeamId || !current.tacticId) return undefined;

  const trainer = getTrainers(match).find(
    (candidate) => candidate.teamId === current.trainerTeamId,
  );
  return trainer
    ? { trainerId: trainer.id, tacticId: current.tacticId }
    : undefined;
}

function getPredictionResult(match: PlayoffMatch, prediction?: Prediction) {
  const current =
    prediction?.matchPredictions[String(playoffMatchNumber(match))];
  if (!current) return undefined;

  return {
    homeGoals: current.homeScore,
    awayGoals: current.awayScore,
  };
}

function isPredictionValueSet(value: string | undefined) {
  return value !== undefined && value !== "";
}

function isControlledPlayoffComplete(
  match: PlayoffMatch,
  prediction?: Prediction,
) {
  const current =
    prediction?.matchPredictions[String(playoffMatchNumber(match))];

  return Boolean(
    isPredictionValueSet(current?.homeScore) &&
    isPredictionValueSet(current?.awayScore) &&
    current?.trainerTeamId &&
    current.tacticId,
  );
}

export function getPlayoffResultsProgress(
  adminResults?: AdminResults,
  prediction?: Prediction,
): PlayoffResultsProgress {
  const resolvedTeams = prediction
    ? buildPredictionPlayoffTeams(adminResults || emptyAdminResults, prediction)
    : buildResolvedPlayoffTeams(adminResults || emptyAdminResults);
  const resolvedPhases = applyResolvedTeamsToPhases(
    playoffPhases,
    resolvedTeams,
    { useFallbackTrainers: false },
  );
  const availableMatches = resolvedPhases
    .flatMap((phase) => phase.matches)
    .filter(hasResolvedPlayoffTrainers);

  return {
    done: availableMatches.filter((match) =>
      isControlledPlayoffComplete(match, prediction),
    ).length,
    total: availableMatches.length,
  };
}

function defaultTrainerIdForMatch(match: PlayoffMatch) {
  const trainer = getTrainers(match).find((candidate) => candidate.teamId);
  return trainer?.id;
}

function trainerBelongsToMatch(match: PlayoffMatch, trainerId?: string) {
  return Boolean(
    trainerId &&
    getTrainers(match).some(
      (trainer) => trainer.id === trainerId && trainer.teamId,
    ),
  );
}

function groupPlayoffMatchesByDate(matches: PlayoffMatch[]) {
  return matches.reduce<PlayoffDateGroup[]>((groups, match) => {
    const group = groups.find((item) => item.date === match.date);
    if (group) {
      group.matches.push(match);
      return groups;
    }
    return [...groups, { date: match.date, matches: [match] }];
  }, []);
}

function filterPlayoffMatches(
  matches: PlayoffMatch[],
  matchIds?: readonly string[],
) {
  if (!matchIds?.length) return matches;
  const allowedMatchIds = new Set(matchIds);
  return matches.filter((match) => allowedMatchIds.has(match.id));
}

const playoffCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

function usePlayoffCompactLayout() {
  const [isCompact, setIsCompact] = useState<boolean | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const sync = () => setIsCompact(media.matches);

    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return isCompact;
}

function PredictionIcon({ type }: { type: IconType }) {
  return (
    <Image
      src={tacticIconAssets[type]}
      alt=""
      fill
      sizes="(max-width: 760px) 44vw, 128px"
      className="playoff-battle-tactic-icon-img"
      unoptimized
    />
  );
}

function arcadeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const PredictionCard = memo(function PredictionCard({
  active = false,
  activeTrainer,
  disabled = false,
  dragId,
  draggingTacticId,
  matchId,
  onSelect,
  orderIndex,
  tactic,
  useDragOverlay = false,
}: {
  active?: boolean;
  activeTrainer?: TrainerDemoCard | null;
  disabled?: boolean;
  dragId: string;
  draggingTacticId?: string | null;
  matchId: string;
  onSelect: (matchId: string, tacticId: string) => void;
  orderIndex: number;
  tactic: Tactic;
  useDragOverlay?: boolean;
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform } =
    useDraggable({
      id: dragId,
      data: { matchId, tacticId: tactic.id, type: "tactic" },
      disabled,
    });
  const isSource = draggingTacticId === tactic.id;
  const isLifted = isSource || isDragging;
  const style = {
    "--tactic-color": tactic.color,
    "--tactic-index": orderIndex,
    transform: CSS.Translate.toString(transform),
  } as TacticStyle;
  const isMuted = Boolean(draggingTacticId && !isSource);

  return (
    <button
      ref={setNodeRef}
      type="button"
      disabled={disabled}
      onClick={() => onSelect(matchId, tactic.id)}
      className={`playoff-battle-tactic ${
        active ? "playoff-battle-tactic--picked" : ""
      } ${isLifted ? "playoff-battle-tactic--source" : ""} ${
        isLifted && useDragOverlay
          ? "playoff-battle-tactic--overlay-source"
          : ""
      } ${isMuted ? "playoff-battle-tactic--muted" : ""}`}
      style={style}
      {...listeners}
      {...attributes}
    >
      <TacticCardFace
        active={active}
        activeTrainer={activeTrainer}
        tactic={tactic}
      />
    </button>
  );
});

function TacticCardFace({
  active = false,
  activeTrainer,
  tactic,
}: {
  active?: boolean;
  activeTrainer?: TrainerDemoCard | null;
  tactic: Tactic;
}) {
  return (
    <>
      <span className="playoff-battle-tactic-title">
        {arcadeText(tactic.title)}
      </span>
      <span className="playoff-battle-tactic-icon">
        <PredictionIcon type={tactic.icon} />
      </span>
      <span className="playoff-battle-tactic-copy">
        {arcadeText(tactic.name)}
      </span>
      <span className="playoff-battle-tactic-points">+{tactic.points} pts</span>
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
    </>
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

const HeroTrainerDrop = memo(function HeroTrainerDrop({
  activeDrag,
  align,
  dropScope = "default",
  hoveredTrainerId,
  locked = false,
  match,
  onTapTrainer,
  pick,
  targeted,
  trainer,
}: {
  activeDrag: ActiveDrag;
  align: "left" | "right";
  dropScope?: string;
  hoveredTrainerId?: string | null;
  locked?: boolean;
  match: PlayoffMatch;
  onTapTrainer: (matchId: string, trainerId: string) => void;
  pick?: Pick;
  targeted: boolean;
  trainer: TrainerDemoCard;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `drop:${dropScope}:${match.id}:${trainer.id}`,
    data: { matchId: match.id, trainerId: trainer.id, type: "trainer-drop" },
    disabled: locked || !trainer.teamId,
  });
  const selected = pick?.trainerId === trainer.id;
  const tactic =
    selected && pick?.tacticId ? tacticById.get(pick.tacticId) : null;
  const canDrop =
    Boolean(trainer.teamId) && !locked && activeDrag?.matchId === match.id;
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
      disabled={locked || !trainer.teamId}
      onClick={() => onTapTrainer(match.id, trainer.id)}
      className={`playoff-battle-coach playoff-battle-coach--${align} ${
        selected ? "playoff-battle-coach--picked" : ""
      } ${targeted ? "playoff-battle-coach--targeted" : ""} ${
        pick && !selected && !targeted ? "playoff-battle-coach--unpicked" : ""
      } ${dropDimmed ? "playoff-battle-coach--drop-dimmed" : ""} ${
        isOver ? "playoff-battle-coach--over" : ""
      } ${canDrop ? "playoff-battle-coach--drop-ready" : ""}`}
    >
      <span className="playoff-battle-coach-ground-shadow" aria-hidden="true" />
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
});

const playoffMonthIndex: Record<string, number> = {
  JUN: 5,
  JUL: 6,
};

function playoffKickoffMs(match: PlayoffMatch) {
  const [dayText, monthText, yearText] = match.date.split(" ");
  const [hourText, minuteText] = match.time.split(":");
  const day = Number.parseInt(dayText, 10);
  const month = playoffMonthIndex[monthText] ?? 0;
  const year = Number.parseInt(yearText, 10);
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);

  // Kickoff times are displayed in Madrid summer time.
  return Date.UTC(year, month, day, hour - 2, minute, 0);
}

function playoffDateKey(date: string) {
  const [dayText, monthText, yearText] = date.split(" ");
  const day = Number.parseInt(dayText, 10);
  const month = playoffMonthIndex[monthText] ?? 0;
  const year = Number.parseInt(yearText, 10);

  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
}

function formatPlayoffDay(date: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Madrid",
    weekday: "long",
  }).format(new Date(`${playoffDateKey(date)}T12:00:00Z`));
}

function getNextPlayableMatchId(
  matches: PlayoffMatch[],
  scheduleByNumber = defaultPlayoffScheduleByNumber,
) {
  const now = Date.now();
  const upcoming = matches
    .filter((match) => playoffMatchKickoffMs(match, scheduleByNumber) > now)
    .sort(
      (a, b) =>
        playoffMatchKickoffMs(a, scheduleByNumber) -
          playoffMatchKickoffMs(b, scheduleByNumber) ||
        playoffMatchNumber(a) - playoffMatchNumber(b),
    );

  return upcoming[0]?.id ?? matches[0]?.id ?? null;
}

function playoffMatchRequestFromUrl(
  scheduleByNumber = defaultPlayoffScheduleByNumber,
  matchIds?: readonly string[],
) {
  if (typeof window === "undefined") {
    return { matchId: null, clearGoto: false };
  }

  const params = new URLSearchParams(window.location.search);
  const availableMatches = filterPlayoffMatches(allPlayoffMatches, matchIds);
  const availableMatchIds = new Set(availableMatches.map((match) => match.id));
  const matchId = params.get("match");

  if (matchId && availableMatchIds.has(matchId)) {
    return { matchId, clearGoto: false };
  }

  if (params.get("goto") === "next") {
    return {
      matchId: getNextPlayableMatchId(availableMatches, scheduleByNumber),
      clearGoto: true,
    };
  }

  return { matchId: null, clearGoto: false };
}

function playoffPhaseForMatchId(matchId: string | null) {
  if (!matchId) return undefined;

  return playoffPhases.find((phase) =>
    phase.matches.some((match) => match.id === matchId),
  );
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

function isMatchPredictionComplete(pick?: Pick, result?: MatchResult) {
  // A score counts only when actually filled — an empty string "" is the unset
  // state (shown as "?"), and "" != null is true, so guard against it. "0" is valid.
  const hasScore = (v?: string | null) =>
    v !== undefined && v !== null && v !== "";
  return Boolean(
    pick?.trainerId &&
    pick.tacticId &&
    hasScore(result?.homeGoals) &&
    hasScore(result?.awayGoals),
  );
}

function isPlayoffPredictionComplete(
  matchId: string,
  picks: Record<string, Pick>,
  results: Record<string, MatchResult>,
) {
  return isMatchPredictionComplete(picks[matchId], results[matchId]);
}

function PlayoffResultsHeader({
  done,
  onOpenHelp,
  total,
}: {
  done: number;
  onOpenHelp?: () => void;
  total: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Resultados
          </h2>
          {onOpenHelp ? (
            <button
              type="button"
              onClick={onOpenHelp}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:border-[#a7f600]/50 hover:bg-[#a7f600]/12 hover:text-[#a7f600] focus:outline-none focus:ring-2 focus:ring-[#a7f600]/60"
              aria-label="Ver tutorial de resultados playoffs"
              title="Ver tutorial"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M9.7 9a2.4 2.4 0 0 1 4.5 1.2c0 1.8-2.2 2.1-2.2 3.7" />
                <path d="M12 17h.01" />
              </svg>
            </button>
          ) : null}
        </div>
        <span className="text-sm font-semibold text-zinc-500 sm:pb-1">
          {done}/{total}
        </span>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-6 text-zinc-400">
        <span>Elección acertada</span>
        <span className="rounded-md bg-[#a7f600] px-2 py-0.5 text-[11px] font-semibold text-black">
          +1 punto
        </span>
        <span>Resultado exacto suma el valor de todos los</span>
        <span className="rounded-md bg-[#a7f600] px-2 py-0.5 text-[11px] font-semibold text-black">
          goles del partido
        </span>
        <span>Elige entrenador y estrategia</span>
        <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-black">
          obligatorio
        </span>
        <span>Cuenta hasta 120 min</span>
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-zinc-200">
          sin tanda de penaltis
        </span>
      </p>
    </div>
  );
}

function PlayoffPhaseUnavailable({ phaseTitle }: { phaseTitle: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-6 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
        {phaseTitle}
      </p>
      <h3 className="mt-2 text-lg font-bold text-white">
        Aún no hay cruces confirmados
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
        Cuando el admin confirme los equipos clasificados, los partidos de esta
        ronda aparecerán aquí para pronosticar.
      </p>
    </div>
  );
}

function PlayoffCountdown({
  compact = false,
  match,
}: {
  compact?: boolean;
  match: PlayoffMatch;
}) {
  const kickoff = useMemo(() => playoffKickoffMs(match), [match]);
  const [now, setNow] = useState(() => Date.now());

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

  const remaining = kickoff - now;
  const countdownText =
    remaining > 0
      ? `${compact ? "" : "Cierra en "}${formatPlayoffCountdown(remaining)}`
      : "Cerrado";

  return (
    <span
      className={`playoff-battle-countdown ${
        compact ? "playoff-battle-countdown--compact" : ""
      }`}
    >
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
      <span suppressHydrationWarning>{countdownText}</span>
    </span>
  );
}

const ScoreStepper = memo(function ScoreStepper({
  disabled = false,
  label,
  onChange,
  variant = "stacked",
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  variant?: "inline" | "stacked";
  value?: string;
}) {
  const hasValue = value !== undefined && value !== "";
  const numericValue = Number.parseInt(value ?? "0", 10);
  const score = Number.isFinite(numericValue) ? numericValue : 0;
  const setScore = (delta: number) => {
    const baseScore = hasValue ? score : 0;
    onChange(String(Math.max(0, Math.min(99, baseScore + delta))));
  };
  const decrementButton = (
    <button
      className="playoff-battle-score-button"
      type="button"
      disabled={disabled}
      onClick={() => setScore(-1)}
      aria-label={`${label} -1`}
    >
      -
    </button>
  );
  const incrementButton = (
    <button
      className="playoff-battle-score-button"
      type="button"
      disabled={disabled}
      onClick={() => setScore(1)}
      aria-label={`${label} +1`}
    >
      +
    </button>
  );

  return (
    <div
      className={`playoff-battle-score-control ${
        variant === "inline" ? "playoff-battle-score-control--inline" : ""
      }`}
      aria-label={label}
    >
      {variant === "inline" ? decrementButton : incrementButton}
      <span className="playoff-battle-score-value">
        {hasValue ? score : "?"}
      </span>
      {variant === "inline" ? incrementButton : decrementButton}
    </div>
  );
});

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
  const placeholderTeam = teamsById.get("ger");
  const resolvedTeam = team || placeholderTeam;
  if (!resolvedTeam) return null;
  const resolvedClassName = `${className}${team ? "" : " saturate-0"}`.trim();

  return (
    <Image
      className={resolvedClassName}
      src={flagUrl(resolvedTeam)}
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
          aria-label={phase.title}
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

const MatchResultControls = memo(function MatchResultControls({
  locked = false,
  match,
  onUpdate,
  result,
  trainers,
}: {
  locked?: boolean;
  match: PlayoffMatch;
  onUpdate: (matchId: string, patch: Partial<MatchResult>) => void;
  result?: MatchResult;
  trainers: TrainerDemoCard[];
}) {
  const updateHome = useCallback(
    (value: string) => onUpdate(match.id, { homeGoals: value }),
    [match.id, onUpdate],
  );
  const updateAway = useCallback(
    (value: string) => onUpdate(match.id, { awayGoals: value }),
    [match.id, onUpdate],
  );

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
          disabled={locked}
          onChange={updateHome}
        />
        <span className="playoff-battle-score-divider" aria-hidden="true">
          -
        </span>
        <ScoreStepper
          label={`Goles ${trainers[1]?.country ?? "visitante"}`}
          value={result?.awayGoals}
          disabled={locked}
          onChange={updateAway}
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
});

const PickState = memo(function PickState({
  className = "",
  tactic,
  trainer,
}: {
  className?: string;
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
    <span
      key={isPicked ? `${trainer?.id}-${tactic?.id}` : "empty"}
      aria-live="polite"
      className={`playoff-battle-pick-state ${className} ${
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
          <span>+</span>
          <span>Elegir estilo</span>
        </>
      )}
    </span>
  );
});

function PlayoffStatusBadge({ complete }: { complete: boolean }) {
  return (
    <span
      aria-label={complete ? "Resultado rellenado" : "Resultado pendiente"}
      className={`playoff-battle-mobile-status ${
        complete ? "is-complete" : ""
      }`}
    >
      <span className="playoff-battle-mobile-status-icon">
        {complete ? <PlayoffCheckIcon /> : null}
      </span>
      {complete ? "Listo" : "Pendiente"}
    </span>
  );
}

function PlayoffCheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="playoff-battle-mobile-status-check"
      fill="none"
    >
      <path
        d="M3.4 8.2 6.5 11.1 12.8 4.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}

function PlayoffCompactTeamSide({
  reversed = false,
  trainer,
}: {
  reversed?: boolean;
  trainer?: TrainerDemoCard;
}) {
  const teamName = trainer?.country ?? "Equipo";

  return (
    <span
      className={`playoff-battle-mobile-team-side ${
        reversed ? "is-reversed" : ""
      }`}
      title={teamName}
      aria-label={teamName}
    >
      <RoundTeamFlag
        teamId={trainer?.teamId}
        className="playoff-battle-mobile-team-flag"
        size={28}
      />
      <span>{teamName}</span>
    </span>
  );
}

const MobileTrainerChoice = memo(function MobileTrainerChoice({
  activeTrainerId,
  disabled = false,
  matchId,
  onSelectTrainer,
  trainers,
}: {
  activeTrainerId?: string;
  disabled?: boolean;
  matchId: string;
  onSelectTrainer: (matchId: string, trainerId: string) => void;
  trainers: TrainerDemoCard[];
}) {
  return (
    <div
      className="playoff-battle-mobile-trainer-toggle"
      aria-label="Entrenador para el chip"
    >
      {trainers.map((trainer) => {
        const isActive = activeTrainerId === trainer.id;

        return (
          <button
            key={trainer.id}
            type="button"
            disabled={disabled || !trainer.teamId}
            onClick={() => onSelectTrainer(matchId, trainer.id)}
            className={isActive ? "is-active" : ""}
            aria-pressed={isActive}
          >
            <RoundTeamFlag
              teamId={trainer.teamId}
              className="playoff-battle-mobile-trainer-flag"
              size={28}
            />
            <span>
              <strong>{trainer.country}</strong>
              <small>{arcadeText(trainer.coach)}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
});

const PlayoffHandPopover = memo(function PlayoffHandPopover({
  activeTrainerId,
  disabled = false,
  dragScope,
  draggingTacticId,
  matchId,
  onSelectTactic,
  onSelectTrainer,
  pick,
  pickedTrainer,
  trainers,
}: {
  activeTrainerId?: string;
  disabled?: boolean;
  dragScope: string;
  draggingTacticId?: string | null;
  matchId: string;
  onSelectTactic: (matchId: string, tacticId: string) => void;
  onSelectTrainer: (matchId: string, trainerId: string) => void;
  pick?: Pick;
  pickedTrainer?: TrainerDemoCard | null;
  trainers: TrainerDemoCard[];
}) {
  return (
    <div id={`playoff-hand-${matchId}`} className="playoff-battle-hand-popover">
      <MobileTrainerChoice
        activeTrainerId={activeTrainerId}
        disabled={disabled}
        matchId={matchId}
        onSelectTrainer={onSelectTrainer}
        trainers={trainers}
      />
      <div className="playoff-battle-hand-callout">
        <strong className="playoff-battle-hand-callout-desktop">
          CLICK O ARRASTRA LA TACTICA
        </strong>
        <strong className="playoff-battle-hand-callout-mobile">
          TOCA UN CHIP PARA LANZARLO
        </strong>
      </div>
      <div className="playoff-battle-hand playoff-battle-hand--popover">
        {tactics.map((tactic, index) => (
          <PredictionCard
            key={tactic.id}
            active={pick?.tacticId === tactic.id}
            activeTrainer={pick?.tacticId === tactic.id ? pickedTrainer : null}
            disabled={disabled}
            dragId={`${dragScope}:tactic:${matchId}:${tactic.id}`}
            draggingTacticId={draggingTacticId}
            matchId={matchId}
            onSelect={onSelectTactic}
            orderIndex={index}
            tactic={tactic}
          />
        ))}
      </div>
    </div>
  );
});

const MobileChipCoachDrop = memo(function MobileChipCoachDrop({
  activeDrag,
  activeTrainerId,
  disabled = false,
  match,
  onSelectTrainer,
  pick,
  pickedTactic,
  trainer,
}: {
  activeDrag: ActiveDrag;
  activeTrainerId?: string;
  disabled?: boolean;
  match: PlayoffMatch;
  onSelectTrainer: (matchId: string, trainerId: string) => void;
  pick?: Pick;
  pickedTactic?: Tactic | null;
  trainer: TrainerDemoCard;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `drop:mobile-modal:${match.id}:${trainer.id}`,
    data: { matchId: match.id, trainerId: trainer.id, type: "trainer-drop" },
    disabled: disabled || !trainer.teamId,
  });
  const isActive = activeTrainerId === trainer.id;
  const isPicked = pick?.trainerId === trainer.id;
  const shownTactic = isPicked ? pickedTactic : null;
  const canDrop =
    Boolean(trainer.teamId) && !disabled && activeDrag?.matchId === match.id;

  return (
    <button
      ref={setNodeRef}
      type="button"
      disabled={disabled || !trainer.teamId}
      onClick={() => onSelectTrainer(match.id, trainer.id)}
      className={`playoff-mobile-chip-coach playoff-battle-coach ${
        isActive ? "is-active" : ""
      } ${isPicked ? "is-picked playoff-battle-coach--picked" : ""} ${
        pick && !isPicked ? "playoff-battle-coach--unpicked" : ""
      } ${canDrop ? "playoff-battle-coach--drop-ready" : ""} ${
        isOver ? "playoff-battle-coach--over" : ""
      }`}
      aria-pressed={isActive}
    >
      <span className="playoff-battle-coach-ground-shadow" aria-hidden="true" />
      <TrainerFullArtCard card={trainer} />
      <CoachCardHeader trainer={trainer} />
      <CoachCardStylePanel
        key={`${match.id}-${trainer.id}-${shownTactic?.id ?? (isActive || canDrop ? "ready" : "empty")}`}
        tactic={shownTactic}
        canAssign={(isActive || canDrop) && !shownTactic}
      />
      <span className="playoff-mobile-chip-coach-marker">
        {isPicked
          ? "Elegido"
          : isActive
            ? "Activo"
            : canDrop
              ? "Suelta"
              : "Tocar"}
      </span>
    </button>
  );
});

const MobileChipModal = memo(function MobileChipModal({
  activeDrag,
  activeTrainerId,
  disabled = false,
  match,
  onClose,
  onSelectTactic,
  onSelectTrainer,
  pick,
}: {
  activeDrag: ActiveDrag;
  activeTrainerId?: string;
  disabled?: boolean;
  match?: PlayoffMatch | null;
  onClose: () => void;
  onSelectTactic: (matchId: string, tacticId: string) => void;
  onSelectTrainer: (matchId: string, trainerId: string) => void;
  pick?: Pick;
}) {
  useEffect(() => {
    if (!match) return undefined;

    const scrollY = window.scrollY;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyLeft = document.body.style.left;
    const previousBodyRight = document.body.style.right;
    const previousBodyWidth = document.body.style.width;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscrollBehavior =
      document.documentElement.style.overscrollBehavior;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.left = previousBodyLeft;
      document.body.style.right = previousBodyRight;
      document.body.style.width = previousBodyWidth;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior =
        previousHtmlOverscrollBehavior;
      window.scrollTo(0, scrollY);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [match, onClose]);

  if (!match) return null;

  const trainers = getTrainers(match);
  const pickedTactic = pick ? tacticById.get(pick.tacticId) : null;
  const pickedTrainer = pick ? getTrainerCard(pick.trainerId) : null;
  const activeTrainer =
    trainers.find((trainer) => trainer.id === activeTrainerId) ??
    pickedTrainer ??
    trainers[0] ??
    null;
  const modalTitleId = `playoff-chip-modal-title-${match.id}`;

  return (
    <div
      id={`playoff-hand-${match.id}`}
      className="playoff-mobile-chip-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
    >
      <button
        type="button"
        className="playoff-mobile-chip-modal-backdrop"
        aria-label="Cerrar selector de chip"
        onClick={onClose}
      />
      <div className="playoff-mobile-chip-modal-sheet">
        <span className="playoff-mobile-chip-modal-handle" aria-hidden="true" />
        <header className="playoff-mobile-chip-modal-header">
          <span>Estrategia</span>
          <strong id={modalTitleId}>
            {trainers[0]?.country ?? "Equipo"} vs{" "}
            {trainers[1]?.country ?? "Equipo"}
          </strong>
          <button type="button" onClick={onClose}>
            ACEPTAR
          </button>
        </header>

        <div className="playoff-mobile-chip-coaches">
          {trainers.map((trainer) => (
            <MobileChipCoachDrop
              key={trainer.id}
              activeDrag={activeDrag}
              activeTrainerId={activeTrainer?.id}
              disabled={disabled}
              match={match}
              onSelectTrainer={onSelectTrainer}
              pick={pick}
              pickedTactic={pickedTactic}
              trainer={trainer}
            />
          ))}
        </div>

        <div className="playoff-battle-hand-callout playoff-mobile-chip-callout">
          <strong>TOCA O ARRASTRA UN CHIP</strong>
        </div>

        <div className="playoff-mobile-chip-hand">
          {tactics.map((tactic, index) => (
            <PredictionCard
              key={tactic.id}
              active={pick?.tacticId === tactic.id}
              activeTrainer={
                pick?.tacticId === tactic.id ? pickedTrainer : null
              }
              disabled={disabled || !activeTrainer}
              dragId={`mobile-modal:tactic:${match.id}:${tactic.id}`}
              draggingTacticId={
                activeDrag?.matchId === match.id ? activeDrag.tacticId : null
              }
              matchId={match.id}
              onSelect={onSelectTactic}
              orderIndex={index}
              tactic={tactic}
              useDragOverlay
            />
          ))}
        </div>
      </div>
    </div>
  );
});

const PlayoffMatchRow = memo(function PlayoffMatchRow({
  isHandOpen,
  locked,
  match,
  onToggleHand,
  onUpdateResult,
  pick,
  result,
}: {
  isHandOpen: boolean;
  locked: boolean;
  match: PlayoffMatch;
  onToggleHand: (matchId: string) => void;
  onUpdateResult: (matchId: string, patch: Partial<MatchResult>) => void;
  pick?: Pick;
  result?: MatchResult;
}) {
  const trainers = getTrainers(match);
  const pickedTactic = pick ? tacticById.get(pick.tacticId) : null;
  const pickedTrainer = pick ? getTrainerCard(pick.trainerId) : null;
  const isComplete = isMatchPredictionComplete(pick, result);

  return (
    <article
      data-playoff-match-id={match.id}
      className={`playoff-battle-match-row playoff-battle-match-row--mobile-card ${
        isHandOpen ? "is-open" : ""
      }`}
    >
      <header className="playoff-battle-mobile-card-header">
        <span className="playoff-battle-mobile-stage">{match.stage}</span>
        <time className="playoff-battle-mobile-time">{match.time}</time>
        <PlayoffStatusBadge complete={isComplete} />
      </header>

      <div className="playoff-battle-mobile-scoreline">
        <PlayoffCompactTeamSide reversed trainer={trainers[0]} />
        <div className="playoff-battle-mobile-score-controls">
          <ScoreStepper
            label={`Goles ${trainers[0]?.country ?? "local"}`}
            value={result?.homeGoals}
            disabled={locked}
            onChange={(value) => onUpdateResult(match.id, { homeGoals: value })}
            variant="inline"
          />
          <span className="playoff-battle-score-divider" aria-hidden="true">
            -
          </span>
          <ScoreStepper
            label={`Goles ${trainers[1]?.country ?? "visitante"}`}
            value={result?.awayGoals}
            disabled={locked}
            onChange={(value) => onUpdateResult(match.id, { awayGoals: value })}
            variant="inline"
          />
        </div>
        <PlayoffCompactTeamSide trainer={trainers[1]} />
      </div>

      <button
        type="button"
        className="playoff-battle-mobile-chip-trigger"
        disabled={locked}
        aria-expanded={isHandOpen}
        aria-controls={`playoff-hand-${match.id}`}
        onClick={() => onToggleHand(match.id)}
      >
        <PickState
          className="home-trainer-chip-state playoff-battle-mobile-chip-state"
          tactic={pickedTactic}
          trainer={pickedTrainer}
        />
      </button>

      <div className="playoff-battle-mobile-card-footer">
        <PlayoffCountdown compact match={match} />
      </div>
    </article>
  );
});

const PlayoffArenaMatch = memo(function PlayoffArenaMatch({
  activeDrag,
  activeTrainerId,
  hoveredTrainerId,
  isHandOpen,
  locked,
  match,
  onSelectTactic,
  onTapTrainer,
  onToggleHand,
  onUpdateResult,
  pick,
  result,
}: {
  activeDrag: ActiveDrag;
  activeTrainerId?: string;
  hoveredTrainerId?: string | null;
  isHandOpen: boolean;
  locked: boolean;
  match: PlayoffMatch;
  onSelectTactic: (matchId: string, tacticId: string) => void;
  onTapTrainer: (matchId: string, trainerId: string) => void;
  onToggleHand: (matchId: string) => void;
  onUpdateResult: (matchId: string, patch: Partial<MatchResult>) => void;
  pick?: Pick;
  result?: MatchResult;
}) {
  const trainers = getTrainers(match);
  const pickedTactic = pick ? tacticById.get(pick.tacticId) : null;
  const pickedTrainer = pick ? getTrainerCard(pick.trainerId) : null;
  const trainerDisplayPick =
    activeDrag?.matchId === match.id ? undefined : pick;
  const draggingTacticId =
    activeDrag?.matchId === match.id ? activeDrag.tacticId : null;
  const isComplete = isMatchPredictionComplete(pick, result);

  return (
    <div
      data-playoff-match-id={match.id}
      className={`playoff-battle-desktop-arena ${isHandOpen ? "is-open" : ""}`}
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
            dropScope="arena"
            hoveredTrainerId={hoveredTrainerId}
            locked={locked}
            match={match}
            onTapTrainer={onTapTrainer}
            pick={trainerDisplayPick}
            targeted={activeTrainerId === trainers[0].id}
            trainer={trainers[0]}
          />
        ) : null}

        {trainers[1] ? (
          <HeroTrainerDrop
            activeDrag={activeDrag}
            align="right"
            dropScope="arena"
            hoveredTrainerId={hoveredTrainerId}
            locked={locked}
            match={match}
            onTapTrainer={onTapTrainer}
            pick={trainerDisplayPick}
            targeted={activeTrainerId === trainers[1].id}
            trainer={trainers[1]}
          />
        ) : null}

        <div className="playoff-battle-center">
          <span
            className={`playoff-battle-match-status ${
              isComplete ? "is-complete" : ""
            }`}
          >
            {isComplete ? "Completo" : "Incompleto"}
          </span>
          <div className="playoff-battle-match-card">
            <div className="playoff-battle-vs">VS</div>
            <div className="playoff-battle-date-block">
              <time className="playoff-battle-match-date">{match.time}</time>
              <PlayoffCountdown match={match} />
            </div>

            <MatchResultControls
              match={match}
              locked={locked}
              onUpdate={onUpdateResult}
              result={result}
              trainers={trainers}
            />

            <button
              type="button"
              className="playoff-battle-pick-trigger"
              disabled={locked}
              aria-expanded={isHandOpen}
              aria-controls={`playoff-hand-${match.id}`}
              onClick={() => onToggleHand(match.id)}
            >
              <PickState tactic={pickedTactic} trainer={pickedTrainer} />
            </button>
          </div>

          {isHandOpen ? (
            <PlayoffHandPopover
              activeTrainerId={activeTrainerId}
              dragScope="arena"
              draggingTacticId={draggingTacticId}
              disabled={locked}
              matchId={match.id}
              onSelectTactic={onSelectTactic}
              onSelectTrainer={onTapTrainer}
              pick={pick}
              pickedTrainer={pickedTrainer}
              trainers={trainers}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
});

function PlayoffsBattleSurface({
  adminResults,
  embedded = false,
  initialOpenMatchId,
  matchIds,
  mobileModalOnly = false,
  onMobileModalClose,
  onOpenHelp,
  onProgressChange,
  onScoreChange,
  onTrainerTacticChange,
  prediction,
  scheduleMatches = defaultPlayoffScheduleMatches,
  showResultsHeader = false,
  showPhaseSelector = true,
}: {
  adminResults?: AdminResults;
  embedded?: boolean;
  initialOpenMatchId?: string | null;
  matchIds?: readonly string[];
  mobileModalOnly?: boolean;
  onMobileModalClose?: () => void;
  onOpenHelp?: () => void;
  onScoreChange?: (
    matchNumber: number,
    side: "homeScore" | "awayScore",
    value: string,
  ) => void;
  onProgressChange?: (progress: PlayoffResultsProgress) => void;
  onTrainerTacticChange?: (
    matchNumber: number,
    trainerTeamId: string,
    tacticId: string,
  ) => void;
  prediction?: Prediction;
  scheduleMatches?: Match[];
  showResultsHeader?: boolean;
  showPhaseSelector?: boolean;
}) {
  const scheduleByNumber = useMemo(
    () => new Map(scheduleMatches.map((match) => [match.number, match])),
    [scheduleMatches],
  );
  const [initialMatchRequest] = useState(() =>
    playoffMatchRequestFromUrl(scheduleByNumber, matchIds),
  );
  const requestedMatchId = initialMatchRequest.matchId;
  const initialPhase =
    playoffPhaseForMatchId(requestedMatchId) ?? initialPlayoffPhase;
  const [activePhaseId, setActivePhaseId] = useState(initialPhase.id);
  const [openHandMatchId, setOpenHandMatchId] = useState<string | null>(() => {
    if (initialOpenMatchId !== undefined) return initialOpenMatchId;
    return (
      requestedMatchId ??
      getNextPlayableMatchId(
        filterPlayoffMatches(initialPhase.matches, matchIds),
        scheduleByNumber,
      )
    );
  });
  const [mobileChipMatchId, setMobileChipMatchId] = useState<string | null>(
    () =>
      mobileModalOnly ? (initialOpenMatchId ?? requestedMatchId ?? null) : null,
  );
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null);
  const [hoveredTrainerId, setHoveredTrainerId] = useState<string | null>(null);
  const [activeTrainerByMatch, setActiveTrainerByMatch] = useState<
    Record<string, string>
  >({});
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [results, setResults] = useState<Record<string, MatchResult>>({});
  const activeTrainerByMatchRef = useRef(activeTrainerByMatch);
  const picksRef = useRef(picks);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 140, tolerance: 8 },
    }),
  );
  const isCompactLayout = usePlayoffCompactLayout();
  const isControlled = Boolean(
    prediction && onScoreChange && onTrainerTacticChange,
  );
  const playoffAdminResults = adminResults || emptyAdminResults;
  const resolvedPlayoffTeams = useMemo(
    () =>
      isControlled && prediction
        ? buildPredictionPlayoffTeams(playoffAdminResults, prediction)
        : buildResolvedPlayoffTeams(playoffAdminResults),
    [isControlled, playoffAdminResults, prediction],
  );
  const resolvedPlayoffPhases = useMemo(
    () =>
      applyResolvedTeamsToPhases(playoffPhases, resolvedPlayoffTeams, {
        useFallbackTrainers: !isControlled,
      }),
    [isControlled, resolvedPlayoffTeams],
  );
  const resolvedPlayoffPhaseById = useMemo(
    () => new Map(resolvedPlayoffPhases.map((phase) => [phase.id, phase])),
    [resolvedPlayoffPhases],
  );
  const resolvedPlayoffMatchById = useMemo(
    () =>
      new Map(
        resolvedPlayoffPhases
          .flatMap((phase) => phase.matches)
          .map((match) => [match.id, match]),
      ),
    [resolvedPlayoffPhases],
  );
  const availablePlayoffMatches = useMemo(() => {
    const matches = resolvedPlayoffPhases.flatMap((phase) => phase.matches);
    return isControlled ? matches.filter(hasResolvedPlayoffTrainers) : matches;
  }, [isControlled, resolvedPlayoffPhases]);
  const availablePlayoffMatchCount = availablePlayoffMatches.length;

  const activePhase =
    resolvedPlayoffPhaseById.get(activePhaseId) ??
    resolvedPlayoffPhases[0] ??
    initialPlayoffPhase;
  const activePhaseMatches = useMemo(() => {
    const matches = filterPlayoffMatches(activePhase.matches, matchIds);
    return isControlled ? matches.filter(hasResolvedPlayoffTrainers) : matches;
  }, [activePhase, isControlled, matchIds]);
  const activeDateGroups = useMemo(
    () =>
      groupPlayoffMatchesByDate(
        activePhaseMatches.filter(
          (match) =>
            !hasFinishedScore(
              adminResults?.[String(playoffMatchNumber(match))],
            ),
        ),
      ),
    [activePhaseMatches, adminResults],
  );
  const finishedDateGroups = useMemo(
    () =>
      groupPlayoffMatchesByDate(
        activePhaseMatches.filter((match) =>
          hasFinishedScore(adminResults?.[String(playoffMatchNumber(match))]),
        ),
      ),
    [activePhaseMatches, adminResults],
  );
  const showUnresolvedPhaseMessage =
    isControlled &&
    activeDateGroups.length === 0 &&
    finishedDateGroups.length === 0;
  const isPlayoffLocked = useCallback(
    (match: PlayoffMatch) => {
      if (isControlled && !hasResolvedPlayoffTrainers(match)) return true;

      const scheduledMatch = playoffScheduleMatch(match, scheduleByNumber);
      return scheduledMatch
        ? hasScheduledMatchStarted(scheduledMatch)
        : playoffKickoffMs(match) <= Date.now();
    },
    [isControlled, scheduleByNumber],
  );
  const pickForMatch = useCallback(
    (match: PlayoffMatch) =>
      isControlled ? getPredictionPick(match, prediction) : picks[match.id],
    [isControlled, picks, prediction],
  );
  const resultForMatch = useCallback(
    (match: PlayoffMatch) =>
      isControlled ? getPredictionResult(match, prediction) : results[match.id],
    [isControlled, prediction, results],
  );
  const completedPlayoffMatches = useMemo(
    () =>
      availablePlayoffMatches.filter((match) =>
        isControlled
          ? isControlledPlayoffComplete(match, prediction)
          : isPlayoffPredictionComplete(match.id, picks, results),
      ).length,
    [availablePlayoffMatches, isControlled, picks, prediction, results],
  );
  const renderDesktopMatches = !mobileModalOnly && isCompactLayout !== true;
  const renderMobileMatches = !mobileModalOnly && isCompactLayout !== false;
  const renderMobileChipModal = mobileModalOnly || renderMobileMatches;
  const hasFinishedPlayoffMatches = finishedDateGroups.length > 0;
  const scorecard = useMemo(
    () =>
      prediction && adminResults && hasFinishedPlayoffMatches
        ? scoringEngine.calculateScorecard(prediction, adminResults)
        : undefined,
    [adminResults, hasFinishedPlayoffMatches, prediction],
  );

  useEffect(() => {
    onProgressChange?.({
      done: completedPlayoffMatches,
      total: availablePlayoffMatchCount,
    });
  }, [availablePlayoffMatchCount, completedPlayoffMatches, onProgressChange]);

  useEffect(() => {
    if (!requestedMatchId) return;

    window.setTimeout(() => {
      const targets = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-playoff-match-id="${requestedMatchId}"]`,
        ),
      );
      const visibleTarget =
        targets.find((target) => target.offsetParent !== null) ?? targets[0];
      visibleTarget?.scrollIntoView({ behavior: "smooth", block: "center" });

      if (initialMatchRequest.clearGoto) {
        const current = new URLSearchParams(window.location.search);
        current.delete("goto");
        const query = current.toString();
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
        );
      }
    }, 140);
  }, [initialMatchRequest.clearGoto, requestedMatchId]);

  const setPhase = useCallback(
    (phaseId: string) => {
      const nextPhase =
        resolvedPlayoffPhaseById.get(phaseId) ??
        resolvedPlayoffPhases[0] ??
        initialPlayoffPhase;
      setActivePhaseId(phaseId);
      setActiveDrag(null);
      setHoveredTrainerId(null);
      setMobileChipMatchId(null);
      setOpenHandMatchId(
        initialOpenMatchId !== undefined
          ? initialOpenMatchId
          : getNextPlayableMatchId(
              filterPlayoffMatches(nextPhase.matches, matchIds),
              scheduleByNumber,
            ),
      );
    },
    [
      initialOpenMatchId,
      matchIds,
      resolvedPlayoffPhaseById,
      resolvedPlayoffPhases,
      scheduleByNumber,
    ],
  );

  const assignPick = useCallback(
    (matchId: string, trainerId: string, tacticId: string) => {
      const match = resolvedPlayoffMatchById.get(matchId);
      const trainer = getTrainerCard(trainerId);
      if (!match || !trainer?.teamId || isPlayoffLocked(match)) return;

      const nextActiveTrainerByMatch = {
        ...activeTrainerByMatchRef.current,
        [matchId]: trainerId,
      };
      activeTrainerByMatchRef.current = nextActiveTrainerByMatch;
      setActiveTrainerByMatch(nextActiveTrainerByMatch);

      if (isControlled && onTrainerTacticChange) {
        onTrainerTacticChange(
          playoffMatchNumber(match),
          trainer.teamId,
          tacticId,
        );
        return;
      }

      const nextPicks = {
        ...picksRef.current,
        [matchId]: { tacticId, trainerId },
      };
      picksRef.current = nextPicks;
      setPicks(nextPicks);
    },
    [
      isControlled,
      isPlayoffLocked,
      onTrainerTacticChange,
      resolvedPlayoffMatchById,
    ],
  );

  const updateResult = useCallback(
    (matchId: string, patch: Partial<MatchResult>) => {
      const match = resolvedPlayoffMatchById.get(matchId);
      if (!match || isPlayoffLocked(match)) return;

      if (isControlled && onScoreChange) {
        const matchNumber = playoffMatchNumber(match);
        if (patch.homeGoals !== undefined) {
          onScoreChange(matchNumber, "homeScore", patch.homeGoals);
        }
        if (patch.awayGoals !== undefined) {
          onScoreChange(matchNumber, "awayScore", patch.awayGoals);
        }
        return;
      }

      setResults((current) => ({
        ...current,
        [matchId]: {
          ...current[matchId],
          ...patch,
        },
      }));
    },
    [isControlled, isPlayoffLocked, onScoreChange, resolvedPlayoffMatchById],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current;
      if (data?.type !== "tactic") return;
      const match = resolvedPlayoffMatchById.get(String(data.matchId));
      if (match && isPlayoffLocked(match)) return;
      setActiveDrag({
        matchId: String(data.matchId),
        tacticId: String(data.tacticId),
      });
      if (mobileModalOnly || isCompactLayout === true) {
        setMobileChipMatchId(String(data.matchId));
      } else {
        setOpenHandMatchId(String(data.matchId));
      }
      setHoveredTrainerId(null);
    },
    [
      isCompactLayout,
      isPlayoffLocked,
      mobileModalOnly,
      resolvedPlayoffMatchById,
    ],
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
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
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
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
      if (mobileModalOnly || isCompactLayout === true) {
        setMobileChipMatchId(String(over.matchId));
      } else {
        setOpenHandMatchId(String(over.matchId));
      }
    },
    [assignPick, isCompactLayout, mobileModalOnly],
  );

  const handleSelectTactic = useCallback(
    (matchId: string, tacticId: string) => {
      const match = resolvedPlayoffMatchById.get(matchId);
      if (!match || isPlayoffLocked(match)) return;
      const currentPick = isControlled
        ? getPredictionPick(match, prediction)
        : picksRef.current[matchId];
      const activeTrainerId = activeTrainerByMatchRef.current[matchId];
      const trainerId =
        (trainerBelongsToMatch(match, activeTrainerId)
          ? activeTrainerId
          : undefined) ??
        currentPick?.trainerId ??
        defaultTrainerIdForMatch(match);
      if (!trainerId) return;
      assignPick(matchId, trainerId, tacticId);
      if (!mobileModalOnly && isCompactLayout !== true) {
        setOpenHandMatchId(matchId);
      }
    },
    [
      assignPick,
      isCompactLayout,
      isControlled,
      isPlayoffLocked,
      mobileModalOnly,
      prediction,
      resolvedPlayoffMatchById,
    ],
  );

  const handleTapTrainer = useCallback(
    (matchId: string, trainerId: string) => {
      const match = resolvedPlayoffMatchById.get(matchId);
      const trainer = getTrainerCard(trainerId);
      if (!match || !trainer?.teamId || isPlayoffLocked(match)) return;

      const nextActiveTrainerByMatch = {
        ...activeTrainerByMatchRef.current,
        [matchId]: trainerId,
      };
      activeTrainerByMatchRef.current = nextActiveTrainerByMatch;
      setActiveTrainerByMatch(nextActiveTrainerByMatch);
      if (mobileModalOnly || isCompactLayout === true) {
        setMobileChipMatchId(matchId);
      } else {
        setOpenHandMatchId(matchId);
      }
    },
    [
      isCompactLayout,
      isPlayoffLocked,
      mobileModalOnly,
      resolvedPlayoffMatchById,
    ],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDrag(null);
    setHoveredTrainerId(null);
  }, []);

  const handleToggleHand = useCallback(
    (matchId: string) => {
      const match = resolvedPlayoffMatchById.get(matchId);
      if (match && isPlayoffLocked(match)) return;
      if (isCompactLayout === true) {
        setMobileChipMatchId((current) =>
          current === matchId ? null : matchId,
        );
        return;
      }
      setOpenHandMatchId((current) => (current === matchId ? null : matchId));
    },
    [isCompactLayout, isPlayoffLocked, resolvedPlayoffMatchById],
  );

  const handleToggleMobileChip = useCallback(
    (matchId: string) => {
      const match = resolvedPlayoffMatchById.get(matchId);
      if (match && isPlayoffLocked(match)) return;
      setMobileChipMatchId((current) => (current === matchId ? null : matchId));
    },
    [isPlayoffLocked, resolvedPlayoffMatchById],
  );

  const handleCloseMobileChipModal = useCallback(() => {
    setMobileChipMatchId(null);
    onMobileModalClose?.();
  }, [onMobileModalClose]);

  const handleMobileSelectTactic = useCallback(
    (matchId: string, tacticId: string) => {
      handleSelectTactic(matchId, tacticId);
    },
    [handleSelectTactic],
  );

  const renderFinishedMatchCard = useCallback(
    (match: PlayoffMatch) => {
      const matchNumber = playoffMatchNumber(match);
      const result = adminResults?.[String(matchNumber)];
      if (!result || !hasFinishedScore(result)) return null;

      const scheduledMatch = playoffScheduleMatch(match, scheduleByNumber);
      const cardMatch =
        scheduledMatch ??
        ({
          number: matchNumber,
          date: playoffDateKey(match.date),
          time: match.time,
          home: "",
          away: "",
          venue: match.venue,
          stage: match.stage,
        } satisfies Match);
      const current = prediction?.matchPredictions[String(matchNumber)];
      const resolvedTeams = resolvedPlayoffTeams[String(matchNumber)];
      const hasPick =
        current?.homeScore !== "" &&
        current?.homeScore != null &&
        current?.awayScore !== "" &&
        current?.awayScore != null;

      return (
        <FinishedMatchCard
          key={match.id}
          match={cardMatch}
          result={result}
          pickHome={current?.homeScore}
          pickAway={current?.awayScore}
          hasPick={hasPick}
          homeTeamId={
            actualPlayoffTeamId(scheduledMatch, result, "home") ||
            resolvedTeams?.home
          }
          awayTeamId={
            actualPlayoffTeamId(scheduledMatch, result, "away") ||
            resolvedTeams?.away
          }
          showTrainerChipSlot
          trainerChip={
            prediction
              ? trainerResultChipForMatch(matchNumber, prediction, scorecard)
              : null
          }
        />
      );
    },
    [
      adminResults,
      prediction,
      resolvedPlayoffTeams,
      scheduleByNumber,
      scorecard,
    ],
  );

  const mobileChipMatch =
    (mobileModalOnly || isCompactLayout === true) && mobileChipMatchId
      ? (resolvedPlayoffMatchById.get(mobileChipMatchId) ?? null)
      : null;
  const mobileChipPick = mobileChipMatch
    ? pickForMatch(mobileChipMatch)
    : undefined;
  const mobileChipActiveTrainerId = mobileChipMatch
    ? ((trainerBelongsToMatch(
        mobileChipMatch,
        activeTrainerByMatch[mobileChipMatch.id],
      )
        ? activeTrainerByMatch[mobileChipMatch.id]
        : undefined) ??
      mobileChipPick?.trainerId ??
      defaultTrainerIdForMatch(mobileChipMatch))
    : undefined;
  const activeDragTactic =
    activeDrag && (mobileModalOnly || isCompactLayout === true)
      ? (tacticById.get(activeDrag.tacticId) ?? null)
      : null;

  const content = (
    <>
      {showResultsHeader && !mobileModalOnly ? (
        <PlayoffResultsHeader
          done={completedPlayoffMatches}
          onOpenHelp={onOpenHelp}
          total={availablePlayoffMatchCount}
        />
      ) : null}

      {!embedded && showPhaseSelector && !mobileModalOnly ? (
        <PhaseSelector activePhaseId={activePhase.id} onSelect={setPhase} />
      ) : null}
      {embedded && showPhaseSelector && !mobileModalOnly ? (
        <div className="playoff-battle-embedded-selectors">
          <PhaseSelector activePhaseId={activePhase.id} onSelect={setPhase} />
        </div>
      ) : null}

      <DndContext
        id={embedded ? "playoffs-results-dnd" : "playoffs-balatro-dnd"}
        sensors={sensors}
        collisionDetection={playoffCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {renderDesktopMatches ? (
          <div className="playoff-battle-desktop-stack">
            {activeDateGroups.map((group) => (
              <section key={group.date} className="playoff-battle-date-group">
                <h3 className="playoff-battle-date-heading">
                  {formatPlayoffDay(group.date)}
                </h3>
                <div className="playoff-battle-date-matches">
                  {group.matches.map((match) => {
                    const pick = pickForMatch(match);
                    const result = resultForMatch(match);
                    const locked = isPlayoffLocked(match);
                    const matchActiveDrag =
                      activeDrag?.matchId === match.id ? activeDrag : null;
                    const rawActiveTrainerId = activeTrainerByMatch[match.id];
                    const activeTrainerId =
                      (trainerBelongsToMatch(match, rawActiveTrainerId)
                        ? rawActiveTrainerId
                        : undefined) ??
                      pick?.trainerId ??
                      defaultTrainerIdForMatch(match);

                    return (
                      <PlayoffArenaMatch
                        key={match.id}
                        activeDrag={matchActiveDrag}
                        activeTrainerId={activeTrainerId}
                        hoveredTrainerId={
                          matchActiveDrag ? hoveredTrainerId : null
                        }
                        isHandOpen={openHandMatchId === match.id}
                        locked={locked}
                        match={match}
                        onSelectTactic={handleSelectTactic}
                        onTapTrainer={handleTapTrainer}
                        onToggleHand={handleToggleHand}
                        onUpdateResult={updateResult}
                        pick={pick}
                        result={result}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
            {showUnresolvedPhaseMessage ? (
              <PlayoffPhaseUnavailable phaseTitle={activePhase.title} />
            ) : null}
          </div>
        ) : null}

        {renderMobileMatches ? (
          <div className="playoff-battle-mobile-list">
            <div className="playoff-battle-list">
              <section className="playoff-battle-phase-block">
                {!showPhaseSelector ? (
                  <h3 className="playoff-battle-phase-heading">
                    <span>{activePhase.short}</span>
                    <strong>{activePhase.title}</strong>
                  </h3>
                ) : null}
                {showUnresolvedPhaseMessage ? (
                  <PlayoffPhaseUnavailable phaseTitle={activePhase.title} />
                ) : null}
                {activeDateGroups.map((group) => (
                  <section
                    key={group.date}
                    className="playoff-battle-date-group"
                  >
                    <h4 className="playoff-battle-date-heading">
                      {formatPlayoffDay(group.date)}
                    </h4>
                    <div className="playoff-battle-match-stack">
                      {group.matches.map((match) => {
                        const pick = pickForMatch(match);
                        const result = resultForMatch(match);
                        const locked = isPlayoffLocked(match);

                        return (
                          <PlayoffMatchRow
                            key={match.id}
                            isHandOpen={mobileChipMatchId === match.id}
                            locked={locked}
                            match={match}
                            onToggleHand={handleToggleMobileChip}
                            onUpdateResult={updateResult}
                            pick={pick}
                            result={result}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))}
              </section>
            </div>
          </div>
        ) : null}

        {renderMobileChipModal ? (
          <MobileChipModal
            activeDrag={activeDrag}
            activeTrainerId={mobileChipActiveTrainerId}
            disabled={mobileChipMatch ? isPlayoffLocked(mobileChipMatch) : true}
            match={mobileChipMatch}
            onClose={handleCloseMobileChipModal}
            onSelectTactic={handleMobileSelectTactic}
            onSelectTrainer={handleTapTrainer}
            pick={mobileChipPick}
          />
        ) : null}

        <DragOverlay dropAnimation={null}>
          {activeDragTactic ? (
            <div
              className="playoff-battle-tactic playoff-battle-tactic--drag-overlay"
              style={
                {
                  "--tactic-color": activeDragTactic.color,
                } as TacticStyle
              }
            >
              <TacticCardFace tactic={activeDragTactic} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {!mobileModalOnly && finishedDateGroups.length ? (
        <div
          className={`space-y-4 ${
            activeDateGroups.length ? "border-t border-white/10 pt-5" : ""
          }`}
        >
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            Jugados
          </p>
          <div className="space-y-4">
            {finishedDateGroups.map((group) => (
              <section key={group.date} className="space-y-3">
                <h3 className="text-xl font-bold text-white first-letter:capitalize">
                  {formatPlayoffDay(group.date)}
                </h3>
                <div className="space-y-4">
                  {group.matches.map((match) => renderFinishedMatchCard(match))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );

  if (mobileModalOnly) {
    return content;
  }

  if (embedded) {
    return (
      <section className="playoff-battle-embedded playoff-battle-embedded--compact theme-dark">
        {content}
      </section>
    );
  }

  return (
    <section className="playoff-battle-shell playoff-battle-shell--list theme-dark">
      <div className="playoff-battle-stadium" aria-hidden="true" />
      {content}
    </section>
  );
}

export function PlayoffTrainerChipModal({
  adminResults,
  matchNumber,
  onClose,
  onTrainerTacticChange,
  prediction,
  scheduleMatches,
}: {
  adminResults?: AdminResults;
  matchNumber: number;
  onClose: () => void;
  onTrainerTacticChange: (
    matchNumber: number,
    trainerTeamId: string,
    tacticId: string,
  ) => void;
  prediction: Prediction;
  scheduleMatches?: Match[];
}) {
  const matchId = String(matchNumber);
  const ignoreScoreChange = useCallback(() => undefined, []);

  return (
    <PlayoffsBattleSurface
      adminResults={adminResults}
      embedded
      initialOpenMatchId={matchId}
      matchIds={[matchId]}
      mobileModalOnly
      onMobileModalClose={onClose}
      onScoreChange={ignoreScoreChange}
      onTrainerTacticChange={onTrainerTacticChange}
      prediction={prediction}
      scheduleMatches={scheduleMatches}
      showResultsHeader={false}
      showPhaseSelector={false}
    />
  );
}

export function PlayoffsBalatroResults({
  adminResults,
  initialOpenMatchId,
  matchIds,
  onScoreChange,
  onOpenHelp,
  onProgressChange,
  onTrainerTacticChange,
  prediction,
  scheduleMatches,
  showResultsHeader = true,
  showPhaseSelector = true,
}: {
  adminResults?: AdminResults;
  initialOpenMatchId?: string | null;
  matchIds?: readonly string[];
  onScoreChange: (
    matchNumber: number,
    side: "homeScore" | "awayScore",
    value: string,
  ) => void;
  onOpenHelp?: () => void;
  onProgressChange?: (progress: PlayoffResultsProgress) => void;
  onTrainerTacticChange: (
    matchNumber: number,
    trainerTeamId: string,
    tacticId: string,
  ) => void;
  prediction: Prediction;
  scheduleMatches?: Match[];
  showResultsHeader?: boolean;
  showPhaseSelector?: boolean;
}) {
  return (
    <PlayoffsBattleSurface
      adminResults={adminResults}
      embedded
      initialOpenMatchId={initialOpenMatchId}
      matchIds={matchIds}
      onScoreChange={onScoreChange}
      onOpenHelp={onOpenHelp}
      onProgressChange={onProgressChange}
      onTrainerTacticChange={onTrainerTacticChange}
      prediction={prediction}
      scheduleMatches={scheduleMatches}
      showResultsHeader={showResultsHeader}
      showPhaseSelector={showPhaseSelector}
    />
  );
}

export function PlayoffsBalatroDemo() {
  return <PlayoffsBattleSurface />;
}
