import { Suspense } from "react";

import CalibrationClientPage from "./CalibrationClientPage";

export default function CalibrationPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading calibration…</p>
        </main>
      }
    >
      <CalibrationClientPage />
    </Suspense>
  );
}

