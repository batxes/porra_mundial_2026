"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { AuthModal } from "@/components/auth-modal";
import { Avatar } from "@/components/common";
import { PackDropWatcher } from "@/components/pack-drop-notice";
import { ResultsRecapWatcher } from "@/components/results-recap";
import { useAppContext } from "@/lib/app-context";
import {
  currentTheme,
  saveTheme,
  serverTheme,
  subscribeTheme,
} from "@/lib/theme";

function ThemeToggleButton() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);
  const isDark = theme === "dark";

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
  { href: "/porra?section=results&goto=next", label: "Jugar", match: "/porra" },
  { href: "/clasificacion", label: "Clasificación" },
  { href: "/cofres", label: "Sobres" },
  { href: "/como-funciona", label: "Reglas" },
];

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, setAuthMode, usingSupabase, user } = useAppContext();
  const [authOpen, setAuthOpen] = useState(false);

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
                return (
                  <Link
                    key={link.href}
                    href={link.href}
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
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  prefetch={link.match ? false : undefined}
                  className={`inline-flex min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-center text-[11px] font-semibold transition sm:px-2 sm:text-xs ${
                    active
                      ? "bg-white text-black"
                      : "bg-white/[0.08] text-zinc-300"
                  }`}
                >
                  <span className="truncate">{link.label}</span>
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
      <PackDropWatcher />
    </>
  );
}
