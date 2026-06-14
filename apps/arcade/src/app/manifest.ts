import type { MetadataRoute } from "next";

/** Installable PWA manifest (docs/07): mobile-first, single-column, dark. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Goldwave Casino",
    short_name: "Goldwave",
    description: "Play arcade games, load up, and cash out.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0e1a",
    theme_color: "#0a0e1a",
    categories: ["games", "entertainment"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
