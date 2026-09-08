import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/instrument-sans/wght-italic.css";
import "@fontsource-variable/martian-mono";
import "./globals.css";
import { FleetProvider } from "@/lib/fleet-store";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = {
  title: "Fleet Control — Synthetic Playtest",
  description: "Persona-driven agents playtesting Station Kepler, live.",
};

export const viewport: Viewport = { themeColor: "#07080b", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full min-h-screen antialiased">
        <FleetProvider>
          <div className="relative z-10 flex h-full min-h-screen flex-col">
            <TopBar />
            <main className="flex-1 min-h-0">{children}</main>
          </div>
        </FleetProvider>
      </body>
    </html>
  );
}
