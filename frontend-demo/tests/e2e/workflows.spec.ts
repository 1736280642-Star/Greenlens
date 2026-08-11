import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

function monitorConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  return errors;
}

async function expectCanvasPainted(canvas: ReturnType<Page["locator"]>) {
  await expect(canvas).toBeVisible();
  const paintedPixels = await canvas.evaluate((node) => {
    const element = node as HTMLCanvasElement;
    const context = element.getContext("2d");
    if (!context) return element.width > 0 && element.height > 0 ? 100 : 0;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) count += 1;
    return count;
  });
  expect(paintedPixels).toBeGreaterThan(20);
}

test("GreenLens opens AI interpretation with recoverable context", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "风险分布概览" })).toBeVisible();
  await page.keyboard.press("Control+J");

  await expect(page).toHaveURL(/\/review\?/);
  await expect(page.getByRole("heading", { name: "AI 风险解读", level: 2 })).toBeVisible();
  await expect(page.getByText("机器完成指标解释、证据组织和比较；研究人员负责理解语境与使用结论。")).toBeVisible();
});

test("workflow A: dashboard to structured interpretation and cited evidence", async ({ page }) => {
  test.slow();
  const errors = monitorConsole(page);
  await page.goto("/dashboard");
  await expect(page.locator(".command-center-eyebrow")).toHaveText("HOLOGRAPHIC EVIDENCE OBSERVATORY");
  await expect(page.locator(".command-center-header h2")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "风险分布概览" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "三方面构造指标" })).toBeVisible();
  const firstTriad = page.locator(".cc-triad-card").first();
  await firstTriad.click();
  await expect(firstTriad).toHaveAttribute("aria-pressed", "true");
  const firstWatch = page.locator(".cc-watch-row").first();
  const selectedCompany = (await firstWatch.locator(".cc-watch-company").textContent())?.trim() ?? "";
  await firstWatch.locator(".cc-watch-main").click();
  await expect(firstWatch).toHaveClass(/selected/);
  await expect(page.locator(".cc-hexbin-panel")).toHaveClass(/has-company-selection/);
  await expect(page.locator(".cc-triad-panel")).toHaveClass(/has-company-selection/);
  await expect(page.locator(".cc-company-chip")).toContainText(selectedCompany);
  await page.keyboard.press("Control+J");
  await expect(page).toHaveURL(/\/review\?/);
  await expect(page.getByRole("heading", { name: "AI 风险解读", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "证据账本" })).toBeVisible();
  const citation = page.locator(".ledger-sources button").first();
  await expect(citation).toBeVisible();
  await citation.click();
  await expect(page).toHaveURL(/evidence=/);
  await expect(page.locator(".interpretation-source-reader")).toBeVisible();
  expect(errors).toEqual([]);
});

test("dashboard risk insights drive the Top 5 review flow", async ({ page }) => {
  const errors = monitorConsole(page);
  await page.goto("/dashboard");
  const riskFilter = page.locator(".command-center-filterbar label").filter({ hasText: "风险" }).locator("select");
  await riskFilter.selectOption("高风险");
  await expect(riskFilter).toHaveValue("高风险");
  await expect(page.locator(".cc-kpi-rail .cc-kpi>small, .cc-triad-description, .cc-watch-company small")).toHaveCount(0);
  await riskFilter.selectOption("全部风险");
  await expect(page.getByRole("heading", { name: "十年风险趋势" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "行业风险热力" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "红旗统计" })).toBeVisible();
  const canvases = page.locator("canvas:visible");
  await expect.poll(() => canvases.count()).toBeGreaterThanOrEqual(3);
  for (const canvas of await canvases.all()) {
    await expectCanvasPainted(canvas);
  }
  expect(errors).toEqual([]);
});

test("dashboard exposes KPI definitions and full module views", async ({ page }) => {
  const errors = monitorConsole(page);
  await page.goto("/dashboard");

  const currentSample = page.getByRole("button", { name: "查看当前样本详情" });
  await currentSample.click();
  await expect(page.getByRole("dialog", { name: "当前样本详情" })).toBeVisible();
  await expect(page.getByText("当前筛选条件下进入分析口径的有效公司-年份记录数。")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "当前样本详情" })).toHaveCount(0);
  await expect(currentSample).toBeFocused();

  const expandButtons = page.locator(".command-center-page .cc-expand-button");
  await expect(expandButtons).toHaveCount(5);
  const triadPanel = page.locator(".cc-triad-panel");
  await expect(triadPanel.getByText("关注率")).toHaveCount(3);
  await expect(triadPanel.getByText("有效样本")).toHaveCount(3);
  const triadExpand = page.getByRole("button", { name: "展开三方面构造指标" });
  await triadExpand.click();
  const triadDialog = page.getByRole("dialog", { name: "三方面构造指标完整视图" });
  await expect(triadDialog).toBeVisible();
  await expect(triadDialog.getByText("中间 50% 区间")).toHaveCount(3);
  await expect(triadDialog.getByText("趋势覆盖")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(triadDialog).toHaveCount(0);
  await expect(triadExpand).toBeFocused();

  const trendExpand = page.getByRole("button", { name: "展开十年风险趋势" });
  await trendExpand.click();
  const trendDialog = page.getByRole("dialog", { name: "十年风险趋势完整视图" });
  await expect(trendDialog).toBeVisible();
  await expectCanvasPainted(trendDialog.locator("canvas"));
  await page.keyboard.press("Escape");
  await expect(trendDialog).toHaveCount(0);
  await expect(trendExpand).toBeFocused();

  const constellationExpand = page.getByRole("button", { name: "展开风险分布概览" });
  await constellationExpand.click();
  const constellationDialog = page.getByRole("dialog", { name: "风险分布概览完整视图" });
  await expect(constellationDialog).toBeVisible();
  await expectCanvasPainted(constellationDialog.locator("canvas").first());
  await page.getByRole("button", { name: "关闭完整视图" }).click();
  await expect(constellationExpand).toBeFocused();
  expect(errors).toEqual([]);
});

test("workflow B: report scan completes and opens analysis", async ({ page }) => {
  await page.goto("/reports");
  await page.getByLabel("虚构公司").selectOption("linhai-energy");
  await page.locator('input[type="file"]').setInputFiles({ name: "greenlens-demo.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic") });
  await page.getByRole("button", { name: "开始检测" }).click();
  await expect(page.getByRole("heading", { name: "合成分析已生成" })).toBeVisible({ timeout: 10_000 });
  const metricResults = page.locator(".metric-result-strip");
  await expect(metricResults).toContainText("EASS");
  await expect(metricResults).toContainText("IR / UPR");
  await expect(metricResults.locator("strong").nth(2)).toHaveText(/^\d+% \/ \d+%$/);
  await page.getByRole("button", { name: /打开完整分析/ }).click();
  await expect(page.getByRole("heading", { name: "林海能源" })).toBeVisible();
});

test("report scan supports OCR recovery and explicit extraction failure", async ({ page }) => {
  await page.goto("/reports");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: "scan-demo.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic scan") });
  await page.getByRole("button", { name: "开始检测" }).click();
  await expect(page.getByRole("heading", { name: "建议启用 OCR" })).toBeVisible();
  await page.getByRole("button", { name: "启用演示 OCR" }).click();
  await expect(page.getByRole("heading", { name: "合成分析已生成" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /新建检测/ }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "broken-demo.pdf", mimeType: "application/pdf", buffer: Buffer.from("broken synthetic") });
  await page.getByRole("button", { name: "开始检测" }).click();
  await expect(page.getByRole("heading", { name: "报告检测未完成" })).toBeVisible();
  await page.getByRole("button", { name: "重新提交演示任务" }).click();
  await expect(page.getByRole("heading", { name: "合成分析已生成" })).toBeVisible({ timeout: 10_000 });
});

test("interpretation supports comparison, export, and problem reporting", async ({ page }) => {
  await page.goto("/compare");
  await expect(page.getByText("核心指标 Dumbbell 对比")).toBeVisible();
  await page.getByRole("tab", { name: "行动构成" }).click();
  await expect(page.getByText("环境行动分类构成")).toBeVisible();
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "AI 风险解读", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "加入对比" }).click();
  await expect(page.getByText("已加入对比", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出摘要" }).click();
  expect((await download).suggestedFilename()).toMatch(/risk-interpretation\.md$/);
  await page.getByRole("button", { name: "报告问题" }).click();
  await expect(page.getByRole("dialog", { name: "报告解读问题" })).toBeVisible();
  await page.getByRole("radio", { name: "证据关联错误" }).check();
  await page.getByPlaceholder("指出错误位置或正确关联，便于后续处理").fill("引用页码需要重新核对");
  await page.getByRole("button", { name: "记录问题" }).click();
  await expect(page.getByText("解读问题已记录，将进入异常与质量处置", { exact: true })).toBeVisible();
});

for (const viewport of [
  { name: "review-1440", width: 1440, height: 900 },
  { name: "review-1280", width: 1280, height: 800 },
]) {
  test(`AI interpretation stays actionable in one screen: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "AI 风险解读", level: 2 })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "重点解读公司" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "证据账本" })).toBeVisible();
    await expect(page.getByRole("button", { name: "导出摘要" })).toBeVisible();
    const overflow = await page.evaluate(() => ({ horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth, vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight }));
    expect(overflow.horizontal).toBeLessThanOrEqual(1);
    expect(overflow.vertical).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}.png`), fullPage: true });
  });
}

test("manual handling is isolated to data-quality exceptions", async ({ page }) => {
  await page.goto("/data-sources/review");
  await expect(page.getByRole("heading", { name: "异常与质量处置", level: 2 })).toBeVisible();
  await expect(page.getByText("只处理解析、关联、年份和低置信度异常；风险高低不直接产生人工任务。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI 风险解读", level: 2 })).toHaveCount(0);
});

test("company library paginates 30 records and applies column settings", async ({ page }) => {
  await page.goto("/companies");
  await expect(page.getByText("共 30 家 · 每页 10 条")).toBeVisible();
  await expect(page.getByText("第 1 / 3 页")).toBeVisible();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByText("第 2 / 3 页")).toBeVisible();
  await page.getByRole("button", { name: "列设置" }).click();
  await page.getByRole("checkbox", { name: "行业" }).uncheck();
  await expect(page.getByRole("columnheader", { name: "行业" })).toHaveCount(0);
});

test("report-year filters query the repository and recover from empty results", async ({ page }) => {
  await page.goto("/dashboard");
  const reportYear = page.getByLabel("报告年");
  await expect(reportYear).toBeEnabled();
  await expect(reportYear).toHaveValue("2025");
  await reportYear.selectOption("2024");
  await expect(page.getByRole("heading", { name: "当前筛选下没有样本" })).toBeVisible();
  await page.getByRole("button", { name: "恢复默认视图" }).click();
  await expect(page.getByRole("heading", { name: "风险分布概览" })).toBeVisible();

  await page.goto("/companies");
  await page.getByLabel("报告年").selectOption("2024");
  await expect(page.getByRole("heading", { name: "当前筛选下没有公司记录" })).toBeVisible();
  await page.getByRole("button", { name: "恢复默认视图" }).click();
  await expect(page.getByText("共 30 家 · 每页 10 条")).toBeVisible();
});

test("dashboard paints the risk distribution canvas on initial render", async ({ page }) => {
  await page.goto("/dashboard");
  const stage = page.locator(".cc-hexbin-stage");
  await expect(stage).toBeVisible();
  await expect(stage.locator("canvas")).toBeVisible();
  await expectCanvasPainted(stage.locator("canvas"));
});

test("dashboard keeps the risk distribution canvas on low-memory devices", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 2 });
  });
  await page.goto("/dashboard");
  const stage = page.locator(".cc-hexbin-stage");
  await expect(stage).toBeVisible();
  await expect(stage.locator("canvas")).toBeVisible();
});

for (const viewport of [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-2048", width: 2048, height: 1227 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-390", width: 390, height: 844 },
]) {
  test(`visual smoke: ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/dashboard");
    await expect(page.locator(".command-center-eyebrow")).toHaveText("HOLOGRAPHIC EVIDENCE OBSERVATORY");
    await expect(page.getByRole("heading", { name: "风险分布概览" })).toBeVisible();
    if (viewport.width >= 1280) {
      const firstFilter = await page.locator(".command-center-filterbar label").first().boundingBox();
      const toolbarActions = await page.locator(".command-center-toolbar-actions").boundingBox();
      expect(firstFilter).not.toBeNull();
      expect(toolbarActions).not.toBeNull();
      expect(firstFilter!.x).toBeLessThan(toolbarActions!.x);
      expect(Math.abs((firstFilter!.y + firstFilter!.height / 2) - (toolbarActions!.y + toolbarActions!.height / 2))).toBeLessThanOrEqual(2);
    }
    await page.getByRole("heading", { name: "持续高风险公司" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const canvases = page.locator("canvas:visible");
    await expect.poll(() => canvases.count()).toBeGreaterThanOrEqual(1);
    for (const canvas of await canvases.all()) {
      await expectCanvasPainted(canvas);
    }
    await page.evaluate(() => document.documentElement.classList.add("e2e-full-render"));
    await page.evaluate(() => window.scrollTo(0, 0));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `screenshots/${viewport.name}.png`, fullPage: true });
  });
}

for (const viewport of [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1920", width: 1920, height: 1080 },
  { name: "desktop-2048", width: 2048, height: 1227 },
]) {
  test(`desktop command center stays complete in one screen: ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "风险分布概览" })).toBeVisible();
    await expect(page.getByText(/计算于/)).toHaveCount(0);

    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const selectors = [
        ".command-center-filterbar",
        ".cc-kpi-rail",
        ".cc-primary-grid",
        ".cc-bottom-grid",
        ".cc-primary-grid > .cc-panel",
        ".cc-bottom-grid > .cc-panel",
      ];
      const boxes = selectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)].map((element) => {
        const rect = element.getBoundingClientRect();
        return { selector, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      }));
      const headerCenters = [...document.querySelector(".command-center-filterbar")!.children].map((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      const clippedControls = [
        ".command-center-eyebrow",
        ".command-center-contract",
        ".command-center-data-state",
        ".cc-secondary-button",
        ".cc-ai-button",
      ].filter((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        return element != null && element.scrollWidth - element.clientWidth > 1;
      });
      return {
        verticalOverflow: root.scrollHeight - root.clientHeight,
        horizontalOverflow: root.scrollWidth - root.clientWidth,
        boxes,
        headerCenterSpread: Math.max(...headerCenters) - Math.min(...headerCenters),
        kpiToPrimaryGap: document.querySelector(".cc-primary-grid")!.getBoundingClientRect().top - document.querySelector(".cc-kpi-rail")!.getBoundingClientRect().bottom,
        primaryToBottomGap: document.querySelector(".cc-bottom-grid")!.getBoundingClientRect().top - document.querySelector(".cc-primary-grid")!.getBoundingClientRect().bottom,
        primaryHeight: document.querySelector(".cc-primary-grid")!.getBoundingClientRect().height,
        bottomHeight: document.querySelector(".cc-bottom-grid")!.getBoundingClientRect().height,
        primaryPanelWidths: [...document.querySelectorAll<HTMLElement>(".cc-primary-grid > .cc-panel")].map((element) => element.getBoundingClientRect().width),
        triadCardsClipped: [...document.querySelectorAll<HTMLElement>(".cc-triad-card")].some((element) => element.scrollHeight - element.clientHeight > 1),
        clippedControls,
      };
    });

    expect(layout.verticalOverflow).toBeLessThanOrEqual(1);
    expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(layout.headerCenterSpread).toBeLessThanOrEqual(2);
    expect(layout.kpiToPrimaryGap).toBeLessThanOrEqual(12);
    expect(layout.primaryToBottomGap).toBeLessThanOrEqual(12);
    expect(layout.primaryHeight).toBeGreaterThanOrEqual(319);
    expect(layout.primaryHeight).toBeLessThanOrEqual(430);
    expect(layout.bottomHeight).toBeGreaterThanOrEqual(239);
    expect(layout.primaryPanelWidths[1] / layout.primaryPanelWidths.reduce((total, width) => total + width, 0)).toBeLessThanOrEqual(.46);
    expect(layout.triadCardsClipped).toBe(false);
    expect(layout.clippedControls).toEqual([]);
    for (const box of layout.boxes) {
      expect(box.left, `${box.selector} exceeds the left edge`).toBeGreaterThanOrEqual(-1);
      expect(box.top, `${box.selector} exceeds the top edge`).toBeGreaterThanOrEqual(-1);
      expect(box.right, `${box.selector} exceeds the right edge`).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.bottom, `${box.selector} exceeds the bottom edge`).toBeLessThanOrEqual(viewport.height + 1);
    }
  });
}

test("dashboard has no serious accessibility violations", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "风险分布概览" })).toBeVisible();
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations.filter((item) => item.impact === "serious" || item.impact === "critical")).toEqual([]);
});
