"use client";

import Image from "next/image";
import { FormEvent, useEffect, useRef } from "react";

import { Notice } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import type { AuthMode, Prediction } from "@/lib/types";

export function AuthModal({
  defaultMode = "login",
  open,
  onOpenChange,
  predictionToSaveOnRegister,
}: {
  defaultMode?: AuthMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  predictionToSaveOnRegister?: Prediction;
}) {
  const {
    authBusy,
    authError,
    authMode,
    clearAuthError,
    register,
    setAuthMode,
    signIn,
    user,
  } = useAppContext();
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setAuthMode(defaultMode);
      clearAuthError();
    }

    wasOpenRef.current = open;
  }, [clearAuthError, defaultMode, open, setAuthMode]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (open && user) {
      onOpenChange(false);
    }
  }, [onOpenChange, open, user]);

  if (!open) return null;

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAuthError();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "")
      .trim()
      .toLowerCase();
    const password = String(form.get("password") || "");
    const name = String(form.get("name") || "").trim();

    const ok =
      authMode === "register"
        ? await register(name, email, password, predictionToSaveOnRegister)
        : await signIn(email, password);

    if (ok) {
      onOpenChange(false);
    }
  };

  const setMode = (mode: AuthMode) => {
    setAuthMode(mode);
    clearAuthError();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/72 px-4 py-6 backdrop-blur-md"
      style={{ position: "fixed", inset: 0, zIndex: 100 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div className="auth-modal-enter w-full max-w-[430px] overflow-hidden rounded-2xl border border-white/10 bg-[#101010] shadow-2xl shadow-black/60">
        <div className="relative border-b border-white/10 px-5 py-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(167,246,0,0.14),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.045),transparent)]" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Image
                src="/logo.png"
                alt=""
                width={48}
                height={48}
                className="h-11 w-11 shrink-0 object-contain"
              />
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[#a7f600]">
                  Triliporra
                </p>
                <h2
                  id="auth-modal-title"
                  className="mt-1 text-2xl font-semibold tracking-tight text-white"
                >
                  {authMode === "register" ? "Crear cuenta" : "Entrar"}
                </h2>
              </div>
            </div>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => onOpenChange(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.4"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-white/[0.06] p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-md px-4 py-2.5 text-sm font-bold transition ${
                authMode === "login"
                  ? "bg-[#a7f600] text-black"
                  : "text-zinc-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`rounded-md px-4 py-2.5 text-sm font-bold transition ${
                authMode === "register"
                  ? "bg-[#a7f600] text-black"
                  : "text-zinc-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              Crear cuenta
            </button>
          </div>

          {authMode === "register" && predictionToSaveOnRegister ? (
            <Notice>Al crear la cuenta guardaremos esta porra.</Notice>
          ) : null}

          <form className="space-y-4" onSubmit={submitAuth}>
            {authMode === "register" ? (
              <label className="block text-sm font-medium text-zinc-300">
                <span>Nombre visible</span>
                <input
                  name="name"
                  minLength={2}
                  maxLength={40}
                  required
                  className="mt-2 w-full rounded-lg border border-white/10 bg-[#090909] px-4 py-3 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-[#a7f600]/50 focus:ring-2 focus:ring-[#a7f600]/20"
                />
              </label>
            ) : null}

            <label className="block text-sm font-medium text-zinc-300">
              <span>Email</span>
              <input
                name="email"
                type="email"
                required
                className="mt-2 w-full rounded-lg border border-white/10 bg-[#090909] px-4 py-3 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-[#a7f600]/50 focus:ring-2 focus:ring-[#a7f600]/20"
              />
            </label>

            <label className="block text-sm font-medium text-zinc-300">
              <span>Contrasena</span>
              <input
                name="password"
                type="password"
                minLength={5}
                required
                className="mt-2 w-full rounded-lg border border-white/10 bg-[#090909] px-4 py-3 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-[#a7f600]/50 focus:ring-2 focus:ring-[#a7f600]/20"
              />
            </label>

            {authError ? <Notice tone="danger">{authError}</Notice> : null}

            <button
              type="submit"
              disabled={authBusy}
              className="flex w-full items-center justify-center rounded-lg bg-[#a7f600] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#c7ff43] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {authBusy
                ? "Procesando..."
                : authMode === "register"
                  ? "Crear cuenta"
                  : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
