import Image from "next/image";

import { TeamFlag } from "@/components/common";
import { playersById, teamsById } from "@/lib/data";
import { initials, playerPhotoUrl } from "@/lib/format";
import { positionAccent } from "@/lib/position-style";
import { starPlayerIds } from "@/lib/star-players";

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

// Rareza por ESTRELLA, no por puntos. Lo de los puntos era arbitrario (premiaba
// a un defensa goleador como a un crack). Los jugadores de `starPlayerIds` (los
// mejores del mundo, pool del Sobre Estrellas) son "legendaria" —la mayor
// rareza: marco dorado, glow y holo—; el resto, "comun". Los tramos intermedios
// (rara/épica) se mantienen en el tipo por si se añaden más listas curadas, pero
// hoy no se asignan. El HOLO/barrido solo aparece de "rara" hacia arriba, así
// que de facto solo las legendarias lo llevan.
type Rarity = "comun" | "rara" | "epica" | "legendaria";

function rarityFor(playerId: string): Rarity {
  return starPlayerIds.has(playerId) ? "legendaria" : "comun";
}

// Carta de jugador compartida: misma pieza para el inventario de /cofres y para
// el revelado del sobre. Recibe solo playerId + points para no acoplarse a
// ningún tipo concreto (InventoryCard, OpeningCard, etc.).
//
// `featured` enciende el holo/barrido de forma permanente (revelado, 1-3 cartas
// grandes); en el grid se quedan en hover para no animar decenas a la vez.
//
// Tipografía FLUIDA: el <article> es el contenedor (container-type) y el
// texto/espaciado de sus HIJOS se mide en `cqw` (1cqw = 1% del ancho de la
// carta). Así la MISMA carta se ve proporcionada pequeña (grid ~156px) o grande
// (revelado ~280px) sin tamaños fijos que se queden minúsculos. OJO: el cqw va
// en los hijos, NUNCA en el propio <article> (un contenedor no puede medirse a
// sí mismo y caería al viewport).
export function PlayerCard({
  playerId,
  points,
  selected = false,
  featured = false,
  holoShader = false,
}: {
  playerId: string;
  points: number;
  selected?: boolean;
  featured?: boolean;
  // Shader holo (foil dorado + destello) DETRÁS de la foto, movido por el
  // giroscopio (lee --holo-bx/by/mx/my del ancestro). Solo el revelado lo activa.
  holoShader?: boolean;
}) {
  const player = playersById.get(playerId);
  if (!player) return null;
  const team = teamsById.get(player.team);
  const photo = playerPhotoUrl(player);
  const accent = positionAccent[player.position];

  const rarity = rarityFor(playerId);
  const legendary = rarity === "legendaria";
  // Holo y barrido solo de "rara" hacia arriba; "común" se queda limpia.
  const effects = rarity !== "comun";
  // Tono del marco/foco: el del puesto, salvo legendaria que va dorada.
  const hue = legendary ? "245, 184, 30" : accent.rgb;
  // Color del texto de puesto (chip, "PTS", iniciales): el del puesto, pero en
  // las legendarias va DORADO para no romper el oro (aunque sea DEF, MED, etc.).
  const textAccent = legendary ? "#f7c84a" : accent.text;

  // Foco detrás de la cabeza: el recorte deja de "flotar". Sube con la rareza.
  const spotAlpha = legendary
    ? 0.24
    : rarity === "epica"
      ? 0.2
      : rarity === "rara"
        ? 0.17
        : 0.13;

  // Borde BLANCO sutil como arista (despega la carta del fondo y hace que
  // resalte). Se hace con `border` REAL, NO con inset box-shadow: un inset sobre
  // un fondo a sangre + esquinas redondeadas dejaba "restos" blancos en las
  // esquinas. El color de puesto/rareza ya se lee por el tinte del fondo, chip,
  // puntos, foco y holo; el glow exterior queda como señal de rareza/selección.
  const whiteAlpha = selected ? 0.9 : 0.4;
  // Legendaria = oro total (fondo, borde y estrella); el resto, borde blanco.
  const cardBorder = legendary
    ? "1.5px solid rgba(245,184,30,0.85)"
    : `1px solid rgba(255,255,255,${whiteAlpha})`;
  const outerGlow = legendary
    ? "0 0 26px rgba(245,184,30,0.22)"
    : rarity === "epica"
      ? `0 0 22px rgba(${accent.rgb},0.16)`
      : rarity === "rara"
        ? `0 0 16px rgba(${accent.rgb},0.1)`
        : selected
          ? `0 0 16px rgba(${accent.rgb},0.18)`
          : "none";

  return (
    <article
      data-selected={selected}
      data-rarity={rarity}
      className={`cofre-card theme-dark relative aspect-[5/7] select-none overflow-hidden rounded-lg ${
        featured ? "cofre-card--featured" : ""
      }`}
      style={{
        containerType: "inline-size",
        background: "#0a0f1a",
        border: cardBorder,
        boxShadow: outerGlow,
      }}
    >
      {/* Fondo de carta (cardbg.png): textura navy premium con arcos de luz, el
          "shader al fondo". Se recolorea con hue-rotate: por puesto en general,
          o a ORO en las legendarias (ver positionAccent.bgRotate). */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "url(/cardbg.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: legendary
            ? "hue-rotate(190deg) saturate(1.15)"
            : accent.bgRotate
              ? `hue-rotate(${accent.bgRotate}deg)`
              : undefined,
        }}
      />

      {/* Foco de acento detrás del jugador (antes era un tinte plano arriba). */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[66%]"
        style={{
          background: `radial-gradient(60% 52% at 50% 40%, rgba(${hue},${spotAlpha}), transparent 70%)`,
        }}
      />

      {/* Holo del GRID (no `featured`): gradiente que se desplaza solo en
          `screen`. El shader del REVELADO (holoShader) se pinta al FINAL, encima
          de toda la carta, con la foto re-pintada por encima (ver abajo). */}
      {effects && !featured ? (
        <div
          className="cofre-card-holo pointer-events-none absolute inset-0"
          style={{
            mixBlendMode: "screen",
            backgroundSize: "220% 220%",
            backgroundImage: legendary
              ? "linear-gradient(115deg, transparent 12%, rgba(245,184,30,0.26) 30%, rgba(255,255,255,0.18) 50%, rgba(255,214,120,0.24) 70%, transparent 88%)"
              : `linear-gradient(115deg, transparent 12%, rgba(${accent.rgb},0.22) 28%, rgba(150,120,255,0.2) 40%, rgba(255,255,255,0.16) 50%, rgba(95,227,176,0.2) 60%, rgba(${accent.rgb},0.22) 72%, transparent 88%)`,
          }}
        />
      ) : null}

      <div className="absolute inset-x-[8%] top-[10%] h-[60%]">
        {photo ? (
          <Image
            src={photo}
            alt=""
            fill
            sizes="(max-width: 768px) 34vw, 300px"
            className="object-cover object-top"
            unoptimized
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center font-bold"
            style={{ color: textAccent, fontSize: "22cqw" }}
          >
            {initials(player.name)}
          </span>
        )}
      </div>

      <div
        className="absolute left-[7%] top-[5%] font-bold uppercase tracking-wide"
        style={{
          background: "rgba(255,255,255,0.09)",
          color: textAccent,
          fontSize: "6.3cqw",
          padding: "2.4cqw 4.8cqw",
          borderRadius: "3.4cqw",
        }}
      >
        {player.position}
      </div>
      <div
        className="absolute right-[8%] top-[4%] flex flex-col items-center"
        style={{ gap: "1.2cqw" }}
      >
        <span
          className="font-bold leading-none"
          style={{
            color: "#ffffff",
            textShadow: `0 0 14px rgba(${hue},0.5)`,
            fontSize: "11.6cqw",
          }}
        >
          {formatSigned(points)}
        </span>
        {/* Etiqueta "PTS": el número son PUNTOS totales, no goles (antes había un
            balón ⚽ que confundía). */}
        <span
          className="font-bold uppercase leading-none"
          style={{
            color: textAccent,
            fontSize: "4.4cqw",
            letterSpacing: "0.14em",
            opacity: 0.85,
          }}
        >
          pts
        </span>
      </div>

      {/* Panel inferior: una sola capa anclada abajo, con padding vertical
          concreto y su degradado fundiéndose hacia arriba (superpuesto sobre
          la foto). El contenido manda el alto, sin posiciones mágicas. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 px-[9%] pb-[7.5%] pt-[24%]"
        style={{
          background:
            "linear-gradient(to top, #080c12 32%, rgba(8,12,18,0.9) 62%, rgba(8,12,18,0.45) 82%, transparent 100%)",
        }}
      >
        <div
          className="w-full"
          style={{
            height: "1px",
            marginBottom: "3.4cqw",
            background:
              "linear-gradient(to right, transparent, rgba(255,255,255,0.18), transparent)",
          }}
        />
        <p
          className="line-clamp-1 font-bold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]"
          style={{ fontSize: "8.8cqw" }}
        >
          {player.name}
        </p>
        <div
          className="flex min-w-0 items-center font-semibold text-slate-300"
          style={{ gap: "2.6cqw", marginTop: "2.4cqw", fontSize: "6.86cqw" }}
        >
          <span
            className="block shrink-0 overflow-hidden rounded-sm"
            style={{ width: "10cqw", height: "7.2cqw" }}
          >
            <TeamFlag teamId={player.team} className="h-full w-full" />
          </span>
          <span className="truncate">{team?.name || player.team}</span>
        </div>
      </div>

      {/* Estrella dorada: sello de la legendaria, arriba-centro (fluida en cqw). */}
      {legendary ? (
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2"
          style={{
            top: "3.4%",
            width: "9cqw",
            filter: "drop-shadow(0 0 4px rgba(245,184,30,0.9))",
          }}
        >
          <svg viewBox="0 0 24 24" className="block w-full" fill="#f7c84a">
            <path d="M12 2l2.9 6.1 6.7.8-5 4.6 1.3 6.6-5.9-3.2-5.9 3.2 1.3-6.6-5-4.6 6.7-.8z" />
          </svg>
        </div>
      ) : null}

      {/* Barrido de brillo diagonal por ENCIMA de todo (reflejo de inclinación).
          Solo en el grid (no `featured`): en el revelado de tier alto el único
          brillo es el trainer holo del fondo. */}
      {effects && !featured ? (
        <div
          className="cofre-card-shine pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(110deg, transparent 38%, rgba(255,255,255,0.16) 50%, transparent 62%)",
          }}
        />
      ) : null}

      {/* Shader del REVELADO de tier alto (holoShader): foil dorado + destello a
          TODA la carta, encima de todo, movido por el giroscopio. `screen` AÑADE
          luz dorada dejando ver el fondo (no lo "come" como color-dodge). La
          FOTO del jugador se re-pinta ENCIMA, así queda limpia -> el shader cubre
          toda la carta MENOS la foto (incluida la parte de atrás). */}
      {holoShader ? (
        <>
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              mixBlendMode: "screen",
              filter: "saturate(1.1)",
              backgroundSize: "260% 260%",
              backgroundPosition: "var(--holo-bx, 50%) var(--holo-by, 50%)",
              backgroundImage:
                "repeating-linear-gradient(110deg, rgba(150,112,52,0.1) 0%, rgba(214,170,96,0.2) 18%, rgba(255,228,156,0.38) 30%, rgba(255,249,228,0.55) 36%, rgba(255,228,156,0.38) 42%, rgba(214,170,96,0.2) 54%, rgba(150,112,52,0.1) 72%)",
              WebkitMaskImage:
                "radial-gradient(130% 130% at var(--holo-mx, 50%) var(--holo-my, 50%), #000 0%, rgba(0,0,0,0.6) 100%)",
              maskImage:
                "radial-gradient(130% 130% at var(--holo-mx, 50%) var(--holo-my, 50%), #000 0%, rgba(0,0,0,0.6) 100%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              opacity: 0.3,
              mixBlendMode: "screen",
              backgroundImage:
                "radial-gradient(rgba(255,255,255,0.6) 0.5px, transparent 1.3px), radial-gradient(rgba(255,255,255,0.45) 0.5px, transparent 1.3px)",
              backgroundSize: "6px 6px, 9px 9px",
              backgroundPosition: "0 0, 3px 4px",
              WebkitMaskImage:
                "radial-gradient(55% 55% at var(--holo-mx, 50%) var(--holo-my, 50%), #000 0%, transparent 72%)",
              maskImage:
                "radial-gradient(55% 55% at var(--holo-mx, 50%) var(--holo-my, 50%), #000 0%, transparent 72%)",
            }}
          />
          {/* Foto re-pintada por encima del shader. Con opacidad < 1 deja pasar
              una fracción del shader de debajo -> la cara recibe el holo MUY
              leve (y en movimiento), mientras el resto de la carta lo lleva al
              100%. Sube/baja esta opacidad para más/menos brillo en la foto. */}
          {photo ? (
            <div
              className="pointer-events-none absolute inset-x-[8%] top-[10%] h-[60%]"
              style={{ opacity: 0.8 }}
            >
              <Image
                src={photo}
                alt=""
                fill
                sizes="(max-width: 768px) 34vw, 300px"
                className="object-cover object-top"
                unoptimized
              />
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}
