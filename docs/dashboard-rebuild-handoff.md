# Dashboard Command Center 重构交付说明

## 1. 结论

Dashboard 首屏已按“五阶段方案”完成重构。最终形态是 `Holographic Evidence Observatory / 全息证据观测站`：以黑玻璃科研仪器界面承载公司—年份—指标—证据关系，以风险星图作为唯一高冲击主视觉，以绿镜 Copilot 承载实时解释与复核入口。

所有企业、报告、事件和指标均为合成数据。风险只表示待复核研究信号，不构成对企业的定性判断。

## 2. 页面结构

Desktop 首屏由四层组成：

1. 单行控制台：英文观测站标题、报告年、行业、风险、样本口径、契约版本、数据状态、导出和绿镜入口；
2. 六项 KPI 与十年 Sparkline；
3. 三方面指标、风险星图、持续高风险 Watchlist；
4. 十年趋势、行业风险热力、红旗与数据质量。

`1440×900` 和 `1280×800` 是当前发布验收对象，使用基于视口高度的固定研究仪器布局，不产生页面级滚动。既有 Tablet 和 Mobile 规则仅保留兼容性回归，不再作为本轮设计优化范围。

## 3. 实现逻辑

### 3.1 数据层

- 页面只调用 `analysisRepository.getDashboardCommandCenter()`；
- `dashboard-command-center.ts` 负责 KPI、指标三分组、风险节点、持续高风险、趋势、行业和质量聚合；
- Demo Repository 与 HTTP Repository 共用同一数据契约；
- 缺失值保留为 `null`，不转换为 0；
- 风险分类、公式、归一化和数据版本均保留版本字段。

### 3.2 渲染层

- Layer 0：CSS 网格、体积光、黑玻璃和启动扫描；
- Layer 1：唯一 WebGL Canvas，用 R3F/Three.js 渲染风险星图；
- Layer 2：ECharts Canvas，渲染二维矩阵、趋势和行业热力；
- Layer 3：DOM，承载文字、筛选、Tooltip、Watchlist 和 Copilot。

3D 星图包含：

- 按风险等级批量渲染的 `InstancedMesh` 节点；
- Shader Points 软光晕；
- 合并后的 `LineSegments` 三年轨迹；
- HTML/DOM Tooltip；
- 正交相机和受限 `OrbitControls`；
- Flat Mode 和低性能自动降级；
- 节点超过 3,000 时不生成独立 Torus 光环，仅保留 Shader 属性。

### 3.3 性能策略

- 3D 使用 `next/dynamic(..., { ssr: false })` 独立分包；
- 浏览器空闲后再加载 3D，首屏先显示 ECharts 2D；
- 移动端、粗指针、`deviceMemory <= 4`、reduced motion 或无 WebGL 时保留 2D；
- ECharts 仅在容器获得非零尺寸时初始化，避免隐藏 Panel 创建空 Canvas；
- 页面最多一个 WebGL Context。

### 3.4 绿镜 Copilot

- 默认隐藏；
- 顶部按钮或 `Ctrl/Cmd + J` 唤醒；
- 保留当前公司、年份、指标和证据上下文；
- 七类任务入口：报告体检、风险解释、指标解释、跨年同行、事件关联、研究卡片、数据质量；
- 固定输出结构：结论、指标影响、证据引用、不确定性、建议核验动作；
- 抽屉打开和关闭保留焦点回归。

## 4. 底层原因与用户影响

| 决策 | 底层原因 | 对使用者的影响 |
| --- | --- | --- |
| 先 2D、后 3D | WebGL 包体和设备能力存在差异 | 数据先可读，3D 不阻塞操作 |
| 风险星图而非数字地球 | 研究关系是公司—指标—证据，不是地理位置 | 空间视觉服务判断，不制造无关炫技 |
| 风险与质量分栏 | 缺失、重复不等于风险 | 避免把数据问题误读为企业风险 |
| Repository 单入口 | 防止页面分散聚合和 N+1 请求 | 所有 Panel 使用同一筛选口径 |
| 任务化 Copilot | 通用聊天难以支持研究复核 | 输出更稳定、可引用、可追溯 |
| Desktop 固定视口布局 | 第一屏需要形成完整判断闭环 | 1440/1280 无页面滚动，模块同时可见 |

## 5. 关键文件

- 页面入口：`src/app/dashboard/page.tsx`
- Command Center：`src/features/dashboard-command-center/command-center.tsx`
- 数据聚合：`src/repositories/dashboard-command-center.ts`
- 3D 容器：`src/features/dashboard-command-center/risk-constellation.tsx`
- 3D 场景：`src/features/dashboard-command-center/risk-constellation-3d.tsx`
- 2D fallback：`src/features/dashboard-command-center/risk-constellation-fallback.tsx`
- 绿镜：`src/components/global-layers.tsx`
- 视觉系统：`src/app/globals.css`
- E2E：`tests/e2e/workflows.spec.ts`
- 可访问性：`tests/e2e/accessibility.spec.ts`

## 6. 验证结果

- `npm run typecheck`：通过；
- `npm run lint`：通过；
- `npm test`：28/28 通过；
- `npm run test:e2e`：31/31 通过；
- axe serious/critical：0；
- Dashboard 可见界面文字：不低于 12px；
- `npm run build`：通过；
- 目标截图：2048×1227、1440×900、1280×800、768×1024、390×844 已更新；
- Desktop 页面级滚动：0，已由 1280/1440/1920/2048 Playwright 硬断言覆盖；
- 关键模块越界与横向溢出：0；
- 窄侧栏六个导航链接：均有可访问名称和当前页状态；
- WebGL 不可用或低性能设备：自动使用 2D。

## 7. 风险与后续建议

1. 当前数据量只有合成演示规模。接入真实大样本前，应增加 3,000/10,000 节点性能基准和抽样策略。
2. `@react-three/drei` 引入的依赖较多。若长期只使用 `OrbitControls`，可改为直接使用 Three.js controls，进一步降低 Chunk。
3. 当前行业空间感主要来自风险坐标与证据深度。后续可在不改变 X/Y 精确含义的前提下，用 Z 轴增强行业簇。
4. 绿镜当前使用已有 Repository 合成上下文。接入真实模型时必须继续保留引用、版本、不确定性和人工复核边界。
5. 该 Dashboard 验证流程已重复多次，建议将“四视口截图 + axe + WebGL fallback + build”固化为 CI 质量门。
6. `npm audit --omit=dev` 为 0；开发链仍有 9 项来自 ESLint 9 旧版 `minimatch/brace-expansion` 的 high 公告。已验证 ESLint 10 会与 Next.js 当前 React 插件不兼容，因此禁止使用 `npm audit fix --force` 或全局 overrides。该风险仅限本地开发工具处理受信任 glob，等待上游插件支持 ESLint 10 后升级。

## 8. 最终完成审计

| 明确要求 | 权威证据 | 结论 |
| --- | --- | --- |
| 参考图的高级黑玻璃与科研仪器密度 | `screenshots/desktop-1440.png` 与四视口截图 | 已完成；光影集中在星图和交互边缘，没有复制数字地球或堆叠 HUD |
| `InstancedMesh` 批量公司节点 | `RiskBandNodes` 按风险等级生成四个批量实例 Mesh | 已完成 |
| Shader/Sprite 软光晕 | `risk-constellation-3d.tsx` 中的 Points `shaderMaterial`、`aColor/aSize/aOpacity` 属性 | 已完成 |
| 合并 `LineSegments` 跨年轨迹 | 所有节点轨迹写入一个 `Float32Array`，由单一 `lineSegments` 绘制 | 已完成 |
| HTML Tooltip | Canvas 外部 `.cc-3d-tooltip` DOM，根据 Hover 状态更新 | 已完成 |
| 正交或弱透视相机 | R3F `Canvas orthographic`，并限制旋转与缩放范围 | 已完成 |
| 独立 Chunk、`ssr:false`、空闲加载 | `next/dynamic` 动态入口；React loadable manifest 单独列出 3D/Three/Fiber chunks；`requestIdleCallback` | 已完成 |
| 3D 前立即显示 ECharts 2D | fallback 永久先挂载；Playwright `dashboard paints the 2D risk field before the idle 3D chunk runs` | 已完成 |
| 低性能自动保留 2D | `deviceMemory`、粗指针、移动端、reduced motion、WebGL 检测；Playwright low-memory 用例 | 已完成 |
| 超过 3,000 节点改用 Shader 属性 | `nodes.length <= 3000` 时才创建 Torus 实例光环；Shader Points 无条件存在 | 已完成 |
| 1280/1440/1920/2048 单屏且所有模块不裁切 | Playwright `desktop command center stays complete in one screen`，同时检查滚动高度、横向溢出、顶部中心线、主视图高度上限和所有关键模块边界 | 已完成 |
| 窄侧栏无障碍名称 | 六个全局导航链接保留 `aria-label`、`aria-current` 和 Tooltip；两套 Axe 检查 serious/critical 为 0 | 已完成 |
| Dashboard 最小可见字号 | Playwright `visible interface copy meets the 12px readability floor: /dashboard` | 已完成 |
| 五阶段开发范围、边界、顺序、验收 | `dashboard-rebuild-phases.md` | 已完成 |
| 从第一阶段开发至最后阶段 | 数据契约、Repository、2D、3D、Copilot、响应式和质量门均存在并通过验证 | 已完成 |

## 9. 产品需求 v2 与超宽屏闭环

- 旧会话中的有效用户要求已整理为可追踪的功能需求、非功能需求和视口验收矩阵，权威文档为 `dashboard-product-requirements-v2.md`。
- Desktop 命令栏固定为单行：英文观测站标识、四个筛选、数据契约、状态、导出和 AI 入口保持同一中心线。
- KPI、主分析区和底部分析区之间的垂直间距均不超过 12px；禁止在模块之间制造弹性空白。
- 主分析区高度使用视口相关值并封顶 520px。大屏剩余空间只能出现在全部分析模块之后，避免 2048×1227 下主视图被无上限 `1fr` 拉伸。
- 首行只做透明度入场，不再改变几何位置；其余模块的分阶段入场在约 520ms 内完成，避免截图和初次判断期间出现错位或空白。
