"use client";

import type { CSSProperties } from "react";
import Link from "next/link";

import { TeamFlag } from "@/components/common";
import { teamsById } from "@/lib/data";
import { trainerTacticById } from "@/lib/trainer-tactics";

const trainerChipColors: Record<string, string> = {
  "clean-sheet": "#69d744",
  "first-goal": "#d946ef",
  "over-25": "#a7f600",
  penalty: "#f5c518",
  "red-card": "#ff4d2d",
  "set-piece": "#38bdf8",
};

export function TrainerTacticPickPill({
  className = "",
  href,
  showEmpty = true,
  tacticId,
  teamId,
}: {
  className?: string;
  href?: string;
  showEmpty?: boolean;
  tacticId?: string;
  teamId?: string;
}) {
  const tactic = tacticId ? trainerTacticById.get(tacticId) : null;
  const selected = Boolean(tactic && teamId && teamsById.has(teamId));
  const style =
    selected && tacticId
      ? ({
          "--tactic-color":
            trainerChipColors[tacticId] || trainerChipColors["set-piece"],
        } as CSSProperties)
      : undefined;

  if (!selected && !showEmpty) return null;

  const classes = `home-trainer-chip-state playoff-battle-pick-state ${
    selected
      ? "playoff-battle-pick-state--picked"
      : "playoff-battle-pick-state--empty"
  } ${href ? "transition hover:brightness-110" : ""} ${className}`;
  const content =
    selected && tactic && teamId ? (
      <>
        <TeamFlag teamId={teamId} className="playoff-battle-pick-flag" />
        <span>{tactic.title}</span>
        <strong>+{tactic.points}</strong>
      </>
    ) : (
      <>
        <span>+</span>
        <span>Elegir chip</span>
      </>
    );

  if (href) {
    return (
      <Link href={href} className={classes} style={style}>
        {content}
      </Link>
    );
  }

  return (
    <span className={classes} style={style}>
      {content}
    </span>
  );
}
