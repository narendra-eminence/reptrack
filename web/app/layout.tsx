import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { BackendBanner } from "@/components/BackendBanner";

export const metadata: Metadata = {
  title: "RepScore Pipeline",
  description: "Search Google through SerpAPI or DataForSEO, then verify every result URL.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">
        <AppHeader />
        <BackendBanner />
        <main className="mx-auto max-w-[1440px] px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
