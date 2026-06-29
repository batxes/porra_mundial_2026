import { Suspense } from "react";

import { PredictionView } from "@/components/prediction-view";

export default function PredictionPage() {
  return (
    <Suspense fallback={null}>
      <PredictionView />
    </Suspense>
  );
}
