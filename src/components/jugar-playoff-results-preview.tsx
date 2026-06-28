"use client";

import { useCallback, useMemo, useState } from "react";

import { PlayoffsBalatroResults } from "@/components/playoffs-balatro-demo";
import { schedule } from "@/lib/data";
import { emptyPrediction } from "@/lib/prediction";
import type { AdminResults, Prediction } from "@/lib/types";

const previewMatchIds = ["75", "78", "77", "88"] as const;
const previewMatchNumbers = new Set(
  previewMatchIds.map((id) => Number.parseInt(id, 10)),
);

const previewAdminResults: AdminResults = {
  "75": {
    awayScore: 2,
    awayTeamId: "mar",
    events: [],
    homeScore: 1,
    homeTeamId: "ned",
    status: "validated",
    trainerTactics: {
      "red-card": ["ned"],
    },
  },
  "88": {
    awayScore: 1,
    awayTeamId: "egy",
    events: [],
    homeScore: 1,
    homeTeamId: "aus",
    status: "validated",
    trainerTactics: {
      penalty: [],
    },
  },
};

function buildPreviewPrediction(): Prediction {
  return {
    ...emptyPrediction(),
    matchPredictions: {
      "75": {
        homeScore: "1",
        awayScore: "2",
        trainerTeamId: "ned",
        tacticId: "red-card",
      },
      "78": {
        homeScore: "",
        awayScore: "",
        trainerTeamId: "civ",
        tacticId: "clean-sheet",
      },
      "77": {
        homeScore: "2",
        awayScore: "1",
      },
      "88": {
        homeScore: "0",
        awayScore: "1",
        trainerTeamId: "egy",
        tacticId: "penalty",
      },
    },
  };
}

export function JugarPlayoffResultsPreview() {
  const [prediction, setPrediction] = useState<Prediction>(
    buildPreviewPrediction,
  );
  const previewScheduleMatches = useMemo(
    () => schedule.filter((match) => previewMatchNumbers.has(match.number)),
    [],
  );

  const updateScore = useCallback(
    (
      matchNumber: number,
      side: "homeScore" | "awayScore",
      value: string,
    ) => {
      setPrediction((current) => ({
        ...current,
        matchPredictions: {
          ...current.matchPredictions,
          [String(matchNumber)]: {
            ...current.matchPredictions[String(matchNumber)],
            homeScore:
              current.matchPredictions[String(matchNumber)]?.homeScore ?? "",
            awayScore:
              current.matchPredictions[String(matchNumber)]?.awayScore ?? "",
            [side]: value,
          },
        },
      }));
    },
    [],
  );

  const updateTrainerTactic = useCallback(
    (matchNumber: number, trainerTeamId: string, tacticId: string) => {
      setPrediction((current) => ({
        ...current,
        matchPredictions: {
          ...current.matchPredictions,
          [String(matchNumber)]: {
            ...current.matchPredictions[String(matchNumber)],
            homeScore:
              current.matchPredictions[String(matchNumber)]?.homeScore ?? "",
            awayScore:
              current.matchPredictions[String(matchNumber)]?.awayScore ?? "",
            trainerTeamId,
            tacticId,
          },
        },
      }));
    },
    [],
  );

  return (
    <PlayoffsBalatroResults
      adminResults={previewAdminResults}
      initialOpenMatchId={null}
      matchIds={previewMatchIds}
      prediction={prediction}
      scheduleMatches={previewScheduleMatches}
      showResultsHeader={false}
      showPhaseSelector={false}
      onScoreChange={updateScore}
      onTrainerTacticChange={updateTrainerTactic}
    />
  );
}
