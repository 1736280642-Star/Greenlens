"use client";

import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, type ColumnDef, type SortingState, type VisibilityState, useReactTable } from "@tanstack/react-table";
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowUpDown, Download, GitCompareArrows, RefreshCw, Save, Search, Settings2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { analysisRepository } from "@/repositories";
import { useDemoStore, defaultYear } from "@/stores/demo-store";
import { formatPercent, metricPercent, type CompanyYearRecord } from "@/types";

export default function CompaniesPage() {
  const router = useRouter();
  const [data, setData] = useState<CompanyYearRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "finalIndex", desc: true }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnMenu, setColumnMenu] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const { year, industry, risk, compareIds, toggleCompare, clearCompare, notify, showToast, setFilters } = useDemoStore();

  useEffect(() => {
    let active = true;
    const riskBand = { "高风险": "high", "中风险": "medium", "低风险": "low", "暂不可评分": "unavailable" }[risk];
    setLoading(true);
    setError(null);
    analysisRepository.listCompanies("success", { year, industry: industry === "全部行业" ? undefined : industry, riskBand })
      .then((items) => { if (active) setData(items); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "企业数据请求失败。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [industry, risk, year]);
  const columns = useMemo<ColumnDef<CompanyYearRecord>[]>(() => [
    { id: "select", header: "选择", cell: ({ row }) => <input type="checkbox" aria-label={`选择${row.original.companyName}`} checked={compareIds.includes(row.original.companyId)} onChange={() => { if (!toggleCompare(row.original.companyId)) showToast("最多同时比较 5 家"); }} /> },
    { accessorKey: "companyName", header: "公司", cell: ({ row }) => <button className="company-link" onClick={() => router.push(`/companies/${row.original.companyId}?year=${row.original.reportYear}`)}><strong>{row.original.companyName}</strong><small>{row.original.stockCode}</small></button> },
    { accessorKey: "industry", header: "行业" },
    { accessorKey: "reportYear", header: "年度" },
    { accessorKey: "finalIndex", header: "E-AA-ESGSI", cell: ({ getValue }) => <span className="risk-score">{formatPercent(getValue<number | null>())}</span> },
    { id: "eass", accessorFn: (row) => metricPercent(row, "EASS"), header: "EASS", cell: ({ getValue }) => <span>{formatTablePercent(getValue<number | null>())}</span> },
    { id: "ir", accessorFn: (row) => metricPercent(row, "IR"), header: "IR", cell: ({ getValue }) => <span>{formatTablePercent(getValue<number | null>())}</span> },
    { id: "upr", accessorFn: (row) => metricPercent(row, "UPR"), header: "UPR", cell: ({ getValue }) => <span>{formatTablePercent(getValue<number | null>())}</span> },
    { id: "imbalance", accessorFn: (row) => metricPercent(row, "IMBALANCE"), header: "失衡", cell: ({ getValue }) => <span>{formatTablePercent(getValue<number | null>())}</span> },
    { accessorKey: "evidenceCoverage", header: "证据覆盖", cell: ({ getValue }) => <span>{getValue<number>()}%</span> },
    { accessorKey: "reviewStatus", header: "复核状态", cell: ({ getValue }) => <span className={`status-chip ${getValue<string>()}`}>{reviewLabel(getValue<CompanyYearRecord["reviewStatus"]>())}</span> },
    { accessorKey: "publishDate", header: "最近更新" },
  ], [compareIds, router, showToast, toggleCompare]);
  // TanStack Table intentionally returns non-memoizable functions; React Compiler skips this hook.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data, columns, state: { sorting, globalFilter: query, columnVisibility }, initialState: { pagination: { pageIndex: 0, pageSize: 10 } }, onSortingChange: setSorting, onGlobalFilterChange: setQuery, onColumnVisibilityChange: setColumnVisibility, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(), globalFilterFn: (row, _column, value) => `${row.original.companyName}${row.original.stockCode}${row.original.industry}`.toLowerCase().includes(String(value).toLowerCase()) });

  function exportCsv() {
    const rows = table.getFilteredRowModel().rows.map(({ original }) => [original.companyName, original.stockCode, original.industry, original.finalIndex ?? "", metricPercent(original,"EASS") ?? "", metricPercent(original,"IR") ?? "", metricPercent(original,"UPR") ?? "", original.evidenceCoverage]);
    const content = [["风险结果仅作为待复核信号"], ["公司", "证券代码", "行业", "E-AA-ESGSI", "EASS", "IR", "UPR", "证据覆盖"], ...rows].map((row) => row.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "greenlens-companies.csv"; anchor.click(); URL.revokeObjectURL(url);
    notify("企业视图已导出", `导出 ${rows.length} 条当前数据记录。`); showToast("企业视图已导出");
  }

  if (loading) return <div className="page"><div className="skeleton skeleton-header"/><div className="panel skeleton-panel"/></div>;
  if (error) return <div className="state-panel"><AlertTriangle size={24}/><h2>企业数据载入失败</h2><p><strong>成因：</strong>{error}<br/><strong>影响：</strong>当前不能筛选、比较或导出公司记录。<br/><strong>下一步：</strong>检查 Repository 配置或后端状态后重试。</p><button className="primary-button" onClick={() => location.reload()}><RefreshCw size={15}/>重新载入</button></div>;
  if (!data.length) return <div className="state-panel"><Search size={24}/><h2>当前筛选下没有公司记录</h2><p>当前报告年、行业或风险组合没有可分析的公司-年份样本。</p><button className="primary-button" onClick={() => setFilters({ year: defaultYear, industry: "全部行业", risk: "全部风险" })}><RefreshCw size={15}/>恢复默认视图</button></div>;

  return <div className="page companies-page">
    <header className="page-header"><div><h2>企业库</h2><p>按行动实质性、模糊声明、未验证计划和最终指数筛选合成公司。</p></div><div className="header-actions"><button className="secondary-button" onClick={() => setSaveOpen(true)}><Save size={15}/>保存视图</button><div className="column-settings"><button className="secondary-button" onClick={() => setColumnMenu(!columnMenu)} aria-expanded={columnMenu}><Settings2 size={15}/>列设置</button>{columnMenu && <div className="column-menu" role="dialog" aria-label="列设置"><strong>显示列</strong>{table.getAllLeafColumns().filter((column) => !["select", "companyName"].includes(column.id)).map((column) => <label key={column.id}><input type="checkbox" checked={column.getIsVisible()} onChange={column.getToggleVisibilityHandler()}/><span>{String(column.columnDef.header)}</span></label>)}</div>}</div><button className="secondary-button" onClick={exportCsv}><Download size={15}/>导出</button></div></header>
    <section className="table-toolbar"><label className="search-field"><Search size={17}/><input value={query} onChange={(event) => { setQuery(event.target.value); table.setPageIndex(0); }} placeholder="搜索公司、虚构代码或行业" /></label><span>共 {table.getFilteredRowModel().rows.length} 家 · 每页 10 条</span></section>
    <section className="panel"><div className="data-table-wrap"><table className="data-table companies-table"><thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id}>{header.isPlaceholder ? null : <button className="sort-header" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getCanSort() && <ArrowUpDown size={12}/>}</button>}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} className={compareIds.includes(row.original.companyId) ? "selected" : ""}>{row.getVisibleCells().map((cell) => <td key={cell.id} className={["finalIndex","eass","ir","upr","imbalance","evidenceCoverage"].includes(cell.column.id) ? "numeric" : ""}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div><footer className="table-pagination"><span>第 {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())} 页</span><div><button className="icon-button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="上一页" title="上一页"><ArrowLeft/></button><button className="icon-button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="下一页" title="下一页"><ArrowRight/></button></div></footer></section>
    {compareIds.length > 0 && <div className="compare-bar"><span>已选 <strong>{compareIds.length}</strong> 家</span><button className="text-button" onClick={clearCompare}>清除</button><button className="primary-button" disabled={compareIds.length < 2} title={compareIds.length < 2 ? "至少选择 2 家企业" : undefined} onClick={() => router.push(`/compare?companies=${compareIds.join(",")}`)}><GitCompareArrows size={15}/>加入对比</button></div>}
    {saveOpen && <div className="modal-scrim"><section className="modal" role="dialog" aria-modal="true" aria-label="保存视图"><header><h3>保存当前视图</h3><button className="icon-button" onClick={() => setSaveOpen(false)} aria-label="关闭"><X/></button></header><div className="modal-body"><label className="field-label"><span>视图名称</span><input autoFocus value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="例如：2025 高优先级样本" /></label></div><footer><button className="secondary-button" onClick={() => setSaveOpen(false)}>取消</button><button className="primary-button" disabled={!viewName.trim()} onClick={() => { setSaveOpen(false); showToast(`已保存视图“${viewName}”`); }}>保存视图</button></footer></section></div>}
  </div>;
}

function reviewLabel(status: CompanyYearRecord["reviewStatus"]) { return { pending: "待复核", partial: "部分复核", reviewed: "已复核", disputed: "存在争议" }[status]; }
function formatTablePercent(value: number | null | undefined) { return value == null ? "--" : `${value}%`; }
