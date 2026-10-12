import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

// ensureStatic navigation: every page in this app is browser-local and fully
// static. Fail the build if dynamic content ever sneaks into a navigation.
export const ensureStatic = "navigation";

export const viewport: Viewport = {
  themeColor: "#171512",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: "Vice — Image Upscaler",
  description: "Enlarge images on-device. No uploads, no AI — clean math, drag to compare.",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
