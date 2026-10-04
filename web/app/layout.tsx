import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vice — Consistent Super-Resolution Upscaler",
  description:
    "Free private in-browser mathematical upscaler. Original pixels preserved exactly via box kernel inverse.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
