"use client";

import { useMemo, useState } from "react";

import { PlayerAvatar, TeamFlag } from "@/components/common";
import { data, teamsById } from "@/lib/data";
import type { Player, Position } from "@/lib/types";

const positionLabels: Record<Position, string> = {
  POR: "Portero",
  DEF: "Defensa",
  MED: "Centrocampista",
  DEL: "Delantero",
};

type PositionFilter = Position | "all";

const positionTabs: Array<{ id: PositionFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "POR", label: "Portero" },
  { id: "DEF", label: "Defensa" },
  { id: "MED", label: "Centro" },
  { id: "DEL", label: "Delantero" },
];

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function PlayerSearchModal({
  title,
  currentPlayer,
  teamIds,
  onClose,
  onRemove,
  onSelect,
}: {
  title: string;
  currentPlayer?: Player;
  teamIds?: string[];
  onClose: () => void;
  onRemove?: () => void;
  onSelect: (playerId: string) => void;
}) {
  const [activePosition, setActivePosition] = useState<PositionFilter>("all");
  const [query, setQuery] = useState("");

  const visiblePlayers = useMemo(() => {
    const normalized = normalizeSearch(query.trim());
    const teamIdSet = teamIds?.length ? new Set(teamIds) : null;

    return data.players
      .filter((player) => !teamIdSet || teamIdSet.has(player.team))
      .filter(
        (player) =>
          activePosition === "all" || player.position === activePosition,
      )
      .filter((player) => {
        if (!normalized) return true;
        const team = teamsById.get(player.team)?.name || "";
        return normalizeSearch(`${player.name} ${team}`).includes(normalized);
      })
      .sort((a, b) => {
        const teamCompare = (teamsById.get(a.team)?.name || "").localeCompare(
          teamsById.get(b.team)?.name || "",
        );
        return teamCompare || a.name.localeCompare(b.name);
      });
  }, [activePosition, query, teamIds]);

  const groupedPlayers = useMemo(() => {
    const groups = new Map<string, Player[]>();

    visiblePlayers.forEach((player) => {
      const country = teamsById.get(player.team)?.name || "Sin pais";
      groups.set(country, [...(groups.get(country) || []), player]);
    });

    return Array.from(groups.entries());
  }, [visiblePlayers]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-3 py-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex max-h-[78vh] w-full max-w-[440px] flex-col overflow-hidden rounded-2xl bg-white text-slate-950 shadow-2xl">
        <div className="border-b border-slate-100 p-3">
          <div className="grid grid-cols-5 rounded-xl bg-slate-100 p-1">
            {positionTabs.map((position) => (
              <button
                key={position.id}
                type="button"
                aria-pressed={activePosition === position.id}
                onClick={() => setActivePosition(position.id)}
                className={`h-9 rounded-lg px-1 text-[11px] font-bold transition sm:text-xs ${
                  activePosition === position.id
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {position.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-slate-100 px-3 py-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  activePosition === "all"
                    ? "Buscar jugador"
                    : `Buscar ${positionLabels[activePosition].toLowerCase()}`
                }
                className="min-w-0 flex-1 bg-transparent text-base font-medium text-slate-900 outline-none placeholder:text-slate-400"
              />
            </label>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-2 py-1 text-sm font-semibold text-emerald-700"
            >
              Cancelar
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3 pt-2">
          {currentPlayer && onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              className="mb-3 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Quitar jugador
            </button>
          ) : null}

          <div className="space-y-2">
            {groupedPlayers.map(([country, countryPlayers]) => (
              <div key={country} className="space-y-1">
                <div className="flex items-center gap-2 py-1 text-xs font-bold uppercase text-slate-500">
                  <TeamFlag
                    teamId={countryPlayers[0]?.team}
                    className="h-4 w-5 rounded-sm"
                  />
                  <span>{country}</span>
                </div>
                {countryPlayers.map((player) => {
                  const selected = player.id === currentPlayer?.id;

                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => onSelect(player.id)}
                      className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2 py-1.5 text-left transition ${
                        selected ? "bg-emerald-50" : "hover:bg-slate-100"
                      }`}
                    >
                      <PlayerAvatar
                        player={player}
                        className="h-8 w-8 rounded-full bg-slate-100 text-[10px] text-emerald-900"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold leading-4 text-slate-950">
                          {player.name}
                        </p>
                        <p className="text-xs leading-4 text-slate-500">
                          {positionLabels[player.position]} ·{" "}
                          {teamsById.get(player.team)?.name || "Sin pais"}
                        </p>
                      </div>
                      {selected ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Elegido
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}

            {!visiblePlayers.length ? (
              <p className="rounded-xl bg-slate-100 px-3 py-4 text-sm text-slate-500">
                No hay jugadores para esa busqueda.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
