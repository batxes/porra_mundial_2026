"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";

import {
  Avatar,
  Card,
  EmptyState,
  hasFinishedScore,
  PlayerAvatar,
  ProBadge,
  TeamFlag,
  WolfBadge,
} from "@/components/common";
import { isFinishedResult } from "@/components/results-recap";
import { playersById, schedule, teamsById } from "@/lib/data";
import { translateSlot } from "@/lib/format";
import type {
  AdminResult,
  AdminResults,
  Player,
  UserProfile,
} from "@/lib/types";

// El color marca QUIÉN VA GANANDO el duelo, no la posición: el líder siempre va
// en verde lima y el otro en gris neutro, de forma coherente en toda la vista.
// Así nunca se ve un "color de perdedor" ganando. El rojo se reserva para puntos
// NEGATIVOS, que sí deben leerse como algo malo.
const WINNER = "#a7f600";
const LOSER = "#aab3c0";
const NEGATIVE = "#fda4af";
const NEUTRAL = "#a1a1aa";

const CATEGORY_ORDER = [
  "Marcadores",
  "Tu once",
  "Grupos y cuadro",
  "Tus elecciones",
];

const shortDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

// "11 de junio": día y mes, sin día de la semana ni año (que ya se sabe).
const dayMonthFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

type Match = (typeof schedule)[number];
type FinishedJornada = { date: string; matches: Match[] };
type Side = "a" | "b";

function shortDate(date: string) {
  return shortDateFormatter
    .format(new Date(`${date}T12:00:00Z`))
    .replace(".", "");
}

function dayMonth(date: string) {
  return dayMonthFormatter.format(new Date(`${date}T12:00:00Z`));
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function signed(points: number) {
  return points > 0 ? `+${points}` : String(points);
}

function displayName(profile: UserProfile, currentUserId?: string) {
  return profile.id === currentUserId ? "Tú" : profile.name;
}

// El bando que lidera el duelo se propaga por contexto para que cada widget
// pinte al líder en verde y al otro en gris sin pasar props por todos lados.
const DuelLeaderContext = createContext<Side | null>(null);

// Color de un bando según quién lidera. Sin líder (empate o aún sin rival) se
// usa el reparto base A=verde / B=gris para no dejar la cabecera apagada.
function colorForSide(side: Side, leader: Side | null) {
  if (leader == null) return side === "a" ? WINNER : LOSER;
  return side === leader ? WINNER : LOSER;
}

function useColorFor() {
  const leader = useContext(DuelLeaderContext);
  return (side: Side) => colorForSide(side, leader);
}

// Las variables CSS (--vs-i, --vs-leader) no entran en el tipo CSSProperties de
// React, así que se castean por aquí para mantener limpios los call sites.
function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as unknown as CSSProperties;
}

// Mapa evento -> jugador, para atribuir los puntos de "Tu once" a cada
// futbolista (mismo criterio que el feed de jornadas del perfil).
function buildEventPlayerMap(results: AdminResults) {
  const map = new Map<string, string>();
  Object.values(results).forEach((result) => {
    (result?.events || []).forEach((event) => {
      if (event.id && event.playerId) map.set(event.id, event.playerId);
    });
  });
  return map;
}

// Puntos por número de partido. Los bonus de grupos/torneo van con matchNumber
// null y no se cuentan aquí: viven en categorías y elecciones.
function pointsByMatch(profile: UserProfile) {
  const map = new Map<number, number>();
  profile.scorecard.entries.forEach((entry) => {
    if (entry.matchNumber == null) return;
    map.set(
      entry.matchNumber,
      (map.get(entry.matchNumber) || 0) + entry.points,
    );
  });
  return map;
}

// Futbolistas del once por puntos aportados (gol, MVP, penaltis, rojas...).
function onceScorers(profile: UserProfile, eventPlayer: Map<string, string>) {
  const byPlayer = new Map<string, number>();
  profile.scorecard.entries.forEach((entry) => {
    if (!entry.ruleCode.startsWith("player_")) return;
    const playerId = eventPlayer.get(entry.sourceRef);
    if (!playerId) return;
    byPlayer.set(playerId, (byPlayer.get(playerId) || 0) + entry.points);
  });
  return [...byPlayer.entries()]
    .map(([id, points]) => ({ player: playersById.get(id), points }))
    .filter((row): row is { player: Player; points: number } =>
      Boolean(row.player),
    )
    .sort((a, b) => b.points - a.points);
}

function categoryTotals(profile: UserProfile) {
  const map = new Map<string, number>();
  profile.scorecard.categories.forEach((cat) => map.set(cat.label, cat.total));
  return map;
}

// Jornadas (fechas) con algún partido terminado, de la más reciente a la más
// antigua, con sus partidos. Mismo criterio que el feed del perfil.
function finishedJornadas(results: AdminResults): FinishedJornada[] {
  const byDate = new Map<string, Match[]>();
  schedule.forEach((match) => {
    const result = results[String(match.number)];
    if (!result || !isFinishedResult(result) || !hasFinishedScore(result)) {
      return;
    }
    const list = byDate.get(match.date) || [];
    list.push(match);
    byDate.set(match.date, list);
  });
  return [...byDate.entries()]
    .map(([date, matches]) => ({
      date,
      matches: matches.sort((a, b) => a.number - b.number),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function rankIn(pool: UserProfile[], profile: UserProfile) {
  return pool.filter((other) => other.points > profile.points).length + 1;
}

// Selección por defecto: tú a la izquierda (si juegas en este grupo) y el
// segundo hueco vacío para invitar a elegir rival.
function defaultDuel(sorted: UserProfile[], currentUserId?: string) {
  const aId =
    currentUserId && sorted.some((profile) => profile.id === currentUserId)
      ? currentUserId
      : (sorted[0]?.id ?? "");
  return { aId, bId: "" };
}

export function LeaderboardVersus({
  leaderboard,
  adminResults,
  currentUserId,
}: {
  leaderboard: UserProfile[];
  adminResults: AdminResults;
  currentUserId?: string;
}) {
  const sortedPool = useMemo(
    () =>
      [...leaderboard].sort(
        (a, b) => b.points - a.points || a.name.localeCompare(b.name),
      ),
    [leaderboard],
  );

  const initial = useMemo(
    () => defaultDuel(sortedPool, currentUserId),
    [sortedPool, currentUserId],
  );
  const [aId, setAId] = useState(initial.aId);
  const [bId, setBId] = useState(initial.bId);

  const resolvedAId =
    aId && sortedPool.some((profile) => profile.id === aId) ? aId : initial.aId;
  const resolvedBId =
    bId &&
    bId !== resolvedAId &&
    sortedPool.some((profile) => profile.id === bId)
      ? bId
      : "";
  const profileA =
    sortedPool.find((profile) => profile.id === resolvedAId) ||
    sortedPool[0] ||
    null;
  const profileB =
    sortedPool.find((profile) => profile.id === resolvedBId) || null;

  const eventPlayer = useMemo(
    () => buildEventPlayerMap(adminResults),
    [adminResults],
  );
  const jornadasRaw = useMemo(
    () => finishedJornadas(adminResults),
    [adminResults],
  );

  const model = useMemo(() => {
    if (!profileA || !profileB) return null;
    const mapA = pointsByMatch(profileA);
    const mapB = pointsByMatch(profileB);

    const jornadas = jornadasRaw.map((jornada) => {
      const totalA = jornada.matches.reduce(
        (sum, match) => sum + (mapA.get(match.number) || 0),
        0,
      );
      const totalB = jornada.matches.reduce(
        (sum, match) => sum + (mapB.get(match.number) || 0),
        0,
      );
      return { ...jornada, totalA, totalB };
    });

    const balance = jornadas.reduce(
      (acc, jornada) => {
        if (jornada.totalA > jornada.totalB) acc.a += 1;
        else if (jornada.totalB > jornada.totalA) acc.b += 1;
        else acc.tie += 1;
        return acc;
      },
      { a: 0, b: 0, tie: 0 },
    );

    const catA = categoryTotals(profileA);
    const catB = categoryTotals(profileB);
    const labelSet = new Set([...catA.keys(), ...catB.keys()]);
    const labels = [
      ...CATEGORY_ORDER.filter((label) => labelSet.has(label)),
      ...[...labelSet].filter((label) => !CATEGORY_ORDER.includes(label)),
    ];
    const categories = labels
      .map((label) => ({
        label,
        a: catA.get(label) || 0,
        b: catB.get(label) || 0,
      }))
      .filter((row) => row.a !== 0 || row.b !== 0);

    const onceA = onceScorers(profileA, eventPlayer).slice(0, 5);
    const onceB = onceScorers(profileB, eventPlayer).slice(0, 5);

    const extrasA = profileA.prediction?.extras;
    const extrasB = profileB.prediction?.extras;
    const elections = [
      {
        label: "Campeón",
        short: "Campeón",
        kind: "team" as const,
        a: extrasA?.worldChampion,
        b: extrasB?.worldChampion,
      },
      {
        label: "Máximo goleador",
        short: "Goleador",
        kind: "player" as const,
        a: extrasA?.topScorer,
        b: extrasB?.topScorer,
      },
      {
        label: "MVP",
        short: "MVP",
        kind: "player" as const,
        a: extrasA?.mvp,
        b: extrasB?.mvp,
      },
      {
        label: "Equipo más goleador",
        short: "Más goleador",
        kind: "team" as const,
        a: extrasA?.highestScoringTeam,
        b: extrasB?.highestScoringTeam,
      },
      {
        label: "Equipo más goleado",
        short: "Más goleado",
        kind: "team" as const,
        a: extrasA?.mostConcededTeam,
        b: extrasB?.mostConcededTeam,
      },
      {
        label: "Equipo con más rojas",
        short: "Más rojas",
        kind: "team" as const,
        a: extrasA?.mostRedsTeam,
        b: extrasB?.mostRedsTeam,
      },
    ];

    const xiA = new Set(profileA.prediction?.xi || []);
    const commonXi = (profileB.prediction?.xi || [])
      .filter((id) => xiA.has(id))
      .map((id) => playersById.get(id))
      .filter((player): player is Player => Boolean(player));

    return {
      mapA,
      mapB,
      jornadas,
      balance,
      categories,
      onceA,
      onceB,
      elections,
      commonXi,
    };
  }, [profileA, profileB, jornadasRaw, eventPlayer]);

  if (sortedPool.length < 2 || !profileA) {
    return (
      <EmptyState
        icon="2"
        title="Necesitas al menos dos participantes"
        description="El cara a cara compara a dos participantes de esta clasificación. Cuando haya al menos dos, podrás enfrentarlos aquí."
      />
    );
  }

  const rankA = rankIn(sortedPool, profileA);
  const rankB = profileB ? rankIn(sortedPool, profileB) : null;
  const diff = profileB ? profileA.points - profileB.points : 0;
  const leaderSide: Side | null = profileB
    ? diff === 0
      ? null
      : diff > 0
        ? "a"
        : "b"
    : null;
  const hasDuel = Boolean(profileB && model && rankB != null);
  // El resplandor del hero sigue al color de cada bando (verde el que gana, gris
  // el otro): nunca un tono que despiste. El sufijo hex es la opacidad.
  const glowA = colorForSide("a", leaderSide);
  const glowB = colorForSide("b", leaderSide);

  return (
    <DuelLeaderContext.Provider value={leaderSide}>
      <div className="space-y-4">
      <section className="relative rounded-2xl border border-white/10 bg-[#101010] p-3 shadow-2xl shadow-black/30 sm:p-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
        >
          <div
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage: `linear-gradient(90deg, transparent, ${glowA}99, rgba(255,255,255,0.25), ${glowB}99, transparent)`,
            }}
          />
          <div
            className="absolute inset-x-0 top-0 h-40"
            style={{
              backgroundImage: `radial-gradient(60% 90% at 22% 0%, ${glowA}2e, transparent 70%), radial-gradient(60% 90% at 78% 0%, ${glowB}2e, transparent 70%)`,
            }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_0%,rgba(255,255,255,0.035)_48%,transparent_68%)]" />
        </div>

        <div className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2 sm:gap-4">
          <ParticipantPicker
            pool={sortedPool}
            value={profileA}
            disabledId={profileB?.id}
            side="a"
            rank={rankA}
            isLeader={leaderSide === "a"}
            currentUserId={currentUserId}
            onChange={setAId}
          />
          {hasDuel && rankB != null && profileB ? (
            <DuelCenter
              diff={diff}
              leaderSide={leaderSide}
              rankA={rankA}
              rankB={rankB}
              pointsA={profileA.points}
              pointsB={profileB.points}
            />
          ) : (
            <DuelPendingCenter />
          )}
          <ParticipantPicker
            pool={sortedPool}
            value={profileB}
            disabledId={profileA.id}
            side="b"
            rank={rankB ?? undefined}
            isLeader={leaderSide === "b"}
            placeholder="Añadir rival"
            currentUserId={currentUserId}
            onChange={setBId}
          />
        </div>
      </section>

      {hasDuel && profileB && model && rankB != null ? (
        <div key={profileB.id} className="space-y-4">
          {/* Arriba, dos columnas que se igualan en altura: la última tarjeta de
              cada una crece (flex-1) para que ambas terminen a la misma línea. */}
          <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
            <div className="flex flex-col gap-4">
              <div className="vs-card-in" style={cssVars({ "--vs-i": 0 })}>
                <CategoryBattle categories={model.categories} />
              </div>
              <div
                className="vs-card-in flex flex-1"
                style={cssVars({ "--vs-i": 1 })}
              >
                <LineupBattle
                  nameA={displayName(profileA, currentUserId)}
                  nameB={displayName(profileB, currentUserId)}
                  onceA={model.onceA}
                  onceB={model.onceB}
                  commonXi={model.commonXi}
                />
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="vs-card-in" style={cssVars({ "--vs-i": 1 })}>
                <DuelMomentum
                  jornadas={model.jornadas}
                  nameA={displayName(profileA, currentUserId)}
                  nameB={displayName(profileB, currentUserId)}
                />
              </div>
              <div
                className="vs-card-in flex flex-1"
                style={cssVars({ "--vs-i": 2 })}
              >
                <ElectionsBattle elections={model.elections} />
              </div>
            </div>
          </div>

          {/* Jornada a jornada a todo el ancho */}
          <div className="vs-card-in" style={cssVars({ "--vs-i": 3 })}>
            <JornadasBattle
              jornadas={model.jornadas}
              balance={model.balance}
              mapA={model.mapA}
              mapB={model.mapB}
              results={adminResults}
            />
          </div>
        </div>
      ) : (
        <PendingComparisonCard />
      )}
      </div>
    </DuelLeaderContext.Provider>
  );
}

function DuelCenter({
  diff,
  leaderSide,
  rankA,
  rankB,
  pointsA,
  pointsB,
}: {
  diff: number;
  leaderSide: Side | null;
  rankA: number;
  rankB: number;
  pointsA: number;
  pointsB: number;
}) {
  const color = leaderSide ? WINNER : NEUTRAL;
  const rankGap = Math.abs(rankA - rankB);
  const total = Math.max(pointsA + pointsB, 1);
  const shareA = Math.max(0, Math.min(100, (pointsA / total) * 100));

  return (
    <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-2 sm:w-24">
      <span
        className="flex size-12 items-center justify-center rounded-full border bg-black/40 text-sm font-bold tracking-[0.16em] text-white shadow-lg shadow-black/30 sm:size-16 sm:text-base"
        style={{
          borderColor: `${color}66`,
          boxShadow: `0 0 0 4px ${color}14, 0 8px 20px rgba(0,0,0,0.4)`,
        }}
      >
        VS
      </span>
      <span className="text-center text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
        {diff === 0 ? "Empate" : "Ventaja"}
      </span>
      <span
        key={diff}
        className="vs-pop rounded-full border px-2 py-1 text-sm font-bold leading-none tabular-nums"
        style={{
          borderColor: `${color}55`,
          backgroundColor: `${color}18`,
          color,
        }}
      >
        {diff === 0 ? "0" : `+${Math.abs(diff)}`}
      </span>
      <span className="hidden text-center text-[10px] font-bold leading-3 text-zinc-500 sm:block">
        {rankGap === 0
          ? "Mismo puesto"
          : `${rankGap} ${rankGap === 1 ? "puesto" : "puestos"}`}
      </span>
      <div className="hidden h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08] sm:flex">
        <span
          className="h-full motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-out"
          style={{
            width: `${shareA}%`,
            backgroundColor: colorForSide("a", leaderSide),
          }}
        />
        <span
          className="h-full flex-1"
          style={{ backgroundColor: colorForSide("b", leaderSide) }}
        />
      </div>
    </div>
  );
}

function DuelPendingCenter() {
  return (
    <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-2 sm:w-24">
      <span className="flex size-12 items-center justify-center rounded-full border border-white/12 bg-black/35 text-sm font-bold tracking-[0.16em] text-white shadow-lg shadow-black/30 sm:size-16 sm:text-base">
        VS
      </span>
      <span className="text-center text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
        Pendiente
      </span>
      <span className="flex size-8 items-center justify-center rounded-full border border-zinc-500/40 bg-zinc-500/10 text-lg font-bold leading-none text-zinc-400">
        +
      </span>
    </div>
  );
}

function PendingComparisonCard() {
  return (
    <Card className="relative overflow-hidden rounded-2xl border-dashed border-white/10 bg-[#101010]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_88%_0%,rgba(255,255,255,0.05),transparent_65%),linear-gradient(115deg,transparent_0%,rgba(255,255,255,0.03)_50%,transparent_72%)]"
      />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-zinc-500/40 bg-zinc-500/10 text-xl font-bold leading-none text-zinc-400">
          +
        </span>
        <div className="min-w-0">
          <SectionKicker title="Rival pendiente" />
          <h3 className="mt-2 text-base font-bold text-white">
            Añade un participante para abrir el cara a cara
          </h3>
          <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-zinc-400">
            El hueco derecho guarda la comparación hasta que elijas a alguien de
            la clasificación.
          </p>
        </div>
      </div>
    </Card>
  );
}

function SectionKicker({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white">
        {title}
      </p>
      {right}
    </div>
  );
}

// Grafico de momentum: ventaja de puntos ACUMULADA jornada a jornada. El
// territorio del que va GANANDO el duelo se pinta en verde y el del otro en
// gris. El trazo se dibuja con stroke-dashoffset (respeta prefers-reduced-motion).
function DuelMomentum({
  jornadas,
  nameA,
  nameB,
}: {
  jornadas: Array<FinishedJornada & { totalA: number; totalB: number }>;
  nameA: string;
  nameB: string;
}) {
  const colorFor = useColorFor();
  const chrono = [...jornadas].reverse();

  if (chrono.length < 2) {
    return (
      <Card className="rounded-2xl">
        <SectionKicker title="Momentum del duelo" />
        <p className="mt-3 rounded-xl border border-dashed border-white/10 bg-black/15 px-3 py-6 text-center text-sm text-zinc-500">
          El momentum aparece cuando hay al menos dos jornadas con resultados.
        </p>
      </Card>
    );
  }

  const series: { cum: number }[] = [{ cum: 0 }];
  chrono.forEach((jornada) => {
    series.push({
      cum: series[series.length - 1].cum + jornada.totalA - jornada.totalB,
    });
  });
  const finalDiff = series[series.length - 1].cum;
  const lead: Side | null = finalDiff === 0 ? null : finalDiff > 0 ? "a" : "b";
  const leadColor = lead ? colorFor(lead) : NEUTRAL;

  const W = 320;
  const H = 132;
  const padX = 10;
  const padTop = 12;
  const padBottom = 18;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const peak = Math.max(1, ...series.map((point) => Math.abs(point.cum)));
  const n = series.length;
  const x = (i: number) => padX + (innerW * i) / (n - 1);
  const y = (v: number) => padTop + innerH / 2 - (v / peak) * (innerH / 2);
  const zeroY = y(0);

  const pts = series.map((point, i) => ({ x: x(i), y: y(point.cum) }));
  const linePath = pts
    .map(
      (pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`,
    )
    .join(" ");
  const areaPath = `${linePath} L${pts[n - 1].x.toFixed(1)} ${zeroY.toFixed(1)} L${pts[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`;

  // Cruces por cero (cambio de dominador) para marcarlos.
  const crossings: number[] = [];
  for (let i = 0; i < series.length - 1; i += 1) {
    const c0 = series[i].cum;
    const c1 = series[i + 1].cum;
    if (c0 === 0 || c1 === 0 || c0 * c1 >= 0) continue;
    const t = Math.abs(c0) / (Math.abs(c0) + Math.abs(c1));
    crossings.push(x(i) + (x(i + 1) - x(i)) * t);
  }

  const last = pts[n - 1];
  const ariaLabel =
    lead === null
      ? `Momentum del duelo entre ${nameA} y ${nameB}: empate en puntos acumulados.`
      : `Momentum del duelo entre ${nameA} y ${nameB}: ${
          lead === "a" ? nameA : nameB
        } domina por ${Math.abs(finalDiff)} puntos acumulados.`;

  return (
    <Card className="rounded-2xl">
      <SectionKicker
        title="Momentum del duelo"
        right={
          <span
            className="text-xs font-bold tabular-nums"
            style={{ color: leadColor }}
          >
            {finalDiff === 0 ? "Empate" : `+${Math.abs(finalDiff)} acumulados`}
          </span>
        }
      />
      <p className="mt-1 text-[11px] font-medium text-zinc-500">
        Ventaja de puntos acumulada jornada a jornada.
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-3 h-32 w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient id="duel-momentum-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorFor("a")} stopOpacity="0.42" />
            <stop offset="48%" stopColor={colorFor("a")} stopOpacity="0.06" />
            <stop offset="52%" stopColor={colorFor("b")} stopOpacity="0.06" />
            <stop offset="100%" stopColor={colorFor("b")} stopOpacity="0.42" />
          </linearGradient>
        </defs>
        <rect
          x={padX}
          y={padTop}
          width={innerW}
          height={zeroY - padTop}
          fill={colorFor("a")}
          opacity={0.04}
        />
        <rect
          x={padX}
          y={zeroY}
          width={innerW}
          height={padTop + innerH - zeroY}
          fill={colorFor("b")}
          opacity={0.04}
        />
        <line
          x1={padX}
          y1={zeroY}
          x2={W - padX}
          y2={zeroY}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={1}
          strokeDasharray="3 4"
        />
        <path d={areaPath} fill="url(#duel-momentum-grad)" />
        <path
          className="duel-momentum-draw"
          d={linePath}
          fill="none"
          stroke={leadColor}
          strokeWidth={2.4}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
        />
        {crossings.map((cx, i) => (
          <circle
            key={i}
            cx={cx}
            cy={zeroY}
            r={2.2}
            fill="#fff"
            opacity={0.5}
          />
        ))}
        <circle
          cx={last.x}
          cy={last.y}
          r={4.5}
          fill={leadColor}
          opacity={0.25}
        />
        <circle cx={last.x} cy={last.y} r={2.6} fill={leadColor} />
      </svg>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-semibold text-zinc-500">
        <span className="shrink-0">{shortDate(chrono[0].date)}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 items-center gap-1">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: colorFor("a") }}
            />
            <span className="max-w-[4.5rem] truncate text-zinc-400">
              {nameA}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: colorFor("b") }}
            />
            <span className="max-w-[4.5rem] truncate text-zinc-400">
              {nameB}
            </span>
          </span>
        </span>
        <span className="shrink-0">
          {shortDate(chrono[chrono.length - 1].date)}
        </span>
      </div>
    </Card>
  );
}

function CategoryBattle({
  categories,
}: {
  categories: { label: string; a: number; b: number }[];
}) {
  return (
    <Card className="rounded-2xl">
      <SectionKicker title="Dónde gana cada uno" />
      <div className="mt-3 space-y-3">
        {categories.length ? (
          categories.map((category) => (
            <CategoryRow key={category.label} {...category} />
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 bg-black/15 px-3 py-6 text-center text-sm text-zinc-500">
            Todavía no hay puntos por categoría.
          </p>
        )}
      </div>
    </Card>
  );
}

function CategoryRow({ label, a, b }: { label: string; a: number; b: number }) {
  const colorFor = useColorFor();
  const cA = colorFor("a");
  const cB = colorFor("b");
  const max = Math.max(Math.abs(a), Math.abs(b), 1);
  const aTarget =
    a === 0 ? "0%" : `${Math.max(10, (Math.abs(a) / max) * 100)}%`;
  const bTarget =
    b === 0 ? "0%" : `${Math.max(10, (Math.abs(b) / max) * 100)}%`;
  const winner: Side | null = a === b ? null : a > b ? "a" : "b";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
      <div className="mb-2 grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
        <span
          className="flex items-center gap-1 font-bold tabular-nums"
          style={{
            color: a < 0 ? NEGATIVE : cA,
            opacity: winner === "b" ? 0.55 : 1,
          }}
        >
          {winner === "a" ? (
            <span
              className="size-1.5 rounded-full"
              style={{ background: cA }}
            />
          ) : null}
          {signed(a)}
        </span>
        <span className="truncate text-center font-semibold text-zinc-400">
          {label}
        </span>
        <span
          className="flex items-center justify-end gap-1 text-right font-bold tabular-nums"
          style={{
            color: b < 0 ? NEGATIVE : cB,
            opacity: winner === "a" ? 0.55 : 1,
          }}
        >
          {signed(b)}
          {winner === "b" ? (
            <span
              className="size-1.5 rounded-full"
              style={{ background: cB }}
            />
          ) : null}
        </span>
      </div>
      <div className="relative grid h-2.5 grid-cols-2 overflow-hidden rounded-full bg-white/[0.05]">
        <div className="flex justify-end pr-px">
          {a !== 0 ? (
            <span
              className="block h-full rounded-l-full motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                width: mounted ? aTarget : "0%",
                backgroundColor: a < 0 ? NEGATIVE : cA,
                boxShadow:
                  winner === "a" ? `0 0 0 1px ${cA}, 0 0 8px ${cA}66` : "none",
                opacity: winner === "b" ? 0.4 : 1,
              }}
            />
          ) : null}
        </div>
        <div className="flex justify-start pl-px">
          {b !== 0 ? (
            <span
              className="block h-full rounded-r-full motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                width: mounted ? bTarget : "0%",
                backgroundColor: b < 0 ? NEGATIVE : cB,
                boxShadow:
                  winner === "b" ? `0 0 0 1px ${cB}, 0 0 8px ${cB}66` : "none",
                opacity: winner === "a" ? 0.4 : 1,
              }}
            />
          ) : null}
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-3.5 w-px -translate-x-1/2 -translate-y-1/2 bg-white/25"
        />
      </div>
    </div>
  );
}

function LineupBattle({
  nameA,
  nameB,
  onceA,
  onceB,
  commonXi,
}: {
  nameA: string;
  nameB: string;
  onceA: { player: Player; points: number }[];
  onceB: { player: Player; points: number }[];
  commonXi: Player[];
}) {
  return (
    <Card className="flex w-full flex-col rounded-2xl">
      <SectionKicker
        title="Once que está sumando"
        right={
          <span className="text-xs font-bold text-zinc-500">
            {commonXi.length} en común
          </span>
        }
      />
      <div className="mt-3 grid flex-1 gap-3 sm:grid-cols-2">
        <OnceColumn name={nameA} rows={onceA} side="a" />
        <OnceColumn name={nameB} rows={onceB} side="b" />
      </div>
      <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5">
        {commonXi.length ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="flex -space-x-2">
              {commonXi.slice(0, 8).map((player) => (
                <PlayerAvatar
                  key={player.id}
                  player={player}
                  className="size-7! text-[8px]! ring-2 ring-[#121212]"
                />
              ))}
            </span>
            <span className="text-xs font-semibold text-zinc-300">
              {commonXi.length}{" "}
              {commonXi.length === 1
                ? "jugador repetido en el once"
                : "jugadores repetidos en el once"}
            </span>
          </div>
        ) : (
          <p className="text-center text-xs font-semibold text-zinc-500">
            Sin jugadores repetidos en el once.
          </p>
        )}
      </div>
    </Card>
  );
}

function OnceColumn({
  name,
  rows,
  side,
}: {
  name: string;
  rows: { player: Player; points: number }[];
  side: Side;
}) {
  const colorFor = useColorFor();
  const color = colorFor(side);

  return (
    <div className="h-full rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color }}
        />
        <span className="min-w-0 truncate text-xs font-bold text-white">
          {name}
        </span>
      </div>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map(({ player, points }, i) => (
            <div
              key={player.id}
              className="vs-card-in flex items-center gap-2"
              style={cssVars({ "--vs-i": i + 3 })}
            >
              <PlayerAvatar player={player} className="size-8! text-[8px]" />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
                {player.name}
              </span>
              <span
                className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums"
                style={{
                  backgroundColor: `${points >= 0 ? color : NEGATIVE}20`,
                  color: points >= 0 ? color : NEGATIVE,
                }}
              >
                {signed(points)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-4 text-center text-xs font-medium text-zinc-600">
          Sin puntos del once todavía.
        </p>
      )}
    </div>
  );
}

function ElectionsBattle({
  elections,
}: {
  elections: {
    label: string;
    short: string;
    kind: "team" | "player";
    a?: string;
    b?: string;
  }[];
}) {
  return (
    <Card className="flex w-full flex-col rounded-2xl">
      <SectionKicker title="Vuestras elecciones" />
      <div className="mt-3 flex flex-1 flex-col justify-between gap-2">
        {elections.map((election, index) => (
          <ElectionRow key={election.label} election={election} index={index} />
        ))}
      </div>
    </Card>
  );
}

function ElectionRow({
  election,
  index,
}: {
  election: {
    label: string;
    short: string;
    kind: "team" | "player";
    a?: string;
    b?: string;
  };
  index: number;
}) {
  const matches = Boolean(election.a && election.a === election.b);

  return (
    <div
      className={`vs-card-in grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors duration-300 ${
        matches
          ? "border-[#a7f600]/30 bg-[#a7f600]/10"
          : "border-white/[0.08] bg-white/[0.025]"
      }`}
      style={cssVars({ "--vs-i": index + 3 })}
    >
      <PickBadge kind={election.kind} id={election.a} side="a" />
      <div className="flex min-w-[4.75rem] flex-col items-center text-center">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">
          <span className="sm:hidden">{election.short}</span>
          <span className="hidden sm:inline">{election.label}</span>
        </span>
        {matches ? (
          <span className="mt-0.5 rounded-full bg-[#a7f600]/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#a7f600]">
            Coinciden
          </span>
        ) : null}
      </div>
      <PickBadge kind={election.kind} id={election.b} side="b" align="right" />
    </div>
  );
}

function PickBadge({
  kind,
  id,
  side,
  align = "left",
}: {
  kind: "team" | "player";
  id?: string;
  side: Side;
  align?: "left" | "right";
}) {
  const colorFor = useColorFor();
  const color = colorFor(side);
  const player = kind === "player" && id ? playersById.get(id) || null : null;
  const team = kind === "team" && id ? teamsById.get(id) : null;
  const name = id
    ? kind === "team"
      ? team?.name || translateSlot(id)
      : player?.name || "Jugador"
    : "Pendiente";

  return (
    <span
      className={`flex min-w-0 items-center gap-2 rounded-lg border bg-black/20 px-2 py-1.5 ${
        align === "right" ? "justify-end text-right" : ""
      }`}
      style={{ borderColor: `${color}30` }}
    >
      {align === "right" ? (
        <>
          <span className="min-w-0 truncate text-xs font-semibold text-white">
            {name}
          </span>
          <PickIcon kind={kind} id={id} player={player} side={side} />
        </>
      ) : (
        <>
          <PickIcon kind={kind} id={id} player={player} side={side} />
          <span className="min-w-0 truncate text-xs font-semibold text-white">
            {name}
          </span>
        </>
      )}
    </span>
  );
}

function PickIcon({
  kind,
  id,
  player,
  side,
}: {
  kind: "team" | "player";
  id?: string;
  player: Player | null;
  side: Side;
}) {
  const colorFor = useColorFor();
  const color = colorFor(side);
  if (!id) {
    return (
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold"
        style={{ borderColor: `${color}45`, color }}
      >
        ?
      </span>
    );
  }
  if (kind === "team") {
    return (
      <TeamFlag
        teamId={id}
        className="size-6 shrink-0 rounded-full border border-white/15 object-cover"
      />
    );
  }
  return player ? (
    <PlayerAvatar player={player} className="size-6! text-[8px]" />
  ) : (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold"
      style={{ borderColor: `${color}45`, color }}
    >
      J
    </span>
  );
}

function JornadasBattle({
  jornadas,
  balance,
  mapA,
  mapB,
  results,
}: {
  jornadas: Array<FinishedJornada & { totalA: number; totalB: number }>;
  balance: { a: number; b: number; tie: number };
  mapA: Map<number, number>;
  mapB: Map<number, number>;
  results: AdminResults;
}) {
  const colorFor = useColorFor();
  return (
    <Card className="rounded-2xl">
      <SectionKicker
        title="Jornada a jornada"
        right={
          jornadas.length ? (
            <span className="flex items-center gap-1 text-xs font-bold tabular-nums">
              <span style={{ color: colorFor("a") }}>{balance.a}</span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-400">{balance.tie}</span>
              <span className="text-zinc-600">·</span>
              <span style={{ color: colorFor("b") }}>{balance.b}</span>
            </span>
          ) : null
        }
      />
      {jornadas.length ? (
        <>
          <div className="mt-3 space-y-2.5">
            {jornadas.map((jornada, index) => (
              <JornadaCompareCard
                key={jornada.date}
                jornada={jornada}
                mapA={mapA}
                mapB={mapB}
                results={results}
                defaultOpen={index === 0}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-white/10 bg-black/15 px-3 py-6 text-center text-sm text-zinc-500">
          Aún no hay jornadas con resultados.
        </p>
      )}
    </Card>
  );
}

function ParticipantPicker({
  pool,
  value,
  disabledId,
  side,
  rank,
  isLeader = false,
  placeholder = "Añadir participante",
  currentUserId,
  onChange,
}: {
  pool: UserProfile[];
  value: UserProfile | null;
  disabledId?: string;
  side: Side;
  rank?: number;
  isLeader?: boolean;
  placeholder?: string;
  currentUserId?: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const colorFor = useColorFor();
  const color = colorFor(side);

  // El modal se cierra con Escape (además del backdrop y el botón cerrar).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const q = normalize(query.trim());
  const filtered = q
    ? pool.filter((profile) => normalize(profile.name).includes(q))
    : pool;
  const isYou = value?.id === currentUserId;

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={value ? `Elegir participante ${value.name}` : placeholder}
        className={`group relative flex h-full w-full min-w-0 flex-col items-center rounded-xl border px-2 py-3 text-center transition duration-200 hover:border-white/15 hover:bg-white/[0.04] motion-safe:active:scale-[0.99] sm:px-3 ${
          value
            ? "border-white/[0.08] bg-black/25 motion-safe:hover:-translate-y-0.5"
            : "border-dashed border-white/15 bg-white/[0.03]"
        }`}
      >
        {value ? (
          <>
            {/* Acento del bando: barra superior fina (líder verde / rival gris). */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-4 top-0 h-px rounded-full transition-opacity duration-300"
              style={{
                backgroundImage: `linear-gradient(90deg, transparent, ${color}, transparent)`,
                opacity: isLeader ? 0.9 : 0.4,
              }}
            />

            {/* Pista de "tocar para cambiar" en hover/foco del botón (group). */}
            <span
              aria-hidden
              className="pointer-events-none absolute right-2 top-2 flex size-6 items-center justify-center rounded-full border border-white/10 bg-black/40 text-zinc-300 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:scale-90 motion-safe:group-hover:scale-100 motion-safe:group-focus-visible:scale-100"
            >
              <svg
                viewBox="0 0 16 16"
                className="size-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h8l-2-2M13 10H5l2 2" />
              </svg>
            </span>

            {/* Avatar con halo tintado + anillo de color (latido solo en el líder). */}
            <span className="relative flex items-center justify-center">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 rounded-full blur-md transition-opacity duration-300"
                style={{ backgroundColor: color, opacity: isLeader ? 0.3 : 0.12 }}
              />
              <span
                className={`relative rounded-full ${isLeader ? "vs-leader-glow" : ""}`}
                style={cssVars({
                  "--vs-leader": color,
                  boxShadow: isLeader
                    ? `0 0 0 2px ${color}, 0 0 22px ${color}55`
                    : `0 0 0 2px ${color}66`,
                })}
              >
                <Avatar
                  name={value.name}
                  avatarUrl={value.avatarUrl}
                  className="size-14 sm:size-16"
                />
              </span>
            </span>

            <span className="mt-2.5 flex max-w-full items-center justify-center gap-1 text-sm font-bold text-white">
              <span className="truncate">{isYou ? "Tú" : value.name}</span>
              {value.isPro ? <ProBadge /> : null}
              {value.isWolf ? <WolfBadge /> : null}
            </span>

            {/* Puntos = dato héroe; rojo solo si es negativo. key re-dispara vs-pop. */}
            <span
              key={value.points}
              className="vs-pop mt-1.5 flex items-baseline justify-center gap-1 leading-none"
            >
              <span
                className="text-[30px] font-bold tabular-nums tracking-tight sm:text-[34px]"
                style={{
                  color: value.points < 0 ? NEGATIVE : color,
                  textShadow:
                    isLeader && value.points >= 0 ? `0 0 18px ${color}45` : "none",
                }}
              >
                {value.points}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                pts
              </span>
            </span>

            {rank != null ? (
              <span
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors duration-300"
                style={{
                  borderColor: isLeader ? `${color}40` : "rgba(255,255,255,0.08)",
                  backgroundColor: isLeader ? `${color}12` : "rgba(0,0,0,0.2)",
                }}
              >
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                  Global
                </span>
                <span
                  className="text-[11px] font-bold leading-none tabular-nums"
                  style={{ color: isLeader ? color : "#d4d4d8" }}
                >
                  {rank}
                  <span className="align-top text-[8px]">º</span>
                </span>
              </span>
            ) : null}
          </>
        ) : (
          <span className="flex min-h-[8.75rem] flex-col items-center justify-center">
            {/* Mismo acento superior que la rama value, para que casen como cara a cara. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-4 top-0 h-px rounded-full"
              style={{
                backgroundImage: `linear-gradient(90deg, transparent, ${color}, transparent)`,
                opacity: 0.4,
              }}
            />
            <span
              className="flex size-14 items-center justify-center rounded-full border text-2xl font-bold leading-none transition group-hover:scale-105 sm:size-16"
              style={{
                borderColor: `${color}45`,
                backgroundColor: `${color}12`,
                color,
                boxShadow: `0 0 28px ${color}20`,
              }}
            >
              +
            </span>
            <span className="mt-2.5 max-w-full truncate text-sm font-bold text-white">
              {placeholder}
            </span>
            <span className="mt-1 text-[11px] font-bold text-zinc-500">
              Buscar participante
            </span>
          </span>
        )}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label="Elegir participante"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
              setQuery("");
            }
          }}
        >
          <div className="theme-dark flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#151515] shadow-2xl shadow-black/60 motion-safe:animate-[cofre-modal-pop_220ms_cubic-bezier(0.2,0.9,0.3,1)_both]">
            <div className="border-b border-white/10 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-white">
                  Elegir participante
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                  }}
                  aria-label="Cerrar"
                  className="flex size-7 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar participante"
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-base font-medium text-white outline-none placeholder:text-zinc-500"
              />
            </div>
            <div className="team-picker-scroll flex-1 space-y-0.5 overflow-y-auto p-2">
              {filtered.map((profile) => {
                const disabled = Boolean(
                  disabledId && profile.id === disabledId,
                );
                const active = value?.id === profile.id;
                const profileRank = rankIn(pool, profile);
                return (
                  <button
                    key={profile.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onChange(profile.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                      disabled
                        ? "cursor-not-allowed opacity-35"
                        : active
                          ? "bg-white/10"
                          : "hover:bg-white/5"
                    }`}
                  >
                    <Avatar
                      name={profile.name}
                      avatarUrl={profile.avatarUrl}
                      className="size-9"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-white">
                        {profile.id === currentUserId ? "Tú · " : ""}
                        {profile.name}
                      </span>
                      <span className="text-[11px] font-semibold text-zinc-500">
                        {profileRank}º · {profile.points} pts
                      </span>
                    </span>
                    {active ? (
                      <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-zinc-300">
                        Elegido
                      </span>
                    ) : null}
                  </button>
                );
              })}
              {!filtered.length ? (
                <p className="px-2 py-6 text-center text-sm font-medium text-zinc-500">
                  Sin resultados
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function JornadaCompareCard({
  jornada,
  mapA,
  mapB,
  results,
  defaultOpen,
}: {
  jornada: FinishedJornada & { totalA: number; totalB: number };
  mapA: Map<number, number>;
  mapB: Map<number, number>;
  results: AdminResults;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="grid w-full grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 px-3 py-2.5 transition hover:bg-white/[0.03] active:bg-white/[0.05]"
      >
        <MatchPoints points={jornada.totalA} align="start" />
        <span className="flex min-w-0 items-center justify-center gap-1.5">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${
              open ? "rotate-90" : ""
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
          <span className="min-w-0 truncate text-sm font-bold text-white first-letter:capitalize">
            {dayMonth(jornada.date)}
          </span>
        </span>
        <MatchPoints points={jornada.totalB} align="end" />
      </button>

      {open ? (
        <div className="space-y-1.5 border-t border-white/[0.07] p-2.5">
          {jornada.matches.map((match) => {
            const result = results[String(match.number)];
            if (!result) return null;
            return (
              <FeedDuelRow
                key={match.number}
                match={match}
                result={result}
                pointsA={mapA.get(match.number) || 0}
                pointsB={mapB.get(match.number) || 0}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FeedDuelRow({
  match,
  result,
  pointsA,
  pointsB,
}: {
  match: Match;
  result: AdminResult;
  pointsA: number;
  pointsB: number;
}) {
  const homeTeamId =
    result.homeTeamId || (teamsById.has(match.home) ? match.home : "");
  const awayTeamId =
    result.awayTeamId || (teamsById.has(match.away) ? match.away : "");
  const homeName = homeTeamId
    ? teamsById.get(homeTeamId)?.name || translateSlot(match.home)
    : translateSlot(match.home);
  const awayName = awayTeamId
    ? teamsById.get(awayTeamId)?.name || translateSlot(match.away)
    : translateSlot(match.away);

  // Partido en el centro y, a cada lado, lo que sumó cada uno: verde si puntuó,
  // neutro si no, rojo si restó (como el desglose del inicio).
  return (
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 rounded-lg bg-black/20 px-2 py-2">
      <MatchPoints points={pointsA} align="start" />
      <div className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className="flex min-w-0 items-center justify-end gap-1.5">
          <span className="hidden min-w-0 truncate text-xs font-bold text-white sm:block">
            {homeName}
          </span>
          <TeamFlag
            teamId={homeTeamId}
            className="size-5 shrink-0 rounded-full border border-white/15 object-cover"
          />
        </span>
        <span className="shrink-0 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-xs font-bold tabular-nums text-white">
          {result.homeScore}-{result.awayScore}
        </span>
        <span className="flex min-w-0 items-center justify-start gap-1.5">
          <TeamFlag
            teamId={awayTeamId}
            className="size-5 shrink-0 rounded-full border border-white/15 object-cover"
          />
          <span className="hidden min-w-0 truncate text-xs font-bold text-white sm:block">
            {awayName}
          </span>
        </span>
      </div>
      <MatchPoints points={pointsB} align="end" />
    </div>
  );
}

function MatchPoints({
  points,
  align,
}: {
  points: number;
  align: "start" | "end";
}) {
  const color = points > 0 ? WINNER : points < 0 ? NEGATIVE : "#a1a1aa";
  const bg =
    points > 0
      ? `${WINNER}1f`
      : points < 0
        ? `${NEGATIVE}1f`
        : "rgba(255,255,255,0.06)";
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-center text-xs font-black tabular-nums ${
        align === "start" ? "justify-self-start" : "justify-self-end"
      }`}
      style={{ backgroundColor: bg, color }}
    >
      {signed(points)}
    </span>
  );
}
