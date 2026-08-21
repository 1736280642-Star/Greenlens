# GreenLens Dashboard Command Center 设计与实现规格

> 状态：Ready for implementation proposal
> 适用范围：`/dashboard` 首屏重构
> 背景：面向中国上市公司 ESG 披露研究的 AI 绿色漂白雷达
> 数据边界：仅使用合成公司、报告、事件和指标；风险始终是待复核信号
> 数据契约：`metric-contract-v2`

## 1. 结论

Dashboard 的单一任务是让研究员在 30 秒内回答三件事：

1. 哪些公司持续处于高风险状态；
2. 风险主要来自修辞—内容差异、行动实质不足，还是模糊/未验证计划；
3. 下一步应打开哪家公司、哪条证据或哪类数据质量问题。

新版不采用传统 BI 卡片墙，也不复制参考图中的供应链网络。页面唯一的标志性视觉是：

> **漂绿风险星图 Greenwashing Risk Constellation**

它将公司映射为可交互的空间粒子：X 轴为 EASS，Y 轴为 EAA-ESI，Z 轴只承担持续高风险与证据缺口的空间分层，不作为需要精确读取的主数值轴。这样既保留 3D 空间感，也避免 3D 透视扭曲研究判断。

3D 地球不作为首页默认主体。中国上市公司披露研究的核心不是地理位置，而是公司—年份—指标—证据的关系。数字地球可作为后续“区域风险态势”二级模式，以功能开关进入。

## 2. 从参考图提炼的布局原则

保留：

- 左侧紧凑摘要；
- 中部一个视觉主场；
- 右侧按优先级排列的行动对象；
- 顶部短流程/状态栏；
- 单屏高信息密度；
- 图、表、AI 之间可联动。

调整：

- 上传报告不占 Dashboard 首页大空间，保留在 Reports；
- AI 不常驻右栏，默认隐藏；
- 供应链网络改为风险星图；
- 模型流程、人工复核流程、Agent Workflow 下移到第二屏或独立页面；
- 不让每个 Panel 都持续漂浮，长期使用时只保留极弱环境动效与 Hover 景深。

## 3. 视觉概念

### 3.1 概念名

`Holographic Evidence Observatory / 全息证据观测站`

视觉不是“赛博朋克控制台”，而是一个在深色数字空间中观察企业披露信号、证据缺口和跨年轨迹的研究仪器。

### 3.2 设计签名

风险星图中的公司节点具有三层语义光环：

- 内核：EAA-ESI 风险等级；
- 中环：行动实质性缺口 `1 - EASS`；
- 外环：IR、UPR 与红旗数量；
- 轨迹尾迹：近三年风险变化；
- 断裂虚线：证据覆盖不足或数据质量异常。

只有高风险节点出现低频风险波纹。其他节点保持稳定，避免整页持续闪动。

## 4. 视觉 Token

### 4.1 色彩

| Token | 值 | 用途 |
| --- | --- | --- |
| `space.abyss` | `#050A14` | 页面基础背景 |
| `space.deep` | `#08111E` | 主内容底层 |
| `glass.panel` | `rgba(11,22,37,.78)` | 数据 Panel |
| `glass.overlay` | `rgba(8,18,32,.88)` | AI 抽屉/浮层 |
| `line.quiet` | `rgba(158,198,220,.12)` | 普通边界 |
| `line.active` | `rgba(56,215,232,.42)` | 选中/交互边界 |
| `signal.cyan` | `#38D7E8` | AI、数据流、选中 |
| `signal.blue` | `#5A8CFF` | 计划类、对比系列 |
| `signal.violet` | `#8A7CFF` | 模型/归一化辅助 |
| `risk.amber` | `#F4B740` | 中风险、待核验 |
| `risk.coral` | `#FF6B5E` | 高风险、红旗 |
| `verify.green` | `#45D483` | 已验证、完成 |
| `text.primary` | `#E7F0F8` | 主文字 |
| `text.secondary` | `#99AABD` | 次级文字 |
| `text.muted` | `#62758A` | 辅助文字 |

绿色只表示“已验证/完成”，不能同时代表低风险。低风险使用低饱和蓝灰。

### 4.2 字体

- 中文 UI：`MiSans VF`，本地自托管；回退 `PingFang SC / Microsoft YaHei`；
- 英文标题：`Space Grotesk`；
- 数字、版本、代码：`IBM Plex Mono`；
- 页面标题 22–24px；Panel 标题 14–16px；正文 13–14px；数据标签 11–12px；KPI 26–32px。

### 4.3 材质

- Panel 使用 14–18px blur，不能多层嵌套 blur；
- 边框使用 1px 半透明冷色线，不使用整圈高亮霓虹；
- Hover 时只增加 1px 上移、边框亮度和局部反射；
- 卡片静止态使用 24–36px 柔和阴影；
- 背景网格为 40px，透明度不超过 3%；
- 全屏背景只用 CSS 渐变、噪声和网格，不创建第二个 WebGL 场景。

## 5. Desktop 首屏布局

设计基准：`1440 × 900`，侧栏默认折叠为 72px。Dashboard 主内容在该分辨率不出现页面级纵向滚动。

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Command Bar  年度 / 行业 / 样本口径 / 风险 / 数据状态 / 唤醒绿镜          │ 52
├────────────────────────────────────────────────────────────────────────────┤
│ 样本数 │ 高风险 │ 三年持续高风险 │ E-AA 中位数 │ 证据不足 │ 最近更新       │ 78
├───────────────┬───────────────────────────────────────┬────────────────────┤
│ 三方面指标    │ 漂绿风险星图                          │ 持续高风险公司     │
│ ESGSI         │ EASS × EAA-ESI                    │ 8 行紧凑 Watchlist │
│ EASS          │ 行业簇 / 三年轨迹 / 红旗光环          │ 公司/行业/趋势/旗  │ 408
│ IR + UPR      │                                       │                    │
├────────────────────────┬───────────────────────┬─────────────────────────┤
│ 2016–2025 趋势         │ 行业风险热力          │ 红旗结构 + 数据质量     │ 218
└────────────────────────┴───────────────────────┴─────────────────────────┘
```

12 列网格：

- 左侧三方面指标：3 列；
- 风险星图：6 列；
- 持续高风险公司：3 列；
- 底部趋势：5 列；
- 行业分布：4 列；
- 红旗与质量：3 列。

## 6. 模块详细规格

### 6.1 Command Bar

左侧显示 `GreenLens / 风险观测`，中部为联动筛选：

- 报告年度；
- 行业；
- 样本口径：主分析 / 稳健性 / 完整样本；
- 风险等级；
- 指标聚焦。

右侧：

- `metric-contract-v2`；
- 数据状态灯：就绪 / 质量警告 / 更新中；
- 最近计算时间；
- 主按钮 `唤醒绿镜`。

筛选变化更新 URL 与 Zustand，并触发所有图表平滑联动。数据状态必须来自 `PanelYearSummary`，不能写死。

### 6.2 KPI Rail

| KPI | 计算 | 点击动作 |
| --- | --- | --- |
| 当前样本 | 当前筛选下公司-年份数 | 打开公司库 |
| 高风险 | `riskBand === high` | 聚焦高风险节点 |
| 三年持续高风险 | 最近三年均为 high | 筛选 Watchlist |
| E-AA 中位数 | 当前样本 `finalIndex` 中位数 | 打开分布详情 |
| 证据不足 | `evidenceStatus === insufficient` 或低覆盖 | 聚焦数据质量 |
| 数据新鲜度 | `computedAt` / 年度审计状态 | 打开审计 Popover |

每个 KPI 带 10 年 Sparkline 或同比箭头。数字插值时长 280–420ms，不做数秒滚动。

### 6.3 三方面构造指标

三张纵向压缩的语义卡，不直接罗列六个代码：

1. **修辞—内容差异**：ESGSI；
2. **行动实质**：EASS，并明确“越高越实质”；
3. **模糊与未验证**：IR + UPR。

每张显示：

- 当前样本中位数；
- 高关注样本占比；
- 近十年微趋势；
- 一句研究解释；
- 当前筛选状态。

点击后形成全局 `selectedFactor`，星图、行业热力、Watchlist 同步聚焦。

### 6.4 漂绿风险星图

数据编码：

| 视觉变量 | 数据字段 |
| --- | --- |
| X | `EASS.normalizedValue` |
| Y | `finalIndex` |
| Z | 连续高风险年数 + 证据缺口，仅做空间分层 |
| 节点尺寸 | `environmentalSentenceCount` 的对数映射 |
| 内核色 | `riskBand` |
| 外环段数 | `riskClassification.redFlagCount` |
| 外环类型 | `redFlags` |
| 透明度 | `evidenceCoverage` |
| 轨迹 | `CompanyMetricHistoryPoint[]` |
| 行业簇 | `industry` |

交互：

- Hover：节点放大 1.15 倍，显示公司、行业、EASS、E-AA、三年风险序列与证据完整度；
- Click：锁定公司，其他节点降至 25% 透明度，Watchlist 滚动定位；
- Shift + Click：加入最多 5 家对比；
- Drag：轻微旋转，最大俯仰 12°，禁止自由翻转；
- Wheel：只做小范围缩放；
- 双击或按钮：进入企业详情；
- Flat Mode：切换为精确二维矩阵，供研究读取与无障碍使用。

风险波纹只在以下情况触发一次：首次进入、筛选命中、用户主动选择。不能无限循环扩散。

### 6.5 近三年持续高风险公司

最多显示 8 行：

- 公司名 / 虚构代码；
- 行业；
- 2023–2025 风险序列微条；
- 当前 E-AA；
- 红旗数量；
- 证据覆盖；
- 快捷操作：查看证据 / 加入对比。

默认排序：持续高风险年数 → 当前 E-AA → 红旗数 → 证据缺口。

### 6.6 十年趋势

默认显示 2016–2025：

- E-AA 中位数；
- 高风险比例；
- EASS 中位数；
- 证据不足比例。

使用双轴需谨慎：默认只展示 E-AA 与高风险比例，其他系列由 Toggle 打开。年份必须离散，不虚构月度数据。

### 6.7 行业风险热力

行：行业；列：ESGSI、EASS 缺口、IR、UPR、E-AA。颜色统一使用风险方向值。

点击单元格后同时写入行业与指标筛选。Tooltip 显示样本数、中位数、四分位区间和缺失数量，避免小样本行业被误读。

### 6.8 红旗结构与数据质量

上半区：四类红旗分布：

- HIGH_ESGSI；
- LOW_EASS；
- HIGH_IR；
- HIGH_UPR。

下半区：

- 低环境句数；
- 重复报告；
- 年份文本异常；
- 股票代码恢复；
- 处罚金额缺失。

风险与质量采用两套色彩和标题，禁止混在一个“风险分”里。

## 7. 绿镜 GreenLens Copilot

### 7.1 展开方式

- Dashboard 默认隐藏；
- 顶栏按钮与右下角快捷键 `⌘/Ctrl + J` 唤醒；
- Desktop 宽度 460–500px，覆盖式玻璃抽屉；
- `>= 1680px` 可切换并列模式；
- 打开后保持当前公司、年份、指标和证据上下文；
- 关闭后焦点回到唤醒按钮。

### 7.2 功能入口

1. 报告体检；
2. 为什么风险高；
3. 指标解释；
4. 跨年与同行对比；
5. 违规事件关联建议；
6. 生成研究卡片；
7. 数据质量检查。

### 7.3 回答结构

```text
结论
证据引用
指标影响
不确定性
建议核验动作
```

回答禁止使用“AI 置信度”等同于真实概率，也不能输出“企业确认漂绿”。

### 7.4 AI 动态表现

- 请求开始：上下文 Chip 点亮，数据流从选中节点汇入抽屉；
- 分析中：只显示阶段状态，不伪造逐字思考链；
- 引用到达：引用条目按 50ms stagger 出现；
- 完成：只让 `建议核验动作` 产生一次柔和高亮。

## 8. 动效与启动时序

总时长目标 1.5–1.8 秒。数据与基础骨架必须立即可读，动画不能阻塞交互。

| 时间 | 动作 |
| ---: | --- |
| 0–160ms | 深色背景、网格与主壳层淡入 |
| 120–360ms | Logo/Command Bar 扫描光经过一次 |
| 220–620ms | KPI 由左到右出现，数字插值 |
| 360–900ms | 三个主 Panel 以 8px 位移与透明度展开 |
| 560–1300ms | 星图节点从行业簇中心聚合到位置 |
| 900–1500ms | 十年趋势路径绘制，热力图显现 |
| 1300–1800ms | 绿镜按钮与数据状态进入就绪态 |

持续环境动效：

- 背景粒子：不超过 24 个，速度极低；
- 星图节点：仅选中/高风险节点轻微呼吸；
- Panel 浮动：1px、8–12 秒、错峰；低性能模式关闭；
- 扫描光：页面启动一次，数据刷新时一次；
- Mouse parallax：Panel 最大 1.2°，只在指针精确设备启用。

`prefers-reduced-motion` 时取消路径绘制、粒子聚合、Parallax 和持续运动，仅保留 100ms 淡入。

## 9. 渲染架构

### 9.1 四层渲染

```text
Layer 0  CSS：背景、网格、噪声、体积光
Layer 1  WebGL：唯一的风险星图 Canvas
Layer 2  ECharts Canvas：趋势、热力、Sparkline
Layer 3  DOM：文字、表格、Tooltip、筛选、AI 抽屉
```

页面最多一个 WebGL Context。背景粒子不单独创建 Three.js Scene。

### 9.2 风险星图实现

推荐新增：

- `three`；
- `@react-three/fiber`；
- `@react-three/drei`。

实现要点：

- 使用 `InstancedMesh` 渲染公司节点；
- 使用自定义 Shader 或 Sprite 实现软光晕；
- 轨迹使用合并后的 `LineSegments`；
- HTML Tooltip 通过投影坐标定位，不在 3D 场景中渲染文字；
- 使用 Orthographic Camera 或弱透视 Perspective Camera；
- 节点数量超过 3,000 时关闭独立光环几何体，改用 Shader 属性；
- `dynamic(..., { ssr: false })` 并在浏览器空闲时加载；
- 加载前显示可交互的 ECharts 2D fallback。

### 9.3 图表

其余业务图表继续使用 ECharts：

- 趋势：line + area；
- 行业：heatmap；
- KPI：轻量 SVG 或 ECharts sparkline；
- 红旗：stacked bar / compact lollipop；
- 所有颜色读取 CSS Variables，不在组件内散落硬编码。

### 9.4 动画库

当前 `motion` 足以完成 Panel、抽屉、数字和启动编排。第一版不引入 GSAP、Pixi、D3、deck.gl 与 React Flow。

底层原因：同时引入多套动画和渲染系统会增加包体、WebGL Context、状态同步和维护成本。只有当后续出现大规模地理数据、复杂 Agent 图或超过 ECharts 能力的关系网络时再按需加入。

## 10. Dashboard View Model

页面不应自行对 30 家公司进行分散聚合，也不能发起 N+1 历史请求。新增聚合契约：

```ts
interface DashboardCommandCenterData {
  scope: {
    reportYear: number;
    industry?: string;
    sampleGroup?: SampleGroup;
    dataVersion: string;
    computedAt: string;
  };
  kpis: {
    sampleCount: number;
    highRiskCount: number;
    persistentHighRiskCount: number;
    medianFinalIndex: number | null;
    insufficientEvidenceCount: number;
  };
  metricTriad: Array<{
    code: "RHETORIC_CONTENT" | "ACTION_SUBSTANCE" | "AMBIGUITY_VERIFICATION";
    medianValue: number | null;
    attentionRate: number | null;
    history: Array<{ year: number; value: number | null }>;
  }>;
  riskNodes: DashboardRiskNode[];
  persistentRisks: DashboardWatchItem[];
  annualTrend: DashboardAnnualTrendPoint[];
  industryRisk: DashboardIndustryRiskCell[];
  redFlagDistribution: Array<{ code: RedFlagCode; count: number }>;
  quality: PanelYearSummary[];
}
```

Repository：

```ts
getDashboardCommandCenter(query): Promise<DashboardCommandCenterData>
```

Demo Repository 从现有合成 Fixtures 聚合；HTTP Repository 对应：

```text
GET /api/v1/dashboard/command-center
```

页面只读取 Repository，不直接 import fixtures。

## 11. 组件与目录

```text
src/features/dashboard-command-center/
  command-center.tsx
  command-bar.tsx
  kpi-rail.tsx
  metric-triad.tsx
  risk-constellation.tsx
  risk-constellation-fallback.tsx
  persistent-risk-list.tsx
  annual-risk-trend.tsx
  industry-risk-heatmap.tsx
  red-flag-quality.tsx
  greenlens-launcher.tsx
  use-command-center-data.ts
  selectors.ts
  types.ts
```

全局抽屉继续由 `GlobalLayers` 承载，但将 `AI 证据助手` 更新为 `绿镜 GreenLens Copilot`，并拆出独立业务组件，避免单文件继续膨胀。

## 12. 响应式

### 1440 × 900

- 单屏完整布局；
- 折叠侧栏；
- 风险星图为 6 列；
- AI 覆盖式抽屉。

### 1280 × 800

- KPI 高度降低；
- Watchlist 只显示 6 行；
- 底部 Panel 高度 180px；
- 仍不出现页面级滚动，允许 Panel 内部滚动。

### 768 × 1024

- 风险星图置顶；
- 三方面指标横向三列；
- Watchlist 与底部图表改两列/单列；
- 页面允许纵向滚动；
- 默认使用 2D fallback，点击后再加载 3D。

### 390 × 844

- 只保留 KPI、三方面指标、持续高风险 Top 5 和 AI；
- 风险星图显示静态/2D 简化矩阵；
- 行业热力与复杂趋势进入二级页面；
- 明确提示完整研究视图建议使用桌面端。

## 13. 性能与降级

### 13.1 目标

- Desktop 首次可读 < 1.2s；
- LCP < 2.5s；
- 筛选反馈 < 150ms；
- 图表更新 < 400ms；
- 高性能模式交互 55–60 FPS；
- 低性能模式不低于 30 FPS；
- 页面最多一个 WebGL Context。

### 13.2 能力检测

以下情况自动进入 2D/低动画模式：

- `prefers-reduced-motion`；
- WebGL 不可用；
- `deviceMemory <= 4`；
- 移动端或低精度指针；
- FPS 采样连续 2 秒低于 35。

降级顺序：关闭 Bloom → 关闭背景粒子 → 关闭轨迹尾迹 → 降低节点分辨率 → 切换 ECharts 2D。

## 14. 可访问性与研究可信度

- 3D 星图必须提供 Flat Mode 与数据表；
- 风险等级不能只靠颜色；
- Tooltip 支持键盘选点；
- AI Drawer 使用焦点锁定与关闭焦点恢复；
- 风险值明确为研究信号，不解释为概率；
- 缺失值显示 `—` 并解释原因，不能转为 0；
- 所有导出内容保留合成数据和版本说明；
- 200% 缩放下不遮挡筛选和核心操作。

## 15. 实施顺序

### Phase A：结构与数据聚合

1. 新增 Dashboard View Model 与 Repository 方法；
2. 修复 Dashboard 内残留的 `CONTRACT-V1`、固定 `.66` 文案；
3. 将首屏聚合逻辑移出页面；
4. 建立新的 12 列布局和视觉 Token。

### Phase B：二维业务图表

1. KPI Rail；
2. 三方面指标；
3. Watchlist；
4. 十年趋势；
5. 行业热力；
6. 红旗与质量。

先完成可用的 2D 首屏，确保数据意义和联动正确。

### Phase C：3D 风险星图

1. ECharts 2D fallback；
2. R3F Scene；
3. Instanced nodes；
4. 轨迹与红旗光环；
5. 选中、Tooltip、对比联动；
6. 性能能力检测。

### Phase D：绿镜

1. 重命名与入口；
2. 上下文保持；
3. 七类任务入口；
4. 引用、指标、不确定性和核验动作；
5. 抽屉动效与键盘行为。

### Phase E：质量门

1. Unit tests：聚合、持续高风险、缺失值、红旗；
2. Playwright：筛选联动、选点、Flat Mode、AI 开关；
3. axe；
4. 1440/1280/768/390 截图；
5. WebGL fallback；
6. reduced motion；
7. production build 与性能记录。

## 16. 验收标准

- [ ] 1440 × 900 首屏无页面级纵向滚动；
- [ ] 第一屏只包含漂绿核心指标、公司、行业、趋势、红旗与数据质量；
- [ ] 方法、人工复核流程、任务流不占第一屏；
- [ ] 3D 星图的数据编码可解释，且有二维模式；
- [ ] 点击任一指标、行业、公司会联动其他 Panel；
- [ ] 三年持续高风险公司基于真实历史 Fixture/接口计算；
- [ ] 绿镜默认隐藏，可按键完整展开；
- [ ] 风险结果带证据与不确定性，不构成企业定性判断；
- [ ] 低性能设备自动降级；
- [ ] `lint / typecheck / test / build / Playwright` 全部通过；
- [ ] 四个目标视口无横向溢出、空 Canvas 或严重可访问性问题。

## 17. 负面影响与控制

| 风险 | 影响 | 控制 |
| --- | --- | --- |
| 3D 扭曲数值判断 | 用户误读坐标距离 | X/Y 保持精确，提供 Flat Mode |
| 持续动效疲劳 | 长期研究效率下降 | 只保留一处主动态，其他错峰且可关闭 |
| WebGL 包体较大 | 首屏加载变慢 | 3D 独立 Chunk、空闲加载、2D 先显示 |
| 多套可视化状态分裂 | Panel 显示不同样本 | 单一筛选 Store + Dashboard View Model |
| 玻璃模糊过多 | GPU 压力、文字发灰 | blur 只用于顶栏、主 Panel 和抽屉 |
| AI 变成通用聊天 | 无法支持研究判断 | 任务化入口、固定回答结构、必须引用 |
| 高密度影响可读性 | 1280 屏幕拥挤 | 行数压缩、Panel 内滚动、移动端减法 |

## 18. 预估开发量

在当前 Demo 基础上：

- 数据聚合与 2D 首屏：2–3 个开发日；
- 视觉系统与动效：2–3 个开发日；
- 3D 风险星图与降级：3–5 个开发日；
- 绿镜重构：2–3 个开发日；
- 测试、性能与响应式：2–3 个开发日。

合计约 11–17 个开发日。最简可交付路径是先完成 Phase A+B+D，再增加 Phase C，不让 3D 阻塞业务可用性。
