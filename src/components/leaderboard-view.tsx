"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  Avatar,
  Card,
  EmptyState,
  LeaderboardRowsSkeleton,
  PlayerAvatar,
  PositionBadge,
  ProBadge,
  RankNumber,
  SectionHeading,
  TeamBadge,
  TeamFlag,
  WolfBadge,
} from "@/components/common";
import { LeaderboardEvolution } from "@/components/leaderboard-evolution";
import { LeaderboardVersus } from "@/components/leaderboard-versus";
import { PlayerDetailModal } from "@/components/player-detail-modal";
import { useAppContext } from "@/lib/app-context";
import { data, schedule, teamsById } from "@/lib/data";
import { buildPlayerOwnersMap } from "@/lib/player-owners";
import {
  calculatePlayerStandings,
  calculateTeamStandings,
  type PlayerStandingRow,
  type TeamStandingRow,
} from "@/lib/scoring";
import type { Player, UserProfile } from "@/lib/types";

type LeaderboardFilter = "all" | "pro" | "players" | "teams" | "wolf";
type PlayerLeaderboardMetric =
  | "points"
  | "goals"
  | "mvps"
  | "penaltyGoals"
  | "penaltySaves"
  | "penaltyMisses"
  | "redCards";
type TeamLeaderboardMetric = "goalsFor" | "mostConcededScore" | "redCards";

const PLAYERS_PAGE_SIZE = 25;
const TEAMS_PAGE_SIZE = 25;

const PLAYER_LEADERBOARD_METRICS: Array<{
  key: PlayerLeaderboardMetric;
  label: string;
  header: string;
  valueLabel: string;
  emptyTitle: string;
  emptyDescription: string;
}> = [
  {
    key: "points",
    label: "Puntos",
    header: "Puntos",
    valueLabel: "pts",
    emptyTitle: "Aún no hay puntos de jugadores",
    emptyDescription:
      "Cuando se registren goles, MVP, penaltis o tarjetas en los partidos, los futbolistas aparecerán aquí.",
  },
  {
    key: "goals",
    label: "Goles",
    header: "Goles",
    valueLabel: "goles",
    emptyTitle: "Aún no hay goleadores",
    emptyDescription:
      "Cuando se registren goles o penaltis marcados, aparecerán aquí los máximos goleadores.",
  },
  {
    key: "mvps",
    label: "MVP",
    header: "MVP",
    valueLabel: "MVP",
    emptyTitle: "Aún no hay MVP",
    emptyDescription:
      "Cuando se marquen MVP de partido, aparecerán aquí los jugadores más decisivos.",
  },
  {
    key: "penaltyGoals",
    label: "Pen. marcados",
    header: "Pen. marcados",
    valueLabel: "pen.",
    emptyTitle: "Aún no hay penaltis marcados",
    emptyDescription:
      "Cuando se registren penaltis marcados, aparecerán aquí los especialistas.",
  },
  {
    key: "penaltySaves",
    label: "Pen. parados",
    header: "Pen. parados",
    valueLabel: "parados",
    emptyTitle: "Aún no hay penaltis parados",
    emptyDescription:
      "Cuando se registren penaltis parados, aparecerán aquí los porteros protagonistas.",
  },
  {
    key: "penaltyMisses",
    label: "Pen. fallados",
    header: "Pen. fallados",
    valueLabel: "fallados",
    emptyTitle: "Aún no hay penaltis fallados",
    emptyDescription:
      "Cuando se registren penaltis fallados, aparecerán aquí los jugadores afectados.",
  },
  {
    key: "redCards",
    label: "Rojas",
    header: "Rojas",
    valueLabel: "rojas",
    emptyTitle: "Aún no hay tarjetas rojas",
    emptyDescription:
      "Cuando se registren expulsiones, aparecerán aquí los jugadores con más rojas.",
  },
];

const TEAM_LEADERBOARD_METRICS: Array<{
  key: TeamLeaderboardMetric;
  label: string;
  header: string;
  valueLabel: string;
  emptyTitle: string;
  emptyDescription: string;
}> = [
  {
    key: "goalsFor",
    label: "Más goleadores",
    header: "GF",
    valueLabel: "goles",
    emptyTitle: "Aún no hay equipos goleadores",
    emptyDescription:
      "Cuando se registren goles, aparecerán aquí los equipos más goleadores.",
  },
  {
    key: "mostConcededScore",
    label: "Más goleados",
    header: "Avg contra",
    valueLabel: "GF-GC",
    emptyTitle: "Aún no hay equipos goleados",
    emptyDescription:
      "Se calcula en todo el Mundial como goles a favor menos goles encajados.",
  },
  {
    key: "redCards",
    label: "Rojas",
    header: "Rojas",
    valueLabel: "rojas",
    emptyTitle: "Aún no hay rojas por equipo",
    emptyDescription:
      "Cuando se registren expulsiones, aparecerán aquí los equipos con más rojas.",
  },
];

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function emptyPlayerStanding(player: Player): PlayerStandingRow {
  return {
    player,
    points: 0,
    goals: 0,
    penaltyGoals: 0,
    mvps: 0,
    penaltySaves: 0,
    penaltyMisses: 0,
    redCards: 0,
  };
}

function playerMetricValue(
  row: PlayerStandingRow,
  metric: PlayerLeaderboardMetric,
) {
  return row[metric];
}

function comparePlayerStandings(
  a: PlayerStandingRow,
  b: PlayerStandingRow,
  metric: PlayerLeaderboardMetric,
) {
  return (
    playerMetricValue(b, metric) - playerMetricValue(a, metric) ||
    b.points - a.points ||
    b.goals - a.goals ||
    b.mvps - a.mvps ||
    a.player.name.localeCompare(b.player.name)
  );
}

function teamMetricValue(
  row: TeamStandingRow,
  metric: TeamLeaderboardMetric,
) {
  return row[metric];
}

function compareTeamStandings(
  a: TeamStandingRow,
  b: TeamStandingRow,
  metric: TeamLeaderboardMetric,
) {
  return (
    teamMetricValue(b, metric) - teamMetricValue(a, metric) ||
    b.stageRank - a.stageRank ||
    b.groupPoints - a.groupPoints ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    a.team.name.localeCompare(b.team.name)
  );
}

function hasTeamMetric(row: TeamStandingRow, metric: TeamLeaderboardMetric) {
  if (metric === "mostConcededScore") return row.played > 0;
  return teamMetricValue(row, metric) > 0;
}

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function LeaderboardView() {
  const { leaderboard: fullLeaderboard, adminResults, ready, user } = useAppContext();
  const [filter, setFilter] = useState<LeaderboardFilter>("all");
  const [view, setView] = useState<"table" | "chart" | "vs">("table");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (tab === "jugadores") setFilter("players");
      if (tab === "equipos") setFilter("teams");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const leaderboard = fullLeaderboard.filter((profile) => !profile.isHidden);
  const proCount = leaderboard.filter((profile) => profile.isPro).length;
  // El tab de la manada y su clasificacion solo los ve quien tiene el tag 🐺
  // (y el admin, que puede verlo todo).
  const isWolf = Boolean(user?.isWolf || user?.isAdmin);
  const wolfCount = leaderboard.filter((profile) => profile.isWolf).length;
  const playerStandings = useMemo(
    () => calculatePlayerStandings(adminResults, data.players),
    [adminResults],
  );
  const teamStandings = useMemo(
    () => calculateTeamStandings(adminResults, data.teams, schedule),
    [adminResults],
  );
  // Mapa jugador -> participantes que lo tienen en su once (ver player-owners).
  const playerOwners = useMemo(
    () => buildPlayerOwnersMap(fullLeaderboard),
    [fullLeaderboard],
  );
  const visible =
    filter === "pro"
      ? leaderboard.filter((profile) => profile.isPro)
      : filter === "wolf"
        ? leaderboard.filter((profile) => profile.isWolf)
        : leaderboard;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Todos los participantes"
        title="Clasificación"
        description={
          filter === "players"
            ? "Los futbolistas que más puntos han sumado con goles, MVP, penaltis y tarjetas."
            : filter === "teams"
              ? "Las selecciones ordenadas por goles, goleados y tarjetas rojas."
            : filter === "wolf"
              ? "La clasificación de la manada 🐺. Solo visible para sus miembros."
              : "La tabla se ordena por puntos y muestra el campeón elegido por cada participante."
        }
      />

      {ready ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-white/10 bg-white/[0.04] p-1">
            <FilterTab
              active={filter === "all"}
              label="Todos"
              count={leaderboard.length}
              onClick={() => setFilter("all")}
            />
            {proCount > 0 ? (
              <FilterTab
                active={filter === "pro"}
                label="PRO"
                count={proCount}
                tone="pro"
                onClick={() => setFilter("pro")}
              />
            ) : null}
            <FilterTab
              active={filter === "players"}
              label="Jugadores"
              count={playerStandings.length}
              onClick={() => setFilter("players")}
            />
            <FilterTab
              active={filter === "teams"}
              label="Equipos"
              count={teamStandings.length}
              onClick={() => setFilter("teams")}
            />
            {isWolf ? (
              <FilterTab
                active={filter === "wolf"}
                label="🐺"
                count={wolfCount}
                tone="wolf"
                onClick={() => setFilter("wolf")}
              />
            ) : null}
          </div>

          {filter !== "players" && filter !== "teams" ? (
            <div className="flex w-full items-center gap-1 sm:w-auto">
              <ViewTab
                active={view === "table"}
                kind="table"
                label="Tabla"
                onClick={() => setView("table")}
              />
              <ViewTab
                active={view === "chart"}
                kind="chart"
                label="Evolución"
                onClick={() => setView("chart")}
              />
              <ViewTab
                active={view === "vs"}
                kind="vs"
                label="VS"
                onClick={() => setView("vs")}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {!ready ? (
        <Card className="overflow-hidden p-0">
          <LeaderboardHeaderRow />
          <LeaderboardRowsSkeleton rows={8} />
        </Card>
      ) : filter === "players" ? (
        <PlayerLeaderboard standings={playerStandings} owners={playerOwners} />
      ) : filter === "teams" ? (
        <TeamLeaderboard standings={teamStandings} />
      ) : !leaderboard.length ? (
        <EmptyState
          icon="0"
          title="Aún no hay participantes"
          description="Cuando la gente se registre o entre a la demo local, aparecerá aquí."
        />
      ) : !visible.length ? (
        <EmptyState
          icon="0"
          title={
            filter === "wolf"
              ? "Aún no hay miembros de la manada"
              : "Aún no hay jugadores PRO"
          }
          description={
            filter === "wolf"
              ? "Cuando alguien tenga el tag 🐺 aparecerá en esta vista."
              : "Cuando alguien tenga el badge PRO aparecerá en esta vista."
          }
        />
      ) : view === "chart" ? (
        <Card className="overflow-hidden">
          <LeaderboardEvolution
            key={filter}
            leaderboard={visible}
            adminResults={adminResults}
            currentUserId={user?.id}
            canSeeWolf={isWolf}
            subgroup={filter === "wolf"}
          />
        </Card>
      ) : view === "vs" ? (
        <LeaderboardVersus
          key={filter}
          leaderboard={visible}
          adminResults={adminResults}
          currentUserId={user?.id}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <LeaderboardHeaderRow />
          <div className="divide-y divide-white/10">
            {visible.map((profile, index) => (
              <LeaderboardRow
                key={profile.id}
                profile={profile}
                position={rankFor(visible, index)}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function TeamLeaderboard({ standings }: { standings: TeamStandingRow[] }) {
  const [query, setQuery] = useState("");
  const [metric, setMetric] = useState<TeamLeaderboardMetric>("goalsFor");
  const [limit, setLimit] = useState(TEAMS_PAGE_SIZE);

  const normalized = normalizeSearch(query.trim());
  const metricConfig =
    TEAM_LEADERBOARD_METRICS.find((item) => item.key === metric) ||
    TEAM_LEADERBOARD_METRICS[0];
  const metricCounts = useMemo(() => {
    const counts = {} as Record<TeamLeaderboardMetric, number>;
    TEAM_LEADERBOARD_METRICS.forEach((item) => {
      counts[item.key] = standings.filter((row) =>
        hasTeamMetric(row, item.key),
      ).length;
    });
    return counts;
  }, [standings]);

  const filtered = useMemo(
    () =>
      standings
        .filter((row) => {
          if (!hasTeamMetric(row, metric)) return false;
          if (!normalized) return true;
          return normalizeSearch(`${row.team.name} ${row.team.group}`).includes(
            normalized,
          );
        })
        .sort((a, b) => compareTeamStandings(a, b, metric)),
    [metric, normalized, standings],
  );
  const visible = filtered.slice(0, limit);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
          Ordenar por
        </span>
        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
          {TEAM_LEADERBOARD_METRICS.map((item) => (
            <StatMetricButton
              key={item.key}
              active={metric === item.key}
              label={item.label}
              count={metricCounts[item.key]}
              onClick={() => {
                setMetric(item.key);
                setLimit(TEAMS_PAGE_SIZE);
              }}
            />
          ))}
        </div>
      </div>

      <label className="flex w-full max-w-sm items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(TEAMS_PAGE_SIZE);
          }}
          placeholder="Buscar equipo o grupo"
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-white outline-none placeholder:text-zinc-500"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setLimit(TEAMS_PAGE_SIZE);
            }}
            className="text-xs font-semibold text-zinc-400 hover:text-white"
          >
            Borrar
          </button>
        ) : null}
      </label>

      {!filtered.length ? (
        <EmptyState
          icon="0"
          title={normalized ? "Sin resultados" : metricConfig.emptyTitle}
          description={
            normalized
              ? `Ningún equipo con ${metricConfig.label.toLowerCase()} coincide con esa búsqueda.`
              : metricConfig.emptyDescription
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <LeaderboardHeaderRow
            middleLabel="Equipo"
            rightLabel={metricConfig.header}
          />
          <div className="divide-y divide-white/10">
            {visible.map((row, index) => (
              <TeamRankRow
                key={row.team.id}
                row={row}
                metric={metric}
                metricConfig={metricConfig}
                position={rankForTeamMetric(filtered, index, metric)}
              />
            ))}
          </div>
          {filtered.length > limit ? (
            <button
              type="button"
              onClick={() => setLimit((current) => current + TEAMS_PAGE_SIZE)}
              className="w-full border-t border-white/10 px-4 py-3 text-sm font-bold text-zinc-300 transition hover:bg-white/5 hover:text-white"
            >
              Mostrar mas ({filtered.length - limit} restantes)
            </button>
          ) : null}
        </Card>
      )}
    </div>
  );
}

function TeamRankRow({
  row,
  metric,
  metricConfig,
  position,
}: {
  row: TeamStandingRow;
  metric: TeamLeaderboardMetric;
  metricConfig: (typeof TEAM_LEADERBOARD_METRICS)[number];
  position: number;
}) {
  const metricValue = teamMetricValue(row, metric);
  const value =
    metric === "mostConcededScore"
        ? formatSigned(row.goalDifference)
        : metricValue;
  const valueTone =
    metric === "mostConcededScore"
      ? row.goalDifference < 0
        ? "text-red-400"
        : row.goalDifference > 0
          ? "text-emerald-300"
          : "text-white"
      : "text-white";

  return (
    <div className="grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
      <span
        className="flex h-8 w-8 items-center justify-center text-sm font-bold text-zinc-300"
        aria-label={`Puesto ${position}`}
      >
        <RankNumber position={position} />
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <TeamFlag
          teamId={row.team.id}
          className="h-7 w-9 shrink-0 rounded-md object-cover ring-1 ring-white/10"
        />
        <span className="min-w-0">
          <strong className="flex min-w-0 items-center gap-2 text-sm text-white">
            <span className="truncate">{row.team.name}</span>
            <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
              Grupo {row.team.group}
            </span>
            {row.isEliminated ? (
              <span className="rounded-full border border-red-400/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
                Eliminado
              </span>
            ) : null}
          </strong>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-zinc-500">
            <span>PJ {row.played}</span>
            <span>GF {row.goalsFor}</span>
            <span>GC {row.goalsAgainst}</span>
            <span>DG {formatSigned(row.goalDifference)}</span>
            <span>Rojas {row.redCards}</span>
            {row.groupPosition ? (
              <span>Grupo #{row.groupPosition}</span>
            ) : null}
          </span>
        </span>
      </span>
      <span className="text-right">
        <strong
          className={`block max-w-24 truncate text-lg font-bold sm:max-w-none ${valueTone}`}
        >
          {value}
        </strong>
        <span className="text-xs font-semibold text-zinc-500">
          {metricConfig.valueLabel}
        </span>
        <span className="mt-0.5 block text-[11px] font-semibold text-zinc-600">
          {row.stageLabel}
        </span>
      </span>
    </div>
  );
}

function PlayerLeaderboard({
  standings,
  owners,
}: {
  standings: PlayerStandingRow[];
  owners: Map<string, UserProfile[]>;
}) {
  const [query, setQuery] = useState("");
  const [metric, setMetric] = useState<PlayerLeaderboardMetric>("points");
  const [limit, setLimit] = useState(PLAYERS_PAGE_SIZE);
  const [selected, setSelected] = useState<string | null>(null);

  const normalized = normalizeSearch(query.trim());
  const metricConfig =
    PLAYER_LEADERBOARD_METRICS.find((item) => item.key === metric) ||
    PLAYER_LEADERBOARD_METRICS[0];
  const metricCounts = useMemo(() => {
    const counts = {} as Record<PlayerLeaderboardMetric, number>;
    PLAYER_LEADERBOARD_METRICS.forEach((item) => {
      counts[item.key] =
        item.key === "points"
          ? standings.length
          : standings.filter((row) => playerMetricValue(row, item.key) > 0)
              .length;
    });
    return counts;
  }, [standings]);

  const filtered = useMemo(() => {
    const scoredRows = new Map(
      standings.map((row) => [row.player.id, row] as const),
    );
    const rows = normalized
      ? data.players.map(
          (player) => scoredRows.get(player.id) || emptyPlayerStanding(player),
        )
      : standings;

    return rows
      .filter((row) => {
        if (metric !== "points" && playerMetricValue(row, metric) <= 0) {
          return false;
        }
        if (!normalized) return true;

        const team = teamsById.get(row.player.team)?.name || "";
        return normalizeSearch(`${row.player.name} ${team}`).includes(
          normalized,
        );
      })
      .sort((a, b) => comparePlayerStandings(a, b, metric));
  }, [metric, normalized, standings]);
  const visible = filtered.slice(0, limit);

  if (!standings.length) {
    return (
      <EmptyState
        icon="0"
        title="Aún no hay puntos de jugadores"
        description="Cuando se registren goles, MVP, penaltis o tarjetas en los partidos, los futbolistas aparecerán aquí."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
          Ordenar por
        </span>
        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
          {PLAYER_LEADERBOARD_METRICS.map((item) => (
            <StatMetricButton
              key={item.key}
              active={metric === item.key}
              label={item.label}
              count={metricCounts[item.key]}
              onClick={() => {
                setMetric(item.key);
                setLimit(PLAYERS_PAGE_SIZE);
              }}
            />
          ))}
        </div>
      </div>

      <label className="flex w-full max-w-sm items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(PLAYERS_PAGE_SIZE);
          }}
          placeholder="Buscar jugador o país"
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-white outline-none placeholder:text-zinc-500"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setLimit(PLAYERS_PAGE_SIZE);
            }}
            className="text-xs font-semibold text-zinc-400 hover:text-white"
          >
            Borrar
          </button>
        ) : null}
      </label>

      {!filtered.length ? (
        <EmptyState
          icon="0"
          title={normalized ? "Sin resultados" : metricConfig.emptyTitle}
          description={
            normalized
              ? `Ningún jugador con ${metricConfig.label.toLowerCase()} coincide con esa búsqueda.`
              : metricConfig.emptyDescription
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <LeaderboardHeaderRow rightLabel={metricConfig.header} />
          <div className="divide-y divide-white/10">
            {visible.map((row, index) => (
              <PlayerRankRow
                key={row.player.id}
                row={row}
                metric={metric}
                metricConfig={metricConfig}
                position={rankForPlayerMetric(filtered, index, metric)}
                owners={owners.get(row.player.id)}
                onSelect={setSelected}
              />
            ))}
          </div>
          {filtered.length > limit ? (
            <button
              type="button"
              onClick={() => setLimit((current) => current + PLAYERS_PAGE_SIZE)}
              className="w-full border-t border-white/10 px-4 py-3 text-sm font-bold text-zinc-300 transition hover:bg-white/5 hover:text-white"
            >
              Mostrar mas ({filtered.length - limit} restantes)
            </button>
          ) : null}
        </Card>
      )}

      {selected ? (
        <PlayerDetailModal
          playerId={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function PlayerRankRow({
  row,
  metric,
  metricConfig,
  position,
  owners,
  onSelect,
}: {
  row: PlayerStandingRow;
  metric: PlayerLeaderboardMetric;
  metricConfig: (typeof PLAYER_LEADERBOARD_METRICS)[number];
  position: number;
  owners?: UserProfile[];
  onSelect: (playerId: string) => void;
}) {
  const value = playerMetricValue(row, metric);

  return (
    <button
      type="button"
      onClick={() => onSelect(row.player.id)}
      className="grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-white/5"
    >
      <span
        className="flex h-8 w-8 items-center justify-center text-sm font-bold text-zinc-300"
        aria-label={`Puesto ${position}`}
      >
        <RankNumber position={position} />
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <PlayerAvatar player={row.player} className="size-10! text-xs" />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <TeamFlag
              teamId={row.player.team}
              className="h-3.5 w-[18px] shrink-0 rounded-sm"
            />
            <strong className="min-w-0 truncate text-sm text-white">
              {row.player.name}
            </strong>
            <PositionBadge position={row.player.position} />
          </span>
          {owners?.length ? <OwnersStack owners={owners} /> : null}
        </span>
      </span>
      <span className="text-right">
        <strong className="block text-lg font-bold text-white">
          {value}
        </strong>
        <span className="text-xs font-semibold text-zinc-500">
          {metricConfig.valueLabel}
        </span>
        {metric !== "points" ? (
          <span className="mt-0.5 block text-[11px] font-semibold text-zinc-600">
            {row.points} pts
          </span>
        ) : null}
      </span>
    </button>
  );
}

const OWNERS_AVATAR_LIMIT = 6;

// Avatares apilados de los participantes que tienen al futbolista en su once.
// Es solo un adelanto visual; la lista completa esta en el modal de detalle.
function OwnersStack({ owners }: { owners: UserProfile[] }) {
  const shown = owners.slice(0, OWNERS_AVATAR_LIMIT);
  const extra = owners.length - shown.length;

  return (
    <span className="mt-1.5 flex items-center gap-2">
      <span className="flex -space-x-2">
        {shown.map((owner) => (
          <Avatar
            key={owner.id}
            name={owner.name}
            avatarUrl={owner.avatarUrl}
            className="size-6! text-[9px]! ring-2 ring-zinc-900"
          />
        ))}
        {extra > 0 ? (
          <span className="z-10 flex size-6 items-center justify-center rounded-full border border-white/15 bg-white/10 text-[9px] font-bold text-zinc-200 ring-2 ring-zinc-900">
            +{extra}
          </span>
        ) : null}
      </span>
      <span className="text-xs font-semibold text-zinc-400">
        {owners.length} {owners.length === 1 ? "lo tiene" : "lo tienen"}
      </span>
    </span>
  );
}

function FilterTab({
  active,
  count,
  label,
  onClick,
  tone = "default",
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
  tone?: "default" | "pro" | "wolf";
}) {
  const activeClass =
    tone === "pro"
      ? "bg-amber-400 text-amber-950"
      : tone === "wolf"
        ? "bg-zinc-100 text-zinc-900"
        : "bg-zinc-200 text-zinc-900";
  const activeCountClass =
    tone === "pro"
      ? "bg-amber-950/15 text-amber-950"
      : "bg-black/10 text-zinc-900";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-bold transition ${
        active
          ? activeClass
          : "text-zinc-300 hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 text-[11px] font-bold ${
          active ? activeCountClass : "bg-white/10 text-zinc-400"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function StatMetricButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
        active
          ? "border-[#a7f600]/50 bg-[#a7f600]/10 text-[#d7ff6a] shadow-[inset_0_0_0_1px_rgba(167,246,0,0.08)]"
          : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      <span>{label}</span>
      <span
        className={`rounded-full px-1.5 text-[10px] font-bold ${
          active
            ? "bg-[#a7f600]/15 text-[#d7ff6a]"
            : "bg-white/10 text-zinc-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function ViewTab({
  active,
  kind,
  label,
  onClick,
}: {
  active: boolean;
  kind: "table" | "chart" | "vs";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-bold transition sm:flex-none ${
        active
          ? "border-[#a7f600]/40 bg-[#a7f600]/15 text-[#a7f600]"
          : "border-transparent text-zinc-400 hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {kind === "table" ? (
          <>
            <line x1="2.5" y1="4" x2="13.5" y2="4" />
            <line x1="2.5" y1="8" x2="13.5" y2="8" />
            <line x1="2.5" y1="12" x2="13.5" y2="12" />
          </>
        ) : kind === "chart" ? (
          <polyline points="2 11 6 7 9 9 14 3" />
        ) : (
          <>
            <polyline points="4 4 7 8 4 12" />
            <polyline points="12 4 9 8 12 12" />
          </>
        )}
      </svg>
      {label}
    </button>
  );
}

function LeaderboardHeaderRow({
  middleLabel = "Jugador",
  rightLabel = "Puntos",
}: {
  middleLabel?: string;
  rightLabel?: string;
} = {}) {
  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
      <span>#</span>
      <span>{middleLabel}</span>
      <span className="text-right">{rightLabel}</span>
    </div>
  );
}

function LeaderboardRow({
  profile,
  position,
}: {
  profile: UserProfile;
  position: number;
}) {
  return (
    <Link
      href={`/perfil/${encodeURIComponent(profile.id)}`}
      className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/5"
    >
      <span
        className="flex h-8 w-8 items-center justify-center text-sm font-bold text-zinc-300"
        aria-label={`Puesto ${position}`}
      >
        <RankNumber position={position} />
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <Avatar
          name={profile.name}
          avatarUrl={profile.avatarUrl}
          className="size-10"
        />
        <span className="min-w-0">
          <strong className="flex min-w-0 items-center gap-1.5 text-sm text-white">
            <span className="truncate">{profile.name}</span>
            {profile.isPro ? <ProBadge /> : null}
            {profile.isWolf ? <WolfBadge /> : null}
          </strong>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
            {profile.champion ? (
              <TeamBadge
                teamId={profile.champion}
                className="text-xs text-zinc-400"
              />
            ) : (
              <span>Pendiente</span>
            )}
          </span>
        </span>
      </span>
      <span className="text-right">
        <strong className="block text-lg font-bold text-white">
          {profile.points}
        </strong>
        <span className="text-xs font-semibold text-zinc-500">pts</span>
      </span>
    </Link>
  );
}

function rankFor(leaderboard: Array<{ points: number }>, index: number) {
  let rank = index + 1;
  while (
    rank > 1 &&
    leaderboard[index].points === leaderboard[rank - 2].points
  ) {
    rank -= 1;
  }
  return rank;
}

function rankForPlayerMetric(
  leaderboard: PlayerStandingRow[],
  index: number,
  metric: PlayerLeaderboardMetric,
) {
  let rank = index + 1;
  while (
    rank > 1 &&
    playerMetricValue(leaderboard[index], metric) ===
      playerMetricValue(leaderboard[rank - 2], metric)
  ) {
    rank -= 1;
  }
  return rank;
}

function rankForTeamMetric(
  leaderboard: TeamStandingRow[],
  index: number,
  metric: TeamLeaderboardMetric,
) {
  let rank = index + 1;
  while (
    rank > 1 &&
    teamMetricValue(leaderboard[index], metric) ===
      teamMetricValue(leaderboard[rank - 2], metric)
  ) {
    rank -= 1;
  }
  return rank;
}

