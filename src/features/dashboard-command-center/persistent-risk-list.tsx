import { ChevronRight, GitCompareArrows } from "lucide-react";
import { CommandPanelHeading } from "./panel-heading";
import { formatPercent, type DashboardWatchItem } from "@/types";

export function PersistentRiskList({ items, selectedCompanyId, onSelect, onCompare, expanded = false, onExpand }: { items: DashboardWatchItem[]; selectedCompanyId: string | null; onSelect: (id: string) => void; onCompare: (id: string) => void; expanded?: boolean; onExpand?: () => void }) {
  return <section className={`cc-panel cc-watch-panel ${expanded ? "cc-panel-expanded" : ""}`}><CommandPanelHeading eyebrow="PRIORITY · 3Y" title="持续高风险公司" detail={expanded ? "连续三年高风险带 · 建议优先复核" : undefined} onExpand={expanded ? undefined : onExpand} expandLabel="展开持续高风险公司"/><div className="cc-watch-columns" aria-hidden="true"><span>公司</span><span>较上年</span><span>3Y</span><span>E-AA</span></div><div className="cc-watch-list">{items.length ? items.map((item, index) => {
    const history = item.history ?? [];
    const latest = history.at(-1)?.finalIndex;
    const previous = history.at(-2)?.finalIndex;
    const delta = latest == null || previous == null ? null : Math.round((latest - previous) * 100);
    return <div key={item.companyId} className={`cc-watch-row ${selectedCompanyId === item.companyId ? "selected" : ""}`}>
    <button className="cc-watch-main" onClick={() => onSelect(item.companyId)}>
      <span className="cc-watch-rank">{String(index + 1).padStart(2, "0")}</span>
      <span className="cc-watch-company"><strong>{item.companyName}</strong>{expanded ? <small>{item.stockCode} · {item.industry}</small> : null}</span>
      <span className={`cc-watch-delta ${delta == null ? "neutral" : delta > 0 ? "up" : "down"}`}>{delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta}pp`}</span>
      <span className="cc-risk-sequence" aria-label="近三年风险等级">{(item.history ?? []).map((point) => <i key={point.year} className={`risk-${point.riskBand}`} title={`${point.year} ${point.riskBand}`}/>)}</span>
      <span className="cc-watch-score"><strong>{formatPercent(item.finalIndex)}</strong>{expanded ? <small>{item.redFlags.length} 旗</small> : null}</span>
      <ChevronRight/>
    </button>
    <button className="cc-watch-compare" onClick={() => onCompare(item.companyId)} title="加入对比" aria-label={`将${item.companyName}加入对比`}><GitCompareArrows/></button>
  </div>; }) : <div className="cc-watch-empty"><strong>没有连续三年高风险样本</strong><span>当前筛选下不存在满足条件的公司。</span></div>}</div></section>;
}
