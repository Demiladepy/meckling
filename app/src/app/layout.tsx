import type { Metadata, Viewport } from "next";
import { Fira_Code, Instrument_Sans } from "next/font/google";
import { ServiceWorker } from "./service-worker";
import { Providers } from "@/components/Providers";
import "./globals.css";

// One family for every role (Fey): Instrument Sans, narrowed on display sizes through its width axis.
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans", axes: ["wdth"], display: "swap" });
const mono = Fira_Code({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Mandate",
  description: "AI traders that can't break your rules. Monad checks an agent's limits inside every trade, and a bond pays you back when the market breaks one.",
  applicationName: "Mandate",
  appleWebApp: { capable: true, title: "Mandate", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <ServiceWorker />
      </body>
    </html>
  );
}
