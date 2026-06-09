"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Avatar } from "@/components/common";
import { useAppContext } from "@/lib/app-context";

const links = [
  { href: "/", label: "Inicio" },
  { href: "/porra", label: "Jugar" },
  { href: "/clasificacion", label: "Clasificacion" },
  { href: "/perfil", label: "Perfil" },
];

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, user, completion, currentScorecard } = useAppContext();

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pb-24 sm:px-6">
        <header className="sticky top-0 z-40 bg-[#050505]/88 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
            <Link href="/" className="flex min-w-0 items-center gap-3">
              <Image src="/logo.png" alt="" width={42} height={42} className="h-10 w-10 shrink-0 object-contain" priority />
              <div className="min-w-0">
                <p className="truncate text-lg font-black tracking-tight">Triliporra</p>
                <p className="text-xs font-medium text-zinc-500">World Cup 2026</p>
              </div>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              {links.map((link) => {
                const active = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                      active ? "bg-white text-black" : "text-zinc-300 hover:bg-white/10 hover:text-white"
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
                    pathname === "/admin" ? "bg-white text-black" : "text-zinc-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  Admin
                </Link>
              ) : null}
            </nav>

            <div className="flex shrink-0 items-center gap-2">
              {ready && user ? (
                <Link href="/perfil" className="flex items-center gap-2 rounded-lg bg-white/[0.08] px-2 py-1.5">
                  <Avatar name={user.name} avatarUrl={user.avatarUrl} className="h-8 w-8" />
                  <span className="hidden text-left text-xs leading-4 sm:block">
                    <strong className="block text-white">{currentScorecard.total} pts</strong>
                    <span className="text-zinc-500">{completion}%</span>
                  </span>
                </Link>
              ) : (
                <Link href="/perfil" className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-black">
                  Entrar
                </Link>
              )}
              <Link href="/porra" className="rounded-lg bg-[#a7f600] px-3 py-2 text-sm font-black text-black transition hover:bg-[#c7ff43]">
                Jugar
              </Link>
            </div>
          </div>

          <nav className="mt-3 grid grid-cols-4 gap-1 md:hidden">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg px-2 py-2 text-center text-xs font-semibold transition ${
                    active ? "bg-white text-black" : "bg-white/[0.08] text-zinc-300"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="flex-1 pt-4">{children}</main>
      </div>
    </div>
  );
}
