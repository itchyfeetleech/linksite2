<script lang="ts">
  import { crtEffects, crtRenderMode, type CRTTheme, type CRTToggle } from '../stores/crtEffects';
  import type { CRTRenderMode } from '../lib/crt/types';

  const themeOptions: CRTTheme[] = ['green', 'amber'];
  const toggleOrder: CRTToggle[] = ['scanlines', 'glow', 'aberration', 'barrel'];

  let controlsOpen = false;
  let renderMode: CRTRenderMode = 'css';
  let cssModeEnabled = true;

  const labels: Record<CRTTheme | CRTToggle | 'plain', string> = {
    green: 'Green phosphor',
    amber: 'Amber phosphor',
    scanlines: 'Scanlines',
    glow: 'Glass glow',
    aberration: 'Chromatic aberration',
    barrel: 'Distortion warp',
    plain: 'Plain mode'
  };

  $: state = $crtEffects;
  $: renderMode = $crtRenderMode;
  $: cssModeEnabled = renderMode === 'css';
  $: scanlineOpacity =
    cssModeEnabled && state && !state.plainMode && state.scanlines ? state.intensity.scanlines : 0;
  $: glowStrength =
    cssModeEnabled && state && !state.plainMode && state.glow ? state.intensity.glow : 0;
  $: aberrationStrength =
    cssModeEnabled && state && !state.plainMode && state.aberration ? state.intensity.aberration : 0;
  $: barrelStrength =
    cssModeEnabled && state && !state.plainMode && state.barrel ? state.intensity.barrel : 0;
  $: glowOverlayOpacity = glowStrength ? Math.min(glowStrength + 0.1, 0.85) : 0;
  let stageFilter = 'none';
  $: stageFilter = (() => {
    if (!cssModeEnabled) {
      return 'none';
    }
    const parts: string[] = [];
    if (barrelStrength) {
      parts.push(`url('#crt-barrel') contrast(1.05) saturate(1.05)`);
    }
    if (aberrationStrength) {
      const offset = Number((aberrationStrength * 7 + 1.2).toFixed(3));
      parts.push(
        `drop-shadow(${offset}px 0 0 rgba(255, 40, 120, 0.45)) drop-shadow(${-offset}px 0 0 rgba(0, 220, 255, 0.45))`
      );
    }
    return parts.length ? parts.join(' ') : 'none';
  })();
  $: barrelTransform =
    cssModeEnabled && barrelStrength
      ? `perspective(1100px) scale(${(1 + barrelStrength * 6).toFixed(3)})`
      : 'none';
  $: adjustmentsDisabled = Boolean(state?.plainMode);
  $: willChange =
    cssModeEnabled && (barrelStrength || aberrationStrength) ? 'filter, transform' : 'auto';

  const formatIntensity = (key: CRTToggle) => {
    const value = state?.intensity[key] ?? 0;

    if (key === 'barrel') {
      return `${Math.round(value * 100)}%`;
    }

    return `${Math.round(value * 100)}%`;
  };

  const onThemeChange = (theme: CRTTheme) => {
    crtEffects.setTheme(theme);
  };

  const onPlainToggle = () => {
    crtEffects.togglePlainMode();
  };

  const onEffectToggle = (key: CRTToggle) => {
    crtEffects.toggleEffect(key);
  };

  const onIntensityInput = (key: CRTToggle, event: Event) => {
    const target = event.currentTarget as HTMLInputElement;
    const parsed = Number.parseFloat(target.value);

    if (Number.isNaN(parsed)) {
      return;
    }

    crtEffects.setIntensity(key, parsed);
  };
</script>

<div class="crt-curtain" data-controls-open={controlsOpen}>
  <svg aria-hidden="true" class="crt-defs">
    <defs>
      <filter id="crt-barrel" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="2" result="noise" />
        <feGaussianBlur in="noise" stdDeviation="1.2" result="softNoise" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="softNoise"
          scale={Math.min(50, Math.max(0, barrelStrength * 2600))}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </defs>
  </svg>
  <div
    class="crt-stage"
    style={`filter: ${stageFilter}; transform: ${barrelTransform}; will-change: ${willChange};`}
  >
    <slot />
    <div aria-hidden="true" class="crt-overlay">
      <div class="crt-glow" style={`opacity: ${glowOverlayOpacity}`}></div>
      <div class="crt-scanlines" style={`opacity: ${scanlineOpacity}`}></div>
      <div class="crt-vignette"></div>
    </div>
  </div>
  <button
    class="crt-controls-trigger"
    type="button"
    on:click={() => (controlsOpen = !controlsOpen)}
    aria-expanded={controlsOpen}
    aria-controls="crt-controls-panel"
  >
    {controlsOpen ? 'Close effects' : 'Effects'}
  </button>
  {#if controlsOpen}
    <section
      id="crt-controls-panel"
      class="crt-controls"
      role="dialog"
      aria-label="CRT theming controls"
    >
      <div class="controls-section">
        <p class="controls-title">Theme</p>
        <div class="controls-row">
          {#each themeOptions as theme}
            <label class="theme-swatch">
              <input
                type="radio"
                name="crt-theme"
                value={theme}
                checked={state?.theme === theme}
                on:change={() => onThemeChange(theme)}
              />
              <span>{labels[theme]}</span>
            </label>
          {/each}
        </div>
      </div>
      <div class="controls-section">
        <label class="plain-toggle">
          <input type="checkbox" checked={state?.plainMode} on:change={onPlainToggle} />
          <span>{labels.plain}</span>
        </label>
      </div>
      <div class="controls-section">
        <p class="controls-title">Effects</p>
        {#each toggleOrder as key}
          <div class="effect-row">
            <label>
              <input
                type="checkbox"
                checked={state?.[key]}
                on:change={() => onEffectToggle(key)}
                disabled={adjustmentsDisabled}
              />
              <span>{labels[key]}</span>
            </label>
            <div class="effect-slider">
              <input
                class="slider"
                type="range"
                min={0}
                max={1}
                step={key === 'barrel' ? 0.01 : 0.05}
                value={state?.intensity[key] ?? 0}
                on:input={(event) => onIntensityInput(key, event)}
                disabled={adjustmentsDisabled || !(state?.[key] ?? false)}
              />
              <span aria-live="polite" class="slider-value">{formatIntensity(key)}</span>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .crt-curtain {
    position: relative;
    isolation: isolate;
  }

  .crt-defs {
    position: absolute;
    width: 0;
    height: 0;
  }

  .crt-stage {
    position: relative;
    min-height: 100%;
  }

  .crt-stage ::slotted(*) {
    position: relative;
    z-index: 1;
  }

  .crt-overlay {
    pointer-events: none;
    position: absolute;
    inset: 0;
    mix-blend-mode: screen;
    z-index: 2;
  }

  .crt-glow {
    position: absolute;
    inset: -40px;
    background: radial-gradient(circle at center, rgb(var(--accent) / 0.24), transparent 65%);
    filter: blur(calc(40px * (var(--glow-strength) + 0.2)));
    transition: opacity 240ms ease;
  }

  .crt-scanlines {
    position: absolute;
    inset: 0;
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent 1px,
      rgb(var(--accent) / 0.08) 1px,
      rgb(var(--accent) / 0.08) 2px
    );
    background-size: 100% 2px;
    animation: crt-scroll 24s linear infinite;
  }

  .crt-vignette {
    position: absolute;
    inset: -10%;
    background: radial-gradient(circle at center, transparent 55%, rgb(var(--bg) / 0.65) 100%);
    mix-blend-mode: multiply;
    opacity: 0.55;
  }

  .crt-controls-trigger {
    position: fixed;
    right: calc(1rem + var(--safe-area-right));
    bottom: calc(1rem + var(--safe-area-bottom));
    z-index: 40;
    padding: 0.65rem 1.1rem;
    border-radius: 9999px;
    border: 1px solid rgb(var(--accent) / 0.4);
    background: rgb(var(--bg-glare) / 0.85);
    color: rgb(var(--fg));
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    transition: transform 200ms ease, border-color 200ms ease;
  }

  .crt-controls-trigger:hover,
  .crt-controls-trigger:focus-visible {
    border-color: rgb(var(--accent));
    transform: translateY(-2px);
    outline: none;
  }

  .crt-controls {
    position: fixed;
    bottom: calc(1rem + var(--safe-area-bottom));
    right: calc(1rem + var(--safe-area-right));
    width: min(320px, calc(100vw - 2rem));
    max-height: min(70vh, 420px);
    padding: 1rem;
    border-radius: 1rem;
    border: 1px solid rgb(var(--accent) / 0.25);
    background: rgb(var(--bg-glare) / 0.9);
    backdrop-filter: blur(12px);
    color: rgb(var(--fg));
    z-index: 45;
    overflow-y: auto;
    box-shadow: 0 12px 32px rgb(var(--accent) / 0.12);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .controls-section {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .controls-title {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgb(var(--muted));
  }

  .controls-row {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .theme-swatch {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    border-radius: 0.75rem;
    border: 1px solid rgb(var(--accent) / 0.15);
    background: rgb(var(--bg) / 0.65);
  }

  .theme-swatch input {
    accent-color: rgb(var(--accent));
  }

  .theme-swatch span {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  .plain-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-mono);
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }

  .plain-toggle input,
  .effect-row input[type='checkbox'] {
    accent-color: rgb(var(--accent));
  }

  .effect-row {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .effect-row > label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-mono);
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }

  .effect-slider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .slider {
    flex: 1;
    accent-color: rgb(var(--accent));
  }

  .slider-value {
    width: 4rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-align: right;
    color: rgb(var(--accent-soft));
  }

  @media (max-width: 640px) {
    .crt-controls-trigger {
      font-size: 0.65rem;
      letter-spacing: 0.25em;
    }

    .crt-controls {
      left: calc(1rem + var(--safe-area-left));
      right: calc(1rem + var(--safe-area-right));
      width: auto;
    }
  }

  @media (max-width: 420px) {
    .effect-slider {
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
    }

    .slider-value {
      text-align: left;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .crt-scanlines {
      animation: none;
    }

    .crt-controls-trigger {
      transition-duration: 0ms;
    }
  }

  @keyframes crt-scroll {
    from {
      background-position-y: 0;
    }

    to {
      background-position-y: 100%;
    }
  }
</style>
