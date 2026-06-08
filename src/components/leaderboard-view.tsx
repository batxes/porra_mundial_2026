"use client";

import { useState } from "react";

import { Avatar, Card, EmptyState, PredictionSnapshot, SectionHeading, TeamBadge } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { schedule } from "@/lib/data";

export function LeaderboardView() {
  const { leaderboard, playerName } = useAppContext();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(leaderboard[0]?.id || null);

  const selected = leaderboard.find((profile) => profile.id === selectedUserId) || null;

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
        <>
          <Card className="overflow-hidden p-0">
            <div className="grid grid-cols-[72px_1.4fr_1fr_90px_120px] gap-4 border-b border-white/10 px-5 py-4 text-xs uppercase tracking-[0.25em] text-slate-400">
              <span>Puesto</span>
              <span>Jugador</span>
              <span>Ganador</span>
              <span>Puntos</span>
              <span>Porra</span>
            </div>
            <div className="divide-y divide-white/10">
              {leaderboard.map((profile, index) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setSelectedUserId(profile.id)}
                  className={`grid w-full grid-cols-[72px_1.4fr_1fr_90px_120px] gap-4 px-5 py-4 text-left transition hover:bg-white/5 ${
                    selectedUserId === profile.id ? "bg-cyan-400/10" : ""
                  }`}
                >
                  <span className="text-lg font-bold text-cyan-300">{index + 1}</span>
                  <span className="flex items-center gap-3">
                    <Avatar name={profile.name} avatarUrl={profile.avatarUrl} className="h-10 w-10" />
                    <span>
                      <strong className="block text-white">{profile.name}</strong>
                      <small className="text-slate-400">{profile.complete}% completa</small>
                    </span>
                  </span>
                  <span className="self-center">
                    {profile.champion ? <TeamBadge teamId={profile.champion} /> : <span className="text-sm text-slate-400">Pendiente</span>}
                  </span>
                  <span className="self-center text-lg font-bold text-white">{profile.points}</span>
                  <span className="self-center text-sm font-semibold text-cyan-300">Ver detalle</span>
                </button>
              ))}
            </div>
          </Card>

          {selected ? (
            <PredictionSnapshot prediction={selected.prediction} matches={schedule} playerName={playerName} profile={selected} />
          ) : null}
        </>
      )}
    </div>
  );
}
