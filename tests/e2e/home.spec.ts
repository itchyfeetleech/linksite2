import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("homepage", () => {
  test("shows the hero content and passes axe-core checks", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Analog Signals" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Main Site" })).toHaveAttribute("href", "https://example.com");

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
