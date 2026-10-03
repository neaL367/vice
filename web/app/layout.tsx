import type { Metadata } from "next";
import { Faculty_Glyphic } from "next/font/google";
import "./globals.css";

const faculty = Faculty_Glyphic({
  variable: "--font-faculty",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Vice — Consistent Super-Resolution Upscaler",
  description:
    "Free private in-browser mathematical upscaler. Original pixels preserved exactly via box kernel inverse.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${faculty.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
