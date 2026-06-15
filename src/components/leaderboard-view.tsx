"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  Avatar,
  Card,
  EmptyState,
  LeaderboardRowsSkeleton,
  PlayerAvatar,
  ProBadge,
  RankNumber,
  SectionHeading,
  TeamBadge,
  TeamFlag,
  WolfBadge,
} from "@/components/common";
import { LeaderboardEvolution } from "@/components/leaderboard-evolution";
import { useAppContext } from "@/lib/app-context";
import { data, teamsById } from "@/lib/data";
import {
  calculatePlayerStandings,
  type PlayerStandingRow,
} from "@/lib/scoring";
import type { Position, UserProfile } from "@/lib/types";

type LeaderboardFilter = "all" | "pro" | "players" | "wolf";

const PLAYERS_PAGE_SIZE = 25;

const positionLabels: Record<Position, string> = {
  POR: "Portero",
  DEF: "Defensa",
  MED: "Centrocampista",
  DEL: "Delantero",
};

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function LeaderboardView() {
  const { leaderboard: fullLeaderboard, adminResults, ready, user } = useAppContext();
  const [filter, setFilter] = useState<LeaderboardFilter>("all");
  const [view, setView] = useState<"table" | "chart">("table");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (tab === "jugadores") setFilter("players");
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

          {filter !== "players" ? (
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
        <PlayerLeaderboard standings={playerStandings} />
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

function PlayerLeaderboard({ standings }: { standings: PlayerStandingRow[] }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PLAYERS_PAGE_SIZE);

  const normalized = normalizeSearch(query.trim());
  const filtered = normalized
    ? standings.filter(({ player }) => {
        const team = teamsById.get(player.team)?.name || "";
        return normalizeSearch(`${player.name} ${team}`).includes(normalized);
      })
    : standings;
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
          title="Sin resultados"
          description="Ningún jugador con puntos coincide con esa búsqueda."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <LeaderboardHeaderRow />
          <div className="divide-y divide-white/10">
            {visible.map((row, index) => (
              <PlayerRankRow
                key={row.player.id}
                row={row}
                position={rankFor(filtered, index)}
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
    </div>
  );
}

function PlayerRankRow({
  row,
  position,
}: {
  row: PlayerStandingRow;
  position: number;
}) {
  const teamName = teamsById.get(row.player.team)?.name || "Sin país";

  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
      <span
        className="flex h-8 w-8 items-center justify-center text-sm font-bold text-zinc-300"
        aria-label={`Puesto ${position}`}
      >
        <RankNumber position={position} />
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <PlayerAvatar player={row.player} className="size-10! text-xs" />
        <span className="min-w-0">
          <strong className="block truncate text-sm text-white">
            {row.player.name}
          </strong>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
            <TeamFlag
              teamId={row.player.team}
              className="h-3.5 w-[18px] rounded-sm"
            />
            <span className="truncate">{teamName}</span>
            <span>·</span>
            <span className="whitespace-nowrap">
              {positionLabels[row.player.position]}
            </span>
            {row.goals > 0 ? (
              <>
                <span>·</span>
                <span className="whitespace-nowrap">
                  {row.goals} {row.goals === 1 ? "gol" : "goles"}
                </span>
              </>
            ) : null}
            {row.mvps > 0 ? (
              <>
                <span>·</span>
                <span className="whitespace-nowrap">{row.mvps} MVP</span>
              </>
            ) : null}
          </span>
        </span>
      </span>
      <span className="text-right">
        <strong className="block text-lg font-bold text-white">
          {row.points}
        </strong>
        <span className="text-xs font-semibold text-zinc-500">pts</span>
      </span>
    </div>
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

function ViewTab({
  active,
  kind,
  label,
  onClick,
}: {
  active: boolean;
  kind: "table" | "chart";
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
        ) : (
          <polyline points="2 11 6 7 9 9 14 3" />
        )}
      </svg>
      {label}
    </button>
  );
}

function LeaderboardHeaderRow() {
  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
      <span>#</span>
      <span>Jugador</span>
      <span className="text-right">Puntos</span>
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

