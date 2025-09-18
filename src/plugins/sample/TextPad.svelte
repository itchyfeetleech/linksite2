<script lang="ts">
  import { onMount } from 'svelte';

  let text = '';
  let savedText = '';
  let lastSavedAt: Date | null = null;
  let textArea: HTMLTextAreaElement | null = null;

  const handleSave = () => {
    savedText = text;
    lastSavedAt = new Date();
  };

  const handleClear = () => {
    text = '';
    savedText = '';
    lastSavedAt = null;
    textArea?.focus();
  };

  onMount(() => {
    textArea?.focus();
  });

  $: characterCount = text.length;
  $: hasUnsavedChanges = text !== savedText;
  $: statusLabel = hasUnsavedChanges
    ? 'Unsaved changes'
    : lastSavedAt
      ? `Saved ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
      : 'Ready';
</script>

<div class="pad">
  <header class="pad__header">
    <h2>Text Pad</h2>
    <div class="pad__meta">
      <span>{characterCount} chars</span>
      <span>{statusLabel}</span>
    </div>
  </header>
  <textarea
    bind:this={textArea}
    class="pad__textarea"
    bind:value={text}
    placeholder="Write quick notes here…"
    aria-label="Scratch pad editor"
  ></textarea>
  <footer class="pad__footer">
    <button type="button" class="pad__button" on:click={handleSave} disabled={!hasUnsavedChanges}>
      Save snapshot
    </button>
    <button type="button" class="pad__button pad__button--secondary" on:click={handleClear}>
      Clear
    </button>
  </footer>
</div>

<style>
  .pad {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: 1rem;
    padding: 1rem;
    color: rgb(var(--text, 220 235 220));
    font-family: var(--font-sans, system-ui, sans-serif);
  }

  .pad__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    font-family: var(--font-mono, 'IBM Plex Mono', monospace);
    text-transform: uppercase;
    letter-spacing: 0.25em;
    font-size: 0.7rem;
  }

  .pad__meta {
    display: flex;
    gap: 1rem;
    font-size: 0.65rem;
    opacity: 0.75;
  }

  .pad__textarea {
    flex: 1;
    width: 100%;
    resize: none;
    padding: 0.9rem;
    border-radius: 0.75rem;
    border: 1px solid rgb(var(--accent, 150 200 150) / 0.35);
    background: rgb(var(--surface, 10 10 10) / 0.75);
    color: inherit;
    font-family: var(--font-mono, 'IBM Plex Mono', monospace);
    font-size: 0.9rem;
    line-height: 1.5;
    box-shadow: inset 0 0 0 1px rgb(var(--accent, 150 200 150) / 0.08);
  }

  .pad__textarea:focus {
    outline: 2px solid rgb(var(--accent, 150 200 150));
    outline-offset: 2px;
  }

  .pad__footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  .pad__button {
    appearance: none;
    border: 1px solid rgb(var(--accent, 150 200 150));
    background: rgb(var(--accent, 150 200 150) / 0.25);
    color: inherit;
    padding: 0.5rem 1rem;
    border-radius: 0.6rem;
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 160ms ease, border-color 160ms ease, opacity 160ms ease;
  }

  .pad__button:hover:not(:disabled),
  .pad__button:focus-visible {
    background: rgb(var(--accent, 150 200 150) / 0.35);
    border-color: rgb(var(--accent, 150 200 150));
    outline: none;
  }

  .pad__button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pad__button--secondary {
    background: transparent;
    border-color: rgb(var(--accent, 150 200 150) / 0.5);
  }
</style>
