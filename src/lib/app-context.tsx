/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { createEngine } from "@/lib/scoring";
import { data, playersById, schedule, teamsById } from "@/lib/data";
import { formatDate } from "@/lib/format";
import {
  avatarPresets,
  clearPendingPrediction,
  currentLocalUser,
  defaultAdminEmail,
  digest,
  ensureDemoUsers,
  ensureLocalAdminUser,
  getLocalAdminResults,
  getLocalPredictions,
  getLocalUsers,
  getPendingPrediction,
  LocalUser,
  localKeys,
  saveLocalPrediction,
  setCurrentLocalEmail,
  setLocalAdminResults,
  setLocalJson,
  setLocalUsers,
  setPendingPrediction,
} from "@/lib/local-mode";
import {
  calculateCompletion,
  chooseMatchWinner,
  emptyPrediction,
  hasMatchStarted,
  hasTournamentStarted,
  moveGroupTeam,
  normalizePrediction,
  scheduleUtc,
  setGroupOrder,
  setPredictionExtra,
  setPredictionMatchScore,
  setPredictionTrainerTactic,
  setXiFormation,
  setXiSelection,
  toggleThirdQualifier,
  toggleXi,
} from "@/lib/prediction";
import {
  teamHasStartedUnvalidatedKnownMatch,
} from "@/lib/playoff-teams";
import { getSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabase";
import type { AdminResults, AuthMode, Prediction, Scorecard, UserProfile } from "@/lib/types";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  points: number;
  isAdmin: boolean;
  isPro: boolean;
  isWolf: boolean;
  lateEdit: boolean;
};

// Copia del ultimo usuario con sesion para pintar la cabecera al instante
// mientras refreshData carga los datos reales.
const sessionUserCacheKey = "porra26_session_user";

function readCachedSessionUser(): SessionUser | null {
  try {
    const raw = window.localStorage.getItem(sessionUserCacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionUser> | null;
    if (!parsed || typeof parsed.id !== "string" || !parsed.id) return null;
    return {
      id: parsed.id,
      name: typeof parsed.name === "string" ? parsed.name : "",
      email: typeof parsed.email === "string" ? parsed.email : "",
      avatarUrl: typeof parsed.avatarUrl === "string" ? parsed.avatarUrl : "",
      points: 0,
      isAdmin: Boolean(parsed.isAdmin),
      isPro: Boolean(parsed.isPro),
      isWolf: Boolean(parsed.isWolf),
      lateEdit: Boolean(parsed.lateEdit),
    };
  } catch {
    return null;
  }
}

function writeCachedSessionUser(user: SessionUser | null) {
  try {
    if (user) {
      window.localStorage.setItem(sessionUserCacheKey, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(sessionUserCacheKey);
    }
  } catch {
    // Ignore storage failures.
  }
}

type AppContextValue = {
  ready: boolean;
  usingSupabase: boolean;
  authMode: AuthMode;
  authBusy: boolean;
  authError: string;
  user: SessionUser | null;
  prediction: Prediction;
  adminResults: AdminResults;
  leaderboard: UserProfile[];
  completion: number;
  currentScorecard: Scorecard;
  avatarPresets: typeof avatarPresets;
  setAuthMode: (mode: AuthMode) => void;
  clearAuthError: () => void;
  signIn: (email: string, password: string) => Promise<boolean>;
  register: (name: string, email: string, password: string, predictionToSave?: Prediction) => Promise<boolean>;
  signOut: () => Promise<void>;
  updateProfile: (values: { name: string; avatarUrl: string }) => Promise<void>;
  savePrediction: (makeDefinitive?: boolean) => Promise<{ ok: boolean; message: string }>;
  moveGroupTeam: (group: string, teamId: string, direction: number) => void;
  replaceGroupOrder: (group: string, teamIds: string[]) => void;
  toggleThirdQualifier: (group: string) => void;
  chooseMatchWinner: (matchNumber: number, teamId: string) => void;
  setPredictionScore: (matchNumber: number, side: "homeScore" | "awayScore", value: string) => void;
  setPredictionTrainerTactic: (matchNumber: number, trainerTeamId: string, tacticId: string) => void;
  setPredictionExtra: (key: keyof Prediction["extras"], value: string) => void;
  toggleXiPlayer: (playerId: string) => void;
  setXiFormation: (formation: string) => void;
  setXiSelection: (playerIds: string[]) => void;
  applyCardSwap: (swap: {
    cardId?: string | null;
    inPlayerId: string;
    outPlayerId: string;
    pointsIn: number;
    pointsOut: number;
    sourcePackId?: string;
  }) => Promise<{ ok: boolean; message: string }>;
  setUserPro: (userId: string, isPro: boolean) => Promise<void>;
  setUserWolf: (userId: string, isWolf: boolean) => Promise<void>;
  setUserLateEdit: (userId: string, lateEdit: boolean) => Promise<void>;
  setUserHidden: (userId: string, isHidden: boolean) => Promise<void>;
  saveAdminResult: (matchNumber: string, payload: AdminResults[string]) => Promise<void>;
  addAdminEvent: (matchNumber: string, event: AdminResults[string]["events"][number]) => Promise<void>;
  deleteAdminEvent: (matchNumber: string, eventId: string) => Promise<void>;
  clearAdminResults: () => Promise<void>;
  refreshData: () => Promise<void>;
  teamName: (teamId: string) => string;
  playerName: (playerId: string) => string;
  scheduleLabel: (matchNumber: number) => string;
};

// La función SQL `recalculate_scores` solo puntúa tipos de evento en inglés;
// el panel de admin trabaja en español, así que se traduce al escribir en Supabase.
const dbEventTypes: Record<string, string> = {
  gol: "goal",
  "gol en propia": "own_goal",
  "penalti marcado": "penalty_goal",
  MVP: "mvp",
  "penalti parado": "penalty_save",
  "penalti fallado": "penalty_miss",
  roja: "red_card",
};

export function toDbEventType(type: string) {
  return dbEventTypes[type] || type;
}

type MatchTacticResultRow = {
  match_id: string;
  team_id: string;
  tactic_id: string;
};

async function fetchMatchTacticResults(supabase: any): Promise<MatchTacticResultRow[]> {
  const { data, error } = await supabase
    .from("match_tactic_results")
    .select("match_id, team_id, tactic_id");
  if (error) {
    console.warn("match_tactic_results:", error.message);
    return [];
  }
  return (data || []) as MatchTacticResultRow[];
}

function applyMatchTacticResults(
  results: AdminResults,
  rows: MatchTacticResultRow[],
) {
  rows.forEach((row) => {
    const number = String(row.match_id || "").replace("wc26-", "");
    if (!number || !row.team_id || !row.tactic_id) return;
    results[number] ||= { homeScore: "", awayScore: "", events: [] };
    results[number].trainerTactics ||= {};
    const teamIds = results[number].trainerTactics[row.tactic_id] || [];
    if (!teamIds.includes(row.team_id)) {
      results[number].trainerTactics[row.tactic_id] = [...teamIds, row.team_id];
    }
  });
}

const AppContext = createContext<AppContextValue | null>(null);

const scoring = createEngine({ data, schedule });

function scorecardForUser(userId: string, prediction: Prediction, adminResults: AdminResults) {
  return scoring.calculateScorecard(normalizePrediction(prediction), adminResults, userId);
}

function buildLeaderboard(localUsers: LocalUser[], currentUserId: string | null, prediction: Prediction, adminResults: AdminResults) {
  const predictions = getLocalPredictions();

  return localUsers
    .filter((user) => user.email !== defaultAdminEmail || user.id === currentUserId)
    .map((user) => {
      const userPrediction = normalizePrediction(user.id === currentUserId ? prediction : predictions[user.id]);
      const scorecard = scorecardForUser(user.id, userPrediction, adminResults);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl || "",
        points: scorecard.total,
        isAdmin: Boolean(user.isAdmin),
        isPro: Boolean(user.isPro),
        isWolf: Boolean(user.isWolf),
        lateEdit: Boolean(user.lateEdit),
        isHidden: Boolean(user.isHidden),
        complete: calculateCompletion(userPrediction),
        champion: userPrediction.extras.worldChampion || userPrediction.bracket.winners["104"] || "",
        prediction: userPrediction,
        scorecard,
      };
    })
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function teamHasStartedUnvalidatedMatch(teamId: string, adminResults: AdminResults) {
  return teamHasStartedUnvalidatedKnownMatch(teamId, adminResults);
}

function preparePredictionForSave(nextPrediction: Prediction, makeDefinitive = false) {
  const normalized = normalizePrediction(nextPrediction);

  return {
    ...normalized,
    isDefinitive: makeDefinitive ? true : normalized.isDefinitive,
    updatedAt: new Date().toISOString(),
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [prediction, setPrediction] = useState<Prediction>(emptyPrediction());
  const [adminResults, setAdminResults] = useState<AdminResults>({});
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);

  const usingSupabase = hasSupabaseConfig();

  const syncLocalState = useCallback(
    async (nextUserId?: string | null, nextPrediction?: Prediction) => {
      const sessionUser = currentLocalUser();
      const currentPrediction = normalizePrediction(
        nextPrediction || (sessionUser ? getLocalPredictions()[sessionUser.id] : getPendingPrediction()),
      );
      const currentResults = getLocalAdminResults();

      setUser(
        sessionUser
          ? {
              id: sessionUser.id,
              name: sessionUser.name,
              email: sessionUser.email,
              avatarUrl: sessionUser.avatarUrl || "",
              points: scorecardForUser(sessionUser.id, currentPrediction, currentResults).total,
              isAdmin: Boolean(sessionUser.isAdmin),
              isPro: Boolean(sessionUser.isPro),
              isWolf: Boolean(sessionUser.isWolf),
              lateEdit: Boolean(sessionUser.lateEdit),
            }
          : null,
      );
      setPrediction(currentPrediction);
      setAdminResults(currentResults);
      setLeaderboard(buildLeaderboard(getLocalUsers(), nextUserId ?? sessionUser?.id ?? null, currentPrediction, currentResults));
    },
    [],
  );

  const saveSupabasePredictionForUser = useCallback(
    async (finalPrediction: Prediction) => {
      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) {
        return { ok: false, message: "No se ha podido conectar con Supabase." };
      }

      const { error } = await supabase.rpc("save_prediction", {
        p_selections: finalPrediction,
        p_completion: calculateCompletion(finalPrediction),
        p_is_definitive: finalPrediction.isDefinitive,
      });

      if (error) {
        return { ok: false, message: error.message };
      }

      return { ok: true, message: "Progreso guardado." };
    },
    [],
  );

  const refreshData = useCallback(async () => {
    try {
      if (!usingSupabase) {
        await ensureLocalAdminUser();
        await ensureDemoUsers();
        await syncLocalState();
        return;
      }

      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) {
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      // La sesion se resuelve mucho antes que los datos: adelanta un usuario
      // provisional para que la cabecera no muestre "Entrar" mientras carga.
      if (session?.user) {
        const metadataName = (session.user.user_metadata as Record<string, unknown> | null)?.display_name;
        setUser((current) =>
          current ?? {
            id: session.user.id,
            name: typeof metadataName === "string" && metadataName ? metadataName : session.user.email?.split("@")[0] || "Jugador",
            email: session.user.email || "",
            avatarUrl: "",
            points: 0,
            isAdmin: false,
            isPro: false,
            isWolf: false,
            lateEdit: false,
          },
        );
      } else {
        writeCachedSessionUser(null);
        setUser(null);
      }

      const tournamentResponse = await supabase.from("tournaments").select("id, slug").eq("slug", "world-cup-2026").maybeSingle();
      const tournamentId = tournamentResponse.data?.id;

      const [{ data: profiles }, { data: predictions }, { data: matches }, { data: events }, tacticRows] = await Promise.all([
        supabase.from("profiles").select("id, display_name, avatar_url, total_points, is_admin, is_pro, is_wolf, is_hidden, late_edit"),
        tournamentId
          ? supabase.from("predictions").select("user_id, selections, completion_percent, is_definitive").eq("tournament_id", tournamentId)
          : Promise.resolve({ data: [] as any[], error: null }),
        supabase.from("matches").select("id, home_team_id, away_team_id, home_score, away_score, status, stage").eq("status", "validated"),
        supabase.from("match_events").select("id, match_id, player_id, team_id, event_type, minute, details"),
        fetchMatchTacticResults(supabase),
      ]);

      const results: AdminResults = {};
      ((matches || []) as any[]).forEach((match: any) => {
        const number = String(match.id || "").replace("wc26-", "");
        if (!number) return;
        results[number] = {
          homeScore: match.home_score,
          awayScore: match.away_score,
          homeTeamId: match.home_team_id || "",
          awayTeamId: match.away_team_id || "",
          status: match.status,
          events: [],
        };
      });
      ((events || []) as any[]).forEach((event: any) => {
        const number = String(event.match_id || "").replace("wc26-", "");
        if (!number) return;
        results[number] ||= { homeScore: "", awayScore: "", events: [] };
        results[number].events.push({
          id: event.id,
          playerId: event.player_id,
          teamId: event.team_id,
          type: event.event_type,
          minute: event.minute,
          source: event.details?.phase,
          details: event.details || undefined,
        });
      });
      applyMatchTacticResults(results, tacticRows);

      const predictionByUser = new Map<string, Prediction>(
        ((predictions || []) as any[]).map((item: any) => [item.user_id, normalizePrediction(item.selections as Prediction)]),
      );

      const sessionUserId = session?.user?.id || "";
      const pendingPrediction = getPendingPrediction();
      if (sessionUserId && pendingPrediction) {
        if (!predictionByUser.has(sessionUserId)) {
          const pushed = await saveSupabasePredictionForUser(preparePredictionForSave(pendingPrediction));
          if (pushed.ok) {
            predictionByUser.set(sessionUserId, normalizePrediction(pendingPrediction));
            clearPendingPrediction();
          }
        } else {
          clearPendingPrediction();
        }
      }

      const currentProfile = ((profiles || []) as any[]).find((profile: any) => profile.id === sessionUserId) || null;
      const currentPrediction = normalizePrediction(
        sessionUserId ? predictionByUser.get(sessionUserId) || null : pendingPrediction,
      );
      const currentScorecard = sessionUserId
        ? scorecardForUser(sessionUserId, currentPrediction, results)
        : scoring.scorecardFromEntries([]);
      // El total visible sale del scorecard calculado en cliente para que
      // cuadre siempre con el desglose, aunque profiles.total_points tarde en
      // ponerse al dia tras cambios de reglas o migraciones.
      const currentPoints = currentScorecard.total;

      setUser(
        currentProfile
          ? {
              id: currentProfile.id,
              name: currentProfile.display_name,
              email: session?.user?.email || "",
              avatarUrl: currentProfile.avatar_url || "",
              points: currentPoints,
              isAdmin: Boolean(currentProfile.is_admin),
              isPro: Boolean(currentProfile.is_pro),
              isWolf: Boolean(currentProfile.is_wolf),
              lateEdit: Boolean(currentProfile.late_edit),
            }
          : null,
      );
      setPrediction(currentPrediction);
      setAdminResults(results);
      setLeaderboard(
        ((profiles || []) as any[])
          .map((profile: any) => {
            const profilePrediction = predictionByUser.get(profile.id) || null;
            const calculatedScorecard = profilePrediction
              ? scorecardForUser(profile.id, profilePrediction, results)
              : scoring.scorecardFromEntries([]);
            const points = calculatedScorecard.total;
            const scorecard = calculatedScorecard;
            return {
              id: profile.id,
              name: profile.display_name,
              email: "",
              avatarUrl: profile.avatar_url || "",
              points,
              isAdmin: Boolean(profile.is_admin),
              isPro: Boolean(profile.is_pro),
              isWolf: Boolean(profile.is_wolf),
              lateEdit: Boolean(profile.late_edit),
              isHidden: Boolean(profile.is_hidden),
              complete: profilePrediction ? calculateCompletion(profilePrediction) : 0,
              champion: profilePrediction ? profilePrediction.extras.worldChampion || profilePrediction.bracket.winners["104"] || "" : "",
              prediction: profilePrediction,
              scorecard,
            };
          })
          .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)),
      );
    } catch (error) {
      console.error("refreshData:", error);
    } finally {
      setReady(true);
    }
  }, [saveSupabasePredictionForUser, syncLocalState, usingSupabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const cached = readCachedSessionUser();
      if (cached) {
        setUser((current) => current ?? cached);
      }
      void refreshData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshData]);

  useEffect(() => {
    if (!ready) return;
    writeCachedSessionUser(user);
  }, [ready, user]);

  // Refresco "en vivo" para detectar resultados nuevos con la web abierta:
  // solo actualiza resultados y clasificacion. No toca la sesion ni la porra
  // en edicion (refreshData pisaria cambios sin guardar del usuario).
  const refreshLiveData = useCallback(async () => {
    try {
      if (!usingSupabase) {
        const currentResults = getLocalAdminResults();
        const nextLeaderboard = buildLeaderboard(getLocalUsers(), user?.id || null, prediction, currentResults);
        setAdminResults(currentResults);
        setLeaderboard(nextLeaderboard);
        setUser((current) => {
          if (!current) return current;
          const profile = nextLeaderboard.find((candidate) => candidate.id === current.id);
          return profile ? { ...current, points: profile.points } : current;
        });
        return;
      }

      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) return;

      const [{ data: profiles }, { data: matches }, { data: events }, tacticRows] = await Promise.all([
        supabase.from("profiles").select("id, display_name, avatar_url, total_points, is_admin, is_pro, is_wolf, is_hidden, late_edit"),
        supabase.from("matches").select("id, home_team_id, away_team_id, home_score, away_score, status, stage").eq("status", "validated"),
        supabase.from("match_events").select("id, match_id, player_id, team_id, event_type, minute, details"),
        fetchMatchTacticResults(supabase),
      ]);

      const results: AdminResults = {};
      ((matches || []) as any[]).forEach((match: any) => {
        const number = String(match.id || "").replace("wc26-", "");
        if (!number) return;
        results[number] = {
          homeScore: match.home_score,
          awayScore: match.away_score,
          homeTeamId: match.home_team_id || "",
          awayTeamId: match.away_team_id || "",
          status: match.status,
          events: [],
        };
      });
      ((events || []) as any[]).forEach((event: any) => {
        const number = String(event.match_id || "").replace("wc26-", "");
        if (!number) return;
        results[number] ||= { homeScore: "", awayScore: "", events: [] };
        results[number].events.push({
          id: event.id,
          playerId: event.player_id,
          teamId: event.team_id,
          type: event.event_type,
          minute: event.minute,
          source: event.details?.phase,
          details: event.details || undefined,
        });
      });
      applyMatchTacticResults(results, tacticRows);

      // Reutiliza las porras ya cargadas: en este refresco solo cambian los
      // resultados y el total persistido en profiles.total_points.
      const predictionByUser = new Map<string, Prediction | null>(
        leaderboard.map((profile) => [profile.id, profile.prediction]),
      );

      const nextLeaderboard = ((profiles || []) as any[])
        .map((profile: any) => {
          const profilePrediction = predictionByUser.get(profile.id) || null;
          const calculatedScorecard = profilePrediction
            ? scorecardForUser(profile.id, profilePrediction, results)
            : scoring.scorecardFromEntries([]);
          const points = calculatedScorecard.total;
          const scorecard = calculatedScorecard;
          return {
            id: profile.id,
            name: profile.display_name,
            email: "",
            avatarUrl: profile.avatar_url || "",
            points,
            isAdmin: Boolean(profile.is_admin),
            isPro: Boolean(profile.is_pro),
            isWolf: Boolean(profile.is_wolf),
            lateEdit: Boolean(profile.late_edit),
            isHidden: Boolean(profile.is_hidden),
            complete: profilePrediction ? calculateCompletion(profilePrediction) : 0,
            champion: profilePrediction ? profilePrediction.extras.worldChampion || profilePrediction.bracket.winners["104"] || "" : "",
            prediction: profilePrediction,
            scorecard,
          };
        })
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

      setAdminResults(results);
      setLeaderboard(nextLeaderboard);
      setUser((current) => {
        if (!current) return current;
        const profile = nextLeaderboard.find((candidate) => candidate.id === current.id);
        return profile ? { ...current, points: profile.points } : current;
      });
    } catch (error) {
      console.warn("refreshLiveData:", error);
    }
  }, [leaderboard, prediction, user, usingSupabase]);

  const refreshLiveDataRef = useRef(refreshLiveData);
  useEffect(() => {
    refreshLiveDataRef.current = refreshLiveData;
  }, [refreshLiveData]);

  // Sin sondeo periodico: guardar resultados/eventos ya llama a refreshData().
  // Al volver a la pestana, trae los resultados que hayan cambiado fuera.
  useEffect(() => {
    if (!ready) return;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshLiveDataRef.current();
      }
    };
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [ready]);

  const persistPrediction = useCallback(
    async (nextPrediction: Prediction, makeDefinitive = false) => {
      if (!user) {
        return { ok: false, message: "Necesitas entrar para guardar la porra." };
      }

      const finalPrediction = preparePredictionForSave(nextPrediction, makeDefinitive);

      if (!usingSupabase) {
        saveLocalPrediction(user.id, finalPrediction);
        // El autoguardado solo persiste: refrescar aquí haría setPrediction con
        // la version recien guardada y pisaria ediciones hechas mientras se
        // guardaba. Solo el guardado definitivo recarga el estado completo.
        if (makeDefinitive) {
          await syncLocalState(user.id, finalPrediction);
        }
        return { ok: true, message: "Progreso guardado." };
      }

      const result = await saveSupabasePredictionForUser(finalPrediction);
      if (!result.ok) return result;

      if (makeDefinitive) {
        await refreshData();
      }
      return result;
    },
    [refreshData, saveSupabasePredictionForUser, syncLocalState, user, usingSupabase],
  );

  const savePrediction = useCallback(
    async (makeDefinitive = false) => {
      return persistPrediction(prediction, makeDefinitive);
    },
    [persistPrediction, prediction],
  );

  const applyCardSwap = useCallback(
    async (swap: {
      cardId?: string | null;
      inPlayerId: string;
      outPlayerId: string;
      pointsIn: number;
      pointsOut: number;
      sourcePackId?: string;
    }) => {
      if (!user) {
        return { ok: false, message: "Necesitas entrar para usar cartas." };
      }

      const currentXi = Array.isArray(prediction.xi) ? prediction.xi : [];
      if (!currentXi.includes(swap.outPlayerId)) {
        return { ok: false, message: "Ese jugador ya no esta en tu once." };
      }
      if (currentXi.includes(swap.inPlayerId)) {
        return { ok: false, message: "Ese jugador ya esta en tu once." };
      }

      const inPlayer = playersById.get(swap.inPlayerId);
      const outPlayer = playersById.get(swap.outPlayerId);
      if (!inPlayer || !outPlayer || inPlayer.position !== outPlayer.position) {
        return { ok: false, message: "La carta no coincide con el puesto." };
      }

      if (
        teamHasStartedUnvalidatedMatch(inPlayer.team, adminResults) ||
        teamHasStartedUnvalidatedMatch(outPlayer.team, adminResults)
      ) {
        return {
          ok: false,
          message:
            "No puedes cambiar a un jugador mientras su equipo esta en juego. Disponible cuando se valide el partido.",
        };
      }

      const canEnter = swap.pointsIn <= swap.pointsOut;
      if (!canEnter) {
        return {
          ok: false,
          message: "El jugador de la carta no puede tener mas puntos que el que sale.",
        };
      }

      if (!usingSupabase) {
        const nextPrediction = preparePredictionForSave({
          ...prediction,
          xi: currentXi.map((playerId) =>
            playerId === swap.outPlayerId ? swap.inPlayerId : playerId,
          ),
        });

        saveLocalPrediction(user.id, nextPrediction);
        await syncLocalState(user.id, nextPrediction);
        return { ok: true, message: "Swap guardado." };
      }

      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) {
        return { ok: false, message: "No se ha podido conectar con Supabase." };
      }

      const { error } = await supabase.rpc("apply_card_swap", {
        p_card_id: swap.cardId || null,
        p_out_player_id: swap.outPlayerId,
      });
      if (error) {
        return { ok: false, message: error.message };
      }

      await refreshData();
      return { ok: true, message: "Swap guardado y puntos recalculados." };
    },
    [adminResults, prediction, refreshData, syncLocalState, user, usingSupabase],
  );

  const replacePrediction = useCallback(
    (next: Prediction) => {
      setPrediction(next);
      if (!user) {
        setPendingPrediction(next);
      }
    },
    [user],
  );

  const setUserPro = useCallback(
    async (userId: string, isPro: boolean) => {
      if (!user?.isAdmin) return;

      if (!usingSupabase) {
        const users = getLocalUsers();
        const target = users.find((candidate) => candidate.id === userId);
        if (!target) return;
        target.isPro = isPro;
        setLocalUsers(users);
        await syncLocalState(user.id);
        return;
      }

      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) return;
      await supabase.rpc("admin_set_user_pro", { target_user_id: userId, next_is_pro: isPro });
      await refreshData();
    },
    [refreshData, syncLocalState, user, usingSupabase],
  );

  const setUserWolf = useCallback(
    async (userId: string, isWolf: boolean) => {
      if (!user?.isAdmin) return;

      if (!usingSupabase) {
        const users = getLocalUsers();
        const target = users.find((candidate) => candidate.id === userId);
        if (!target) return;
        target.isWolf = isWolf;
        setLocalUsers(users);
        await syncLocalState(user.id);
        return;
      }

      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) return;
      await supabase.rpc("admin_set_user_wolf", { target_user_id: userId, next_is_wolf: isWolf });
      await refreshData();
    },
    [refreshData, syncLocalState, user, usingSupabase],
  );

  const setUserLateEdit = useCallback(
    async (userId: string, lateEdit: boolean) => {
      if (!user?.isAdmin) return;

      if (!usingSupabase) {
        const users = getLocalUsers();
        const target = users.find((candidate) => candidate.id === userId);
        if (!target) return;
        target.lateEdit = lateEdit;
        setLocalUsers(users);
        await syncLocalState(user.id);
        return;
      }

      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) return;
      await supabase.rpc("admin_set_user_late_edit", { target_user_id: userId, next_late_edit: lateEdit });
      await refreshData();
    },
    [refreshData, syncLocalState, user, usingSupabase],
  );

  const setUserHidden = useCallback(
    async (userId: string, isHidden: boolean) => {
      if (!user?.isAdmin) return;

      if (!usingSupabase) {
        const users = getLocalUsers();
        const target = users.find((candidate) => candidate.id === userId);
        if (!target) return;
        target.isHidden = isHidden;
        setLocalUsers(users);
        await syncLocalState(user.id);
        return;
      }

      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) return;
      await supabase.rpc("admin_set_user_hidden", { target_user_id: userId, next_is_hidden: isHidden });
      await refreshData();
    },
    [refreshData, syncLocalState, user, usingSupabase],
  );

  const saveAdminResult = useCallback(
    async (matchNumber: string, payload: AdminResults[string]) => {
      const next = structuredClone(adminResults);
      next[matchNumber] = {
        ...payload,
        events: payload.events || next[matchNumber]?.events || [],
        syncedAt: new Date().toISOString(),
      };

      if (!usingSupabase) {
        setLocalAdminResults(next);
        setAdminResults(next);
        setLeaderboard(buildLeaderboard(getLocalUsers(), user?.id || null, prediction, next));
        return;
      }

      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) return;

      const { data: tournament } = await supabase.from("tournaments").select("id").eq("slug", "world-cup-2026").single();
      const match = schedule.find((candidate) => String(candidate.number) === String(matchNumber));

      const { error: matchError } = await supabase.from("matches").upsert({
        id: `wc26-${matchNumber}`,
        tournament_id: tournament?.id,
        stage: match?.stage || "Grupos",
        scheduled_at: match ? scheduleUtc(match) : new Date().toISOString(),
        home_team_id: payload.homeTeamId || (match && teamsById.has(match.home) ? match.home : null),
        away_team_id: payload.awayTeamId || (match && teamsById.has(match.away) ? match.away : null),
        home_score: Number(payload.homeScore),
        away_score: Number(payload.awayScore),
        status: "validated",
        validated_at: new Date().toISOString(),
      });
      if (matchError) {
        throw new Error(`No se pudo guardar el partido: ${matchError.message}`);
      }

      const matchId = `wc26-${matchNumber}`;
      const { error: tacticDeleteError } = await supabase
        .from("match_tactic_results")
        .delete()
        .eq("match_id", matchId);
      if (tacticDeleteError) {
        throw new Error(`No se pudieron borrar los chips: ${tacticDeleteError.message}`);
      }

      const tacticRows = Object.entries(payload.trainerTactics || {}).flatMap(
        ([tacticId, teamIds]) =>
          (teamIds || [])
            .filter(Boolean)
            .map((teamId) => ({
              match_id: matchId,
              team_id: teamId,
              tactic_id: tacticId,
            })),
      );
      if (tacticRows.length) {
        const { error: tacticInsertError } = await supabase
          .from("match_tactic_results")
          .insert(tacticRows);
        if (tacticInsertError) {
          throw new Error(`No se pudieron guardar los chips: ${tacticInsertError.message}`);
        }
      }

      await refreshData();
    },
    [adminResults, prediction, refreshData, user?.id, usingSupabase],
  );

  const addAdminEvent = useCallback(
    async (matchNumber: string, event: AdminResults[string]["events"][number]) => {
      const next = structuredClone(adminResults);
      next[matchNumber] ||= { homeScore: "", awayScore: "", events: [] };
      next[matchNumber].events ||= [];
      next[matchNumber].events.push(event);

      if (!usingSupabase) {
        setLocalAdminResults(next);
        setAdminResults(next);
        setLeaderboard(buildLeaderboard(getLocalUsers(), user?.id || null, prediction, next));
        return;
      }

      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) return;

      const { error: eventError } = await supabase.from("match_events").insert({
        match_id: `wc26-${matchNumber}`,
        player_id: event.playerId,
        team_id: event.teamId || playersById.get(event.playerId)?.team || null,
        event_type: toDbEventType(event.type),
        minute: Number(event.minute) || 0,
        details: event.details || {},
      });
      if (eventError) {
        throw new Error(`No se pudo guardar el evento: ${eventError.message}`);
      }

      await refreshData();
    },
    [adminResults, prediction, refreshData, user?.id, usingSupabase],
  );

  const deleteAdminEvent = useCallback(
    async (matchNumber: string, eventId: string) => {
      const next = structuredClone(adminResults);
      next[matchNumber] ||= { homeScore: "", awayScore: "", events: [] };
      next[matchNumber].events = (next[matchNumber].events || []).filter((event) => event.id !== eventId);

      if (!usingSupabase) {
        setLocalAdminResults(next);
        setAdminResults(next);
        setLeaderboard(buildLeaderboard(getLocalUsers(), user?.id || null, prediction, next));
        return;
      }

      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) return;
      const { error: deleteError } = await supabase.from("match_events").delete().eq("id", eventId);
      if (deleteError) {
        throw new Error(`No se pudo eliminar el evento: ${deleteError.message}`);
      }
      await refreshData();
    },
    [adminResults, prediction, refreshData, user?.id, usingSupabase],
  );

  const clearAdminResults = useCallback(async () => {
    if (!usingSupabase) {
      setLocalJson(localKeys.adminMatches, {});
      setAdminResults({});
      setLeaderboard(buildLeaderboard(getLocalUsers(), user?.id || null, prediction, {}));
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.from("match_tactic_results").delete().neq("match_id", "");
    await supabase.from("match_events").delete().neq("id", "");
    await supabase.from("matches").delete().like("id", "wc26-%");
    await refreshData();
  }, [prediction, refreshData, user?.id, usingSupabase]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setAuthBusy(true);
      setAuthError("");
      try {
        if (!usingSupabase) {
          await ensureLocalAdminUser();
          const users = getLocalUsers();
          const user = users.find((candidate) => candidate.email === email.trim().toLowerCase());
          if (!user) {
            setAuthError("No existe un usuario con ese email.");
            return false;
          }
          const hash = await digest(password);
          if (hash !== user.passwordHash) {
            setAuthError("La contraseña no es correcta.");
            return false;
          }
          setCurrentLocalEmail(user.email);
          const pendingPrediction = getPendingPrediction();
          if (pendingPrediction) {
            if (!getLocalPredictions()[user.id]) {
              saveLocalPrediction(user.id, preparePredictionForSave(pendingPrediction));
            }
            clearPendingPrediction();
          }
          await syncLocalState(user.id);
          return true;
        }

        const supabase = getSupabaseBrowserClient() as any;
        if (!supabase) return false;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setAuthError(error.message);
          return false;
        }
        await refreshData();
        return true;
      } finally {
        setAuthBusy(false);
      }
    },
    [refreshData, syncLocalState, usingSupabase],
  );

  const register = useCallback(
    async (name: string, email: string, password: string, predictionToSave?: Prediction) => {
      setAuthBusy(true);
      setAuthError("");
      try {
        const draftPrediction = predictionToSave || getPendingPrediction();
        const finalPrediction = draftPrediction ? preparePredictionForSave(draftPrediction) : null;

        if (!usingSupabase) {
          await ensureLocalAdminUser();
          const normalizedEmail = email.trim().toLowerCase();
          const users = getLocalUsers();
          if (users.some((candidate) => candidate.email === normalizedEmail)) {
            setAuthError("Ese email ya está registrado.");
            return false;
          }
          const nextUser: LocalUser = {
            id: crypto.randomUUID(),
            name: name.trim(),
            email: normalizedEmail,
            passwordHash: await digest(password),
            points: 0,
            isAdmin: false,
            avatarUrl: "preset:green",
          };
          users.push(nextUser);
          setLocalUsers(users);
          if (finalPrediction) {
            saveLocalPrediction(nextUser.id, finalPrediction);
            clearPendingPrediction();
          }
          setCurrentLocalEmail(normalizedEmail);
          await syncLocalState(nextUser.id, finalPrediction || undefined);
          return true;
        }

        const supabase = getSupabaseBrowserClient() as any;
        if (!supabase) return false;
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: name,
            },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) {
          setAuthError(error.message);
          return false;
        }

        // Con confirmacion de email activa, signUp no devuelve sesion: la porra
        // queda pendiente en localStorage y refreshData la sube en cuanto haya sesion.
        if (finalPrediction) {
          setPendingPrediction(finalPrediction);
        }

        await refreshData();
        return true;
      } finally {
        setAuthBusy(false);
      }
    },
    [refreshData, syncLocalState, usingSupabase],
  );

  const signOut = useCallback(async () => {
    if (!usingSupabase) {
      setCurrentLocalEmail("");
      setUser(null);
      setPrediction(emptyPrediction());
      setLeaderboard(buildLeaderboard(getLocalUsers(), null, emptyPrediction(), getLocalAdminResults()));
      return;
    }
    const supabase = getSupabaseBrowserClient() as any;
    if (!supabase) return;
    await supabase.auth.signOut();
    await refreshData();
  }, [refreshData, usingSupabase]);

  const updateProfile = useCallback(
    async (values: { name: string; avatarUrl: string }) => {
      if (!user) return;

      if (!usingSupabase) {
        const users = getLocalUsers();
        const localUser = users.find((candidate) => candidate.id === user.id);
        if (!localUser) return;
        localUser.name = values.name;
        localUser.avatarUrl = values.avatarUrl;
        setLocalUsers(users);
        await syncLocalState(user.id);
        return;
      }

      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) return;
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: values.name, avatar_url: values.avatarUrl })
        .eq("id", user.id);
      if (error) throw error;
      await refreshData();
    },
    [refreshData, syncLocalState, user, usingSupabase],
  );

  const currentScorecard = useMemo(
    () => {
      if (!user) return scoring.scorecardFromEntries([]);
      return scorecardForUser(user.id, prediction, adminResults);
    },
    [adminResults, prediction, user],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      usingSupabase,
      authMode,
      authBusy,
      authError,
      user,
      prediction,
      adminResults,
      leaderboard,
      completion: calculateCompletion(prediction),
      currentScorecard,
      avatarPresets,
      setAuthMode,
      clearAuthError: () => setAuthError(""),
      signIn,
      register,
      signOut,
      updateProfile,
      savePrediction,
      moveGroupTeam: (group, teamId, direction) => {
        if (hasTournamentStarted() && !user?.lateEdit) return;
        replacePrediction(moveGroupTeam(prediction, group, teamId, direction));
      },
      replaceGroupOrder: (group, teamIds) => {
        if (hasTournamentStarted() && !user?.lateEdit) return;
        replacePrediction(setGroupOrder(prediction, group, teamIds));
      },
      toggleThirdQualifier: (group) => {
        if (hasTournamentStarted() && !user?.lateEdit) return;
        replacePrediction(toggleThirdQualifier(prediction, group));
      },
      chooseMatchWinner: (matchNumber, teamId) => {
        const match = schedule.find((candidate) => candidate.number === matchNumber);
        if (!match || hasMatchStarted(match)) return;
        replacePrediction(chooseMatchWinner(prediction, matchNumber, teamId));
      },
      setPredictionScore: (matchNumber, side, value) => {
        const match = schedule.find((candidate) => candidate.number === matchNumber);
        if (!match || hasMatchStarted(match)) return;
        replacePrediction(setPredictionMatchScore(prediction, matchNumber, side, value));
      },
      setPredictionTrainerTactic: (matchNumber, trainerTeamId, tacticId) => {
        const match = schedule.find((candidate) => candidate.number === matchNumber);
        if (!match || hasMatchStarted(match)) return;
        replacePrediction(setPredictionTrainerTactic(prediction, matchNumber, trainerTeamId, tacticId));
      },
      setPredictionExtra: (key, value) => {
        if (hasTournamentStarted() && !user?.lateEdit) return;
        replacePrediction(setPredictionExtra(prediction, key, value));
      },
      toggleXiPlayer: (playerId) => {
        if (hasTournamentStarted() && !user?.lateEdit) return;
        replacePrediction(toggleXi(prediction, playerId));
      },
      setXiFormation: (formation) => {
        if (hasTournamentStarted() && !user?.lateEdit) return;
        replacePrediction(setXiFormation(prediction, formation));
      },
      setXiSelection: (playerIds) => {
        if (hasTournamentStarted() && !user?.lateEdit) return;
        replacePrediction(setXiSelection(prediction, playerIds));
      },
      applyCardSwap,
      setUserPro,
      setUserWolf,
      setUserLateEdit,
      setUserHidden,
      saveAdminResult,
      addAdminEvent,
      deleteAdminEvent,
      clearAdminResults,
      refreshData,
      teamName: (teamId) => teamsById.get(teamId)?.name || "Por confirmar",
      playerName: (playerId) => playersById.get(playerId)?.name || "Jugador",
      scheduleLabel: (matchNumber) => {
        const match = schedule.find((candidate) => candidate.number === matchNumber);
        return match ? `Partido ${match.number} · ${formatDate(match.date)}` : `Partido ${matchNumber}`;
      },
    }),
    [
      adminResults,
      applyCardSwap,
      authBusy,
      authError,
      authMode,
      currentScorecard,
      leaderboard,
      prediction,
      ready,
      refreshData,
      replacePrediction,
      saveAdminResult,
      savePrediction,
      setUserPro,
      setUserWolf,
      setUserLateEdit,
      setUserHidden,
      signIn,
      signOut,
      updateProfile,
      user,
      usingSupabase,
      register,
      addAdminEvent,
      deleteAdminEvent,
      clearAdminResults,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used inside AppProvider");
  }
  return context;
}
