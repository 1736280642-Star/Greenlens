# GreenLens 本地 PDF 分析 MVP

> 状态：Implemented · 2026-08-17  
> 范围：单机、文本型 PDF、研究辅助信号；不构成生产安全或漂绿判定能力。

## 结论

`/reports` 的默认 HTTP 模式已从“只提交文件名并按时间模拟进度”升级为真实闭环：

```text
浏览器 PDF
→ 服务端类型 / 30MB / PDF 魔数 / SHA-256 校验
→ .greenlens-runtime/uploads 私有本地存储
→ SQLite 持久分析任务
→ PDF.js 逐页文本层解析
→ 复用现有分页文本、证据抽取、环境议题与页码回链
→ 计算当前文档的 EASS / IR / UPR
→ 保存解析器、抽取器、公式与计算时间版本
```

Mock Repository 仍保留原有确定性成功、OCR 和失败路径，仅用于自动化验收。生产式本地运行默认使用 HTTP Repository 和真实文件正文。

## 接口契约

### 创建任务

`POST /api/v1/analysis-jobs`，`multipart/form-data`：

- `companyId`
- `reportYear`
- `file`：单个 PDF，最大 30MB

返回 `202` 和任务。相同 `SHA-256 + companyId + reportYear` 已完成时直接复用结果，并返回 `document.deduplicated=true`。

### 任务控制

- `GET /api/v1/analysis-jobs/:jobId`：只读任务状态，不再通过读取时间推进任务。
- `DELETE /api/v1/analysis-jobs/:jobId`：写入取消状态；Worker 在逐页和阶段边界检查取消信号。
- `POST /api/v1/analysis-jobs/:jobId`：复用已持久化原文件重试，并增加 `attempts`。

任务精确阶段为 `uploaded → validating → parsing → segmenting → extracting → classifying → calculating → linking → completed / failed / cancelled`。兼容 UI 的 `phase` 字段继续保留。

## 指标口径

当前文档的证据先分为 `implemented / planning / indeterminate`：

- `EASS = (implemented + 0.5 × planning) / total`
- `IR = indeterminate / total`
- `UPR = unverified planning / planning`

无有效环境行动句段、无计划句等零分母场景返回 `null + 暂不可计算`，不以 0 代替。完整 EAA-ESI 依赖尚未接通的 ESI 与归一化参照样本，因此真实上传结果明确显示“暂不可评分”。

## 实现原因与用户影响

- 复用 `pdf_documents / pdf_pages / evidence_items / environmental_aspects`，避免上传链路和平行网盘链路产生两套证据事实源。
- 浏览器不加载 PDF.js；解析依赖只在 Node Worker 动态加载，避免增加前端包体和主线程压力。
- 原文件按 SHA-256 命名且不对浏览器暴露物理路径，支持重试、去重和结果审计。
- 结果保存 `parserVersion / extractorVersion / formulaVersion / calculatedAt`，模型升级时可以识别旧版本，而不是静默覆盖口径。
- 风险语言始终是“研究辅助信号、待人工核验”，不会把规则分类包装成确定性漂绿结论。

## 已知边界与生产阻断项

本 MVP 尚未包含：

- OCR 与混合页逐页 OCR；无文本层 PDF 会给出明确原因、影响和下一步。
- 表格、段落层级、坐标框和页面图像。
- 恶意文件扫描、登录、RBAC、多租户、配额与签名下载。
- 对象存储、外部消息队列、多进程租约和崩溃自动恢复。
- 文件保留期限、主动删除及派生结果联动清理。
- 模型化行动分类、置信度、冲突检测与人工审批流。

因此公开部署前不能只“换成云服务器”。最简生产升级路径是：私有对象存储 + PostgreSQL + 持久队列 Worker + 恶意文件扫描 + 身份权限，再补 OCR 与评测集。

## 验证

- `pdf-parser.test.ts`：用真实 PDF 字节流验证文本页和 OCR-required 判定。
- `pdf-analysis-worker.test.ts`：验证任务只有在真实解析后才完成、页数/覆盖率/版本写回以及可重试。
- 既有 Repository 测试更新为显式 Worker 状态写入，阻止时间驱动模拟逻辑回归。
- Playwright 的 `mock` 模式继续验证成功、OCR 恢复、失败和页面交互；HTTP 模式由服务端集成测试覆盖真实解析核心。
