import { z } from 'zod';
import type { SvelteComponent } from 'svelte';
import type { Bounds } from '../components/windowing';

const boundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive()
});

const pluginManifestSchema = z
  .object({
    id: z
      .string()
      .min(1, 'id is required')
      .regex(/^[a-z0-9-]+$/, 'id must use lowercase letters, numbers, or dashes'),
    title: z.string().min(1, 'title is required'),
    description: z.string().optional().default(''),
    icon: z.string().min(1, 'icon is required'),
    module: z.string().min(1, 'module is required'),
    integration: z.enum(['island', 'iframe']).default('island'),
    defaultBounds: boundsSchema,
    minWidth: z.number().positive().optional(),
    minHeight: z.number().positive().optional(),
    maxWidth: z.number().positive().nullable().optional(),
    maxHeight: z.number().positive().nullable().optional(),
    allowClose: z.boolean().optional().default(true),
    allowMinimize: z.boolean().optional().default(true),
    allowMaximize: z.boolean().optional().default(true),
    restoreFocus: z.boolean().optional().default(true),
    startOpen: z.boolean().optional().default(false),
    pinned: z.boolean().optional().default(true),
    showInStart: z.boolean().optional().default(true),
    sandbox: z
      .object({
        allow: z.string().optional(),
        permissions: z.array(z.string()).optional(),
        allowedOrigins: z.array(z.string()).optional(),
        initialHeight: z.number().positive().optional()
      })
      .optional()
  })
  .superRefine((value, ctx) => {
    if (value.integration === 'iframe') {
      const module = value.module.trim();
      if (!module.startsWith('/') && !/^https?:\/\//.test(module)) {
        ctx.addIssue({
          path: ['module'],
          code: z.ZodIssueCode.custom,
          message: 'Iframe plugins must provide an absolute URL or a path that begins with "/".'
        });
      }
    } else if (/^https?:\/\//.test(value.module.trim())) {
      ctx.addIssue({
        path: ['module'],
        code: z.ZodIssueCode.custom,
        message: 'Island plugins must reference modules inside src/plugins (do not use absolute URLs).'
      });
    }
  });

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export type IconKind = 'glyph' | 'image';

export interface PluginSandboxOptions {
  allow: string | null;
  permissions: string[];
  allowedOrigins: string[];
  initialHeight: number | null;
}

interface PluginBaseDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  iconKind: IconKind;
  defaultBounds: Bounds;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number | null;
  maxHeight?: number | null;
  allowClose: boolean;
  allowMinimize: boolean;
  allowMaximize: boolean;
  restoreFocus: boolean;
  startOpen: boolean;
  pinned: boolean;
  showInStart: boolean;
  manifestPath: string;
}

export interface PluginComponentModule {
  default: typeof SvelteComponent;
}

export interface IslandPluginDefinition extends PluginBaseDefinition {
  integration: 'island';
  modulePath: string;
  load: () => Promise<PluginComponentModule>;
}

export interface IframePluginDefinition extends PluginBaseDefinition {
  integration: 'iframe';
  iframeSrc: string;
  sandbox: PluginSandboxOptions;
}

export type PluginDefinition = IslandPluginDefinition | IframePluginDefinition;

export interface PluginLoadError {
  manifestPath: string;
  summary: string;
  issues: string[];
}

type ManifestModule = Record<string, unknown>;
type ComponentLoader = () => Promise<PluginComponentModule>;

const manifestModules = import.meta.glob('../../public/plugins/**/*.json', {
  eager: true,
  import: 'default'
}) as Record<string, ManifestModule>;

const componentModules = import.meta.glob('./**/*.svelte') as Record<string, ComponentLoader>;

const canonicalizeModulePath = (value: string): string => {
  const normalized = value.replace(/\\+/g, '/').trim();
  const withoutDot = normalized.replace(/^\.\/?/, '');
  if (withoutDot.startsWith('src/plugins/')) {
    return withoutDot.slice('src/plugins/'.length);
  }
  if (withoutDot.startsWith('~/plugins/')) {
    return withoutDot.slice('~/plugins/'.length);
  }
  if (withoutDot.startsWith('plugins/')) {
    return withoutDot.slice('plugins/'.length);
  }
  return withoutDot;
};

const iconKindFromValue = (value: string): IconKind => {
  const trimmed = value.trim();
  if (/^(data:|https?:\/\/)/.test(trimmed)) {
    return 'image';
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return 'image';
  }
  if (/\.(svg|png|jpe?g|gif|webp|avif)$/i.test(trimmed)) {
    return 'image';
  }
  return 'glyph';
};

const normalizeManifestPath = (path: string): string => {
  const normalized = path.replace(/\\+/g, '/');
  const marker = '/public/';
  const index = normalized.lastIndexOf(marker);
  if (index === -1) {
    return normalized;
  }
  return `/${normalized.slice(index + marker.length)}`;
};

const moduleLoaders = new Map<string, ComponentLoader>();

for (const [key, loader] of Object.entries(componentModules)) {
  moduleLoaders.set(canonicalizeModulePath(key), loader);
}

const buildSandboxOptions = (manifest: PluginManifest): PluginSandboxOptions => {
  const sandbox = manifest.sandbox ?? {};
  const allow = sandbox.allow?.trim() ?? null;
  const permissions = Array.isArray(sandbox.permissions)
    ? sandbox.permissions.filter((item): item is string => typeof item === 'string')
    : [];
  const allowedOrigins = Array.isArray(sandbox.allowedOrigins)
    ? sandbox.allowedOrigins
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    : [];
  const initialHeight = typeof sandbox.initialHeight === 'number' && Number.isFinite(sandbox.initialHeight)
    ? sandbox.initialHeight
    : null;
  return { allow, permissions, allowedOrigins, initialHeight };
};

const seenIds = new Set<string>();

const definitions: PluginDefinition[] = [];
const errors: PluginLoadError[] = [];

const formatIssue = (path: (string | number)[], message: string) => {
  if (!path.length) {
    return message;
  }
  return `${path.join('.')}: ${message}`;
};

for (const [manifestPath, module] of Object.entries(manifestModules)) {
  const result = pluginManifestSchema.safeParse(module);
  if (!result.success) {
    errors.push({
      manifestPath: normalizeManifestPath(manifestPath),
      summary: 'Plugin manifest failed validation',
      issues: result.error.issues.map((issue) => formatIssue(issue.path, issue.message))
    });
    continue;
  }

  const manifest = result.data;
  if (seenIds.has(manifest.id)) {
    errors.push({
      manifestPath: normalizeManifestPath(manifestPath),
      summary: `Duplicate plugin id "${manifest.id}"`,
      issues: [`Another manifest already registered the id "${manifest.id}".`]
    });
    continue;
  }

  const base: PluginBaseDefinition = {
    id: manifest.id,
    title: manifest.title,
    description: manifest.description ?? '',
    icon: manifest.icon,
    iconKind: iconKindFromValue(manifest.icon),
    defaultBounds: { ...manifest.defaultBounds },
    minWidth: manifest.minWidth,
    minHeight: manifest.minHeight,
    maxWidth: manifest.maxWidth ?? null,
    maxHeight: manifest.maxHeight ?? null,
    allowClose: manifest.allowClose ?? true,
    allowMinimize: manifest.allowMinimize ?? true,
    allowMaximize: manifest.allowMaximize ?? true,
    restoreFocus: manifest.restoreFocus ?? true,
    startOpen: manifest.startOpen ?? false,
    pinned: manifest.pinned ?? true,
    showInStart: manifest.showInStart ?? true,
    manifestPath: normalizeManifestPath(manifestPath)
  };

  if (manifest.integration === 'iframe') {
    const sandbox = buildSandboxOptions(manifest);
    const iframeSrc = manifest.module.startsWith('http') || manifest.module.startsWith('/')
      ? manifest.module
      : `/${manifest.module.replace(/^\/?/, '')}`;

    definitions.push({
      ...base,
      integration: 'iframe',
      iframeSrc,
      sandbox
    });
    seenIds.add(manifest.id);
    continue;
  }

  const moduleKey = canonicalizeModulePath(manifest.module);
  const loader = moduleLoaders.get(moduleKey);

  if (!loader) {
    errors.push({
      manifestPath: normalizeManifestPath(manifestPath),
      summary: `Plugin module "${manifest.module}" was not found`,
      issues: ['Ensure the file exists inside src/plugins and the manifest uses a relative path.']
    });
    continue;
  }

  definitions.push({
    ...base,
    integration: 'island',
    modulePath: moduleKey,
    load: loader
  });
  seenIds.add(manifest.id);
}

export const pluginDefinitions: readonly PluginDefinition[] = definitions;
export const pluginLoadErrors: readonly PluginLoadError[] = errors;
