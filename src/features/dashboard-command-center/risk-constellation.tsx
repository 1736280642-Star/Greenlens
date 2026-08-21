"use client";

import dynamic from "next/dynamic";
import { Box, Grid3X3, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { CommandPanelHeading } from "./panel-heading";
import { RiskConstellationFallback } from "./risk-constellation-fallback";
import type { DashboardRiskNode, DashboardTriadCode } from "@/types";

const RiskConstellation3D = dynamic(() => import("./risk-constellation-3d"), { ssr: false });

function canUseThree() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 901) return false;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (deviceMemory != null && deviceMemory <= 4) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function RiskConstellation({ nodes, selectedFactor, selectedCompanyId, onSelect, onOpen, expanded = false, onExpand }: {
  nodes: DashboardRiskNode[];
  selectedFactor: DashboardTriadCode | null;
  selectedCompanyId: string | null;
  onSelect: (companyId: string, addToCompare: boolean) => void;
  onOpen: (companyId: string) => void;
  expanded?: boolean;
  onExpand?: () => void;
}) {
  const [mode, setMode] = useState<"flat" | "loading" | "3d">("flat");
  const [capable, setCapable] = useState(false);

  useEffect(() => {
    let idleId: number | null = null;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const capabilityTimer = window.setTimeout(() => {
      const supported = canUseThree();
      setCapable(supported);
      if (!supported) return;
      const load = () => setMode("loading");
      idleId = idleWindow.requestIdleCallback ? idleWindow.requestIdleCallback(load, { timeout: 1200 }) : idleWindow.setTimeout(load, 500);
    }, 0);
    return () => {
      window.clearTimeout(capabilityTimer);
      if (idleId == null) return;
      if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleId);
      else idleWindow.clearTimeout(idleId);
    };
  }, []);

  useEffect(() => {
    if (mode !== "loading") return;
    const timer = window.setTimeout(() => setMode("3d"), 120);
    return () => window.clearTimeout(timer);
  }, [mode]);

  return <section className={`cc-panel cc-constellation-panel ${expanded ? "cc-panel-expanded" : ""}`}>
    <CommandPanelHeading eyebrow={mode === "3d" ? "RISK FIELD · SPATIAL" : "RISK FIELD · FLAT"} title="漂绿风险星图" detail={expanded ? `${nodes.length} 个公司节点 · 风险仅为待复核信号` : undefined} action={<button className="cc-mode-switch" onClick={() => setMode((current) => current === "3d" ? "flat" : capable ? "loading" : "flat")} disabled={!capable && mode === "flat"} title={capable ? "切换二维/三维视图" : "当前设备已使用二维低负载模式"}>{mode === "3d" ? <Grid3X3/> : mode === "loading" ? <LoaderCircle className="spin"/> : <Box/>}{mode === "3d" ? "Flat" : capable ? "3D" : "2D"}</button>} onExpand={expanded ? undefined : onExpand} expandLabel="展开漂绿风险星图"/>
    <div className="cc-risk-stage">
      <RiskConstellationFallback nodes={nodes} selectedFactor={selectedFactor} selectedCompanyId={selectedCompanyId} onSelect={onSelect} embedded/>
      {mode === "3d" ? <div className="cc-risk-3d-layer"><RiskConstellation3D nodes={nodes} selectedFactor={selectedFactor} selectedCompanyId={selectedCompanyId} onSelect={onSelect} onOpen={onOpen}/></div> : null}
      {mode === "loading" ? <div className="cc-risk-loading"><LoaderCircle/><span>正在构建空间索引</span></div> : null}
      <div className="cc-risk-legend"><span><i className="high"/>高风险</span><span><i className="medium"/>中风险</span><span><i className="low"/>低风险</span>{expanded ? <small>风险仅为待复核信号</small> : null}</div>
    </div>
  </section>;
}
