import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "RUMOR Trace — Bluesky Beta",
  description:
    "RUMOR Trace gathers a bounded set of accessible public Bluesky evidence around a post and shows confirmed relationships, wording matches, and explicit coverage limits.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
