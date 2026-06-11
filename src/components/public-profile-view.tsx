"use client";

import { EmptyState, PredictionSnapshot, PrimaryLink, ProfileScoreCard, SectionHeading } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { schedule } from "@/lib/data";

export function PublicProfileView({ userId }: { userId: string }) {
  const { adminResults, leaderboard, playerName, ready, user } = useAppContext();
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
      <ProfileScoreCard
        name={profile.name}
        avatarUrl={profile.avatarUrl}
        isPro={profile.isPro}
        eyebrow="Perfil publico"
        subtitle="Elecciones de este participante."
        scorecard={profile.scorecard}
        rank={rankingPosition}
      />

      <PredictionSnapshot
        bracketLayout="mobile"
        prediction={profile.prediction}
        matches={schedule}
        playerName={playerName}
        results={adminResults}
        scorecard={profile.scorecard}
        showBracket={false}
        maskUnstarted={!user || (user.id !== profile.id && !user.isAdmin)}
      />
    </div>
  );
}
