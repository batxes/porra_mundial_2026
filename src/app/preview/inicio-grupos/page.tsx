import { notFound } from "next/navigation";

import { HomeGroupReportPreview } from "@/components/home-view";

export default function InicioGruposPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <HomeGroupReportPreview />;
}
