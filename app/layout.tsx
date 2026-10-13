import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

// next/font downloads these at build time and serves them from our own origin (self-hosted).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const deva = Noto_Sans_Devanagari({ variable: "--font-deva", subsets: ["devanagari", "latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "Parchi",
  description: "Synthetic hackathon prototype: patient intake to a source-linked clinician brief.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F6F7F4" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${deva.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
