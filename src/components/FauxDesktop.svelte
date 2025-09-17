<script lang="ts">
  import WindowManager from './WindowManager.svelte';
  import Window from './Window.svelte';
  import CrtLinkList, { type LinkItem } from './CrtLinkList.svelte';
  import Taskbar from './Taskbar.svelte';
  import type { Profile } from '../data/profileSchema';
  import {
    initializeProfileStore,
    profileStore,
    type ProfileState,
    type ResolvedProfile
  } from '../stores/profileStore';
  import { crtEffects } from '../stores/crtEffects';

  export let fallbackProfile: Profile;
  export let year: number;
  export let lastTuned: string;

  const formattedTuned = new Date(lastTuned).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  });

  const storageKey = 'biolink-desktop-state';
  const schemaVersion = 1;

  const store = profileStore;

  const SOURCE_LABELS: Record<ProfileState['source'], string> = {
    json: 'Live profile config',
    cache: 'Cached profile config',
    content: 'Fallback profile config'
  };

  const SOURCE_MESSAGES: Record<ProfileState['source'], string> = {
    json: 'the last known good profile config',
    cache: 'the cached profile config',
    content: 'the built-in fallback profile'
  };

  const DEFAULT_BIO =
    'Welcome aboard the faux operating system powering this CRT transmission. Drag the panes around, tune their size, or park them in the dock when bandwidth is tight. Keyboard crew can use arrows to move (↑/↓/←/→), add Shift for fine steps, or hold Ctrl/Cmd for resize. Hit Enter on a focused window to trigger its primary action, and punch Esc to close it out.';

  const formatHandle = (value: string) => (value.startsWith('@') ? value : `@${value}`);

  const DEFAULT_SOURCE: ProfileState['source'] = 'content';

  let initialized = false;
  let state: ProfileState;
  let profile: ResolvedProfile | null = null;
  let links: LinkItem[] = [];
  let sections: ResolvedProfile['sections'] = [];
  let channelLine = 'Channel » ANALOG SIGNALS';
  let displayName = 'Creative Broadcast Lab';
  let bioCopy = DEFAULT_BIO;
  let sourceKey: ProfileState['source'] = DEFAULT_SOURCE;
  let sourceLabel = SOURCE_LABELS[sourceKey];
  let sourceMessage = SOURCE_MESSAGES[sourceKey];
  let lastUpdatedLabel = '';
  let isRefreshing = false;

  $: if (!initialized) {
    initializeProfileStore(fallbackProfile);
    initialized = true;
  }

  $: state = $store;
  $: profile = state?.profile ?? null;
  $: links =
    profile?.links.map((link) => ({
      href: link.url,
      label: link.label,
      badge: link.badge
    })) ?? [];
  $: sections = profile?.sections ?? [];
  $: channelLine = profile
    ? `Channel » ${profile.handle ? formatHandle(profile.handle) : profile.displayName}`
    : 'Channel » ANALOG SIGNALS';
  $: displayName = profile?.displayName ?? 'Creative Broadcast Lab';
  $: bioCopy = profile?.bio ?? DEFAULT_BIO;
  $: sourceKey = state?.source ?? DEFAULT_SOURCE;
  $: sourceLabel = SOURCE_LABELS[sourceKey];
  $: sourceMessage = SOURCE_MESSAGES[sourceKey];
  $: lastUpdatedLabel = state?.lastUpdated
    ? new Date(state.lastUpdated).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '';
  $: isRefreshing = state?.isLoading ?? false;

  $: if (profile) {
    crtEffects.setTheme(profile.theme);
  }
</script>

<WindowManager {storageKey} {schemaVersion}>
  <Window
    id="console"
    title="Analog Signals Console"
    initialBounds={{ x: 72, y: 72, width: 520, height: 320 }}
    minWidth={420}
    minHeight={240}
  >
    <div class="console-content">
      <div class="console-header">
        {#if profile?.avatar}
          <img
            class="console-avatar"
            src={profile.avatar}
            alt={`Avatar for ${profile.displayName}`}
            loading="lazy"
            decoding="async"
          />
        {/if}
        <div class="console-heading">
          <p class="console-channel">{channelLine}</p>
          <h1 class="console-title">{displayName}</h1>
        </div>
      </div>
      <p class="console-copy">{bioCopy}</p>
      {#if state?.errors.length}
        <div class="console-errors" role="alert">
          <p>
            Issues detected while loading <code>public/config/profile.json</code>. Using {sourceMessage}.
          </p>
          <ul>
            {#each state.errors as error (error)}
              <li>{error}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </Window>

  <Window
    id="links"
    title="Links"
    initialBounds={{ x: 640, y: 120, width: 480, height: 480 }}
    minWidth={360}
    minHeight={320}
  >
    <CrtLinkList {links} />
  </Window>

  <Window
    id="status"
    title="Status Monitor"
    initialBounds={{ x: 180, y: 420, width: 360, height: 240 }}
    minWidth={300}
    minHeight={200}
  >
    <div class="status-grid">
      <div class="status-card">
        <span class="status-label">Session</span>
        <span class="status-value">{year}</span>
      </div>
      <div class="status-card">
        <span class="status-label">Last Tuned</span>
        <span class="status-value">{formattedTuned}</span>
      </div>
      <div class="status-card">
        <span class="status-label">Profile Source</span>
        <span class="status-value">{sourceLabel}</span>
        <span class="status-note">
          {#if isRefreshing}
            Refreshing…
          {:else if lastUpdatedLabel}
            Synced {lastUpdatedLabel}
          {:else}
            Awaiting sync
          {/if}
        </span>
      </div>
      {#if sections.length}
        {#each sections as section (section.title)}
          <div class="status-card large section-card">
            <span class="status-label">{section.title}</span>
            {#if section.items.length === 1}
              <span class="status-value">{section.items[0]}</span>
            {:else}
              <ul>
                {#each section.items as item (item)}
                  <li>{item}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      {/if}
      <div class="status-card large shortcuts-card">
        <span class="status-label">Shortcuts</span>
        <ul>
          <li><span><kbd>Shift</kbd> + Arrows</span><span>Fine move</span></li>
          <li><span><kbd>Alt</kbd> + Arrows</span><span>Warp move</span></li>
          <li><span><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + Arrows</span><span>Resize</span></li>
          <li><span><kbd>Enter</kbd></span><span>Activate</span></li>
          <li><span><kbd>Esc</kbd></span><span>Close window</span></li>
        </ul>
      </div>
    </div>
  </Window>

  <Taskbar linksWindowId="links" />
</WindowManager>

<style>
  .console-content {
    display: grid;
    gap: 1.25rem;
    color: rgb(var(--muted));
  }

  .console-header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .console-avatar {
    width: 96px;
    height: 96px;
    border-radius: 1.25rem;
    border: 1px solid rgb(var(--accent) / 0.4);
    object-fit: cover;
    background: rgb(var(--surface-glare, 25 25 25) / 0.7);
    box-shadow: 0 0 1.4rem rgb(var(--accent) / 0.2);
  }

  .console-heading {
    display: grid;
    gap: 0.5rem;
  }

  .console-channel {
    font-family: var(--font-mono);
    letter-spacing: 0.3em;
    text-transform: uppercase;
    font-size: 0.75rem;
    color: rgb(var(--accent));
  }

  .console-title {
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.22em;
    font-size: clamp(1.8rem, 2.6vw, 2.5rem);
    color: rgb(var(--accent-soft, 160 220 160));
    text-shadow: 0 0 1.6rem rgb(var(--accent) / 0.35);
  }

  .console-copy {
    font-size: 0.95rem;
    line-height: 1.6;
  }

  .console-errors {
    border: 1px solid rgb(var(--accent) / 0.35);
    border-radius: 0.85rem;
    padding: 0.85rem 1rem;
    background: rgb(var(--surface-glare, 24 24 24) / 0.65);
    display: grid;
    gap: 0.5rem;
  }

  .console-errors p {
    margin: 0;
    font-size: 0.85rem;
    letter-spacing: 0.08em;
  }

  .console-errors code {
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
  }

  .console-errors ul {
    margin: 0;
    padding-left: 1.25rem;
    display: grid;
    gap: 0.25rem;
  }

  .console-errors li {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
  }

  .console-errors li::marker {
    color: rgb(var(--accent));
  }

  .status-grid {
    display: grid;
    gap: 1rem;
  }

  .status-card {
    display: grid;
    gap: 0.35rem;
    padding: 0.75rem;
    border-radius: 0.8rem;
    border: 1px solid rgb(var(--accent) / 0.28);
    background: rgb(var(--surface-glare, 24 24 24) / 0.6);
    font-family: var(--font-mono);
  }

  .status-label {
    text-transform: uppercase;
    letter-spacing: 0.25em;
    font-size: 0.65rem;
    color: rgb(var(--accent));
  }

  .status-value {
    font-size: 1.1rem;
    letter-spacing: 0.15em;
  }

  .status-note {
    font-size: 0.7rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgb(var(--muted));
  }

  .status-card.large ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }

  .status-card.large li {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
  }

  .status-card.large kbd {
    font-family: inherit;
    letter-spacing: inherit;
  }

  .section-card {
    gap: 0.6rem;
  }

  .section-card ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
    font-size: 0.8rem;
    letter-spacing: 0.1em;
  }

  .section-card .status-value {
    font-size: 0.95rem;
    letter-spacing: 0.12em;
  }

  .shortcuts-card ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }

  @media (max-width: 640px) {
    .console-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }

    .console-avatar {
      width: 80px;
      height: 80px;
    }

    .status-card.large li {
      flex-direction: column;
      gap: 0.1rem;
    }
  }
</style>
