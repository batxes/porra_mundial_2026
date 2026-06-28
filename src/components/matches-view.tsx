"use client";

import { useMemo } from "react";

import { Card, Notice, ScheduleMeta, SectionHeading, TeamBadge } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { schedule } from "@/lib/data";
import { formatDate, translateSlot } from "@/lib/format";
import { calculateShootoutScore, isShootoutEvent } from "@/lib/match-events";

export function MatchesView() {
  const { adminResults, playerName } = useAppContext();

  const byDate = useMemo(() => {
    return schedule.reduce<Record<string, typeof schedule>>((days, match) => {
      days[match.date] ||= [];
      days[match.date].push(match);
      return days;
    }, {});
  }, []);

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Calendario oficial"
        title="Todos los partidos"
        description="Los 104 encuentros del torneo. Cuando el admin publica un resultado, aquí aparecen goles y eventos validados."
      />

      <Notice>Las horas conservan la zona local publicada para cada sede. Los cruces posteriores se resuelven según el cuadro del torneo.</Notice>

      <div className="space-y-8">
        {Object.entries(byDate).map(([date, matches]) => (
          <section key={date} className="space-y-4">
            <h2 className="text-xl font-semibold text-white">{formatDate(date)}</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {matches.map((match) => {
                const result = adminResults[String(match.number)];
                const homeTeamId = result?.homeTeamId || match.home;
                const awayTeamId = result?.awayTeamId || match.away;
                const shootoutScore = calculateShootoutScore(
                  result,
                  homeTeamId,
                  awayTeamId,
                );
                const hasShootout =
                  shootoutScore.home > 0 || shootoutScore.away > 0;
                return (
                  <Card key={match.number} className="space-y-4">
                    <div className="flex flex-col gap-1 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        Partido {match.number} · {match.stage}
                      </span>
                      <span>{match.time}</span>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-3 py-3 sm:gap-4 sm:px-4">
                        <TeamBadge teamId={match.home} fallback={translateSlot(match.home)} />
                        <strong className="shrink-0 text-2xl text-white">{result?.homeScore ?? "-"}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-3 py-3 sm:gap-4 sm:px-4">
                        <TeamBadge teamId={match.away} fallback={translateSlot(match.away)} />
                        <strong className="shrink-0 text-2xl text-white">{result?.awayScore ?? "-"}</strong>
                      </div>
                      {hasShootout ? (
                        <p className="text-center text-xs font-bold tabular-nums text-zinc-400">
                          Tanda ({shootoutScore.home}-{shootoutScore.away})
                        </p>
                      ) : null}
                    </div>
                    <ScheduleMeta match={match} />
                    {result?.events?.length ? (
                      <div className="space-y-2 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        <p className="text-sm font-semibold text-white">Eventos validados</p>
                        {[...result.events]
                          .sort(
                            (a, b) =>
                              (Number(a.minute) || 0) - (Number(b.minute) || 0),
                          )
                          .map((event) => (
                          <div key={event.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 text-sm">
                            <span className="text-slate-400">
                              {isShootoutEvent(event) ? "Tanda" : `${event.minute}'`}
                            </span>
                            <span className="min-w-0 text-slate-200">
                              {playerName(event.playerId)} · {event.type}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
