<script lang="ts">
  export interface LinkItem {
    href: string;
    label: string;
    description?: string;
    badge?: string;
  }

  export let links: LinkItem[] = [];

  let activeLabel = 'Standby';

  const setActive = (label: string) => {
    activeLabel = label;
  };

  const reset = () => {
    activeLabel = 'Standby';
  };
</script>

<div class="flex flex-col gap-4">
  <ul class="space-y-3">
    {#each links as link (link.href)}
      <li>
        <a
          class="group relative block overflow-hidden rounded border border-accent/40 bg-surface-glare/70 p-4 shadow-glow transition-all duration-200 hover:-translate-y-1 hover:border-accent focus-visible:-translate-y-1 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          href={link.href}
          rel="me noopener noreferrer"
          target="_blank"
          on:mouseenter={() => setActive(link.label)}
          on:focus={() => setActive(link.label)}
          on:mouseleave={reset}
          on:blur={reset}
        >
          <span class="text-lg font-mono uppercase tracking-[0.35em] text-accent drop-shadow">
            {link.label}
          </span>
          {#if link.description}
            <span class="mt-2 block text-sm text-muted">{link.description}</span>
          {/if}
          {#if link.badge}
            <span class="absolute right-4 top-4 rounded-full border border-accent/60 px-2 py-0.5 text-xs font-mono uppercase tracking-[0.3em] text-accent-soft">
              {link.badge}
            </span>
          {/if}
          <span
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-60"
          >
            <span class="absolute inset-0 animate-crt-scan bg-gradient-to-b from-transparent via-accent/10 to-transparent mix-blend-screen"></span>
          </span>
        </a>
      </li>
    {/each}
  </ul>
  <div class="flex items-center justify-between rounded border border-accent/30 bg-surface-glare/60 px-4 py-3 font-mono text-xs uppercase tracking-[0.3em] text-muted shadow-inner shadow-accent/10">
    <span>Signal</span>
    <span class="text-accent transition-colors duration-200">{activeLabel}</span>
  </div>
</div>

<style>
  .drop-shadow {
    text-shadow: 0 0 calc(0.4rem + var(--glow-strength) * 0.4rem) rgb(var(--accent) / 0.55);
  }
</style>

