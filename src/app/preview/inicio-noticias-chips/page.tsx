import { notFound } from "next/navigation";

import { HomeNewsChipsPreview } from "@/components/home-view";

export default function InicioNoticiasChipsPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <HomeNewsChipsPreview />;
}
