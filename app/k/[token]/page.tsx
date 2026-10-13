import type { Metadata } from "next";
import Kiosk from "@/components/kiosk/Kiosk";

export const metadata: Metadata = { title: "Parchi", referrer: "no-referrer" };

export default async function KioskPage({ params }: PageProps<"/k/[token]">) {
  const { token } = await params;
  return <Kiosk token={token} />;
}
