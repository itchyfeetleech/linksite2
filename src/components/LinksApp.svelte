<script lang="ts">
  import { animate, stagger } from 'motion';
  import { onDestroy, onMount } from 'svelte';
  import { createQrSvg } from '../lib/qr';
  import type {
    ResolvedProfile,
    ResolvedProfileLink,
    ResolvedProfileSection,
    ResolvedProfileSectionItem
  } from '../stores/profileStore';

  type IconComponent = typeof import('@iconify/svelte/dist/Icon.svelte').default;

  const FALLBACK_ICON = 'lucide:link-2';
  const CTA_CLASSES =
    'border-accent/70 bg-accent text-surface shadow-glow shadow-accent/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent/40';
  const LINK_CLASSES =
    'border-accent/20 bg-surface-glare/70 hover:border-accent/60 hover:-translate-y-0.5 hover:shadow-glow';

  export let profile: ResolvedProfile;
  export let siteUrl: string;

  let IconCtor: IconComponent | null = null;
  let linksList: HTMLUListElement | null = null;
  let resolvedSiteUrl = siteUrl;
  let qrMarkup = '';
  let copyAnnouncement = '';
  let copiedKey: string | null = null;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  interface SectionBucket extends ResolvedProfileSection {
    key: string;
  }

  let updatesSection: SectionBucket | null = null;
  let contactSection: SectionBucket | null = null;
  let tipJarSection: SectionBucket | null = null;
  let socialsSection: SectionBucket | null = null;
  let nowPlayingSection: SectionBucket | null = null;
  let extraSections: SectionBucket[] = [];

  const hasWindow = typeof window !== 'undefined';

  const formattedHandle = profile.handle
    ? profile.handle.startsWith('@')
      ? profile.handle
      : `@${profile.handle}`
    : '';

  const loadIconComponent = async () => {
    if (IconCtor) {
      return IconCtor;
    }

    const module = await import('@iconify/svelte/dist/Icon.svelte');
    IconCtor = module.default;
    return IconCtor;
  };

  const animateLinks = () => {
    if (!hasWindow || !linksList) {
      return;
    }

    const items = Array.from(linksList.querySelectorAll('[data-link]')) as HTMLElement[];
    if (!items.length) {
      return;
    }

    animate(
      items,
      { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0)'] },
      { delay: stagger(0.045), duration: 0.35, easing: 'ease-out' }
    );
  };

  const normalizeKey = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const computeSections = () => {
    const pool: SectionBucket[] = (profile.sections ?? []).map((section) => ({
      ...section,
      key: normalizeKey(section.title)
    }));

    const takeSection = (keys: string[]): SectionBucket | null => {
      const index = pool.findIndex((candidate) => keys.includes(candidate.key));
      if (index === -1) {
        return null;
      }
      const [section] = pool.splice(index, 1);
      return section ?? null;
    };

    updatesSection = takeSection(['updates', 'update log']);
    contactSection = takeSection(['contact', 'contact info']);
    tipJarSection = takeSection(['tip jar', 'support', 'support us']);
    socialsSection = takeSection(['socials', 'social', 'community']);
    nowPlayingSection = takeSection(['now playing', 'now-playing', 'playing now']);
    extraSections = pool;
  };

  const generateQrMarkup = () => {
    const value = resolvedSiteUrl || siteUrl;
    qrMarkup = createQrSvg(value, {
      size: 196,
      margin: 12,
      color: 'currentColor',
      background: 'transparent',
      ariaLabel: 'QR code linking to this page'
    });
  };

  $: profile, computeSections();

  $: resolvedSiteUrl, siteUrl, generateQrMarkup();

  onMount(() => {
    void loadIconComponent();

    if (hasWindow) {
      resolvedSiteUrl = window.location.href;
      generateQrMarkup();
      queueMicrotask(animateLinks);
    }
  });

  onDestroy(() => {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
  });

  const resetCopyState = () => {
    if (clearTimer) {
      clearTimeout(clearTimer);
    }

    clearTimer = setTimeout(() => {
      copiedKey = null;
      copyAnnouncement = '';
      clearTimer = null;
    }, 2200);
  };

  const execCopyFallback = (value: string) => {
    if (!hasWindow || typeof document === 'undefined') {
      return false;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'absolute';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);

    const selection = window.getSelection();
    const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    textarea.select();
    let success = false;

    try {
      success = document.execCommand('copy');
    } catch (error) {
      success = false;
    }

    document.body.removeChild(textarea);

    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }

    return success;
  };

  const copyText = async (value: string) => {
    if (!value || value.trim() === '') {
      return false;
    }

    if (hasWindow && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (error) {
        // noop, fall back to execCommand
      }
    }

    return execCopyFallback(value);
  };

  const handleCopy = async (key: string, value: string | null, label: string) => {
    if (!value || value.trim() === '') {
      copyAnnouncement = `${label} is empty.`;
      copiedKey = null;
      resetCopyState();
      return;
    }

    const success = await copyText(value);
    copiedKey = success ? key : null;
    copyAnnouncement = success
      ? `${label} copied to clipboard.`
      : `Unable to copy ${label}.`;
    resetCopyState();
  };

  const formatLinkHost = (url: string) => {
    if (url.startsWith('mailto:')) {
      return url.slice('mailto:'.length);
    }

    try {
      const parsed = new URL(url);
      return parsed.host.replace(/^www\./, '');
    } catch (error) {
      return url;
    }
  };

  const resolveLinkIcon = (link: ResolvedProfileLink) => link.icon || FALLBACK_ICON;

  const sectionItemKey = (section: SectionBucket, item: ResolvedProfileSectionItem, index: number) =>
    `${section.key}-${index}`;

  const sectionItemPrimary = (item: ResolvedProfileSectionItem) =>
    item.value ?? item.text ?? '';

  const sectionItemSecondary = (item: ResolvedProfileSectionItem) => item.note ?? '';

  const sectionItemLabel = (item: ResolvedProfileSectionItem) =>
    item.label ?? (item.text ? '' : sectionItemPrimary(item));
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex-1 overflow-y-auto px-4 pb-5 pt-4 sm:px-6 sm:pt-6">
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header class="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        {#if profile.avatar}
          <div class="flex-shrink-0">
            <img
              class="h-20 w-20 rounded-3xl border border-accent/40 object-cover shadow-glow shadow-accent/30 sm:h-24 sm:w-24"
              src={profile.avatar}
              alt={`Avatar for ${profile.displayName}`}
              loading="lazy"
              decoding="async"
            />
          </div>
        {/if}
        <div class="min-w-0 space-y-3">
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="text-2xl font-semibold tracking-tight text-text sm:text-3xl">
              {profile.displayName}
            </h1>
            {#if formattedHandle}
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-surface-glare/60 px-3 py-1 text-xs font-medium uppercase tracking-wide text-accent transition hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                on:click={() => handleCopy('handle', formattedHandle, 'Handle')}
              >
                <span>{formattedHandle}</span>
                <span class="text-[0.65rem] font-semibold tracking-widest text-accent/80">
                  {copiedKey === 'handle' ? 'Copied' : 'Copy'}
                </span>
              </button>
            {/if}
          </div>
          <p class="text-sm leading-relaxed text-muted sm:text-base">{profile.bio}</p>
        </div>
      </header>

      <section aria-labelledby="links-heading" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 id="links-heading" class="text-xs font-semibold uppercase tracking-[0.3em] text-muted">
            Signals
          </h2>
          <span class="text-xs font-medium text-accent/80">{profile.links.length} active</span>
        </div>
        <ul class="flex flex-col gap-3" bind:this={linksList}>
          {#each profile.links as link (link.url)}
            <li>
              <a
                class={`group flex items-center justify-between gap-4 rounded-3xl border px-4 py-4 text-base transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:px-6 ${
                  link.cta ? CTA_CLASSES : LINK_CLASSES
                }`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                data-link
              >
                <div class="flex items-center gap-4">
                  <div
                    class={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border ${
                      link.cta
                        ? 'border-surface/30 bg-surface/20 text-surface'
                        : 'border-accent/30 bg-surface text-accent'
                    }`}
                  >
                    {#if IconCtor}
                      <svelte:component
                        this={IconCtor}
                        icon={resolveLinkIcon(link)}
                        class={`h-5 w-5 ${link.cta ? 'text-surface' : 'text-accent'}`}
                        aria-hidden="true"
                      />
                    {:else}
                      <span aria-hidden="true" class="text-lg">🔗</span>
                    {/if}
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 text-left">
                      <span class="font-semibold tracking-tight">
                        {link.label}
                      </span>
                      {#if link.badge}
                        <span
                          class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.3em] ${
                            link.cta
                              ? 'border-surface/40 text-surface/90'
                              : 'border-accent/50 text-accent'
                          }`}
                        >
                          {link.badge}
                        </span>
                      {/if}
                    </div>
                    <p class={`text-sm ${link.cta ? 'text-surface/80' : 'text-muted'}`}>
                      {formatLinkHost(link.url)}
                    </p>
                  </div>
                </div>
                <span
                  aria-hidden="true"
                  class={`text-sm font-medium uppercase tracking-[0.3em] ${
                    link.cta ? 'text-surface/90' : 'text-accent/80'
                  }`}
                >
                  Tune
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </section>

      <section class="grid gap-4 md:grid-cols-2">
        {#if updatesSection}
          <article class="rounded-3xl border border-accent/20 bg-surface-glare/60 p-4 shadow-inner shadow-accent/10">
            <header class="flex items-center justify-between gap-3">
              <h3 class="text-xs font-semibold uppercase tracking-[0.3em] text-muted">
                {updatesSection.title}
              </h3>
              <span class="text-xs text-accent/70">Latest signal</span>
            </header>
            <ul class="mt-3 space-y-3 text-sm text-text">
              {#each updatesSection.items as item, index (sectionItemKey(updatesSection, item, index))}
                <li class="rounded-2xl border border-accent/10 bg-surface/60 px-3 py-2">
                  {#if sectionItemLabel(item)}
                    <p class="text-[0.7rem] font-semibold uppercase tracking-[0.35em] text-accent/80">
                      {sectionItemLabel(item)}
                    </p>
                  {/if}
                  {#if sectionItemPrimary(item)}
                    <p class="mt-1 text-[0.95rem] leading-snug text-text">
                      {sectionItemPrimary(item)}
                    </p>
                  {/if}
                  {#if sectionItemSecondary(item)}
                    <p class="mt-1 text-xs text-muted">
                      {sectionItemSecondary(item)}
                    </p>
                  {/if}
                </li>
              {/each}
            </ul>
          </article>
        {/if}

        <article class="flex flex-col gap-4 rounded-3xl border border-accent/20 bg-surface-glare/60 p-4">
          <header class="flex items-center justify-between gap-3">
            <h3 class="text-xs font-semibold uppercase tracking-[0.3em] text-muted">
              {nowPlayingSection ? nowPlayingSection.title : 'Now Playing'}
            </h3>
            <span class="text-xs text-accent/70">Broadcast feed</span>
          </header>
          {#if nowPlayingSection && nowPlayingSection.items.length}
            {#each nowPlayingSection.items as item, index (sectionItemKey(nowPlayingSection, item, index))}
              <div class="rounded-2xl border border-accent/10 bg-surface px-3 py-3">
                {#if sectionItemLabel(item)}
                  <p class="text-[0.7rem] font-semibold uppercase tracking-[0.35em] text-accent/80">
                    {sectionItemLabel(item)}
                  </p>
                {/if}
                <p class="mt-1 text-base font-medium text-text">
                  {sectionItemPrimary(item) || 'Standby signal'}
                </p>
                <p class="mt-1 text-xs text-muted">
                  {sectionItemSecondary(item) || 'Awaiting live transmission.'}
                </p>
              </div>
            {/each}
          {:else}
            <div class="rounded-2xl border border-accent/10 bg-surface px-3 py-6 text-center">
              <p class="text-base font-semibold text-text">No broadcast in progress.</p>
              <p class="mt-1 text-xs text-muted">
                Return soon for the next transmission.
              </p>
            </div>
          {/if}
        </article>
      </section>

      <section class="grid gap-4 md:grid-cols-2">
        {#if contactSection}
          <article class="rounded-3xl border border-accent/20 bg-surface-glare/60 p-4">
            <header class="flex items-center justify-between gap-3">
              <h3 class="text-xs font-semibold uppercase tracking-[0.3em] text-muted">
                {contactSection.title}
              </h3>
              <span class="text-xs text-accent/70">Reach out</span>
            </header>
            <ul class="mt-3 space-y-3 text-sm text-text">
              {#each contactSection.items as item, index (sectionItemKey(contactSection, item, index))}
                <li class="rounded-2xl border border-accent/10 bg-surface/70 px-3 py-3">
                  <div class="flex flex-wrap items-center gap-2">
                    {#if sectionItemLabel(item)}
                      <span class="text-xs font-semibold uppercase tracking-[0.35em] text-accent/80">
                        {sectionItemLabel(item)}
                      </span>
                    {/if}
                    {#if item.href}
                      <a
                        class="text-sm font-medium text-accent underline-offset-4 transition hover:underline"
                        href={item.href}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {sectionItemPrimary(item) || sectionItemLabel(item)}
                      </a>
                    {:else if sectionItemPrimary(item)}
                      <span class="text-sm font-medium text-text">{sectionItemPrimary(item)}</span>
                    {/if}
                  </div>
                  <div class="mt-2 flex flex-wrap items-center gap-2">
                    {#if item.copyable && sectionItemPrimary(item)}
                      <button
                        type="button"
                        class="rounded-full border border-accent/40 bg-surface px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.35em] text-accent transition hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                        on:click={() =>
                          handleCopy(
                            `${contactSection?.key ?? 'contact'}-${index}`,
                            sectionItemPrimary(item),
                            sectionItemLabel(item) || 'Contact detail'
                          )
                        }
                      >
                        {copiedKey === `${contactSection?.key ?? 'contact'}-${index}` ? 'Copied' : 'Copy'}
                      </button>
                    {/if}
                    {#if sectionItemSecondary(item)}
                      <span class="text-xs text-muted">{sectionItemSecondary(item)}</span>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          </article>
        {/if}

        {#if tipJarSection || socialsSection || extraSections.length}
          <div class="space-y-4">
            {#if tipJarSection}
              <article class="rounded-3xl border border-accent/20 bg-surface-glare/60 p-4">
                <header class="flex items-center justify-between gap-3">
                  <h3 class="text-xs font-semibold uppercase tracking-[0.3em] text-muted">
                    {tipJarSection.title}
                  </h3>
                  <span class="text-xs text-accent/70">Support</span>
                </header>
                <ul class="mt-3 space-y-3 text-sm text-text">
                  {#each tipJarSection.items as item, index (sectionItemKey(tipJarSection, item, index))}
                    <li class="rounded-2xl border border-accent/10 bg-surface/70 px-3 py-3">
                      <div class="flex flex-wrap items-center gap-2">
                        {#if sectionItemLabel(item)}
                          <span class="text-xs font-semibold uppercase tracking-[0.35em] text-accent/80">
                            {sectionItemLabel(item)}
                          </span>
                        {/if}
                        {#if item.href}
                          <a
                            class="text-sm font-medium text-accent underline-offset-4 transition hover:underline"
                            href={item.href}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Visit
                          </a>
                        {:else if sectionItemPrimary(item)}
                          <span class="text-sm font-medium text-text">{sectionItemPrimary(item)}</span>
                        {/if}
                      </div>
                      {#if item.copyable && sectionItemPrimary(item)}
                        <button
                          type="button"
                          class="mt-2 rounded-full border border-accent/40 bg-surface px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.35em] text-accent transition hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                          on:click={() =>
                            handleCopy(
                              `${tipJarSection?.key ?? 'tip-jar'}-${index}`,
                              sectionItemPrimary(item),
                              sectionItemLabel(item) || 'Tip jar detail'
                            )
                          }
                        >
                          {copiedKey === `${tipJarSection?.key ?? 'tip-jar'}-${index}` ? 'Copied' : 'Copy'}
                        </button>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </article>
            {/if}

            {#if socialsSection}
              <article class="rounded-3xl border border-accent/20 bg-surface-glare/60 p-4">
                <header class="flex items-center justify-between gap-3">
                  <h3 class="text-xs font-semibold uppercase tracking-[0.3em] text-muted">
                    {socialsSection.title}
                  </h3>
                  <span class="text-xs text-accent/70">Find us</span>
                </header>
                <div class="mt-3 flex flex-wrap gap-2">
                  {#each socialsSection.items as item, index (sectionItemKey(socialsSection, item, index))}
                    {#if item.href}
                      <a
                        class="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-surface px-3 py-2 text-sm font-medium text-text transition hover:border-accent/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span class="inline-flex items-center justify-center">
                          {#if IconCtor && item.icon}
                            <svelte:component
                              this={IconCtor}
                              icon={item.icon}
                              class="h-4 w-4 text-accent"
                              aria-hidden="true"
                            />
                          {/if}
                        </span>
                        <span>{sectionItemLabel(item) || sectionItemPrimary(item)}</span>
                      </a>
                    {:else if sectionItemLabel(item)}
                      <span class="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-surface px-3 py-2 text-sm text-text">
                        {sectionItemLabel(item)}
                      </span>
                    {/if}
                  {/each}
                </div>
              </article>
            {/if}

            {#if extraSections.length}
              {#each extraSections as section (section.key)}
                <article class="rounded-3xl border border-accent/20 bg-surface-glare/60 p-4">
                  <header class="flex items-center justify-between gap-3">
                    <h3 class="text-xs font-semibold uppercase tracking-[0.3em] text-muted">
                      {section.title}
                    </h3>
                    <span class="text-xs text-accent/70">Briefing</span>
                  </header>
                  <ul class="mt-3 space-y-2 text-sm text-text">
                    {#each section.items as item, index (sectionItemKey(section, item, index))}
                      <li class="rounded-2xl border border-accent/10 bg-surface/70 px-3 py-2">
                        {#if sectionItemLabel(item)}
                          <p class="text-[0.7rem] font-semibold uppercase tracking-[0.35em] text-accent/80">
                            {sectionItemLabel(item)}
                          </p>
                        {/if}
                        <p class="mt-1 text-sm text-text">
                          {sectionItemPrimary(item) || sectionItemLabel(item)}
                        </p>
                        {#if sectionItemSecondary(item)}
                          <p class="mt-1 text-xs text-muted">{sectionItemSecondary(item)}</p>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </article>
              {/each}
            {/if}
          </div>
        {/if}
      </section>
    </div>
  </div>
  <div class="border-t border-accent/20 bg-surface/90 px-4 py-4 backdrop-blur sm:px-6">
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-4">
        <div class="rounded-2xl border border-accent/30 bg-surface px-4 py-4 text-accent">
          {@html qrMarkup}
        </div>
        <div class="space-y-1">
          <p class="text-sm font-semibold uppercase tracking-[0.3em] text-muted">Scan to tune</p>
          <p class="text-sm text-text">Open this station on another device.</p>
        </div>
      </div>
      <div class="text-xs text-muted">
        <p>Share {resolvedSiteUrl || siteUrl}</p>
      </div>
    </div>
    <p class="sr-only" aria-live="polite">{copyAnnouncement}</p>
  </div>
</div>
