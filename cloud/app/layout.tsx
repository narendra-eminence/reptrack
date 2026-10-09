import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { currentUser } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "RepScore Search",
  description: "Run Google searches through SerpAPI for RepScore and keep every run's results.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">
        {me && <AppHeader me={me} />}
        <main className="mx-auto max-w-[1440px] px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
