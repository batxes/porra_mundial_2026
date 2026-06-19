"use client";

import Image from "next/image";
import { useCallback, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase";

type RuletaPhase = "intro" | "ready" | "spinning" | "result";
type SpinState = "idle" | "spinning" | "done" | "error";

export type RuletaSegment = {
  label: string;
  pool: string | null;
  title: string;
};

export type RuletaConfig = {
  id: string;
  title: string;
  segments: RuletaSegment[];
};

export type RuletaSpinResult = {
  ruletaId: string;
  segmentIndex: number;
  prizePool: string | null;
  awardedDropIds: string[];
};

type RuletaRpcClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export const ruletaCompletedEventName = "triliporra:ruleta-completed";

// Sobre que representa cada premio.
const POOL_IMAGE: Record<string, string> = {
  defensas: "/sobre-defensas.webp",
  medios: "/sobre-medios.webp",
  delanteros: "/sobre-delanteros.webp",
  stars: "/sobre-estrellas.webp",
  diario: "/sobre.webp",
  madrid: "/sobre-madrid.webp",
  sub21: "/sobre21.webp",
  francia: "/sobre-francia.webp",
  premier: "/sobre-premier.webp",
};

// Color vivo por casilla (estilo "Ruleta de la Fortuna").
const POOL_COLOR: Record<string, string> = {
  defensas: "#2f6bff",
  medios: "#16b364",
  delanteros: "#ff3b30",
  stars: "#f7c93b",
  diario: "#9b5cff",
  madrid: "#e2e8f0",
  sub21: "#19c5e6",
  francia: "#3b6fff",
  premier: "#b25cff",
};
const CASI_COLOR = "#2b2b33";

const WHEEL_SIZE = 300;
const WHEEL_CENTER = WHEEL_SIZE / 2;
const FACE_RADIUS = 126;
const HUB_RADIUS = 25;
const BULB_RADIUS = 134;
const BULB_COUNT = 24;
const IMAGE_RADIUS = 72;
const IMAGE_W = 34;
const IMAGE_H = 46;
const LABEL_RADIUS = 106;
const SPIN_MS = 4600;
const SPIN_TURNS = 6;

// Confeti del estallido de premio: posiciones/colores fijos (sin Math.random,
// para no romper hidratacion ni el lint).
const CONFETTI = [
  { color: "#f7c93b", delay: "0ms", left: "30%" },
  { color: "#2f6bff", delay: "60ms", left: "62%" },
  { color: "#16b364", delay: "120ms", left: "45%" },
  { color: "#ff3b30", delay: "40ms", left: "70%" },
  { color: "#9b5cff", delay: "150ms", left: "22%" },
  { color: "#f7c93b", delay: "90ms", left: "55%" },
  { color: "#19c5e6", delay: "180ms", left: "48%" },
  { color: "#ff3b30", delay: "110ms", left: "75%" },
  { color: "#16b364", delay: "70ms", left: "18%" },
  { color: "#9b5cff", delay: "200ms", left: "60%" },
  { color: "#2f6bff", delay: "130ms", left: "38%" },
  { color: "#f7c93b", delay: "30ms", left: "66%" },
];

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function polar(radius: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [
    round3(WHEEL_CENTER + radius * Math.cos(a)),
    round3(WHEEL_CENTER + radius * Math.sin(a)),
  ] as const;
}

function wedgePath(startDeg: number, endDeg: number) {
  const [x0, y0] = polar(FACE_RADIUS, startDeg);
  const [x1, y1] = polar(FACE_RADIUS, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${WHEEL_CENTER} ${WHEEL_CENTER} L ${x0} ${y0} A ${FACE_RADIUS} ${FACE_RADIUS} 0 ${large} 1 ${x1} ${y1} Z`;
}

function poolImage(pool: string | null) {
  return pool ? POOL_IMAGE[pool] || "/sobre.webp" : null;
}

function segColor(pool: string | null) {
  return pool ? POOL_COLOR[pool] || "#6b7280" : CASI_COLOR;
}

// Bombillas del aro (estaticas, no giran con la rueda).
const BULBS = Array.from({ length: BULB_COUNT }, (_, index) => {
  const [x, y] = polar(BULB_RADIUS, index * (360 / BULB_COUNT));
  return { x, y, index };
});

export function RuletaModal({
  onClose,
  onCompleted,
  onOpenPacks,
  ruleta,
  spinFn,
}: {
  onClose: () => void;
  onCompleted?: (result: RuletaSpinResult) => void;
  onOpenPacks?: () => void;
  ruleta: RuletaConfig;
  // Inyeccion opcional del giro (para demo/test). Por defecto llama al RPC
  // spin_ruleta de Supabase.
  spinFn?: () => Promise<RuletaSpinResult>;
}) {
  const segments = useMemo(
    () => (ruleta.segments.length ? ruleta.segments : []),
    [ruleta.segments],
  );
  const sliceAngle = segments.length ? 360 / segments.length : 360;
  const [phase, setPhase] = useState<RuletaPhase>("intro");
  const [spinState, setSpinState] = useState<SpinState>("idle");
  const [rotation, setRotation] = useState(0);
  const [spinAnimating, setSpinAnimating] = useState(false);
  const [result, setResult] = useState<RuletaSpinResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const wedges = useMemo(
    () =>
      segments.map((segment, index) => {
        const start = index * sliceAngle;
        const end = start + sliceAngle;
        const mid = start + sliceAngle / 2;
        return {
          d: wedgePath(start, end),
          color: segColor(segment.pool),
          image: poolImage(segment.pool),
          label: segment.label,
          rotate: round3(mid),
          prize: Boolean(segment.pool),
          key: `${segment.label}-${index}`,
        };
      }),
    [segments, sliceAngle],
  );

  const dividers = useMemo(
    () =>
      segments.map((_, index) => {
        const [x0, y0] = polar(HUB_RADIUS, index * sliceAngle);
        const [x1, y1] = polar(FACE_RADIUS, index * sliceAngle);
        return { x0, y0, x1, y1, key: index };
      }),
    [segments, sliceAngle],
  );

  const wonSegment =
    result && result.segmentIndex >= 0 ? segments[result.segmentIndex] : null;
  const wonPrize = Boolean(result?.prizePool);
  const wonImage = poolImage(wonSegment?.pool ?? null);

  const spin = useCallback(async () => {
    if (spinState === "spinning" || !segments.length) return;
    setSpinState("spinning");
    setPhase("spinning");
    setErrorMsg("");
    try {
      let spinResult: RuletaSpinResult;
      if (spinFn) {
        spinResult = await spinFn();
      } else {
        const supabase = getSupabaseBrowserClient() as unknown as
          | RuletaRpcClient
          | null;
        if (!supabase) {
          throw new Error("No se ha podido conectar con Supabase.");
        }
        const { data, error } = await supabase.rpc("spin_ruleta", {
          p_ruleta_id: ruleta.id,
        });
        if (error) throw new Error(error.message);
        const row = Array.isArray(data) ? data[0] : data;
        spinResult = {
          ruletaId: String(
            (row as { ruleta_id?: unknown } | null)?.ruleta_id ?? ruleta.id,
          ),
          segmentIndex: Number(
            (row as { segment_index?: unknown } | null)?.segment_index ?? 0,
          ),
          prizePool:
            ((row as { prize_pool?: unknown } | null)?.prize_pool as
              | string
              | null) ?? null,
          awardedDropIds: Array.isArray(
            (row as { awarded_drop_ids?: unknown } | null)?.awarded_drop_ids,
          )
            ? ((row as { awarded_drop_ids: string[] }).awarded_drop_ids ?? [])
            : [],
        };
      }

      const safeIndex =
        spinResult.segmentIndex >= 0 &&
        spinResult.segmentIndex < segments.length
          ? spinResult.segmentIndex
          : 0;
      const landing = 360 - (safeIndex * sliceAngle + sliceAngle / 2);
      setSpinAnimating(true);
      setRotation(360 * SPIN_TURNS + landing);

      window.setTimeout(() => {
        setResult(spinResult);
        setSpinState("done");
        setPhase("result");
        onCompleted?.(spinResult);
      }, SPIN_MS);
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "No se ha podido girar la ruleta.";
      setErrorMsg(msg);
      setSpinState("error");
      setPhase("ready");
      setSpinAnimating(false);
    }
  }, [onCompleted, ruleta.id, sliceAngle, spinState, segments, spinFn]);

  const spinning = spinState === "spinning";
  const prizeSegments = useMemo(
    () => segments.filter((segment) => segment.pool),
    [segments],
  );

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/85 px-3 py-3 backdrop-blur-sm sm:px-6 sm:py-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ruleta-title"
    >
      <div className="theme-dark relative w-full max-w-md overflow-hidden rounded-2xl border border-amber-300/30 bg-[#0b0a16] text-white shadow-2xl shadow-black/70">
        {/* Glows de escenario */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_-10%,rgba(245,197,24,0.28),transparent_55%),radial-gradient(90%_60%_at_110%_40%,rgba(155,92,255,0.22),transparent_60%),radial-gradient(90%_60%_at_-10%_60%,rgba(47,107,255,0.18),transparent_60%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/80 to-transparent"
        />

        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar ruleta"
          className="absolute right-3 top-3 z-40 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/50 text-lg font-bold leading-none text-white transition hover:bg-white/10"
        >
          x
        </button>

        {/* Cabecera */}
        <div className="relative z-10 flex flex-col items-center px-4 pt-4">
          <span className="rounded-full border border-amber-200/30 bg-amber-200/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.24em] text-amber-200">
            En directo
          </span>
          <h2
            id="ruleta-title"
            className="mt-2 text-center font-[family-name:var(--font-display)] text-3xl uppercase leading-none tracking-wide text-amber-300 motion-safe:animate-[ruleta-title-pulse_2.6s_ease-in-out_infinite] sm:text-4xl"
          >
            {ruleta.title || "RULETA DE SOBRES"}
          </h2>
        </div>

        {/* Inicio del modal: presentadores + premios en juego (como el quiz) */}
        {phase === "intro" ? (
          <div className="relative z-10 flex flex-col items-center px-5 pb-6 pt-1">
            <div className="relative mt-1 h-[152px] w-full max-w-[320px]">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-6 bottom-0 top-2 rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.32),transparent_68%)] blur-md"
              />
              <Image
                src="/ruleta.webp"
                alt="Presentadores de la ruleta"
                fill
                priority
                sizes="320px"
                className="object-contain object-bottom drop-shadow-[0_10px_18px_rgba(0,0,0,0.55)] motion-safe:animate-[ruleta-host-bob_4s_ease-in-out_infinite]"
              />
            </div>
            <p className="mt-2 max-w-xs text-center text-sm font-semibold leading-5 text-zinc-200">
              Gira la rueda y llévate un sobre. ¡Un giro por persona y premio
              casi seguro!
            </p>
            {prizeSegments.length ? (
              <div className="mt-3 flex w-full max-w-[330px] flex-wrap justify-center gap-1.5">
                {prizeSegments.map((segment) => (
                  <div
                    key={`prize-${segment.label}`}
                    className="flex w-[58px] flex-col items-center rounded-lg border border-white/10 bg-white/[0.04] px-1 py-1.5"
                  >
                    <div className="relative aspect-[818/1206] w-7">
                      <Image
                        src={poolImage(segment.pool) || "/sobre.webp"}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-contain"
                      />
                    </div>
                    <span className="mt-0.5 text-center text-[8px] font-bold uppercase leading-tight text-zinc-300">
                      {segment.label}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setPhase("ready")}
              className="mt-5 w-full max-w-[280px] rounded-xl bg-gradient-to-b from-amber-300 to-amber-400 px-5 py-3.5 text-base font-black uppercase tracking-[0.14em] text-black shadow-[0_8px_24px_rgba(245,197,24,0.4)] transition hover:from-amber-200 hover:to-amber-300"
            >
              ¡A jugar!
            </button>
          </div>
        ) : null}

        {/* Pantalla de la rueda (sin presentador, solo rueda + textos) */}
        {phase !== "intro" ? (
          <div className="relative z-10 flex flex-col items-center px-4 pb-5">
            <p className="mb-2 text-center text-xs font-semibold text-zinc-300">
              {phase === "result"
                ? wonPrize
                  ? "¡La bola se ha parado en tu sobre!"
                  : "La bola no cayó en sobre... ¡pero hay revancha!"
                : spinning
                  ? "¡Girando! ¡Suerte!"
                  : "Pulsa el botón y gira la rueda."}
            </p>
            <div className="relative mt-6 aspect-square w-full max-w-[320px]">
              <div className="relative h-full w-full">
            {/* Glow del marco */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-[-10%] z-0 rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.45),rgba(155,92,255,0.22)_46%,transparent_70%)] blur-2xl motion-safe:animate-[ruleta-rim-glow_2.4s_ease-in-out_infinite]"
            />

            {/* Rueda giratoria (solo las casillas) */}
            <div
              className="absolute inset-0 z-10"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: spinAnimating
                  ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.78, 0.18, 1)`
                  : "none",
              }}
            >
              <svg
                viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
                className="h-full w-full"
              >
                <defs>
                  <radialGradient id="ruletaShade" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#000000" stopOpacity="0.5" />
                    <stop offset="58%" stopColor="#000000" stopOpacity="0.04" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0.16" />
                  </radialGradient>
                  <filter
                    id="ruletaPackShadow"
                    x="-40%"
                    y="-40%"
                    width="180%"
                    height="180%"
                  >
                    <feDropShadow
                      dx="0"
                      dy="1"
                      stdDeviation="1.4"
                      floodColor="#000000"
                      floodOpacity="0.55"
                    />
                  </filter>
                </defs>

                <circle
                  cx={WHEEL_CENTER}
                  cy={WHEEL_CENTER}
                  r={FACE_RADIUS}
                  fill="#0b0a16"
                />
                {wedges.map((wedge) => (
                  <path
                    key={`wedge-${wedge.key}`}
                    d={wedge.d}
                    fill={wedge.color}
                  />
                ))}
                <circle
                  cx={WHEEL_CENTER}
                  cy={WHEEL_CENTER}
                  r={FACE_RADIUS}
                  fill="url(#ruletaShade)"
                />
                {dividers.map((divider) => (
                  <line
                    key={`div-${divider.key}`}
                    x1={divider.x0}
                    y1={divider.y0}
                    x2={divider.x1}
                    y2={divider.y1}
                    stroke="#ffffff"
                    strokeOpacity="0.85"
                    strokeWidth="2.4"
                  />
                ))}
                {wedges.map((wedge) => (
                  <g
                    key={`content-${wedge.key}`}
                    transform={`rotate(${wedge.rotate} ${WHEEL_CENTER} ${WHEEL_CENTER})`}
                  >
                    <text
                      x={WHEEL_CENTER}
                      y={WHEEL_CENTER - LABEL_RADIUS}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="11"
                      fontWeight="800"
                      fill="#ffffff"
                      stroke="rgba(0,0,0,0.55)"
                      strokeWidth="2.4"
                      paintOrder="stroke"
                    >
                      {wedge.label}
                    </text>
                    {wedge.image ? (
                      <image
                        href={wedge.image}
                        x={WHEEL_CENTER - IMAGE_W / 2}
                        y={WHEEL_CENTER - IMAGE_RADIUS - IMAGE_H / 2}
                        width={IMAGE_W}
                        height={IMAGE_H}
                        preserveAspectRatio="xMidYMid meet"
                        filter="url(#ruletaPackShadow)"
                      />
                    ) : null}
                  </g>
                ))}
              </svg>
            </div>

            {/* Marco fijo: aro dorado, bombillas y centro */}
            <svg
              viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
              className="pointer-events-none absolute inset-0 z-20 h-full w-full"
            >
              <defs>
                <linearGradient id="ruletaGold" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffe9a8" />
                  <stop offset="45%" stopColor="#e6b53c" />
                  <stop offset="100%" stopColor="#855512" />
                </linearGradient>
                <radialGradient id="ruletaHub" cx="50%" cy="38%" r="65%">
                  <stop offset="0%" stopColor="#fff3c4" />
                  <stop offset="55%" stopColor="#e0a92e" />
                  <stop offset="100%" stopColor="#7c4f12" />
                </radialGradient>
              </defs>

              <circle
                cx={WHEEL_CENTER}
                cy={WHEEL_CENTER}
                r={134}
                fill="none"
                stroke="url(#ruletaGold)"
                strokeWidth="15"
              />
              <circle
                cx={WHEEL_CENTER}
                cy={WHEEL_CENTER}
                r={126.5}
                fill="none"
                stroke="rgba(0,0,0,0.45)"
                strokeWidth="2"
              />
              <circle
                cx={WHEEL_CENTER}
                cy={WHEEL_CENTER}
                r={141.5}
                fill="none"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="2"
              />
              {BULBS.map((bulb) => (
                <circle
                  key={`bulb-${bulb.index}`}
                  cx={bulb.x}
                  cy={bulb.y}
                  r={3.1}
                  fill="#fff3c4"
                  className="motion-safe:animate-[ruleta-bulb_1.1s_ease-in-out_infinite]"
                  style={{ animationDelay: `${(bulb.index % 6) * 0.14}s` }}
                />
              ))}

              <circle
                cx={WHEEL_CENTER}
                cy={WHEEL_CENTER}
                r={HUB_RADIUS}
                fill="url(#ruletaHub)"
                stroke="#7c4f12"
                strokeWidth="2"
              />
              {/* Balón de fútbol en el centro */}
              <g transform={`translate(${WHEEL_CENTER} ${WHEEL_CENTER})`}>
                <circle r="17" fill="#ffffff" stroke="#161616" strokeWidth="1.4" />
                <path
                  d="M0 -6.7 L6.37 -2.07 L3.94 5.42 L-3.94 5.42 L-6.37 -2.07 Z"
                  fill="#161616"
                />
                <path
                  d="M0 -6.7 L0 -15.5 M6.37 -2.07 L14.74 -4.79 M3.94 5.42 L9.11 12.54 M-3.94 5.42 L-9.11 12.54 M-6.37 -2.07 L-14.74 -4.79"
                  stroke="#161616"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M0 -15.5 L3.2 -13.2 M0 -15.5 L-3.2 -13.2 M14.74 -4.79 L13.9 -0.95 M14.74 -4.79 L11.5 -7.2 M9.11 12.54 L5.5 13.9 M9.11 12.54 L11 9.6 M-9.11 12.54 L-5.5 13.9 M-9.11 12.54 L-11 9.6 M-14.74 -4.79 L-13.9 -0.95 M-14.74 -4.79 L-11.5 -7.2"
                  stroke="#161616"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  fill="none"
                />
              </g>
            </svg>

            {/* Puntero / flapper */}
            <div className="absolute left-1/2 top-[-5%] z-30 w-[16%] -translate-x-1/2 drop-shadow-[0_3px_4px_rgba(0,0,0,0.5)]">
              <svg viewBox="0 0 40 54" className="h-full w-full">
                <circle cx="20" cy="11" r="10" fill="url(#ruletaGold)" />
                <path
                  d="M7 13 L33 13 L20 52 Z"
                  fill="#ff3b30"
                  stroke="#ffe9a8"
                  strokeWidth="2.6"
                  strokeLinejoin="round"
                />
                <circle cx="20" cy="11" r="3.6" fill="#7c1d12" />
              </svg>
            </div>

            {/* Estallido al ganar */}
            {phase === "result" && wonPrize ? (
              <div className="pointer-events-none absolute inset-0 z-40">
                <div className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.55),transparent_68%)] motion-safe:animate-[ruleta-win-burst_750ms_ease-out_both]" />
                {CONFETTI.map((piece, index) => (
                  <span
                    key={`confetti-${index}`}
                    className="absolute top-[42%] h-2 w-2 rounded-[1px] motion-safe:animate-[ruleta-confetti_1100ms_ease-out_both]"
                    style={{
                      left: piece.left,
                      backgroundColor: piece.color,
                      animationDelay: piece.delay,
                    }}
                  />
                ))}
              </div>
            ) : null}
              </div>
            </div>

            {/* Resultado / boton */}
            <div className="mt-3 flex w-full flex-col items-center">
              {phase === "result" && result ? (
            <div className="flex w-full flex-col items-center">
              {wonPrize ? (
                <div className="flex w-full max-w-[280px] flex-col items-center rounded-2xl border border-amber-200/50 bg-amber-200/10 p-3 shadow-[0_0_30px_rgba(245,197,24,0.18)]">
                  <div className="relative aspect-[818/1206] w-16 drop-shadow-[0_6px_14px_rgba(0,0,0,0.5)]">
                    {wonImage ? (
                      <Image
                        src={wonImage}
                        alt={wonSegment?.title || "Sobre"}
                        fill
                        sizes="80px"
                        className="object-contain"
                      />
                    ) : null}
                  </div>
                  <p className="mt-2 text-center text-base font-black text-lime-200">
                    {wonSegment?.title || "Sobre"}
                  </p>
                  <p className="mt-0.5 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-lime-300">
                    ¡Ganado!
                  </p>
                </div>
              ) : (
                <div className="flex w-full max-w-[280px] flex-col items-center rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-center text-base font-black text-white">
                    ¡Casi!
                  </p>
                  <p className="mt-1 text-center text-xs text-zinc-400">
                    La bola no se paró en un sobre esta vez.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={wonPrize ? onOpenPacks || onClose : onClose}
                className="mt-4 w-full max-w-[280px] rounded-xl bg-gradient-to-b from-amber-300 to-amber-400 px-5 py-3 text-sm font-black uppercase tracking-[0.1em] text-black shadow-lg shadow-amber-400/30 transition hover:from-amber-200 hover:to-amber-300"
              >
                {wonPrize ? "Abrir en cofres" : "Cerrar"}
              </button>
            </div>
          ) : (
            <div className="flex w-full flex-col items-center">
              {errorMsg ? (
                <p className="mb-2 text-center text-xs font-semibold text-rose-200">
                  {errorMsg}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void spin()}
                disabled={spinning}
                className="w-full max-w-[280px] rounded-xl bg-gradient-to-b from-amber-300 to-amber-400 px-5 py-3.5 text-base font-black uppercase tracking-[0.14em] text-black shadow-[0_8px_24px_rgba(245,197,24,0.4)] transition hover:from-amber-200 hover:to-amber-300 disabled:cursor-wait disabled:opacity-80"
              >
                {spinning
                  ? "Girando..."
                  : spinState === "error"
                    ? "Reintentar"
                    : "¡Girar!"}
              </button>
              <p className="mt-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                {spinning ? "¡Suerte!" : "Un giro por persona"}
              </p>
            </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
