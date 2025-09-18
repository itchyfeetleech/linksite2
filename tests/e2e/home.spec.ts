import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "desktop", viewport: { width: 1280, height: 720 } },
  { name: "mobile", viewport: { width: 414, height: 896 } },
];

const expectAxeClean = async (page: Page) => {
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  expect(accessibilityScanResults.violations).toEqual([]);
};

const loadHome = async (page: Page) => {
  await page.goto("/");
  const consoleDialog = page.getByRole("dialog", { name: "Analog Signals Console" });
  await expect(consoleDialog).toBeVisible();
  await expect(consoleDialog.getByRole("heading", { name: "Analog Signals Console" })).toBeVisible();

  const linksDialog = page.getByRole("dialog", { name: "Links" });
  await expect(linksDialog).toBeVisible();
  await expect(linksDialog.getByRole("heading", { name: "Links" })).toBeVisible();
};

for (const { name, viewport } of viewports) {
  test.describe(`${name} viewport`, () => {
    test.use({ viewport });

    test("idle desktop passes axe-core checks", async ({ page }) => {
      await loadHome(page);
      await expect(page.getByRole("link", { name: "Main Site" })).toHaveAttribute(
        "href",
        "https://example.com",
      );

      await expectAxeClean(page);
    });

    test("links window open passes axe-core checks", async ({ page }) => {
      await loadHome(page);
      await expect(page.getByRole("dialog", { name: "Links" })).toBeVisible();

      await expectAxeClean(page);
    });

    test("links window maximized passes axe-core checks", async ({ page }) => {
      await loadHome(page);
      const linksDialog = page.getByRole("dialog", { name: "Links" });
      const maximizeButton = linksDialog.getByRole("button", { name: /(?:Maximize|Restore) window/ });
      const label = await maximizeButton.getAttribute("aria-label");
      if (label === "Maximize window") {
        await maximizeButton.focus();
        await maximizeButton.press("Enter");
      }

      await expect(maximizeButton).toHaveAttribute("aria-label", "Restore window");
      await expect(linksDialog).toHaveClass(/is-maximized/);
      await expectAxeClean(page);
    });

    test("plain mode passes axe-core checks", async ({ page }) => {
      await loadHome(page);
      await page.getByRole("button", { name: "Effects" }).click();

      const controlsDialog = page.getByRole("dialog", { name: "CRT theming controls" });
      await expect(controlsDialog).toBeVisible();

      const plainModeToggle = controlsDialog.getByRole("checkbox", { name: "Plain mode" });
      await plainModeToggle.check();
      await expect(page.locator("html")).toHaveAttribute("data-mode", "plain");

      const closeEffects = page.getByRole("button", { name: "Close effects" });
      await closeEffects.focus();
      await closeEffects.press("Enter");
      await expect(controlsDialog).toHaveCount(0);

      await expectAxeClean(page);
    });
  });
}
