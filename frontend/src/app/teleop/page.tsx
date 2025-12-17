import { Suspense } from "react";

import TeleopClientPage from "./TeleopClientPage";

export default function TeleopPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading teleoperation…</p>
        </main>
      }
    >
      <TeleopClientPage />
    </Suspense>
  );
}

