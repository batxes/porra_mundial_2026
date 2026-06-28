import { notFound } from "next/navigation";

import { ProfileChipsPreview } from "@/components/profile-chips-preview";

export default function PerfilChipsPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <ProfileChipsPreview />;
}
