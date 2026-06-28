"use client";

import {
  ChangeEvent,
  FormEvent,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { AuthModal } from "@/components/auth-modal";
import {
  Avatar,
  Card,
  CardSkeleton,
  Notice,
  PredictionSnapshot,
  PredictionSnapshotSkeleton,
  ProfileScoreCard,
  ProfileScoreCardSkeleton,
  SectionHeading,
} from "@/components/common";
import { PlayerDetailModal } from "@/components/player-detail-modal";
import { ProfileJornadaFeed } from "@/components/profile-jornada-feed";
import { useAppContext } from "@/lib/app-context";
import { schedule } from "@/lib/data";
import {
  currentTheme,
  isLightModeEnabled,
  saveTheme,
  serverTheme,
  subscribeTheme,
  type ThemePreference,
} from "@/lib/theme";
import type { AuthMode } from "@/lib/types";

// La imagen original se acepta hasta 1 MB como red de seguridad, pero NO se
// guarda tal cual: los avatares solo se ven a ~100px, asi que se reescalan y
// recomprimen a este lado (200px cubre retina 2x) antes de persistirlos. Evita
// meter blobs base64 de ~1,3 MB en profiles.avatar_url, que se lee para todo el
// leaderboard en cada refresco (riesgo de IO en la instancia pequena).
const MAX_AVATAR_BYTES = 1024 * 1024;
// Los GIF se guardan tal cual para no perder la animacion (un canvas solo capta
// el primer fotograma), asi que llevan un tope mas estricto: se almacenan en
// profiles.avatar_url y se leen para todo el leaderboard, conviene acotarlos.
const MAX_GIF_BYTES = 512 * 1024;
const AVATAR_TARGET_PX = 200;

// Reescala (recorte cuadrado centrado) y recomprime una imagen a un data URL
// pequeno. WebP si el navegador lo soporta en canvas; si no, cae a JPEG.
function downscaleAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_TARGET_PX;
        canvas.height = AVATAR_TARGET_PX;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("ctx"));
          return;
        }
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(
          img,
          sx,
          sy,
          side,
          side,
          0,
          0,
          AVATAR_TARGET_PX,
          AVATAR_TARGET_PX,
        );
        let out = canvas.toDataURL("image/webp", 0.85);
        if (!out.startsWith("data:image/webp")) {
          out = canvas.toDataURL("image/jpeg", 0.85);
        }
        resolve(out);
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

// Lee el fichero como data URL sin tocarlo (para GIF animados, que no pasan por
// el canvas para conservar la animacion).
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

const themeOptions: {
  id: ThemePreference;
  label: string;
  description: string;
  swatchClass: string;
}[] = [
  {
    id: "dark",
    label: "Oscuro",
    description: "El aspecto clásico de Triliporra.",
    swatchClass: "border-white/20 bg-[#16212e]",
  },
  {
    id: "light",
    label: "Claro",
    description: "Fondos claros y texto oscuro.",
    swatchClass: "border-black/15 bg-[#f4f6f9]",
  },
];

function ThemeCard() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);

  // Modo claro desactivado: no mostramos la tarjeta de apariencia.
  if (!isLightModeEnabled()) return null;

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold text-white">Apariencia</h3>
        <p className="mt-1 text-sm text-slate-400">
          Elige el tema de la web en este dispositivo.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {themeOptions.map((option) => {
          const active = theme === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => saveTheme(option.id)}
              className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${
                active
                  ? "border-[#a7f600]/70 bg-[#a7f600]/10"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-9 w-9 shrink-0 rounded-full border ${option.swatchClass}`}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">
                  {option.label}
                </span>
                <span className="block truncate text-xs text-slate-400">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function avatarPresetFromUrl(avatarUrl?: string) {
  return avatarUrl?.startsWith("preset:")
    ? avatarUrl.replace("preset:", "")
    : "green";
}

function customAvatarFromUrl(avatarUrl?: string) {
  return avatarUrl && !avatarUrl.startsWith("preset:") ? avatarUrl : "";
}

export function ProfileView() {
  const {
    adminResults,
    currentScorecard,
    leaderboard,
    prediction,
    playerName,
    ready,
    user,
  } = useAppContext();
  const [modalPlayerId, setModalPlayerId] = useState<string | null>(null);

  if (!ready) return <ProfileLoading />;
  if (!user) return <UnauthenticatedProfile />;

  const rankingPosition =
    leaderboard.filter(
      (candidate) =>
        !candidate.isHidden && candidate.points > currentScorecard.total,
    ).length + 1;

  const ownProfile =
    leaderboard.find((candidate) => candidate.id === user.id) || null;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Tu espacio"
        title="Mi perfil"
        description="Consulta tus puntos y tu porra completa."
      />

      <ProfileScoreCard
        name={user.name}
        avatarUrl={user.avatarUrl}
        isPro={user.isPro}
        isWolf={user.isWolf}
        subtitle={user.email}
        scorecard={currentScorecard}
        rank={rankingPosition}
      />

      <PredictionSnapshot
        bracketLayout="mobile"
        editHref="/porra"
        prediction={prediction}
        matches={schedule}
        playerName={playerName}
        results={adminResults}
        scorecard={currentScorecard}
        showBracket={false}
        recorrido={
          ownProfile ? (
            <ProfileJornadaFeed profile={ownProfile} results={adminResults} />
          ) : undefined
        }
        onPlayerClick={setModalPlayerId}
      />

      {modalPlayerId ? (
        <PlayerDetailModal
          playerId={modalPlayerId}
          onClose={() => setModalPlayerId(null)}
        />
      ) : null}
    </div>
  );
}

export function ProfileOptionsView() {
  const { avatarPresets, ready, signOut, updateProfile, user } =
    useAppContext();

  const persistedAvatarUrl = user?.avatarUrl || "";
  const [profileMessage, setProfileMessage] = useState("");
  const [selectedPreset, setSelectedPreset] = useState(
    avatarPresetFromUrl(persistedAvatarUrl),
  );
  const [customAvatar, setCustomAvatar] = useState(
    customAvatarFromUrl(persistedAvatarUrl),
  );
  const [uploadedAvatarName, setUploadedAvatarName] = useState(
    persistedAvatarUrl.startsWith("data:") ? "Avatar subido" : "",
  );
  const [avatarError, setAvatarError] = useState("");

  const avatarChoices = useMemo(
    () =>
      avatarPresets.map((preset) => ({
        ...preset,
        value: `preset:${preset.id}`,
      })),
    [avatarPresets],
  );

  if (!ready) return <ProfileLoading showSnapshot={false} />;
  if (!user) return <UnauthenticatedProfile />;

  const onProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // El input del nombre esta `disabled`, asi que NO viaja en el FormData
    // (queda null). Si mandaramos "" como display_name, el CHECK de la tabla
    // (char_length entre 2 y 40) rechaza TODO el update, incluido el avatar, y
    // el usuario cree que guardo cuando no. Caemos al nombre actual del usuario.
    const name = String(form.get("displayName") || user.name || "").trim();
    const avatarUrl =
      customAvatar.trim() || `preset:${selectedPreset || "green"}`;
    try {
      await updateProfile({ name, avatarUrl });
      setAvatarError("");
      setProfileMessage("Perfil guardado.");
    } catch {
      setProfileMessage("");
      setAvatarError("No se pudo guardar el perfil. Inténtalo de nuevo.");
    }
  };

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setAvatarError("El archivo debe ser una imagen.");
      return;
    }

    // Los GIF se guardan tal cual (animacion intacta) con tope estricto; el
    // resto se reescala a ~6 KB para no inflar la columna del avatar.
    const isGif = file.type === "image/gif";
    if (isGif) {
      if (file.size > MAX_GIF_BYTES) {
        setAvatarError("El GIF animado debe pesar menos de 512 KB.");
        return;
      }
    } else if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError("La imagen debe pesar menos de 1 MB.");
      return;
    }

    try {
      const result = isGif
        ? await readFileAsDataUrl(file)
        : await downscaleAvatar(file);
      setCustomAvatar(result);
      setUploadedAvatarName(file.name);
      setAvatarError("");
      setProfileMessage("");
    } catch {
      setAvatarError("No se pudo procesar la imagen.");
    }
  };

  const avatarPreviewUrl =
    customAvatar || `preset:${selectedPreset || "green"}`;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Tu espacio"
        title="Opciones"
        description="Edita tu nombre, avatar y ajustes de cuenta."
      />

      <Card className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar
            name={user.name}
            avatarUrl={avatarPreviewUrl}
            className="h-14 w-14 rounded-xl sm:h-16 sm:w-16"
          />
          <div className="min-w-0">
            <h3 className="truncate text-xl font-semibold text-white">
              {user.name}
            </h3>
            <p className="truncate text-sm text-slate-400">Nombre y avatar</p>
          </div>
        </div>

        <form className="space-y-6" onSubmit={onProfileSubmit}>
          <label className="block text-sm text-slate-300">
            <span>Nombre visible</span>
            <input
              name="displayName"
              defaultValue={user.name}
              minLength={2}
              maxLength={40}
              required
              disabled
              className="opacity-50 cursor-not-allowed mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-base text-white outline-none ring-cyan-400 transition focus:ring-2"
            />
          </label>

          <div>
            <p className="text-sm text-slate-300">Avatar</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {avatarChoices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => {
                    setSelectedPreset(choice.id);
                    setCustomAvatar("");
                    setUploadedAvatarName("");
                    setAvatarError("");
                    setProfileMessage("");
                  }}
                  className={`rounded-2xl border p-2 ${
                    selectedPreset === choice.id && !customAvatar
                      ? "border-cyan-300 bg-cyan-400/10"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <Avatar name={user.name} avatarUrl={choice.value} />
                </button>
              ))}
            </div>
          </div>

          <div className="inline-block">
            <p className="text-sm text-slate-300">Subir avatar</p>
            <label className="mt-3 flex cursor-pointer flex-col gap-3 rounded-lg border border-dashed border-white/15 bg-white/5 px-4 py-3 text-sm text-slate-200 transition hover:border-[#a7f600]/50 hover:bg-white/10 sm:flex-row sm:items-center sm:justify-between">
              <span className="truncate">
                {uploadedAvatarName || "Elegir imagen"}
              </span>
              <span className="inline-flex shrink-0 justify-center rounded-md bg-white/10 px-3 py-1 text-xs font-semibold text-white">
                Subir
              </span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleAvatarUpload}
              />
            </label>
          </div>

          {avatarError ? <Notice tone="danger">{avatarError}</Notice> : null}
          {profileMessage ? <Notice>{profileMessage}</Notice> : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="submit"
              className="w-full rounded-full bg-[#a7f600] hover:bg-[#acf600] px-5 py-3 text-sm font-semibold text-black sm:w-auto"
            >
              Guardar perfil
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="w-full rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 sm:w-auto"
            >
              Cerrar sesión
            </button>
          </div>
        </form>
      </Card>

      <ThemeCard />
    </div>
  );
}

function ProfileLoading({ showSnapshot = true }: { showSnapshot?: boolean }) {
  return (
    <div className="space-y-6">
      <ProfileScoreCardSkeleton />
      {showSnapshot ? <PredictionSnapshotSkeleton /> : <CardSkeleton />}
    </div>
  );
}

function UnauthenticatedProfile() {
  const { setAuthMode } = useAppContext();
  const [authOpen, setAuthOpen] = useState(true);
  const [authDefaultMode, setAuthDefaultMode] = useState<AuthMode>("login");

  const openAuth = (mode: AuthMode) => {
    setAuthDefaultMode(mode);
    setAuthMode(mode);
    setAuthOpen(true);
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Tu espacio"
        title="Mi perfil"
        description="Entra para ver tus puntos, editar el perfil y consultar tu porra."
      />

      <Card className="max-w-xl space-y-5">
        <div className="rounded-lg border border-[#a7f600]/20 bg-[#a7f600]/10 px-4 py-3 text-sm font-semibold text-lime-100">
          Tu porra se guarda en tu cuenta y podras verla desde cualquier
          dispositivo.
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => openAuth("login")}
            className="rounded-lg bg-[#a7f600] px-5 py-3 text-sm font-bold text-black transition hover:bg-[#c7ff43]"
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => openAuth("register")}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10"
          >
            Crear cuenta
          </button>
        </div>
      </Card>

      <AuthModal
        defaultMode={authDefaultMode}
        open={authOpen}
        onOpenChange={setAuthOpen}
      />
    </div>
  );
}
