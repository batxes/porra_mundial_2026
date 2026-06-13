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
import { useAppContext } from "@/lib/app-context";
import { schedule } from "@/lib/data";
import {
  currentTheme,
  saveTheme,
  serverTheme,
  subscribeTheme,
  type ThemePreference,
} from "@/lib/theme";
import type { AuthMode } from "@/lib/types";

const MAX_AVATAR_BYTES = 1024 * 1024;

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

  if (!ready) return <ProfileLoading />;
  if (!user) return <UnauthenticatedProfile />;

  const rankingPosition =
    leaderboard.filter(
      (candidate) =>
        !candidate.isHidden && candidate.points > currentScorecard.total,
    ).length + 1;

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
      />
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
    const name = String(form.get("displayName") || "").trim();
    const avatarUrl =
      customAvatar.trim() || `preset:${selectedPreset || "green"}`;
    await updateProfile({ name, avatarUrl });
    setAvatarError("");
    setProfileMessage("Perfil guardado.");
  };

  const handleAvatarUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setAvatarError("El archivo debe ser una imagen.");
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError("La imagen debe pesar menos de 1 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      setCustomAvatar(result);
      setUploadedAvatarName(file.name);
      setAvatarError("");
      setProfileMessage("");
    };
    reader.onerror = () => setAvatarError("No se pudo leer la imagen.");
    reader.readAsDataURL(file);
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
              className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-base text-white outline-none ring-cyan-400 transition focus:ring-2"
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
