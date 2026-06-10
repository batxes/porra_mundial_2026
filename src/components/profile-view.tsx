"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";

import { AuthModal } from "@/components/auth-modal";
import {
  Avatar,
  Card,
  Notice,
  PredictionSnapshot,
  ProBadge,
  SectionHeading,
} from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { schedule } from "@/lib/data";
import type { AuthMode } from "@/lib/types";

const MAX_AVATAR_BYTES = 1024 * 1024;

function avatarPresetFromUrl(avatarUrl?: string) {
  return avatarUrl?.startsWith("preset:")
    ? avatarUrl.replace("preset:", "")
    : "green";
}

function customAvatarFromUrl(avatarUrl?: string) {
  return avatarUrl && !avatarUrl.startsWith("preset:") ? avatarUrl : "";
}

export function ProfileView() {
  const { currentScorecard, prediction, playerName, user } = useAppContext();

  if (!user) return <UnauthenticatedProfile />;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Tu espacio"
        title="Mi perfil"
        description="Consulta tus puntos y tu porra completa."
      />

      <Card className="space-y-0 p-0">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-5 sm:p-5">
          <Avatar
            name={user.name}
            avatarUrl={user.avatarUrl}
            className="h-16 w-16 rounded-xl sm:h-20 sm:w-20"
          />
          <div className="min-w-0">
            <h2 className="flex min-w-0 items-center gap-2 text-xl font-semibold text-white sm:text-2xl">
              <span className="truncate">{user.name}</span>
              {user.isPro ? <ProBadge size="md" /> : null}
            </h2>
            <p className="truncate text-sm text-slate-400">{user.email}</p>
          </div>
          <div className="col-span-2 rounded-lg border border-[#a7f600]/30 bg-[#a7f600]/10 px-4 py-3 sm:col-auto sm:min-w-40 sm:px-5 sm:py-4 sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#a7f600]">
              Puntos
            </p>
            <p className="text-3xl font-black leading-none text-white sm:text-4xl">
              {currentScorecard.total}
            </p>
          </div>
        </div>
      </Card>

      <PredictionSnapshot
        bracketLayout="mobile"
        editHref="/porra"
        prediction={prediction}
        matches={schedule}
        playerName={playerName}
        showBracket={false}
      />
    </div>
  );
}

export function ProfileOptionsView() {
  const { avatarPresets, signOut, updateProfile, user } = useAppContext();

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
              className="w-full rounded-full bg-[#a7f600] hover:bg-[#acf600] px-5 py-3 text-sm font-semibold text-slate-950 sm:w-auto"
            >
              Guardar perfil
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="w-full rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 sm:w-auto"
            >
              Cerrar sesion
            </button>
          </div>
        </form>
      </Card>
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
            className="rounded-lg bg-[#a7f600] px-5 py-3 text-sm font-black text-black transition hover:bg-[#c7ff43]"
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
