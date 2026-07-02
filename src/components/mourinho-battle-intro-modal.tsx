"use client";

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";

type MourinhoBattleIntroModalProps = {
  startAtSelection?: boolean;
};

const BATTLE_REWARDS = [
  {
    battle: 1,
    image: "/sobre.webp",
    title: "Sobre",
  },
  {
    battle: 2,
    image: "/sobre-delanteros.webp",
    title: "Delanteros",
  },
  {
    battle: 3,
    image: "/sobre-medios.webp",
    title: "Medios",
  },
  {
    battle: 4,
    image: "/sobre-defensas.webp",
    title: "Defensas",
  },
  {
    battle: 5,
    image: "/sobre-estrellas.webp",
    title: "Estrellas",
  },
];

type BattleReward = (typeof BATTLE_REWARDS)[number];

type BattlePokemon = {
  id: string;
  name: string;
  element: string;
  sprite: string;
  spriteBack: string;
};

type BattleSide = "player" | "mourinho";

type BattleMode = "selection" | "battle";

type ActiveBattle = {
  player: BattlePokemon;
  opponent: BattlePokemon;
};

type BattleStats = {
  attack: number;
  defense: number;
  hp: number;
  speed: number;
};

type BattleTurn = {
  attacker: BattleSide;
  critical: boolean;
  damage: number;
  isMiss: boolean;
  remainingHp: {
    player: number;
    mourinho: number;
  };
};

const ELEMENT_COLOR: Record<string, string> = {
  dark: "#a78bfa",
  electric: "#facc15",
  fire: "#f87171",
  light: "#fbbf24",
  poison: "#34d399",
  water: "#60a5fa",
  earth: "#d97706",
  air: "#38bdf8",
  fighting: "#f43f5e",
  normal: "#facc15",
};

const PLAYER_POKEMON: BattlePokemon[] = [
  {
    id: "gengar",
    name: "Gengar",
    element: "dark",
    sprite: "/mourinho-mons/gengar.webp",
    spriteBack: "/mourinho-mons/gengar-back.webp",
  },
  {
    id: "pikachu",
    name: "Pikachu",
    element: "electric",
    sprite: "/mourinho-mons/pikachu.webp",
    spriteBack: "/mourinho-mons/pikachu-back.webp",
  },
  {
    id: "snorlax",
    name: "Snorlax",
    element: "normal",
    sprite: "/mourinho-mons/snorlax.webp",
    spriteBack: "/mourinho-mons/snorlax-back.webp",
  },
  {
    id: "primeape",
    name: "Primeape",
    element: "fighting",
    sprite: "/mourinho-mons/primeape.webp",
    spriteBack: "/mourinho-mons/primeape-back.webp",
  },
  {
    id: "umbreon",
    name: "Umbreon",
    element: "dark",
    sprite: "/mourinho-mons/umbreon.webp",
    spriteBack: "/mourinho-mons/umbreon-back.webp",
  },
];

const MOURINHO_POKEMON: BattlePokemon[] = [
  {
    id: "dragonite",
    name: "Dragonite",
    element: "air",
    sprite: "/mourinho-mons/dragonite.webp",
    spriteBack: "/mourinho-mons/dragonite-back.webp",
  },
  {
    id: "infernape",
    name: "Infernape",
    element: "fire",
    sprite: "/mourinho-mons/infernape.webp",
    spriteBack: "/mourinho-mons/infernape-back.webp",
  },
  {
    id: "alakazam",
    name: "Alakazam",
    element: "light",
    sprite: "/mourinho-mons/alakazam.webp",
    spriteBack: "/mourinho-mons/alakazam-back.webp",
  },
  {
    id: "toxicroak",
    name: "Toxicroak",
    element: "poison",
    sprite: "/mourinho-mons/toxicroak.webp",
    spriteBack: "/mourinho-mons/toxicroak-back.webp",
  },
  {
    id: "garchomp",
    name: "Garchomp",
    element: "earth",
    sprite: "/mourinho-mons/garchomp.webp",
    spriteBack: "/mourinho-mons/garchomp-back.webp",
  },
];

const SPECIAL_BATTLE_BACKGROUNDS: Record<string, string> = {
  alakazam: "/mourinho-peine-vientos-plaza-battle-bg.webp",
  dragonite: "/mourinho-tabakalera-ruins-battle-bg.webp",
  infernape: "/mourinho-concha-battle-bg.webp",
  toxicroak: "/mourinho-miramar-battle-bg.webp",
};

const DEFAULT_BATTLE_BACKGROUND = "/mourinho-stadium-battle-bg.webp";

const PRELOAD_IMAGE_SOURCES = Array.from(
  new Set([
    "/mourinho-rival-sprite.webp",
    "/mourinho-defeated-turtle.webp",
    "/FX/dead/dead-vfx.webp",
    DEFAULT_BATTLE_BACKGROUND,
    ...Object.values(SPECIAL_BATTLE_BACKGROUNDS),
    ...BATTLE_REWARDS.map((reward) => reward.image),
    ...PLAYER_POKEMON.flatMap((pokemon) => [pokemon.sprite, pokemon.spriteBack]),
    ...MOURINHO_POKEMON.flatMap((pokemon) => [pokemon.sprite, pokemon.spriteBack]),
  ]),
);

type PreloadImageState = {
  loaded: number;
  ready: boolean;
  total: number;
};

const preloadedImageCache = new Map<string, Promise<void>>();

const SHARED_BATTLE_STATS: BattleStats = {
  attack: 42,
  defense: 30,
  hp: 240,
  speed: 45,
};

function preloadImageSource(src: string) {
  const cached = preloadedImageCache.get(src);
  if (cached) return cached;

  const promise = new Promise<void>((resolve) => {
    const image = new window.Image();
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;

      if (typeof image.decode === "function") {
        image.decode().catch(() => undefined).finally(resolve);
        return;
      }

      resolve();
    };

    image.decoding = "async";
    image.onload = finish;
    image.onerror = finish;
    image.src = src;

    if (image.complete) finish();
  });

  preloadedImageCache.set(src, promise);
  return promise;
}

function usePreloadImages(sources: readonly string[]): PreloadImageState {
  const [state, setState] = useState<PreloadImageState>(() => {
    const total = new Set(sources).size;

    return {
      loaded: 0,
      ready: total === 0,
      total,
    };
  });

  useEffect(() => {
    let cancelled = false;
    const uniqueSources = Array.from(new Set(sources));

    uniqueSources.forEach((src) => {
      preloadImageSource(src).finally(() => {
        if (cancelled) return;

        setState((current) => {
          const loaded = Math.min(current.loaded + 1, current.total);

          return {
            loaded,
            ready: loaded >= current.total,
            total: current.total,
          };
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [sources]);

  return state;
}

export function MourinhoBattleIntroModal({
  startAtSelection = false,
}: MourinhoBattleIntroModalProps) {
  const preloadState = usePreloadImages(PRELOAD_IMAGE_SOURCES);

  const [accepted, setAccepted] = useState(startAtSelection);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/84 px-3 py-4 text-white backdrop-blur-sm sm:px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mourinho-battle-title"
    >
      <div className="theme-dark relative grid w-full max-w-xl overflow-hidden rounded-2xl border border-[#f5c518]/30 bg-[#05070b] shadow-2xl shadow-black/70">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(245,197,24,0.16),transparent_34%,rgba(56,189,248,0.08)_72%,transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f5c518]/90 to-transparent"
        />

        <div className="relative z-10 grid max-h-[calc(100dvh-32px)] overflow-y-auto">
          {accepted ? (
            <section className="p-3 sm:p-4">
              <PokemonSelectionScreen />
            </section>
          ) : (
            <>
              <section className="relative min-h-[330px] overflow-hidden border-b border-white/10 bg-[#07121f] sm:min-h-[345px]">
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:18px_18px]"
                />
                <div
                  aria-hidden
                  className="absolute inset-0 bg-[radial-gradient(circle_at_50%_58%,rgba(245,197,24,0.24),transparent_31%),linear-gradient(180deg,rgba(6,18,31,0.05),rgba(2,6,10,0.78))]"
                />
                <div
                  aria-hidden
                  className="absolute left-1/2 top-[60%] h-24 w-[72%] -translate-x-1/2 rounded-full border border-[#f5c518]/26 bg-[#122a2f]/70 shadow-[0_0_44px_rgba(245,197,24,0.18)]"
                />
                <div
                  aria-hidden
                  className="absolute left-1/2 top-[61%] h-12 w-[46%] -translate-x-1/2 rounded-full bg-black/42 blur-md"
                />

                <div className="absolute inset-x-0 top-0 z-10 h-[246px] overflow-hidden sm:h-[265px]">
                  <Image
                    src="/mourinho-rival-sprite.webp"
                    alt="Mourinho en pixel art sujetando un balon de combate"
                    width={1024}
                    height={1536}
                    priority
                    unoptimized
                    className="absolute left-1/2 top-1 h-auto w-[320px] max-w-[108%] -translate-x-1/2 drop-shadow-[0_24px_30px_rgba(0,0,0,0.62)] sm:top-0 sm:w-[382px]"
                    style={{ imageRendering: "pixelated" }}
                  />
                </div>

                <div className="absolute inset-x-4 bottom-4 z-20 rounded-xl border-2 border-zinc-950 bg-[#f8fafc] p-3 text-zinc-950 shadow-[0_5px_0_rgba(0,0,0,0.55)] sm:inset-x-6 sm:p-4">
                  <p className="font-[family-name:var(--font-pixel)] text-[10px] leading-5 sm:text-xs sm:leading-6">
                    Mourinho te reta a un combate Pokemon.
                  </p>
                </div>
              </section>

              <section className="flex flex-col justify-start p-4 sm:p-5">
                <IntroCopy
                  onAccept={() => setAccepted(true)}
                  preloadLoaded={preloadState.loaded}
                  preloadReady={preloadState.ready}
                  preloadTotal={preloadState.total}
                />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function IntroCopy({
  onAccept,
  preloadLoaded,
  preloadReady,
  preloadTotal,
}: {
  onAccept: () => void;
  preloadLoaded: number;
  preloadReady: boolean;
  preloadTotal: number;
}) {
  return (
    <div>
      <p className="w-max rounded-full border border-[#f5c518]/36 bg-[#f5c518]/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#f5c518]">
        Reto especial
      </p>
      <h2
        id="mourinho-battle-title"
        className="mt-3 font-[family-name:var(--font-pixel)] text-[18px] leading-[1.35] text-white sm:text-[22px]"
      >
        El entrenador rival aparece.
      </h2>
      <p className="mt-3 text-sm leading-6 text-zinc-300">
        Tendras que jugar 5 batallas. Por cada victoria ganas un sobre y
        avanzas al siguiente duelo.
      </p>

      <RewardTrack />

      <div className="mt-4 flex justify-center">
        <BattleActionButton disabled={!preloadReady} onClick={onAccept}>
          {preloadReady ? "Aceptar reto" : "Cargando..."}
        </BattleActionButton>
      </div>
      {!preloadReady ? (
        <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
          Preparando {preloadLoaded}/{preloadTotal}
        </p>
      ) : null}
    </div>
  );
}

function PokemonSelectionScreen() {
  const [selectedId, setSelectedId] = useState(PLAYER_POKEMON[0].id);
  const [defeatedPlayerIds, setDefeatedPlayerIds] = useState<string[]>([]);
  const [defeatedOpponentIds, setDefeatedOpponentIds] = useState<string[]>([]);
  const [opponentIndex, setOpponentIndex] = useState(0);
  const [mode, setMode] = useState<BattleMode>("selection");
  const [activeBattle, setActiveBattle] = useState<ActiveBattle | null>(null);

  const availablePokemon = PLAYER_POKEMON.filter(
    (pokemon) => !defeatedPlayerIds.includes(pokemon.id),
  );
  const availableOpponentPokemon = MOURINHO_POKEMON.filter(
    (pokemon) => !defeatedOpponentIds.includes(pokemon.id),
  );
  const selected =
    availablePokemon.find((pokemon) => pokemon.id === selectedId) ||
    availablePokemon[0] ||
    PLAYER_POKEMON[0];
  const opponent =
    MOURINHO_POKEMON[opponentIndex] ||
    availableOpponentPokemon[0] ||
    MOURINHO_POKEMON[MOURINHO_POKEMON.length - 1];
  const playerOut = availablePokemon.length === 0;
  const mourinhoOut = availableOpponentPokemon.length === 0;
  const wonRewards = MOURINHO_POKEMON.reduce<BattleReward[]>((rewards, pokemon) => {
    if (!defeatedOpponentIds.includes(pokemon.id)) return rewards;

    const reward = getRewardForOpponent(pokemon);
    if (reward) rewards.push(reward);
    return rewards;
  }, []);
  const canFight =
    !playerOut &&
    !mourinhoOut &&
    !defeatedPlayerIds.includes(selected.id) &&
    !defeatedOpponentIds.includes(opponent.id);

  const startBattle = () => {
    if (!canFight) return;
    setActiveBattle({ player: selected, opponent });
    setMode("battle");
  };

  const finishBattle = useCallback(
    (winner: BattleSide) => {
      if (!activeBattle) return;

      const nextDefeatedPlayerIds =
        winner === "mourinho" && !defeatedPlayerIds.includes(activeBattle.player.id)
          ? [...defeatedPlayerIds, activeBattle.player.id]
          : defeatedPlayerIds;
      const nextDefeatedOpponentIds =
        winner === "player" && !defeatedOpponentIds.includes(activeBattle.opponent.id)
          ? [...defeatedOpponentIds, activeBattle.opponent.id]
          : defeatedOpponentIds;
      const nextAvailablePokemon = PLAYER_POKEMON.filter(
        (pokemon) => !nextDefeatedPlayerIds.includes(pokemon.id),
      );
      const nextOpponentIndex = MOURINHO_POKEMON.findIndex(
        (pokemon) => !nextDefeatedOpponentIds.includes(pokemon.id),
      );

      setDefeatedPlayerIds(nextDefeatedPlayerIds);
      setDefeatedOpponentIds(nextDefeatedOpponentIds);
      setSelectedId((currentId) =>
        nextDefeatedPlayerIds.includes(currentId)
          ? nextAvailablePokemon[0]?.id || currentId
          : currentId,
      );
      if (winner === "player" && nextOpponentIndex >= 0) {
        setOpponentIndex(nextOpponentIndex);
      }
      setActiveBattle(null);
      setMode("selection");
    },
    [activeBattle, defeatedOpponentIds, defeatedPlayerIds],
  );

  if (mode === "battle" && activeBattle) {
    return (
      <BattleArena
        key={`${activeBattle.player.id}-${activeBattle.opponent.id}-${opponentIndex}`}
        player={activeBattle.player}
        opponent={activeBattle.opponent}
        onRoundFinished={finishBattle}
      />
    );
  }

  if (mourinhoOut || playerOut) {
    return <MourinhoBattleFinal rewards={wonRewards} />;
  }

  return (
    <div className="text-center">
      <p className="w-max rounded-full border border-sky-200/30 bg-sky-200/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-sky-200">
        Elige tu Pokemon
      </p>

      <div className="mt-3 overflow-hidden rounded-xl border-2 border-[#6c5ce7]/35 bg-[#151033] shadow-[0_14px_34px_rgba(0,0,0,0.36)]">
        <div className="flex items-center justify-between border-b border-white/8 bg-[#2d2455] px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#f5c518]" />
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-purple-200/60">
              Equipo Mourinho
            </span>
          </div>
          <span className="font-[family-name:var(--font-pixel)] text-[9px] uppercase text-white">
            {mourinhoOut ? "Reto completado" : `${selected.name} vs ${opponent.name}`}
          </span>
        </div>

        <div className="grid grid-cols-5 gap-1.5 border-b border-white/8 bg-[#1f1840] px-2 py-2">
          {MOURINHO_POKEMON.map((pokemon) => {
            const isDefeated = defeatedOpponentIds.includes(pokemon.id);

            return (
              <PokemonSlot
                key={pokemon.id}
                pokemon={pokemon}
                compact
                defeated={isDefeated}
                reward={isDefeated ? getRewardForOpponent(pokemon) : undefined}
                selected={!isDefeated && pokemon.id === opponent.id}
              />
            );
          })}
        </div>

        <BattleFieldPreview player={selected} opponent={opponent} />
      </div>

      <div className="mt-3 flex items-center justify-center gap-3 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-300">
        <span className="rounded-full border border-[#f5c518]/30 bg-[#f5c518]/10 px-2.5 py-1 text-[#f5c518]">
          Sobres {defeatedOpponentIds.length}/5
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
          Pokemon {availablePokemon.length}/5
        </span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#6c5ce7]/40 to-transparent" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-purple-200/55">
          Tu equipo
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#6c5ce7]/40 to-transparent" />
      </div>

      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {PLAYER_POKEMON.map((pokemon) => {
          const isDefeated = defeatedPlayerIds.includes(pokemon.id);
          const isSelected = selected.id === pokemon.id && !isDefeated;

          return (
            <button
              key={pokemon.id}
              type="button"
              disabled={isDefeated}
              onClick={() => setSelectedId(pokemon.id)}
              className={`relative aspect-square overflow-hidden rounded-lg border transition ${
                isDefeated
                  ? "cursor-not-allowed border-white/5 bg-black/35 opacity-70"
                  : isSelected
                    ? "z-10 scale-105 border-white bg-white/12 shadow-[0_0_0_2px_rgba(245,197,24,0.9),0_10px_18px_rgba(0,0,0,0.38)]"
                    : "border-white/10 bg-white/[0.04] hover:scale-105 hover:border-white/25"
              }`}
              style={{
                background: isDefeated
                  ? "linear-gradient(160deg, rgba(255,255,255,0.04), #090a10 70%)"
                  : isSelected
                    ? `linear-gradient(160deg, ${ELEMENT_COLOR[pokemon.element]}45, #1a1e3a 62%, #141828)`
                    : `linear-gradient(160deg, ${ELEMENT_COLOR[pokemon.element]}22, #1a1e3a 62%, #141828)`,
              }}
            >
              <Image
                src={pokemon.sprite}
                alt={pokemon.name}
                fill
                unoptimized
                sizes="80px"
                className="object-contain p-1.5"
                style={{
                  filter: isDefeated
                    ? "grayscale(1) brightness(0.35) contrast(0.85)"
                    : isSelected
                      ? "none"
                      : "grayscale(0.75)",
                  imageRendering: "pixelated",
                }}
              />
              {isDefeated ? (
                <span className="absolute inset-0 z-10 grid place-items-center bg-black/18 font-[family-name:var(--font-pixel)] text-[16px] uppercase leading-none text-zinc-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.85)] sm:text-[18px]">
                  KO
                </span>
              ) : isSelected ? (
                <span className="absolute inset-x-0 bottom-0 bg-[#e3231e] px-1 py-0.5 text-[7px] font-black uppercase leading-none tracking-wide text-white">
                  {pokemon.name}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {availablePokemon.length === 0 ? (
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-red-300">
          No quedan Pokemon disponibles.
        </p>
      ) : null}

      <div className="mt-4 flex justify-center">
        <BattleActionButton disabled={!canFight} onClick={startBattle}>
          Pelear
        </BattleActionButton>
      </div>
    </div>
  );
}

function MourinhoBattleFinal({ rewards }: { rewards: BattleReward[] }) {
  const rewardCount = rewards.length;
  const hasRewards = rewardCount > 0;
  const packLabel = rewardCount === 1 ? "sobre" : "sobres";
  const title = hasRewards ? "Entrenador derrotado" : "Reto terminado";
  const mainText = hasRewards
    ? `Has derrotado ${rewardCount} Pokemon.`
    : "No has derrotado a ningun Pokemon.";
  const rewardText = hasRewards
    ? `Mourinho te da ${rewardCount} ${packLabel} como recompensa.`
    : "Te quedas sin recompensa.";

  return (
    <div className="text-center">
      <p
        className={`mx-auto w-max rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${
          hasRewards
            ? "border-emerald-200/35 bg-emerald-200/10 text-emerald-200"
            : "border-red-200/35 bg-red-200/10 text-red-200"
        }`}
      >
        {title}
      </p>

      <div className="relative mt-3 h-[360px] overflow-hidden rounded-xl border-2 border-[#6c5ce7]/35 bg-[#0b101b] shadow-[0_16px_38px_rgba(0,0,0,0.42)] sm:h-[390px]">
        <BattleBackground />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,7,18,0.18),rgba(3,7,18,0.5)_68%,rgba(3,7,18,0.78))]" />
        <div
          className={`pointer-events-none absolute inset-x-10 bottom-20 h-16 rounded-full blur-2xl ${
            hasRewards ? "bg-emerald-300/12" : "bg-red-300/12"
          }`}
        />

        <Image
          src={hasRewards ? "/mourinho-defeated-turtle.webp" : "/mourinho-rival-sprite.webp"}
          alt={
            hasRewards
              ? "Mourinho derrotado con una tortuga futbolera en brazos"
              : "Mourinho retador en pixel art"
          }
          width={1024}
          height={1536}
          priority
          unoptimized
          className={`absolute left-1/2 z-10 h-auto max-w-[118%] -translate-x-1/2 drop-shadow-[0_18px_24px_rgba(0,0,0,0.65)] ${
            hasRewards
              ? "top-[-8px] w-[335px] sm:top-[-18px] sm:w-[390px]"
              : "top-[-18px] w-[380px] sm:top-[-28px] sm:w-[450px]"
          }`}
          style={{ imageRendering: "pixelated" }}
        />

        <div className="absolute inset-x-4 bottom-4 z-20 rounded-xl border-2 border-zinc-950 bg-[#f8fafc] px-3 py-3 text-zinc-950 shadow-[0_8px_0_rgba(0,0,0,0.35)]">
          <p className="font-[family-name:var(--font-pixel)] text-[11px] leading-5 sm:text-[13px] sm:leading-6">
            {mainText}
          </p>
          <p
            className={`mt-1 text-[11px] font-black uppercase tracking-[0.12em] sm:text-xs ${
              hasRewards ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {rewardText}
          </p>
        </div>
      </div>

      {hasRewards ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {rewards.map((reward) => (
            <div
              key={reward.battle}
              className="w-[92px] rounded-lg border border-emerald-200/20 bg-emerald-200/[0.06] px-1.5 py-2 text-center shadow-[0_8px_18px_rgba(16,185,129,0.08)]"
            >
              <div className="relative mx-auto aspect-[818/1206] w-8">
                <Image
                  src={reward.image}
                  alt={reward.title}
                  fill
                  unoptimized
                  sizes="48px"
                  className="object-contain drop-shadow-[0_8px_14px_rgba(0,0,0,0.5)]"
                />
              </div>
              <p className="mt-1 text-[8px] font-black uppercase leading-tight tracking-wide text-emerald-100">
                {reward.title}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
          Sin sobres desbloqueados
        </p>
      )}

      <div className="mt-5 flex justify-center">
        <Link
          href="/cofres"
          className="relative min-w-[220px] px-12 py-3 text-sm font-black uppercase tracking-widest text-white transition-all duration-200 hover:scale-105"
          style={{
            background:
              "linear-gradient(180deg, #10b981 0%, #059669 50%, #047857 100%)",
            clipPath: "polygon(8% 0%, 100% 0%, 92% 100%, 0% 100%)",
            boxShadow:
              "0 4px 20px rgba(16,185,129,0.4), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -2px 0 rgba(0,0,0,0.2)",
          }}
        >
          Ir a sobres
        </Link>
      </div>
    </div>
  );
}

function BattleFieldPreview({
  player,
  opponent,
}: {
  player: BattlePokemon;
  opponent: BattlePokemon;
}) {
  return (
    <div className="relative aspect-[16/9] overflow-hidden crt-screen">
      <BattleBackground pokemon={opponent} />

      <div className="absolute right-[4%] top-[12%] z-10 flex flex-col items-center">
        <BattleTag label="Mourinho" pokemon={opponent} />
        <PokemonSprite pokemon={opponent} side="front" />
      </div>

      <div className="absolute bottom-[2%] left-[5%] z-10 flex flex-col items-center">
        <PokemonSprite pokemon={player} side="back" large />
        <BattleTag label="Tu" pokemon={player} />
      </div>
    </div>
  );
}

function BattleArena({
  onRoundFinished,
  opponent,
  player,
}: {
  onRoundFinished: (winner: BattleSide) => void;
  opponent: BattlePokemon;
  player: BattlePokemon;
}) {
  const [playerHp, setPlayerHp] = useState(SHARED_BATTLE_STATS.hp);
  const [opponentHp, setOpponentHp] = useState(SHARED_BATTLE_STATS.hp);
  const [attackingSide, setAttackingSide] = useState<BattleSide | null>(null);
  const [hitSide, setHitSide] = useState<BattleSide | null>(null);
  const [critHitSide, setCritHitSide] = useState<BattleSide | null>(null);
  const [criticalFlash, setCriticalFlash] = useState(false);
  const [dodgeSide, setDodgeSide] = useState<BattleSide | null>(null);
  const [damagePopup, setDamagePopup] = useState<{
    critical: boolean;
    damage: number;
    isMiss: boolean;
    side: BattleSide;
  } | null>(null);
  const [faintedSide, setFaintedSide] = useState<BattleSide | null>(null);
  const [poofSide, setPoofSide] = useState<BattleSide | null>(null);
  const [fieldReward, setFieldReward] = useState<BattleReward | null>(null);
  const [winner, setWinner] = useState<BattleSide | null>(null);
  const opponentReward = getRewardForOpponent(opponent);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const turns = createBattleTurns();
    let delay = 650;

    turns.forEach((turn) => {
      const target = turn.attacker === "player" ? "mourinho" : "player";
      const turnDelay = delay;

      timers.push(
        setTimeout(() => {
          setAttackingSide(turn.attacker);
        }, turnDelay),
      );

      timers.push(
        setTimeout(() => {
          setAttackingSide(null);
          if (turn.isMiss) {
            setDodgeSide(target);
          } else {
            setHitSide(target);
            if (turn.critical) {
              setCritHitSide(target);
              setCriticalFlash(true);
              timers.push(setTimeout(() => setCriticalFlash(false), 180));
            }
          }
          setDamagePopup({
            critical: turn.critical,
            damage: turn.damage,
            isMiss: turn.isMiss,
            side: target,
          });
          setPlayerHp(turn.remainingHp.player);
          setOpponentHp(turn.remainingHp.mourinho);
        }, turnDelay + 320),
      );

      timers.push(
        setTimeout(() => {
          setHitSide(null);
          setCritHitSide(null);
          setCriticalFlash(false);
          setDodgeSide(null);
          setDamagePopup(null);
        }, turnDelay + (turn.critical ? 1080 : 760)),
      );

      if (turn.remainingHp.player <= 0 || turn.remainingHp.mourinho <= 0) {
        const loser: BattleSide = turn.remainingHp.player <= 0 ? "player" : "mourinho";
        timers.push(
          setTimeout(() => {
            setFaintedSide(loser);
            setPoofSide(loser);
          }, turnDelay + 860),
        );
        timers.push(
          setTimeout(() => {
            setPoofSide(null);
          }, turnDelay + 1760),
        );
        if (loser === "mourinho" && opponentReward) {
          timers.push(
            setTimeout(() => {
              setFieldReward(opponentReward);
            }, turnDelay + 1820),
          );
        }
      }

      delay += turn.critical ? 1320 : 1080;
    });

    const finalWinner = turns[turns.length - 1]?.remainingHp.player
      ? "player"
      : "mourinho";
    const resultDelay = delay + 1400;

    timers.push(
      setTimeout(() => {
        setWinner(finalWinner);
      }, resultDelay),
    );

    timers.push(
      setTimeout(() => {
        onRoundFinished(finalWinner);
      }, resultDelay + 2600),
    );

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [onRoundFinished, opponent, opponentReward, player]);

  return (
    <div className="text-center">
      <div className="overflow-hidden rounded-xl border-2 border-[#6c5ce7]/35 bg-[#151033] shadow-[0_14px_34px_rgba(0,0,0,0.36)]">
        <div className="relative aspect-[16/9] overflow-hidden crt-screen">
          <BattleBackground pokemon={opponent} />
          {criticalFlash ? (
            <div className="pointer-events-none absolute inset-0 z-30 bg-white/45 animate-crit-flash" />
          ) : null}

          <div className="absolute left-[4%] top-[5%] z-20">
            <HpPlate
              current={opponentHp}
              label="Mourinho"
              max={SHARED_BATTLE_STATS.hp}
              pokemon={opponent}
            />
          </div>

          <div className="absolute bottom-[5%] right-[4%] z-20">
            <HpPlate
              current={playerHp}
              label="Tu"
              max={SHARED_BATTLE_STATS.hp}
              pokemon={player}
            />
          </div>

          <div
            className="absolute right-[7%] top-[20%] z-10 flex flex-col items-center"
          >
            <BattleAnimatedSprite
              damagePopup={damagePopup?.side === "mourinho" ? damagePopup : null}
              isAttacking={attackingSide === "mourinho"}
              isCritHit={critHitSide === "mourinho"}
              isDodging={dodgeSide === "mourinho"}
              isFainted={faintedSide === "mourinho"}
              isHit={hitSide === "mourinho"}
              pokemon={opponent}
              poof={poofSide === "mourinho"}
              reward={fieldReward}
              side="front"
            />
          </div>

          <div
            className="absolute bottom-[5%] left-[5%] z-10 flex flex-col items-center"
          >
            <BattleAnimatedSprite
              damagePopup={damagePopup?.side === "player" ? damagePopup : null}
              isAttacking={attackingSide === "player"}
              isCritHit={critHitSide === "player"}
              isDodging={dodgeSide === "player"}
              isFainted={faintedSide === "player"}
              isHit={hitSide === "player"}
              large
              pokemon={player}
              poof={poofSide === "player"}
              side="back"
            />
          </div>

          {winner ? (
            <div
              className={`absolute inset-0 z-40 flex items-center justify-center ${
                winner === "player"
                  ? "bg-black/12"
                  : "bg-black/38 backdrop-grayscale backdrop-saturate-0"
              }`}
            >
              {winner === "player" ? <VictoryConfetti /> : null}
              <div className="animate-ko-slam relative z-10 px-6 py-5 text-center">
                <p
                  className={`font-[family-name:var(--font-pixel)] text-2xl uppercase leading-9 drop-shadow-[0_4px_0_rgba(0,0,0,0.72)] sm:text-3xl ${
                    winner === "player" ? "text-emerald-200" : "text-red-300"
                  }`}
                >
                  {winner === "player" ? "Victoria" : "Derrota"}
                </p>
                <p
                  className={`mt-3 text-xs font-black uppercase tracking-[0.18em] drop-shadow-[0_2px_0_rgba(0,0,0,0.72)] ${
                    winner === "player" ? "text-emerald-100" : "text-red-200"
                  }`}
                >
                  {winner === "player"
                    ? `Sobre desbloqueado: ${opponent.name}`
                    : `${player.name} queda fuera`}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function VictoryConfetti() {
  const colors = ["#facc15", "#34d399", "#60a5fa", "#f472b6", "#fb923c"];

  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
      {Array.from({ length: 26 }, (_, index) => (
        <span
          key={index}
          className="absolute left-1/2 top-1/2 h-2 w-2 rounded-[1px] opacity-0 motion-safe:animate-[mourinho-confetti-burst_900ms_ease-out_forwards]"
          style={{
            ["--confetti-x" as string]: `${Math.cos((index / 26) * Math.PI * 2) * (80 + (index % 5) * 14)}px`,
            ["--confetti-y" as string]: `${Math.sin((index / 26) * Math.PI * 2) * (38 + (index % 4) * 12)}px`,
            animationDelay: `${(index % 6) * 28}ms`,
            backgroundColor: colors[index % colors.length],
          }}
        />
      ))}
    </div>
  );
}

function FieldReward({ reward }: { reward: BattleReward }) {
  return (
    <div className="pointer-events-none relative z-40 w-14 motion-safe:animate-[mourinho-reward-pop_1300ms_cubic-bezier(0.22,1,0.36,1)_both] sm:w-16">
      <div className="absolute inset-0 rounded-full bg-[#f5c518]/35 blur-xl" />
      <Image
        src={reward.image}
        alt={reward.title}
        width={818}
        height={1206}
        unoptimized
        className="relative z-10 h-auto w-full drop-shadow-[0_10px_18px_rgba(0,0,0,0.65)]"
      />
    </div>
  );
}

function BattleAnimatedSprite({
  damagePopup,
  isAttacking,
  isCritHit,
  isDodging,
  isFainted,
  isHit,
  large = false,
  pokemon,
  poof,
  reward,
  side,
}: {
  damagePopup: {
    critical: boolean;
    damage: number;
    isMiss: boolean;
    side: BattleSide;
  } | null;
  isAttacking: boolean;
  isCritHit: boolean;
  isDodging: boolean;
  isFainted: boolean;
  isHit: boolean;
  large?: boolean;
  pokemon: BattlePokemon;
  poof: boolean;
  reward?: BattleReward | null;
  side: "back" | "front";
}) {
  const animationSide = side === "back" ? "player" : "opponent";
  const hitAnim = isCritHit ? "animate-battle-hit-crit" : isHit ? "animate-battle-hit" : "";
  const spriteAnim = isCritHit
    ? "animate-sprite-damage-crit"
    : isHit
      ? "animate-sprite-damage"
      : "";
  const floatAnim = damagePopup?.critical
    ? "animate-damage-float-crit"
    : "animate-damage-float";

  return (
    <div className="relative">
      {damagePopup ? (
        <div
          className={`pointer-events-none absolute -top-3 left-1/2 z-30 -translate-x-1/2 sm:-top-5 ${floatAnim}`}
        >
          <DamageNumber
            critical={damagePopup.critical}
            damage={damagePopup.damage}
            isMiss={damagePopup.isMiss}
          />
        </div>
      ) : null}

      <div
        className={`relative transition-all duration-200 ${
          isFainted ? "opacity-0 transition-opacity duration-700" : ""
        } ${hitAnim} ${
          isDodging ? `animate-dodge-${animationSide}` : ""
        } ${isAttacking ? `animate-battle-attack-${animationSide}` : ""}`}
      >
        <PokemonSprite
          fainted={isFainted}
          imageClassName={spriteAnim}
          large={large}
          pokemon={pokemon}
          side={side}
        />
      </div>

      {poof ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <DeathVFX color={ELEMENT_COLOR[pokemon.element]} />
        </div>
      ) : null}
      {reward ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
          <FieldReward reward={reward} />
        </div>
      ) : null}
    </div>
  );
}

function DamageNumber({
  critical,
  damage,
  isMiss,
}: {
  critical: boolean;
  damage: number;
  isMiss: boolean;
}) {
  if (isMiss) {
    return (
      <span
        className="text-lg font-black italic sm:text-2xl"
        style={{
          color: "#f87171",
          textShadow: "0 0 8px rgba(248,113,113,0.6), 0 2px 4px rgba(0,0,0,0.9)",
          WebkitTextStroke: "1px rgba(0,0,0,0.6)",
        }}
      >
        MISS!
      </span>
    );
  }

  const color = critical ? "#fbbf24" : "#ffffff";

  return (
    <div className="flex flex-col items-center">
      <span
        className={`${critical ? "text-3xl sm:text-5xl" : "text-xl sm:text-2xl"} font-black tabular-nums`}
        style={{
          color,
          textShadow: `0 0 12px ${color}90, 0 3px 6px rgba(0,0,0,0.9), 0 0 28px ${color}50`,
          WebkitTextStroke: critical ? "2px rgba(0,0,0,0.7)" : "1.5px rgba(0,0,0,0.6)",
        }}
      >
        -{damage}
      </span>
      {critical ? (
        <span
          className="-mt-1 text-xs font-black italic sm:text-sm"
          style={{
            color: "#fbbf24",
            textShadow: "0 0 8px rgba(251,191,36,0.6), 0 2px 4px rgba(0,0,0,0.9)",
            WebkitTextStroke: "1px rgba(0,0,0,0.6)",
          }}
        >
          CRIT!
        </span>
      ) : null}
    </div>
  );
}

function DeathVFX({ color }: { color: string }) {
  return (
    <div
      className="animate-death-vfx scale-[2.4] sm:scale-[3.4]"
      style={{
        backgroundColor: color,
        filter: `drop-shadow(0 0 8px ${color}90)`,
        height: "64px",
        imageRendering: "pixelated",
        maskImage: "url('/FX/dead/dead-vfx.webp')",
        maskSize: "768px 64px",
        WebkitMaskImage: "url('/FX/dead/dead-vfx.webp')",
        WebkitMaskSize: "768px 64px",
        width: "48px",
      }}
    />
  );
}

function BattleBackground({ pokemon }: { pokemon?: BattlePokemon }) {
  const backgroundSrc =
    (pokemon ? SPECIAL_BATTLE_BACKGROUNDS[pokemon.id] : undefined) ||
    DEFAULT_BATTLE_BACKGROUND;

  return (
    <>
      <Image
        src={backgroundSrc}
        alt=""
        fill
        unoptimized
        sizes="560px"
        className="object-cover"
        style={{ imageRendering: "pixelated", objectPosition: "center bottom" }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,22,40,0.22),rgba(15,22,40,0.06)_45%,rgba(15,22,40,0.26))]" />
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.08)_0_1px,transparent_1px_4px)] opacity-20" />
    </>
  );
}

function BattleActionButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`relative min-w-[220px] px-12 py-3 text-sm font-black uppercase tracking-widest text-white transition-all duration-200 ${
        disabled ? "cursor-not-allowed opacity-40" : "hover:scale-105"
      }`}
      style={{
        background: disabled
          ? "linear-gradient(180deg, #2a2255 0%, #1e1840 100%)"
          : "linear-gradient(180deg, #10b981 0%, #059669 50%, #047857 100%)",
        clipPath: "polygon(8% 0%, 100% 0%, 92% 100%, 0% 100%)",
        boxShadow: disabled
          ? "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.3)"
          : "0 4px 20px rgba(16,185,129,0.4), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -2px 0 rgba(0,0,0,0.2)",
      }}
    >
      {children}
    </button>
  );
}

function HpPlate({
  current,
  label,
  max,
  pokemon,
}: {
  current: number;
  label: string;
  max: number;
  pokemon: BattlePokemon;
}) {
  const pct = Math.max(0, Math.min(100, (current / max) * 100));
  const color = pct > 50 ? "#48d067" : pct > 20 ? "#f5c842" : "#f54242";

  return (
    <div className="w-[150px] rounded-lg bg-black/62 px-2.5 py-2 text-left backdrop-blur-sm sm:w-[190px]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[9px] font-black uppercase tracking-[0.12em] text-white">
          {pokemon.name}
        </span>
        <span className="text-[8px] font-bold uppercase text-white/55">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[8px] font-black text-white/50">HP</span>
        <div className="h-2 flex-1 overflow-hidden border border-white/10 bg-[#0f1120] [transform:skewX(-22deg)]">
          <div
            className="h-full transition-all duration-700"
            style={{
              background: `linear-gradient(180deg, ${color}, ${color}bb)`,
              boxShadow: `0 0 8px ${color}80`,
              width: `${pct}%`,
            }}
          />
        </div>
      </div>
      <p className="mt-1 text-right text-[8px] font-bold text-white/45">
        {Math.max(0, Math.round(current))}/{max}
      </p>
    </div>
  );
}

function createBattleTurns() {
  const turns: BattleTurn[] = [];
  let playerHp = SHARED_BATTLE_STATS.hp;
  let mourinhoHp = SHARED_BATTLE_STATS.hp;

  while (playerHp > 0 && mourinhoHp > 0 && turns.length < 28) {
    const first =
      SHARED_BATTLE_STATS.speed + Math.random() * 18 >=
      SHARED_BATTLE_STATS.speed + Math.random() * 18
        ? "player"
        : "mourinho";
    const order: BattleSide[] =
      first === "player" ? ["player", "mourinho"] : ["mourinho", "player"];

    for (const attacker of order) {
      if (playerHp <= 0 || mourinhoHp <= 0) break;

      const isMiss = Math.random() < 0.1;
      const critical = !isMiss && Math.random() < 0.18;
      const damage = isMiss ? 0 : calculateSharedDamage(critical);

      if (attacker === "player") {
        mourinhoHp = Math.max(0, mourinhoHp - damage);
      } else {
        playerHp = Math.max(0, playerHp - damage);
      }

      turns.push({
        attacker,
        critical,
        damage,
        isMiss,
        remainingHp: {
          player: playerHp,
          mourinho: mourinhoHp,
        },
      });
    }
  }

  return turns;
}

function calculateSharedDamage(critical: boolean) {
  const variance = 0.86 + Math.random() * 0.28;
  const criticalBonus = critical ? 1.55 : 1;
  const raw =
    (SHARED_BATTLE_STATS.attack * 1.85 - SHARED_BATTLE_STATS.defense * 0.65) *
    variance *
    criticalBonus;

  return Math.max(24, Math.round(raw));
}

function getRewardForOpponent(pokemon: BattlePokemon) {
  const index = MOURINHO_POKEMON.findIndex((candidate) => candidate.id === pokemon.id);
  return index >= 0 ? BATTLE_REWARDS[index] : undefined;
}

function PokemonSlot({
  compact = false,
  defeated = false,
  pokemon,
  reward,
  selected,
}: {
  compact?: boolean;
  defeated?: boolean;
  pokemon: BattlePokemon;
  reward?: BattleReward;
  selected?: boolean;
}) {
  return (
    <div
      className={`relative aspect-square rounded-lg border bg-white/[0.035] ${
        defeated
          ? "border-white/5 bg-black/35 opacity-70"
          : selected
            ? "border-[#f5c518]/65"
            : "border-white/10"
      }`}
      style={{
        background: defeated
          ? "linear-gradient(160deg, rgba(255,255,255,0.04), #090a10 70%)"
          : `linear-gradient(160deg, ${ELEMENT_COLOR[pokemon.element]}25, #141828 70%)`,
      }}
    >
      <Image
        src={pokemon.sprite}
        alt={pokemon.name}
        fill
        unoptimized
        sizes={compact ? "56px" : "72px"}
        className="object-contain p-1"
        style={{
          filter: defeated ? "grayscale(1) brightness(0.35) contrast(0.85)" : "none",
          imageRendering: "pixelated",
        }}
      />
      {defeated ? (
        <span className="absolute inset-0 z-10 grid place-items-center bg-black/18 font-[family-name:var(--font-pixel)] text-[13px] uppercase leading-none text-zinc-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.85)] sm:text-[15px]">
          KO
        </span>
      ) : null}
      {reward ? (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <div className="relative w-[42%] motion-safe:animate-[mourinho-reward-pop_900ms_cubic-bezier(0.22,1,0.36,1)_both]">
            <div className="absolute inset-0 rounded-full bg-[#f5c518]/30 blur-md" />
            <Image
              src={reward.image}
              alt={reward.title}
              width={818}
              height={1206}
              unoptimized
              className="relative z-10 h-auto w-full drop-shadow-[0_5px_10px_rgba(0,0,0,0.75)]"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PokemonSprite({
  fainted = false,
  imageClassName = "",
  large = false,
  pokemon,
  side,
}: {
  fainted?: boolean;
  imageClassName?: string;
  large?: boolean;
  pokemon: BattlePokemon;
  side: "back" | "front";
}) {
  const src = side === "back" ? pokemon.spriteBack : pokemon.sprite;
  return (
    <div
      className={`relative ${
        large
          ? "h-28 w-32 sm:h-36 sm:w-40"
          : "h-24 w-28 sm:h-[120px] sm:w-[136px]"
      }`}
    >
      <Image
        src={src}
        alt={pokemon.name}
        fill
        unoptimized
        sizes={large ? "160px" : "136px"}
        className={`object-contain ${imageClassName}`}
        style={{
          filter: fainted
            ? "grayscale(1) brightness(0.45)"
            : `drop-shadow(0 0 10px ${ELEMENT_COLOR[pokemon.element]}55)`,
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
}

function BattleTag({
  label,
  pokemon,
}: {
  label: string;
  pokemon: BattlePokemon;
}) {
  return (
    <div className="mb-1 flex items-center gap-1.5 rounded-lg bg-black/55 px-2 py-1 backdrop-blur-sm">
      <span
        className="h-3.5 w-3.5 rounded-full"
        style={{ backgroundColor: ELEMENT_COLOR[pokemon.element] }}
      />
      <span className="text-[9px] font-bold text-white/90">{label}</span>
      <span className="text-[9px] font-semibold text-white/55">
        {pokemon.name}
      </span>
    </div>
  );
}

function RewardTrack() {
  return (
    <div className="mt-4 grid grid-cols-5 gap-2">
      {BATTLE_REWARDS.map((reward) => (
        <div
          key={reward.battle}
          className="min-h-[94px] rounded-lg border border-white/10 bg-white/[0.035] px-1.5 py-2 text-center"
        >
          <div className="relative mx-auto aspect-[818/1206] w-7">
            <Image
              src={reward.image}
              alt=""
              fill
              unoptimized
              sizes="48px"
              className="object-contain drop-shadow-[0_8px_14px_rgba(0,0,0,0.4)]"
            />
          </div>
          <p className="mt-1 font-[family-name:var(--font-display)] text-lg leading-none text-white">
            {reward.battle}
          </p>
          <p className="mt-1 text-[8px] font-bold uppercase leading-tight text-zinc-400">
            {reward.title}
          </p>
        </div>
      ))}
    </div>
  );
}
