<script lang="ts">
  import WindowManager from './WindowManager.svelte';
  import Window from './Window.svelte';
  import CrtLinkList, { type LinkItem } from './CrtLinkList.svelte';
  import Taskbar from './Taskbar.svelte';

  export let links: LinkItem[] = [];
  export let year: number;
  export let lastTuned: string;

  const formattedTuned = new Date(lastTuned).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  });

  const storageKey = 'biolink-desktop-state';
  const schemaVersion = 1;
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
      <p class="console-channel">Channel &raquo; ANALOG SIGNALS</p>
      <h1 class="console-title">Creative Broadcast Lab</h1>
      <p class="console-copy">
        Welcome aboard the faux operating system powering this CRT transmission. Drag the panes around,
        tune their size, or park them in the dock when bandwidth is tight. Keyboard crew can use arrows to
        move (<kbd>↑</kbd>/<kbd>↓</kbd>/<kbd>←</kbd>/<kbd>→</kbd>), add <kbd>Shift</kbd> for fine steps, or hold
        <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> for resize. Hit <kbd>Enter</kbd> on a focused window to trigger its
        primary action, and punch <kbd>Esc</kbd> to close it out.
      </p>
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
      <div class="status-card large">
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
    gap: 1rem;
    color: rgb(var(--muted));
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

  .console-copy kbd {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: rgb(var(--surface-glare, 25 25 25) / 0.6);
    border: 1px solid rgb(var(--accent) / 0.35);
    border-radius: 0.35rem;
    padding: 0.1rem 0.4rem;
    box-shadow: inset 0 0 0.35rem rgb(var(--accent) / 0.2);
  }

  .status-grid {
    display: grid;
    gap: 1rem;
  }

  .status-card {
    display: grid;
    gap: 0.25rem;
    padding: 0.75rem;
    border-radius: 0.8rem;
    border: 1px solid rgb(var(--accent) / 0.28);
    background: rgb(var(--surface-glare, 24 24 24) / 0.6);
    font-family: var(--font-mono);
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

  .status-card.large kbd {
    font-family: inherit;
    letter-spacing: inherit;
  }

  @media (max-width: 640px) {
    .status-card.large li {
      flex-direction: column;
      gap: 0.1rem;
    }
  }
</style>
