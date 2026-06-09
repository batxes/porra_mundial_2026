import { PublicProfileView } from "@/components/public-profile-view";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <PublicProfileView userId={decodeURIComponent(id)} />;
}
