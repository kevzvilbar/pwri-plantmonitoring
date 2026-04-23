"use client";

import { useParams } from "next/navigation";
import Plants from "@/pages/Plants";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <Plants plantId={params?.id} />;
}
