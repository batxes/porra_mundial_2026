import type { AdminResults, Match, Player, PorraData, Prediction, Scorecard, ScoreEntry } from "@/lib/types";

const ruleMeta = {
  match_outcome_hit: { label: "Eleccion acertada", category: "Marcadores" },
  match_exact_score: { label: "Marcador exacto", category: "Marcadores" },
  player_goal: { label: "Gol de tu once", category: "Tu once" },
  player_penalty_goal: { label: "Penalti marcado", category: "Tu once" },
  player_match_mvp: { label: "MVP del partido", category: "Tu once" },
  player_penalty_save: { label: "Penalti parado", category: "Tu once" },
  player_penalty_miss: { label: "Penalti fallado", category: "Tu once" },
  player_red_card: { label: "Tarjeta roja", category: "Tu once" },
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

const GROUP_SCORING_ENABLED = false;

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

  function knockoutProgressionPoints(match: Match) {
    if (match.stage === "Dieciseisavos") return 5;
    if (match.stage === "Octavos") return 10;
    if (match.stage === "Cuartos") return 15;
    if (match.stage === "Semifinales") return 20;
    if (match.stage === "Final") return 25;
    return 0;
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

  function calculateFinalExtras(adminResults: AdminResults) {
    const completed = schedule.every((match) => isScored(adminResults[String(match.number)]));
    if (!completed) return null;

    const teamStats = new Map(data.teams.map((team) => [team.id, { goals: 0, conceded: 0, reds: 0 }]));
    const playerGoals = new Map<string, number>();
    const playerMvps = new Map<string, number>();

    schedule.forEach((match) => {
      const result = adminResults[String(match.number)];
      const home = actualTeamId(match, result, "home");
      const away = actualTeamId(match, result, "away");

      if (home) {
        teamStats.get(home)!.goals += parseScore(result?.homeScore) ?? 0;
        teamStats.get(home)!.conceded += parseScore(result?.awayScore) ?? 0;
      }

      if (away) {
        teamStats.get(away)!.goals += parseScore(result?.awayScore) ?? 0;
        teamStats.get(away)!.conceded += parseScore(result?.homeScore) ?? 0;
      }

      (result?.events || []).forEach((event) => {
        const type = String(event.type || "");
        if ((type === "goal" || type === "gol" || type === "penalty_goal" || type === "penalti marcado") && event.playerId) {
          playerGoals.set(event.playerId, (playerGoals.get(event.playerId) || 0) + 1);
        }
        if ((type === "mvp" || type === "MVP") && event.playerId) {
          playerMvps.set(event.playerId, (playerMvps.get(event.playerId) || 0) + 1);
        }
        if ((type === "red_card" || type === "roja") && event.teamId) {
          teamStats.get(event.teamId)!.reds += 1;
        }
      });
    });

    const leaders = <T,>(map: Map<string, T>, selector: (value: T) => number) => {
      const rows = Array.from(map.entries()).map(([id, value]) => ({ id, value: selector(value) }));
      const best = Math.max(...rows.map((row) => row.value));
      return new Set(rows.filter((row) => row.value === best).map((row) => row.id));
    };

    return {
      highestScoringTeams: leaders(teamStats, (row) => row.goals),
      mostConcededTeams: leaders(teamStats, (row) => row.conceded - row.goals),
      mostRedsTeams: leaders(teamStats, (row) => row.reds),
      topScorers: leaders(playerGoals.size ? playerGoals : new Map([["", 0]]), (value) => value),
      mvps: leaders(playerMvps.size ? playerMvps : new Map([["", 0]]), (value) => value),
    };
  }

  function calculateScorecard(prediction: Prediction, adminResults: AdminResults, userId = ""): Scorecard {
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

      if (match.number >= 73 && homeScore !== awayScore) {
        const actualWinner = homeScore > awayScore ? actualTeamId(match, result, "home") : actualTeamId(match, result, "away");
        const progressionPoints = knockoutProgressionPoints(match);
        if (progressionPoints && actualWinner && prediction.bracket?.winners?.[String(match.number)] === actualWinner) {
          addEntry(entries, {
            userId,
            matchId: `wc26-${match.number}`,
            matchNumber: match.number,
            ruleCode: "team_progression_hit",
            points: progressionPoints,
            explanation: `${teamName(actualWinner)} pasa en el partido ${match.number}`,
            sourceRef: `winner-${match.number}`,
          });
        }
        const predictedChampion = prediction.extras?.worldChampion || prediction.bracket?.winners?.["104"];
        if (match.number === 104 && actualWinner && predictedChampion === actualWinner) {
          addEntry(entries, {
            userId,
            matchId: `wc26-${match.number}`,
            matchNumber: match.number,
            ruleCode: "tournament_champion_hit",
            points: 25,
            explanation: `${teamName(actualWinner)} campeón del Mundial`,
            sourceRef: "champion",
          });
        }
      }
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

    const extras = calculateFinalExtras(adminResults);
    if (extras) {
      const teamChecks = [
        ["highestScoringTeam", "highestScoringTeams", "tournament_highest_scoring_team_hit", 10, "Equipo más goleador"],
        ["mostConcededTeam", "mostConcededTeams", "tournament_most_conceded_team_hit", 10, "Equipo más goleado"],
        ["mostRedsTeam", "mostRedsTeams", "tournament_most_reds_team_hit", 10, "Equipo con más rojas"],
      ] as const;

      teamChecks.forEach(([predictionKey, leadersKey, ruleCode, points, label]) => {
        const id = prediction.extras?.[predictionKey];
        if (!id || !extras[leadersKey].has(id)) return;
        addEntry(entries, {
          userId,
          ruleCode,
          points,
          explanation: `${teamName(id)} - ${label}`,
          sourceRef: predictionKey,
        });
      });

      const specialChecks = [
        ["topScorer", "topScorers", "tournament_top_scorer_hit", 20, "Máximo goleador del Mundial", playerName],
        ["mvp", "mvps", "tournament_mvp_hit", 20, "MVP del Mundial", playerName],
      ] as const;

      specialChecks.forEach(([predictionKey, leadersKey, ruleCode, points, label, formatter]) => {
        const id = prediction.extras?.[predictionKey];
        if (!id || !extras[leadersKey].has(id)) return;
        addEntry(entries, {
          userId,
          ruleCode,
          points,
          explanation: `${formatter(id)} · ${label}`,
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

export type PlayerStandingRow = {
  player: Player;
  points: number;
  goals: number;
  mvps: number;
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
      const row = rows.get(player.id) || { player, points: 0, goals: 0, mvps: 0 };
      row.points += points;
      if (rule.ruleCode === "player_goal" || rule.ruleCode === "player_penalty_goal") row.goals += 1;
      if (rule.ruleCode === "player_match_mvp") row.mvps += 1;
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
