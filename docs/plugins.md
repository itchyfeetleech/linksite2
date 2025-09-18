# Plugin system

The faux desktop can discover and mount apps without touching core components. Plugins consist of:

- A manifest JSON file in `public/plugins/`.
- A Svelte module inside `src/plugins/` (for trusted islands) or static assets for sandboxed iframes.

Dropping both files into the repo is enough—`import.meta.glob` picks them up at build time and the taskbar exposes new launchers automatically.

## Manifest schema

Each manifest lives at `public/plugins/<name>.json` and must satisfy the schema below.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | ✅ | Unique slug using lowercase letters, numbers, or `-`. Used as the window id. |
| `title` | string | ✅ | Display name in window chrome and taskbar. |
| `description` | string | | Optional blurb for the Start menu tooltip. |
| `icon` | string | ✅ | Emoji or image path/URL displayed in launchers. |
| `module` | string | ✅ | Entry point. For `integration: "island"` this is the path to a Svelte module inside `src/plugins`. For `integration: "iframe"` provide an absolute URL or `/`-prefixed path served from `public/`. |
| `integration` | `'island' \| 'iframe'` | | Defaults to `'island'`. Islands run as Svelte components; iframe plugins are sandboxed. |
| `defaultBounds` | `{ x, y, width, height }` | ✅ | Initial window position and size. Width/height must be positive. |
| `minWidth` / `minHeight` | number | | Optional window constraints (pixels). |
| `maxWidth` / `maxHeight` | number \| null | | Optional maximum size. |
| `allowClose` / `allowMinimize` / `allowMaximize` | boolean | | Toggle window chrome buttons. Defaults to `true`. |
| `restoreFocus` | boolean | | Whether the window should grab focus when reopened. Defaults to `true`. |
| `startOpen` | boolean | | Open the window on load. Defaults to `false`. |
| `pinned` | boolean | | Show in the taskbar pinned apps row. Defaults to `true`. |
| `showInStart` | boolean | | Show in the Start menu list. Defaults to `true`. |
| `sandbox` | object | | Iframe-only settings. Supports `allow` (string for the `sandbox` attribute), `permissions` (array for the iframe `allow` attribute), `allowedOrigins` (array of origins allowed to talk to the host—`"self"` is replaced with the current origin), and `initialHeight` (number of pixels before the iframe reports its size). |

> ⚠️ Validation happens at build time. Invalid manifests are omitted and surfaced in the debug overlay and console so the desktop keeps rendering safely.

### Example manifest (Svelte island)

```json
{
  "id": "text-pad",
  "title": "Text Pad",
  "description": "Scratch pad for quick notes.",
  "icon": "📝",
  "module": "sample/TextPad.svelte",
  "defaultBounds": { "x": 540, "y": 200, "width": 360, "height": 320 },
  "minWidth": 320,
  "minHeight": 240
}
```

### Example manifest (sandboxed iframe)

```json
{
  "id": "weather",
  "title": "Weather Radar",
  "icon": "/plugins/weather/icon.svg",
  "integration": "iframe",
  "module": "/plugins/weather/index.html",
  "defaultBounds": { "x": 400, "y": 180, "width": 480, "height": 360 },
  "sandbox": {
    "allow": "allow-scripts allow-same-origin",
    "permissions": ["fullscreen"],
    "allowedOrigins": ["self"],
    "initialHeight": 360
  }
}
```

## Authoring an island plugin

1. Create a Svelte component inside `src/plugins/`. Use any folder structure you like (e.g. `src/plugins/my-tool/MyTool.svelte`).
2. Reference the module from your manifest using the relative path (for the example above: `"module": "my-tool/MyTool.svelte"`).
3. Ship any supporting assets alongside the component (imports work the same as other Svelte islands).
4. Drop the manifest JSON into `public/plugins/`. No additional wiring is required.

Islands are dynamically imported the first time their window is activated. Loading status and errors are surfaced inside the window frame and in the debug overlay.

## Authoring a sandboxed iframe plugin

1. Build the plugin UI as a standalone HTML/JS bundle placed inside `public/plugins/<id>/` (or host it on another origin).
2. Set `integration` to `"iframe"` and point `module` to the iframe source (absolute URL or `/plugins/...`).
3. Optional: tune the sandbox options:
   - `allow`: passed to the iframe `sandbox` attribute. Defaults to `allow-scripts allow-same-origin`.
   - `permissions`: forwarded to the iframe `allow` attribute (semicolon-delimited).
   - `allowedOrigins`: whitelist of origins that can exchange `postMessage` traffic with the host. Use `"self"` to refer to the current origin. The iframe origin is always allowed automatically.
   - `initialHeight`: starting height (px) before the iframe reports its size.

### postMessage contract

The host automatically sends `postMessage({ type: 'biolink-host:init', pluginId })` when the iframe loads. Plugins should answer with `postMessage({ type: 'biolink-plugin:ready' })`. Supported messages from the iframe:

- `biolink-plugin:ready` — marks the iframe as ready and hides the loading overlay.
- `biolink-plugin:resize` — accepts `{ height: number }` to request a container height in pixels (minimum 120px).
- `biolink-plugin:error` — accepts `{ message: string }` to display an error state in the window and log via the debug console.

Any message from an unexpected origin is ignored.

## Diagnostics

- Successful manifests appear as launchers in the taskbar and Start menu.
- Validation failures do not crash the desktop. They are recorded in the debug overlay (toggle with Alt+D or long-press the taskbar) and logged via the in-app console.
- Window state persists per plugin id using the existing `WindowManager` storage key.

## Sample plugin

The repository ships with `Text Pad`, defined by `public/plugins/text-pad.json` and implemented in `src/plugins/sample/TextPad.svelte`. Use it as a reference implementation when building new islands.
