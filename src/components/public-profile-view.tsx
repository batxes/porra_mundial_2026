"use client";

import { EmptyState, PredictionSnapshot, PredictionSnapshotSkeleton, PrimaryLink, ProfileScoreCard, ProfileScoreCardSkeleton, SectionHeading } from "@/components/common";
import { ProfileFichajes } from "@/components/profile-fichajes";
import { ProfileJornadaFeed } from "@/components/profile-jornada-feed";
import { useAppContext } from "@/lib/app-context";
import { schedule } from "@/lib/data";

export function PublicProfileView({ userId }: { userId: string }) {
  const { adminResults, leaderboard, playerName, ready, user } = useAppContext();
  const profile = leaderboard.find((candidate) => candidate.id === userId) || null;
  const rankingPosition = profile
    ? leaderboard.filter(
        (candidate) => !candidate.isHidden && candidate.points > profile.points,
      ).length + 1
    : 0;

  if (!ready) {
    return (
      <div className="space-y-6">
        <ProfileScoreCardSkeleton />
        <PredictionSnapshotSkeleton />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Perfil público" title="Perfil no encontrado" />
        <EmptyState
          icon="?"
          title="No encontramos ese participante"
          description="Puede que el usuario ya no exista o que todavía no tenga perfil en la clasificación."
          action={<PrimaryLink href="/clasificacion">Volver a clasificación</PrimaryLink>}
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
        isWolf={profile.isWolf}
        eyebrow="Perfil público"
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
        recorrido={
          <ProfileJornadaFeed profile={profile} results={adminResults} />
        }
        belowLineup={<ProfileFichajes userId={profile.id} />}
        maskUnstarted={!user || (user.id !== profile.id && !user.isAdmin)}
      />
    </div>
  );
}
