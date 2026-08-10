"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Building2,
  ChartNoAxesCombined,
  Command,
  Database,
  FileSearch,
  FlaskConical,
  GitCompareArrows,
  Leaf,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useDemoStore } from "@/stores/demo-store";
import { analysisRepositoryMode } from "@/repositories";
import { GlobalLayers } from "@/components/global-layers";

const nav = [
  { href: "/dashboard", label: "概览", caption: "Dashboard", icon: ChartNoAxesCombined },
  { href: "/companies", label: "企业", caption: "Companies", icon: Building2 },
  { href: "/compare", label: "对比", caption: "Compare", icon: GitCompareArrows },
  { href: "/reports", label: "报告检测", caption: "Reports", icon: FileSearch },
  { href: "/review", label: "复核", caption: "Review", icon: FlaskConical },
  { href: "/data-sources", label: "数据源", caption: "Sources", icon: Database },
  { href: "/methodology", label: "方法", caption: "Methodology", icon: Command },
];

const pageTitles: Record<string, string> = {
  dashboard: "风险总览",
  companies: "企业库",
  compare: "对比分析",
  reports: "报告检测",
  review: "风险复核工作台",
  "data-sources": "数据源",
  methodology: "方法与模型",
};

function subscribeToStoreHydration(onStoreChange: () => void) {
  const persistApi = useDemoStore.persist;
  if (!persistApi) return () => undefined;
  const unsubscribeStart = persistApi.onHydrate(onStoreChange);
  const unsubscribeFinish = persistApi.onFinishHydration(onStoreChange);
  return () => {
    unsubscribeStart();
    unsubscribeFinish();
  };
}

function getStoreHydrationSnapshot() {
  return useDemoStore.persist?.hasHydrated() ?? false;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [industries, setIndustries] = useState<string[]>([]);
  const [years, setYears] = useState<number[]>(analysisRepositoryMode === "mock" ? [2025, 2024] : []);
  const filtersReady = useSyncExternalStore(
    subscribeToStoreHydration,
    getStoreHydrationSnapshot,
    () => false,
  );
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/v1/industries", { cache: "no-store" }),
      fetch("/api/v1/panel/year-summaries", { cache: "no-store" }),
    ])
      .then(([industriesResponse, yearsResponse]) => Promise.all([industriesResponse.json(), yearsResponse.json()]))
      .then(([industryPayload, yearPayload]: [{ industries?: string[] }, Array<{ year: number }>]) => {
        if (!active) return;
        setIndustries(industryPayload.industries ?? []);
        setYears([...new Set(yearPayload.map((item) => item.year))].filter((item) => item >= 2016).sort((a, b) => b - a));
      })
      .catch(() => { if (active) setIndustries([]); });
    return () => { active = false; };
  }, []);
  const { year, industry, risk, setFilters, openDrawer, notifications, reset, showToast, selectedCompanyId, selectedReportYear, selectedEvidenceId } = useDemoStore();
  const filtersInteractive = filtersReady || years.length > 0;
  const root = pathname.split("/")[1] || "dashboard";
  const title = root === "companies" && pathname.split("/").length > 2 ? "企业分析" : pageTitles[root];

  const openGreenLens = useCallback(() => {
    if (pathname.startsWith("/review")) {
      const reviewQuery = new URLSearchParams(location.search);
      reviewQuery.set("assistant", reviewQuery.get("assistant") === "closed" ? "open" : "closed");
      router.push(`/review?${reviewQuery}`);
      return;
    }
    const query = new URLSearchParams({ assistant: "open" });
    if (selectedCompanyId) query.set("companyId", selectedCompanyId);
    if (selectedReportYear) query.set("year", String(selectedReportYear));
    if (selectedEvidenceId) query.set("evidence", selectedEvidenceId);
    router.push(`/review?${query}`);
  }, [pathname, router, selectedCompanyId, selectedEvidenceId, selectedReportYear]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openDrawer("command");
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        openGreenLens();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDrawer, openGreenLens]);

  const activeHref = useMemo(() => nav.find((item) => pathname.startsWith(item.href))?.href, [pathname]);

  function resetDemo() {
    reset();
    showToast("筛选与工作区状态已重置");
    router.push("/dashboard");
  }

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`} aria-label="主导航">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><Leaf size={18} /></span>
          {!collapsed && <span><strong>GreenLens</strong><small>绿色证据雷达</small></span>}
          <button className="icon-button mobile-close" onClick={() => setMobileNav(false)} aria-label="关闭导航" title="关闭导航"><X /></button>
        </div>
        <nav className="primary-nav">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = activeHref === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "active" : ""}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                onClick={() => setMobileNav(false)}
                title={item.label}
              >
                <Icon size={18} aria-hidden="true" />
                {!collapsed && <span>{item.label}<small>{item.caption}</small></span>}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          {!collapsed && <div className="data-version"><span>数据版本</span><code>NETDISK-SQLITE-1</code><small>只读后端接入</small></div>}
          <button className="sidebar-action" onClick={resetDemo} title="重置筛选与工作区">
            <RotateCcw size={16} />{!collapsed && <span>重置筛选</span>}
          </button>
          <button className="sidebar-action" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "展开侧栏" : "折叠侧栏"}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}{!collapsed && <span>折叠侧栏</span>}
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className={`topbar ${root === "dashboard" ? "dashboard-topbar" : ""}`}>
          <div className={`topbar-title ${root === "dashboard" ? "dashboard-identity" : ""}`}>
            <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="打开导航" title="打开导航"><Menu /></button>
            {root === "dashboard"
              ? <div><h1>GreenLens</h1><span className="topbar-subtitle">风险分析终端 · 风险总览</span></div>
              : <div><span className="topbar-context">GreenLens / {pageTitles[root] ?? "企业"}</span><h1>{title}</h1></div>}
          </div>
          <div className="topbar-actions">
            <button className="command-trigger" onClick={() => openDrawer("command")}><Search size={16} /><span>搜索公司、页面或动作</span><kbd>Ctrl K</kbd></button>
            <span className="demo-badge" title={analysisRepositoryMode === "http" ? "数据来自只读网盘接入与 SQLite 聚合" : "当前使用可重复验收的合成数据"}>{analysisRepositoryMode === "http" ? "LIVE DATA" : "SYNTHETIC"}</span>
            <button className="icon-button" onClick={openGreenLens} aria-label="打开绿镜复核助理" title="绿镜复核助理 · Ctrl J"><Sparkles /></button>
            <button className="icon-button notification-button" onClick={() => openDrawer("notifications")} aria-label="打开通知" title="通知">
              <Bell /><span>{notifications.length}</span>
            </button>
          </div>
        </header>

        {root !== "dashboard" && root !== "data-sources" && <div className="context-bar" aria-label="全局筛选" aria-busy={!filtersInteractive}>
          <label><span>报告年</span><select disabled={!filtersInteractive} value={year} onChange={(event) => setFilters({ year: Number(event.target.value) })}>{years.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>行业</span><select disabled={!filtersInteractive} value={industry} onChange={(event) => setFilters({ industry: event.target.value })}><option>全部行业</option>{industries.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>风险</span><select disabled={!filtersInteractive} value={risk} onChange={(event) => setFilters({ risk: event.target.value })}><option>全部风险</option><option>高风险</option><option>中风险</option><option>低风险</option><option>暂不可评分</option></select></label>
          {(industry !== "全部行业" || risk !== "全部风险" || year !== 2024) && <button className="text-button" disabled={!filtersInteractive} onClick={() => setFilters({ year: 2024, industry: "全部行业", risk: "全部风险" })}>清除筛选</button>}
          <span className="context-count">后端样本 · 口径截至 {year}</span>
        </div>}

        <main className={`main-content ${root === "dashboard" || pathname.includes("/companies/") ? "evidence-grid-bg" : ""}`}>{children}</main>
        <div className="global-demo-notice">只读接入数据：风险指标仅作为待复核信号；PDF 原文不下发浏览器。</div>
      </div>
      <button className={`mobile-scrim ${mobileNav ? "visible" : ""}`} onClick={() => setMobileNav(false)} aria-label="关闭导航遮罩" />
      <GlobalLayers />
    </div>
  );
}
