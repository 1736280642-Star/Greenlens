"use client";

import dynamic from "next/dynamic";

const DashboardCommandCenter = dynamic(
  () => import("@/features/dashboard-command-center/command-center").then((module) => module.DashboardCommandCenter),
  {
    ssr: false,
    loading: () => <div className="command-center-loading" aria-label="正在加载风险观测站"><span/><span/><span/></div>,
  },
);

export default function DashboardPage() {
  return <DashboardCommandCenter />;
}
