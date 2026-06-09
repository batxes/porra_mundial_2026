"use client";

import Image from "next/image";
import Link from "next/link";

import { Avatar, Card, PrimaryLink, TeamBadge } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { schedule } from "@/lib/data";
import { formatDate, publicAssetUrl, translateSlot } from "@/lib/format";
import type { Match, UserProfile } from "@/lib/types";

function madridTodayKey() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function HomeView() {
  const { adminResults, completion, leaderboard } = useAppContext();
  const todayKey = madridTodayKey();
  const upcomingMatches = schedule.filter((match) => match.date >= todayKey).slice(0, 2);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 py-8">
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#151515] shadow-2xl shadow-black/30">
        <div className="relative min-h-[24rem]">
          <Image
            src={publicAssetUrl("/triliporra-banner.png")}
            alt="Banner de TRILIPORRA con futbolistas y la copa del mundo"
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover"
            priority
            unoptimized
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-black/10 sm:bg-gradient-to-r sm:from-black/75 sm:via-black/20 sm:to-transparent" />
          <div className="relative flex min-h-[24rem] flex-col justify-end p-6 sm:p-8">
            <Image src={publicAssetUrl("/logo.png")} alt="" width={88} height={88} className="mb-4 h-16 w-16 object-contain sm:h-20 sm:w-20" priority />
            <h1 className="text-5xl font-black tracking-tight text-white sm:text-6xl">Triliporra</h1>
            <p className="mt-3 max-w-xl text-base text-zinc-100 sm:text-lg">Adivina el Mundial 2026 y compite con tus amigos.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <PrimaryLink href="/porra">Jugar</PrimaryLink>
              <Link href="/como-funciona" className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-black/30 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                Ver reglas
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white">Clasificacion</h2>
            <p className="mt-1 text-sm text-zinc-500">{leaderboard.length} participantes - tu porra {completion}%</p>
          </div>
          <Link href="/clasificacion" className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/10">
            Ver mas
          </Link>
        </div>

        <Card className="overflow-hidden p-0">
          {leaderboard.length ? (
            <div className="divide-y divide-white/10">
              {leaderboard.slice(0, 5).map((profile, index) => (
                <LeaderboardRow key={profile.id} profile={profile} position={index + 1} />
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">Aun no hay participantes.</div>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white">Proximos partidos</h2>
            <p className="mt-1 text-sm text-zinc-500">Siguientes 2 encuentros</p>
          </div>
          <Link href="/partidos" className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/10">
            Ver todos
          </Link>
        </div>

        {upcomingMatches.length ? (
          <div className="grid gap-3">
            {upcomingMatches.map((match) => (
              <UpcomingMatchCard key={match.number} match={match} result={adminResults[String(match.number)]} />
            ))}
          </div>
        ) : (
          <Card className="space-y-2 text-sm">
            <p className="font-semibold text-white">No quedan partidos programados.</p>
          </Card>
        )}
      </section>
    </div>
  );
}

function LeaderboardRow({ profile, position }: { profile: UserProfile; position: number }) {
  return (
    <Link href="/clasificacion" className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/5">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black ${position === 1 ? "bg-[#a7f600] text-black" : "bg-white/10 text-white"}`}>
        {position}
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={profile.name} avatarUrl={profile.avatarUrl} className="h-9 w-9 shrink-0" />
        <span className="min-w-0">
          <strong className="block truncate text-sm text-white">{profile.name}</strong>
          <span className="text-xs text-zinc-500">{profile.complete}% completa</span>
        </span>
      </span>
      <span className="text-right">
        <strong className="block text-lg font-black text-white">{profile.points}</strong>
        <span className="text-xs font-semibold text-zinc-500">pts</span>
      </span>
    </Link>
  );
}

function UpcomingMatchCard({ match, result }: { match: Match; result?: { homeScore?: string | number; awayScore?: string | number } }) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-zinc-500">
        <span>Partido {match.number} - {match.stage}</span>
        <span>{formatDate(match.date)} - {match.time}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <TeamBadge teamId={match.home} fallback={translateSlot(match.home)} />
        <span className="rounded-lg bg-white/10 px-3 py-2 text-sm font-black text-white">
          {result ? `${result.homeScore ?? "-"} - ${result.awayScore ?? "-"}` : "vs"}
        </span>
        <TeamBadge teamId={match.away} fallback={translateSlot(match.away)} className="justify-end text-right" />
      </div>
      <p className="truncate text-xs text-zinc-500">{match.venue}</p>
    </Card>
  );
}
