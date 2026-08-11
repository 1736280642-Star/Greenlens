"use client";

import { ChevronDown, FlaskConical, Info, ShieldCheck } from "lucide-react";
import { useState } from "react";

const methods=[
  {id:"eass",title:"EASS · 环境行动实质性",formula:"Σ Salienceᵢ × ASᵢ；ASᵢ=(Iᵢ+αPᵢ)/(Iᵢ+Pᵢ+Dᵢ)",direction:"越高表示重点环境议题有更多已实施行动支撑",threshold:"低于 0.50 进入重点解读",example:"先按五类环境 Aspect 计算频率、Salience 与行动分数，再聚合到公司年度。",status:"Aspect 与 α 均版本化"},
  {id:"ir",title:"IR · 模糊声明比例",formula:"indeterminate / environmental_statements",direction:"越高表示不可核验表达越多",threshold:"高于 0.33 进入关注",example:"20 / 50 = 0.40。",status:"已定义"},
  {id:"upr",title:"UPR · 未验证计划比例",formula:"unverified_planning / planning_statements",direction:"越高表示计划支撑要素越少",threshold:"高于 0.60 进入重点解读",example:"检查时间、KPI、方法与行动路径。",status:"属性规则版本化"},
  {id:"esgsi",title:"ESGSI · 修辞—内容差异",formula:"sentiment_normalized - sustainability_normalized",direction:"越高表示积极语气与实质环境信息差距越大",threshold:"阈值由风险规则版本返回",example:"同时保留可为负数的 rawValue 与 0–1 normalizedValue。",status:"输入与归一化均可追溯"},
  {id:"eaa",title:"E-AA-ESGSI · 最终调整指数",formula:"ESGSI_norm + λ₁(1-EASS) + λ₂IR + λ₃UPR",direction:"越高表示综合风险信号越强",threshold:"基础相对风险 + 红旗升级，由后端返回",example:"前端分别展示 finalRaw 与 finalNormalized，不重新分类。",status:"λ、归一化和分类规则版本化"},
  {id:"imbalance",title:"Imbalance · ESG 失衡",formula:"dispersion(E_focus, S_focus, G_focus)",direction:"需结合行业语境解释",threshold:"演示阈值 0.45",example:"E 关注显著高于 S/G 时触发结构化解释。",status:"聚合公式待确认"},
];
const pipeline=[
  ["collect_ESG_reports","报告采集"],
  ["preprocess_text","文本预处理"],
  ["extract_ESG_features","ESG 特征提取"],
  ["extract_environmental_aspects","环境 Aspect 提取"],
  ["calculate_aspect_salience","Aspect 权重"],
  ["calculate_aspect_action_score","Aspect 行动分数"],
  ["calculate_ESG_focus","关注度计算"],
  ["calculate_ESG_imbalance","失衡计算"],
  ["classify_environmental_action","行动分类"],
  ["calculate_EASS","EASS"],
  ["calculate_IR","IR"],
  ["calculate_UPR","UPR"],
  ["calculate_ESGSI","ESGSI"],
  ["calculate_eaa_esgsi","E-AA-ESGSI"],
  ["risk_classification","风险分级"],
] as const;

export default function MethodologyPage(){
  const [open,setOpen]=useState("eass");
  return<div className="methodology-layout"><aside className="method-toc"><span>本页目录</span>{["函数链","指标字典","数据契约","风险分级","适用边界","版本"].map((item,i)=><a href={`#section-${i}`} key={item}>{item}</a>)}</aside><article className="method-document"><header><span className="demo-badge">METRIC CONTRACT V2</span><h2>方法与模型</h2><p>从报告处理、环境议题与行动证据到最终风险分级的可追溯函数链。AI 负责解释与引用，风险不构成企业漂绿认定。</p></header>
    <section id="section-0"><span className="section-kicker">十五步函数链</span><h3>每一步都返回可检查的中间结果</h3><div className="pipeline-grid">{pipeline.map(([identifier,label])=><div key={identifier}><code>{identifier}</code><strong>{label}</strong></div>)}</div></section>
    <section id="section-1"><span className="section-kicker">核心指标</span><h3>公式、方向、阈值和状态同时展示</h3><div className="method-accordions">{methods.map((method)=><div className={open===method.id?"open":""} key={method.id}><button onClick={()=>setOpen(open===method.id?"":method.id)}><span><strong>{method.title}</strong><small>{method.direction}</small></span><ChevronDown/></button>{open===method.id&&<div><code>{method.formula}</code><dl><div><dt>方向</dt><dd>{method.direction}</dd></div><div><dt>阈值</dt><dd>{method.threshold}</dd></div><div><dt>示例</dt><dd>{method.example}</dd></div><div><dt>公式状态</dt><dd>{method.status}</dd></div></dl></div>}</div>)}</div></section>
    <section id="section-2"><span className="section-kicker">数据契约</span><h3>前端消费结果，不补造生产公式</h3><div className="concept-row"><div><FlaskConical/><strong>原始值</strong><p>保留分子、分母和计算状态。</p></div><div><ShieldCheck/><strong>风险方向值</strong><p>EASS 反向，其余按契约解释。</p></div><div><Info/><strong>版本</strong><p>Schema、特征、模型、公式和阈值分开记录。</p></div></div></section>
    <section id="section-3"><span className="section-kicker">风险分级</span><h3>基础相对风险与红旗升级分开记录</h3><table><thead><tr><th>层级</th><th>规则</th><th>用途</th></tr></thead><tbody><tr><td>基础风险</td><td>按年度或行业年度分布返回 Low / Medium / High</td><td>比较样本相对位置</td></tr><tr><td>红旗</td><td>HIGH_ESGSI / LOW_EASS / HIGH_IR / HIGH_UPR</td><td>防止相对排名掩盖实质风险</td></tr><tr><td>最终等级</td><td>由版本化分类器返回，前端不重算</td><td>自动风险解读与研究筛查</td></tr></tbody></table></section>
    <section id="section-4"><span className="section-kicker">适用边界</span><h3>机器自动处理，人工保留研究判断</h3><ul><li>AI 自动提取声明、计算指标、关联证据并生成结构化解读。</li><li>解析、主体、年份或证据关联异常进入独立质量处置。</li><li>研究人员结合业务语境决定如何使用结果，不需要逐条审核机器信号。</li></ul></section>
    <section id="section-5"><span className="section-kicker">版本</span><h3>当前演示契约</h3><table><tbody><tr><th>Schema</th><td><code>metric-contract-v2</code></td></tr><tr><th>模型</th><td><code>EAA-ESGSI-DEMO-2.0</code></td></tr><tr><th>状态</th><td>全部企业、报告、财务与事件数值为合成 Mock</td></tr></tbody></table></section>
  </article><aside className="method-aside"><span>当前版本</span><code>metric-contract-v2</code><dl><div><dt>数据</dt><dd>SYN-2026.08</dd></div><div><dt>分类</dt><dd>risk-quantile-redflag-v1</dd></div><div><dt>用途</dt><dd>研究原型</dd></div></dl></aside></div>;
}
