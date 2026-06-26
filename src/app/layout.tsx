import type { Metadata, Viewport } from "next";
import { Anton, Geist_Mono, Inter, Press_Start_2P } from "next/font/google";
import { AppChrome } from "@/components/app-chrome";
import { AppToaster } from "@/components/app-toaster";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { AppProvider } from "@/lib/app-context";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display deportiva (estilo FUT) para titulares como el banner de sobres.
const anton = Anton({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

const pressStart = Press_Start_2P({
  variable: "--font-pixel",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Triliporra",
  description: "Porra del Mundial 2026 para jugar con amigos.",
  appleWebApp: {
    capable: true,
    title: "Triliporra",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#050505",
};

// Mantenimiento de emergencia SIN tocar la BBDD. Mientras esta activo no se
// monta la app (ni AppProvider, ni AppChrome, ni la pagina), asi que no se hace
// NINGUNA consulta a Supabase: corta la avalancha de peticiones que mantiene la
// base ahogada y muestra una pantalla estatica.
//  - Por codigo: pon DEFAULT_MAINTENANCE = false y haz push para reabrir.
//  - Sin push: define NEXT_PUBLIC_MAINTENANCE = "1" (on) o "0" (off) en Vercel y redeploya.
const DEFAULT_MAINTENANCE = true;
const MAINTENANCE_MODE =
  process.env.NEXT_PUBLIC_MAINTENANCE === "1" ||
  (process.env.NEXT_PUBLIC_MAINTENANCE !== "0" && DEFAULT_MAINTENANCE);

function MaintenanceScreen() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="text-5xl" aria-hidden>
        🛠️
      </div>
      <h1 className="text-2xl font-bold sm:text-3xl">
        Triliporra está en mantenimiento
      </h1>
      <p className="max-w-md text-sm leading-6 text-zinc-400">
        Estamos resolviendo un problema en el servidor. Volvemos enseguida —
        gracias por la paciencia.
      </p>
    </main>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} ${anton.variable} ${pressStart.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {MAINTENANCE_MODE ? (
          <MaintenanceScreen />
        ) : (
          <>
            <AppProvider>
              <AppChrome>{children}</AppChrome>
              <AppToaster />
            </AppProvider>
            <ServiceWorkerRegistration />
          </>
        )}
      </body>
    </html>
  );
}
