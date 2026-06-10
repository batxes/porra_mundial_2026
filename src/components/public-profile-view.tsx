"use client";

import { Avatar, EmptyState, PredictionSnapshot, PrimaryLink, ProBadge, SectionHeading } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { schedule } from "@/lib/data";

export function PublicProfileView({ userId }: { userId: string }) {
  const { leaderboard, playerName, ready } = useAppContext();
  const profile = leaderboard.find((candidate) => candidate.id === userId) || null;
  const rankingPosition = profile
    ? leaderboard.filter((candidate) => candidate.points > profile.points).length + 1
    : 0;

  if (!ready) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Perfil publico" title="Cargando perfil" />
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6 text-sm text-zinc-400">
          Cargando elecciones...
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Perfil publico" title="Perfil no encontrado" />
        <EmptyState
          icon="?"
          title="No encontramos ese participante"
          description="Puede que el usuario ya no exista o que todavia no tenga perfil en la clasificacion."
          action={<PrimaryLink href="/clasificacion">Volver a clasificacion</PrimaryLink>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar
            name={profile.name}
            avatarUrl={profile.avatarUrl}
            className="h-14 w-14 rounded-xl sm:h-16 sm:w-16"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#a7f600]">
              Perfil publico
            </p>
            <h1 className="mt-2 flex min-w-0 items-center gap-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              <span className="truncate">{profile.name}</span>
              {profile.isPro ? <ProBadge size="md" /> : null}
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Elecciones de este participante.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:min-w-[260px]">
          <div className="rounded-lg border border-[#a7f600]/35 bg-[#a7f600]/12 px-4 py-3">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#a7f600]">
              Puesto
            </p>
            <p className="mt-1 text-3xl font-black leading-none text-white">
              #{rankingPosition}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.06] px-4 py-3">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-400">
              Puntos
            </p>
            <p className="mt-1 text-3xl font-black leading-none text-white">
              {profile.points}
            </p>
          </div>
        </div>
      </div>

      <PredictionSnapshot
        bracketLayout="mobile"
        prediction={profile.prediction}
        matches={schedule}
        playerName={playerName}
        showBracket={false}
      />
    </div>
  );
}
