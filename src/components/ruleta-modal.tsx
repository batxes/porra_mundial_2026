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
  barcelona: "/sobre-barcelona.webp",
  sub21: "/sobre21.webp",
  francia: "/sobre-francia.webp",
  premier: "/sobre-premier.webp",
};

// Color de cada casilla: vivo, pero algo mas cerca de la paleta de la app.
const POOL_COLOR: Record<string, string> = {
  defensas: "#2563eb",
  medios: "#16a34a",
  delanteros: "#dc2626",
  stars: "#f5c518",
  diario: "#a7f600",
  madrid: "#e2e8f0",
  barcelona: "#b91c1c",
  sub21: "#0891b2",
  francia: "#3157d5",
  premier: "#7c3aed",
};
const CASI_COLOR = "#2f3036";

const WHEEL_SIZE = 300;
const WHEEL_CENTER = WHEEL_SIZE / 2;
const FACE_RADIUS = 126;
const HUB_RADIUS = 28;
const BULB_RADIUS = 135.5;
const BULB_COUNT = 18;
const IMAGE_RADIUS = 69;
const IMAGE_W = 42;
const IMAGE_H = 56;
const LABEL_RADIUS = 103;
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
  const wonPrize = Boolean(result?.prizePool && result.awardedDropIds.length);
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
        const supabase =
          getSupabaseBrowserClient() as unknown as RuletaRpcClient | null;
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
      const raw = error instanceof Error ? error.message : "";
      // Si el giro falla por sesión (token caducado/zombi), mensaje claro en vez
      // del crudo "No autenticado".
      const msg = /autenticad/i.test(raw)
        ? "Inicia sesión para jugar la ruleta."
        : raw || "No se ha podido girar la ruleta.";
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
  const wheelMaxWidthClass =
    phase === "result" ? "max-w-[280px]" : "max-w-[320px]";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-x-hidden overflow-y-auto bg-black/76 px-3 py-3 text-white backdrop-blur-sm sm:px-6 sm:py-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ruleta-title"
    >
      <div className="theme-dark relative max-h-[calc(100vh-24px)] w-full max-w-md overflow-x-hidden overflow-y-auto rounded-2xl bg-[#151515] text-white shadow-2xl shadow-black/60">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[#a7f600]"
        />

        {/* Sin botón X: la ruleta se juega; se cierra al terminar con el botón
            de resultado ("Abrir en cofres" / "Cerrar"). */}

        {/* Cabecera */}
        <div className="relative z-10 flex flex-col items-center px-5 pt-5 text-center">
          <span className="inline-flex rounded-md border border-[#a7f600]/30 bg-[#a7f600]/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#a7f600]">
            Minijuego
          </span>
          <h2
            id="ruleta-title"
            className="mt-2 text-center font-[family-name:var(--font-display)] text-2xl uppercase leading-none tracking-wide text-white sm:text-3xl"
          >
            {ruleta.title || "RULETA DE SOBRES"}
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-xs font-medium leading-5 text-zinc-400">
            Un giro por persona. El premio lo decide el servidor.
          </p>
        </div>

        {/* Inicio del modal: presentadores + premios en juego (como el quiz) */}
        {phase === "intro" ? (
          <div className="relative z-10 flex flex-col items-center px-5 pb-5 pt-2">
            <div className="relative h-[220px] w-full max-w-[380px] sm:h-[235px]">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-4 bottom-0 h-[72%] rounded-t-full bg-[radial-gradient(ellipse_at_center,rgba(167,246,0,0.24),rgba(245,197,24,0.12)_44%,transparent_72%)]"
              />
              <Image
                src="/ruleta.webp"
                alt="Presentadores de la ruleta"
                fill
                priority
                sizes="(max-width: 640px) 340px, 380px"
                className="relative z-10 object-contain object-bottom drop-shadow-[0_18px_28px_rgba(0,0,0,0.65)]"
              />
            </div>
            {prizeSegments.length ? (
              <section className="mt-1 w-full max-w-[340px]">
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-white/10" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-[#a7f600]">
                    Premios
                  </p>
                  <span className="h-px flex-1 bg-white/10" />
                </div>
                <div className="mt-2.5 grid grid-cols-5 gap-1.5">
                  {prizeSegments.map((segment) => (
                    <div
                      key={`prize-${segment.label}`}
                      className="flex min-w-0 flex-col items-center rounded-lg bg-white/[0.045] px-1 py-1.5 ring-1 ring-white/10"
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
                      <span className="mt-0.5 w-full text-center text-[7px] font-bold uppercase leading-tight text-zinc-300 sm:text-[8px]">
                        {segment.label === "Mediocentros"
                          ? "Medios"
                          : segment.label}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <button
              type="button"
              onClick={() => setPhase("ready")}
              className="mt-5 w-full max-w-[280px] rounded-lg bg-[#a7f600] px-5 py-3.5 text-base font-bold uppercase tracking-[0.14em] text-black shadow-[0_12px_30px_rgba(167,246,0,0.18)] transition hover:bg-[#c7ff43]"
            >
              A jugar
            </button>
          </div>
        ) : null}

        {/* Pantalla de la rueda (sin presentador, solo rueda + textos) */}
        {phase !== "intro" ? (
          <div className="relative z-10 flex flex-col items-center px-4 pb-5 pt-3">
            <p className="mb-3 text-center text-xs font-semibold text-zinc-300">
              {phase === "result"
                ? wonPrize
                  ? "La bola se ha parado en tu sobre."
                  : "La bola no cayo en sobre esta vez."
                : spinning
                  ? "Girando..."
                  : "Pulsa y que ruede."}
            </p>
            <div
              className={`relative mt-2 aspect-square w-full ${wheelMaxWidthClass} rounded-full bg-[#080808] p-1.5 shadow-[0_0_34px_rgba(245,197,24,0.18),0_22px_54px_rgba(0,0,0,0.45)]`}
            >
              <div className="relative h-full w-full">
                {/* Acento fijo del marco */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-0 rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.22),transparent_62%)] blur-md"
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
                      <radialGradient
                        id="ruletaShade"
                        cx="50%"
                        cy="50%"
                        r="50%"
                      >
                        <stop
                          offset="0%"
                          stopColor="#ffffff"
                          stopOpacity="0.08"
                        />
                        <stop
                          offset="48%"
                          stopColor="#000000"
                          stopOpacity="0.03"
                        />
                        <stop
                          offset="100%"
                          stopColor="#000000"
                          stopOpacity="0.36"
                        />
                      </radialGradient>
                      <pattern
                        id="ruletaTexture"
                        width="9"
                        height="9"
                        patternUnits="userSpaceOnUse"
                      >
                        <path
                          d="M0 8 L8 0 M-2 2 L2 -2 M7 10 L10 7"
                          stroke="#ffffff"
                          strokeOpacity="0.13"
                          strokeWidth="0.55"
                        />
                      </pattern>
                      <filter
                        id="ruletaPackShadow"
                        x="-40%"
                        y="-40%"
                        width="180%"
                        height="180%"
                      >
                        <feDropShadow
                          dx="0"
                          dy="2"
                          stdDeviation="2"
                          floodColor="#000000"
                          floodOpacity="0.7"
                        />
                      </filter>
                    </defs>

                    <circle
                      cx={WHEEL_CENTER}
                      cy={WHEEL_CENTER}
                      r={FACE_RADIUS}
                      fill="#101010"
                    />
                    {wedges.map((wedge) => (
                      <g key={`wedge-${wedge.key}`}>
                        <path d={wedge.d} fill={wedge.color} />
                        <path
                          d={wedge.d}
                          fill="url(#ruletaTexture)"
                          opacity="0.38"
                        />
                      </g>
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
                        stroke="#f9d66d"
                        strokeOpacity="0.9"
                        strokeWidth="1.4"
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
                          fontSize="13"
                          fontWeight="900"
                          fill="#ffffff"
                          stroke="rgba(0,0,0,0.72)"
                          strokeWidth="2.8"
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
                      <stop offset="0%" stopColor="#fff0b7" />
                      <stop offset="48%" stopColor="#f4b73b" />
                      <stop offset="100%" stopColor="#7a430e" />
                    </linearGradient>
                    <radialGradient id="ruletaHub" cx="50%" cy="38%" r="65%">
                      <stop offset="0%" stopColor="#f4ffd7" />
                      <stop offset="55%" stopColor="#a7f600" />
                      <stop offset="100%" stopColor="#315405" />
                    </radialGradient>
                    <filter
                      id="ruletaBulbGlow"
                      x="-90%"
                      y="-90%"
                      width="280%"
                      height="280%"
                    >
                      <feDropShadow
                        dx="0"
                        dy="0"
                        stdDeviation="1.3"
                        floodColor="#fbbf24"
                        floodOpacity="0.65"
                      />
                    </filter>
                    <filter
                      id="ruletaGreenGlow"
                      x="-80%"
                      y="-80%"
                      width="260%"
                      height="260%"
                    >
                      <feDropShadow
                        dx="0"
                        dy="0"
                        stdDeviation="2.5"
                        floodColor="#a7f600"
                        floodOpacity="0.85"
                      />
                    </filter>
                  </defs>

                  <circle
                    cx={WHEEL_CENTER}
                    cy={WHEEL_CENTER}
                    r={140}
                    fill="none"
                    stroke="#060606"
                    strokeWidth="18"
                  />
                  <circle
                    cx={WHEEL_CENTER}
                    cy={WHEEL_CENTER}
                    r={141}
                    fill="none"
                    stroke="url(#ruletaGold)"
                    strokeWidth="3.2"
                  />
                  <circle
                    cx={WHEEL_CENTER}
                    cy={WHEEL_CENTER}
                    r={134}
                    fill="none"
                    stroke="#292929"
                    strokeWidth="9"
                  />
                  <circle
                    cx={WHEEL_CENTER}
                    cy={WHEEL_CENTER}
                    r={128.8}
                    fill="none"
                    stroke="#f8d96f"
                    strokeOpacity="0.95"
                    strokeWidth="2.4"
                  />
                  <circle
                    cx={WHEEL_CENTER}
                    cy={WHEEL_CENTER}
                    r={125.8}
                    fill="none"
                    stroke="#a7f600"
                    strokeOpacity="0.85"
                    strokeWidth="1.8"
                  />
                  <circle
                    cx={WHEEL_CENTER}
                    cy={WHEEL_CENTER}
                    r={145}
                    fill="none"
                    stroke="rgba(255,232,160,0.35)"
                    strokeWidth="1.5"
                  />
                  {BULBS.map((bulb) => (
                    <circle
                      key={`bulb-${bulb.index}`}
                      cx={bulb.x}
                      cy={bulb.y}
                      r={2.4}
                      fill="#fff3b0"
                      stroke="#f59e0b"
                      strokeWidth="0.65"
                      filter="url(#ruletaBulbGlow)"
                    />
                  ))}

                  <circle
                    cx={WHEEL_CENTER}
                    cy={WHEEL_CENTER}
                    r={35}
                    fill="none"
                    stroke="#a7f600"
                    strokeWidth="3.5"
                    filter="url(#ruletaGreenGlow)"
                  />
                  <circle
                    cx={WHEEL_CENTER}
                    cy={WHEEL_CENTER}
                    r={30}
                    fill="#111111"
                    stroke="url(#ruletaGold)"
                    strokeWidth="4"
                  />
                  <circle
                    cx={WHEEL_CENTER}
                    cy={WHEEL_CENTER}
                    r={HUB_RADIUS}
                    fill="url(#ruletaHub)"
                    stroke="#26380a"
                    strokeWidth="1"
                    opacity="0.18"
                  />
                  {/* Balón de fútbol en el centro */}
                  <g transform={`translate(${WHEEL_CENTER} ${WHEEL_CENTER})`}>
                    <circle
                      r="17"
                      fill="#ffffff"
                      stroke="#161616"
                      strokeWidth="1.4"
                    />
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
                <div className="absolute left-1/2 top-[-9%] z-30 w-[21%] -translate-x-1/2 drop-shadow-[0_8px_12px_rgba(0,0,0,0.55)]">
                  <svg viewBox="0 0 54 74" className="h-full w-full">
                    <defs>
                      <linearGradient
                        id="ruletaPointerGold"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor="#fff7cf" />
                        <stop offset="46%" stopColor="#f2b83d" />
                        <stop offset="100%" stopColor="#7a430e" />
                      </linearGradient>
                      <radialGradient
                        id="ruletaPointerGem"
                        cx="45%"
                        cy="30%"
                        r="70%"
                      >
                        <stop offset="0%" stopColor="#ffffff" />
                        <stop offset="38%" stopColor="#a7f600" />
                        <stop offset="100%" stopColor="#1f6900" />
                      </radialGradient>
                    </defs>
                    <path
                      d="M27 5 C38 5 47 14 47 25 C47 32 42 39 35 42 L27 68 L19 42 C12 39 7 32 7 25 C7 14 16 5 27 5 Z"
                      fill="url(#ruletaPointerGold)"
                      stroke="#fff1b2"
                      strokeWidth="2.2"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M27 12 C34 12 40 18 40 25 C40 31 36 36 30 38 L27 47 L24 38 C18 36 14 31 14 25 C14 18 20 12 27 12 Z"
                      fill="#151515"
                      opacity="0.72"
                    />
                    <path
                      d="M15 31 L39 31 L27 66 Z"
                      fill="url(#ruletaPointerGold)"
                      stroke="#fff1b2"
                      strokeWidth="2.4"
                      strokeLinejoin="round"
                    />
                    <circle
                      cx="27"
                      cy="25"
                      r="8.3"
                      fill="url(#ruletaPointerGem)"
                      stroke="#fff1b2"
                      strokeWidth="2"
                    />
                  </svg>
                </div>

                {/* Estallido al ganar */}
                {phase === "result" && wonPrize ? (
                  <div className="pointer-events-none absolute inset-0 z-40">
                    <div className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(167,246,0,0.38),transparent_68%)] motion-safe:animate-[ruleta-win-burst_750ms_ease-out_both]" />
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
                    <div className="flex w-full max-w-[292px] flex-col items-center rounded-xl border border-[#a7f600]/35 bg-white/[0.045] p-3 shadow-[0_14px_32px_rgba(0,0,0,0.28)]">
                      <div className="relative aspect-[818/1206] w-14 drop-shadow-[0_6px_14px_rgba(0,0,0,0.5)]">
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
                      <p className="mt-2 text-center text-base font-bold text-white">
                        {wonSegment?.title || "Sobre"}
                      </p>
                      <p className="mt-0.5 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-[#a7f600]">
                        Sobre ganado
                      </p>
                    </div>
                  ) : (
                    <div className="flex w-full max-w-[292px] flex-col items-center rounded-xl border border-white/10 bg-white/[0.045] p-4">
                      <p className="text-center text-base font-bold text-white">
                        Casi
                      </p>
                      <p className="mt-1 text-center text-xs text-zinc-400">
                        La bola no se paro en un sobre esta vez.
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={wonPrize ? onOpenPacks || onClose : onClose}
                    className="mt-4 w-full max-w-[292px] rounded-lg bg-[#a7f600] px-5 py-3 text-sm font-bold uppercase tracking-[0.1em] text-black shadow-lg shadow-[#a7f600]/18 transition hover:bg-[#c7ff43]"
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
                    className="w-full max-w-[292px] rounded-lg bg-[#a7f600] px-5 py-3.5 text-base font-bold uppercase tracking-[0.14em] text-black shadow-[0_12px_30px_rgba(167,246,0,0.18)] transition hover:bg-[#c7ff43] disabled:cursor-wait disabled:opacity-80"
                  >
                    {spinning
                      ? "Girando..."
                      : spinState === "error"
                        ? "Reintentar"
                        : "Girar"}
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
