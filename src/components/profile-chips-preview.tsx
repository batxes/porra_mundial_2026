"use client";

import { PredictionSnapshot, ProfileScoreCard } from "@/components/common";
import { ProfileJornadaFeed } from "@/components/profile-jornada-feed";
import { data, playersById, schedule } from "@/lib/data";
import { emptyPrediction } from "@/lib/prediction";
import { createEngine } from "@/lib/scoring";
import type { AdminResults, UserProfile } from "@/lib/types";

const previewResults: AdminResults = {
  "73": {
    homeScore: 2,
    awayScore: 1,
    homeTeamId: "rsa",
    awayTeamId: "can",
    status: "validated",
    events: [],
    trainerTactics: {
      "set-piece": ["can"],
    },
  },
  "75": {
    homeScore: 1,
    awayScore: 2,
    homeTeamId: "ned",
    awayTeamId: "mar",
    status: "validated",
    events: [],
    trainerTactics: {
      "red-card": ["ned"],
    },
  },
  "76": {
    homeScore: 3,
    awayScore: 1,
    homeTeamId: "bra",
    awayTeamId: "jpn",
    status: "validated",
    events: [],
  },
  "88": {
    homeScore: 1,
    awayScore: 1,
    homeTeamId: "aus",
    awayTeamId: "egy",
    status: "validated",
    events: [],
    trainerTactics: {
      penalty: ["aus"],
    },
  },
};

function buildPreviewProfile(): UserProfile {
  const prediction = emptyPrediction();
  prediction.matchPredictions["73"] = {
    homeScore: "1",
    awayScore: "2",
    trainerTeamId: "can",
    tacticId: "set-piece",
  };
  prediction.matchPredictions["75"] = {
    homeScore: "2",
    awayScore: "1",
    trainerTeamId: "ned",
    tacticId: "red-card",
  };
  prediction.matchPredictions["76"] = {
    homeScore: "2",
    awayScore: "1",
  };
  prediction.matchPredictions["88"] = {
    homeScore: "0",
    awayScore: "1",
    trainerTeamId: "egy",
    tacticId: "penalty",
  };

  const scorecard = createEngine({ data, schedule }).calculateScorecard(
    prediction,
    previewResults,
    "preview-profile",
  );

  return {
    id: "preview-profile",
    name: "Perfil Demo",
    email: "",
    avatarUrl: "preset:blue",
    points: scorecard.total,
    isAdmin: false,
    isPro: true,
    isWolf: false,
    isHidden: false,
    complete: 0,
    champion: "",
    prediction,
    scorecard,
  };
}

export function ProfileChipsPreview() {
  const profile = buildPreviewProfile();
  const playerName = (playerId: string) =>
    playersById.get(playerId)?.name || playerId;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="space-y-6">
        <ProfileScoreCard
          name={profile.name}
          avatarUrl={profile.avatarUrl}
          isPro={profile.isPro}
          isWolf={profile.isWolf}
          eyebrow="Preview perfil"
          scorecard={profile.scorecard}
          rank={7}
        />

        <PredictionSnapshot
          bracketLayout="mobile"
          initialSection="results"
          matches={schedule}
          playerName={playerName}
          prediction={profile.prediction}
          results={previewResults}
          scorecard={profile.scorecard}
          recorrido={
            <ProfileJornadaFeed
              defaultOpenAll
              profile={profile}
              results={previewResults}
            />
          }
        />
      </div>
    </main>
  );
}
