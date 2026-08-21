"use client";

import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

type IdentityException = {
  documentId: string;
  filename: string;
  status: string;
  errorCode?: string;
  errorDetail?: string;
  alternativeCandidates: Array<{ companyId: string; stockCode: string; companyName: string }>;
  metadata: { reportYear?: number };
};

type ResolutionDraft = { companyId: string; reportYear: string };

export function EvidenceIdentityExceptions() {
  const [items, setItems] = useState<IdentityException[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ResolutionDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/data-sources/baidu-netdisk/evidence-reindex", { cache: "no-store" });
      const payload = await response.json() as { exceptions?: IdentityException[] };
      if (!response.ok) throw new Error("证据异常队列读取失败");
      const next = payload.exceptions ?? [];
      setItems(next);
      setDrafts(Object.fromEntries(next.map((item) => [item.documentId, {
        companyId: item.alternativeCandidates.length === 1 ? item.alternativeCandidates[0].companyId : "",
        reportYear: item.metadata.reportYear ? String(item.metadata.reportYear) : "",
      }])));
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "证据异常队列读取失败"); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/v1/data-sources/baidu-netdisk/evidence-reindex", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { exceptions?: IdentityException[] };
        if (!response.ok) throw new Error("证据异常队列读取失败");
        return payload.exceptions ?? [];
      })
      .then((next) => {
        if (!active) return;
        setItems(next);
        setDrafts(Object.fromEntries(next.map((item) => [item.documentId, {
          companyId: item.alternativeCandidates.length === 1 ? item.alternativeCandidates[0].companyId : "",
          reportYear: item.metadata.reportYear ? String(item.metadata.reportYear) : "",
        }])));
      })
      .catch((reason) => { if (active) setMessage(reason instanceof Error ? reason.message : "证据异常队列读取失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function confirm(item: IdentityException) {
    const draft = drafts[item.documentId];
    if (!draft?.companyId || !/^\d{4}$/.test(draft.reportYear)) {
      setMessage("请先确认公司和四位报告年度。");
      return;
    }
    setSavingId(item.documentId); setMessage(undefined);
    try {
      const response = await fetch(`/api/v1/data-sources/baidu-netdisk/evidence-reindex/documents/${item.documentId}/resolve`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: draft.companyId, reportYear: Number(draft.reportYear), extractorVersion: "evidence-rules-v2" }),
      });
      const payload = await response.json() as { evidenceCount?: number; cause?: string; nextAction?: string };
      if (!response.ok) throw new Error(`${payload.cause ?? "身份确认失败"}${payload.nextAction ? `。${payload.nextAction}` : ""}`);
      setMessage(`已确认并重建 ${payload.evidenceCount ?? 0} 条证据。`);
      await load();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "身份确认失败"); }
    finally { setSavingId(undefined); }
  }

  if (!loading && !items.length && !message) return null;
  return <section className="panel evidence-identity-review" aria-labelledby="evidence-identity-review-title">
    <header className="panel-header"><div><h3 id="evidence-identity-review-title">PDF 主体与年度待确认</h3><p>仅展示证据重建无法自动确认的文档；确认后直接复用已解析正文。</p></div><button className="icon-button" onClick={() => void load()} disabled={loading} aria-label="刷新证据异常队列" title="刷新证据异常队列"><RefreshCw size={15}/></button></header>
    {message ? <div className="identity-review-message" role="status">{message}</div> : null}
    {loading ? <div className="identity-review-empty">正在读取证据异常…</div> : items.length ? <div className="identity-review-list">{items.map((item) => {
      const draft = drafts[item.documentId] ?? { companyId: "", reportYear: "" };
      const candidateListId = `identity-candidates-${item.documentId}`;
      return <article key={item.documentId}><div className="identity-review-document"><AlertTriangle size={15}/><span><strong>{item.filename}</strong><small>{item.errorDetail ?? item.errorCode ?? item.status}</small></span></div><label><span>确认公司</span><input list={candidateListId} placeholder="输入证券代码或主体 ID" value={draft.companyId} onChange={(event) => setDrafts((current) => ({ ...current, [item.documentId]: { ...draft, companyId: event.target.value.trim() } }))}/><datalist id={candidateListId}>{item.alternativeCandidates.map((candidate) => <option key={candidate.companyId} value={candidate.companyId}>{candidate.companyName} · {candidate.stockCode}</option>)}</datalist></label><label><span>报告年度</span><input inputMode="numeric" maxLength={4} placeholder="YYYY" value={draft.reportYear} onChange={(event) => setDrafts((current) => ({ ...current, [item.documentId]: { ...draft, reportYear: event.target.value.replace(/\D/g, "").slice(0, 4) } }))}/></label><button className="primary-button" disabled={savingId === item.documentId || !draft.companyId || draft.reportYear.length !== 4} onClick={() => void confirm(item)}>{savingId === item.documentId ? "重建中…" : <><Check size={14}/>确认并重建</>}</button></article>;
    })}</div> : <div className="identity-review-empty"><Check size={16}/>当前没有待确认的 PDF 主体或年度。</div>}
  </section>;
}
