"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { data, playersById, teamsById } from "@/lib/data";
import {
  flagUrl,
  formatScheduleDate,
  initials,
  playerPhotoUrl,
  translateSlot,
} from "@/lib/format";
import {
  emptyPrediction,
  hasMatchStarted,
  hasTournamentStarted,
  orderedGroupTeams,
  resolveSlot,
  scheduleUtc,
} from "@/lib/prediction";
import type {
  AdminEvent,
  AdminResult,
  AdminResults,
  Match,
  Player,
  Position,
  Prediction,
  Scorecard,
  Team,
  UserProfile,
} from "@/lib/types";

const teamsAlphabetically = [...data.teams].sort((a: Team, b: Team) =>
  a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
);

function normalizeTeamSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const hasPaddingOverride = /\bp[trblxy]?-\S+/.test(className);

  return (
    <article
      className={`rounded-lg border border-white/10 bg-[#151515] shadow-lg shadow-black/20 ${hasPaddingOverride ? "" : "p-4 sm:p-5"} ${className}`}
    >
      {children}
    </article>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#a7f600]">
          {eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-3xl text-sm text-zinc-400 sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

export function ClockIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function ResultsOpenBanner({ className = "" }: { className?: string }) {
  return (
    <div className={`results-open-banner ${className}`}>
      <div className="flex items-center gap-3 rounded-[11px] bg-[#131313] px-3.5 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#a7f600]/15 text-[#a7f600]">
          <ClockIcon className="h-4 w-4" />
        </span>
        <p className="text-sm font-medium leading-5 text-zinc-200">
          Puedes meter o cambiar cada resultado{" "}
          <strong className="font-bold text-[#a7f600]">
            hasta justo antes de que comience ese partido
          </strong>
          .
        </p>
      </div>
    </div>
  );
}

export function matchStageLabel(match: Match) {
  if (match.stage !== "Grupos") return match.stage;
  const group =
    teamsById.get(match.home)?.group || teamsById.get(match.away)?.group;
  return group ? `Grupo ${group}` : match.stage;
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  // Siempre mostramos los segundos para que la cuenta vaya bajando "en vivo".
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Cuenta atras hasta el inicio del partido. Se actualiza cada segundo para que
// baje en vivo.
export function MatchCountdown({
  match,
  className = "",
}: {
  match: Match;
  className?: string;
}) {
  const kickoff = useMemo(
    () => new Date(scheduleUtc(match)).getTime(),
    [match],
  );
  // Empezamos en null para no desincronizar el render del servidor con el del
  // cliente (la hora actual solo existe en el navegador).
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const remaining = kickoff - current;
      if (remaining <= 0) return;
      timer = window.setTimeout(tick, 1000);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [kickoff]);

  if (now === null) return null;
  const remaining = kickoff - now;
  if (remaining <= 0) return null;

  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${className}`}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-3 w-3 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5V12l3 2" />
      </svg>
      <span>{formatCountdown(remaining)}</span>
      <span className="sr-only"> para el inicio</span>
    </span>
  );
}

export function ProBadge({
  size = "sm",
  className = "",
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const sizeClasses =
    size === "md" ? "px-2 py-[3px] text-[10px]" : "px-1.5 py-[2px] text-[9px]";

  return (
    <span
      title="Usuario PRO"
      className={`inline-flex shrink-0 select-none items-center rounded-full bg-amber-400 font-semibold uppercase leading-none tracking-[0.08em] text-amber-950 ${sizeClasses} ${className}`}
    >
      PRO
    </span>
  );
}

export function TeamBadge({
  teamId,
  fallback,
  className = "",
}: {
  teamId?: string;
  fallback?: string;
  className?: string;
}) {
  const team = teamId ? teamsById.get(teamId) : null;

  if (!team) {
    return (
      <span
        className={`inline-block max-w-full truncate text-sm text-slate-300 ${className}`}
      >
        {fallback || "Por confirmar"}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex min-w-0 items-center gap-2 text-sm font-medium text-white ${className}`}
    >
      <Image
        className="h-3 w-5 shrink-0 rounded-sm object-cover"
        src={flagUrl(team)}
        alt=""
        width={28}
        height={20}
        unoptimized
      />
      <span className="truncate">{team.name}</span>
    </span>
  );
}

export function TeamFlag({
  teamId,
  className = "",
}: {
  teamId?: string;
  className?: string;
}) {
  const team = teamId ? teamsById.get(teamId) : null;
  if (!team) return null;

  return (
    <Image
      className={`object-cover ${className}`}
      src={flagUrl(team)}
      alt=""
      width={28}
      height={20}
      unoptimized
    />
  );
}

export function PlayerAvatar({
  player,
  className = "",
}: {
  player: Player;
  className?: string;
}) {
  const photo = playerPhotoUrl(player);

  return (
    <span
      className={`inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-zinc-900 text-sm font-bold text-lime-100 ${className}`}
      style={{ borderRadius: "9999px" }}
    >
      {photo ? (
        <Image
          className="h-full w-full object-cover"
          src={photo}
          alt=""
          width={48}
          height={48}
          unoptimized
        />
      ) : (
        initials(player.name)
      )}
    </span>
  );
}

export function TeamPicker({
  label,
  value,
  disabled,
  placeholder = "Elige un equipo",
  controlClassName = "",
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  controlClassName?: string;
  onChange: (value: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [teamQuery, setTeamQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const open = !disabled && menuOpen;
  const selected = value ? teamsById.get(value) : null;
  const filteredTeams = useMemo(() => {
    const normalizedQuery = normalizeTeamSearch(teamQuery.trim());
    if (!normalizedQuery) return teamsAlphabetically;

    return teamsAlphabetically.filter((team) =>
      normalizeTeamSearch(`${team.name} ${team.code}`).includes(
        normalizedQuery,
      ),
    );
  }, [teamQuery]);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && pickerRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div>
      <span className="text-sm text-zinc-300">{label}</span>
      <div ref={pickerRef} className={`relative ${controlClassName}`}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setMenuOpen((current) => {
              const next = !current;
              if (next) setTeamQuery("");
              return next;
            });
          }}
          className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0f0f0f] px-4 py-3 text-left text-white transition hover:border-white/20 disabled:opacity-40"
        >
          {selected ? (
            <TeamBadge teamId={selected.id} />
          ) : (
            <span className="min-w-0 truncate text-sm text-zinc-500">
              {disabled ? "Sin elegir" : placeholder}
            </span>
          )}
          <span className="shrink-0 text-xs text-zinc-500">
            {open ? "▲" : "▼"}
          </span>
        </button>

        {open && !disabled ? (
          <div className="absolute z-30 mt-2 w-full rounded-lg border border-white/10 bg-[#111] p-2 shadow-2xl shadow-black/30 backdrop-blur">
            <label className="mb-2 flex items-center rounded-lg border border-white/10 bg-black/25 px-3 py-2">
              <input
                ref={searchRef}
                value={teamQuery}
                onChange={(event) => setTeamQuery(event.target.value)}
                placeholder="Buscar pais"
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-white outline-none placeholder:text-zinc-500"
              />
            </label>
            <div className="team-picker-scroll max-h-64 overflow-y-auto pr-1">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setMenuOpen(false);
                }}
                className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5"
              >
                {placeholder}
              </button>
              {filteredTeams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => {
                    onChange(team.id);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center rounded-xl px-3 py-2 text-left hover:bg-white/5"
                >
                  <TeamBadge teamId={team.id} />
                </button>
              ))}
              {!filteredTeams.length ? (
                <p className="px-3 py-4 text-sm text-zinc-500">
                  No hay paises para esa busqueda.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Avatar({
  name,
  avatarUrl,
  className = "",
}: {
  name: string;
  avatarUrl?: string;
  className?: string;
}) {
  const preset = avatarUrl?.startsWith("preset:")
    ? avatarUrl.replace("preset:", "")
    : "";
  const hasCustomSize = /\b(size|h|w)-/.test(className);
  const sizeClass = hasCustomSize ? "" : "size-10";

  if (avatarUrl && !avatarUrl.startsWith("preset:")) {
    return (
      <span
        className={`inline-flex aspect-square shrink-0 ${sizeClass} overflow-hidden rounded-full border border-white/20 bg-cover bg-center ${className}`}
        style={{
          backgroundImage: `url("${avatarUrl}")`,
          borderRadius: "9999px",
        }}
      />
    );
  }

  const tones: Record<string, string> = {
    green: "from-emerald-500 to-teal-400",
    gold: "from-amber-500 to-yellow-300",
    blue: "from-sky-500 to-indigo-400",
    rose: "from-fuchsia-500 to-rose-400",
    dark: "from-slate-700 to-slate-500",
  };

  return (
    <span
      className={`inline-flex aspect-square shrink-0 ${sizeClass} items-center justify-center overflow-hidden rounded-full border border-white/15 bg-gradient-to-br ${
        tones[preset] || "from-cyan-500 to-blue-500"
      } text-sm font-bold text-slate-950 ${className}`}
      style={{ borderRadius: "9999px" }}
    >
      {initials(name)}
    </span>
  );
}

export function Notice({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "warm" | "danger" | "neutral";
}) {
  const toneClasses = {
    default: "border-cyan-400/20 bg-cyan-400/10 text-cyan-100",
    warm: "border-amber-400/20 bg-amber-400/10 text-amber-100",
    danger: "border-rose-400/20 bg-rose-400/10 text-rose-100",
    neutral: "border-white/10 bg-white/[0.06] text-zinc-300",
  };

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${toneClasses[tone]}`}>
      {children}
    </div>
  );
}

const scoreSections = [
  { label: "Tus elecciones", category: "Tus elecciones" },
  { label: "Tu once", category: "Tu once" },
  { label: "Fase de grupos", category: "Grupos y cuadro" },
  { label: "Resultados", category: "Marcadores" },
] as const;

const electionRuleByField: Record<string, string> = {
  worldChampion: "tournament_champion_hit",
  highestScoringTeam: "tournament_highest_scoring_team_hit",
  mostConcededTeam: "tournament_most_conceded_team_hit",
  mostRedsTeam: "tournament_most_reds_team_hit",
  topScorer: "tournament_top_scorer_hit",
  mvp: "tournament_mvp_hit",
};

function formatPoints(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function ProfileScoreCard({
  name,
  avatarUrl,
  isPro = false,
  eyebrow,
  subtitle,
  scorecard,
  rank,
}: {
  name: string;
  avatarUrl?: string;
  isPro?: boolean;
  eyebrow?: string;
  subtitle?: string;
  scorecard: Scorecard;
  rank?: number;
}) {
  const categoryTotal = (category: string) =>
    scorecard.categories.find((entry) => entry.label === category)?.total ?? 0;

  return (
    <Card className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar
            name={name}
            avatarUrl={avatarUrl}
            className="h-12 w-12 rounded-xl sm:h-14 sm:w-14"
          />
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#a7f600]">
                {eyebrow}
              </p>
            ) : null}
            <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-white sm:text-xl">
              <span className="truncate">{name}</span>
              {isPro ? <ProBadge size="md" /> : null}
            </h2>
            {subtitle ? (
              <p className="truncate text-sm text-slate-400">{subtitle}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-stretch gap-2">
          <div className="flex-1 rounded-lg border border-[#a7f600]/30 bg-[#a7f600]/10 px-4 py-2 sm:flex-none sm:text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#a7f600]">
              Puntos
            </p>
            <p className="text-2xl font-bold leading-none text-white sm:text-3xl">
              {scorecard.total}
            </p>
          </div>
          {rank ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 sm:text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                Puesto
              </p>
              <p className="text-2xl font-bold leading-none text-white sm:text-3xl">
                {rank}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {scoreSections.map((section) => {
          const total = categoryTotal(section.category);
          return (
            <div
              key={section.label}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
            >
              <span className="truncate text-[11px] font-semibold text-zinc-400">
                {section.label}
              </span>
              <span
                className={`shrink-0 text-sm font-bold ${
                  total < 0
                    ? "text-rose-300"
                    : total > 0
                      ? "text-[#a7f600]"
                      : "text-zinc-500"
                }`}
              >
                {formatPoints(total)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function ScoreBreakdown({
  scorecard,
  title,
}: {
  scorecard: Scorecard;
  title: string;
}) {
  return (
    <Card className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Detalle
          </p>
          <h3 className="text-xl font-semibold text-white">{title}</h3>
        </div>
        <div className="rounded-lg bg-white/10 px-4 py-2 sm:text-right">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
            Total
          </p>
          <p className="text-2xl font-bold text-white">{scorecard.total}</p>
        </div>
      </div>

      {scorecard.categories.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {scorecard.categories.map((category) => (
            <div
              key={category.label}
              className="rounded-lg border border-white/10 bg-[#0f0f0f] p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-4">
                <h4 className="font-semibold text-white">{category.label}</h4>
                <span className="text-sm font-semibold text-[#a7f600]">
                  {category.total} pts
                </span>
              </div>
              <div className="space-y-2 text-sm">
                {category.entries.map((entry) => (
                  <div
                    key={`${entry.ruleCode}-${entry.sourceRef}-${entry.matchNumber ?? "x"}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <p className="min-w-0 text-slate-300">
                      {entry.explanation}
                    </p>
                    <strong
                      className={`shrink-0 ${entry.points >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                    >
                      {entry.points > 0 ? `+${entry.points}` : entry.points}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          Todavía no hay puntos validados.
        </p>
      )}
    </Card>
  );
}

type SnapshotLineupRow = {
  count: number;
  position: Position;
};

type SnapshotLineupSlot = {
  id: string;
  row: number;
  index: number;
  position: Position;
  playerId?: string;
};

const lineupPositionLabels: Record<Position, string> = {
  POR: "Portero",
  DEF: "Defensa",
  MED: "Centro",
  DEL: "Delantero",
};

function formationRows(formation: string): SnapshotLineupRow[] {
  const parts = formation.split("-").map(Number).filter(Boolean);
  const defense = parts[0] || 4;
  const attack = parts[parts.length - 1] || 3;
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

function assignPlayersToSlots(
  playerIds: string[],
  formation: string,
): SnapshotLineupSlot[] {
  const baseSlots = lineupSlots(formation);
  const isPositionalSelection =
    playerIds.length >= baseSlots.length ||
    playerIds.some((playerId) => !playerId);

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
    const playerId = playerIds.find(
      (id) => !used.has(id) && playersById.get(id)?.position === slot.position,
    );
    if (playerId) used.add(playerId);
    return { ...slot, playerId };
  });
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

const lineupGoalPointsByPosition: Record<Position, number> = {
  DEL: 2,
  MED: 6,
  DEF: 11,
  POR: 35,
};

type LineupPlayerStats = {
  goals: number;
  penaltyGoals: number;
  saves: number;
  mvps: number;
  reds: number;
  missedPens: number;
};

function lineupEventStats(playerIds: string[], results?: AdminResults) {
  const selected = new Set(playerIds.filter(Boolean));
  const stats = new Map<string, LineupPlayerStats>();
  let totalPoints = 0;

  Object.values(results || {}).forEach((result) => {
    (result.events || []).forEach((event) => {
      if (!selected.has(event.playerId)) return;
      const entry = stats.get(event.playerId) || {
        goals: 0,
        penaltyGoals: 0,
        saves: 0,
        mvps: 0,
        reds: 0,
        missedPens: 0,
      };
      const position = playersById.get(event.playerId)?.position;

      switch (String(event.type)) {
        case "gol":
        case "goal":
          entry.goals += 1;
          totalPoints += position ? lineupGoalPointsByPosition[position] : 2;
          break;
        case "penalti marcado":
        case "penalty_goal":
          entry.penaltyGoals += 1;
          totalPoints += 1;
          break;
        case "penalti parado":
        case "penalty_save":
          entry.saves += 1;
          totalPoints += 2;
          break;
        case "MVP":
        case "mvp":
          entry.mvps += 1;
          totalPoints += 3;
          break;
        case "roja":
        case "red_card":
          entry.reds += 1;
          totalPoints -= 2;
          break;
        case "penalti fallado":
        case "penalty_miss":
          entry.missedPens += 1;
          totalPoints -= 1;
          break;
        default:
          break;
      }
      stats.set(event.playerId, entry);
    });
  });

  return { stats, totalPoints, hasEvents: stats.size > 0 };
}

const lineupLegendItems = [
  { icon: "⚽", label: "Gol" },
  { icon: "🥅", label: "Penalti marcado" },
  { icon: "🧤", label: "Penalti parado" },
  { icon: "⭐", label: "MVP" },
  { icon: "❌", label: "Penalti fallado" },
  { icon: "🟥", label: "Roja" },
] as const;

function LineupSnapshot({
  prediction,
  results,
}: {
  prediction: Prediction;
  results?: AdminResults;
}) {
  const formation = prediction.xiFormation || "4-3-3";
  const slots = assignPlayersToSlots(prediction.xi, formation);
  const rows = formationRows(formation);
  const filledCount = slots.filter((slot) => slot.playerId).length;
  const { stats, totalPoints, hasEvents } = lineupEventStats(
    prediction.xi,
    results,
  );

  return (
    <div className="overflow-hidden rounded-lg border border-emerald-300/15 bg-emerald-700 shadow-lg shadow-emerald-950/20">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-950/25 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-50/75">
          Once elegido
        </p>
        <div className="flex items-center gap-2">
          {hasEvents ? (
            <span
              className={`rounded-md px-3 py-1 text-xs font-bold ${
                totalPoints >= 0
                  ? "bg-[#a7f600] text-black"
                  : "bg-rose-400 text-black"
              }`}
            >
              {totalPoints > 0 ? `+${totalPoints}` : totalPoints} pts
            </span>
          ) : null}
          <span className="rounded-md bg-emerald-950/35 px-3 py-1 text-xs font-semibold text-emerald-50">
            {formation}
          </span>
          <span className="rounded-md bg-emerald-950/35 px-3 py-1 text-xs font-semibold text-emerald-50">
            {filledCount}/11
          </span>
        </div>
      </div>

      {hasEvents ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-emerald-950/15 px-4 py-2">
          {lineupLegendItems.map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-white"
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative mx-auto my-4 aspect-[7/8] w-full max-w-[560px] overflow-hidden rounded-lg border border-emerald-200/20 bg-emerald-600">
        <PitchLines />
        <div className="relative z-10 flex h-full flex-col justify-between px-2 py-4 sm:px-5 sm:py-5">
          {rows.map((row, rowIndex) => {
            const rowSlots = slots.filter((slot) => slot.row === rowIndex);
            return (
              <div
                key={`${row.position}-${rowIndex}`}
                className="grid items-center gap-1"
                style={{
                  gridTemplateColumns: `repeat(${row.count}, minmax(0, 1fr))`,
                }}
              >
                {rowSlots.map((slot) => (
                  <LineupSnapshotSlot
                    key={slot.id}
                    slot={slot}
                    stats={slot.playerId ? stats.get(slot.playerId) : undefined}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LineupSnapshotSlot({
  slot,
  stats,
}: {
  slot: SnapshotLineupSlot;
  stats?: LineupPlayerStats;
}) {
  const player = slot.playerId ? playersById.get(slot.playerId) : null;
  const hasStats = Boolean(
    stats &&
    (stats.goals ||
      stats.penaltyGoals ||
      stats.saves ||
      stats.mvps ||
      stats.reds ||
      stats.missedPens),
  );

  return (
    <div className="mx-auto flex w-12 flex-col items-center gap-0.5 text-center sm:w-[4.5rem]">
      <span className="relative inline-flex">
        {player ? (
          <PlayerAvatar
            player={player}
            className="h-9 w-9 rounded-full border-2 border-white bg-white text-xs text-emerald-900 shadow-lg sm:h-11 sm:w-11"
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-emerald-300 bg-emerald-700 shadow-[0_0_0_3px_#10b981] sm:h-11 sm:w-11">
            <span className="h-6 w-6 rounded-full border border-emerald-100 bg-emerald-600 sm:h-7 sm:w-7" />
          </span>
        )}
        {player ? (
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center overflow-hidden rounded-full border border-white bg-white shadow">
            <TeamFlag
              teamId={player.team}
              className="h-full w-full rounded-full"
            />
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate text-[10px] font-bold leading-tight text-white drop-shadow sm:text-xs">
        {player?.name || lineupPositionLabels[slot.position]}
      </span>
      {hasStats && stats ? (
        <span className="flex flex-wrap items-center justify-center gap-0.5">
          {stats.goals ? (
            <LineupEventPill icon="⚽" value={String(stats.goals)} />
          ) : null}
          {stats.penaltyGoals ? (
            <LineupEventPill icon="🥅" value={String(stats.penaltyGoals)} />
          ) : null}
          {stats.saves ? (
            <LineupEventPill icon="🧤" value={String(stats.saves)} />
          ) : null}
          {stats.mvps ? (
            <LineupEventPill icon="⭐" value={String(stats.mvps)} />
          ) : null}
          {stats.missedPens ? (
            <LineupEventPill icon="❌" value={`-${stats.missedPens}`} />
          ) : null}
          {stats.reds ? (
            <LineupEventPill icon="🟥" value={`-${stats.reds * 2}`} />
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function LineupEventPill({ icon, value }: { icon: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] sm:text-[10px]">
      <span aria-hidden="true">{icon}</span>
      {value}
    </span>
  );
}

function groupPointsByGroup(scorecard?: Scorecard) {
  const map = new Map<string, number>();
  scorecard?.entries.forEach((entry) => {
    if (!entry.ruleCode.startsWith("group_")) return;
    const group = entry.sourceRef.match(/-([A-L])-/)?.[1];
    if (!group) return;
    map.set(group, (map.get(group) || 0) + entry.points);
  });
  return map;
}

function GroupSummary({
  prediction,
  scorecard,
}: {
  prediction: Prediction;
  scorecard?: Scorecard;
}) {
  const thirdRows = prediction.bracket.thirdQualifiers.map((group) => ({
    group,
    teamId: orderedGroupTeams(group, prediction)[2]?.id || "",
  }));
  const groupPoints = groupPointsByGroup(scorecard);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Object.keys(prediction.groups).map((group) => {
          const ordered = orderedGroupTeams(group, prediction);
          const completedCount = Object.values(prediction.groups[group]).filter(
            Boolean,
          ).length;
          const points = groupPoints.get(group);
          const rows = ordered.map(
            (team, index) => [team.id, String(index + 1)] as const,
          );

          return (
            <div
              key={group}
              className="space-y-2 rounded-lg border border-white/10 bg-white/[0.04] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-bold text-white">Grupo {group}</h4>
                {points != null ? (
                  <span className="shrink-0 rounded-full border border-[#a7f600]/40 bg-[#a7f600]/12 px-2 py-0.5 text-[11px] font-bold text-[#a7f600]">
                    {formatPoints(points)} pts
                  </span>
                ) : (
                  <span
                    className={`text-xs font-semibold ${
                      completedCount === 4 ? "text-[#a7f600]" : "text-zinc-500"
                    }`}
                  >
                    {completedCount}/4
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {rows.length ? (
                  rows.map(([teamId, value]) => (
                    <div
                      key={teamId}
                      className={`grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2 rounded-lg border px-2 py-1.5 ${
                        Number(value) <= 2
                          ? "border-[#a7f600]/25 bg-[#a7f600]/10"
                          : "border-white/10 bg-white/[0.06]"
                      }`}
                    >
                      <span
                        className={`text-xs font-bold ${
                          Number(value) <= 2 ? "text-[#a7f600]" : "text-white"
                        }`}
                      >
                        {value}
                      </span>
                      <TeamBadge
                        teamId={teamId}
                        className="text-xs sm:text-sm"
                      />
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">Pendiente.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ThirdQualifiersSummary rows={thirdRows} />
    </div>
  );
}

type ThirdQualifierSummaryRow = {
  group: string;
  teamId: string;
};

function ThirdQualifiersSummary({
  rows,
}: {
  rows: ThirdQualifierSummaryRow[];
}) {
  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold text-white">Mejores terceros</h4>
        <span
          className={`text-xs font-semibold ${
            rows.length === 8 ? "text-[#a7f600]" : "text-zinc-500"
          }`}
        >
          {rows.length}/8
        </span>
      </div>

      {rows.length ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((row) => (
            <div
              key={row.group}
              className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 rounded-lg border border-[#a7f600]/35 bg-[#a7f600]/10 px-2 py-1.5"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#a7f600] text-xs font-bold text-black">
                {row.group}
              </span>
              {row.teamId ? (
                <TeamBadge teamId={row.teamId} className="text-xs sm:text-sm" />
              ) : (
                <span className="truncate text-xs font-medium text-zinc-500 sm:text-sm">
                  Grupo pendiente
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-400">
          Pendiente.
        </p>
      )}
    </div>
  );
}

const leftBracketRounds = [
  [74, 77, 73, 75, 83, 84, 81, 82],
  [89, 90, 93, 94],
  [97, 98],
  [101],
] as const;

const rightBracketRounds = [
  [76, 78, 79, 80, 86, 88, 85, 87],
  [91, 92, 95, 96],
  [99, 100],
  [102],
] as const;

const bracketRoundLabels = [
  "Dieciseisavos",
  "Octavos",
  "Cuartos",
  "Semis",
] as const;

export function KnockoutBracket({
  disabled = false,
  isMatchLocked,
  layout = "responsive",
  onWinnerSelect,
  prediction,
  matches,
}: {
  disabled?: boolean;
  isMatchLocked?: (match: Match) => boolean;
  layout?: "responsive" | "mobile";
  onWinnerSelect?: (matchNumber: number, teamId: string) => void;
  prediction: Prediction;
  matches: Match[];
}) {
  const matchByNumber = new Map(matches.map((match) => [match.number, match]));
  const champion = prediction.bracket.winners["104"] || "";
  const thirdPlaceMatch = matchByNumber.get(103);
  const finalMatch = matchByNumber.get(104);

  return (
    <>
      {layout === "responsive" ? (
        <div className="hidden w-full overflow-x-auto rounded-[18px] border border-white/10 bg-[#151515] p-3 text-white md:block">
          <div className="grid min-w-[1280px] grid-cols-[1fr_250px_1fr] gap-4 rounded-[16px] border border-white/10 bg-[#0f0f0f] px-3 py-4">
            <BracketTree
              disabled={disabled}
              isMatchLocked={isMatchLocked}
              rounds={leftBracketRounds}
              matchByNumber={matchByNumber}
              onWinnerSelect={onWinnerSelect}
              prediction={prediction}
            />

            <div className="flex h-[670px] flex-col items-center justify-center gap-5">
              <div className="text-center">
                <ChampionTrophyIcon />
                <p className="mt-3 text-xs font-bold uppercase tracking-[0.2em] text-[#a7f600]">
                  Campeón
                </p>
                <div className="mt-2 flex justify-center">
                  {champion ? (
                    <TeamBadge teamId={champion} />
                  ) : (
                    <span className="text-xs font-bold text-zinc-500">
                      Por decidir
                    </span>
                  )}
                </div>
              </div>

              <div className="grid w-full grid-cols-3 items-center gap-3">
                <div className="h-px bg-white/10" />
                {finalMatch ? (
                  <BracketMatchCard
                    disabled={disabled}
                    isMatchLocked={isMatchLocked}
                    match={finalMatch}
                    onWinnerSelect={onWinnerSelect}
                    prediction={prediction}
                    label="Final"
                    featured
                  />
                ) : null}
                <div className="h-px bg-white/10" />
              </div>

              {thirdPlaceMatch ? (
                <BracketMatchCard
                  disabled={disabled}
                  isMatchLocked={isMatchLocked}
                  match={thirdPlaceMatch}
                  onWinnerSelect={onWinnerSelect}
                  prediction={prediction}
                  label="Final de bronce"
                  tagTone="blue"
                />
              ) : null}
            </div>

            <BracketTree
              disabled={disabled}
              isMatchLocked={isMatchLocked}
              rounds={rightBracketRounds}
              matchByNumber={matchByNumber}
              onWinnerSelect={onWinnerSelect}
              prediction={prediction}
              reverse
            />
          </div>
        </div>
      ) : null}
      <MobileKnockoutBracket
        champion={champion}
        className={layout === "mobile" ? "" : "md:hidden"}
        finalMatch={finalMatch}
        matchByNumber={matchByNumber}
        disabled={disabled}
        isMatchLocked={isMatchLocked}
        onWinnerSelect={onWinnerSelect}
        prediction={prediction}
        thirdPlaceMatch={thirdPlaceMatch}
      />
    </>
  );
}

function ChampionTrophyIcon() {
  return (
    <span
      className="relative mx-auto inline-flex h-[72px] w-[53px] text-zinc-500"
      aria-hidden="true"
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 53 72"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M42.6182 0.265696C42.8928 0.265696 43.1121 0.488777 43.108 0.763023L43.0178 6.86398C42.6366 14.9952 41.2573 24.1702 33.7519 28.7935C32.2086 29.7431 29.8065 30.3427 28.9068 31.9289C27.7673 33.9407 28.8597 36.0119 30.9174 36.5706C31.1326 36.6299 31.2884 36.8182 31.2863 37.0413C31.2802 38.7359 31.0732 40.5758 30.5977 42.207C29.7184 45.2278 27.1995 47.7533 29.7553 50.7741C30.5382 51.6992 31.7044 52.3459 32.7333 52.9537C32.7579 52.9681 32.7845 52.9803 32.8112 52.9906L34.1987 53.5043C34.7111 53.6946 34.5758 54.4539 34.0286 54.4539H18.9543C18.403 54.4539 18.2697 53.6844 18.7903 53.5022L19.2105 53.3549C19.2228 53.3508 19.2351 53.3467 19.2474 53.3406C20.5447 52.7736 22.1946 51.8629 23.1025 50.7761C25.6583 47.7103 23.1497 45.2605 22.2602 42.209C21.7847 40.5758 21.5777 38.738 21.5715 37.0434C21.5715 36.8203 21.7252 36.632 21.9404 36.5726C23.1661 36.235 24.2503 35.2751 24.3794 33.955C24.6991 30.6538 21.176 30.1156 19.026 28.775C9.84206 23.0445 9.8687 10.4374 9.75393 0.760977C9.74983 0.488777 9.97118 0.265696 10.2438 0.265696H42.6182ZM13.5456 2.51493H12.5024C12.2277 2.51493 12.0064 2.74005 12.0125 3.0143C12.0986 7.29991 12.2031 11.6224 13.1787 15.8077C14.2854 20.564 16.6178 25.1075 21.1637 27.3608C21.2989 27.3076 21.0448 27.15 20.9997 27.1152C19.6511 26.0101 18.6427 24.9172 17.7553 23.4047C15.5398 19.6287 14.9454 15.163 14.5642 10.8651C14.5642 10.8528 14.5642 10.8406 14.5642 10.8262L14.472 3.42362C14.4658 2.91811 14.0538 2.51288 13.5497 2.51288L13.5456 2.51493ZM23.9018 37.995H23.4632C23.1784 37.995 22.955 38.2365 22.9734 38.519C23.0308 39.4318 23.1907 40.3261 23.4223 41.2041C23.5739 41.7813 24.4204 41.6482 24.3876 41.0506C24.3876 41.0363 24.3876 41.024 24.3855 41.0097C24.3425 40.1726 24.3958 39.3253 24.3937 38.4842C24.3937 38.214 24.1724 37.995 23.9018 37.995Z"
          fill="currentColor"
        />
        <path
          d="M37.9268 56.1723H14.9351C14.6137 56.1723 14.3531 56.4325 14.3531 56.7535V67.3488C14.3531 67.6698 14.6137 67.9301 14.9351 67.9301H37.9268C38.2483 67.9301 38.5089 67.6698 38.5089 67.3488V56.7535C38.5089 56.4325 38.2483 56.1723 37.9268 56.1723Z"
          fill="currentColor"
        />
        <path
          d="M39.5336 23.8836C39.8206 23.2799 40.2366 22.6884 40.5276 22.0928C40.7633 21.6098 41.0421 20.6029 41.3167 20.2345C41.6446 19.7945 43.0404 18.8408 43.5548 18.3619C46.9611 15.206 51.177 10.2757 50.7712 5.30651C50.4453 1.3238 45.961 -0.0556226 43.811 3.37041L43.4626 4.3446C43.2392 -0.567276 49.894 -1.59058 51.8226 2.70321C55.0199 9.81929 46.1495 19.1764 40.8535 22.9667L39.5316 23.8816L39.5336 23.8836Z"
          fill="currentColor"
        />
        <path
          d="M9.4424 4.56154L9.09808 3.59758C6.92763 0.177692 2.49039 1.59395 2.2096 5.59713C1.86528 10.5049 5.99509 15.2981 9.35222 18.4233C9.91379 18.9472 11.1558 19.7679 11.5637 20.2775C11.8219 20.6009 12.1252 21.661 12.3466 22.1133C12.6417 22.7109 13.0516 23.2778 13.3304 23.8836L12.0248 22.977C6.78621 19.2276 -2.05342 9.89297 1.20123 2.87513C3.14214 -1.30815 9.66785 -0.256191 9.4424 4.56154Z"
          fill="currentColor"
        />
        <path
          d="M39.5275 71.998H13.3078C12.986 71.998 12.7913 71.6398 12.9676 71.3717C13.3796 70.7413 13.8448 69.9411 14.2014 69.6484C14.2977 69.5686 14.3674 69.5236 14.5006 69.5379L38.2588 69.5441C38.3838 69.5441 38.5027 69.6034 38.5806 69.7017L39.8493 71.3471C40.0542 71.6132 39.8636 72 39.5275 72V71.998Z"
          fill="currentColor"
        />
      </svg>

      <svg
        className="absolute left-1/2 top-[29px] h-[23px] w-[22px] -translate-x-1/2 text-[#a7f600]"
        viewBox="0 0 22 23"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g clipPath="url(#champion-trophy-crest)">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M11.8241 0.664213C11.5665 0.551444 11.2877 0.495535 11.0067 0.500278C10.7222 0.496838 10.4402 0.552662 10.1784 0.664213L3.04819 3.81151C2.68674 3.97246 2.37963 4.23511 2.16411 4.5676C1.94859 4.9001 1.83391 5.28815 1.83398 5.6847V10.3653C1.83573 13.1137 2.73268 15.7864 4.38841 17.9768C6.04414 20.1672 8.36804 21.7554 11.0067 22.5C13.643 21.7532 15.9643 20.164 17.6177 17.9738C19.2711 15.7836 20.1663 13.1121 20.1673 10.3653V5.6847C20.1685 5.29703 20.0593 4.91708 19.8525 4.58952C19.6457 4.26197 19.3499 4.00041 19 3.83562L11.8241 0.664213ZM10.4115 16.4132C10.5545 16.471 10.7077 16.5005 10.8623 16.5C11.0164 16.5004 11.169 16.4707 11.3114 16.4127C11.4537 16.3547 11.5828 16.2695 11.6913 16.1621C11.7998 16.0546 11.8855 15.9271 11.9434 15.7869C12.0013 15.6467 12.0303 15.4966 12.0286 15.3454C12.0317 15.1942 12.0036 15.0439 11.9461 14.9037C11.8885 14.7634 11.8027 14.636 11.6938 14.5291C11.5849 14.4221 11.4551 14.3379 11.3122 14.2814C11.1693 14.2249 11.0163 14.1974 10.8623 14.2004C10.708 14.198 10.5548 14.2259 10.4116 14.2825C10.2685 14.339 10.1383 14.4231 10.0287 14.5298C9.91914 14.6365 9.83239 14.7636 9.77356 14.9036C9.71474 15.0437 9.68502 15.1939 9.68616 15.3454C9.6856 15.4971 9.71564 15.6475 9.77455 15.7879C9.83346 15.9282 9.92008 16.0557 10.0294 16.163C10.1387 16.2704 10.2686 16.3554 10.4115 16.4132ZM12.6448 10.8747C12.9529 10.5806 13.3077 10.2419 13.6724 9.71929L13.671 9.71791C13.9263 9.28925 14.0594 8.80102 14.0561 8.30448C14.0529 7.80793 13.9136 7.32139 13.6528 6.89594C13.3499 6.44247 12.9307 6.07522 12.4375 5.83106C11.9442 5.58689 11.3942 5.47441 10.8427 5.50489C10.2946 5.49658 9.75322 5.6241 9.26865 5.87565C8.78407 6.12721 8.37193 6.49467 8.07037 6.94405C7.95649 7.12397 7.91829 7.34029 7.96384 7.54734C8.00939 7.75439 8.13512 7.93596 8.31448 8.05371C8.49385 8.17145 8.7128 8.21616 8.92511 8.17838C9.13742 8.14061 9.32647 8.02331 9.45233 7.85126C9.59692 7.61123 9.80336 7.41282 10.0509 7.27601C10.2984 7.13919 10.5783 7.06879 10.8623 7.07189C11.1267 7.0449 11.3935 7.09313 11.6308 7.21084C11.868 7.32854 12.0658 7.51075 12.2006 7.73574C12.3353 7.96073 12.4013 8.21902 12.3907 8.4798C12.38 8.74059 12.2933 8.99287 12.1406 9.20658C11.9156 9.52136 11.6181 9.79067 11.3168 10.0633C10.9433 10.4014 10.5641 10.7446 10.3106 11.1859C10.1486 11.4671 10.0529 11.7804 10.0306 12.1028C10.0203 12.217 10.0343 12.3322 10.0719 12.4408C10.1095 12.5494 10.1697 12.6492 10.2488 12.7336C10.3279 12.8181 10.424 12.8855 10.5311 12.9314C10.6382 12.9773 10.7538 13.0008 10.8707 13.0004H10.9085C11.1179 12.9975 11.3191 12.9194 11.4738 12.7809C11.6286 12.6423 11.7264 12.4529 11.7486 12.2485C11.7708 12.0586 11.8312 11.875 11.9264 11.7083C12.1034 11.3915 12.3532 11.153 12.6448 10.8747Z"
            fill="currentColor"
          />
        </g>
        <defs>
          <clipPath id="champion-trophy-crest">
            <rect
              width="22"
              height="22"
              fill="white"
              transform="translate(0 0.5)"
            />
          </clipPath>
        </defs>
      </svg>
    </span>
  );
}

function MobileKnockoutBracket({
  champion,
  className = "md:hidden",
  disabled = false,
  finalMatch,
  isMatchLocked,
  matchByNumber,
  onWinnerSelect,
  prediction,
  thirdPlaceMatch,
}: {
  champion: string;
  className?: string;
  disabled?: boolean;
  finalMatch?: Match;
  isMatchLocked?: (match: Match) => boolean;
  matchByNumber: Map<number, Match>;
  onWinnerSelect?: (matchNumber: number, teamId: string) => void;
  prediction: Prediction;
  thirdPlaceMatch?: Match;
}) {
  return (
    <div
      className={`w-full rounded-[18px] border border-white/10 bg-[#151515] p-3 text-white ${className}`}
    >
      <div className="rounded-[16px] border border-white/10 bg-[#0f0f0f] px-3 py-4">
        <MobileBracketRound
          disabled={disabled}
          isMatchLocked={isMatchLocked}
          matchByNumber={matchByNumber}
          matchNumbers={leftBracketRounds[0]}
          onWinnerSelect={onWinnerSelect}
          prediction={prediction}
        />
        <MobileBracketJoin />
        <MobileBracketRound
          disabled={disabled}
          isMatchLocked={isMatchLocked}
          matchByNumber={matchByNumber}
          matchNumbers={[89, 90, 93, 94]}
          onWinnerSelect={onWinnerSelect}
          prediction={prediction}
        />
        <MobileBracketJoin />
        <MobileBracketRound
          disabled={disabled}
          isMatchLocked={isMatchLocked}
          matchByNumber={matchByNumber}
          matchNumbers={[97, 98]}
          onWinnerSelect={onWinnerSelect}
          prediction={prediction}
        />
        <MobileBracketJoin compact />
        <MobileBracketRound
          disabled={disabled}
          isMatchLocked={isMatchLocked}
          matchByNumber={matchByNumber}
          matchNumbers={[101]}
          onWinnerSelect={onWinnerSelect}
          prediction={prediction}
        />

        <div className="my-8 grid grid-cols-3 items-center gap-3">
          <div className="flex justify-center">
            {thirdPlaceMatch ? (
              <BracketMatchCard
                compact
                disabled={disabled}
                isMatchLocked={isMatchLocked}
                match={thirdPlaceMatch}
                onWinnerSelect={onWinnerSelect}
                prediction={prediction}
                label="Final de bronce"
                tagTone="blue"
              />
            ) : null}
          </div>
          <div className="flex justify-center">
            {finalMatch ? (
              <BracketMatchCard
                compact
                disabled={disabled}
                isMatchLocked={isMatchLocked}
                match={finalMatch}
                onWinnerSelect={onWinnerSelect}
                prediction={prediction}
                label="Final"
                featured
              />
            ) : null}
          </div>
          <div className="text-center">
            <ChampionTrophyIcon />
            <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#a7f600]">
              Campeón
            </p>
            <div className="mt-1 flex justify-center">
              {champion ? <TeamBadge teamId={champion} /> : null}
            </div>
          </div>
        </div>

        <MobileBracketRound
          disabled={disabled}
          isMatchLocked={isMatchLocked}
          matchByNumber={matchByNumber}
          matchNumbers={[102]}
          onWinnerSelect={onWinnerSelect}
          prediction={prediction}
        />
        <MobileBracketJoin compact />
        <MobileBracketRound
          disabled={disabled}
          isMatchLocked={isMatchLocked}
          matchByNumber={matchByNumber}
          matchNumbers={[99, 100]}
          onWinnerSelect={onWinnerSelect}
          prediction={prediction}
        />
        <MobileBracketJoin />
        <MobileBracketRound
          disabled={disabled}
          isMatchLocked={isMatchLocked}
          matchByNumber={matchByNumber}
          matchNumbers={[91, 92, 95, 96]}
          onWinnerSelect={onWinnerSelect}
          prediction={prediction}
        />
        <MobileBracketJoin />
        <MobileBracketRound
          disabled={disabled}
          isMatchLocked={isMatchLocked}
          matchByNumber={matchByNumber}
          matchNumbers={rightBracketRounds[0]}
          onWinnerSelect={onWinnerSelect}
          prediction={prediction}
        />
      </div>
    </div>
  );
}

function MobileBracketRound({
  disabled = false,
  isMatchLocked,
  matchByNumber,
  matchNumbers,
  onWinnerSelect,
  prediction,
}: {
  disabled?: boolean;
  isMatchLocked?: (match: Match) => boolean;
  matchByNumber: Map<number, Match>;
  matchNumbers: readonly number[];
  onWinnerSelect?: (matchNumber: number, teamId: string) => void;
  prediction: Prediction;
}) {
  const columns =
    matchNumbers.length === 1
      ? "grid-cols-1"
      : matchNumbers.length === 2
        ? "grid-cols-2"
        : "grid-cols-4";

  return (
    <div
      className={`mx-auto grid max-w-[340px] ${columns} justify-items-center gap-2`}
    >
      {matchNumbers.map((matchNumber) => {
        const match = matchByNumber.get(matchNumber);
        return match ? (
          <BracketMatchCard
            key={match.number}
            compact
            disabled={disabled}
            isMatchLocked={isMatchLocked}
            match={match}
            onWinnerSelect={onWinnerSelect}
            prediction={prediction}
          />
        ) : null;
      })}
    </div>
  );
}

function MobileBracketJoin({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`relative mx-auto ${compact ? "h-8" : "h-10"} w-[76%] max-w-[260px]`}
    >
      <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/10" />
      <span className="absolute left-[18%] right-[18%] top-1/2 h-px -translate-y-1/2 bg-white/10" />
    </div>
  );
}

function BracketTree({
  disabled = false,
  isMatchLocked,
  rounds,
  matchByNumber,
  onWinnerSelect,
  prediction,
  reverse = false,
}: {
  disabled?: boolean;
  isMatchLocked?: (match: Match) => boolean;
  rounds: readonly (readonly number[])[];
  matchByNumber: Map<number, Match>;
  onWinnerSelect?: (matchNumber: number, teamId: string) => void;
  prediction: Prediction;
  reverse?: boolean;
}) {
  const orderedRounds = reverse ? [...rounds].reverse() : rounds;
  const labels = reverse
    ? [...bracketRoundLabels].reverse()
    : bracketRoundLabels;

  return (
    <div className="grid h-[670px] grid-cols-4 gap-4">
      {orderedRounds.map((round, roundIndex) => (
        <div key={labels[roundIndex]} className="flex min-w-0 flex-col">
          <p className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            {labels[roundIndex]}
          </p>
          <div
            className="relative grid flex-1"
            style={{
              gridTemplateRows: `repeat(${round.length}, minmax(0, 1fr))`,
            }}
          >
            {!reverse && roundIndex < orderedRounds.length - 1 ? (
              <BracketVerticalConnectors count={round.length} side="right" />
            ) : null}
            {reverse && roundIndex > 0 ? (
              <BracketVerticalConnectors count={round.length} side="left" />
            ) : null}
            {round.map((matchNumber) => {
              const match = matchByNumber.get(matchNumber);
              return match ? (
                <div
                  key={match.number}
                  className="relative flex items-center justify-center"
                >
                  {roundIndex > 0 ? (
                    <BracketHorizontalConnector side="left" />
                  ) : null}
                  {roundIndex < orderedRounds.length - 1 ? (
                    <BracketHorizontalConnector side="right" />
                  ) : null}
                  <BracketMatchCard
                    disabled={disabled}
                    isMatchLocked={isMatchLocked}
                    match={match}
                    onWinnerSelect={onWinnerSelect}
                    prediction={prediction}
                  />
                </div>
              ) : null;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function BracketHorizontalConnector({ side }: { side: "left" | "right" }) {
  return (
    <span
      className={`absolute top-1/2 h-px w-5 -translate-y-1/2 bg-white/10 ${side === "right" ? "left-[calc(50%+41px)]" : "right-[calc(50%+41px)]"}`}
    />
  );
}

function BracketVerticalConnectors({
  count,
  side,
}: {
  count: number;
  side: "left" | "right";
}) {
  if (count < 2) return null;

  return (
    <>
      {Array.from({ length: Math.floor(count / 2) }, (_, pairIndex) => (
        <span
          key={`${side}-${pairIndex}`}
          className={`absolute w-px bg-white/10 ${side === "right" ? "left-[calc(50%+61px)]" : "right-[calc(50%+61px)]"}`}
          style={{
            height: `${100 / count}%`,
            top: `${((pairIndex * 2 + 0.5) / count) * 100}%`,
          }}
        />
      ))}
    </>
  );
}

function BracketMatchCard({
  disabled = false,
  isMatchLocked,
  match,
  onWinnerSelect,
  prediction,
  label,
  featured = false,
  tagTone = "gold",
  compact = false,
}: {
  disabled?: boolean;
  isMatchLocked?: (match: Match) => boolean;
  match: Match;
  onWinnerSelect?: (matchNumber: number, teamId: string) => void;
  prediction: Prediction;
  label?: string;
  featured?: boolean;
  tagTone?: "gold" | "blue";
  compact?: boolean;
}) {
  const home = resolveSlot(match.home, match.number, prediction);
  const away = resolveSlot(match.away, match.number, prediction);
  const current = prediction.matchPredictions[String(match.number)];
  const winner = prediction.bracket.winners[String(match.number)] || "";
  const matchLocked = disabled || Boolean(isMatchLocked?.(match));
  const canSelect = Boolean(onWinnerSelect && !matchLocked && home && away);
  const selectWinner = (teamId: string) => {
    if (!onWinnerSelect || !canSelect || !teamId) return;
    onWinnerSelect(match.number, teamId);
  };

  return (
    <div
      className={`relative z-10 mx-auto rounded-lg border bg-[#151515] px-1.5 py-2 text-center shadow-sm shadow-black/20 transition-colors ${
        winner ? "border-[#a7f600]/55" : "border-white/10"
      } ${featured ? (compact ? "w-[82px]" : "w-[98px]") : compact ? "w-[72px]" : "w-[88px]"}`}
    >
      <div className={`flex justify-center ${compact ? "gap-2" : "gap-3"}`}>
        <BracketTeamToken
          compact={compact}
          disabled={!canSelect}
          fallback={shortSlotLabel(match.home)}
          selected={Boolean(home && winner === home)}
          teamId={home}
          onSelect={selectWinner}
        />
        <BracketTeamToken
          compact={compact}
          disabled={!canSelect}
          fallback={shortSlotLabel(match.away)}
          selected={Boolean(away && winner === away)}
          teamId={away}
          onSelect={selectWinner}
        />
      </div>
      {current?.homeScore !== "" &&
      current?.awayScore !== "" &&
      current?.homeScore != null &&
      current?.awayScore != null ? (
        <div className="mt-1 rounded bg-white/10 px-1 py-0.5 text-[10px] font-bold text-white">
          {current.homeScore} - {current.awayScore}
        </div>
      ) : null}
      <p
        className={`${compact ? "text-[10px]" : "text-[11px]"} mt-1 font-medium leading-none text-zinc-500`}
      >
        {formatBracketDate(match)}
      </p>
      {label ? (
        <span
          className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-black ${tagTone === "blue" ? "bg-cyan-400" : "bg-white"}`}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

function BracketTeamToken({
  teamId,
  fallback,
  compact = false,
  disabled = true,
  selected = false,
  onSelect,
}: {
  teamId?: string;
  fallback: string;
  compact?: boolean;
  disabled?: boolean;
  selected?: boolean;
  onSelect?: (teamId: string) => void;
}) {
  const team = teamId ? teamsById.get(teamId) : null;
  const canSelect = Boolean(teamId && onSelect && !disabled);
  const className = `flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md border px-0.5 py-1 transition-colors ${
    selected
      ? "border-[#a7f600] bg-[#a7f600] text-black shadow-[0_0_16px_rgba(167,246,0,0.2)]"
      : canSelect
        ? "border-white/10 text-white hover:border-[#a7f600]/60 hover:bg-[#a7f600]/10 active:bg-[#a7f600]/15"
        : "border-transparent text-white"
  }`;
  const content = (
    <>
      {team ? (
        <TeamFlag
          teamId={team.id}
          className={`${compact ? "h-4 w-4" : "h-5 w-5"} rounded-full border ${
            selected ? "border-black/20" : "border-white/15"
          } object-cover`}
        />
      ) : (
        <span
          className={`${compact ? "h-4 w-4" : "h-5 w-5"} rounded-full ${
            selected ? "bg-black/20" : "bg-white/10"
          } shadow-inner`}
        />
      )}
      <span
        className={`${compact ? "max-w-[24px] text-[10px]" : "max-w-[34px] text-[11px]"} truncate font-bold leading-none ${
          selected ? "text-black" : "text-white"
        }`}
      >
        {team?.code.toUpperCase() || fallback}
      </span>
    </>
  );

  return canSelect ? (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Elegir ${team?.name || fallback}`}
      className={className}
      onClick={() => onSelect?.(teamId || "")}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function shortSlotLabel(slot: string) {
  if (teamsById.has(slot))
    return teamsById.get(slot)?.code.toUpperCase() || slot.toUpperCase();

  let match = String(slot).match(/^Winner Group ([A-L])$/);
  if (match) return `1${match[1]}`;

  match = String(slot).match(/^Runner-up Group ([A-L])$/);
  if (match) return `2${match[1]}`;

  match = String(slot).match(/^3rd Group ([A-L/]+)$/);
  if (match) return `3${match[1].replace(/\//g, "")}`;

  match = String(slot).match(/^Winner Match (\d+)$/);
  if (match) {
    const number = Number(match[1]);
    if (number >= 73 && number <= 88) return `EF${number - 72}`;
    if (number >= 89 && number <= 96) return `OF${number - 88}`;
    if (number >= 97 && number <= 100) return `WQ${number - 96}`;
    if (number >= 101 && number <= 102) return `WS${number - 100}`;
    return `W${number}`;
  }

  match = String(slot).match(/^Loser Match (\d+)$/);
  if (match) return `LS${Number(match[1]) - 100}`;

  return translateSlot(slot);
}

function formatBracketDate(match: Match) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${match.date}T12:00:00Z`))
    .replace(".", "");
}

function ResultsSummary({
  prediction,
  matches,
  results,
  maskUnstarted = false,
}: {
  prediction: Prediction;
  matches: Match[];
  results?: AdminResults;
  maskUnstarted?: boolean;
}) {
  const completedMatches = matches.filter((match) => {
    const score = prediction.matchPredictions[String(match.number)];
    return (
      score?.homeScore !== "" &&
      score?.awayScore !== "" &&
      score?.homeScore != null &&
      score?.awayScore != null
    );
  });
  const isHidden = (match: Match) => maskUnstarted && !hasMatchStarted(match);
  const hiddenCount = completedMatches.filter(isHidden).length;
  const matchesByDate = completedMatches.reduce<Record<string, Match[]>>(
    (grouped, match) => {
      const dateKey = snapshotResultDateKey(match);
      grouped[dateKey] ||= [];
      grouped[dateKey].push(match);
      return grouped;
    },
    {},
  );
  const dateKeys = Object.keys(matchesByDate).sort();

  if (!completedMatches.length) {
    return (
      <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
        Todavía no hay resultados elegidos.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {hiddenCount ? (
        <Notice tone="neutral">
          Los resultados elegidos se irán revelando a medida que empiece cada
          partido.
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-semibold text-white">Resultados elegidos</h4>
        <span className="text-sm font-semibold text-[#a7f600]">
          {completedMatches.length}/{matches.length}
        </span>
      </div>
      <div className="space-y-4">
        {dateKeys.map((dateKey) => (
          <section key={dateKey} className="space-y-2">
            <h5 className="pt-1 text-base font-semibold text-white first-letter:capitalize">
              {snapshotFormatResultsDay(dateKey)}
            </h5>
            <div className="grid gap-3 lg:grid-cols-2">
              {(matchesByDate[dateKey] || []).map((match) => {
                const score = prediction.matchPredictions[String(match.number)];
                const home = resolveSlot(match.home, match.number, prediction);
                const away = resolveSlot(match.away, match.number, prediction);
                const hidden = isHidden(match);
                const matchResult = results?.[String(match.number)];

                if (hasFinishedScore(matchResult)) {
                  return (
                    <FinishedMatchCard
                      key={match.number}
                      match={match}
                      result={matchResult as AdminResult}
                      pickHome={String(score.homeScore)}
                      pickAway={String(score.awayScore)}
                      hasPick
                      homeTeamId={home || undefined}
                      awayTeamId={away || undefined}
                    />
                  );
                }

                return (
                  <article
                    key={match.number}
                    className="flex h-full flex-col overflow-hidden rounded-[22px] text-white"
                    style={{
                      background:
                        "radial-gradient(250px at 0% 0%, rgba(0, 99, 75, 0.2) 0%, rgba(47, 47, 47, 0) 70%), radial-gradient(250px at 100% 0%, rgba(216, 159, 40, 0.2) 0%, rgba(47, 47, 47, 0) 70%), rgb(47, 47, 47)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 px-3 pb-0 pt-3 sm:px-4 sm:pt-4">
                      <span className="text-sm">{matchStageLabel(match)}</span>
                      <time className="inline-flex items-center text-sm font-semibold text-zinc-200">
                        {snapshotFormatResultTime(match)}
                      </time>
                    </div>

                    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start py-2 pb-4">
                      <SnapshotResultTeam
                        teamId={home}
                        fallback={translateSlot(match.home)}
                      />
                      <div className="flex h-full items-center justify-center pt-5">
                        <span
                          className={`rounded-lg bg-black/25 px-3 py-2 text-center text-xl font-bold text-white ${
                            hidden ? "select-none blur-sm" : ""
                          }`}
                          aria-label={
                            hidden
                              ? "Resultado oculto hasta el inicio del partido"
                              : undefined
                          }
                        >
                          {hidden
                            ? "? - ?"
                            : `${score.homeScore} - ${score.awayScore}`}
                        </span>
                      </div>
                      <SnapshotResultTeam
                        teamId={away}
                        fallback={translateSlot(match.away)}
                      />
                    </div>

                    <div className="mt-auto border-t border-white/10 px-3 py-2 sm:px-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-xs text-zinc-400">
                          {match.venue}
                        </p>
                        {hidden ? (
                          <span className="text-xs font-medium text-zinc-500">
                            Se revelará cuando empiece el partido
                          </span>
                        ) : !hasMatchStarted(match) ? (
                          <MatchCountdown
                            match={match}
                            className="text-xs font-semibold text-zinc-300"
                          />
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function snapshotResultDateKey(match: Match) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).format(new Date(scheduleUtc(match)));
}

function snapshotFormatResultsDay(dateKey: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Madrid",
    weekday: "long",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

function snapshotFormatResultTime(match: Match) {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(new Date(scheduleUtc(match)));
}

export function hasFinishedScore(result?: AdminResult) {
  return (
    result != null &&
    result.homeScore !== "" &&
    result.homeScore != null &&
    result.awayScore !== "" &&
    result.awayScore != null
  );
}

function FinishedPointsChip({
  hasPick,
  exact,
  outcomeHit,
  points,
}: {
  hasPick: boolean;
  exact: boolean;
  outcomeHit: boolean;
  points: number;
}) {
  if (!hasPick) {
    return (
      <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-bold text-zinc-500">
        Sin pronostico
      </span>
    );
  }

  const tone =
    exact || outcomeHit
      ? "border-[#a7f600]/40 bg-[#a7f600]/12 text-[#a7f600]"
      : "border-rose-400/30 bg-rose-400/10 text-rose-200";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${tone}`}
    >
      {exact ? <span aria-hidden="true">⚽</span> : null}
      {points > 0
        ? `+${points} ${points === 1 ? "punto" : "puntos"}`
        : "0 puntos"}
    </span>
  );
}

export function FinishedMatchCard({
  match,
  result,
  pickHome = "",
  pickAway = "",
  hasPick = false,
  showPick = true,
  homeTeamId,
  awayTeamId,
}: {
  match: Match;
  result: AdminResult;
  pickHome?: string;
  pickAway?: string;
  hasPick?: boolean;
  showPick?: boolean;
  homeTeamId?: string;
  awayTeamId?: string;
}) {
  const realHome = Number(result.homeScore);
  const realAway = Number(result.awayScore);
  const exact =
    showPick &&
    hasPick &&
    Number(pickHome) === realHome &&
    Number(pickAway) === realAway;
  const outcomeHit =
    showPick &&
    hasPick &&
    Math.sign(Number(pickHome) - Number(pickAway)) ===
      Math.sign(realHome - realAway);
  const missed = showPick && hasPick && !outcomeHit && !exact;
  const points = exact ? 1 + realHome + realAway : outcomeHit ? 1 : 0;
  const cardGlow =
    outcomeHit || exact
      ? "radial-gradient(340px at 50% 0%, rgba(167, 246, 0, 0.1) 0%, rgba(47, 47, 47, 0) 70%), "
      : missed
        ? "radial-gradient(340px at 50% 0%, rgba(251, 113, 133, 0.12) 0%, rgba(47, 47, 47, 0) 70%), "
        : "";
  const cardRing =
    outcomeHit || exact
      ? "shadow-[inset_0_0_0_1px_rgba(167,246,0,0.28)]"
      : missed
        ? "shadow-[inset_0_0_0_1px_rgba(251,113,133,0.25)]"
        : "";

  return (
    <article
      className={`flex h-full flex-col overflow-hidden rounded-[22px] text-white ${cardRing}`}
      style={{
        background: `${cardGlow}radial-gradient(250px at 0% 0%, rgba(0, 99, 75, 0.2) 0%, rgba(47, 47, 47, 0) 70%), radial-gradient(250px at 100% 0%, rgba(216, 159, 40, 0.2) 0%, rgba(47, 47, 47, 0) 70%), rgb(47, 47, 47)`,
      }}
    >
      <div className="flex items-center justify-between gap-3 px-3 pb-0 pt-3 sm:px-4 sm:pt-4">
        <span>{matchStageLabel(match)}</span>
        {showPick ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/25 px-2.5 py-1">
            <span className="text-[10px] font-bold uppercase leading-none tracking-[0.14em] text-zinc-400">
              Final
            </span>
            <span className="text-sm font-bold leading-none text-white">
              {realHome} - {realAway}
            </span>
          </span>
        ) : null}
      </div>

      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start py-2 pb-3">
        <SnapshotResultTeam
          teamId={homeTeamId}
          fallback={translateSlot(match.home)}
        />
        <div className="flex h-full flex-col items-center justify-start gap-1.5 pt-3">
          {showPick ? (
            <>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                Tu pronostico
              </span>
              {hasPick ? (
                <span
                  className={`rounded-lg px-4 py-1.5 text-2xl font-bold leading-none sm:text-3xl ${
                    exact
                      ? "border border-[#a7f600]/40 bg-[#a7f600]/15 text-[#a7f600]"
                      : "bg-black/30 text-white"
                  }`}
                >
                  {pickHome} - {pickAway}
                </span>
              ) : (
                <span className="rounded-lg bg-black/30 px-4 py-1.5 text-2xl font-bold leading-none text-zinc-600 sm:text-3xl">
                  ? - ?
                </span>
              )}
              <FinishedPointsChip
                hasPick={hasPick}
                exact={exact}
                outcomeHit={outcomeHit}
                points={points}
              />
            </>
          ) : (
            <>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                Resultado final
              </span>
              <span className="rounded-lg bg-black/30 px-4 py-1.5 text-2xl font-bold leading-none text-white sm:text-3xl">
                {realHome} - {realAway}
              </span>
            </>
          )}
        </div>
        <SnapshotResultTeam
          teamId={awayTeamId}
          fallback={translateSlot(match.away)}
        />
      </div>

      <div className="mt-auto border-t border-white/10 px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-zinc-400">
            {match.venue}
          </p>
          {showPick ? (
            <span
              className={`text-xs font-bold ${
                exact
                  ? "text-[#a7f600]"
                  : outcomeHit
                    ? "text-[#a7f600]/85"
                    : "text-zinc-500"
              }`}
            >
              {hasPick
                ? exact
                  ? "¡Marcador exacto!"
                  : outcomeHit
                    ? "Acertaste la eleccion"
                    : "Esta vez no sumaste"
                : "No rellenaste este resultado"}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function SnapshotResultTeam({
  teamId,
  fallback,
}: {
  teamId?: string;
  fallback: string;
}) {
  const team = teamId ? teamsById.get(teamId) : null;

  return (
    <div className="flex h-full w-full min-w-0 flex-col items-center justify-start gap-2 px-2 pt-4 sm:gap-3 sm:px-3">
      {team ? (
        <TeamFlag
          teamId={team.id}
          className="h-7 w-7 rounded-full border border-white/15 object-cover sm:h-8 sm:w-8"
        />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/10 text-[9px] font-bold text-zinc-300 sm:h-8 sm:w-8 sm:text-[10px]">
          TBD
        </span>
      )}
      <span className="line-clamp-2 w-full min-w-0 text-center text-[11px] font-bold leading-4 text-white sm:text-xs">
        {team?.name || fallback}
      </span>
    </div>
  );
}

function EyeOffIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function MaskableSection({
  masked,
  message,
  children,
}: {
  masked: boolean;
  message: string;
  children: React.ReactNode;
}) {
  if (!masked) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-white/10 bg-white/[0.04] px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-400">
        <EyeOffIcon className="h-6 w-6" />
      </span>
      <p className="max-w-md text-sm font-semibold text-zinc-300">{message}</p>
    </div>
  );
}

export function PredictionSnapshot({
  bracketLayout = "responsive",
  editHref,
  prediction,
  matches,
  playerName,
  profile,
  showBracket = true,
  maskUnstarted = false,
  results,
  scorecard,
}: {
  bracketLayout?: "responsive" | "mobile";
  editHref?: string;
  prediction: Prediction | null;
  matches: Match[];
  playerName: (playerId: string) => string;
  profile?: UserProfile;
  showBracket?: boolean;
  maskUnstarted?: boolean;
  results?: AdminResults;
  scorecard?: Scorecard;
}) {
  const maskedUntilTournament = maskUnstarted && !hasTournamentStarted();
  const safePrediction = prediction || emptyPrediction();
  const [section, setSection] = useState<
    "summary" | "groups" | "knockout" | "results"
  >("summary");
  const activeSection =
    !showBracket && section === "knockout" ? "summary" : section;

  const teamValue = (teamId: string) =>
    teamId ? <TeamBadge teamId={teamId} /> : "Pendiente";
  const playerValue = (playerId: string) => {
    if (!playerId) return "Pendiente";
    const player = playersById.get(playerId);
    if (!player) return playerName(playerId);
    return (
      <span className="flex min-w-0 max-w-full items-center gap-2">
        <PlayerAvatar player={player} className="h-6! w-6! text-[9px]!" />
        <span className="truncate">{player.name}</span>
      </span>
    );
  };
  const electionPoints = (field: string) =>
    scorecard?.entries.find(
      (entry) => entry.ruleCode === electionRuleByField[field],
    )?.points;

  return (
    <Card className="space-y-5">
      {profile ? (
        <div className="flex items-center gap-4">
          <Avatar name={profile.name} avatarUrl={profile.avatarUrl} />
          <div className="min-w-0">
            <h3 className="flex min-w-0 items-center gap-2 text-xl font-semibold text-white">
              <span className="truncate">{profile.name}</span>
              {profile.isPro ? <ProBadge /> : null}
            </h3>
            <p className="text-sm text-slate-400">
              {profile.points} puntos · {profile.complete}% completada
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button
            type="button"
            onClick={() => setSection("summary")}
            className={`rounded-lg px-3 py-2 text-sm sm:px-4 ${activeSection === "summary" ? "bg-[#a7f600] text-black" : "bg-white/10 text-zinc-200"}`}
          >
            Resumen
          </button>
          <button
            type="button"
            onClick={() => setSection("groups")}
            className={`rounded-lg px-3 py-2 text-sm sm:px-4 ${activeSection === "groups" ? "bg-[#a7f600] text-black" : "bg-white/10 text-zinc-200"}`}
          >
            Grupos
          </button>
          {showBracket ? (
            <button
              type="button"
              onClick={() => setSection("knockout")}
              className={`rounded-lg px-3 py-2 text-sm sm:px-4 ${activeSection === "knockout" ? "bg-[#a7f600] text-black" : "bg-white/10 text-zinc-200"}`}
            >
              Cuadro
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setSection("results")}
            className={`rounded-lg px-3 py-2 text-sm sm:px-4 ${activeSection === "results" ? "bg-[#a7f600] text-black" : "bg-white/10 text-zinc-200"}`}
          >
            Resultados
          </button>
        </div>
        {editHref ? (
          <Link
            href={editHref}
            className="inline-flex justify-center rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-bold text-white transition hover:bg-white/10"
          >
            Editar
          </Link>
        ) : null}
      </div>

      {activeSection === "summary" ? (
        <MaskableSection
          masked={maskedUntilTournament}
          message="Las elecciones se revelarán cuando empiece el torneo."
        >
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SummaryStat
                title="Campeon"
                value={teamValue(safePrediction.extras.worldChampion)}
                points={electionPoints("worldChampion")}
              />
              <SummaryStat
                title="Equipo mas goleador"
                value={teamValue(safePrediction.extras.highestScoringTeam)}
                points={electionPoints("highestScoringTeam")}
              />
              <SummaryStat
                title="Equipo mas goleado"
                value={teamValue(safePrediction.extras.mostConcededTeam)}
                points={electionPoints("mostConcededTeam")}
              />
              <SummaryStat
                title="Equipo con mas rojas"
                value={teamValue(safePrediction.extras.mostRedsTeam)}
                points={electionPoints("mostRedsTeam")}
              />
              <SummaryStat
                title="Maximo goleador"
                value={playerValue(safePrediction.extras.topScorer)}
                points={electionPoints("topScorer")}
              />
              <SummaryStat
                title="MVP"
                value={playerValue(safePrediction.extras.mvp)}
                points={electionPoints("mvp")}
              />
            </div>
            <LineupSnapshot prediction={safePrediction} results={results} />
          </div>
        </MaskableSection>
      ) : null}

      {activeSection === "groups" ? (
        <MaskableSection
          masked={maskedUntilTournament}
          message="Los grupos se revelarán cuando empiece el torneo."
        >
          <GroupSummary prediction={safePrediction} scorecard={scorecard} />
        </MaskableSection>
      ) : null}
      {showBracket && activeSection === "knockout" ? (
        <KnockoutBracket
          layout={bracketLayout}
          prediction={safePrediction}
          matches={matches.filter((match) => match.number >= 73)}
        />
      ) : null}
      {activeSection === "results" ? (
        <ResultsSummary
          prediction={safePrediction}
          matches={matches}
          results={results}
          maskUnstarted={maskUnstarted}
        />
      ) : null}
    </Card>
  );
}

function SummaryStat({
  title,
  value,
  points,
}: {
  title: string;
  value: React.ReactNode;
  points?: number;
}) {
  return (
    <div
      className={`rounded-lg border bg-white/5 p-4 ${
        points != null
          ? "border-[#a7f600]/30 bg-[#a7f600]/[0.06]"
          : "border-white/10"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase leading-4 tracking-[0.16em] text-slate-400">
          {title}
        </p>
        {points != null ? (
          <span className="shrink-0 rounded-full border border-[#a7f600]/40 bg-[#a7f600]/12 px-2 py-0.5 text-[11px] font-bold text-[#a7f600]">
            {formatPoints(points)}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-base font-semibold text-white">{value}</div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-md bg-white/[0.08] ${className}`}
    />
  );
}

export function LeaderboardRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Cargando clasificacion"
      className="divide-y divide-white/10"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
        >
          <Skeleton className="h-8 w-8 rounded-full" />
          <span className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <span className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-28 max-w-full" />
              <Skeleton className="h-3 w-20 max-w-full" />
            </span>
          </span>
          <span className="space-y-1.5">
            <Skeleton className="ml-auto h-4 w-10" />
            <Skeleton className="ml-auto h-3 w-6" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function ProfileScoreCardSkeleton() {
  return (
    <Card className="space-y-3">
      <div
        role="status"
        aria-label="Cargando perfil"
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="h-12 w-12 shrink-0 rounded-xl sm:h-14 sm:w-14" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-3.5 w-44" />
          </div>
        </div>
        <div className="flex shrink-0 items-stretch gap-2">
          <Skeleton className="h-14 w-24 rounded-lg" />
          <Skeleton className="h-14 w-20 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-9 rounded-lg" />
        ))}
      </div>
    </Card>
  );
}

export function PredictionSnapshotSkeleton() {
  return (
    <Card className="space-y-5">
      <div
        role="status"
        aria-label="Cargando porra"
        className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
      >
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full rounded-lg sm:w-28" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </Card>
  );
}

export function CardSkeleton({ className = "" }: { className?: string }) {
  return (
    <Card className={`space-y-3 ${className}`}>
      <div role="status" aria-label="Cargando" className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-4 py-14 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-lime-300/15 text-2xl font-bold text-lime-300">
        {icon}
      </div>
      <div className="space-y-2">
        <h3 className="text-xl font-semibold text-white">{title}</h3>
        <p className="max-w-xl text-sm text-slate-400">{description}</p>
      </div>
      {action}
    </Card>
  );
}

export function PrimaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-lg bg-[#a7f600] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#c7ff43]"
    >
      {children}
    </Link>
  );
}

export function ScheduleMeta({ match }: { match: Match }) {
  return (
    <div className="text-xs text-slate-400">
      <p>{formatScheduleDate(match)}</p>
      <p>{match.venue}</p>
    </div>
  );
}

export const matchEventIcons: Record<string, string> = {
  goal: "⚽",
  gol: "⚽",
  penalty_goal: "🥅",
  "penalti marcado": "🥅",
  mvp: "⭐",
  MVP: "⭐",
  penalty_save: "🧤",
  "penalti parado": "🧤",
  penalty_miss: "❌",
  "penalti fallado": "❌",
  red_card: "🟥",
  roja: "🟥",
};

const eventGoalPointsByPosition: Record<Position, number> = {
  DEL: 2,
  MED: 6,
  DEF: 11,
  POR: 35,
};

export function matchEventValue(type: string, playerId: string): number {
  const key = String(type);
  if (key === "gol" || key === "goal") {
    const position = playersById.get(playerId)?.position;
    return position ? eventGoalPointsByPosition[position] : 2;
  }
  if (key === "penalti marcado" || key === "penalty_goal") return 1;
  if (key === "mvp" || key === "MVP") return 3;
  if (key === "penalti parado" || key === "penalty_save") return 2;
  if (key === "penalti fallado" || key === "penalty_miss") return -1;
  if (key === "roja" || key === "red_card") return -2;
  return 0;
}

export function MatchEventLine({
  align = "left",
  event,
}: {
  align?: "left" | "right";
  event: AdminEvent;
}) {
  const playerName =
    (event.playerId ? playersById.get(event.playerId)?.name : "") || "Jugador";
  const icon = matchEventIcons[String(event.type)] || "";
  const points = matchEventValue(String(event.type), event.playerId);
  const pointsNode =
    points !== 0 ? (
      <span
        className={`shrink-0 font-semibold ${
          points > 0 ? "text-[#a7f600]" : "text-rose-300"
        }`}
      >
        {points > 0 ? `+${points}` : points}
      </span>
    ) : null;
  const iconNode = (
    <span aria-hidden="true" className="shrink-0 text-[13px]">
      {icon}
    </span>
  );

  return (
    <div
      className={`flex items-center gap-1.5 text-[12px] font-medium text-zinc-400 ${
        align === "right" ? "justify-end text-right" : ""
      }`}
    >
      {align === "right" ? (
        <>
          {pointsNode}
          <span className="min-w-0 truncate">{playerName}</span>
          {iconNode}
        </>
      ) : (
        <>
          {iconNode}
          <span className="min-w-0 truncate">{playerName}</span>
          {pointsNode}
        </>
      )}
    </div>
  );
}
