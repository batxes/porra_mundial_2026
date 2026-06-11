"use client";

import Link from "next/link";
import { useState } from "react";

import {
  Avatar,
  Card,
  EmptyState,
  LeaderboardRowsSkeleton,
  ProBadge,
  SectionHeading,
  TeamBadge,
} from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import type { UserProfile } from "@/lib/types";

type LeaderboardFilter = "all" | "pro";

export function LeaderboardView() {
  const { leaderboard: fullLeaderboard, ready } = useAppContext();
  const [filter, setFilter] = useState<LeaderboardFilter>("all");
  const leaderboard = fullLeaderboard.filter((profile) => !profile.isHidden);
  const proCount = leaderboard.filter((profile) => profile.isPro).length;
  const visible =
    filter === "pro"
      ? leaderboard.filter((profile) => profile.isPro)
      : leaderboard;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Todos los participantes"
        title="Clasificacion"
        description="La tabla se ordena por puntos y muestra el campeon elegido por cada participante."
      />

      {ready && proCount > 0 ? (
        <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.04] p-1">
          <FilterTab
            active={filter === "all"}
            label="Todos"
            count={leaderboard.length}
            onClick={() => setFilter("all")}
          />
          <FilterTab
            active={filter === "pro"}
            label="PRO"
            count={proCount}
            tone="pro"
            onClick={() => setFilter("pro")}
          />
        </div>
      ) : null}

      {!ready ? (
        <Card className="overflow-hidden p-0">
          <LeaderboardHeaderRow />
          <LeaderboardRowsSkeleton rows={8} />
        </Card>
      ) : !leaderboard.length ? (
        <EmptyState
          icon="0"
          title="Aun no hay participantes"
          description="Cuando la gente se registre o entre a la demo local, aparecera aqui."
        />
      ) : !visible.length ? (
        <EmptyState
          icon="0"
          title="Aun no hay jugadores PRO"
          description="Cuando alguien tenga el badge PRO aparecera en esta vista."
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
  tone?: "default" | "pro";
}) {
  const activeClass =
    tone === "pro" ? "bg-amber-400 text-amber-950" : "bg-zinc-200 text-zinc-900";
  const activeCountClass =
    tone === "pro" ? "bg-amber-950/15 text-amber-950" : "bg-black/10 text-zinc-900";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-bold transition ${
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
        className={`flex h-8 w-8 items-center justify-center text-sm font-black ${rankTextClass(position)}`}
        aria-label={`Puesto ${position}`}
      >
        {rankLabel(position)}
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
        <strong className="block text-lg font-black text-white">
          {profile.points}
        </strong>
        <span className="text-xs font-semibold text-zinc-500">pts</span>
      </span>
    </Link>
  );
}

function rankFor(leaderboard: UserProfile[], index: number) {
  let rank = index + 1;
  while (rank > 1 && leaderboard[index].points === leaderboard[rank - 2].points) {
    rank -= 1;
  }
  return rank;
}

function rankTextClass(position: number) {
  if (position === 1) {
    return "text-[#f7c948]";
  }

  if (position === 2) {
    return "text-zinc-200";
  }

  if (position === 3) {
    return "text-[#b7791f]";
  }

  return "text-zinc-300";
}

function rankLabel(position: number) {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return position;
}
