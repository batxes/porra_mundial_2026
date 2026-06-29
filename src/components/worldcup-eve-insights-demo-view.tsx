"use client";

import { useMemo, useState } from "react";

import { Card, SectionHeading, TeamFlag } from "@/components/common";
import { data, knockoutMatches, teamsById } from "@/lib/data";
import { translateSlot } from "@/lib/format";
import { confirmedRound32Teams } from "@/lib/playoff-teams";
import type { Match, Team } from "@/lib/types";

type ThirdSlotChance = {
  host: string;
  matchNumber: number;
  probability: number;
};

type ThirdRow = {
  chance: number;
  gd: number;
  gf: number;
  group: string;
  points: number;
  slots: ThirdSlotChance[];
  team: Team;
};

type PathOpponent = {
  fallback: string;
  probability: number;
  teamId: string;
};

type PathStep = {
  matchNumber: number;
  opponents: PathOpponent[];
  round: string;
  venue: string;
};

type StageOddsRow = {
  champion: number;
  final: number;
  qf: number;
  r16: number;
  r32: number;
  sf: number;
  team: Team;
};

const PICK = "#a7f600";
const FEATURED_TEAMS = ["esp", "bra", "arg", "fra", "mex"] as const;
const STAGE_COLUMNS = [
  { key: "r32", label: "R32" },
  { key: "r16", label: "R16" },
  { key: "qf", label: "QF" },
  { key: "sf", label: "SF" },
  { key: "final", label: "Final" },
  { key: "champion", label: "Copa" },
] as const;

const TEAM_POWER: Record<string, number> = {
  arg: 93,
  bel: 83,
  bra: 96,
  can: 74,
  civ: 78,
  cro: 82,
  eng: 91,
  esp: 94,
  fra: 95,
  ger: 90,
  ita: 86,
  jpn: 80,
  mar: 82,
  mex: 79,
  ned: 87,
  por: 89,
  sen: 80,
  sui: 78,
  usa: 79,
  uru: 85,
};

const matchByNumber = new Map(
  knockoutMatches.map((match) => [match.number, match]),
);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hashTeam(teamId: string) {
  return teamId.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
}

function teamPower(teamId: string) {
  return TEAM_POWER[teamId] ?? 58 + (hashTeam(teamId) % 22);
}

function formatPct(value: number) {
  const pct = value * 100;
  if (pct > 0 && pct < 1) return "<1%";
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

function teamShort(teamId: string) {
  return teamId.toUpperCase();
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function matchWinnerSlot(value: string) {
  const match = String(value).match(/^Winner Match (\d+)$/);
  return match ? Number(match[1]) : null;
}

function childMatches(match: Match): [number, number] | null {
  const home = matchWinnerSlot(match.home);
  const away = matchWinnerSlot(match.away);
  return home && away ? [home, away] : null;
}

function parentForWinner(matchNumber: number) {
  return (
    knockoutMatches.find(
      (match) =>
        match.home === `Winner Match ${matchNumber}` ||
        match.away === `Winner Match ${matchNumber}`,
    ) || null
  );
}

function round32Teams(matchNumber: number) {
  const confirmed = confirmedRound32Teams[String(matchNumber)];
  if (confirmed) return [confirmed.home || "", confirmed.away || ""].filter(Boolean);

  const match = matchByNumber.get(matchNumber);
  if (!match) return [];

  return [match.home, match.away].filter((teamId) => teamsById.has(teamId));
}

function leafTeamIds(matchNumber: number): string[] {
  const match = matchByNumber.get(matchNumber);
  if (!match) return [];

  const children = childMatches(match);
  if (!children) return round32Teams(matchNumber);

  return children.flatMap((child) => leafTeamIds(child));
}

function currentMatchForTeam(teamId: string) {
  return Object.entries(confirmedRound32Teams).find(([, sides]) =>
    [sides.home, sides.away].includes(teamId),
  )?.[0];
}

function opponentPoolForStep(matchNumber: number, selectedTeamId: string) {
  const match = matchByNumber.get(matchNumber);
  if (!match) return [];

  const children = childMatches(match);
  if (!children) {
    return round32Teams(matchNumber).filter((teamId) => teamId !== selectedTeamId);
  }

  const [first, second] = children;
  const firstLeaves = leafTeamIds(first);
  const selectedBranch = firstLeaves.includes(selectedTeamId) ? first : second;
  const sibling = selectedBranch === first ? second : first;
  return leafTeamIds(sibling);
}

function normalizeOpponents(teamIds: string[]): PathOpponent[] {
  const uniqueIds = Array.from(new Set(teamIds)).filter((teamId) =>
    teamsById.has(teamId),
  );
  const total = uniqueIds.reduce((sum, teamId) => sum + teamPower(teamId), 0) || 1;

  return uniqueIds
    .map((teamId) => ({
      fallback: teamShort(teamId),
      probability: teamPower(teamId) / total,
      teamId,
    }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 4);
}

function buildPath(teamId: string): PathStep[] {
  const start = currentMatchForTeam(teamId);
  if (!start) return [];

  const steps: PathStep[] = [];
  let matchNumber = Number(start);

  while (matchNumber) {
    const match = matchByNumber.get(matchNumber);
    if (!match || match.stage === "Tercer puesto") break;

    steps.push({
      matchNumber,
      opponents: normalizeOpponents(opponentPoolForStep(matchNumber, teamId)),
      round: match.stage,
      venue: match.venue,
    });

    const parent = parentForWinner(matchNumber);
    matchNumber = parent?.number || 0;
  }

  return steps;
}

function thirdSlotOptions(match: Match) {
  const slot = match.home.startsWith("3rd Group")
    ? match.home
    : match.away.startsWith("3rd Group")
      ? match.away
      : "";

  return slot ? slot.replace("3rd Group ", "").split("/") : [];
}

function thirdSlotHost(match: Match) {
  const host = match.home.startsWith("3rd Group") ? match.away : match.home;
  return translateSlot(host);
}

function buildThirdRows(): ThirdRow[] {
  const groups = Array.from(new Set(data.teams.map((team) => team.group))).sort();

  return groups
    .map((group) => {
      const groupIndex = group.charCodeAt(0) - 65;
      const ordered = data.teams
        .filter((team) => team.group === group)
        .sort((a, b) => teamPower(b.id) - teamPower(a.id));
      const team = ordered[2] || ordered[0];
      const strength = teamPower(team.id);
      const chance = clamp(
        0.32 + (strength - 60) * 0.012 + ((groupIndex % 4) - 1.5) * 0.035,
        0.16,
        0.89,
      );
      const slotMatches = knockoutMatches
        .map((match) => ({
          match,
          options: thirdSlotOptions(match),
          weight: 1 + ((match.number + groupIndex) % 5) * 0.22,
        }))
        .filter(({ options }) => options.includes(group));
      const totalWeight =
        slotMatches.reduce((sum, item) => sum + item.weight, 0) || 1;

      return {
        chance,
        gd: Math.round((chance - 0.44) * 8),
        gf: Math.max(2, Math.round(2 + chance * 5 + (groupIndex % 2))),
        group,
        points: clamp(Math.round(3 + chance * 5), 3, 8),
        slots: slotMatches
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 4)
          .map(({ match, weight }) => ({
            host: thirdSlotHost(match),
            matchNumber: match.number,
            probability: (chance * weight) / totalWeight,
          })),
        team,
      };
    })
    .sort((a, b) => b.chance - a.chance);
}

function buildStageOdds(): StageOddsRow[] {
  return [...data.teams]
    .sort((a, b) => teamPower(b.id) - teamPower(a.id))
    .slice(0, 12)
    .map((team) => {
      const strength = clamp((teamPower(team.id) - 55) / 45, 0.15, 0.98);
      const r32 = clamp(0.48 + strength * 0.46, 0.18, 0.98);
      const r16 = r32 * clamp(0.44 + strength * 0.38, 0.18, 0.86);
      const qf = r16 * clamp(0.42 + strength * 0.33, 0.16, 0.78);
      const sf = qf * clamp(0.39 + strength * 0.29, 0.14, 0.72);
      const final = sf * clamp(0.36 + strength * 0.27, 0.12, 0.66);
      const champion = final * clamp(0.33 + strength * 0.26, 0.1, 0.6);

      return { champion, final, qf, r16, r32, sf, team };
    });
}

function DemoCard({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <Card className={`min-w-0 p-0 ${className}`}>
      <div className="flex h-11 items-center justify-between border-b border-white/10 px-4">
        <h2 className="truncate text-sm font-semibold text-white">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

function MiniFlag({ teamId, className = "" }: { teamId: string; className?: string }) {
  return (
    <span
      className={`inline-flex h-5 w-7 shrink-0 overflow-hidden rounded-sm bg-white/10 ring-1 ring-white/10 ${className}`}
    >
      <TeamFlag teamId={teamId} className="h-full w-full" />
    </span>
  );
}

function ChanceBar({
  className = "",
  value,
}: {
  className?: string;
  value: number;
}) {
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      <span className="h-2 min-w-16 flex-1 overflow-hidden rounded-sm bg-white/10">
        <span
          className="block h-full rounded-sm"
          style={{
            background: `linear-gradient(90deg, ${PICK}, #32d5ff)`,
            width: `${Math.round(value * 100)}%`,
          }}
        />
      </span>
      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-zinc-300">
        {formatPct(value)}
      </span>
    </span>
  );
}

function ArrowIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

function ThirdsCard({ rows }: { rows: ThirdRow[] }) {
  const [openGroup, setOpenGroup] = useState(rows[0]?.group || "");

  return (
    <DemoCard title="Mejores terceros" className="lg:col-span-2">
      <div className="overflow-x-auto">
        <div className="min-w-[680px] px-3 py-3">
          <div className="grid grid-cols-[minmax(11rem,1fr)_2.25rem_2.5rem_2.5rem_2.5rem_minmax(11rem,1fr)_1.5rem] gap-2 px-2 pb-2 text-[11px] font-medium text-zinc-500">
            <span>Equipo</span>
            <span className="text-center">G</span>
            <span className="text-right">Pts</span>
            <span className="text-right">DG</span>
            <span className="text-right">GF</span>
            <span>Chance</span>
            <span />
          </div>

          <div className="space-y-1">
            {rows.map((row) => {
              const open = openGroup === row.group;
              return (
                <div key={row.group}>
                  <button
                    type="button"
                    onClick={() => setOpenGroup(open ? "" : row.group)}
                    className="grid h-9 w-full grid-cols-[minmax(11rem,1fr)_2.25rem_2.5rem_2.5rem_2.5rem_minmax(11rem,1fr)_1.5rem] items-center gap-2 rounded-md px-2 text-left text-sm text-zinc-200 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a7f600]"
                    aria-expanded={open}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <MiniFlag teamId={row.team.id} />
                      <span className="truncate font-semibold">{row.team.name}</span>
                    </span>
                    <span className="text-center text-xs text-zinc-400">{row.group}</span>
                    <span className="text-right text-sm font-semibold tabular-nums text-white">
                      {row.points}
                    </span>
                    <span className="text-right text-xs tabular-nums text-zinc-400">
                      {signed(row.gd)}
                    </span>
                    <span className="text-right text-xs tabular-nums text-zinc-400">
                      {row.gf}
                    </span>
                    <ChanceBar value={row.chance} />
                    <span className="flex justify-end text-zinc-500">
                      <ArrowIcon open={open} />
                    </span>
                  </button>

                  {open ? (
                    <div className="ml-5 border-l border-white/10 py-1 pl-4">
                      {row.slots.map((slot) => (
                        <div
                          key={`${row.group}-${slot.matchNumber}`}
                          className="grid h-7 grid-cols-[minmax(13rem,1fr)_minmax(11rem,1fr)] items-center gap-3 text-xs"
                        >
                          <span className="truncate text-zinc-500">
                            Partido {slot.matchNumber} contra {slot.host}
                          </span>
                          <ChanceBar value={slot.probability} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </DemoCard>
  );
}

function TeamPicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (teamId: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-1">
      {FEATURED_TEAMS.map((teamId) => {
        const team = teamsById.get(teamId);
        const active = selected === teamId;
        return (
          <button
            key={teamId}
            type="button"
            onClick={() => onSelect(teamId)}
            className={`flex h-10 min-w-0 items-center gap-2 rounded-md border px-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a7f600] ${
              active
                ? "border-[#a7f600] bg-[#a7f600]/12 text-white"
                : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.07]"
            }`}
          >
            <MiniFlag teamId={teamId} />
            <span className="min-w-0 truncate font-semibold">
              {team?.name || teamShort(teamId)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function OpponentRow({ opponent }: { opponent: PathOpponent }) {
  const team = teamsById.get(opponent.teamId);

  return (
    <div className="flex h-6 items-center gap-2">
      <MiniFlag teamId={opponent.teamId} />
      <span className="w-10 shrink-0 text-xs font-semibold text-zinc-200">
        {teamShort(opponent.teamId)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
        {team?.name || opponent.fallback}
      </span>
      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-zinc-300">
        {formatPct(opponent.probability)}
      </span>
    </div>
  );
}

function TeamPathCard({ selectedTeamId }: { selectedTeamId: string }) {
  const steps = useMemo(() => buildPath(selectedTeamId), [selectedTeamId]);
  const team = teamsById.get(selectedTeamId);

  return (
    <DemoCard title="Camino de equipo">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
            <TeamFlag teamId={selectedTeamId} className="h-full w-full rounded-full" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-white">
              {team?.name || teamShort(selectedTeamId)}
            </p>
            <p className="truncate text-xs text-zinc-500">Ruta hasta la final</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-3">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          return (
            <div
              key={step.matchNumber}
              className="grid grid-cols-[1rem_minmax(0,1fr)] gap-3"
            >
              <div className="flex flex-col items-center">
                <span className="mt-1 h-2 w-2 rounded-full bg-[#a7f600]" />
                {!last ? <span className="my-1 w-px flex-1 bg-white/10" /> : null}
              </div>
              <div className="pb-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-xs font-semibold text-zinc-200">
                    {step.round}
                  </p>
                  <p className="shrink-0 text-xs text-zinc-600">
                    P{step.matchNumber}
                  </p>
                </div>
                <p className="truncate text-xs text-zinc-500">{step.venue}</p>
                <div className="mt-2 space-y-1">
                  {step.opponents.map((opponent) => (
                    <OpponentRow key={opponent.teamId} opponent={opponent} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </DemoCard>
  );
}

function HeatCell({ value }: { value: number }) {
  const strength = Math.round(clamp(value, 0, 1) * 72);
  const strong = value >= 0.45;

  return (
    <span
      className={`flex h-7 items-center justify-center rounded-sm px-1 text-xs tabular-nums ${
        strong ? "font-semibold text-black" : "text-zinc-200"
      }`}
      style={{
        backgroundColor: `color-mix(in oklab, ${PICK} ${strength}%, rgba(255,255,255,0.08))`,
      }}
    >
      {formatPct(value)}
    </span>
  );
}

function StageOddsCard({ rows }: { rows: StageOddsRow[] }) {
  return (
    <DemoCard title="Probabilidades por fase">
      <div className="overflow-x-auto">
        <div className="min-w-[540px] px-3 py-3">
          <div className="grid grid-cols-[minmax(8.5rem,1fr)_repeat(6,3.4rem)] items-center gap-2 px-2 pb-2 text-[11px] font-medium text-zinc-500">
            <span>Equipo</span>
            {STAGE_COLUMNS.map((column) => (
              <span key={column.key} className="text-center">
                {column.label}
              </span>
            ))}
          </div>

          <div className="space-y-1">
            {rows.map((row) => (
              <div
                key={row.team.id}
                className="grid h-9 grid-cols-[minmax(8.5rem,1fr)_repeat(6,3.4rem)] items-center gap-2 rounded-md px-2 hover:bg-white/[0.04]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <MiniFlag teamId={row.team.id} />
                  <span className="truncate text-sm font-semibold text-zinc-200">
                    {row.team.name}
                  </span>
                </span>
                {STAGE_COLUMNS.map((column) => (
                  <HeatCell key={column.key} value={row[column.key]} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </DemoCard>
  );
}

export function WorldCupEveInsightsDemoView() {
  const [selectedTeamId, setSelectedTeamId] = useState<string>("esp");
  const thirdRows = useMemo(() => buildThirdRows(), []);
  const stageRows = useMemo(() => buildStageOdds(), []);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <SectionHeading
        eyebrow="Demo"
        title="Widgets tipo Eve"
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 space-y-4">
          <DemoCard title="Equipo">
            <TeamPicker selected={selectedTeamId} onSelect={setSelectedTeamId} />
          </DemoCard>
          <TeamPathCard selectedTeamId={selectedTeamId} />
        </div>
        <StageOddsCard rows={stageRows} />
        <ThirdsCard rows={thirdRows} />
      </div>
    </main>
  );
}
