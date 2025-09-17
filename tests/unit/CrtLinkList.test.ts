import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import CrtLinkList from "../../src/components/CrtLinkList.svelte";

const sampleLinks = [
  {
    href: "https://example.com",
    label: "Main Site",
    description: "Portfolio, writing, and experiments.",
  },
  {
    href: "https://github.com/astro-build",
    label: "GitHub",
    description: "Open source projects and starter kits.",
    badge: "LIVE",
  },
] as const;

describe("CrtLinkList", () => {
  it("renders each link with the proper text", () => {
    render(CrtLinkList, { links: sampleLinks });

    sampleLinks.forEach((link) => {
      const anchor = screen.getByRole("link", { name: new RegExp(link.label, "i") });
      expect(anchor).toHaveAttribute("href", link.href);
    });
  });

  it("updates the signal display when focusing a link", async () => {
    render(CrtLinkList, { links: sampleLinks });

    const highlightLink = sampleLinks[1] ?? sampleLinks[0];
    const secondLink = screen.getByRole("link", { name: new RegExp(highlightLink.label, "i") });
    const container = screen.getByText("Signal").closest("div");
    expect(container).not.toBeNull();
    if (!container) {
      return;
    }
    const statusRegion = within(container);

    await fireEvent.focus(secondLink);

    expect(statusRegion.getByText(highlightLink.label, { exact: true })).toBeVisible();

    await fireEvent.blur(secondLink);

    expect(statusRegion.getByText("Standby")).toBeVisible();
  });
});
