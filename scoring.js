(function () {
  "use strict";

  const ruleMeta = {
    match_exact_score: { label: "Marcador exacto", category: "Marcadores" },
    player_goal: { label: "Gol de tu once", category: "Tu once" },
    player_penalty_goal: { label: "Penalti marcado", category: "Tu once" },
    player_match_mvp: { label: "MVP del partido", category: "Tu once" },
    player_penalty_save: { label: "Penalti parado", category: "Tu once" },
    player_penalty_miss: { label: "Penalti fallado", category: "Tu once" },
    player_red_card: { label: "Tarjeta roja", category: "Tu once" },
    team_progression_hit: { label: "Acierto de fase", category: "Grupos y cuadro" },
    tournament_champion_hit: { label: "Campeón del Mundial", category: "Extras finales" },
    tournament_mvp_hit: { label: "MVP del Mundial", category: "Extras finales" },
    tournament_top_scorer_hit: { label: "Máximo goleador", category: "Extras finales" },
  };

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
  };

  function normalizeSchedule(schedule) {
    return (schedule || []).map((match) =>
      Array.isArray(match)
        ? {
            number: match[0],
            date: match[1],
            time: match[2],
            home: match[3],
            away: match[4],
            venue: match[5],
            stage: match[6],
          }
        : match,
    );
  }

  function createEngine({ data, schedule }) {
    const matches = normalizeSchedule(schedule);
    const teams = new Map(data.teams.map((team) => [team.id, team]));
    const players = new Map(data.players.map((player) => [player.id, player]));

    function parseScore(value) {
      if (value === "" || value === null || value === undefined) return null;
      const score = Number(value);
      return Number.isFinite(score) && score >= 0 ? score : null;
    }

    function isScored(result) {
      return parseScore(result?.homeScore) !== null && parseScore(result?.awayScore) !== null;
    }

    function teamName(teamId) {
      return teams.get(teamId)?.name || "Equipo por confirmar";
    }

    function playerName(playerId) {
      return players.get(playerId)?.name || "Jugador";
    }

    function actualTeamId(match, result, side) {
      const override = result?.[`${side}TeamId`];
      const scheduled = match?.[side];
      if (teams.has(override)) return override;
      if (teams.has(scheduled)) return scheduled;
      return "";
    }

    function addEntry(entries, entry) {
      const meta = ruleMeta[entry.ruleCode] || { label: entry.ruleCode, category: "Otros" };
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

    function calculateGroupPositions(adminResults) {
      const byGroup = {};
      data.teams.forEach((team) => {
        byGroup[team.group] ||= { teams: new Map(), playedMatches: 0, expectedMatches: 0 };
        byGroup[team.group].teams.set(team.id, { teamId: team.id, pts: 0, gf: 0, ga: 0, gd: 0 });
      });

      matches
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
          const homeScore = parseScore(result.homeScore);
          const awayScore = parseScore(result.awayScore);
          const homeRow = byGroup[group].teams.get(home);
          const awayRow = byGroup[group].teams.get(away);
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
            .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || teamName(a.teamId).localeCompare(teamName(b.teamId)))
            .map((row, index) => ({ ...row, position: index + 1 }));
          return [group, { complete, positions }];
        }),
      );
    }

    function calculateFinalExtras(adminResults) {
      const completed = matches.every((match) => isScored(adminResults[String(match.number)]));
      if (!completed) return null;
      const teamStats = new Map(data.teams.map((team) => [team.id, { goals: 0, conceded: 0, reds: 0 }]));
      const playerGoals = new Map();
      const playerMvps = new Map();

      matches.forEach((match) => {
        const result = adminResults[String(match.number)];
        const home = actualTeamId(match, result, "home");
        const away = actualTeamId(match, result, "away");
        if (home) {
          teamStats.get(home).goals += parseScore(result.homeScore);
          teamStats.get(home).conceded += parseScore(result.awayScore);
        }
        if (away) {
          teamStats.get(away).goals += parseScore(result.awayScore);
          teamStats.get(away).conceded += parseScore(result.homeScore);
        }
        (result.events || []).forEach((event) => {
          const type = String(event.type || event.event_type || "");
          if ((type === "goal" || type === "gol" || type === "penalty_goal" || type === "penalti marcado") && event.playerId) {
            playerGoals.set(event.playerId, (playerGoals.get(event.playerId) || 0) + 1);
          }
          if ((type === "mvp" || type === "MVP") && event.playerId) playerMvps.set(event.playerId, (playerMvps.get(event.playerId) || 0) + 1);
          if ((type === "red_card" || type === "roja") && event.teamId) teamStats.get(event.teamId).reds += 1;
        });
      });

      const leaders = (map, selector) => {
        const rows = Array.from(map.entries()).map(([id, value]) => ({ id, value: selector(value) }));
        const best = Math.max(...rows.map((row) => row.value));
        return new Set(rows.filter((row) => row.value === best).map((row) => row.id));
      };

      return {
        highestScoringTeams: leaders(teamStats, (row) => row.goals),
        mostConcededTeams: leaders(teamStats, (row) => row.conceded),
        mostRedsTeams: leaders(teamStats, (row) => row.reds),
        topScorers: leaders(playerGoals.size ? playerGoals : new Map([["", 0]]), (value) => value),
        mvps: leaders(playerMvps.size ? playerMvps : new Map([["", 0]]), (value) => value),
      };
    }

    function calculateScorecard(prediction = {}, adminResults = {}, userId = "") {
      const entries = [];
      const matchPredictions = prediction.matchPredictions || {};

      matches.forEach((match) => {
        const result = adminResults[String(match.number)];
        const forecast = matchPredictions[String(match.number)] || {};
        if (!isScored(result)) return;
        const homeScore = parseScore(result.homeScore);
        const awayScore = parseScore(result.awayScore);
        if (parseScore(forecast.homeScore) === homeScore && parseScore(forecast.awayScore) === awayScore) {
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
          if (actualWinner && prediction.bracket?.winners?.[String(match.number)] === actualWinner) {
            addEntry(entries, {
              userId,
              matchId: `wc26-${match.number}`,
              matchNumber: match.number,
              ruleCode: "team_progression_hit",
              points: 1,
              explanation: `${teamName(actualWinner)} pasa en el partido ${match.number}`,
              sourceRef: `winner-${match.number}`,
            });
          }
          if (match.number === 104 && actualWinner && prediction.bracket?.winners?.["104"] === actualWinner) {
            addEntry(entries, {
              userId,
              matchId: `wc26-${match.number}`,
              matchNumber: match.number,
              ruleCode: "tournament_champion_hit",
              points: 5,
              explanation: `${teamName(actualWinner)} campeón del Mundial`,
              sourceRef: "champion",
            });
          }
        }
      });

      Object.entries(calculateGroupPositions(adminResults)).forEach(([group, table]) => {
        if (!table.complete) return;
        table.positions.forEach((row) => {
          if (String(prediction.groups?.[group]?.[row.teamId]) !== String(row.position)) return;
          addEntry(entries, {
            userId,
            ruleCode: "team_progression_hit",
            points: 1,
            explanation: `${teamName(row.teamId)} ${row.position}º en el grupo ${group}`,
            sourceRef: `group-${group}-${row.teamId}`,
          });
        });
      });

      const selectedPlayers = new Set(prediction.xi || []);
      Object.entries(adminResults).forEach(([matchNumber, result]) => {
        (result.events || []).forEach((event, index) => {
          const playerId = event.playerId || event.player_id;
          if (!selectedPlayers.has(playerId)) return;
          const rule = eventRules[String(event.type || event.event_type || "")];
          if (!rule) return;
          addEntry(entries, {
            userId,
            matchId: `wc26-${matchNumber}`,
            matchNumber: Number(matchNumber),
            ruleCode: rule.ruleCode,
            points: rule.points,
            explanation: `${playerName(playerId)} · ${ruleMeta[rule.ruleCode].label} en el partido ${matchNumber}`,
            sourceRef: event.id || event.supabaseId || `event-${matchNumber}-${index}`,
          });
        });
      });

      const extras = calculateFinalExtras(adminResults);
      if (extras) {
        const specialChecks = [
          ["topScorer", "topScorers", "tournament_top_scorer_hit", 5, "Máximo goleador del Mundial", playerName],
          ["mvp", "mvps", "tournament_mvp_hit", 5, "MVP del Mundial", playerName],
        ];
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

    function scorecardFromEntries(rawEntries = []) {
      const entries = rawEntries.map((entry) => {
        const meta = ruleMeta[entry.ruleCode || entry.rule_code] || { label: entry.ruleCode || entry.rule_code, category: "Otros" };
        return {
          userId: entry.userId || entry.user_id || "",
          matchId: entry.matchId || entry.match_id || null,
          matchNumber: entry.matchNumber || Number(String(entry.match_id || "").replace("wc26-", "")) || null,
          ruleCode: entry.ruleCode || entry.rule_code,
          label: entry.label || meta.label,
          category: entry.category || meta.category,
          points: Number(entry.points) || 0,
          explanation: entry.explanation || "",
          sourceRef: entry.sourceRef || entry.source_ref || "",
        };
      });
      const categories = {};
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

  window.PORRA_SCORING = { createEngine };
})();
