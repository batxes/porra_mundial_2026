/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { createEngine } from "@/lib/scoring";
import { data, playersById, schedule, teamsById } from "@/lib/data";
import { formatDate } from "@/lib/format";
import {
  avatarPresets,
  currentLocalUser,
  defaultAdminEmail,
  digest,
  ensureLocalAdminUser,
  getLocalAdminResults,
  getLocalPredictions,
  getLocalUsers,
  LocalUser,
  localKeys,
  saveLocalPrediction,
  setCurrentLocalEmail,
  setLocalAdminResults,
  setLocalJson,
  setLocalUsers,
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
  setThirdQualifierOrder,
  setXiFormation,
  setXiSelection,
  toggleThirdQualifier,
  toggleXi,
} from "@/lib/prediction";
import { getSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabase";
import type { AdminResults, AuthMode, Prediction, Scorecard, UserProfile } from "@/lib/types";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  points: number;
  isAdmin: boolean;
};

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
  register: (name: string, email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  updateProfile: (values: { name: string; avatarUrl: string }) => Promise<void>;
  savePrediction: (makeDefinitive?: boolean) => Promise<{ ok: boolean; message: string }>;
  moveGroupTeam: (group: string, teamId: string, direction: number) => void;
  replaceGroupOrder: (group: string, teamIds: string[]) => void;
  toggleThirdQualifier: (group: string) => void;
  replaceThirdQualifierOrder: (groups: string[]) => void;
  chooseMatchWinner: (matchNumber: number, teamId: string) => void;
  setPredictionScore: (matchNumber: number, side: "homeScore" | "awayScore", value: string) => void;
  setPredictionExtra: (key: keyof Prediction["extras"], value: string) => void;
  toggleXiPlayer: (playerId: string) => void;
  setXiFormation: (formation: string) => void;
  setXiSelection: (playerIds: string[]) => void;
  saveAdminResult: (matchNumber: string, payload: AdminResults[string]) => Promise<void>;
  addAdminEvent: (matchNumber: string, event: AdminResults[string]["events"][number]) => Promise<void>;
  deleteAdminEvent: (matchNumber: string, eventId: string) => Promise<void>;
  clearAdminResults: () => Promise<void>;
  refreshData: () => Promise<void>;
  teamName: (teamId: string) => string;
  playerName: (playerId: string) => string;
  scheduleLabel: (matchNumber: number) => string;
};

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
        complete: calculateCompletion(userPrediction),
        champion: userPrediction.extras.worldChampion || userPrediction.bracket.winners["104"] || "",
        prediction: userPrediction,
        scorecard,
      };
    })
    .sort((a, b) => b.points - a.points || b.complete - a.complete || a.name.localeCompare(b.name));
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
      const currentPrediction = normalizePrediction(nextPrediction || (sessionUser ? getLocalPredictions()[sessionUser.id] : null));
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
            }
          : null,
      );
      setPrediction(currentPrediction);
      setAdminResults(currentResults);
      setLeaderboard(buildLeaderboard(getLocalUsers(), nextUserId ?? sessionUser?.id ?? null, currentPrediction, currentResults));
    },
    [],
  );

  const refreshData = useCallback(async () => {
    if (!usingSupabase) {
      await ensureLocalAdminUser();
      await syncLocalState();
      setReady(true);
      return;
    }

    const supabase = getSupabaseBrowserClient() as any;
    if (!supabase) {
      setReady(true);
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const tournamentResponse = await supabase.from("tournaments").select("id, slug").eq("slug", "world-cup-2026").maybeSingle();
    const tournamentId = tournamentResponse.data?.id;

    const [{ data: profiles }, { data: predictions }, { data: matches }, { data: events }, { data: scoreEntries }] = await Promise.all([
      supabase.from("profiles").select("id, display_name, avatar_url, total_points, is_admin"),
      tournamentId
        ? supabase.from("predictions").select("user_id, selections, completion_percent, is_definitive").eq("tournament_id", tournamentId)
        : Promise.resolve({ data: [] as any[], error: null }),
      supabase.from("matches").select("id, home_team_id, away_team_id, home_score, away_score, status, stage").eq("status", "validated"),
      supabase.from("match_events").select("id, match_id, player_id, team_id, event_type, minute"),
      supabase.from("score_entries").select("user_id, match_id, rule_code, points, explanation, source_ref"),
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
      });
    });

    const predictionByUser = new Map<string, Prediction>(
      ((predictions || []) as any[]).map((item: any) => [item.user_id, normalizePrediction(item.selections as Prediction)]),
    );
    const entriesByUser = new Map<string, Array<Record<string, unknown>>>();
    (scoreEntries || []).forEach((entry: any) => {
      const userEntries = entriesByUser.get(entry.user_id) || [];
      userEntries.push(entry);
      entriesByUser.set(entry.user_id, userEntries);
    });

    const currentProfile = ((profiles || []) as any[]).find((profile: any) => profile.id === session?.user?.id) || null;
    const currentPrediction = normalizePrediction(session?.user?.id ? predictionByUser.get(session.user.id) || null : null);

    setUser(
      currentProfile
        ? {
            id: currentProfile.id,
            name: currentProfile.display_name,
            email: session?.user?.email || "",
            avatarUrl: currentProfile.avatar_url || "",
            points: currentProfile.total_points || 0,
            isAdmin: Boolean(currentProfile.is_admin),
          }
        : null,
    );
    setPrediction(currentPrediction);
    setAdminResults(results);
    setLeaderboard(
      ((profiles || []) as any[])
        .map((profile: any) => {
          const profilePrediction = predictionByUser.get(profile.id) || emptyPrediction();
          const scorecard = scoring.scorecardFromEntries(entriesByUser.get(profile.id) || []);
          return {
            id: profile.id,
            name: profile.display_name,
            email: "",
            avatarUrl: profile.avatar_url || "",
            points: scorecard.entries.length ? scorecard.total : profile.total_points || 0,
            isAdmin: Boolean(profile.is_admin),
            complete: calculateCompletion(profilePrediction),
            champion: profilePrediction.extras.worldChampion || profilePrediction.bracket.winners["104"] || "",
            prediction: profilePrediction,
            scorecard,
          };
        })
        .sort((a, b) => b.points - a.points || b.complete - a.complete || a.name.localeCompare(b.name)),
    );
    setReady(true);
  }, [syncLocalState, usingSupabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshData]);

  const persistPrediction = useCallback(
    async (nextPrediction: Prediction, makeDefinitive = false) => {
      if (!user) {
        return { ok: false, message: "Necesitas entrar para guardar la porra." };
      }

      const finalPrediction = {
        ...nextPrediction,
        isDefinitive: makeDefinitive ? true : nextPrediction.isDefinitive,
        updatedAt: new Date().toISOString(),
      };

      if (!usingSupabase) {
        saveLocalPrediction(user.id, finalPrediction);
        await syncLocalState(user.id, finalPrediction);
        return { ok: true, message: "Progreso guardado." };
      }

      const supabase = getSupabaseBrowserClient() as any;
      if (!supabase) {
        return { ok: false, message: "No se ha podido conectar con Supabase." };
      }

      const { data: tournament } = await supabase.from("tournaments").select("id").eq("slug", "world-cup-2026").single();
      const { error } = await supabase.from("predictions").upsert({
        user_id: user.id,
        tournament_id: tournament?.id,
        selections: finalPrediction,
        completion_percent: calculateCompletion(finalPrediction),
        is_definitive: finalPrediction.isDefinitive,
        updated_at: finalPrediction.updatedAt,
      });

      if (error) {
        return { ok: false, message: error.message };
      }

      await refreshData();
      return { ok: true, message: "Progreso guardado." };
    },
    [refreshData, syncLocalState, user, usingSupabase],
  );

  const savePrediction = useCallback(
    async (makeDefinitive = false) => {
      return persistPrediction(prediction, makeDefinitive);
    },
    [persistPrediction, prediction],
  );

  const replacePrediction = useCallback((next: Prediction) => {
    setPrediction(next);
  }, []);

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

      await supabase.from("matches").upsert({
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

      await supabase.from("match_events").insert({
        match_id: `wc26-${matchNumber}`,
        player_id: event.playerId,
        team_id: event.teamId || playersById.get(event.playerId)?.team || null,
        event_type: event.type,
        minute: Number(event.minute) || 0,
      });

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
      await supabase.from("match_events").delete().eq("id", eventId);
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
    async (name: string, email: string, password: string) => {
      setAuthBusy(true);
      setAuthError("");
      try {
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
          setCurrentLocalEmail(normalizedEmail);
          await syncLocalState(nextUser.id);
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
      await supabase.from("profiles").update({ display_name: values.name, avatar_url: values.avatarUrl }).eq("id", user.id);
      await refreshData();
    },
    [refreshData, syncLocalState, user, usingSupabase],
  );

  const currentScorecard = useMemo(
    () => (user ? scorecardForUser(user.id, prediction, adminResults) : scoring.scorecardFromEntries([])),
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
        if (hasTournamentStarted()) return;
        replacePrediction(moveGroupTeam(prediction, group, teamId, direction));
      },
      replaceGroupOrder: (group, teamIds) => {
        if (hasTournamentStarted()) return;
        replacePrediction(setGroupOrder(prediction, group, teamIds));
      },
      toggleThirdQualifier: (group) => {
        if (hasTournamentStarted()) return;
        replacePrediction(toggleThirdQualifier(prediction, group));
      },
      replaceThirdQualifierOrder: (groups) => {
        if (hasTournamentStarted()) return;
        replacePrediction(setThirdQualifierOrder(prediction, groups));
      },
      chooseMatchWinner: (matchNumber, teamId) => {
        if (hasTournamentStarted()) return;
        replacePrediction(chooseMatchWinner(prediction, matchNumber, teamId));
      },
      setPredictionScore: (matchNumber, side, value) => {
        const match = schedule.find((candidate) => candidate.number === matchNumber);
        if (!match || hasMatchStarted(match)) return;
        replacePrediction(setPredictionMatchScore(prediction, matchNumber, side, value));
      },
      setPredictionExtra: (key, value) => {
        if (hasTournamentStarted()) return;
        replacePrediction(setPredictionExtra(prediction, key, value));
      },
      toggleXiPlayer: (playerId) => {
        if (hasTournamentStarted()) return;
        replacePrediction(toggleXi(prediction, playerId));
      },
      setXiFormation: (formation) => {
        if (hasTournamentStarted()) return;
        replacePrediction(setXiFormation(prediction, formation));
      },
      setXiSelection: (playerIds) => {
        if (hasTournamentStarted()) return;
        replacePrediction(setXiSelection(prediction, playerIds));
      },
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
