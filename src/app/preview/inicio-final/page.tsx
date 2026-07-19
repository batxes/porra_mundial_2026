import { notFound } from "next/navigation";

import { HomeFinalTournamentPreview } from "@/components/home-view";

export default function InicioFinalPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <HomeFinalTournamentPreview />;
}
