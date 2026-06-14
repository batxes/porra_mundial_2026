"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { hasFinishedScore } from "@/components/common";
import { schedule } from "@/lib/data";
import { initials } from "@/lib/format";
import type { AdminResults, UserProfile } from "@/lib/types";

// Fecha corta tipo "11 jun" para la línea de tiempo (las jornadas son fechas
// con resultados, como en el feed de jornadas del perfil).
const shortDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
function shortDate(date: string) {
  return shortDateFormatter.format(new Date(`${date}T12:00:00Z`)).replace(".", "");
}

// Paleta para las líneas. El usuario logueado siempre va en lima de Triliporra.
const LINE_COLORS = [
  "#E24B4A",
  "#EF9F27",
  "#378ADD",
  "#1D9E75",
  "#D4537E",
  "#534AB7",
  "#C99A11",
  "#0F6E56",
  "#993C1D",
  "#5DCAA5",
  "#7F77DD",
  "#85B7EB",
  "#F0997B",
  "#639922",
  "#BA7517",
  "#D85A30",
  "#97C459",
  "#ED93B1",
  "#185FA5",
  "#3B6D11",
];
const YOU_COLOR = "#a7f600";

type Series = {
  profile: UserProfile;
  color: string;
  isYou: boolean;
  ranks: number[];
};

type EvolutionModel = {
  dates: string[];
  series: Series[];
  yMax: number;
};

// Reconstruye el puesto de cada participante jornada a jornada a partir de los
// puntos ya calculados (scorecard.entries). No hace falta histórico en BBDD:
// cada entrada lleva su matchNumber -> fecha, así que basta con acumular.
function buildEvolution(
  leaderboard: UserProfile[],
  adminResults: AdminResults,
  currentUserId?: string,
): EvolutionModel {
  const matchDate = new Map<number, string>(
    schedule.map((match) => [match.number, match.date]),
  );

  const finishedDates = new Set<string>();
  schedule.forEach((match) => {
    if (hasFinishedScore(adminResults[String(match.number)])) {
      finishedDates.add(match.date);
    }
  });
  const dates = [...finishedDates].sort();
  if (dates.length < 2 || !leaderboard.length) {
    return { dates, series: [], yMax: 2 };
  }

  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const lastIndex = dates.length - 1;

  // Puntos acumulados por jornada de cada jugador. Las entradas sin matchNumber
  // (bonus de grupos/torneo) se imputan a la última jornada para que el final
  // del gráfico cuadre exacto con la tabla.
  const cumulative = new Map<string, number[]>();
  leaderboard.forEach((profile) => {
    const buckets = new Array<number>(dates.length).fill(0);
    profile.scorecard.entries.forEach((entry) => {
      const entryDate =
        entry.matchNumber == null
          ? dates[lastIndex]
          : matchDate.get(entry.matchNumber) ?? dates[lastIndex];
      const index = dateIndex.get(entryDate);
      if (index == null) return;
      buckets[index] += entry.points;
    });
    for (let i = 1; i < buckets.length; i += 1) buckets[i] += buckets[i - 1];
    cumulative.set(profile.id, buckets);
  });

  // Puesto en cada jornada, calculado sobre TODO el grupo visible (no solo los
  // dibujados), con el mismo criterio de desempate que la tabla.
  const rankByPlayer = new Map<string, number[]>();
  leaderboard.forEach((profile) =>
    rankByPlayer.set(profile.id, new Array<number>(dates.length).fill(0)),
  );
  for (let j = 0; j < dates.length; j += 1) {
    const order = [...leaderboard].sort((a, b) => {
      const diff = cumulative.get(b.id)![j] - cumulative.get(a.id)![j];
      return diff || a.name.localeCompare(b.name);
    });
    order.forEach((profile, position) => {
      rankByPlayer.get(profile.id)![j] = position + 1;
    });
  }

  // Dibujamos a todos los participantes, ordenados por su puesto final.
  const drawn = [...leaderboard].sort(
    (a, b) => rankByPlayer.get(a.id)![lastIndex] - rankByPlayer.get(b.id)![lastIndex],
  );

  let colorIndex = 0;
  const series: Series[] = drawn.map((profile) => {
    const isYou = profile.id === currentUserId;
    return {
      profile,
      isYou,
      color: isYou ? YOU_COLOR : LINE_COLORS[colorIndex++ % LINE_COLORS.length],
      ranks: rankByPlayer.get(profile.id)!,
    };
  });

  const yMax = Math.max(2, ...series.flatMap((item) => item.ranks));
  return { dates, series, yMax };
}

// Curva suave (Catmull-Rom -> Bézier) para que las líneas no sean quebradas.
function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

const presetAvatarColor: Record<string, string> = {
  green: "#1D9E75",
  gold: "#C99A11",
  blue: "#378ADD",
  rose: "#D4537E",
  dark: "#5F5E5A",
};

const DEFAULT_VISIBLE = 10;

// Selección por defecto: top 10 por puesto final + tú (si juegas).
function defaultSelection(series: Series[], currentUserId?: string) {
  const ids = series.slice(0, DEFAULT_VISIBLE).map((item) => item.profile.id);
  if (
    currentUserId &&
    series.some((item) => item.profile.id === currentUserId) &&
    !ids.includes(currentUserId)
  ) {
    ids.push(currentUserId);
  }
  return new Set(ids);
}

function sameIds(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function AvatarNode({
  series,
  cx,
  cy,
  radius,
}: {
  series: Series;
  cx: number;
  cy: number;
  radius: number;
}) {
  const { avatarUrl, name, id } = series.profile;
  const isPhoto = Boolean(avatarUrl && !avatarUrl.startsWith("preset:"));
  const r = series.isYou ? radius + 1.5 : radius;
  const ring = series.color;
  const clipId = `evo-clip-${id}`;
  const fontSize = Math.max(6, Math.round(r * 0.92));
  const ringWidth = Math.max(1.5, r * 0.2);

  if (isPhoto) {
    return (
      <g>
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={r - 1} />
        </clipPath>
        <image
          href={avatarUrl}
          x={cx - (r - 1)}
          y={cy - (r - 1)}
          width={(r - 1) * 2}
          height={(r - 1) * 2}
          clipPath={`url(#${clipId})`}
          preserveAspectRatio="xMidYMid slice"
        />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={ring} strokeWidth={ringWidth} />
      </g>
    );
  }

  const preset = avatarUrl?.replace("preset:", "") || "";
  const fill = series.isYou ? YOU_COLOR : presetAvatarColor[preset] || series.color;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
      <text
        x={cx}
        y={cy + fontSize * 0.34}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight={700}
        fill={series.isYou ? "#1a2e00" : "#ffffff"}
      >
        {initials(name)}
      </text>
    </g>
  );
}

export function LeaderboardEvolution({
  leaderboard,
  adminResults,
  currentUserId,
  canSeeWolf = false,
}: {
  leaderboard: UserProfile[];
  adminResults: AdminResults;
  currentUserId?: string;
  canSeeWolf?: boolean;
}) {
  const model = useMemo(
    () => buildEvolution(leaderboard, adminResults, currentUserId),
    [leaderboard, adminResults, currentUserId],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() =>
    defaultSelection(model.series, currentUserId),
  );
  const [progress, setProgress] = useState(0);
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 640px)").matches,
  );
  const progressRef = useRef(0);
  const rafRef = useRef(0);
  const lastIndex = Math.max(0, model.dates.length - 1);

  // Anima la posición de forma continua (requestAnimationFrame) entre jornadas,
  // en vez de saltar de una a otra. La velocidad escala con la distancia.
  const animateTo = useCallback((target: number, from = 0) => {
    window.cancelAnimationFrame(rafRef.current);
    const distance = Math.abs(target - from);
    const duration = Math.min(2600, Math.max(450, distance * 430));
    const start = performance.now();
    const step = (now: number) => {
      const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
      // Ease-in-out: arranca y frena suave para que no se sienta robótico.
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const value = from + (target - from) * eased;
      progressRef.current = value;
      setProgress(value);
      if (t < 1) rafRef.current = window.requestAnimationFrame(step);
    };
    rafRef.current = window.requestAnimationFrame(step);
  }, []);

  // Reproducción automática: fluida desde el inicio hasta la última jornada. Se
  // relanza si aparece una jornada nueva (cambia lastIndex), no en cada refresco.
  useEffect(() => {
    if (lastIndex === 0) return;
    animateTo(lastIndex, 0);
    return () => window.cancelAnimationFrame(rafRef.current);
  }, [animateTo, lastIndex]);

  // Detecta móvil para una versión más legible (sin nombres y viewBox estrecho).
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (model.dates.length < 2 || !model.series.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-10 text-center">
        <p className="text-sm font-semibold text-white">
          Aún no hay suficiente para la gráfica
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          La evolución aparece cuando hay al menos dos jornadas con resultados.
        </p>
      </div>
    );
  }

  const { dates, series } = model;

  // Solo se dibujan los participantes seleccionados, y el eje se reescala a
  // ellos (menos seleccionados -> filas más amplias y nombres visibles).
  const visible = series.filter((item) => selectedIds.has(item.profile.id));
  const yMax = Math.max(2, ...visible.flatMap((item) => item.ranks));

  const total = series.length;
  const isAll = selectedIds.size === total;
  const isTop = sameIds(selectedIds, defaultSelection(series, currentUserId));
  const selectTop = () => setSelectedIds(defaultSelection(series, currentUserId));
  const selectAll = () => setSelectedIds(new Set(series.map((item) => item.profile.id)));
  const selectNone = () => setSelectedIds(new Set());
  // Preset de la manada: solo visible para sus miembros (y admin).
  const wolfSet = new Set(
    series.filter((item) => item.profile.isWolf).map((item) => item.profile.id),
  );
  const showWolfPreset = canSeeWolf && wolfSet.size > 0;
  const isWolfSel = showWolfPreset && sameIds(selectedIds, wolfSet);
  const selectWolf = () => setSelectedIds(new Set(wolfSet));
  const toggleId = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const presetCls = (active: boolean) =>
    `rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
      active
        ? "border-[#a7f600]/40 bg-[#a7f600]/15 text-[#a7f600]"
        : "border-white/10 text-zinc-400 hover:bg-white/[0.06] hover:text-white"
    }`;

  // Posición continua: i0/i1 son las jornadas que rodean al playhead y `frac`
  // cuánto hay entre ellas (para interpolar avatares y el tramo recorrido).
  const p = Math.max(0, Math.min(lastIndex, progress));
  const i0 = Math.floor(p);
  const i1 = Math.min(lastIndex, i0 + 1);
  const frac = p - i0;
  const activeJornada = Math.round(p);

  // Filas de tamaño fijo: con más participantes la gráfica se hace más alta
  // (más filas), no más pequeña. La altura crece solo si eliges "Todos".
  // En móvil el viewBox es más estrecho (se reduce menos -> se ve más grande) y
  // se ocultan los badges de nombre (identidad por avatar + leyenda).
  const showNames = !isMobile;
  const W = isMobile ? 384 : 660;
  const padL = isMobile ? 32 : 40;
  const rowGap = 30;
  const avatarR = 11;
  const padR = showNames ? 104 : avatarR + 14;
  const padT = 22;
  const padB = 16;
  const lineWidth = 2;
  const futureWidth = 1.5;
  const dotR = 2.4;
  const plotH = (yMax - 1) * rowGap;
  const plotW = W - padL - padR;
  const H = padT + plotH + padB;

  const X = (jornada: number) =>
    lastIndex === 0 ? padL + plotW / 2 : padL + (jornada / lastIndex) * plotW;
  const Y = (rank: number) => padT + ((rank - 1) / (yMax - 1)) * plotH;

  // Pulsar una jornada reproduce (fluido) hasta ella; Reproducir, hasta el final.
  const playTo = (target: number) => {
    // Hacia delante seguimos desde la posición actual; hacia atrás renace desde
    // 0. Así el movimiento siempre avanza, nunca retrocede.
    const from = target >= progressRef.current ? progressRef.current : 0;
    animateTo(target, from);
  };
  const replay = () => animateTo(lastIndex, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a7f600]">
          Evolución de posiciones
        </p>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={selectTop} className={presetCls(isTop)}>
            Top 10
          </button>
          <button type="button" onClick={selectAll} className={presetCls(isAll)}>
            Todos
          </button>
          {showWolfPreset ? (
            <button
              type="button"
              onClick={selectWolf}
              aria-label="Manada"
              className={presetCls(isWolfSel)}
            >
              🐺
            </button>
          ) : null}
          <button
            type="button"
            onClick={replay}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
              <path d="M5 3.5v9l7-4.5z" />
            </svg>
            Reproducir
          </button>
        </div>
      </div>

      {/* Línea de tiempo: pulsa una jornada y se reproduce hasta ella */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {dates.map((date, j) => {
          const isCurrent = j === activeJornada;
          const isPassed = j < activeJornada;
          return (
            <button
              key={`pill-${date}`}
              type="button"
              onClick={() => playTo(j)}
              aria-pressed={isCurrent}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                isCurrent
                  ? "border-[#a7f600] bg-[#a7f600] text-black"
                  : isPassed
                    ? "border-white/25 bg-white/[0.06] text-white"
                    : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              {shortDate(date)}
            </button>
          );
        })}
      </div>

      {visible.length ? (
        <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          style={{ overflow: "visible" }}
          role="img"
          aria-label="Gráfica de evolución de posiciones por jornada"
        >
          {/* Zona de podio (1º a 3º) */}
          <rect
            x={padL}
            y={Y(1) - rowGap * 0.45}
            width={plotW}
            height={Y(Math.min(3, yMax)) - Y(1) + rowGap * 0.9}
            rx={10}
            fill={YOU_COLOR}
            opacity={0.06}
          />

          {/* Columnas: una por jornada */}
          {dates.map((date, j) => (
            <line
              key={`col-${date}`}
              x1={X(j)}
              y1={padT}
              x2={X(j)}
              y2={padT + plotH}
              stroke="rgba(255,255,255,0.04)"
              strokeWidth={1}
            />
          ))}

          {/* Líneas guía y etiquetas de puesto */}
          {Array.from({ length: yMax }, (_, i) => i + 1).map((rank) => (
            <g key={`row-${rank}`}>
              <line
                x1={padL}
                y1={Y(rank)}
                x2={padL + plotW}
                y2={Y(rank)}
                stroke="rgba(255,255,255,0.07)"
                strokeWidth={1}
                strokeDasharray="2 5"
              />
              <text
                x={padL - 12}
                y={Y(rank) + 4}
                textAnchor="end"
                fontSize={11}
                fontWeight={500}
                fill="rgba(255,255,255,0.35)"
              >
                {rank}º
              </text>
            </g>
          ))}

          {/* Playhead: posición actual de la reproducción */}
          <line
            x1={X(p)}
            y1={padT - 4}
            x2={X(p)}
            y2={padT + plotH + 4}
            stroke={YOU_COLOR}
            strokeWidth={1.5}
            strokeDasharray="3 4"
            opacity={0.55}
          />

          {/* Series (solo las seleccionadas) */}
          {visible.map((item) => {
            const points = item.ranks.map((rank, j) => ({ x: X(j), y: Y(rank) }));
            // Punta interpolada entre las dos jornadas que rodean al playhead.
            const cx = X(p);
            const cy = Y(item.ranks[i0]) + (Y(item.ranks[i1]) - Y(item.ranks[i0])) * frac;
            const past = points.slice(0, i0 + 1);
            if (frac > 0.001) past.push({ x: cx, y: cy });
            const label = item.isYou
              ? "Tú"
              : item.profile.name.split(/\s+/)[0].slice(0, 11);
            return (
              <g key={item.profile.id}>
                {/* Recorrido completo, atenuado y punteado (el "futuro") */}
                <path
                  d={smoothPath(points)}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={futureWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="2 5"
                  opacity={0.2}
                />
                {/* Recorrido hasta la jornada seleccionada (el "pasado") */}
                <path
                  d={smoothPath(past)}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={lineWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {past.map((point, j) => (
                  <circle
                    key={`node-${item.profile.id}-${j}`}
                    cx={point.x}
                    cy={point.y}
                    r={dotR}
                    fill={item.color}
                  />
                ))}
                {/* Avatar viajando a su puesto en la jornada seleccionada */}
                <g style={{ transform: `translate(${cx}px, ${cy}px)` }}>
                  <AvatarNode series={item} cx={0} cy={0} radius={avatarR} />
                  {/* Nombre en badge (como la leyenda); en móvil se oculta */}
                  {showNames ? (
                    <g transform={`translate(${avatarR + 3}, 0)`}>
                      <rect
                        x={0}
                        y={-7}
                        width={label.length * 5.1 + 11}
                        height={14}
                        rx={7}
                        fill="rgba(12,12,12,0.72)"
                        stroke={item.color}
                        strokeOpacity={0.6}
                        strokeWidth={0.75}
                      />
                      <text
                        x={6}
                        y={2.6}
                        fontSize={9}
                        fontWeight={item.isYou ? 700 : 500}
                        fill="#ffffff"
                      >
                        {label}
                      </text>
                    </g>
                  ) : null}
                </g>
              </g>
            );
          })}
        </svg>
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-zinc-500">
          Selecciona participantes abajo para ver su evolución.
        </div>
      )}

      {/* Leyenda = interruptores: toca un nombre para mostrar/ocultar su línea */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={selectNone}
          className="rounded-full border border-white/10 px-2.5 py-1 text-xs font-bold text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
        >
          Ninguno
        </button>
        {series.map((item) => {
          const on = selectedIds.has(item.profile.id);
          return (
            <button
              key={item.profile.id}
              type="button"
              onClick={() => toggleId(item.profile.id)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-2.5 text-xs font-medium transition ${
                on
                  ? "border-white/15 bg-white/[0.06] text-zinc-100"
                  : "border-white/10 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={
                  on
                    ? { background: item.color }
                    : { border: `1.5px solid ${item.color}` }
                }
              />
              {item.isYou ? "Tú" : item.profile.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
