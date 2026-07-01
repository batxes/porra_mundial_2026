import { MourinhoBattleIntroModal } from "@/components/mourinho-battle-intro-modal";

export const metadata = {
  robots: {
    follow: false,
    index: false,
  },
};

export default function MourinhoDemoPage() {
  return (
    <div className="mx-auto flex min-h-[72vh] w-full max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      <MourinhoBattleIntroModal />
    </div>
  );
}
