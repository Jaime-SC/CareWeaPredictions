import type { Metadata, Viewport } from "next";
import { MobileTabBar } from "@/components/MobileTabBar";
import { Navbar } from "@/components/Navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "CareWeaPredictions — Football Accumulator Lab",
  description:
    "Poisson & Dixon-Coles football analytics. Safe picks (1.40–1.85, EV ≥ 3%) and automated high-odds parlays.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ParleyLab",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <body className="flex min-h-dvh w-full max-w-full flex-col overflow-x-clip bg-black text-[#f5f5f7] antialiased">
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <Navbar />
        <main id="contenido" className="app-main-pad w-full min-w-0 flex-1">
          {children}
        </main>
        <footer className="app-footer-mobile-hide border-t border-white/10 py-5 text-center text-xs tracking-wide text-neutral-500">
          CareWeaPredictions · Solo fines educativos. El juego puede ser
          adictivo. +18.
        </footer>
        <MobileTabBar />
      </body>
    </html>
  );
}
