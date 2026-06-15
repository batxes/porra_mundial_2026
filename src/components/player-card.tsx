import Image from "next/image";

import { TeamFlag } from "@/components/common";
import { playersById, teamsById } from "@/lib/data";
import { initials, playerPhotoUrl } from "@/lib/format";
import { positionAccent } from "@/lib/position-style";

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

// Carta de jugador compartida: misma pieza para el inventario de /cofres y para
// el revelado del sobre. Recibe solo playerId + points para no acoplarse a
// ningún tipo concreto (InventoryCard, OpeningCard, etc.).
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
}: {
  playerId: string;
  points: number;
  selected?: boolean;
}) {
  const player = playersById.get(playerId);
  if (!player) return null;
  const team = teamsById.get(player.team);
  const photo = playerPhotoUrl(player);
  const accent = positionAccent[player.position];

  return (
    <article
      className="relative aspect-[5/7] overflow-hidden rounded-xl"
      style={{
        containerType: "inline-size",
        background: "linear-gradient(165deg, #17222e, #090d13)",
        boxShadow: `inset 0 0 0 1px rgba(${accent.rgb}, ${
          selected ? 0.85 : 0.3
        }), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 22px rgba(${accent.rgb}, ${
          selected ? 0.32 : 0.12
        })`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-2/3"
        style={{
          background: `radial-gradient(125% 95% at 50% 22%, rgba(${accent.rgb},0.08), transparent 62%)`,
        }}
      />

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
            style={{ color: accent.text, fontSize: "22cqw" }}
          >
            {initials(player.name)}
          </span>
        )}
      </div>

      <div
        className="absolute left-[7%] top-[5%] font-bold uppercase tracking-wide"
        style={{
          background: "rgba(255,255,255,0.09)",
          color: accent.text,
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
            textShadow: `0 0 14px rgba(${accent.rgb},0.5)`,
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
            color: accent.text,
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
    </article>
  );
}
