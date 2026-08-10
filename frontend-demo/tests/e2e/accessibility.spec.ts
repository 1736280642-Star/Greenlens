import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const route of ["/dashboard", "/companies/cy-materials?tab=evidence", "/reports", "/review"]) {
  test(`no serious accessibility violations: ${route}`, async ({ page }) => {
    if (route === "/dashboard") test.slow();
    await page.goto(route);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}

for (const route of ["/dashboard", "/companies", "/companies/cy-materials", "/compare", "/reports", "/review", "/methodology"]) {
  const minimumFontSize = 12;
  test(`visible interface copy meets the ${minimumFontSize}px readability floor: ${route}`, async ({ page }) => {
    if (route === "/dashboard") test.slow();
    await page.goto(route);
    await page.locator("main").waitFor();
    if (route === "/dashboard") await expect(page.getByRole("heading", { name: "风险分布概览" })).toBeVisible();
    const undersized = await page.locator("body *:visible").evaluateAll((nodes, minimum) => nodes.flatMap((node) => {
      const element = node as HTMLElement;
      const hasOwnCopy = Array.from(element.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
      if (!hasOwnCopy) return [];
      const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
      if (!Number.isFinite(fontSize) || fontSize >= minimum) return [];
      return [{
        element: element.tagName.toLowerCase(),
        className: element.className,
        fontSize,
        text: element.innerText.trim().slice(0, 80),
      }];
    }), minimumFontSize);
    expect(undersized, JSON.stringify(undersized, null, 2)).toEqual([]);
  });
}
