import type { Metadata } from "next";
import StaffApp from "@/components/staff/StaffApp";

export const metadata: Metadata = { title: "Parchi · Staff workspace" };

export default function StaffPage() {
  return <StaffApp />;
}
