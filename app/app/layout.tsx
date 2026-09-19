import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Verdikt — the jury signs, the money moves",
  description:
    "Attested payout escrow on Arc. Sponsors lock USDC upfront; an M-of-N jury signs the result; winners withdraw after a clean challenge window.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
