import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import LinksApp from "../../src/components/LinksApp.svelte";
import type {
  ResolvedProfile,
  ResolvedProfileLink,
  ResolvedProfileSection,
  ResolvedProfileSectionItem,
} from "../../src/stores/profileStore";

type SectionInput = [title: string, items: Partial<ResolvedProfileSectionItem>[]];

const buildSection = ([title, items]: SectionInput): ResolvedProfileSection => ({
  title,
  items: items.map((item) => ({
    label: item.label ?? null,
    value: item.value ?? null,
    href: item.href ?? null,
    icon: item.icon ?? null,
    badge: item.badge ?? null,
    note: item.note ?? null,
    copyable: item.copyable ?? false,
    text: item.text ?? null,
  })),
});

const links: ResolvedProfileLink[] = [
  {
    label: "Main Site",
    url: "https://example.com",
    icon: "lucide:waveform",
    badge: "LIVE",
    cta: true,
  },
  {
    label: "Broadcast",
    url: "https://example.com/radio",
    icon: "lucide:radio",
    badge: undefined,
    cta: false,
  },
];

const sections: ResolvedProfileSection[] = [
  buildSection([
    "Contact",
    [
      {
        label: "Email",
        value: "hello@example.com",
        href: "mailto:hello@example.com",
        copyable: true,
      },
    ],
  ]),
  buildSection([
    "Tip Jar",
    [
      {
        label: "ETH",
        value: "0x1234",
        copyable: true,
      },
    ],
  ]),
];

const sampleProfile: ResolvedProfile = {
  displayName: "Analog Signals",
  handle: "analogsignals",
  avatar: "/avatar.png",
  bio: "Broadcast lab",
  theme: "green",
  links,
  sections,
};

describe("LinksApp", () => {
  let execCommandDescriptor: PropertyDescriptor | undefined;
  let clipboardDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    execCommandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();

    if (execCommandDescriptor) {
      Object.defineProperty(document, "execCommand", execCommandDescriptor);
    } else {
      Reflect.deleteProperty(document as unknown as Record<string, unknown>, "execCommand");
    }

    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "clipboard");
    }
  });

  it("renders profile header, links, and QR code", () => {
    render(LinksApp, { profile: sampleProfile, siteUrl: "https://example.com" });

    expect(screen.getByText("Analog Signals")).toBeVisible();
    expect(screen.getByText("@analogsignals")).toBeVisible();
    expect(screen.getByRole("link", { name: /Main Site/i })).toBeVisible();
    expect(screen.getByRole("img", { name: /QR code/i })).toBeVisible();
  });

  it("falls back to execCommand when clipboard permissions are unavailable", async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    render(LinksApp, { profile: sampleProfile, siteUrl: "https://example.com" });

    const contactSection = screen.getByText(/Reach out/i).closest("article");
    expect(contactSection).not.toBeNull();
    if (!contactSection) {
      return;
    }

    const sectionUtils = within(contactSection);
    const copyButton = sectionUtils.getByRole("button", { name: /copy/i });

    await fireEvent.click(copyButton);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copyButton).toHaveTextContent(/copied/i);

    vi.runAllTimers();
  });
});
