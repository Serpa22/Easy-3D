import type { MetadataRoute } from "next";

/** Manifiesto PWA: permite instalar la app en el móvil o el escritorio. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Easy 3D",
    short_name: "Easy 3D",
    description: "Gestión de tu empresa de impresión 3D y sus sub-empresas.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    lang: "es",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
