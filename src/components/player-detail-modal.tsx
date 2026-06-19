"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useEffect } from "react";

import { Avatar, PositionBadge, TeamFlag } from "@/components/common";
import { PlayerCard } from "@/components/player-card";
import { useAppContext } from "@/lib/app-context";
import { playersById, schedule, teamsById } from "@/lib/data";
import { positionAccent } from "@/lib/position-style";
import { getPlayerOwners } from "@/lib/player-owners";
import { calculatePlayerBreakdown } from "@/lib/scoring";

const scheduleByNumber = new Map(schedule.map((match) => [match.number, match]));

// Etiquetas y emoji por tipo de evento, en el contexto del futbolista (no "de tu
// once"). El plural es para el resumen por tipo; el corto, para cada evento.
const eventLabels: Record<string, string> = {
  player_goal: "Goles",
  player_penalty_goal: "Penaltis marcados",
  player_match_mvp: "MVP del partido",
  player_penalty_save: "Penaltis parados",
  player_penalty_miss: "Penaltis fallados",
  player_red_card: "Tarjetas rojas",
};

const eventShortLabels: Record<string, string> = {
  player_goal: "Gol",
  player_penalty_goal: "Penalti",
  player_match_mvp: "MVP",
  player_penalty_save: "Penalti parado",
  player_penalty_miss: "Penalti fallado",
  player_red_card: "Roja",
};

const eventEmoji: Record<string, string> = {
  player_goal: "⚽",
  player_penalty_goal: "🎯",
  player_match_mvp: "⭐",
  player_penalty_save: "🧤",
  player_penalty_miss: "❌",
  player_red_card: "🟥",
};

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function pointsTone(value: number) {
  return value >= 0 ? "text-[#a7f600]" : "text-rose-400";
}

function pointsSurface(value: number) {
  return value >= 0
    ? "border-[#a7f600]/35 bg-[#a7f600]/10 text-[#a7f600]"
    : "border-rose-400/35 bg-rose-500/10 text-rose-300";
}

function formatAverage(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function DetailPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${className}`}
    >
      {children}
    </section>
  );
}

function SectionTitle({
  children,
  meta,
}: {
  children: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h3 className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-zinc-500">
        {children}
      </h3>
      {meta ? <span className="shrink-0 text-xs font-bold text-zinc-500">{meta}</span> : null}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "lime" | "gold";
}) {
  const toneClass =
    tone === "lime"
      ? "text-[#a7f600]"
      : tone === "gold"
        ? "text-[#f7c84a]"
        : "text-white";

  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2.5">
      <p className={`text-lg font-black leading-none tabular-nums ${toneClass}`}>
        {value}
      </p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
    </div>
  );
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-white/[0.1] bg-black/15 px-3 py-3 text-sm font-medium text-zinc-400">
      {children}
    </p>
  );
}

// Modal de detalle de un futbolista: su carta, el desglose de puntos (por tipo y
// partido a partido) y quien lo tiene en su once. Autonomo: solo necesita el
// playerId; lee adminResults y el leaderboard del contexto. Se abre desde la
// clasificación de jugadores y desde la foto del once en los perfiles.
export function PlayerDetailModal({
  playerId,
  onClose,
}: {
  playerId: string;
  onClose: () => void;
}) {
  const { adminResults, leaderboard } = useAppContext();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const player = playersById.get(playerId);
  if (!player) return null;

  const team = teamsById.get(player.team);
  const accent = positionAccent[player.position];
  const breakdown = calculatePlayerBreakdown(player, adminResults);
  const owners = getPlayerOwners(leaderboard, playerId);
  const averagePoints = breakdown.matches.length
    ? breakdown.total / breakdown.matches.length
    : 0;
  const accentStyle: CSSProperties = {
    borderColor: `rgba(${accent.rgb}, 0.34)`,
    backgroundColor: `rgba(${accent.rgb}, 0.12)`,
    color: accent.text,
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center overflow-y-auto bg-black/78 px-3 py-4 backdrop-blur-md sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Detalle de ${player.name}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="theme-dark relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0b0d] text-white shadow-[0_28px_90px_rgba(0,0,0,0.72)] motion-safe:animate-[cofre-modal-pop_220ms_cubic-bezier(0.2,0.9,0.3,1)_both]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            backgroundImage: "url(/cardbg.png)",
            backgroundSize: "520px auto",
            backgroundPosition: "top center",
            filter: accent.bgRotate ? `hue-rotate(${accent.bgRotate}deg)` : undefined,
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-48"
          style={{
            background: `radial-gradient(70% 85% at 50% 0%, rgba(${accent.rgb},0.26), transparent 70%)`,
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_0%,rgba(10,11,13,0.78)_46%,#0a0b0d_100%)]"
        />

        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-full border border-white/10 bg-black/35 text-zinc-300 shadow-lg shadow-black/30 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>

        <div className="relative overflow-y-auto px-4 pb-4 pt-5 sm:px-5 sm:pb-5">
          <div className="grid gap-5 sm:grid-cols-[190px_minmax(0,1fr)] sm:items-center">
            <div className="mx-auto w-44 max-w-full sm:w-full">
              <PlayerCard playerId={player.id} points={breakdown.total} featured />
            </div>

            <div className="min-w-0 pt-1 text-center sm:pr-10 sm:text-left">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#a7f600]">
                Carta del jugador
              </p>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-2xl font-black leading-tight tracking-tight text-white sm:text-3xl">
                    {player.name}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <PositionBadge position={player.position} />
                    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-bold" style={accentStyle}>
                      <TeamFlag
                        teamId={player.team}
                        className="h-3 w-[18px] rounded-sm"
                      />
                      <span className="truncate">{team?.name || player.team}</span>
                    </span>
                  </div>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center justify-center rounded-xl border px-3.5 py-2 text-xl font-black leading-none tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] ${pointsSurface(
                    breakdown.total,
                  )}`}
                >
                  {formatSigned(breakdown.total)}
                  <span className="ml-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] opacity-75">
                    pts
                  </span>
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <StatTile
                  label="Media"
                  value={formatAverage(averagePoints)}
                  tone={breakdown.matches.length ? "lime" : "neutral"}
                />
                <StatTile
                  label="Partidos"
                  value={breakdown.matches.length}
                  tone={breakdown.matches.length ? "gold" : "neutral"}
                />
                <StatTile
                  label="Onces"
                  value={owners.length}
                  tone={owners.length ? "lime" : "neutral"}
                />
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[0.95fr_1.05fr]">
            <DetailPanel className="p-3.5 sm:p-4">
              <SectionTitle>De dónde salen los puntos</SectionTitle>
              {breakdown.items.length ? (
                <ul className="space-y-2">
                  {breakdown.items.map((item) => (
                    <li
                      key={item.ruleCode}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2.5"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden
                          className="flex size-7 shrink-0 items-center justify-center rounded-full border text-sm"
                          style={accentStyle}
                        >
                          {eventEmoji[item.ruleCode]}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-white">
                            {eventLabels[item.ruleCode] || item.ruleCode}
                          </span>
                          <span className="block text-xs font-medium text-zinc-500">
                            x{item.count}
                            {item.ruleCode === "player_goal"
                              ? ` · ${item.pointsEach}/gol`
                              : ""}
                          </span>
                        </span>
                      </span>
                      <span
                        className={`shrink-0 text-sm font-black tabular-nums ${pointsTone(
                          item.points,
                        )}`}
                      >
                        {formatSigned(item.points)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyPanel>Todavía no ha sumado puntos.</EmptyPanel>
              )}
            </DetailPanel>

            <DetailPanel className="p-3.5 sm:p-4">
              <SectionTitle
                meta={
                  breakdown.matches.length ? `${breakdown.matches.length}` : undefined
                }
              >
                Partido a partido
              </SectionTitle>
              {breakdown.matches.length ? (
                <ul className="space-y-2">
                  {breakdown.matches.map((entry) => {
                    const match = scheduleByNumber.get(entry.matchNumber);
                    const opponentId =
                      entry.opponentTeamId ||
                      (match
                        ? match.home === player.team
                          ? match.away
                          : match.home
                        : "");
                    const opponent = teamsById.get(opponentId)?.name || "Rival";

                    return (
                      <li
                        key={entry.matchNumber}
                        className="rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-white">
                            <TeamFlag
                              teamId={opponentId}
                              className="h-3 w-[18px] shrink-0 rounded-sm"
                            />
                            <span className="truncate">vs {opponent}</span>
                            {match?.stage ? (
                              <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-zinc-500">
                                {match.stage}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={`shrink-0 text-sm font-black tabular-nums ${pointsTone(
                              entry.points,
                            )}`}
                          >
                            {formatSigned(entry.points)}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {entry.events.map((ev, index) => {
                            // El MVP no tiene minuto (llega como 0); solo mostramos el
                            // minuto en eventos de juego con minuto real.
                            const showMinute =
                              ev.ruleCode !== "player_match_mvp" &&
                              ev.minute != null &&
                              String(ev.minute) !== "" &&
                              String(ev.minute) !== "0";

                            return (
                              <span
                                key={index}
                                className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.05] px-2 py-0.5 text-[11px] font-semibold text-zinc-300"
                              >
                                <span aria-hidden>{eventEmoji[ev.ruleCode]}</span>
                                {eventShortLabels[ev.ruleCode] || ev.ruleCode}
                                {showMinute ? (
                                  <span className="text-zinc-500">
                                    {ev.minute}&apos;
                                  </span>
                                ) : null}
                              </span>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyPanel>No hay partidos puntuados para este jugador.</EmptyPanel>
              )}
            </DetailPanel>
          </div>

          <DetailPanel className="mt-3 p-3.5 sm:p-4">
            <SectionTitle meta={owners.length ? owners.length : undefined}>
              Quién lo tiene en su once
            </SectionTitle>
            {owners.length ? (
              <div className="flex flex-wrap gap-1.5">
                {owners.map((owner) => (
                  <Link
                    key={owner.id}
                    href={`/perfil/${encodeURIComponent(owner.id)}`}
                    className="inline-flex max-w-[11rem] items-center gap-1.5 rounded-full border border-white/10 bg-black/20 py-1 pl-1 pr-2.5 transition hover:border-[#a7f600]/40 hover:bg-[#a7f600]/10"
                  >
                    <Avatar
                      name={owner.name}
                      avatarUrl={owner.avatarUrl}
                      className="size-5! text-[8px]!"
                    />
                    <span className="truncate text-xs font-bold text-zinc-200">
                      {owner.name}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyPanel>Nadie lo tiene fichado todavía.</EmptyPanel>
            )}
          </DetailPanel>
        </div>
      </div>
    </div>
  );
}
