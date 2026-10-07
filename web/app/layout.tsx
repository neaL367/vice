import type { Metadata } from "next";
import { Faculty_Glyphic } from "next/font/google";
import "./globals.css";

const display = Faculty_Glyphic({
  variable: "--font-glyphic",
  subsets: ["latin"],
  weight: "400",
});

// ensureStatic navigation: every page in this app is browser-local and fully
// static. Fail the build if dynamic content ever sneaks into a navigation.
export const ensureStatic = "navigation";

export const metadata: Metadata = {
  title: "Vice",
  description: "Browser-local deterministic image enlargement.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
