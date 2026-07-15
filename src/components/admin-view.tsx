"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Card,
  CardSkeleton,
  EmptyState,
  MatchEventLine,
  matchEventIcons,
  matchEventTeamId,
  Notice,
  PlayerAvatar,
  ProBadge,
  SectionHeading,
  TeamFlag,
  TeamPicker,
  WolfBadge,
} from "@/components/common";
import { AdminDropTab } from "@/components/admin-drop-tab";
import { AdminHogueraTab } from "@/components/admin-hoguera-tab";
import { AdminQuienDaMasTab } from "@/components/admin-quien-da-mas-tab";
import { AdminSanFerminTab } from "@/components/admin-sanfermin-tab";
import { AdminMaintenanceTab } from "@/components/admin-maintenance-tab";
import { AdminMourinhoBattleTab } from "@/components/admin-mourinho-battle-tab";
import { AdminOakTab } from "@/components/admin-oak-tab";
import { AdminPorteroPenaltyTab } from "@/components/admin-portero-penalty-tab";
import { AdminRonaldaoLimboTab } from "@/components/admin-ronaldao-limbo-tab";
import { AdminRuletaTab } from "@/components/admin-ruleta-tab";
import { AdminScratchCardsTab } from "@/components/admin-scratch-cards-tab";
import { AdminSuarezDentistTab } from "@/components/admin-suarez-dentist-tab";
import { PlayerSearchModal } from "@/components/player-search-modal";
import { toDbEventType, useAppContext } from "@/lib/app-context";
import { playersById, schedule, teamsById } from "@/lib/data";
import { translateSlot } from "@/lib/format";
import {
  calculateShootoutScore,
  isShootoutEvent,
  shootoutEventOrder,
} from "@/lib/match-events";
import { buildResolvedPlayoffTeams } from "@/lib/playoff-teams";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { trainerTactics } from "@/lib/trainer-tactics";
import type {
  AdminEvent,
  Match,
  ProviderSummary,
  UserProfile,
} from "@/lib/types";

type AdminTab =
  | "partidos"
  | "usuarios"
  | "sobres"
  | "oak"
  | "hoguera"
  | "quiendamas"
  | "sanfermin"
  | "portero"
  | "mourinho"
  | "ronaldao"
  | "rasca"
  | "suarez"
  | "ruleta"
  | "proveedor"
  | "mantenimiento";

const adminTabs: Array<{ id: AdminTab; label: string }> = [
  { id: "partidos", label: "Resultados y eventos" },
  { id: "usuarios", label: "Usuarios" },
  { id: "sobres", label: "Sobres" },
  { id: "oak", label: "Oak" },
  { id: "hoguera", label: "Hoguera" },
  { id: "quiendamas", label: "Quién da más" },
  { id: "sanfermin", label: "San Fermín" },
  { id: "portero", label: "Portero" },
  { id: "suarez", label: "Suarez" },
  { id: "mourinho", label: "Mourinho" },
  { id: "ronaldao", label: "Ronaldo" },
  { id: "rasca", label: "Rasca" },
  { id: "ruleta", label: "Ruleta" },
  { id: "proveedor", label: "API externa" },
  { id: "mantenimiento", label: "Mantenimiento" },
];

export function AdminView() {
  const {
    adminResults,
    clearAdminResults,
    leaderboard,
    ready,
    setUserHidden,
    setUserLateEdit,
    setUserPro,
    setUserWolf,
    user,
    usingSupabase,
  } = useAppContext();
  const [activeTab, setActiveTab] = useState<AdminTab>("partidos");
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [providerSummary, setProviderSummary] =
    useState<ProviderSummary | null>(null);
  const [adminMessage, setAdminMessage] = useState("");
  const [matchNumber, setMatchNumber] = useState(
    String(schedule[0]?.number ?? ""),
  );
  const [emailsById, setEmailsById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user?.isAdmin || !usingSupabase) return;
    const supabase = getSupabaseBrowserClient() as any;
    if (!supabase) return;

    let cancelled = false;
    supabase
      .rpc("admin_list_user_emails")
      .then(
        ({
          data: rows,
        }: {
          data: Array<{ user_id: string; email: string }> | null;
        }) => {
          if (cancelled || !rows) return;
          setEmailsById(
            Object.fromEntries(rows.map((row) => [row.user_id, row.email])),
          );
        },
      );

    return () => {
      cancelled = true;
    };
  }, [user?.isAdmin, usingSupabase]);

  const resolvedPlayoffTeams = useMemo(
    () => buildResolvedPlayoffTeams(adminResults),
    [adminResults],
  );

  const emailFor = (profile: UserProfile) =>
    profile.email || emailsById[profile.id] || "";

  if (!ready) {
    return (
      <div className="grid gap-6 xl:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (!user?.isAdmin) {
    return (
      <EmptyState
        icon="26"
        title="Zona reservada"
        description="Este panel solo está disponible para el administrador de la porra."
      />
    );
  }

  const loadProvider = async () => {
    setProviderBusy(true);
    setProviderError("");
    try {
      const response = await fetch("/api/provider/world-cup", {
        cache: "no-store",
      });
      const payload = (await response.json()) as ProviderSummary & {
        error?: string;
      };
      if (!response.ok) {
        setProviderError(payload.error || "No se ha podido consultar la API.");
        return;
      }
      setProviderSummary(payload);
    } finally {
      setProviderBusy(false);
    }
  };

  const savedEntries = Object.entries(adminResults).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  const teamIdForMatchSide = (
    match: Match,
    side: "home" | "away",
  ) =>
    teamsById.has(match[side])
      ? match[side]
      : resolvedPlayoffTeams[String(match.number)]?.[side] || "";

  const openMatchEditor = (number: string) => {
    setMatchNumber(number);
    document
      .getElementById("match-editor")
      ?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Zona privada"
        title="Administración"
        description="Publica resultados, añade eventos, gestiona usuarios y consulta la API externa desde servidor. La clave nunca toca el navegador."
      />

      <Notice>
        {usingSupabase ? "Modo Supabase activo." : "Modo demo local activo."}
      </Notice>
      {adminMessage ? <Notice>{adminMessage}</Notice> : null}

      <div className="flex flex-wrap gap-2">
        {adminTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${
              activeTab === tab.id
                ? "bg-cyan-400 text-black"
                : "border border-white/15 text-slate-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "partidos" ? (
        <>
          <Card className="space-y-4">
            <div id="match-editor">
              <h3 className="text-xl font-semibold text-white">
                Editar partido
              </h3>
              <p className="text-sm text-slate-400">
                Elige un partido y publica todo en un sitio: marcador, goles,
                penaltis, tarjetas y MVP.
              </p>
            </div>
            <label className="block space-y-2 text-sm text-slate-300">
              <span>Partido</span>
              <select
                value={matchNumber}
                onChange={(event) => setMatchNumber(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white"
              >
                {schedule.map((match) => (
                  <option key={match.number} value={match.number}>
                    Partido {match.number} ·{" "}
                    {matchSideName(
                      match.home,
                      teamIdForMatchSide(match, "home"),
                    )}{" "}
                    vs{" "}
                    {matchSideName(
                      match.away,
                      teamIdForMatchSide(match, "away"),
                    )}{" "}
                    · {match.date}
                  </option>
                ))}
              </select>
            </label>
            <MatchEditor key={matchNumber} matchNumber={matchNumber} />
          </Card>

          <Card className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-xl font-semibold text-white">
                Partidos publicados
              </h3>
              {savedEntries.length ? (
                <button
                  type="button"
                  onClick={() => {
                    const confirmed = window.confirm(
                      usingSupabase
                        ? "Esto borra TODOS los resultados y eventos publicados de la base de datos real y pone los puntos de todos a cero. ¿Seguro?"
                        : "Esto borra todos los resultados y eventos de la demo local. ¿Seguro?",
                    );
                    if (confirmed) void clearAdminResults();
                  }}
                  className="w-full rounded-full border border-rose-400/40 px-4 py-2 text-sm text-rose-200 hover:bg-rose-400/10 sm:w-auto"
                >
                  {usingSupabase
                    ? "Borrar todos los resultados"
                    : "Vaciar demo"}
                </button>
              ) : null}
            </div>
            {savedEntries.length ? (
              <div className="space-y-4">
                {savedEntries.map(([savedMatchNumber, result]) => {
                  const savedMatch = schedule.find(
                    (candidate) =>
                      String(candidate.number) === savedMatchNumber,
                  );
                  const homeTeamId =
                    result.homeTeamId ||
                    (savedMatch && teamsById.has(savedMatch.home)
                      ? savedMatch.home
                      : savedMatch
                        ? resolvedPlayoffTeams[savedMatchNumber]?.home
                      : "");
                  const awayTeamId =
                    result.awayTeamId ||
                    (savedMatch && teamsById.has(savedMatch.away)
                      ? savedMatch.away
                      : savedMatch
                        ? resolvedPlayoffTeams[savedMatchNumber]?.away
                      : "");
                  const homeName =
                    (homeTeamId && teamsById.get(homeTeamId)?.name) ||
                    (savedMatch ? translateSlot(savedMatch.home) : "Local");
                  const awayName =
                    (awayTeamId && teamsById.get(awayTeamId)?.name) ||
                    (savedMatch ? translateSlot(savedMatch.away) : "Visitante");
                  const shootoutScore = calculateShootoutScore(
                    result,
                    homeTeamId,
                    awayTeamId,
                  );
                  const hasShootout =
                    shootoutScore.home > 0 || shootoutScore.away > 0;
                  const events = (result.events || [])
                    .filter(
                      (event) =>
                        event.playerId && matchEventIcons[String(event.type)],
                    )
                    .sort(
                      (a, b) =>
                        (Number(a.minute) || 0) - (Number(b.minute) || 0),
                    );
                  const awayEvents = events.filter(
                    (event) => matchEventTeamId(event) === awayTeamId,
                  );
                  const homeEvents = events.filter(
                    (event) => !awayEvents.includes(event),
                  );

                  return (
                    <div
                      key={savedMatchNumber}
                      className="rounded-2xl border border-white/10 bg-white/5 p-4"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-xs font-bold uppercase tracking-[0.08em] text-slate-400">
                          Partido {savedMatchNumber}
                          {savedMatch ? ` · ${savedMatch.stage}` : ""}
                        </p>
                        <button
                          type="button"
                          onClick={() => openMatchEditor(savedMatchNumber)}
                          className="shrink-0 rounded-full border border-white/15 px-4 py-1.5 text-xs text-white hover:bg-white/10"
                        >
                          Editar
                        </button>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-2.5">
                          <span className="min-w-0 truncate text-right text-sm font-bold leading-tight text-white sm:text-base">
                            {homeName}
                          </span>
                          <TeamFlag
                            teamId={homeTeamId}
                            className="h-6 w-6 shrink-0 rounded-full border border-white/15 object-cover sm:h-7 sm:w-7"
                          />
                        </div>
                        <span className="shrink-0 rounded-lg bg-white/[0.08] px-3 py-1 text-lg font-bold tabular-nums tracking-wide text-white sm:px-3.5 sm:text-xl">
                          {result.homeScore} - {result.awayScore}
                        </span>
                        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
                          <TeamFlag
                            teamId={awayTeamId}
                            className="h-6 w-6 shrink-0 rounded-full border border-white/15 object-cover sm:h-7 sm:w-7"
                          />
                          <span className="min-w-0 truncate text-sm font-bold leading-tight text-white sm:text-base">
                            {awayName}
                          </span>
                        </div>
                      </div>
                      {hasShootout ? (
                        <p className="mt-1 text-center text-xs font-semibold text-zinc-400">
                          Tanda ({shootoutScore.home}-{shootoutScore.away})
                        </p>
                      ) : null}
                      {events.length ? (
                        <div className="mt-2.5 grid grid-cols-2 gap-x-4 border-t border-white/[0.06] pt-2.5">
                          <div className="space-y-1">
                            {homeEvents.map((event, index) => (
                              <MatchEventLine
                                key={event.id || `h${index}`}
                                event={event}
                              />
                            ))}
                          </div>
                          <div className="space-y-1">
                            {awayEvents.map((event, index) => (
                              <MatchEventLine
                                key={event.id || `a${index}`}
                                event={event}
                                align="right"
                              />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2.5 border-t border-white/[0.06] pt-2.5 text-sm text-slate-400">
                          Sin eventos publicados.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                Todavía no has publicado resultados.
              </p>
            )}
          </Card>
        </>
      ) : null}

      {activeTab === "usuarios" ? (
        <Card className="space-y-4">
          <div>
            <h3 className="text-xl font-semibold text-white">Usuarios</h3>
            <p className="text-sm text-slate-400">
              Concede el badge PRO a quien haya pagado u oculta cuentas
              (duplicadas, de prueba...) de la clasificación. Ocultar es
              reversible y no borra su porra. Los puntos se recalculan al
              publicar resultados.
            </p>
          </div>
          <div className="space-y-3">
            {leaderboard.length ? (
              leaderboard.map((profile) => (
                <div
                  key={profile.id}
                  className={`flex flex-col gap-3 rounded-2xl bg-white/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
                    profile.isHidden ? "opacity-60" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-slate-200">
                        {profile.name}
                      </span>
                      {profile.isPro ? <ProBadge /> : null}
                      {profile.isWolf ? <WolfBadge force /> : null}
                      {profile.lateEdit ? (
                        <span className="shrink-0 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-cyan-200">
                          Edición abierta
                        </span>
                      ) : null}
                      {profile.isHidden ? (
                        <span className="shrink-0 rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-zinc-400">
                          Oculto
                        </span>
                      ) : null}
                    </span>
                    {emailFor(profile) ? (
                      <span className="block truncate text-xs text-zinc-500">
                        {emailFor(profile)}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <strong className="shrink-0 text-cyan-300">
                      {profile.points} pts
                    </strong>
                    <button
                      type="button"
                      onClick={async () => {
                        await setUserPro(profile.id, !profile.isPro);
                        setAdminMessage(
                          profile.isPro
                            ? `Badge PRO retirado a ${profile.name}.`
                            : `Badge PRO concedido a ${profile.name}.`,
                        );
                      }}
                      className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                        profile.isPro
                          ? "border border-white/15 text-white hover:bg-white/10"
                          : "bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-500 text-amber-950 hover:brightness-110"
                      }`}
                    >
                      {profile.isPro ? "Quitar PRO" : "Hacer PRO"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await setUserWolf(profile.id, !profile.isWolf);
                        setAdminMessage(
                          profile.isWolf
                            ? `${profile.name} sale de la manada 🐺.`
                            : `${profile.name} entra en la manada 🐺.`,
                        );
                      }}
                      className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                        profile.isWolf
                          ? "border border-white/15 text-white hover:bg-white/10"
                          : "border border-white/15 bg-white/[0.06] text-zinc-200 hover:bg-white/10"
                      }`}
                    >
                      {profile.isWolf ? "Quitar 🐺" : "🐺"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await setUserLateEdit(profile.id, !profile.lateEdit);
                        setAdminMessage(
                          profile.lateEdit
                            ? `Edición cerrada para ${profile.name}.`
                            : `${profile.name} ya puede rellenar o editar su porra (los partidos ya jugados siguen bloqueados).`,
                        );
                      }}
                      className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                        profile.lateEdit
                          ? "bg-cyan-400 text-slate-950 hover:brightness-110"
                          : "border border-cyan-400/40 text-cyan-200 hover:bg-cyan-400/10"
                      }`}
                    >
                      {profile.lateEdit ? "Cerrar edición" : "Abrir edición"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await setUserHidden(profile.id, !profile.isHidden);
                        setAdminMessage(
                          profile.isHidden
                            ? `${profile.name} vuelve a aparecer en la clasificación.`
                            : `${profile.name} ocultado de la clasificación.`,
                        );
                      }}
                      className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                        profile.isHidden
                          ? "bg-white text-black hover:bg-zinc-200"
                          : "border border-rose-400/40 text-rose-200 hover:bg-rose-400/10"
                      }`}
                    >
                      {profile.isHidden ? "Mostrar" : "Ocultar"}
                    </button>
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">
                Aún no hay participantes.
              </p>
            )}
          </div>
        </Card>
      ) : null}

      {activeTab === "sobres" ? (
        <Card className="space-y-4">
          <AdminDropTab />
        </Card>
      ) : null}

      {activeTab === "ruleta" ? (
        <Card className="space-y-4">
          <AdminRuletaTab />
        </Card>
      ) : null}

      {activeTab === "oak" ? (
        <Card className="space-y-4">
          <AdminOakTab />
        </Card>
      ) : null}

      {activeTab === "hoguera" ? (
        <Card className="space-y-4">
          <AdminHogueraTab />
        </Card>
      ) : null}

      {activeTab === "sanfermin" ? (
        <Card className="space-y-4">
          <AdminSanFerminTab />
        </Card>
      ) : null}

      {activeTab === "quiendamas" ? (
        <Card className="space-y-4">
          <AdminQuienDaMasTab />
        </Card>
      ) : null}

      {activeTab === "portero" ? (
        <Card className="space-y-4">
          <AdminPorteroPenaltyTab />
        </Card>
      ) : null}

      {activeTab === "suarez" ? (
        <Card className="space-y-4">
          <AdminSuarezDentistTab />
        </Card>
      ) : null}

      {activeTab === "ronaldao" ? (
        <Card className="space-y-4">
          <AdminRonaldaoLimboTab />
        </Card>
      ) : null}

      {activeTab === "mourinho" ? (
        <Card className="space-y-4">
          <AdminMourinhoBattleTab />
        </Card>
      ) : null}

      {activeTab === "rasca" ? (
        <Card className="space-y-4">
          <AdminScratchCardsTab />
        </Card>
      ) : null}

      {activeTab === "mantenimiento" ? (
        <Card className="space-y-4">
          <AdminMaintenanceTab />
        </Card>
      ) : null}

      {activeTab === "proveedor" ? (
        <Card className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-white">
                Proveedor externo
              </h3>
              <p className="text-sm text-slate-400">
                API-Football vía ruta server-side.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadProvider()}
              disabled={providerBusy}
              className="w-full rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-black disabled:opacity-60 sm:w-auto"
            >
              {providerBusy ? "Cargando…" : "Consultar API"}
            </button>
          </div>

          {providerError ? (
            <Notice tone="danger">{providerError}</Notice>
          ) : null}

          {providerSummary ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <ProviderFlag
                  label="Eventos"
                  active={Boolean(providerSummary.coverage?.fixtures.events)}
                />
                <ProviderFlag
                  label="Lineups"
                  active={Boolean(providerSummary.coverage?.fixtures.lineups)}
                />
                <ProviderFlag
                  label="Stats de partido"
                  active={Boolean(
                    providerSummary.coverage?.fixtures.statistics_fixtures,
                  )}
                />
                <ProviderFlag
                  label="Stats de jugador"
                  active={Boolean(
                    providerSummary.coverage?.fixtures.statistics_players,
                  )}
                />
                <ProviderFlag
                  label="Top scorers"
                  active={Boolean(providerSummary.coverage?.top_scorers)}
                />
                <ProviderFlag
                  label="Top cards"
                  active={Boolean(providerSummary.coverage?.top_cards)}
                />
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-white">Últimos fixtures</h4>
                <div className="space-y-2">
                  {providerSummary.fixtures.slice(0, 8).map((fixture: any) => (
                    <div
                      key={fixture.fixture.id}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
                    >
                      <p className="font-medium text-white">
                        {fixture.teams.home.name} {fixture.goals.home ?? "-"} ·{" "}
                        {fixture.goals.away ?? "-"} {fixture.teams.away.name}
                      </p>
                      <p className="text-slate-400">
                        {fixture.league.round} · {fixture.fixture.status.short}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <ProviderList
                  title="Top goleadores"
                  items={providerSummary.topScorers
                    .slice(0, 5)
                    .map(
                      (item: any) =>
                        `${item.player?.name || "Jugador"} · ${item.statistics?.[0]?.goals?.total ?? 0}`,
                    )}
                />
                <ProviderList
                  title="Top tarjetas"
                  items={providerSummary.topCards
                    .slice(0, 5)
                    .map(
                      (item: any) =>
                        `${item.player?.name || "Jugador"} · ${item.statistics?.[0]?.cards?.yellow ?? 0}A / ${item.statistics?.[0]?.cards?.red ?? 0}R`,
                    )}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              Pulsa “Consultar API” para cargar cobertura, resultados,
              goleadores y tarjetas.
            </p>
          )}
        </Card>
      ) : null}
    </div>
  );
}

type GoalSlot = {
  playerId: string;
  minute: string;
  penalty: boolean;
  ownGoal: boolean;
};
type ExtraRow = { playerId: string; type: string; minute: string };
type ShootoutAttempt = {
  id: string;
  teamId: string;
  shooterId: string;
  scored: boolean;
  goalkeeperId: string;
};
type PickerTarget =
  | { kind: "goal"; side: "home" | "away"; index: number }
  | { kind: "mvp" }
  | { kind: "extra"; index: number }
  | { kind: "shootoutShooter"; index: number }
  | { kind: "shootoutGoalkeeper"; index: number };

const goalEventTypes = new Set([
  "gol",
  "goal",
  "penalti marcado",
  "penalty_goal",
  "gol en propia",
  "own_goal",
]);
const mvpEventTypes = new Set(["MVP", "mvp"]);

const extraEventOptions = [
  { value: "penalti fallado", label: "Penalti fallado" },
  { value: "penalti parado", label: "Penalti parado" },
  { value: "roja", label: "Tarjeta roja" },
];

// Supabase devuelve los tipos en inglés; el selector de "Otros eventos" trabaja en español.
const extraTypeAliases: Record<string, string> = {
  penalty_miss: "penalti fallado",
  penalty_save: "penalti parado",
  red_card: "roja",
};

function splitSavedEvents(
  events: AdminEvent[],
  homeId: string,
  awayId: string,
) {
  const byMinute = (a: { minute: string }, b: { minute: string }) =>
    (Number(a.minute) || 0) - (Number(b.minute) || 0);
  const home: GoalSlot[] = [];
  const away: GoalSlot[] = [];
  const extras: ExtraRow[] = [];
  const shootout = new Map<
    string,
    ShootoutAttempt & { order: number }
  >();
  let mvpPlayerId = "";

  for (const event of events) {
    const type = String(event.type || "");
    const minute = event.minute ? String(event.minute) : "";
    if (isShootoutEvent(event)) {
      const order = shootoutEventOrder(event) || shootout.size + 1;
      const key = event.details?.shootoutAttemptId || String(order);
      const current =
        shootout.get(key) ||
        ({
          id: key,
          teamId: "",
          shooterId: "",
          scored: type === "penalty_goal" || type === "penalti marcado",
          goalkeeperId: "",
          order,
        } satisfies ShootoutAttempt & { order: number });

      if (type === "penalty_goal" || type === "penalti marcado") {
        current.teamId =
          event.teamId || playersById.get(event.playerId)?.team || current.teamId;
        current.shooterId = event.playerId;
        current.scored = true;
      } else if (type === "penalty_miss" || type === "penalti fallado") {
        current.teamId =
          event.teamId || playersById.get(event.playerId)?.team || current.teamId;
        current.shooterId = event.playerId;
        current.scored = false;
      } else if (type === "penalty_save" || type === "penalti parado") {
        const keeperTeamId =
          event.teamId || playersById.get(event.playerId)?.team || "";
        current.teamId =
          current.teamId ||
          (keeperTeamId === homeId ? awayId : homeId);
        current.goalkeeperId = event.playerId;
        current.scored = false;
      }
      shootout.set(key, current);
    } else if (goalEventTypes.has(type)) {
      const teamId =
        event.teamId || playersById.get(event.playerId)?.team || "";
      const slot = {
        playerId: event.playerId,
        minute,
        penalty: type === "penalti marcado" || type === "penalty_goal",
        ownGoal: type === "gol en propia" || type === "own_goal",
      };
      if (teamId && teamId === awayId) {
        away.push(slot);
      } else {
        home.push(slot);
      }
    } else if (mvpEventTypes.has(type)) {
      mvpPlayerId = event.playerId;
    } else {
      extras.push({
        playerId: event.playerId,
        type: extraTypeAliases[type] || type,
        minute,
      });
    }
  }

  home.sort(byMinute);
  away.sort(byMinute);
  const shootoutAttempts = Array.from(shootout.values())
    .sort((a, b) => a.order - b.order)
    .map((attempt) => ({
      id: attempt.id,
      teamId: attempt.teamId,
      shooterId: attempt.shooterId,
      scored: attempt.scored,
      goalkeeperId: attempt.goalkeeperId,
    }));
  return { home, away, extras, mvpPlayerId, shootoutAttempts };
}

function goalCount(score: string) {
  return Math.min(Math.max(parseInt(score, 10) || 0, 0), 15);
}

function MatchEditor({ matchNumber }: { matchNumber: string }) {
  const {
    adminResults,
    addAdminEvent,
    deleteAdminEvent,
    saveAdminResult,
    teamName,
    usingSupabase,
  } = useAppContext();

  const match = schedule.find(
    (candidate) => String(candidate.number) === matchNumber,
  );
  const saved = adminResults[matchNumber];
  const resolvedPlayoffTeams = buildResolvedPlayoffTeams(adminResults);
  const resolvedPlayoffMatch = resolvedPlayoffTeams[matchNumber];
  const scheduledHomeId =
    match && teamsById.has(match.home)
      ? match.home
      : resolvedPlayoffMatch?.home || "";
  const scheduledAwayId =
    match && teamsById.has(match.away)
      ? match.away
      : resolvedPlayoffMatch?.away || "";

  const [initial] = useState(() =>
    splitSavedEvents(
      saved?.events || [],
      saved?.homeTeamId || scheduledHomeId,
      saved?.awayTeamId || scheduledAwayId,
    ),
  );
  const [homeScore, setHomeScore] = useState(
    saved == null ? "" : String(saved.homeScore ?? ""),
  );
  const [awayScore, setAwayScore] = useState(
    saved == null ? "" : String(saved.awayScore ?? ""),
  );
  const [homeTeamId, setHomeTeamId] = useState(
    saved?.homeTeamId || scheduledHomeId,
  );
  const [awayTeamId, setAwayTeamId] = useState(
    saved?.awayTeamId || scheduledAwayId,
  );
  const [homeGoals, setHomeGoals] = useState<GoalSlot[]>(initial.home);
  const [awayGoals, setAwayGoals] = useState<GoalSlot[]>(initial.away);
  const [mvpPlayerId, setMvpPlayerId] = useState(initial.mvpPlayerId);
  const [extras, setExtras] = useState<ExtraRow[]>(initial.extras);
  const [shootoutAttempts, setShootoutAttempts] = useState<ShootoutAttempt[]>(
    initial.shootoutAttempts,
  );
  const [trainerTacticsById, setTrainerTacticsById] = useState<
    Record<string, string[]>
  >(saved?.trainerTactics || {});
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [saving, setSaving] = useState(false);

  const resolvedHomeId = homeTeamId || scheduledHomeId;
  const resolvedAwayId = awayTeamId || scheduledAwayId;
  const bothTeamIds = [resolvedHomeId, resolvedAwayId].filter(Boolean);
  const homeCount = goalCount(homeScore);
  const awayCount = goalCount(awayScore);
  const isKnockoutMatch = Boolean(match && match.number >= 73);
  const isShootoutMatch =
    isKnockoutMatch &&
    homeScore !== "" &&
    awayScore !== "" &&
    Number(homeScore) === Number(awayScore);
  const visibleShootoutAttempts = isShootoutMatch ? shootoutAttempts : [];
  const shootoutHomeScore = visibleShootoutAttempts.filter(
    (attempt) => attempt.teamId === resolvedHomeId && attempt.scored,
  ).length;
  const shootoutAwayScore = visibleShootoutAttempts.filter(
    (attempt) => attempt.teamId === resolvedAwayId && attempt.scored,
  ).length;

  const updateGoal = (
    side: "home" | "away",
    index: number,
    patch: Partial<GoalSlot>,
  ) => {
    const setter = side === "home" ? setHomeGoals : setAwayGoals;
    setter((current) => {
      const next = [...current];
      while (next.length <= index)
        next.push({ playerId: "", minute: "", penalty: false, ownGoal: false });
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const updateExtra = (index: number, patch: Partial<ExtraRow>) => {
    setExtras((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const opposingTeamId = (teamId: string) =>
    teamId === resolvedHomeId ? resolvedAwayId : resolvedHomeId;

  const addShootoutAttempt = (teamId: string) => {
    if (!teamId) return;
    setShootoutAttempts((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        teamId,
        shooterId: "",
        scored: true,
        goalkeeperId: "",
      },
    ]);
  };

  const updateShootoutAttempt = (
    index: number,
    patch: Partial<ShootoutAttempt>,
  ) => {
    setShootoutAttempts((current) =>
      current.map((attempt, i) =>
        i === index
          ? {
              ...attempt,
              ...patch,
              ...(patch.scored ? { goalkeeperId: "" } : {}),
            }
          : attempt,
      ),
    );
  };

  const sanitizeTrainerTactics = (
    source = trainerTacticsById,
  ): Record<string, string[]> => {
    const validTeams = new Set([resolvedHomeId, resolvedAwayId].filter(Boolean));
    return Object.fromEntries(
      Object.entries(source)
        .map(([tacticId, teamIds]) => [
          tacticId,
          Array.from(
            new Set((teamIds || []).filter((teamId) => validTeams.has(teamId))),
          ),
        ])
        .filter(([, teamIds]) => teamIds.length),
    );
  };

  const isTrainerTacticChecked = (tacticId: string, teamId: string) =>
    Boolean(teamId && (trainerTacticsById[tacticId] || []).includes(teamId));

  const toggleTrainerTacticTeam = (
    tacticId: string,
    teamId: string,
    checked: boolean,
  ) => {
    if (!teamId) return;
    setTrainerTacticsById((current) => {
      const next = { ...current };
      const teamIds = new Set(next[tacticId] || []);
      if (checked) {
        teamIds.add(teamId);
      } else {
        teamIds.delete(teamId);
      }
      if (teamIds.size) {
        next[tacticId] = Array.from(teamIds);
      } else {
        delete next[tacticId];
      }
      return sanitizeTrainerTactics(next);
    });
  };

  const pickerPlayerId = pickerTarget
    ? pickerTarget.kind === "goal"
      ? (pickerTarget.side === "home" ? homeGoals : awayGoals)[
          pickerTarget.index
        ]?.playerId || ""
      : pickerTarget.kind === "mvp"
        ? mvpPlayerId
        : pickerTarget.kind === "extra"
          ? extras[pickerTarget.index]?.playerId || ""
          : pickerTarget.kind === "shootoutShooter"
            ? shootoutAttempts[pickerTarget.index]?.shooterId || ""
            : shootoutAttempts[pickerTarget.index]?.goalkeeperId || ""
    : "";

  // En un gol en propia el autor es del equipo rival, así que el modal debe
  // ofrecer los jugadores de los dos equipos.
  const pickerOwnGoal = pickerTarget
    ? pickerTarget.kind === "goal"
      ? Boolean(
          (pickerTarget.side === "home" ? homeGoals : awayGoals)[
            pickerTarget.index
          ]?.ownGoal,
        )
      : false
    : false;

  const setPickerPlayerId = (playerId: string) => {
    if (!pickerTarget) return;
    if (pickerTarget.kind === "goal") {
      updateGoal(pickerTarget.side, pickerTarget.index, { playerId });
    } else if (pickerTarget.kind === "mvp") {
      setMvpPlayerId(playerId);
    } else if (pickerTarget.kind === "extra") {
      updateExtra(pickerTarget.index, { playerId });
    } else if (pickerTarget.kind === "shootoutShooter") {
      updateShootoutAttempt(pickerTarget.index, { shooterId: playerId });
    } else {
      updateShootoutAttempt(pickerTarget.index, { goalkeeperId: playerId });
    }
  };

  const pickerTeamIds = !pickerTarget
    ? bothTeamIds
    : pickerTarget.kind === "goal" && !pickerOwnGoal
      ? [pickerTarget.side === "home" ? resolvedHomeId : resolvedAwayId].filter(
          Boolean,
        )
      : pickerTarget.kind === "shootoutShooter"
        ? [shootoutAttempts[pickerTarget.index]?.teamId].filter(Boolean)
      : pickerTarget.kind === "shootoutGoalkeeper"
        ? [
            opposingTeamId(
              shootoutAttempts[pickerTarget.index]?.teamId || "",
            ),
          ].filter(Boolean)
      : bothTeamIds;
  const pickerInitialPosition =
    pickerTarget?.kind === "shootoutGoalkeeper" ? "POR" : "all";

  const pickerTitle = !pickerTarget
    ? ""
    : pickerTarget.kind === "goal"
      ? pickerOwnGoal
        ? "Gol en propia puerta"
        : `Goleador ${pickerTarget.side === "home" ? (resolvedHomeId ? `de ${teamName(resolvedHomeId)}` : "local") : resolvedAwayId ? `de ${teamName(resolvedAwayId)}` : "visitante"}`
      : pickerTarget.kind === "mvp"
        ? "MVP del partido"
        : pickerTarget.kind === "extra"
          ? "Jugador del evento"
          : pickerTarget.kind === "shootoutShooter"
            ? "Lanzador de la tanda"
            : "Portero que para el penalti";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const finalShootoutAttempts = isShootoutMatch
      ? shootoutAttempts.filter(
          (attempt) => attempt.teamId && (attempt.shooterId || attempt.goalkeeperId),
        )
      : [];

    if (isShootoutMatch) {
      if (!finalShootoutAttempts.length) {
        toast.error("Falta la tanda de penaltis", {
          description:
            "En una eliminatoria empatada hay que publicar al menos un lanzamiento.",
        });
        return;
      }
      const incompleteAttempt = finalShootoutAttempts.find(
        (attempt) => !attempt.shooterId,
      );
      if (incompleteAttempt) {
        toast.error("Tanda incompleta", {
          description:
            "Cada lanzamiento necesita lanzador. Si fue fuera o al poste, deja el portero vacio.",
        });
        return;
      }
      const finalShootoutHomeScore = finalShootoutAttempts.filter(
        (attempt) => attempt.teamId === resolvedHomeId && attempt.scored,
      ).length;
      const finalShootoutAwayScore = finalShootoutAttempts.filter(
        (attempt) => attempt.teamId === resolvedAwayId && attempt.scored,
      ).length;
      if (finalShootoutHomeScore === finalShootoutAwayScore) {
        toast.error("La tanda sigue empatada", {
          description:
            "Añade los lanzamientos necesarios hasta que haya ganador.",
        });
        return;
      }
    }

    const goalEvent = (slot: GoalSlot, teamId: string): AdminEvent => ({
      id: crypto.randomUUID(),
      playerId: slot.playerId,
      teamId: teamId || playersById.get(slot.playerId)?.team,
      type: slot.ownGoal
        ? "gol en propia"
        : slot.penalty
          ? "penalti marcado"
          : "gol",
      minute: Number(slot.minute) || 0,
      source: "manual",
    });

    const shootoutEvents: AdminEvent[] = finalShootoutAttempts.flatMap(
      (attempt, index) => {
        const order = index + 1;
        const attemptId = attempt.id || crypto.randomUUID();
        const shootoutOutcome = attempt.scored
          ? "scored"
          : attempt.goalkeeperId
            ? "saved"
            : "missed";
        const baseDetails = {
          phase: "shootout",
          shootoutOrder: order,
          shootoutAttemptId: attemptId,
          shootoutOutcome,
        };
        const shooterEvent: AdminEvent = {
          id: crypto.randomUUID(),
          playerId: attempt.shooterId,
          teamId: attempt.teamId,
          type: attempt.scored ? "penalti marcado" : "penalti fallado",
          minute: 120 + order,
          source: "shootout",
          details: baseDetails,
        };

        if (attempt.scored || !attempt.goalkeeperId) return [shooterEvent];

        return [
          shooterEvent,
          {
            id: crypto.randomUUID(),
            playerId: attempt.goalkeeperId,
            teamId: opposingTeamId(attempt.teamId),
            type: "penalti parado",
            minute: 120 + order,
            source: "shootout",
            details: {
              ...baseDetails,
              relatedEventId: shooterEvent.id,
            },
          },
        ];
      },
    );

    const finalEvents: AdminEvent[] = [
      ...homeGoals
        .slice(0, homeCount)
        .filter((slot) => slot.playerId)
        .map((slot) => goalEvent(slot, resolvedHomeId)),
      ...awayGoals
        .slice(0, awayCount)
        .filter((slot) => slot.playerId)
        .map((slot) => goalEvent(slot, resolvedAwayId)),
      ...(mvpPlayerId
        ? [
            {
              id: crypto.randomUUID(),
              playerId: mvpPlayerId,
              teamId: playersById.get(mvpPlayerId)?.team,
              type: "MVP",
              minute: 0,
              source: "manual",
            },
          ]
        : []),
      ...extras
        .filter((row) => row.playerId && row.type)
        .map((row) => ({
          id: crypto.randomUUID(),
          playerId: row.playerId,
          teamId: playersById.get(row.playerId)?.team,
          type: row.type,
          minute: Number(row.minute) || 0,
          source: "manual",
        })),
      ...shootoutEvents,
    ];

    // Reutiliza los ids de los eventos guardados idénticos para que el diff de Supabase
    // solo toque lo que de verdad cambió.
    const savedEvents = saved?.events || [];
    const keyOf = (candidate: {
      playerId: string;
      teamId?: string;
      type: string;
      minute: number | string;
      details?: AdminEvent["details"];
    }) =>
      [
        candidate.playerId,
        candidate.teamId || "",
        toDbEventType(candidate.type),
        Number(candidate.minute) || 0,
        candidate.details?.phase || "",
        candidate.details?.shootoutOrder || "",
        candidate.details?.shootoutAttemptId || "",
        candidate.details?.shootoutOutcome || "",
      ].join("|");
    const pool = [...savedEvents];
    const mergedEvents = finalEvents.map((candidate) => {
      const matchIndex = pool.findIndex(
        (savedEvent) => keyOf(savedEvent) === keyOf(candidate),
      );
      if (matchIndex >= 0) {
        const [matched] = pool.splice(matchIndex, 1);
        return { ...candidate, id: matched.id };
      }
      return candidate;
    });
    const finalTrainerTactics = sanitizeTrainerTactics();

    setSaving(true);
    try {
      // El partido se guarda primero: en Supabase, `match_events.match_id` tiene
      // foreign key a `matches`, así que la fila del partido debe existir antes
      // de insertar sus eventos.
      await saveAdminResult(matchNumber, {
        homeScore,
        awayScore,
        homeTeamId: resolvedHomeId,
        awayTeamId: resolvedAwayId,
        events: mergedEvents,
        trainerTactics: finalTrainerTactics,
        source: "manual",
      });

      if (usingSupabase) {
        for (const stale of pool) {
          await deleteAdminEvent(matchNumber, stale.id);
        }
        const savedIds = new Set(
          savedEvents.map((savedEvent) => savedEvent.id),
        );
        for (const added of mergedEvents.filter(
          (candidate) => !savedIds.has(candidate.id),
        )) {
          await addAdminEvent(matchNumber, added);
        }
      }
      toast.success(`Partido ${matchNumber} guardado`, {
        description: `${resolvedHomeId ? teamName(resolvedHomeId) : "Local"} ${homeScore} - ${awayScore} ${resolvedAwayId ? teamName(resolvedAwayId) : "Visitante"} · ${mergedEvents.length} evento${mergedEvents.length === 1 ? "" : "s"} · puntos recalculados`,
      });
    } catch (error) {
      toast.error("No se ha podido guardar el partido", {
        description:
          error instanceof Error ? error.message : "Inténtalo de nuevo.",
      });
    } finally {
      setSaving(false);
    }
  };

  const playerButton = (
    playerId: string,
    placeholder: string,
    target: PickerTarget,
  ) => {
    const player = playersById.get(playerId);
    return (
      <button
        type="button"
        onClick={() => setPickerTarget(target)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-left text-sm text-white"
      >
        {player ? (
          <>
            <PlayerAvatar
              player={player}
              className="h-7 w-7 shrink-0 rounded-full bg-white/10 text-[10px]"
            />
            <span className="min-w-0">
              <span className="block truncate font-semibold">
                {player.name}
              </span>
              <span className="block truncate text-xs text-slate-400">
                {player.position} · {teamName(player.team)}
              </span>
            </span>
          </>
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
      </button>
    );
  };

  const goalSlots = (
    side: "home" | "away",
    teamId: string,
    count: number,
    slots: GoalSlot[],
  ) => (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        {teamId ? (
          <TeamFlag teamId={teamId} className="h-4 w-5 rounded-sm" />
        ) : null}
        Goles{" "}
        {teamId
          ? `de ${teamName(teamId)}`
          : side === "home"
            ? "del local"
            : "del visitante"}
      </p>
      {Array.from({ length: count }, (_, index) => {
        const slot = slots[index] || {
          playerId: "",
          minute: "",
          penalty: false,
          ownGoal: false,
        };
        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            {playerButton(slot.playerId, `Goleador ${index + 1}`, {
              kind: "goal",
              side,
              index,
            })}
            <input
              value={slot.minute}
              onChange={(event) =>
                updateGoal(side, index, {
                  minute: event.target.value.replace(/\D/g, ""),
                })
              }
              placeholder="Min"
              inputMode="numeric"
              className="w-20 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            />
            <label className="flex items-center gap-1.5 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={slot.penalty}
                onChange={(event) =>
                  updateGoal(side, index, {
                    penalty: event.target.checked,
                    ...(event.target.checked ? { ownGoal: false } : {}),
                  })
                }
                className="accent-cyan-400"
              />
              Penalti
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={slot.ownGoal}
                onChange={(event) =>
                  updateGoal(side, index, {
                    ownGoal: event.target.checked,
                    ...(event.target.checked ? { penalty: false } : {}),
                  })
                }
                className="accent-cyan-400"
              />
              P.p.
            </label>
          </div>
        );
      })}
    </div>
  );

  return (
    <form className="space-y-6" onSubmit={submit}>
      {!scheduledHomeId || !scheduledAwayId ? (
        <div className="grid gap-4 md:grid-cols-2">
          <TeamPicker
            label="Equipo local real"
            value={homeTeamId}
            onChange={setHomeTeamId}
            placeholder="Por confirmar"
          />
          <TeamPicker
            label="Equipo visitante real"
            value={awayTeamId}
            onChange={setAwayTeamId}
            placeholder="Por confirmar"
          />
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-300">
          <span className="flex items-center gap-2">
            {resolvedHomeId ? (
              <TeamFlag
                teamId={resolvedHomeId}
                className="h-4 w-5 rounded-sm"
              />
            ) : null}
            Goles {resolvedHomeId ? teamName(resolvedHomeId) : "local"}
          </span>
          <input
            value={homeScore}
            onChange={(event) =>
              setHomeScore(event.target.value.replace(/\D/g, ""))
            }
            required
            inputMode="numeric"
            pattern="\d+"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white"
          />
        </label>
        <label className="space-y-2 text-sm text-slate-300">
          <span className="flex items-center gap-2">
            {resolvedAwayId ? (
              <TeamFlag
                teamId={resolvedAwayId}
                className="h-4 w-5 rounded-sm"
              />
            ) : null}
            Goles {resolvedAwayId ? teamName(resolvedAwayId) : "visitante"}
          </span>
          <input
            value={awayScore}
            onChange={(event) =>
              setAwayScore(event.target.value.replace(/\D/g, ""))
            }
            required
            inputMode="numeric"
            pattern="\d+"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white"
          />
        </label>
      </div>

      {bothTeamIds.length < 2 ? (
        <Notice>
          Confirma los dos equipos del partido para filtrar los jugadores en
          cada hueco.
        </Notice>
      ) : null}

      <div className="space-y-3">
        <div>
          <h4 className="font-semibold text-white">Chips de entrenador</h4>
          <p className="text-sm text-slate-400">
            Marca manualmente qué equipo cumple cada chip. Si eliges ambos,
            puntúan los dos. Solo cuentan los 120 minutos; no marques nada de la
            tanda de penaltis. En Estratega cuenta si el lanzador del balón
            parado marca o asiste; penalti incluido.
            Remontada se marca si el equipo empieza perdiendo y acaba ganando.
          </p>
        </div>
        <div className="grid gap-2">
          {trainerTactics.map((tactic) => (
            <div
              key={tactic.id}
              className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="flex min-w-0 items-center gap-2 text-slate-200">
                <span className="min-w-0 truncate font-semibold">
                  {tactic.title}
                </span>
                <span className="shrink-0 rounded-full bg-cyan-400/10 px-2 py-0.5 text-xs font-bold text-cyan-200">
                  +{tactic.points}
                </span>
              </span>
              <span className="grid gap-2 sm:grid-cols-2">
                {[
                  { label: resolvedHomeId ? teamName(resolvedHomeId) : "Local", teamId: resolvedHomeId },
                  { label: resolvedAwayId ? teamName(resolvedAwayId) : "Visitante", teamId: resolvedAwayId },
                ].map((option) => (
                  <span
                    key={option.label}
                    className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={isTrainerTacticChecked(tactic.id, option.teamId)}
                      disabled={!option.teamId}
                      onChange={(event) =>
                        toggleTrainerTacticTeam(
                          tactic.id,
                          option.teamId,
                          event.target.checked,
                        )
                      }
                      className="h-4 w-4 accent-cyan-400"
                    />
                    <span className="min-w-0 truncate">{option.label}</span>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>

      {homeCount || awayCount ? (
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold text-white">Goleadores</h4>
            <p className="text-sm text-slate-400">
              Un hueco por gol según el marcador. Marca «Penalti» si fue de
              penalti o «P.p.» si fue en propia puerta (entonces el goleador
              puede ser de cualquiera de los dos equipos y no suma puntos).
            </p>
          </div>
          {homeCount
            ? goalSlots("home", resolvedHomeId, homeCount, homeGoals)
            : null}
          {awayCount
            ? goalSlots("away", resolvedAwayId, awayCount, awayGoals)
            : null}
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          Indica el marcador y aparecerá un hueco por cada gol para asignar el
          goleador.
        </p>
      )}

      <div className="space-y-2">
        <h4 className="flex items-center gap-2 font-semibold text-white">
          <span aria-hidden>⭐</span>
          MVP del partido
        </h4>
        <div className="flex">
          {playerButton(mvpPlayerId, "Sin MVP elegido", { kind: "mvp" })}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h4 className="font-semibold text-white">Otros eventos</h4>
          <p className="text-sm text-slate-400">
            Penaltis fallados o parados y tarjetas rojas.
          </p>
        </div>
        {extras.map((row, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            {playerButton(row.playerId, "Elige jugador", {
              kind: "extra",
              index,
            })}
            <div className="flex items-center gap-2">
              <select
                value={row.type}
                onChange={(event) =>
                  updateExtra(index, { type: event.target.value })
                }
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white sm:flex-none"
              >
                <option value="">Tipo</option>
                {extraEventOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                value={row.minute}
                onChange={(event) =>
                  updateExtra(index, {
                    minute: event.target.value.replace(/\D/g, ""),
                  })
                }
                placeholder="Min"
                inputMode="numeric"
                className="w-20 shrink-0 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
              />
              <button
                type="button"
                onClick={() =>
                  setExtras((current) => current.filter((_, i) => i !== index))
                }
                className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white"
              >
                Quitar
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setExtras((current) => [
              ...current,
              { playerId: "", type: "", minute: "" },
            ])
          }
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-white"
        >
          + Añadir evento
        </button>
      </div>

      {isShootoutMatch ? (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 className="font-semibold text-white">Tanda de penaltis</h4>
              <p className="text-sm text-slate-400">
                El marcador principal se queda en {homeScore}-{awayScore}. La
                tanda decide el ganador del cruce y suma penaltis marcados,
                fallados y parados al once.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1 text-sm font-bold text-zinc-200">
              ({shootoutHomeScore}-{shootoutAwayScore})
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              {
                teamId: resolvedHomeId,
                label: resolvedHomeId ? teamName(resolvedHomeId) : "Local",
              },
              {
                teamId: resolvedAwayId,
                label: resolvedAwayId ? teamName(resolvedAwayId) : "Visitante",
              },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                disabled={!option.teamId}
                onClick={() => addShootoutAttempt(option.teamId)}
                className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                + Penalti {option.label}
              </button>
            ))}
          </div>

          {visibleShootoutAttempts.length ? (
            <div className="space-y-2">
              {visibleShootoutAttempts.map((attempt, index) => {
                const keeperTeamId = opposingTeamId(attempt.teamId);
                return (
                  <div
                    key={attempt.id}
                    className="space-y-2 rounded-2xl border border-white/10 bg-slate-950/45 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-200">
                        <TeamFlag
                          teamId={attempt.teamId}
                          className="h-4 w-5 shrink-0 rounded-sm"
                        />
                        <span className="min-w-0 truncate">
                          Penalti {index + 1} -{" "}
                          {attempt.teamId
                            ? teamName(attempt.teamId)
                            : "Equipo"}
                        </span>
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setShootoutAttempts((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                        className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white"
                      >
                        Quitar
                      </button>
                    </div>
                    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
                      {playerButton(attempt.shooterId, "Elige lanzador", {
                        kind: "shootoutShooter",
                        index,
                      })}
                      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60 text-xs font-bold">
                        <button
                          type="button"
                          aria-pressed={attempt.scored}
                          onClick={() =>
                            updateShootoutAttempt(index, { scored: true })
                          }
                          className={`px-3 py-2 transition ${
                            attempt.scored
                              ? "bg-emerald-400 text-black"
                              : "text-slate-300 hover:bg-white/10"
                          }`}
                        >
                          Marcado
                        </button>
                        <button
                          type="button"
                          aria-pressed={!attempt.scored}
                          onClick={() =>
                            updateShootoutAttempt(index, { scored: false })
                          }
                          className={`px-3 py-2 transition ${
                            !attempt.scored
                              ? "bg-rose-300 text-black"
                              : "text-slate-300 hover:bg-white/10"
                          }`}
                        >
                          Fallado
                        </button>
                      </div>
                      {attempt.scored ? (
                        <span className="hidden text-xs text-slate-500 lg:block">
                          Gol de tanda
                        </span>
                      ) : (
                        <div className="flex min-w-0 flex-col gap-2">
                          {playerButton(
                            attempt.goalkeeperId,
                            keeperTeamId
                              ? `Sin parada / portero de ${teamName(keeperTeamId)}`
                              : "Sin parada / portero que lo para",
                            { kind: "shootoutGoalkeeper", index },
                          )}
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span
                              className={`rounded-full border px-2 py-1 font-semibold ${
                                attempt.goalkeeperId
                                  ? "border-sky-300/30 bg-sky-300/10 text-sky-100"
                                  : "border-amber-300/30 bg-amber-300/10 text-amber-100"
                              }`}
                            >
                              {attempt.goalkeeperId
                                ? "Parada del portero"
                                : "Fallo sin parada"}
                            </span>
                            {attempt.goalkeeperId ? (
                              <button
                                type="button"
                                onClick={() =>
                                  updateShootoutAttempt(index, {
                                    goalkeeperId: "",
                                  })
                                }
                                className="rounded-full border border-white/15 px-2 py-1 font-semibold text-slate-200 transition hover:bg-white/10"
                              >
                                Marcar sin parada
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              Agrega los lanzamientos de la tanda en orden.
            </p>
          )}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-black disabled:opacity-60 sm:w-auto"
      >
        {saving ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/25 border-t-black" />
        ) : null}
        {saving ? "Guardando…" : "Guardar partido y recalcular"}
      </button>

      {pickerTarget ? (
        <PlayerSearchModal
          title={pickerTitle}
          currentPlayer={playersById.get(pickerPlayerId)}
          initialPosition={pickerInitialPosition}
          teamIds={pickerTeamIds}
          onClose={() => setPickerTarget(null)}
          onRemove={() => {
            setPickerPlayerId("");
            setPickerTarget(null);
          }}
          onSelect={(playerId) => {
            setPickerPlayerId(playerId);
            setPickerTarget(null);
          }}
        />
      ) : null}
    </form>
  );
}

function ProviderFlag({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm ${active ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/5 text-slate-300"}`}
    >
      {label}: {active ? "sí" : "no"}
    </div>
  );
}

function ProviderList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <h4 className="font-semibold text-white">{title}</h4>
      <div className="mt-3 space-y-2 text-sm text-slate-300">
        {items.length ? (
          items.map((item) => <p key={item}>{item}</p>)
        ) : (
          <p className="text-slate-400">Sin datos.</p>
        )}
      </div>
    </div>
  );
}

function matchSideName(value: string, resolvedTeamId = "") {
  return (
    (resolvedTeamId && teamsById.get(resolvedTeamId)?.name) ||
    teamsById.get(value)?.name ||
    translateSlot(value)
  );
}
