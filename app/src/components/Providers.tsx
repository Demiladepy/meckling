"use client";

import { MeraProvider } from "@/lib/mera";

export function Providers({ children }: { children: React.ReactNode }) {
  return <MeraProvider>{children}</MeraProvider>;
}
