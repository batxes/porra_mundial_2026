import { notFound } from "next/navigation";

import { HomeTomorrowPreview } from "@/components/home-view";

export default function InicioMananaPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <HomeTomorrowPreview />;
}
