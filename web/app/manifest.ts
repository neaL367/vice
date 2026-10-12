import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vice — Image Upscaler",
    short_name: "Vice",
    description: "Enlarge images on-device with zero server uploads and zero AI hallucinations.",
    start_url: "/",
    display: "standalone",
    background_color: "#0e0d0c",
    theme_color: "#171512",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
