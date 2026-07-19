import type { AdminResults, FinalElectionResults, Match, Player, PorraData, Prediction, Scorecard, ScoreEntry, Team } from "@/lib/types";
import { resultLoserTeamId, resultWinnerTeamId } from "@/lib/match-events";
import { trainerTacticById } from "@/lib/trainer-tactics";

const ruleMeta = {
  match_outcome_hit: { label: "Eleccion acertada", category: "Marcadores" },
  match_exact_score: { label: "Marcador exacto", category: "Marcadores" },
  player_goal: { label: "Gol de tu once", category: "Tu once" },
  player_penalty_goal: { label: "Penalti marcado", category: "Tu once" },
  player_match_mvp: { label: "MVP del partido", category: "Tu once" },
  player_penalty_save: { label: "Penalti parado", category: "Tu once" },
  player_penalty_miss: { label: "Penalti fallado", category: "Tu once" },
  player_red_card: { label: "Tarjeta roja", category: "Tu once" },
  trainer_tactic_hit: { label: "Chip de entrenador", category: "Entrenadores" },
  team_progression_hit: { label: "Acierto de fase", category: "Cuadro" },
  group_qualification_hit: { label: "Equipo clasificado en grupos", category: "Fase de grupos" },
  group_third_qualification_hit: { label: "Tercer clasificado acertado", category: "Fase de grupos" },
  group_position_hit: { label: "Orden exacto en grupo", category: "Fase de grupos" },
  tournament_champion_hit: { label: "Campeón del Mundial", category: "Tus elecciones" },
  tournament_highest_scoring_team_hit: { label: "Equipo más goleador", category: "Tus elecciones" },
  tournament_most_conceded_team_hit: { label: "Equipo más goleado", category: "Tus elecciones" },
  tournament_most_reds_team_hit: { label: "Equipo con más rojas", category: "Tus elecciones" },
  tournament_mvp_hit: { label: "MVP del Mundial", category: "Tus elecciones" },
  tournament_top_scorer_hit: { label: "Máximo goleador", category: "Tus elecciones" },
} as const;

const GROUP_SCORING_ENABLED = true;

const eventRules = {
  goal: { ruleCode: "player_goal", points: 2 },
  gol: { ruleCode: "player_goal", points: 2 },
  penalty_goal: { ruleCode: "player_penalty_goal", points: 1 },
  "penalti marcado": { ruleCode: "player_penalty_goal", points: 1 },
  mvp: { ruleCode: "player_match_mvp", points: 3 },
  MVP: { ruleCode: "player_match_mvp", points: 3 },
  penalty_save: { ruleCode: "player_penalty_save", points: 2 },
  "penalti parado": { ruleCode: "player_penalty_save", points: 2 },
  penalty_miss: { ruleCode: "player_penalty_miss", points: -1 },
  "penalti fallado": { ruleCode: "player_penalty_miss", points: -1 },
  red_card: { ruleCode: "player_red_card", points: -2 },
  roja: { ruleCode: "player_red_card", points: -2 },
} as const;

const goalPointsByPosition = {
  DEL: 2,
  MED: 6,
  DEF: 11,
  POR: 35,
} as const;

export function createEngine({ data, schedule }: { data: PorraData; schedule: Match[] }) {
  const teams = new Map(data.teams.map((team) => [team.id, team]));
  const players = new Map(data.players.map((player) => [player.id, player]));

  function parseScore(value: number | string | null | undefined) {
    if (value === "" || value === null || value === undefined) return null;
    const score = Number(value);
    return Number.isFinite(score) && score >= 0 ? score : null;
  }

  function isScored(result: AdminResults[string] | undefined) {
    return parseScore(result?.homeScore) !== null && parseScore(result?.awayScore) !== null;
  }

  function teamName(teamId: string) {
    return teams.get(teamId)?.name || "Equipo por confirmar";
  }

  function playerName(playerId: string) {
    return players.get(playerId)?.name || "Jugador";
  }

  function matchOutcome(homeScore: number, awayScore: number) {
    if (homeScore > awayScore) return "home";
    if (awayScore > homeScore) return "away";
    return "draw";
  }

  function pointsForEvent(playerId: string, rule: (typeof eventRules)[keyof typeof eventRules]) {
    if (rule.ruleCode !== "player_goal") return rule.points;
    const position = players.get(playerId)?.position;
    return position ? goalPointsByPosition[position] : rule.points;
  }

  function actualTeamId(match: Match, result: AdminResults[string] | undefined, side: "home" | "away") {
    const override = result?.[`${side}TeamId`];
    const scheduled = match?.[side];
    if (override && teams.has(override)) return override;
    if (teams.has(scheduled)) return scheduled;
    return "";
  }

  function addEntry(entries: ScoreEntry[], entry: Partial<ScoreEntry> & Pick<ScoreEntry, "ruleCode" | "points" | "explanation">) {
    const meta = ruleMeta[entry.ruleCode as keyof typeof ruleMeta] || { label: entry.ruleCode, category: "Otros" };
    entries.push({
      userId: entry.userId || "",
      matchId: entry.matchId || null,
      matchNumber: entry.matchNumber || null,
      ruleCode: entry.ruleCode,
      label: meta.label,
      category: meta.category,
      points: entry.points,
      explanation: entry.explanation,
      sourceRef: entry.sourceRef || "",
    });
  }

  function calculateGroupPositions(adminResults: AdminResults) {
    const byGroup: Record<string, { teams: Map<string, { teamId: string; pts: number; gf: number; ga: number; gd: number }>; playedMatches: number; expectedMatches: number }> = {};

    data.teams.forEach((team) => {
      byGroup[team.group] ||= { teams: new Map(), playedMatches: 0, expectedMatches: 0 };
      byGroup[team.group].teams.set(team.id, { teamId: team.id, pts: 0, gf: 0, ga: 0, gd: 0 });
    });

    schedule
      .filter((match) => match.stage === "Grupos")
      .forEach((match) => {
        const result = adminResults[String(match.number)];
        const home = actualTeamId(match, result, "home");
        const away = actualTeamId(match, result, "away");
        const group = teams.get(home)?.group;
        if (!group || group !== teams.get(away)?.group) return;
        byGroup[group].expectedMatches += 1;
        if (!isScored(result)) return;
        byGroup[group].playedMatches += 1;

        const homeScore = parseScore(result?.homeScore) ?? 0;
        const awayScore = parseScore(result?.awayScore) ?? 0;
        const homeRow = byGroup[group].teams.get(home);
        const awayRow = byGroup[group].teams.get(away);

        if (!homeRow || !awayRow) return;

        homeRow.gf += homeScore;
        homeRow.ga += awayScore;
        awayRow.gf += awayScore;
        awayRow.ga += homeScore;
        homeRow.gd = homeRow.gf - homeRow.ga;
        awayRow.gd = awayRow.gf - awayRow.ga;

        if (homeScore > awayScore) homeRow.pts += 3;
        else if (awayScore > homeScore) awayRow.pts += 3;
        else {
          homeRow.pts += 1;
          awayRow.pts += 1;
        }
      });

    return Object.fromEntries(
      Object.entries(byGroup).map(([group, table]) => {
        const complete = table.expectedMatches === 6 && table.playedMatches === table.expectedMatches;
        const positions = Array.from(table.teams.values())
          .sort(
            (a, b) =>
              b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || teamName(a.teamId).localeCompare(teamName(b.teamId)),
          )
          .map((row, index) => ({ ...row, position: index + 1 }));
        return [group, { complete, positions }];
      }),
    );
  }

  function calculateThirdQualifierIds(groupTables: ReturnType<typeof calculateGroupPositions>) {
    const tables = Object.values(groupTables);
    if (!tables.length || tables.some((table) => !table.complete)) return new Set<string>();

    return new Set(
      tables
        .map((table) => table.positions.find((row) => row.position === 3))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || teamName(a.teamId).localeCompare(teamName(b.teamId)))
        .slice(0, 8)
        .map((row) => row.teamId),
    );
  }

  function calculateScorecard(
    prediction: Prediction,
    adminResults: AdminResults,
    userId = "",
    finalElectionResults?: FinalElectionResults | null,
  ): Scorecard {
    const entries: ScoreEntry[] = [];
    const matchPredictions = prediction.matchPredictions || {};

    schedule.forEach((match) => {
      const result = adminResults[String(match.number)];
      const forecast = matchPredictions[String(match.number)] || {};
      if (!isScored(result)) return;

      const homeScore = parseScore(result?.homeScore) ?? 0;
      const awayScore = parseScore(result?.awayScore) ?? 0;
      const forecastHomeScore = parseScore(forecast.homeScore);
      const forecastAwayScore = parseScore(forecast.awayScore);

      if (
        forecastHomeScore !== null &&
        forecastAwayScore !== null &&
        matchOutcome(forecastHomeScore, forecastAwayScore) === matchOutcome(homeScore, awayScore)
      ) {
        addEntry(entries, {
          userId,
          matchId: `wc26-${match.number}`,
          matchNumber: match.number,
          ruleCode: "match_outcome_hit",
          points: 1,
          explanation: `Eleccion acertada partido ${match.number}`,
          sourceRef: `match-outcome-${match.number}`,
        });
      }

      if (forecastHomeScore === homeScore && forecastAwayScore === awayScore) {
        addEntry(entries, {
          userId,
          matchId: `wc26-${match.number}`,
          matchNumber: match.number,
          ruleCode: "match_exact_score",
          points: homeScore + awayScore,
          explanation: `Marcador exacto partido ${match.number}: ${homeScore}-${awayScore}`,
          sourceRef: `match-${match.number}`,
        });
      }

      const trainerTeamId = forecast.trainerTeamId;
      const tacticId = forecast.tacticId;
      const tactic = tacticId ? trainerTacticById.get(tacticId) : null;
      const tacticTeamIds = tacticId
        ? result?.trainerTactics?.[tacticId] || []
        : [];
      if (trainerTeamId && tactic && tacticTeamIds.includes(trainerTeamId)) {
        addEntry(entries, {
          userId,
          matchId: `wc26-${match.number}`,
          matchNumber: match.number,
          ruleCode: "trainer_tactic_hit",
          points: tactic.points,
          explanation: `${teamName(trainerTeamId)} - ${tactic.title} en el partido ${match.number}`,
          sourceRef: `trainer-tactic-${match.number}-${trainerTeamId}-${tactic.id}`,
        });
      }

      // El cuadro ya no puntua. Los resultados de "Tus elecciones" se
      // adjudican desde los valores finales confirmados manualmente en Admin.
    });

    const groupTables = calculateGroupPositions(adminResults);
    const thirdQualifierIds = calculateThirdQualifierIds(groupTables);
    const allGroupsComplete = Object.values(groupTables).every((table) => table.complete);

    if (GROUP_SCORING_ENABLED && allGroupsComplete) {
      Object.entries(groupTables).forEach(([group, table]) => {
        table.positions.forEach((row) => {
          const predictedPosition = Number(prediction.groups?.[group]?.[row.teamId] || 0);

          if (row.position <= 2 && (predictedPosition === 1 || predictedPosition === 2) && predictedPosition !== row.position) {
            addEntry(entries, {
              userId,
              ruleCode: "group_qualification_hit",
              points: 2,
              explanation: `${teamName(row.teamId)} clasificado desde el grupo ${group}`,
              sourceRef: `group-qualified-${group}-${row.teamId}`,
            });
          }

          if (
            row.position === 3 &&
            predictedPosition === 3 &&
            thirdQualifierIds.has(row.teamId) &&
            prediction.bracket?.thirdQualifiers?.includes(group)
          ) {
            addEntry(entries, {
              userId,
              ruleCode: "group_third_qualification_hit",
              points: 1,
              explanation: `${teamName(row.teamId)} tercer clasificado desde el grupo ${group}`,
              sourceRef: `group-third-qualified-${group}-${row.teamId}`,
            });
          }

        if (row.position <= 2 && predictedPosition === row.position) {
          addEntry(entries, {
            userId,
            ruleCode: "group_position_hit",
            points: 3,
            explanation: `${teamName(row.teamId)} ${row.position}º en el grupo ${group}`,
            sourceRef: `group-position-${group}-${row.teamId}`,
          });
        }
      });
      });
    }
    const selectedPlayers = new Set(prediction.xi || []);
    Object.entries(adminResults).forEach(([matchNumber, result]) => {
      (result.events || []).forEach((event, index) => {
        const playerId = event.playerId;
        if (!selectedPlayers.has(playerId)) return;
        const rule = eventRules[String(event.type) as keyof typeof eventRules];
        if (!rule) return;
        const points = pointsForEvent(playerId, rule);
        addEntry(entries, {
          userId,
          matchId: `wc26-${matchNumber}`,
          matchNumber: Number(matchNumber),
          ruleCode: rule.ruleCode,
          points,
          explanation: `${playerName(playerId)} · ${ruleMeta[rule.ruleCode].label} en el partido ${matchNumber}`,
          sourceRef: event.id || `event-${matchNumber}-${index}`,
        });
      });
    });

    if (finalElectionResults) {
      const predictedChampion =
        prediction.extras?.worldChampion || prediction.bracket?.winners?.["104"];
      if (
        finalElectionResults.worldChampion &&
        predictedChampion === finalElectionResults.worldChampion
      ) {
        addEntry(entries, {
          userId,
          ruleCode: "tournament_champion_hit",
          points: 25,
          explanation: `${teamName(finalElectionResults.worldChampion)} - Campeón del Mundial`,
          sourceRef: "worldChampion",
        });
      }

      const tiedTeamChecks = [
        ["highestScoringTeam", "tournament_highest_scoring_team_hit", 10, "Equipo más goleador"],
        ["mostConcededTeam", "tournament_most_conceded_team_hit", 10, "Equipo más goleado"],
        ["mostRedsTeam", "tournament_most_reds_team_hit", 10, "Equipo con más rojas"],
      ] as const;

      tiedTeamChecks.forEach(([predictionKey, ruleCode, points, label]) => {
        const actualIds = finalElectionResults[predictionKey];
        const predictedId = prediction.extras?.[predictionKey];
        if (!predictedId || !actualIds.includes(predictedId)) return;
        addEntry(entries, {
          userId,
          ruleCode,
          points,
          explanation: `${teamName(predictedId)} - ${label}`,
          sourceRef: predictionKey,
        });
      });

      const specialChecks = [
        ["topScorer", "tournament_top_scorer_hit", 20, "Máximo goleador del Mundial"],
        ["mvp", "tournament_mvp_hit", 20, "MVP del Mundial"],
      ] as const;

      specialChecks.forEach(([predictionKey, ruleCode, points, label]) => {
        const actualId = finalElectionResults[predictionKey];
        if (!actualId || prediction.extras?.[predictionKey] !== actualId) return;
        addEntry(entries, {
          userId,
          ruleCode,
          points,
          explanation: `${playerName(actualId)} · ${label}`,
          sourceRef: predictionKey,
        });
      });
    }

    return scorecardFromEntries(entries);
  }

  function scorecardFromEntries(rawEntries: Array<Partial<ScoreEntry> & Record<string, unknown>> = []): Scorecard {
    const entries = rawEntries.map((entry) => {
      const ruleCode = String(entry.ruleCode || entry.rule_code || "");
      const meta = ruleMeta[ruleCode as keyof typeof ruleMeta] || { label: ruleCode, category: "Otros" };

      return {
        userId: String(entry.userId || entry.user_id || ""),
        matchId: (entry.matchId || entry.match_id || null) as string | null,
        matchNumber: Number(entry.matchNumber || String(entry.match_id || "").replace("wc26-", "")) || null,
        ruleCode,
        label: String(entry.label || meta.label),
        category: String(entry.category || meta.category),
        points: Number(entry.points) || 0,
        explanation: String(entry.explanation || ""),
        sourceRef: String(entry.sourceRef || entry.source_ref || ""),
      };
    }).filter((entry) => GROUP_SCORING_ENABLED || !entry.ruleCode.startsWith("group_"));

    const categories: Record<string, { label: string; total: number; entries: ScoreEntry[] }> = {};

    entries.forEach((entry) => {
      categories[entry.category] ||= { label: entry.category, total: 0, entries: [] };
      categories[entry.category].total += entry.points;
      categories[entry.category].entries.push(entry);
    });

    return {
      total: entries.reduce((total, entry) => total + entry.points, 0),
      entries,
      categories: Object.values(categories).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }

  return {
    calculateScorecard,
    scorecardFromEntries,
    ruleMeta,
  };
}

export const scoringRules = ruleMeta;

export type TeamStandingRow = {
  team: Team;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  mostConcededScore: number;
  redCards: number;
  groupPlayed: number;
  groupPoints: number;
  groupPosition: number | null;
  groupComplete: boolean;
  progressionPoints: number;
  stageRank: number;
  stageLabel: string;
  isEliminated: boolean;
};

const teamStageRanks = {
  "Sin jugar": 0,
  Grupos: 1,
  Dieciseisavos: 2,
  Octavos: 3,
  Cuartos: 4,
  Semifinales: 5,
  Final: 6,
  Campeon: 7,
} as const;

function parseResultScore(value: number | string | null | undefined) {
  if (value === "" || value === null || value === undefined) return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 ? score : null;
}

function isResultScored(result: AdminResults[string] | undefined) {
  return parseResultScore(result?.homeScore) !== null && parseResultScore(result?.awayScore) !== null;
}

function stageRankForMatch(stage: string) {
  if (stage === "Dieciseisavos") return teamStageRanks.Dieciseisavos;
  if (stage === "Octavos") return teamStageRanks.Octavos;
  if (stage === "Cuartos") return teamStageRanks.Cuartos;
  if (stage === "Semifinales") return teamStageRanks.Semifinales;
  if (stage === "Final") return teamStageRanks.Final;
  return teamStageRanks.Grupos;
}

function nextStageRankForWinner(stage: string) {
  if (stage === "Dieciseisavos") return teamStageRanks.Octavos;
  if (stage === "Octavos") return teamStageRanks.Cuartos;
  if (stage === "Cuartos") return teamStageRanks.Semifinales;
  if (stage === "Semifinales") return teamStageRanks.Final;
  if (stage === "Final") return teamStageRanks.Campeon;
  return teamStageRanks.Grupos;
}

function teamStageLabel(rank: number) {
  if (rank >= teamStageRanks.Campeon) return "Campeón";
  if (rank >= teamStageRanks.Final) return "Final";
  if (rank >= teamStageRanks.Semifinales) return "Semifinales";
  if (rank >= teamStageRanks.Cuartos) return "Cuartos";
  if (rank >= teamStageRanks.Octavos) return "Octavos";
  if (rank >= teamStageRanks.Dieciseisavos) return "Dieciseisavos";
  if (rank >= teamStageRanks.Grupos) return "Grupos";
  return "Sin jugar";
}

function teamProgressionPoints(stage: string) {
  if (stage === "Dieciseisavos") return 5;
  if (stage === "Octavos") return 10;
  if (stage === "Cuartos") return 15;
  if (stage === "Semifinales") return 20;
  if (stage === "Final") return 25;
  return 0;
}

function actualResultTeamId(
  match: Match,
  result: AdminResults[string] | undefined,
  teamsById: Map<string, Team>,
  side: "home" | "away",
) {
  const override = result?.[`${side}TeamId`];
  const scheduled = match?.[side];
  if (override && teamsById.has(override)) return override;
  if (teamsById.has(scheduled)) return scheduled;
  return "";
}

export function calculateTeamStandings(
  adminResults: AdminResults,
  allTeams: Team[],
  schedule: Match[],
): TeamStandingRow[] {
  const teamsById = new Map(allTeams.map((team) => [team.id, team]));
  const rows = new Map<string, TeamStandingRow>(
    allTeams.map((team) => [
      team.id,
      {
        team,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        mostConcededScore: 0,
        redCards: 0,
        groupPlayed: 0,
        groupPoints: 0,
        groupPosition: null,
        groupComplete: false,
        progressionPoints: 0,
        stageRank: teamStageRanks["Sin jugar"],
        stageLabel: "Sin jugar",
        isEliminated: false,
      },
    ]),
  );
  const groupExpectedMatches = new Map<string, number>();
  const groupPlayedMatches = new Map<string, number>();

  schedule.forEach((match) => {
    const result = adminResults[String(match.number)];
    const home = actualResultTeamId(match, result, teamsById, "home");
    const away = actualResultTeamId(match, result, teamsById, "away");
    const homeRow = rows.get(home);
    const awayRow = rows.get(away);
    if (!homeRow || !awayRow) return;

    if (match.stage === "Grupos" && homeRow.team.group === awayRow.team.group) {
      const group = homeRow.team.group;
      groupExpectedMatches.set(group, (groupExpectedMatches.get(group) || 0) + 1);
    }

    (result?.events || []).forEach((event) => {
      const type = String(event.type || "");
      if ((type === "red_card" || type === "roja") && event.teamId) {
        const eventRow = rows.get(event.teamId);
        if (eventRow) eventRow.redCards += 1;
      }
    });

    if (!isResultScored(result)) return;

    const homeScore = parseResultScore(result?.homeScore) ?? 0;
    const awayScore = parseResultScore(result?.awayScore) ?? 0;
    const stageRank = stageRankForMatch(match.stage);

    homeRow.played += 1;
    awayRow.played += 1;
    homeRow.goalsFor += homeScore;
    homeRow.goalsAgainst += awayScore;
    awayRow.goalsFor += awayScore;
    awayRow.goalsAgainst += homeScore;
    homeRow.stageRank = Math.max(homeRow.stageRank, stageRank);
    awayRow.stageRank = Math.max(awayRow.stageRank, stageRank);

    if (homeScore > awayScore) {
      homeRow.wins += 1;
      awayRow.losses += 1;
    } else if (awayScore > homeScore) {
      awayRow.wins += 1;
      homeRow.losses += 1;
    } else {
      homeRow.draws += 1;
      awayRow.draws += 1;
    }

    if (match.stage === "Grupos" && homeRow.team.group === awayRow.team.group) {
      const group = homeRow.team.group;
      groupPlayedMatches.set(group, (groupPlayedMatches.get(group) || 0) + 1);
      homeRow.groupPlayed += 1;
      awayRow.groupPlayed += 1;

      if (homeScore > awayScore) {
        homeRow.groupPoints += 3;
      } else if (awayScore > homeScore) {
        awayRow.groupPoints += 3;
      } else {
        homeRow.groupPoints += 1;
        awayRow.groupPoints += 1;
      }
    }

    const progressionPoints = teamProgressionPoints(match.stage);
    const winnerTeamId = resultWinnerTeamId(result, home, away);
    const loserTeamId = resultLoserTeamId(result, home, away);
    if (progressionPoints && winnerTeamId && loserTeamId) {
      const winner = rows.get(winnerTeamId);
      const loser = rows.get(loserTeamId);
      if (!winner || !loser) return;
      winner.progressionPoints += progressionPoints;
      winner.stageRank = Math.max(winner.stageRank, nextStageRankForWinner(match.stage));
      loser.isEliminated = true;
    }
  });

  const rowsList = Array.from(rows.values());
  rowsList.forEach((row) => {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
    row.mostConcededScore = row.goalsAgainst - row.goalsFor;
    row.stageLabel = teamStageLabel(row.stageRank);
    row.groupComplete =
      (groupExpectedMatches.get(row.team.group) || 0) > 0 &&
      groupExpectedMatches.get(row.team.group) === groupPlayedMatches.get(row.team.group);
  });

  const teamName = (teamId: string) => teamsById.get(teamId)?.name || "";
  const groups = new Map<string, TeamStandingRow[]>();
  rowsList.forEach((row) => {
    groups.set(row.team.group, [...(groups.get(row.team.group) || []), row]);
  });
  groups.forEach((groupRows) => {
    groupRows
      .sort(
        (a, b) =>
          b.groupPoints - a.groupPoints ||
          b.goalDifference - a.goalDifference ||
          b.goalsFor - a.goalsFor ||
          teamName(a.team.id).localeCompare(teamName(b.team.id)),
      )
      .forEach((row, index) => {
        row.groupPosition = row.groupPlayed ? index + 1 : null;
      });
  });
  const allGroupsComplete = Array.from(groups.values()).every((groupRows) =>
    groupRows.every((row) => row.groupComplete),
  );
  const bestThirdTeamIds = new Set(
    allGroupsComplete
      ? Array.from(groups.values())
          .map((groupRows) => groupRows.find((row) => row.groupPosition === 3))
          .filter((row): row is TeamStandingRow => Boolean(row))
          .sort(
            (a, b) =>
              b.groupPoints - a.groupPoints ||
              b.goalDifference - a.goalDifference ||
              b.goalsFor - a.goalsFor ||
              teamName(a.team.id).localeCompare(teamName(b.team.id)),
          )
          .slice(0, 8)
          .map((row) => row.team.id)
      : [],
  );
  rowsList.forEach((row) => {
    if (!row.groupComplete || row.stageRank > teamStageRanks.Grupos) return;
    if (row.groupPosition === 4) row.isEliminated = true;
    if (
      allGroupsComplete &&
      row.groupPosition === 3 &&
      !bestThirdTeamIds.has(row.team.id)
    ) {
      row.isEliminated = true;
    }
  });

  return rowsList.sort(
    (a, b) =>
      b.stageRank - a.stageRank ||
      b.progressionPoints - a.progressionPoints ||
      b.groupPoints - a.groupPoints ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.team.name.localeCompare(b.team.name),
  );
}

export type PlayerStandingRow = {
  player: Player;
  points: number;
  goals: number;
  penaltyGoals: number;
  mvps: number;
  penaltySaves: number;
  penaltyMisses: number;
  redCards: number;
};

export function calculatePlayerStandings(adminResults: AdminResults, allPlayers: Player[]): PlayerStandingRow[] {
  const playersById = new Map(allPlayers.map((player) => [player.id, player]));
  const rows = new Map<string, PlayerStandingRow>();

  Object.values(adminResults || {}).forEach((result) => {
    (result.events || []).forEach((event) => {
      const player = playersById.get(event.playerId);
      if (!player) return;
      const rule = eventRules[String(event.type) as keyof typeof eventRules];
      if (!rule) return;

      const points = rule.ruleCode === "player_goal" ? goalPointsByPosition[player.position] : rule.points;
      const row =
        rows.get(player.id) || {
          player,
          points: 0,
          goals: 0,
          penaltyGoals: 0,
          mvps: 0,
          penaltySaves: 0,
          penaltyMisses: 0,
          redCards: 0,
        };
      row.points += points;
      if (rule.ruleCode === "player_goal" || rule.ruleCode === "player_penalty_goal") row.goals += 1;
      if (rule.ruleCode === "player_penalty_goal") row.penaltyGoals += 1;
      if (rule.ruleCode === "player_match_mvp") row.mvps += 1;
      if (rule.ruleCode === "player_penalty_save") row.penaltySaves += 1;
      if (rule.ruleCode === "player_penalty_miss") row.penaltyMisses += 1;
      if (rule.ruleCode === "player_red_card") row.redCards += 1;
      rows.set(player.id, row);
    });
  });

  return Array.from(rows.values()).sort(
    (a, b) => b.points - a.points || b.goals - a.goals || a.player.name.localeCompare(b.player.name),
  );
}

export type PlayerBreakdownItem = {
  ruleCode: string;
  count: number;
  pointsEach: number;
  points: number;
};

export type PlayerBreakdownMatchEvent = {
  ruleCode: string;
  minute: number | string;
  points: number;
};

export type PlayerBreakdownMatch = {
  matchNumber: number;
  opponentTeamId: string;
  points: number;
  events: PlayerBreakdownMatchEvent[];
};

export type PlayerBreakdown = {
  total: number;
  goals: number;
  mvps: number;
  items: PlayerBreakdownItem[];
  matches: PlayerBreakdownMatch[];
};

// Orden estable de los tipos de evento en el desglose (goles primero, sanciones
// al final), independiente de en que partido caigan.
const breakdownOrder = [
  "player_goal",
  "player_penalty_goal",
  "player_match_mvp",
  "player_penalty_save",
  "player_penalty_miss",
  "player_red_card",
];

// Desglose de los puntos de UN futbolista: de donde salen (por tipo de evento,
// con los goles ya ponderados por puesto) y partido a partido. Misma logica de
// puntuacion que calculatePlayerStandings, filtrada a un jugador.
export function calculatePlayerBreakdown(
  player: Player,
  adminResults: AdminResults,
): PlayerBreakdown {
  const items = new Map<string, PlayerBreakdownItem>();
  const matches: PlayerBreakdownMatch[] = [];
  let total = 0;
  let goals = 0;
  let mvps = 0;

  Object.entries(adminResults || {}).forEach(([key, result]) => {
    const matchEvents: PlayerBreakdownMatchEvent[] = [];
    let matchPoints = 0;

    (result.events || []).forEach((event) => {
      if (event.playerId !== player.id) return;
      const rule = eventRules[String(event.type) as keyof typeof eventRules];
      if (!rule) return;

      const points =
        rule.ruleCode === "player_goal"
          ? goalPointsByPosition[player.position]
          : rule.points;

      total += points;
      matchPoints += points;
      if (rule.ruleCode === "player_goal" || rule.ruleCode === "player_penalty_goal") goals += 1;
      if (rule.ruleCode === "player_match_mvp") mvps += 1;

      matchEvents.push({ ruleCode: rule.ruleCode, minute: event.minute, points });

      const item = items.get(rule.ruleCode) || {
        ruleCode: rule.ruleCode,
        count: 0,
        pointsEach: points,
        points: 0,
      };
      item.count += 1;
      item.points += points;
      item.pointsEach = points;
      items.set(rule.ruleCode, item);
    });

    if (matchEvents.length) {
      const matchNumber = Number(key);
      const homeTeamId = result.homeTeamId || "";
      const opponentTeamId =
        homeTeamId === player.team ? result.awayTeamId || "" : homeTeamId;
      matches.push({
        matchNumber: Number.isFinite(matchNumber) ? matchNumber : 0,
        opponentTeamId,
        points: matchPoints,
        events: matchEvents,
      });
    }
  });

  const sortedItems = Array.from(items.values()).sort(
    (a, b) =>
      breakdownOrder.indexOf(a.ruleCode) - breakdownOrder.indexOf(b.ruleCode) ||
      b.points - a.points,
  );
  matches.sort((a, b) => a.matchNumber - b.matchNumber);

  return { total, goals, mvps, items: sortedItems, matches };
}
