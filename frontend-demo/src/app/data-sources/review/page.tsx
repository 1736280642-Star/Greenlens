import { Suspense } from "react";
import { ReviewWorkspace } from "@/components/review/review-workspace";

export default function QualityReviewPage() {
  return <Suspense fallback={<div className="page"><div className="skeleton skeleton-header"/><div className="panel skeleton-panel"/></div>}>
    <ReviewWorkspace mode="quality" />
  </Suspense>;
}
