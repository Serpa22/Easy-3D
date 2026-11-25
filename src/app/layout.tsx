import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Easy 3D", template: "%s · Easy 3D" },
  description:
    "Gestión de tu empresa de impresión 3D: finanzas, pedidos, envíos, máquinas en directo, materiales y energía de cada sub-empresa.",
  applicationName: "Easy 3D",
  appleWebApp: { capable: true, title: "Easy 3D", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const theme = jar.get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
  return (
    <html lang="es" data-theme={theme} className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-fg">{children}</body>
    </html>
  );
}
