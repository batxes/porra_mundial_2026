"use client";

import Link from "next/link";

import { Avatar, Card, EmptyState, SectionHeading, TeamBadge } from "@/components/common";
import { useAppContext } from "@/lib/app-context";

export function LeaderboardView() {
  const { leaderboard } = useAppContext();

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Todos los participantes"
        title="Clasificación"
        description="La tabla se ordena por puntos. Si todavía no hay resultados validados, el progreso de la porra sirve para desempatar."
      />

      {!leaderboard.length ? (
        <EmptyState
          icon="0"
          title="Aún no hay participantes"
          description="Cuando la gente se registre o entre a la demo local, aparecerá aquí."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="hidden grid-cols-[72px_1.4fr_1fr_90px_120px] gap-4 border-b border-white/10 px-5 py-4 text-xs uppercase tracking-[0.25em] text-slate-400 md:grid">
            <span>Puesto</span>
            <span>Jugador</span>
            <span>Ganador</span>
            <span>Puntos</span>
            <span>Perfil</span>
          </div>
          <div className="divide-y divide-white/10">
            {leaderboard.map((profile, index) => (
              <Link
                key={profile.id}
                href={`/perfil/${encodeURIComponent(profile.id)}`}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-3 px-4 py-4 text-left transition hover:bg-white/5 md:grid-cols-[72px_1.4fr_1fr_90px_120px] md:gap-4 md:px-5"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-400/10 text-lg font-bold text-cyan-300 md:block md:h-auto md:w-auto md:bg-transparent">{index + 1}</span>
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={profile.name}
                    avatarUrl={profile.avatarUrl}
                    className="aspect-square h-12 w-12 shrink-0"
                  />
                  <span className="min-w-0">
                    <strong className="block truncate text-white">{profile.name}</strong>
                    <small className="text-slate-400">{profile.complete}% completa</small>
                  </span>
                </span>
                <span className="col-span-2 self-center md:col-span-1">
                  {profile.champion ? <TeamBadge teamId={profile.champion} /> : <span className="text-sm text-slate-400">Pendiente</span>}
                </span>
                <span className="row-start-1 self-center text-right text-lg font-bold text-white md:row-auto md:text-left">{profile.points}</span>
                <span className="col-span-3 self-center text-sm font-semibold text-cyan-300 md:col-span-1">Ver perfil</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
