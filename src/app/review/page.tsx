import { Suspense } from "react";
import { RiskInterpretationWorkspace } from "@/components/interpretation/risk-interpretation-workspace";

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="page"><div className="skeleton skeleton-header"/><div className="panel skeleton-panel"/></div>}>
      <RiskInterpretationWorkspace />
    </Suspense>
  );
}
