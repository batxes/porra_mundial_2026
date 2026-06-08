"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { data, teamsById } from "@/lib/data";
import { flagUrl, formatScheduleDate, initials, translateSlot } from "@/lib/format";
import { emptyPrediction, loserForMatch, resolveSlot } from "@/lib/prediction";
import type { Match, Prediction, Scorecard, UserProfile } from "@/lib/types";

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article className={`rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 ${className}`}>
      {children}
    </article>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">{eyebrow}</p>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
        {description ? <p className="max-w-3xl text-sm text-slate-300 sm:text-base">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function TeamBadge({
  teamId,
  fallback,
  className = "",
}: {
  teamId?: string;
  fallback?: string;
  className?: string;
}) {
  const team = teamId ? teamsById.get(teamId) : null;

  if (!team) {
    return <span className={`text-sm text-slate-300 ${className}`}>{fallback || "Por confirmar"}</span>;
  }

  return (
    <span className={`inline-flex items-center gap-2 text-sm font-medium text-white ${className}`}>
      <Image className="h-5 w-7 rounded-sm object-cover" src={flagUrl(team)} alt={team.name} width={28} height={20} unoptimized />
      <span>{team.name}</span>
    </span>
  );
}

export function TeamPicker({
  label,
  value,
  disabled,
  placeholder = "Elige un equipo",
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? teamsById.get(value) : null;

  return (
    <div className="space-y-2">
      <span className="text-sm text-slate-300">{label}</span>
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-left text-white disabled:opacity-40"
        >
          {selected ? <TeamBadge teamId={selected.id} /> : <span className="text-sm text-slate-400">{placeholder}</span>}
          <span className="text-xs text-slate-500">{open ? "▲" : "▼"}</span>
        </button>

        {open && !disabled ? (
          <div className="absolute z-30 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl shadow-black/30 backdrop-blur">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5"
            >
              {placeholder}
            </button>
            {data.teams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => {
                  onChange(team.id);
                  setOpen(false);
                }}
                className="flex w-full items-center rounded-xl px-3 py-2 text-left hover:bg-white/5"
              >
                <TeamBadge teamId={team.id} />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Avatar({ name, avatarUrl, className = "" }: { name: string; avatarUrl?: string; className?: string }) {
  const preset = avatarUrl?.startsWith("preset:") ? avatarUrl.replace("preset:", "") : "";

  if (avatarUrl && !avatarUrl.startsWith("preset:")) {
    return (
      <span
        className={`inline-flex h-12 w-12 rounded-2xl border border-white/20 bg-cover bg-center ${className}`}
        style={{ backgroundImage: `url("${avatarUrl}")` }}
      />
    );
  }

  const tones: Record<string, string> = {
    green: "from-emerald-500 to-teal-400",
    gold: "from-amber-500 to-yellow-300",
    blue: "from-sky-500 to-indigo-400",
    rose: "from-fuchsia-500 to-rose-400",
    dark: "from-slate-700 to-slate-500",
  };

  return (
    <span
      className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-gradient-to-br ${
        tones[preset] || "from-cyan-500 to-blue-500"
      } text-sm font-bold text-slate-950 ${className}`}
    >
      {initials(name)}
    </span>
  );
}

export function Notice({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "warm" | "danger" }) {
  const toneClasses = {
    default: "border-cyan-400/20 bg-cyan-400/10 text-cyan-100",
    warm: "border-amber-400/20 bg-amber-400/10 text-amber-100",
    danger: "border-rose-400/20 bg-rose-400/10 text-rose-100",
  };

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClasses[tone]}`}>{children}</div>;
}

export function ScoreBreakdown({ scorecard, title }: { scorecard: Scorecard; title: string }) {
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Detalle</p>
          <h3 className="text-xl font-semibold text-white">{title}</h3>
        </div>
        <div className="rounded-2xl bg-white/10 px-4 py-2 text-right">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Total</p>
          <p className="text-2xl font-bold text-white">{scorecard.total}</p>
        </div>
      </div>

      {scorecard.categories.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {scorecard.categories.map((category) => (
            <div key={category.label} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-4">
                <h4 className="font-semibold text-white">{category.label}</h4>
                <span className="text-sm font-semibold text-cyan-300">{category.total} pts</span>
              </div>
              <div className="space-y-2 text-sm">
                {category.entries.map((entry) => (
                  <div key={`${entry.ruleCode}-${entry.sourceRef}-${entry.matchNumber ?? "x"}`} className="flex items-start justify-between gap-3">
                    <p className="text-slate-300">{entry.explanation}</p>
                    <strong className={entry.points >= 0 ? "text-emerald-300" : "text-rose-300"}>
                      {entry.points > 0 ? `+${entry.points}` : entry.points}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Todavía no hay puntos validados.</p>
      )}
    </Card>
  );
}

function GroupSummary({ prediction }: { prediction: Prediction }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Object.keys(prediction.groups).map((group) => {
        const rows = Object.entries(prediction.groups[group])
          .filter(([, value]) => value)
          .sort((a, b) => Number(a[1]) - Number(b[1]));

        return (
          <div key={group} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-semibold text-white">Grupo {group}</h4>
              <span className="text-xs text-slate-400">{rows.length}/4</span>
            </div>
            <div className="space-y-2">
              {rows.length ? (
                rows.map(([teamId, value]) => (
                  <div key={teamId} className="flex items-center justify-between">
                    <TeamBadge teamId={teamId} />
                    <span className="text-sm text-slate-300">{value}º</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">Pendiente.</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KnockoutSummary({ prediction, matches }: { prediction: Prediction; matches: Match[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {matches.map((match) => {
        const home = resolveSlot(match.home, match.number, prediction);
        const away = resolveSlot(match.away, match.number, prediction);
        const winner = prediction.bracket.winners[String(match.number)] || "";

        return (
          <div key={match.number} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between text-sm text-slate-400">
              <span>Partido {match.number}</span>
              <span>{match.stage}</span>
            </div>
            <div className="space-y-2">
              <div className={`rounded-xl px-3 py-2 ${winner === home ? "bg-cyan-400/10" : "bg-slate-950/40"}`}>
                <TeamBadge teamId={home} fallback={translateSlot(match.home)} />
              </div>
              <div className={`rounded-xl px-3 py-2 ${winner === away ? "bg-cyan-400/10" : "bg-slate-950/40"}`}>
                <TeamBadge teamId={away} fallback={translateSlot(match.away)} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PredictionSnapshot({
  prediction,
  matches,
  playerName,
  profile,
}: {
  prediction: Prediction | null;
  matches: Match[];
  playerName: (playerId: string) => string;
  profile?: UserProfile;
}) {
  const safePrediction = prediction || emptyPrediction();
  const [section, setSection] = useState<"summary" | "groups" | "knockout">("summary");

  const champion = safePrediction.bracket.winners["104"] || "";
  const runnerUp = champion ? loserForMatch(104, safePrediction) : "";

  return (
    <Card className="space-y-5">
      {profile ? (
        <div className="flex items-center gap-4">
          <Avatar name={profile.name} avatarUrl={profile.avatarUrl} />
          <div>
            <h3 className="text-xl font-semibold text-white">{profile.name}</h3>
            <p className="text-sm text-slate-400">
              {profile.points} puntos · {profile.complete}% completada
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSection("summary")}
          className={`rounded-full px-4 py-2 text-sm ${section === "summary" ? "bg-cyan-400 text-slate-950" : "bg-white/10 text-slate-200"}`}
        >
          Resumen
        </button>
        <button
          type="button"
          onClick={() => setSection("groups")}
          className={`rounded-full px-4 py-2 text-sm ${section === "groups" ? "bg-cyan-400 text-slate-950" : "bg-white/10 text-slate-200"}`}
        >
          Grupos
        </button>
        <button
          type="button"
          onClick={() => setSection("knockout")}
          className={`rounded-full px-4 py-2 text-sm ${section === "knockout" ? "bg-cyan-400 text-slate-950" : "bg-white/10 text-slate-200"}`}
        >
          Cuadro
        </button>
      </div>

      {section === "summary" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryStat title="Campeón" value={champion ? <TeamBadge teamId={champion} /> : "Pendiente"} />
          <SummaryStat title="Subcampeón" value={runnerUp ? <TeamBadge teamId={runnerUp} /> : "Pendiente"} />
          <SummaryStat title="Máximo goleador" value={safePrediction.extras.topScorer ? playerName(safePrediction.extras.topScorer) : "Pendiente"} />
          <SummaryStat title="MVP" value={safePrediction.extras.mvp ? playerName(safePrediction.extras.mvp) : "Pendiente"} />
          <SummaryStat title="Once ideal" value={`${safePrediction.xi.length}/11`} />
        </div>
      ) : null}

      {section === "groups" ? <GroupSummary prediction={safePrediction} /> : null}
      {section === "knockout" ? <KnockoutSummary prediction={safePrediction} matches={matches.filter((match) => match.number >= 73)} /> : null}
    </Card>
  );
}

function SummaryStat({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{title}</p>
      <div className="mt-2 text-base font-semibold text-white">{value}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-4 py-14 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-cyan-400/15 text-2xl font-bold text-cyan-300">{icon}</div>
      <div className="space-y-2">
        <h3 className="text-xl font-semibold text-white">{title}</h3>
        <p className="max-w-xl text-sm text-slate-400">{description}</p>
      </div>
      {action}
    </Card>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
    >
      {children}
    </Link>
  );
}

export function ScheduleMeta({ match }: { match: Match }) {
  return (
    <div className="text-xs text-slate-400">
      <p>{formatScheduleDate(match)}</p>
      <p>{match.venue}</p>
    </div>
  );
}
