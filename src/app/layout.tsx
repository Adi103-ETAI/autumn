import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Autumn — Spatial Workshop for AI Coding Agents",
  description:
    "Autumn is an open-source spatial canvas for orchestrating multiple AI coding agents. Speak to the Commander; spawn Atlas, Apollo, Orion, Juno; connect them with bus edges; they coordinate via message_peer.",
  keywords: [
    "Autumn",
    "October Desktop",
    "AI agents",
    "Claude Code",
    "Codex",
    "spatial canvas",
    "multi-agent",
  ],
  authors: [{ name: "Autumn" }],
  icons: {
    icon: [
      { url: "/maple-leaf.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/maple-leaf.png", sizes: "512x512" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        {children}
        <Toaster />
        <SonnerToaster />
      </body>
    </html>
  );
}
