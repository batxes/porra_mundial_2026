"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";

import { Avatar, Card, EmptyState, Notice, PredictionSnapshot, PrimaryLink, SectionHeading } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { schedule } from "@/lib/data";

const MAX_AVATAR_BYTES = 1024 * 1024;

function avatarPresetFromUrl(avatarUrl?: string) {
  return avatarUrl?.startsWith("preset:") ? avatarUrl.replace("preset:", "") : "green";
}

function customAvatarFromUrl(avatarUrl?: string) {
  return avatarUrl && !avatarUrl.startsWith("preset:") ? avatarUrl : "";
}

export function ProfileView() {
  const {
    authBusy,
    authError,
    authMode,
    clearAuthError,
    setAuthMode,
    register,
    signIn,
    user,
  } = useAppContext();

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAuthError();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const name = String(form.get("name") || "").trim();

    if (authMode === "register") {
      await register(name, email, password);
      return;
    }

    await signIn(email, password);
  };

  if (!user) {
    return (
      <div className="space-y-8">
        <SectionHeading
          eyebrow="Tu espacio"
          title="Mi perfil"
          description="Desde aquí podrás registrarte, entrar, editar tu perfil y consultar tu puntuación."
        />

        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <Card className="space-y-6">
            <div className="flex gap-2 rounded-full bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setAuthMode("register")}
                className={`flex-1 rounded-full px-4 py-3 text-sm ${authMode === "register" ? "bg-cyan-400 text-slate-950" : "text-slate-200"}`}
              >
                Crear cuenta
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("login")}
                className={`flex-1 rounded-full px-4 py-3 text-sm ${authMode === "login" ? "bg-cyan-400 text-slate-950" : "text-slate-200"}`}
              >
                Entrar
              </button>
            </div>

            <form className="space-y-4" onSubmit={submitAuth}>
              {authMode === "register" ? (
                <label className="space-y-2 text-sm text-slate-300">
                  <span>Nombre visible</span>
                  <input
                    name="name"
                    minLength={2}
                    maxLength={40}
                    required
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none ring-cyan-400 transition focus:ring-2"
                  />
                </label>
              ) : null}

              <label className="space-y-2 text-sm text-slate-300">
                <span>Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none ring-cyan-400 transition focus:ring-2"
                />
              </label>

              <label className="space-y-2 text-sm text-slate-300">
                <span>Contraseña</span>
                <input
                  name="password"
                  type="password"
                  minLength={5}
                  required
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none ring-cyan-400 transition focus:ring-2"
                />
              </label>

              {authError ? <Notice tone="danger">{authError}</Notice> : null}

              <button
                type="submit"
                disabled={authBusy}
                className="w-full rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {authBusy ? "Procesando..." : authMode === "register" ? "Crear cuenta" : "Entrar"}
              </button>
            </form>
          </Card>

          <EmptyState
            icon="26"
            title="Tu puntuación aparece aquí"
            description="Cuando entres podrás ver tu desglose de puntos, editar el perfil y consultar tu porra completa."
            action={<PrimaryLink href="/porra">Ir al editor</PrimaryLink>}
          />
        </div>
      </div>
    );
  }

  return <AuthenticatedProfile key={user.id} />;
}

function AuthenticatedProfile() {
  const { avatarPresets, currentScorecard, prediction, playerName, savePrediction, signOut, updateProfile, user } = useAppContext();

  const persistedAvatarUrl = user?.avatarUrl || "";
  const [profileTab, setProfileTab] = useState<"profile" | "options">("profile");
  const [profileMessage, setProfileMessage] = useState("");
  const [selectedPreset, setSelectedPreset] = useState(avatarPresetFromUrl(persistedAvatarUrl));
  const [customAvatar, setCustomAvatar] = useState(customAvatarFromUrl(persistedAvatarUrl));
  const [uploadedAvatarName, setUploadedAvatarName] = useState(persistedAvatarUrl.startsWith("data:") ? "Avatar subido" : "");
  const [avatarError, setAvatarError] = useState("");

  const avatarChoices = useMemo(
    () =>
      avatarPresets.map((preset) => ({
        ...preset,
        value: `preset:${preset.id}`,
      })),
    [avatarPresets],
  );

  if (!user) return null;

  const onProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("displayName") || "").trim();
    const avatarUrl = customAvatar.trim() || `preset:${selectedPreset || "green"}`;
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

  const avatarPreviewUrl = customAvatar || `preset:${selectedPreset || "green"}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-5 overflow-x-auto border-b border-white/10">
        <button
          type="button"
          onClick={() => setProfileTab("profile")}
          className={`border-b-2 px-1 pb-3 text-sm font-semibold transition ${
            profileTab === "profile" ? "border-[#a7f600] text-white" : "border-transparent text-zinc-500 hover:text-zinc-200"
          }`}
        >
          Perfil
        </button>
        <button
          type="button"
          onClick={() => setProfileTab("options")}
          className={`border-b-2 px-1 pb-3 text-sm font-semibold transition ${
            profileTab === "options" ? "border-[#a7f600] text-white" : "border-transparent text-zinc-500 hover:text-zinc-200"
          }`}
        >
          Opciones
        </button>
      </div>

      <SectionHeading eyebrow="Tu espacio" title="Mi perfil" description="Consulta tus puntos, tu porra y la configuración de tu cuenta." />

      <Card className="space-y-0 p-0">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-5 sm:p-5">
          <Avatar name={user.name} avatarUrl={user.avatarUrl} className="h-16 w-16 rounded-xl sm:h-20 sm:w-20" />
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold text-white sm:text-2xl">{user.name}</h2>
            <p className="truncate text-sm text-slate-400">{user.email}</p>
          </div>
          <div className="col-span-2 rounded-lg border border-[#a7f600]/30 bg-[#a7f600]/10 px-4 py-3 sm:col-auto sm:min-w-40 sm:px-5 sm:py-4 sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#a7f600]">Puntos</p>
            <p className="text-3xl font-black leading-none text-white sm:text-4xl">{currentScorecard.total}</p>
          </div>
        </div>
      </Card>

      {profileTab === "profile" ? (
        <div className="space-y-6">
          <PredictionSnapshot bracketLayout="mobile" prediction={prediction} matches={schedule} playerName={playerName} />
        </div>
      ) : null}

      {profileTab === "options" ? (
        <Card className="space-y-6">
          <div className="flex items-center gap-4">
            <Avatar name={user.name} avatarUrl={avatarPreviewUrl} className="h-14 w-14 rounded-xl sm:h-16 sm:w-16" />
            <div className="min-w-0">
              <h3 className="text-xl font-semibold text-white">Opciones</h3>
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
                className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none ring-cyan-400 transition focus:ring-2"
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
                      selectedPreset === choice.id && !customAvatar ? "border-cyan-300 bg-cyan-400/10" : "border-white/10 bg-white/5"
                    }`}
                  >
                    <Avatar name={user.name} avatarUrl={choice.value} />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm text-slate-300">Subir avatar</p>
              <label className="mt-3 flex cursor-pointer flex-col gap-3 rounded-lg border border-dashed border-white/15 bg-white/5 px-4 py-3 text-sm text-slate-200 transition hover:border-[#a7f600]/50 hover:bg-white/10 sm:flex-row sm:items-center sm:justify-between">
                <span className="truncate">{uploadedAvatarName || "Elegir imagen"}</span>
                <span className="inline-flex shrink-0 justify-center rounded-md bg-white/10 px-3 py-1 text-xs font-semibold text-white">Subir</span>
                <input type="file" accept="image/*" className="sr-only" onChange={handleAvatarUpload} />
              </label>
            </div>

            {avatarError ? <Notice tone="danger">{avatarError}</Notice> : null}
            {profileMessage ? <Notice>{profileMessage}</Notice> : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button type="submit" className="w-full rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 sm:w-auto">
                Guardar perfil
              </button>
              <button
                type="button"
                onClick={() => void signOut()}
                className="w-full rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 sm:w-auto"
              >
                Cerrar sesión
              </button>
              <button
                type="button"
                onClick={async () => {
                  const result = await savePrediction(false);
                  setProfileMessage(result.message);
                }}
                className="w-full rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 sm:w-auto"
              >
                Guardar borrador
              </button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
