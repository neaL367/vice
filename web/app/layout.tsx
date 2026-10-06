import type { Metadata } from "next";
import { Faculty_Glyphic } from "next/font/google";
import { ViewTransitionGuard } from "../features/studio/view-transition-guard";
import "./globals.css";

const display = Faculty_Glyphic({
  variable: "--font-glyphic",
  subsets: ["latin"],
  weight: "400",
});

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
      <body>
        <ViewTransitionGuard />
        {children}
      </body>
    </html>
  );
}
