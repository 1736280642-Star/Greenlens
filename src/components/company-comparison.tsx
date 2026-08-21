"use client";

import { AlertTriangle, ArrowLeft, Download, Plus, RefreshCw, Share2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { analysisRepository } from "@/repositories";
import { deriveActionComposition } from "@/lib/company-comparison";
import { useDemoStore } from "@/stores/demo-store";
import {
  getMetric,
  type CompanyMetricHistoryPoint,
  type CompanyYearRecord,
  type MetricCode,
  type ViolationEvent,
} from "@/types";

const colors = ["#30D5E8", "#5B8CFF", "#F4D35E", "#E879F9", "#FF9F43"];
const metricLabelOffsets = ["11px", "-14px", "22px"];
const metricDefs: Array<[MetricCode, string]> = [
  ["EASS", "EASS"],
  ["IR", "IR"],
  ["UPR", "UPR"],
  ["ESGSI", "ESI"],
  ["EAA_ESI", "EAA-ESI"],
  ["IMBALANCE", "ESG 失衡"],
];

type SupportingData = {
  history: CompanyMetricHistoryPoint[];
  events: ViolationEvent[];
  error?: string;
};

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function timelinePosition(value: string | number, fromYear: number, toYear: number) {
  const start = Date.UTC(fromYear, 0, 1);
  const end = Date.UTC(toYear, 11, 31);
  const current = typeof value === "number"
    ? Date.UTC(value, 11, 31)
    : Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(current) || end <= start) return 50;
  return 2 + clamp((current - start) / (end - start)) * 96;
}

function groupEventsByDate(events: ViolationEvent[], fromYear: number, toYear: number) {
  const grouped = new Map<string, ViolationEvent[]>();
  for (const event of events) {
    const year = Number(event.announcementDate.slice(0, 4));
    if (!Number.isFinite(year) || year < fromYear || year > toYear) continue;
    grouped.set(event.announcementDate, [...(grouped.get(event.announcementDate) ?? []), event]);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export function CompanyComparison() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { year, setCompareIds, showToast, notify } = useDemoStore();
  const [companies, setCompanies] = useState<CompanyYearRecord[]>([]);
  const [supportingByCompany, setSupportingByCompany] = useState<Record<string, SupportingData>>({});
  const [supportingLoading, setSupportingLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const comparisonYear = Number(searchParams.get("year")) || year;
  const timelineFromYear = comparisonYear - 2;
  const requestedIds = useMemo(
    () => [...new Set((searchParams.get("companies") ?? "").split(",").filter(Boolean))].slice(0, 5),
    [searchParams],
  );

  useEffect(() => {
    if (requestedIds.length) setCompareIds(requestedIds);
  }, [requestedIds, setCompareIds]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        setLoading(true);
        setError(null);
      }
    });
    analysisRepository.listCompanies("success", { year: comparisonYear })
      .then((items) => { if (active) setCompanies(items); })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "对比数据请求失败。");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [comparisonYear]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        setSupportingLoading(true);
        setSupportingByCompany({});
      }
    });
    void Promise.all(requestedIds.map(async (companyId) => {
      try {
        const [history, events] = await Promise.all([
          analysisRepository.getCompanyHistory(companyId, {
            fromYear: timelineFromYear,
            toYear: comparisonYear,
            metrics: ["EAA_ESI"],
          }),
          analysisRepository.listViolationEvents(companyId, {
            fromYear: timelineFromYear,
            toYear: comparisonYear,
          }),
        ]);
        return [companyId, { history, events }] as const;
      } catch (reason) {
        return [companyId, {
          history: [],
          events: [],
          error: reason instanceof Error ? reason.message : "历史与事件数据请求失败。",
        }] as const;
      }
    })).then((entries) => {
      if (active) setSupportingByCompany(Object.fromEntries(entries));
    }).finally(() => {
      if (active) setSupportingLoading(false);
    });
    return () => { active = false; };
  }, [comparisonYear, requestedIds, timelineFromYear]);

  const selected = useMemo(() => {
    const byId = new Map(companies.map((company) => [company.companyId, company]));
    return requestedIds.flatMap((id) => {
      const company = byId.get(id);
      return company ? [company] : [];
    });
  }, [companies, requestedIds]);

  const actionEvidenceReady = selected.filter((company) => company.environmentalActions.totalStatements > 0).length;
  const supportingReady = selected.filter((company) => {
    const supporting = supportingByCompany[company.companyId];
    return supporting && !supporting.error;
  }).length;

  function updateSelection(nextIds: string[]) {
    setCompareIds(nextIds);
    if (nextIds.length < 2) {
      router.push("/companies");
      showToast("已返回企业库，请至少选择 2 家企业");
      return;
    }
    router.replace(`/companies?view=compare&year=${comparisonYear}&companies=${nextIds.join(",")}`);
  }

  function exportCompare() {
    notify("对比摘要已导出", `${selected.length} 家公司的指标对比已生成。`);
    showToast("对比摘要已导出");
  }

  if (loading) {
    return <div className="page"><div className="skeleton skeleton-header"/><div className="panel skeleton-panel"/></div>;
  }
  if (error) {
    return <div className="state-panel"><AlertTriangle size={24}/><h2>对比数据载入失败</h2><p><strong>成因：</strong>{error}<br/><strong>影响：</strong>当前无法生成跨企业指标对比。<br/><strong>下一步：</strong>返回企业库重新选择，或检查 Repository 配置与后端状态后重试。</p><div className="state-actions"><Link className="secondary-button" href="/companies"><ArrowLeft size={15}/>返回企业库</Link><button className="primary-button" onClick={() => location.reload()}><RefreshCw size={15}/>重新载入</button></div></div>;
  }
  if (!companies.length) {
    return <div className="state-panel"><RefreshCw size={24}/><h2>当前报告年没有可对比记录</h2><p>{comparisonYear} 年没有返回公司-年份样本，不能把其他年度数值替代为当前年度。</p><Link className="primary-button" href="/companies">返回企业库调整年份</Link></div>;
  }
  if (selected.length < 2) {
    return <div className="state-panel"><Plus size={24}/><h2>选择至少 2 家企业</h2><p>对比结果只能从企业库选择 2–5 家企业后进入；当前链接中的企业不足或已不在该年度样本中。</p><Link className="primary-button" href="/companies">返回企业库选择</Link></div>;
  }

  return <div className="page compare-page">
    <header className="page-header comparison-header">
      <div>
        <Link className="comparison-back-link" href="/companies"><ArrowLeft size={14}/>企业库</Link>
        <h2>企业对比结果</h2>
        <p>{comparisonYear} 报告年 · 统一显示指标值与方向；风险结果不构成企业漂绿认定。</p>
      </div>
      <div className="header-actions">
        <button className="secondary-button" onClick={() => { navigator.clipboard.writeText(location.href); showToast("分享链接已复制"); }}><Share2 size={15}/>复制链接</button>
        <button className="secondary-button" onClick={exportCompare}><Download size={15}/>导出摘要</button>
      </div>
    </header>

    <section className="compare-selector" aria-label="当前对比企业">
      <div className="company-chips">
        {selected.map((company, index) => <button
          key={company.companyId}
          aria-label={`移除${company.companyName}`}
          title={`从对比中移除${company.companyName}`}
          style={{ "--series-color": colors[index] } as CSSProperties}
          onClick={() => updateSelection(requestedIds.filter((id) => id !== company.companyId))}
        ><i/>{company.companyName}<span aria-hidden="true">×</span></button>)}
        <Link href="/companies" className="icon-button" aria-label="返回企业库添加企业" title="返回企业库添加企业"><Plus/></Link>
      </div>
      <div className="comparison-data-status" role="status" aria-live="polite">
        <span className="complete">指标 {selected.length}/{selected.length}</span>
        <span className={actionEvidenceReady === selected.length ? "complete" : "partial"}>行动原文 {actionEvidenceReady}/{selected.length}</span>
        <span className={supportingLoading ? "loading" : supportingReady === selected.length ? "complete" : "partial"}>历史事件 {supportingLoading ? "查询中" : `${supportingReady}/${selected.length}`}</span>
      </div>
    </section>

    <div className="comparison-charts" aria-label="企业对比图表总览">
      <section className="panel metric-dotplot-panel" aria-labelledby="comparison-metrics-title">
        <header className="panel-header">
          <div><h3 id="comparison-metrics-title">核心指标 Dumbbell 对比</h3><p>EASS 越高越实质；其余指标越高风险越高</p></div>
          <span>{companies.length.toLocaleString()} 家样本 · 归一化 0–100%</span>
        </header>
        <div className="metric-dotplot">
          <div className="dotplot-axis"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
          {metricDefs.map(([code, label]) => {
            const points = selected.map((company) => ({
              company,
              normalizedValue: getMetric(company, code)?.normalizedValue,
            }));
            const allUnavailable = points.every(({ normalizedValue }) => normalizedValue == null);
            return <div className="metric-dot-row" key={code}>
              <strong>{label}<small>{code === "EASS" ? "高更实质" : "高更需关注"}</small></strong>
              <div className="dot-track">
                <i className="dot-range"/>
                {allUnavailable
                  ? <em className="metric-row-empty">报告证据未关联，暂不可计算</em>
                  : points.map(({ company, normalizedValue }, index) => {
                    if (normalizedValue == null) return null;
                    const value = Math.round(normalizedValue * 100);
                    return <span
                      className="metric-dot"
                      key={company.companyId}
                      style={{ left: `${value}%`, background: colors[index] }}
                      title={`${company.companyName} ${value}%`}
                    ><b style={{ top: metricLabelOffsets[index % metricLabelOffsets.length] }}>{value}</b></span>;
                  })}
              </div>
            </div>;
          })}
        </div>
      </section>

      <div className="comparison-side-charts">
        <section className="panel action-compare-panel" aria-labelledby="comparison-actions-title">
          <header className="panel-header"><div><h3 id="comparison-actions-title">环境行动分类构成</h3><p>证据 / 模型</p></div></header>
          <div className="action-compare-list">
            {selected.map((company) => {
              const composition = deriveActionComposition(company);
              const percentages = {
                implemented: Math.round(composition.implemented * 100),
                planning: Math.round(composition.planning * 100),
                indeterminate: Math.round(composition.indeterminate * 100),
              };
              const ariaLabel = composition.basis === "evidence"
                ? `${company.companyName}：已实施 ${company.environmentalActions.implemented} 条，计划 ${company.environmentalActions.planning} 条，模糊 ${company.environmentalActions.indeterminate} 条`
                : `${company.companyName}模型口径占比：已实施 ${percentages.implemented}%，计划 ${percentages.planning}%，模糊 ${percentages.indeterminate}%`;
              return <div className={`action-compare-row ${composition.basis}`} key={company.companyId}>
                <span><strong>{company.companyName}</strong><code>{composition.basis === "evidence" ? `${composition.total} 条` : composition.basis === "model" ? "模型占比" : "待接入"}</code></span>
                {composition.basis === "unavailable"
                  ? <div className="action-empty-track">行动原文与模型输入均不可用</div>
                  : <div className="action-stack" role="img" aria-label={ariaLabel}>
                    <i style={{ width: `${composition.implemented * 100}%`, background: "#38E07B" }}/>
                    <i style={{ width: `${composition.planning * 100}%`, background: "#5B8CFF" }}/>
                    <i style={{ width: `${composition.indeterminate * 100}%`, background: "#F4D35E" }}/>
                  </div>}
              </div>;
            })}
          </div>
          <footer className="action-key">
            <span><i style={{ background: "#38E07B" }}/>已实施</span>
            <span><i style={{ background: "#5B8CFF" }}/>计划</span>
            <span><i style={{ background: "#F4D35E" }}/>模糊</span>
            <span className="action-key-note">模型占比 ≠ 原文条数</span>
          </footer>
        </section>

        <section className="panel timeline-panel" aria-labelledby="comparison-timeline-title">
          <header className="panel-header"><div><h3 id="comparison-timeline-title">真实报告与事件时间线</h3><p>报告年份 / 监管事件公告日期</p></div></header>
          <div className="timeline-scale" aria-hidden="true"><span>{timelineFromYear}</span><span>{timelineFromYear + 1}</span><span>{comparisonYear}</span></div>
          {selected.map((company, index) => {
            const supporting = supportingByCompany[company.companyId];
            const historyYears = [...new Set([
              ...(supporting?.history.map((point) => point.reportYear) ?? []),
              company.reportYear,
            ])].filter((value) => value >= timelineFromYear && value <= comparisonYear).sort();
            const eventGroups = groupEventsByDate(supporting?.events ?? [], timelineFromYear, comparisonYear);
            const latestEventDate = eventGroups.at(-1)?.[0];
            const timelineSummary = supporting?.error
              ? "历史与事件载入失败"
              : supportingLoading && !supporting
                ? "正在查询真实记录"
                : `${historyYears.length} 份报告 · ${supporting?.events.length ?? 0} 条事件${latestEventDate ? ` · 最近 ${latestEventDate}` : ""}`;
            return <div className="timeline-row" key={company.companyId}>
              <div className="timeline-company"><strong style={{ color: colors[index] }}>{company.companyName}</strong><small title={timelineSummary}>{timelineSummary}</small></div>
              <div
                className="timeline-track"
                role="img"
                aria-label={`${company.companyName}：${timelineSummary}`}
              >
                <i className="timeline-baseline"/>
                {historyYears.map((reportYear) => <i
                  aria-hidden="true"
                  className="timeline-report-marker"
                  key={`report-${reportYear}`}
                  style={{ left: `${timelinePosition(reportYear, timelineFromYear, comparisonYear)}%`, borderColor: colors[index] }}
                  title={`${reportYear} 年报告记录`}
                />)}
                {eventGroups.map(([date, events]) => <i
                  aria-hidden="true"
                  className="timeline-event-marker"
                  key={`event-${date}`}
                  style={{ left: `${timelinePosition(date, timelineFromYear, comparisonYear)}%` }}
                  title={`${date} · ${events.length} 条监管事件`}
                >{events.length > 1 ? <b>{events.length}</b> : null}</i>)}
                {supporting?.error ? <em className="timeline-empty">数据请求失败</em> : null}
              </div>
            </div>;
          })}
        </section>
      </div>
    </div>
  </div>;
}
