import { Suspense } from "react";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { EvidenceIdentityExceptions } from "@/components/review/evidence-identity-exceptions";

export default function QualityReviewPage() {
  return <><div className="page evidence-identity-review-page"><EvidenceIdentityExceptions /></div><Suspense fallback={<div className="page"><div className="skeleton skeleton-header"/><div className="panel skeleton-panel"/></div>}>
    <ReviewWorkspace mode="quality" />
  </Suspense></>;
}
