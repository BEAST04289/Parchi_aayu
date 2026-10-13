import type { Metadata } from "next";
import StaffApp from "@/components/staff/StaffApp";

export const metadata: Metadata = { title: "Parchi · Staff workspace" };
// Rendered per request so the optional judges' passcode hint follows the server's current env.
export const dynamic = "force-dynamic";

export default function StaffPage() {
  // SHOW_DEMO_PASSCODE=1 prints the (synthetic-demo) staff passcode on the login screen for judges.
  const demoPasscode = process.env.SHOW_DEMO_PASSCODE === "1" ? process.env.STAFF_PASSCODE ?? null : null;
  return <StaffApp demoPasscode={demoPasscode} />;
}
