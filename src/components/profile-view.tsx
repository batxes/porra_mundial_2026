"use client";

import { FormEvent, useMemo, useState } from "react";

import { Avatar, Card, EmptyState, Notice, PredictionSnapshot, PrimaryLink, ScoreBreakdown, SectionHeading } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { schedule } from "@/lib/data";

export function ProfileView() {
  const {
    authBusy,
    authError,
    authMode,
    avatarPresets,
    clearAuthError,
    currentScorecard,
    prediction,
    setAuthMode,
    playerName,
    register,
    savePrediction,
    signIn,
    signOut,
    updateProfile,
    user,
  } = useAppContext();
  const [profileMessage, setProfileMessage] = useState("");
  const [selectedPreset, setSelectedPreset] = useState(user?.avatarUrl?.startsWith("preset:") ? user.avatarUrl.replace("preset:", "") : "green");
  const [customAvatar, setCustomAvatar] = useState(user?.avatarUrl?.startsWith("preset:") ? "" : user?.avatarUrl || "");

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

  const avatarChoices = useMemo(
    () =>
      avatarPresets.map((preset) => ({
        ...preset,
        value: `preset:${preset.id}`,
      })),
    [avatarPresets],
  );

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
                {authBusy ? "Procesando…" : authMode === "register" ? "Crear cuenta" : "Entrar"}
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

  const onProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("displayName") || "").trim();
    const avatarUrl = customAvatar || `preset:${selectedPreset}`;
    await updateProfile({ name, avatarUrl });
    setProfileMessage("Perfil guardado.");
  };

  return (
    <div className="space-y-8">
      <SectionHeading eyebrow="Tu espacio" title="Mi perfil" description="Consulta tus puntos, tu porra y la configuración de tu cuenta." />

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar name={user.name} avatarUrl={user.avatarUrl} className="h-16 w-16" />
            <div>
              <h2 className="text-2xl font-semibold text-white">{user.name}</h2>
              <p className="text-sm text-slate-400">{user.email}</p>
              <p className="mt-1 text-sm text-cyan-300">{currentScorecard.total} puntos</p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={onProfileSubmit}>
            <label className="space-y-2 text-sm text-slate-300">
              <span>Nombre visible</span>
              <input
                name="displayName"
                defaultValue={user.name}
                minLength={2}
                maxLength={40}
                required
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none ring-cyan-400 transition focus:ring-2"
              />
            </label>

            <div className="space-y-3">
              <p className="text-sm text-slate-300">Avatar</p>
              <div className="flex flex-wrap gap-3">
                {avatarChoices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => {
                      setSelectedPreset(choice.id);
                      setCustomAvatar("");
                    }}
                    className={`rounded-2xl border p-2 ${selectedPreset === choice.id && !customAvatar ? "border-cyan-300 bg-cyan-400/10" : "border-white/10 bg-white/5"}`}
                  >
                    <Avatar name={user.name} avatarUrl={choice.value} />
                  </button>
                ))}
              </div>
            </div>

            <label className="space-y-2 text-sm text-slate-300">
              <span>URL de avatar personalizada</span>
              <input
                type="url"
                value={customAvatar}
                onChange={(event) => setCustomAvatar(event.target.value)}
                placeholder="https://..."
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none ring-cyan-400 transition focus:ring-2"
              />
            </label>

            {profileMessage ? <Notice>{profileMessage}</Notice> : null}

            <div className="flex flex-wrap gap-3">
              <button type="submit" className="rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950">
                Guardar perfil
              </button>
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Cerrar sesión
              </button>
              <button
                type="button"
                onClick={async () => {
                  const result = await savePrediction(false);
                  setProfileMessage(result.message);
                }}
                className="rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Guardar borrador
              </button>
            </div>
          </form>
        </Card>

        <PredictionSnapshot prediction={prediction} matches={schedule} playerName={playerName} />
      </div>

      <ScoreBreakdown scorecard={currentScorecard} title="Tus puntos conseguidos" />
    </div>
  );
}
