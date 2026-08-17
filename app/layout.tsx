import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Navbar } from "@/components/Navbar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CareWeaPredictions — Football Accumulator Lab",
  description:
    "Poisson & Dixon-Coles football analytics. Safe picks (1.15–1.35) and automated high-odds parlays.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full dark`}
    >
      <body className="flex min-h-full flex-col bg-[var(--background)] text-[var(--foreground)] antialiased">
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <Navbar />
        <main id="contenido" className="flex-1">
          {children}
        </main>
        <footer className="border-t border-slate-600/80 py-4 text-center text-sm text-slate-300">
          CareWeaPredictions · Solo fines educativos. El juego puede ser
          adictivo. +18.
        </footer>
      </body>
    </html>
  );
}
