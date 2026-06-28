"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { AuthModal } from "@/components/auth-modal";
import { Avatar } from "@/components/common";
import { HogueraGate } from "@/components/hoguera-gate";
import { OakQuizGate } from "@/components/oak-quiz-gate";
import { PackDropWatcher } from "@/components/pack-drop-notice";
import { ResultsRecapWatcher } from "@/components/results-recap";
import { RuletaGate } from "@/components/ruleta-gate";
import { SoberaQuizGate } from "@/components/sobera-quiz-gate";
import { SuarezDentistGate } from "@/components/suarez-dentist-gate";
import { useAppContext } from "@/lib/app-context";
import {
  cardsChangedEventName,
  countUnopenedPacks,
  countUnopenedPacksRemote,
  secondsUntilNextDailyCard,
} from "@/lib/cofres";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  currentTheme,
  isLightModeEnabled,
  loadSavedTheme,
  saveTheme,
  serverTheme,
  subscribeTheme,
} from "@/lib/theme";

function ThemeToggleButton() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);
  const isDark = theme === "dark";

  // Modo claro desactivado: sin toggle (todos en oscuro).
  if (!isLightModeEnabled()) return null;

  return (
    <button
      type="button"
      onClick={() => saveTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      title={isDark ? "Modo claro" : "Modo oscuro"}
      className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.08] text-zinc-300 transition hover:bg-white/[0.12] hover:text-white"
    >
      {isDark ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      )}
    </button>
  );
}

const links = [
  { href: "/", label: "Inicio" },
  // "Jugar" lleva al proximo partido por jugar (mismo flujo que "Ver
  // partidos" del inicio). `match` mantiene el resaltado activo, ya que
  // usePathname no incluye la query.
  {
    href: "/porra?section=playoffResults&goto=next",
    label: "Jugar",
    match: "/porra",
  },
  { href: "/clasificacion", label: "Clasificación" },
  { href: "/cofres", label: "Sobres" },
  { href: "/como-funciona", label: "Reglas" },
];

function formatPackBadgeCount(count: number) {
  return count > 99 ? "99+" : String(count);
}

function useUnopenedPackCount(userId: string | null, usingSupabase: boolean) {
  const pathname = usePathname();
  const [packCount, setPackCount] = useState<{
    count: number;
    userId: string;
  } | null>(null);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    let timer = 0;
    let run = 0;

    const refresh = () => {
      const runId = (run += 1);
      const supabase = usingSupabase ? getSupabaseBrowserClient() : null;
      if (supabase) {
        void countUnopenedPacksRemote(
          supabase as unknown as { from: (t: string) => unknown },
          userId,
        ).then((nextCount) => {
          if (active && runId === run) setPackCount({ count: nextCount, userId });
        });
        return;
      }
      if (active && runId === run) {
        setPackCount({ count: countUnopenedPacks(userId), userId });
      }
    };

    const scheduleDailyRefresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        refresh();
        scheduleDailyRefresh();
      }, (secondsUntilNextDailyCard() + 2) * 1000);
    };

    const onRefresh = () => refresh();
    const initialTimer = window.setTimeout(refresh, 0);
    scheduleDailyRefresh();
    window.addEventListener("focus", onRefresh);
    window.addEventListener("storage", onRefresh);
    window.addEventListener(cardsChangedEventName, onRefresh);

    return () => {
      active = false;
      window.clearTimeout(initialTimer);
      window.clearTimeout(timer);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener("storage", onRefresh);
      window.removeEventListener(cardsChangedEventName, onRefresh);
    };
  }, [pathname, userId, usingSupabase]);

  return packCount?.userId === userId ? packCount.count : null;
}

type MaintenanceState = {
  maintenance: boolean;
  message: string | null;
  loaded: boolean;
};

// Lee el modo mantenimiento (RPC público) al montar y al volver a foco. En modo
// demo (sin Supabase) nunca hay mantenimiento.
function useMaintenance(usingSupabase: boolean): MaintenanceState {
  const [state, setState] = useState<MaintenanceState>(() => ({
    maintenance: false,
    message: null,
    // En modo demo (sin Supabase) no hay nada que cargar: el estado ya está
    // resuelto (sin mantenimiento). Con Supabase, lo resuelve el efecto.
    loaded: !usingSupabase,
  }));

  useEffect(() => {
    // Sin Supabase no hay mantenimiento: el default (maintenance:false) ya hace
    // que el gate no bloquee, así que no tocamos el estado (evita setState
    // síncrono en el efecto).
    if (!usingSupabase) return;
    const supabase = getSupabaseBrowserClient() as unknown as {
      rpc: (
        fn: string,
        params?: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
    } | null;
    if (!supabase) return;
    let active = true;
    const read = () => {
      void supabase
        .rpc("maintenance_status")
        .then(({ data }) => {
          if (!active) return;
          const row = (Array.isArray(data) ? data[0] : data) as {
            maintenance?: boolean;
            maintenance_message?: string | null;
          } | null;
          setState({
            maintenance: Boolean(row?.maintenance),
            message: row?.maintenance_message ?? null,
            loaded: true,
          });
        })
        .catch(() => {
          if (active) setState((current) => ({ ...current, loaded: true }));
        });
    };
    const timer = window.setTimeout(read, 0);
    const onFocus = () => read();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [usingSupabase]);

  return state;
}

// Pantalla que ven los usuarios (no-admin) con el mantenimiento activo.
function MaintenanceScreen({ message }: { message: string | null }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center text-white">
      <Image
        src="/logo.png"
        alt=""
        width={72}
        height={72}
        className="h-16 w-16 object-contain"
        priority
      />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">
          Estamos en mantenimiento
        </h1>
        <p className="max-w-md text-sm text-zinc-400">
          {message ||
            "Estamos haciendo ajustes en la Triliporra. Volvemos enseguida."}
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-[#a7f600] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#c7ff43]"
      >
        Reintentar
      </button>
    </div>
  );
}

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, setAuthMode, usingSupabase, user } = useAppContext();
  const [authOpen, setAuthOpen] = useState(false);
  const unopenedPackCount = useUnopenedPackCount(user?.id || null, usingSupabase);
  const maintenance = useMaintenance(usingSupabase);

  useEffect(() => {
    loadSavedTheme();
  }, []);

  // Con mantenimiento activo, todos menos el admin ven la pantalla de
  // mantenimiento. Gateamos con `ready` (sabemos ya si eres admin) para no
  // bloquear al admin durante la carga de sesión.
  if (maintenance.loaded && maintenance.maintenance && ready && !user?.isAdmin) {
    return <MaintenanceScreen message={maintenance.message} />;
  }

  return (
    // Los modales globales van fuera del shell: `.app-shell > *` fuerza
    // position relative en sus hijos directos y romperia su `fixed`.
    <>
      <div className="app-shell flex min-h-screen flex-col text-white">
        {!usingSupabase ? (
        <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-bold text-black">
          Modo demo · los datos se guardan solo en este navegador (localStorage)
        </div>
      ) : null}
      {usingSupabase && maintenance.maintenance && user?.isAdmin ? (
        <div className="bg-rose-600 px-4 py-1.5 text-center text-xs font-bold text-white">
          Mantenimiento ACTIVO · solo tú (admin) ves la web. Los demás ven la
          pantalla de mantenimiento.
        </div>
      ) : null}
      <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-[#0d0d0d]/86 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="flex min-w-0 items-center gap-2 sm:gap-3">
              <Image
                src="/logo.png"
                alt=""
                width={42}
                height={42}
                className="theme-logo-dark h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10"
                priority
              />
              <Image
                src="/logo-light.png"
                alt=""
                width={42}
                height={42}
                className="theme-logo-light h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10"
                priority
              />
              <div className="min-w-0">
                <p className="truncate text-base font-bold tracking-tight sm:text-lg">
                  Triliporra
                </p>
                <p className="hidden text-xs font-medium text-zinc-500 sm:block">
                  World Cup 2026
                </p>
              </div>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              {links.map((link) => {
                const active = pathname === (link.match ?? link.href);
                const showPackBadge =
                  link.href === "/cofres" && Boolean(unopenedPackCount);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-label={
                      showPackBadge
                        ? `${link.label}: ${unopenedPackCount} sobres sin abrir`
                        : undefined
                    }
                    // El link con query (?goto=next) no se prefetcha: el
                    // prefetch del segmento cacheado interfiere con el scroll
                    // al proximo partido al navegar desde el menu.
                    prefetch={link.match ? false : undefined}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                      active
                        ? "bg-white text-black"
                        : "text-zinc-300 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {link.label}
                    {showPackBadge ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f5c518] px-1.5 text-[11px] font-extrabold leading-none text-black shadow-[0_0_14px_rgba(245,197,24,0.35)]">
                        {formatPackBadgeCount(unopenedPackCount || 0)}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
              {user?.isAdmin ? (
                <Link
                  href="/admin"
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    pathname === "/admin"
                      ? "bg-white text-black"
                      : "text-zinc-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  Admin
                </Link>
              ) : null}
            </nav>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {user ? (
                <>
                  <Link
                    href="/perfil"
                    aria-label="Perfil"
                    title="Perfil"
                    className={`flex h-10 min-w-0 items-center gap-2 rounded-lg border border-white/10 px-2 transition ${
                      pathname === "/perfil"
                        ? "bg-white/15"
                        : "bg-white/[0.08] hover:bg-white/[0.12]"
                    }`}
                  >
                    <Avatar
                      name={user.name}
                      avatarUrl={user.avatarUrl}
                      className="size-8 rounded-md"
                    />
                    <span className="hidden max-w-24 truncate text-sm font-semibold text-white sm:block">
                      {user.name}
                    </span>
                  </Link>
                  <Link
                    href="/perfil/opciones"
                    aria-label="Opciones"
                    title="Opciones"
                    className={`flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 transition ${
                      pathname === "/perfil/opciones"
                        ? "bg-white/15 text-white"
                        : "bg-white/[0.08] text-zinc-300 hover:bg-white/[0.12] hover:text-white"
                    }`}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    >
                      <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
                      <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.06.06a2.1 2.1 0 1 1-2.98 2.98l-.06-.06a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.08 1.64V21.4a2.1 2.1 0 1 1-4.2 0v-.16A1.8 1.8 0 0 0 8.45 19.6a1.8 1.8 0 0 0-1.98.36l-.06.06a2.1 2.1 0 1 1-2.98-2.98l.06-.06A1.8 1.8 0 0 0 3.85 15a1.8 1.8 0 0 0-1.64-1.08H2.05a2.1 2.1 0 1 1 0-4.2h.16a1.8 1.8 0 0 0 1.64-1.08 1.8 1.8 0 0 0-.36-1.98l-.06-.06a2.1 2.1 0 1 1 2.98-2.98l.06.06a1.8 1.8 0 0 0 1.98.36 1.8 1.8 0 0 0 1.08-1.64V2.24a2.1 2.1 0 1 1 4.2 0v.16a1.8 1.8 0 0 0 1.08 1.64 1.8 1.8 0 0 0 1.98-.36l.06-.06a2.1 2.1 0 1 1 2.98 2.98l-.06.06a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.64 1.08h.16a2.1 2.1 0 1 1 0 4.2h-.16A1.8 1.8 0 0 0 19.4 15Z" />
                    </svg>
                  </Link>
                </>
              ) : ready ? (
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("login");
                    setAuthOpen(true);
                  }}
                  className="rounded-lg bg-[#a7f600] px-2.5 py-2 text-sm font-bold text-black transition hover:bg-[#c7ff43] sm:px-3"
                >
                  Entrar
                </button>
              ) : (
                <div
                  aria-hidden="true"
                  className="flex items-center gap-1.5 sm:gap-2"
                >
                  <div className="h-10 w-12 animate-pulse rounded-lg border border-white/10 bg-white/[0.06] sm:w-28" />
                  <div className="h-10 w-10 animate-pulse rounded-lg border border-white/10 bg-white/[0.06]" />
                </div>
              )}
              <ThemeToggleButton />
            </div>
          </div>

          <nav
            className={`mt-3 grid gap-1 md:hidden ${
              user?.isAdmin ? "grid-cols-6" : "grid-cols-5"
            }`}
          >
            {links.map((link) => {
              const active = pathname === (link.match ?? link.href);
              const showPackBadge =
                link.href === "/cofres" && Boolean(unopenedPackCount);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-label={
                    showPackBadge
                      ? `${link.label}: ${unopenedPackCount} sobres sin abrir`
                      : undefined
                  }
                  prefetch={link.match ? false : undefined}
                  className={`relative inline-flex min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-center text-[11px] font-semibold transition sm:px-2 sm:text-xs ${
                    active
                      ? "bg-white text-black"
                      : "bg-white/[0.08] text-zinc-300"
                  }`}
                >
                  <span className="truncate">{link.label}</span>
                  {showPackBadge ? (
                    <span
                      aria-hidden="true"
                      className={`absolute right-1.5 top-1.5 size-2 rounded-full bg-[#f5c518] ${
                        active ? "ring-2 ring-white" : "ring-2 ring-[#0d0d0d]"
                      }`}
                    />
                  ) : null}
                </Link>
              );
            })}
            {user?.isAdmin ? (
              <Link
                href="/admin"
                className={`inline-flex min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-center text-[11px] font-semibold transition sm:px-2 sm:text-xs ${
                  pathname === "/admin"
                    ? "bg-white text-black"
                    : "bg-white/[0.08] text-zinc-300"
                }`}
              >
                <span className="truncate">Admin</span>
              </Link>
            ) : null}
          </nav>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-24 sm:px-6">
        <main className="flex-1 pt-4">{children}</main>
      </div>
      </div>
      <AuthModal
        defaultMode="login"
        open={authOpen}
        onOpenChange={setAuthOpen}
      />
      <ResultsRecapWatcher />
      <PackDropWatcher launchReady={ready && Boolean(user)} />
      <OakQuizGate />
      <HogueraGate />
      <SuarezDentistGate />
      <SoberaQuizGate />
      <RuletaGate />
    </>
  );
}
