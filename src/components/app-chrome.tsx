"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAppContext } from "@/lib/app-context";
import { Avatar } from "@/components/common";

const links = [
  { href: "/", label: "Inicio" },
  { href: "/como-funciona", label: "Cómo funciona" },
  { href: "/porra", label: "Porra" },
  { href: "/partidos", label: "Partidos" },
  { href: "/clasificacion", label: "Clasificación" },
  { href: "/perfil", label: "Perfil" },
];

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, user, completion, currentScorecard } = useAppContext();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.15),_transparent_32%),linear-gradient(180deg,#020617_0%,#0f172a_55%,#020617_100%)] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-16 sm:px-6 lg:px-8">
        <header className="sticky top-0 z-30 mb-8 pt-4">
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 px-4 py-4 shadow-2xl shadow-black/20 backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center justify-between gap-4">
                <Link href="/" className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400 font-black text-slate-950">26</span>
                  <div>
                    <p className="text-lg font-black tracking-tight">TRILIPORRA</p>
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-400">World Cup 2026 pool</p>
                  </div>
                </Link>

                <div className="lg:hidden">
                  {user ? (
                    <Link href="/perfil" className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-2 text-sm text-slate-200">
                      <Avatar name={user.name} avatarUrl={user.avatarUrl} className="h-8 w-8" />
                      <span>{currentScorecard.total} pts</span>
                    </Link>
                  ) : (
                    <Link href="/perfil" className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">
                      Entrar
                    </Link>
                  )}
                </div>
              </div>

              <nav className="flex flex-wrap gap-2">
                {links.map((link) => {
                  const active = pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`rounded-full px-4 py-2 text-sm transition ${
                        active ? "bg-cyan-400 text-slate-950" : "bg-white/5 text-slate-200 hover:bg-white/10"
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
                {user?.isAdmin ? (
                  <Link
                    href="/admin"
                    className={`rounded-full px-4 py-2 text-sm transition ${
                      pathname === "/admin" ? "bg-cyan-400 text-slate-950" : "bg-white/5 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    Admin
                  </Link>
                ) : null}
              </nav>

              <div className="hidden items-center gap-3 lg:flex">
                {ready ? (
                  user ? (
                    <Link href="/perfil" className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3">
                      <Avatar name={user.name} avatarUrl={user.avatarUrl} />
                      <div className="text-left">
                        <p className="text-sm font-semibold text-white">{user.name}</p>
                        <p className="text-xs text-slate-400">
                          {currentScorecard.total} pts · {completion}% completa
                        </p>
                      </div>
                    </Link>
                  ) : (
                    <Link href="/perfil" className="rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950">
                      Crear cuenta / Entrar
                    </Link>
                  )
                ) : (
                  <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-300">Cargando…</div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
