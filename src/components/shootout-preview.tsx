"use client";

import {
  Card,
  MatchEventLine,
  matchEventIcons,
  matchEventTeamId,
  ProfileScoreCard,
  SectionHeading,
  TeamFlag,
} from "@/components/common";
import { ProfileJornadaFeed } from "@/components/profile-jornada-feed";
import { data, schedule, teamsById } from "@/lib/data";
import { translateSlot } from "@/lib/format";
import { calculateShootoutScore } from "@/lib/match-events";
import { emptyPrediction } from "@/lib/prediction";
import { createEngine } from "@/lib/scoring";
import type { AdminResult, AdminResults, UserProfile } from "@/lib/types";

const previewMatch = schedule.find((match) => match.number === 73) || schedule[72];

const previewResult: AdminResult = {
  homeScore: 1,
  awayScore: 1,
  homeTeamId: "rsa",
  awayTeamId: "can",
  status: "validated",
  events: [
    {
      id: "rsa-goal-38",
      playerId: "rsa-09",
      teamId: "rsa",
      type: "goal",
      minute: 38,
    },
    {
      id: "can-goal-72",
      playerId: "can-09",
      teamId: "can",
      type: "goal",
      minute: 72,
    },
    {
      id: "rsa-shootout-goal-1",
      playerId: "rsa-09",
      teamId: "rsa",
      type: "penalty_goal",
      minute: 121,
      source: "shootout",
      details: {
        phase: "shootout",
        shootoutOrder: 1,
        shootoutAttemptId: "rsa-1",
        shootoutOutcome: "scored",
      },
    },
    {
      id: "can-shootout-goal-1",
      playerId: "can-09",
      teamId: "can",
      type: "penalty_goal",
      minute: 122,
      source: "shootout",
      details: {
        phase: "shootout",
        shootoutOrder: 2,
        shootoutAttemptId: "can-1",
        shootoutOutcome: "scored",
      },
    },
    {
      id: "rsa-shootout-miss-2",
      playerId: "rsa-10",
      teamId: "rsa",
      type: "penalty_miss",
      minute: 123,
      source: "shootout",
      details: {
        phase: "shootout",
        shootoutOrder: 3,
        shootoutAttemptId: "rsa-2",
        shootoutOutcome: "saved",
      },
    },
    {
      id: "can-shootout-save-2",
      playerId: "can-01",
      teamId: "can",
      type: "penalty_save",
      minute: 123,
      source: "shootout",
      details: {
        phase: "shootout",
        shootoutOrder: 3,
        shootoutAttemptId: "rsa-2",
        shootoutOutcome: "saved",
        relatedEventId: "rsa-shootout-miss-2",
      },
    },
    {
      id: "can-shootout-goal-2",
      playerId: "can-10",
      teamId: "can",
      type: "penalty_goal",
      minute: 124,
      source: "shootout",
      details: {
        phase: "shootout",
        shootoutOrder: 4,
        shootoutAttemptId: "can-2",
        shootoutOutcome: "scored",
      },
    },
    {
      id: "rsa-shootout-goal-3",
      playerId: "rsa-07",
      teamId: "rsa",
      type: "penalty_goal",
      minute: 125,
      source: "shootout",
      details: {
        phase: "shootout",
        shootoutOrder: 5,
        shootoutAttemptId: "rsa-3",
        shootoutOutcome: "scored",
      },
    },
    {
      id: "can-shootout-goal-3",
      playerId: "can-07",
      teamId: "can",
      type: "penalty_goal",
      minute: 126,
      source: "shootout",
      details: {
        phase: "shootout",
        shootoutOrder: 6,
        shootoutAttemptId: "can-3",
        shootoutOutcome: "scored",
      },
    },
    {
      id: "rsa-shootout-goal-4",
      playerId: "rsa-04",
      teamId: "rsa",
      type: "penalty_goal",
      minute: 127,
      source: "shootout",
      details: {
        phase: "shootout",
        shootoutOrder: 7,
        shootoutAttemptId: "rsa-4",
        shootoutOutcome: "scored",
      },
    },
    {
      id: "can-shootout-goal-4",
      playerId: "can-08",
      teamId: "can",
      type: "penalty_goal",
      minute: 128,
      source: "shootout",
      details: {
        phase: "shootout",
        shootoutOrder: 8,
        shootoutAttemptId: "can-4",
        shootoutOutcome: "scored",
      },
    },
    {
      id: "rsa-shootout-goal-5",
      playerId: "rsa-11",
      teamId: "rsa",
      type: "penalty_goal",
      minute: 129,
      source: "shootout",
      details: {
        phase: "shootout",
        shootoutOrder: 9,
        shootoutAttemptId: "rsa-5",
        shootoutOutcome: "scored",
      },
    },
    {
      id: "can-shootout-goal-5",
      playerId: "can-09",
      teamId: "can",
      type: "penalty_goal",
      minute: 130,
      source: "shootout",
      details: {
        phase: "shootout",
        shootoutOrder: 10,
        shootoutAttemptId: "can-5",
        shootoutOutcome: "scored",
      },
    },
  ],
};

const previewResults: AdminResults = {
  [String(previewMatch.number)]: previewResult,
};

function buildPreviewProfile(): UserProfile {
  const prediction = emptyPrediction();
  prediction.xi = ["can-09", "can-01"];
  prediction.matchPredictions[String(previewMatch.number)] = {
    homeScore: "1",
    awayScore: "1",
  };
  prediction.bracket.winners[String(previewMatch.number)] = "can";

  const scorecard = createEngine({ data, schedule }).calculateScorecard(
    prediction,
    previewResults,
    "shootout-preview",
  );

  return {
    id: "shootout-preview",
    name: "Once con Larin y St. Clair",
    email: "",
    avatarUrl: "preset:cyan",
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

function scoreLabel(points: number) {
  return points > 0 ? `+${points}` : String(points);
}

function DemoInicioMatchCard() {
  const homeTeamId = previewResult.homeTeamId || previewMatch.home;
  const awayTeamId = previewResult.awayTeamId || previewMatch.away;
  const homeName =
    teamsById.get(homeTeamId)?.name || translateSlot(previewMatch.home);
  const awayName =
    teamsById.get(awayTeamId)?.name || translateSlot(previewMatch.away);
  const shootoutScore = calculateShootoutScore(
    previewResult,
    homeTeamId,
    awayTeamId,
  );
  const events = previewResult.events
    .filter((event) => event.playerId && matchEventIcons[String(event.type)])
    .sort((a, b) => (Number(a.minute) || 0) - (Number(b.minute) || 0));
  const homeEvents = events.filter(
    (event) => matchEventTeamId(event) !== awayTeamId,
  );
  const awayEvents = events.filter(
    (event) => matchEventTeamId(event) === awayTeamId,
  );

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-white/10 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
          Inicio - jornada publicada
        </p>
      </div>
      <div className="px-4 py-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-2.5">
            <span className="min-w-0 truncate text-right text-sm font-bold leading-tight text-white sm:text-base">
              {homeName}
            </span>
            <TeamFlag
              teamId={homeTeamId}
              className="h-6 w-6 shrink-0 rounded-full border border-white/15 object-cover sm:h-7 sm:w-7"
            />
          </div>
          <span className="flex shrink-0 flex-col items-center gap-0.5">
            <span className="rounded-lg bg-white/[0.08] px-3 py-1 text-lg font-bold tabular-nums tracking-wide text-white sm:px-3.5 sm:text-xl">
              {previewResult.homeScore} - {previewResult.awayScore}
            </span>
            <span className="text-[11px] font-bold tabular-nums text-zinc-400">
              ({shootoutScore.home}-{shootoutScore.away})
            </span>
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
            <TeamFlag
              teamId={awayTeamId}
              className="h-6 w-6 shrink-0 rounded-full border border-white/15 object-cover sm:h-7 sm:w-7"
            />
            <span className="min-w-0 truncate text-sm font-bold leading-tight text-white sm:text-base">
              {awayName}
            </span>
          </div>
          <span className="hidden shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-bold text-zinc-400 sm:inline-flex">
            Finalizado
          </span>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-x-4 border-t border-white/[0.06] pt-2.5">
          <div className="space-y-1">
            {homeEvents.map((event, index) => (
              <MatchEventLine key={event.id || `h${index}`} event={event} />
            ))}
          </div>
          <div className="space-y-1">
            {awayEvents.map((event, index) => (
              <MatchEventLine
                key={event.id || `a${index}`}
                event={event}
                align="right"
              />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function DemoBreakdown({ profile }: { profile: UserProfile }) {
  const rows = profile.scorecard.entries
    .filter(
      (entry) =>
        entry.matchNumber === previewMatch.number ||
        entry.sourceRef === "champion",
    )
    .map((entry) => ({
      label: entry.label,
      points: entry.points,
      explanation: entry.explanation,
    }));

  return (
    <Card className="space-y-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
          Desglose demo
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">
          Lo que puntua este perfil
        </h2>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={`${row.explanation}-${row.points}`}
            className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate text-zinc-300">
              {row.explanation}
            </span>
            <span
              className={`shrink-0 font-bold ${
                row.points >= 0 ? "text-[#a7f600]" : "text-rose-300"
              }`}
            >
              {scoreLabel(row.points)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ShootoutPreview() {
  const profile = buildPreviewProfile();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <SectionHeading
        eyebrow="Preview"
        title="Partido decidido en penaltis"
        description="Demo local: el resultado de la porra es 1-1 tras 120 minutos; la tanda se ve aparte como (4-5) y solo afecta a eventos de jugadores y al ganador del cruce."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-6">
          <DemoInicioMatchCard />
          <ProfileJornadaFeed
            defaultOpenAll
            profile={profile}
            results={previewResults}
          />
        </div>
        <div className="space-y-6">
          <ProfileScoreCard
            name={profile.name}
            avatarUrl={profile.avatarUrl}
            isPro={profile.isPro}
            isWolf={profile.isWolf}
            eyebrow="Resumen de jornada"
            scorecard={profile.scorecard}
            rank={3}
          />
          <DemoBreakdown profile={profile} />
          <Card className="space-y-2 text-sm text-zinc-400">
            <p className="font-semibold text-white">Lectura de la demo</p>
            <p>
              La prediccion del marcador es 1-1. Por eso suma resultado
              acertado y exacto, aunque Canada gane la tanda.
            </p>
            <p>
              La tanda agrega eventos: Larin suma penalti marcado y St. Clair
              suma penalti parado. Esos puntos entran en Tu once.
            </p>
          </Card>
        </div>
      </div>
    </main>
  );
}
