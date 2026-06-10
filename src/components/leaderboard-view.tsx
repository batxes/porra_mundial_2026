"use client";

import Link from "next/link";

import {
  Avatar,
  Card,
  EmptyState,
  SectionHeading,
  TeamBadge,
} from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import type { UserProfile } from "@/lib/types";

export function LeaderboardView() {
  const { leaderboard } = useAppContext();

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Todos los participantes"
        title="Clasificacion"
        description="La tabla se ordena por puntos y muestra el campeon elegido por cada participante."
      />

      {!leaderboard.length ? (
        <EmptyState
          icon="0"
          title="Aun no hay participantes"
          description="Cuando la gente se registre o entre a la demo local, aparecera aqui."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            <span>#</span>
            <span>Jugador</span>
            <span className="text-right">Puntos</span>
          </div>
          <div className="divide-y divide-white/10">
            {leaderboard.map((profile, index) => (
              <LeaderboardRow
                key={profile.id}
                profile={profile}
                position={rankFor(leaderboard, index)}
              />
            ))}
          </div>
        </Card>
      )}
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
          <strong className="block truncate text-sm text-white">
            {profile.name}
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
