"use client";

import { useRouter } from "next/navigation";
import { Bell, Building2, Check, ChevronRight, Search, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { analysisRepository, analysisRepositoryMode } from "@/repositories";
import { useDemoStore } from "@/stores/demo-store";
import type { CompanyYearRecord } from "@/types";

export function GlobalLayers() {
  const router = useRouter();
  const { drawer, openDrawer, toast, showToast, notifications, reviews, undoReview } = useDemoStore();
  const [query, setQuery] = useState("");
  const [companies, setCompanies] = useState<CompanyYearRecord[]>([]);
  const closeButton = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const previousDrawer = useRef(drawer);

  useEffect(() => {
    let active = true;
    analysisRepository.listCompanies().then((items) => { if (active) setCompanies(items); }).catch(() => { if (active) setCompanies([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (drawer !== "none") {
      if (previousDrawer.current === "none") lastFocused.current = document.activeElement as HTMLElement | null;
      setTimeout(() => closeButton.current?.focus(), 20);
    } else if (previousDrawer.current !== "none") lastFocused.current?.focus();
    previousDrawer.current = drawer;
  }, [drawer]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => showToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast, showToast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") openDrawer("none"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDrawer]);

  const resultLinks = [
    ...companies.filter((company) => `${company.companyName}${company.stockCode}`.toLowerCase().includes(query.toLowerCase())).map((company) => ({ label: company.companyName, detail: `${company.stockCode} · ${company.industry}`, href: `/companies/${company.companyId}?year=${company.reportYear}` })),
    ...[
      ["风险总览", "查看声明 × 事实矩阵", "/dashboard"], ["企业库", "搜索与建立对比组", "/companies"], ["报告检测", analysisRepositoryMode === "http" ? "运行后端检测任务" : "运行合成检测任务", "/reports"], ["AI 风险解读", "自动解释风险、引用与不确定性", "/review?view=overview"],
    ].filter(([label, detail]) => `${label}${detail}`.includes(query)).map(([label, detail, href]) => ({ label, detail, href })),
  ].slice(0, 7);

  function navigate(href: string) { openDrawer("none"); router.push(href); }
  const lastReview = reviews[0];
  return <>
    {drawer !== "none" ? <button className="drawer-scrim" onClick={() => openDrawer("none")} aria-label="关闭浮层"/> : null}
    <section className={`global-drawer notification-drawer ${drawer === "notifications" ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="通知中心">
      <DrawerHeader title="通知中心" onClose={() => openDrawer("none")} closeRef={closeButton}/>
      <div className="drawer-scroll notification-list">{notifications.map((item) => <div className="notification-item" key={item.id}><span className="status-dot"/><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.time}</small></div></div>)}</div>
    </section>
    <section className={`command-palette ${drawer === "command" ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="全局搜索">
      <div className="command-input"><Search size={18}/><input autoFocus={drawer === "command"} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司、页面或动作"/><button ref={closeButton} className="icon-button" onClick={() => openDrawer("none")} aria-label="关闭搜索"><X/></button></div>
      <div className="command-results"><span className="command-label">搜索结果</span>{resultLinks.map((item) => <button key={item.href} onClick={() => navigate(item.href)}><Building2 size={17}/><span><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronRight size={16}/></button>)}</div>
    </section>
    {toast ? <div className="toast" role="status"><Check size={18}/><span>{toast}</span>{lastReview && toast === "已保存复核结果" ? <button onClick={() => undoReview(lastReview.id)}><Undo2 size={15}/>撤销</button> : null}<button className="icon-button" onClick={() => showToast(null)} aria-label="关闭提示"><X/></button></div> : null}
  </>;
}

function DrawerHeader({ title, onClose, closeRef }: { title: string; onClose: () => void; closeRef: React.RefObject<HTMLButtonElement | null> }) {
  return <header className="drawer-header"><span><Bell size={18}/><strong>{title}</strong></span><button ref={closeRef} className="icon-button" onClick={onClose} aria-label={`关闭${title}`}><X/></button></header>;
}
