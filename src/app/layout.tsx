import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { AppChrome } from "@/components/app-chrome";
import { AppToaster } from "@/components/app-toaster";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { AppProvider } from "@/lib/app-context";
import { themeBootstrapScript } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <AppProvider>
          <AppChrome>{children}</AppChrome>
          <AppToaster />
        </AppProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
