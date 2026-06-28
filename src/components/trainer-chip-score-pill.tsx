"use client";

import { TeamFlag } from "@/components/common";
import { trainerTacticById } from "@/lib/trainer-tactics";
import type { AdminResult, ScoreEntry } from "@/lib/types";

export type TrainerChipPoints = {
  teamId: string;
  tacticId: string;
  title: string;
  points: number;
};

export function signedPoints(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function trainerChipFromScoreEntry(
  entry: ScoreEntry,
): TrainerChipPoints | null {
  if (entry.ruleCode !== "trainer_tactic_hit" || !entry.matchNumber) {
    return null;
  }

  const prefix = `trainer-tactic-${entry.matchNumber}-`;
  if (!entry.sourceRef.startsWith(prefix)) return null;

  const rest = entry.sourceRef.slice(prefix.length);
  const tacticId = [...trainerTacticById.keys()].find((id) =>
    rest.endsWith(`-${id}`),
  );
  if (!tacticId) return null;

  const teamId = rest.slice(0, -(tacticId.length + 1));
  const tactic = trainerTacticById.get(tacticId);
  if (!teamId || !tactic) return null;

  return {
    teamId,
    tacticId,
    title: tactic.title,
    points: entry.points,
  };
}

export function addTrainerChipPoints(
  chips: Map<string, TrainerChipPoints>,
  chip: TrainerChipPoints,
) {
  const key = `${chip.teamId}-${chip.tacticId}`;
  const current = chips.get(key);
  chips.set(key, {
    ...chip,
    points: (current?.points || 0) + chip.points,
  });
}

export function sortTrainerChips(chips: Map<string, TrainerChipPoints>) {
  return [...chips.values()].sort(
    (a, b) =>
      b.points - a.points ||
      a.title.localeCompare(b.title) ||
      a.teamId.localeCompare(b.teamId),
  );
}

export function trainerChipsFromScoreEntries(entries: ScoreEntry[]) {
  const trainerByChip = new Map<string, TrainerChipPoints>();
  entries.forEach((entry) => {
    const chip = trainerChipFromScoreEntry(entry);
    if (chip) addTrainerChipPoints(trainerByChip, chip);
  });
  return sortTrainerChips(trainerByChip);
}

export function matchTrainerTacticLines(result: AdminResult | undefined) {
  const tactics = result?.trainerTactics || {};
  return Object.entries(tactics).flatMap(([tacticId, teamIds]) => {
    const tactic = trainerTacticById.get(tacticId);
    if (!tactic) return [];
    return [...new Set(teamIds.filter(Boolean))].map((teamId) => ({
      teamId,
      tacticId,
      title: tactic.title,
      points: tactic.points,
    }));
  });
}

export function TrainerChipScorePill({
  chip,
}: {
  chip: TrainerChipPoints;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] py-px pl-px pr-1.5 text-[10px] font-medium text-zinc-400">
      <TeamFlag
        teamId={chip.teamId}
        className="size-4 shrink-0 rounded-full border border-white/15 object-cover"
      />
      <span className="min-w-0 max-w-[5.5rem] truncate">{chip.title}</span>
      <span className={chip.points >= 0 ? "text-white" : "text-red-400"}>
        {signedPoints(chip.points)}
      </span>
    </span>
  );
}

export function TrainerTacticEventLine({
  align = "left",
  chip,
}: {
  align?: "left" | "right";
  chip: TrainerChipPoints;
}) {
  const flagNode = (
    <TeamFlag
      teamId={chip.teamId}
      className="size-4 shrink-0 rounded-full border border-white/15 object-cover"
    />
  );
  const titleNode = <span className="min-w-0 truncate">{chip.title}</span>;
  const pointsNode = (
    <span className="shrink-0 font-semibold text-white">
      {signedPoints(chip.points)}
    </span>
  );

  return (
    <div
      className={`flex items-center gap-1.5 text-[12px] font-medium text-zinc-400 ${
        align === "right" ? "justify-end text-right" : ""
      }`}
    >
      {align === "right" ? (
        <>
          {pointsNode}
          {titleNode}
          {flagNode}
        </>
      ) : (
        <>
          {flagNode}
          {titleNode}
          {pointsNode}
        </>
      )}
    </div>
  );
}
