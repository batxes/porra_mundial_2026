import { notFound } from "next/navigation";

import { ShootoutPreview } from "@/components/shootout-preview";

export default function TandaPenaltisPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <ShootoutPreview />;
}
