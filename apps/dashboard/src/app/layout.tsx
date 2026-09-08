import type { Metadata, Viewport } from "next";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/instrument-sans/wght-italic.css";
import "@fontsource-variable/martian-mono";
import "./globals.css";
import { FleetProvider } from "@/lib/fleet-store";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = {
  title: "Synthetic Playtest — Testing workspace",
  description: "Persona-driven agents playtesting Station Kepler, live.",
};

export const viewport: Viewport = { themeColor: "#f6f7f9", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full min-h-screen antialiased">
        <a className="skip-link" href="#main-content">Skip to content</a>
        <FleetProvider>
          <div className="relative z-10 flex min-h-screen flex-col">
            <TopBar />
            <main id="main-content" className="flex-1 min-h-0">{children}</main>
          </div>
        </FleetProvider>
      </body>
    </html>
  );
}
