# GreenLens Demo

GreenLens is a desktop-first ESG evidence investigation workspace. Deterministic tests use synthetic data; production-like local runs can also persist and parse a user-uploaded text PDF through the HTTP Repository.

### GreenLens 产品介绍

#### 产品定位

GreenLens 是一款面向 ESG 研究员、责任投资分析师与合规人员的企业漂绿风险研究工具。

它先用清晰的企业风险等级帮助用户缩小研究范围，再通过 EAA-ESI、GSI 和 Red Flag 三种互补视角检查风险信号，最后由 AI 把指标、报告证据、外部事实与比较结果整理成可继续核验的研究摘要。

GreenLens 展示的是待研究的风险信号。高风险代表需要优先核验，不等同于企业已被认定存在漂绿。证据不足也会作为独立状态保留，不会自动归入低风险。

#### 企业风险等级一眼可见

风险总览将企业年度样本划分为高风险、中风险、低风险与暂不可评分四种状态。研究员进入页面后，可以立即看到当前样本规模、高风险企业数量、连续三年处于高风险区间的企业，以及整体 EAA-ESI 水平。

风险分布、十年趋势和行业热力进一步说明这些信号集中在哪里。研究员可以先锁定持续高风险企业，再进入单家公司查看指标构成和证据，不必从大量 ESG 报告中逐份寻找异常。

风险等级由版本化分类规则返回。页面同时保留计算口径、数据版本和质量提醒，避免用户把等级误解为事实概率或确定性结论。

#### 三种互补的风险研究视角

GreenLens 允许研究员在同一页面切换 EAA-ESI、GSI 与 Red Flag。三种视角检查的是不同问题，也让单一模型的局限更容易被发现。

默认的 EAS / EAA-ESI 主分析围绕环境披露展开。ESI 检查积极环境语言与实质信息之间的差距，EASS 衡量环境行动获得已实施证据支撑的程度，IR 与 UPR 分别识别模糊声明和缺少验证要素的环境计划。EAA-ESI 将这些信号组合成综合调整风险指数，并保留各项指标对结果的影响。

切换到 GSI 后，研究员可以从完整 ESG 文本口径重新观察同一家企业。GSI 结合 E、S、G 词典覆盖、披露覆盖不足惩罚和关注结构失衡，帮助判断主分析中的环境风险信号在另一套文本口径下是否仍然成立。它提供独立的稳健性证据，不替代环境主分析。

Red Flag 展示主模型中的版本化阈值触发结果。语言与内容差距过高、行动实质性不足、模糊声明偏多或未验证计划占比过高，都会形成明确预警。它能补充相对排名的不足，防止某些已经越过关键阈值的风险信号被行业分布或样本中位数掩盖。

这三种视角让研究员看到综合等级，也能继续判断风险由什么构成，换一套口径后是否稳定，以及哪些关键阈值已经触发。

#### AI 风险解读

AI 风险解读把分散在页面各处的指标和证据组织成一份结构化研究假设。

用户选中企业和报告年度后，AI 会生成风险摘要，按风险方向值排列主要驱动因素，并补充历史变化和行业位置。证据账本将每项解释连接到报告页码、原文摘录或外部事实，引用还会标明事实、待核验与未知状态。

AI 也会主动指出证据覆盖不足、PDF 无法定位、外部事实缺失和部分指标不可计算等问题，并据此标注不确定性。研究员随后可以核验环境目标的基准年与 KPI，检查模糊声明的披露边界，或者继续查看跨年度证据。

生成结果可以导出为研究摘要。最终结论仍由研究人员结合行业背景、证据质量与专业经验作出。

#### 企业筛选、分析与比较

企业库承接风险总览中的筛选结果。研究员可以按年度、行业、风险等级和证据状态查找企业，建立重点研究名单。

进入企业分析页后，综合风险会被拆解为行动实质性、模糊声明、未验证计划和环境修辞差距等具体来源。多家公司也可以放在一起比较，帮助用户区分企业自身异常与行业共性，并识别风险等级接近但成因不同的企业。

所有指标都会标明信息来自报告原文、模型计算还是尚未关联的数据。研究员可以沿着指标回到对应报告和外部事件，继续核对证据。

#### 证据、质量与方法透明度

报告证据模块展示相关声明所在的页码、原文内容和行动分类。外部事实模块补充监管处罚、违规事件与其他可核验信息，用于检查企业披露和外部情况是否一致。

解析失败、主体或年度关联错误、低证据覆盖率以及低置信度分类会进入独立的质量处置流程。风险高低与数据质量分别计算，缺少外部事实或报告证据不会被解释为低风险。

方法页面公开指标公式、风险方向、阈值规则、处理流程和模型版本。研究员可以检查一个风险等级怎样产生，也可以追溯每项指标使用的数据与计算状态。

#### 产品价值

GreenLens 将企业漂绿风险研究组织成一条连续工作流。研究员先通过风险等级找到值得关注的企业，再用 EAA-ESI、GSI 和 Red Flag 检查信号是否稳定，随后借助 AI 回到原文与外部事实完成核验。

这套工作方式可以缩短前期筛查时间，也让每个风险信号都有解释、有证据，并清楚标明尚未解决的不确定性。
> 演示数据：企业、事件、报告与指标均为合成内容，不代表任何真实主体。

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000/dashboard`, or use the currently verified workspace server at `http://127.0.0.1:3130/dashboard`.

The data source is selected once at the Repository composition root:

```bash
# Default fixed synthetic data
NEXT_PUBLIC_ANALYSIS_REPOSITORY=mock

# Real backend adapter
NEXT_PUBLIC_ANALYSIS_REPOSITORY=http
NEXT_PUBLIC_ANALYSIS_API_BASE_URL=/api/v1
```

## Quality gates

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

The Playwright suite covers the investigation workflow, report success/OCR/failure paths, comparisons, review undo, serious accessibility violations, nonblank chart canvas, horizontal overflow, and screenshots at 1440x900, 1280x800, 768x1024, and 390x844.

## Routes

| Route | Purpose |
| --- | --- |
| `/dashboard` | Scan dense KPIs, EASS × E-AA-ESGSI, metric ledgers, industry heatmaps, and review operations |
| `/companies` | Search, sort, paginate, configure columns, compare, and export 30 synthetic companies |
| `/companies/cy-materials` | Inspect contributions, report evidence, external facts, ratings, and history |
| `/compare` | Compare 2-5 companies without producing a simplistic ranking |
| `/reports` | Upload a PDF, poll a persistent analysis job, and open linked evidence |
| `/review` | Record a human decision and undo it within 8 seconds |
| `/methodology` | Explain model logic, boundaries, and synthetic validation metrics |

## Implementation logic

- Pages obtain records only through `src/repositories/index.ts`; the composition root selects Mock or HTTP without page changes.
- Zustand persists filters, comparisons, reviews, and notifications in `localStorage`, but never stores identity or uploaded file contents.
- ECharts renders the EASS × E-AA-ESGSI quadrant, metric incidence, heatmaps, dumbbells, and operational charts; TanStack Table owns company sorting and filtering.
- `AnalysisRepository` has Mock and HTTP implementations; both validate metric, version, cross-field, and unavailable-value rules with Zod before data reaches a page.
- In HTTP mode, report scanning sends the selected PDF as multipart data. The Node backend validates and privately persists it, PDF.js extracts page text, and the existing evidence pipeline derives page-linked EASS/IR/UPR signals. Mock mode remains metadata-only for deterministic tests.
- Company and evidence queries include `reportYear`; URL parameters preserve company, tab, year, and evidence context for refreshable demonstrations.
- Review pages and drawers persist through `saveReview` before updating the local UI cache.

The underlying reason for these boundaries is migration cost: a real API can replace the Repository without rewriting route behavior, while risk, evidence quality, and review status remain distinct contracts. For users, this produces a coherent evidence trail and prevents a synthetic score from being mistaken for a verdict.

## Documentation

- [Metric contract v2](docs/metric-contract-v2.md)
- [Metric contract v1（历史）](docs/metric-contract-v1.md)
- [Design decisions](docs/design-decisions.md)
- [Mock data dictionary](docs/mock-data-dictionary.md)
- [Demo guide](docs/demo-guide.md)
- [Local PDF analysis MVP](docs/pdf-analysis-mvp.md)
- [Retrospective](docs/frontend_demo_retrospective.md)
