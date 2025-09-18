import { writable } from 'svelte/store';
import type { ZodIssue } from 'zod';
import {
  DEFAULT_PROFILE_THEME,
  profileSchema,
  type Profile,
  type ProfileLink,
  type ProfileSectionItem,
  type ProfileTheme
} from '../data/profileSchema';

const EXTERNAL_URL_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const ensureTrailingSlash = (value: string) =>
  value.endsWith('/') ? value : `${value}/`;

const basePath = (() => {
  const base = import.meta.env.BASE_URL ?? '/';
  if (!base || base === '') {
    return '/';
  }
  return ensureTrailingSlash(base);
})();

const resolvePublicPath = (path: string) => {
  const trimmed = path.trim();
  const withoutPrefix = trimmed.replace(/^\.\//, '').replace(/^\/+/, '');
  return `${basePath}${withoutPrefix}`;
};

const resolveUrl = (value: string) => {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('#')) {
    return trimmed;
  }
  if (EXTERNAL_URL_PATTERN.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('./')) {
    return resolvePublicPath(trimmed.slice(2));
  }
  if (trimmed.startsWith('/')) {
    return resolvePublicPath(trimmed);
  }
  return trimmed;
};

const resolveOptionalUrl = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const resolved = resolveUrl(value);
  return resolved === '' ? null : resolved;
};

const PROFILE_ENDPOINT = resolvePublicPath('config/profile.json');
const PROFILE_STORAGE_KEY = 'biolink-profile-cache';
const DEFAULT_LINK_ICON = 'lucide:link-2';

const hasWindow = typeof window !== 'undefined';

export type ResolvedProfileLink = ProfileLink & {
  icon: string;
  cta: boolean;
};

export interface ResolvedProfileSectionItem {
  label: string | null;
  value: string | null;
  href: string | null;
  icon: string | null;
  badge: string | null;
  note: string | null;
  copyable: boolean;
  text: string | null;
}

export interface ResolvedProfileSection {
  title: string;
  items: ResolvedProfileSectionItem[];
}

export type ResolvedProfile = Omit<Profile, 'links' | 'sections' | 'theme'> & {
  links: ResolvedProfileLink[];
  sections: ResolvedProfileSection[];
  theme: ProfileTheme;
};

export interface ProfileState {
  profile: ResolvedProfile | null;
  source: 'content' | 'cache' | 'json';
  isLoading: boolean;
  errors: string[];
  lastUpdated: number | null;
}

const baseStore = writable<ProfileState>({
  profile: null,
  source: 'content',
  isLoading: false,
  errors: [],
  lastUpdated: null
});

let initialized = false;
let activeFetch: Promise<void> | null = null;
let lastGoodProfile: ResolvedProfile | null = null;
let lastGoodSource: ProfileState['source'] = 'content';

const ensureResolvedProfile = (profile: Profile): ResolvedProfile => {
  const links = profile.links.map((link) => ({
    ...link,
    url: resolveUrl(link.url),
    icon: link.icon && link.icon.trim() !== '' ? link.icon : DEFAULT_LINK_ICON,
    cta: link.cta ?? false
  }));

  const sections = (profile.sections ?? []).map((section) => ({
    title: section.title,
    items: section.items.map((item) => normalizeSectionItem(item))
  }));

  const avatar = resolveOptionalUrl(profile.avatar);

  return {
    displayName: profile.displayName,
    handle: profile.handle,
    avatar: avatar ?? undefined,
    bio: profile.bio,
    theme: profile.theme ?? DEFAULT_PROFILE_THEME,
    links,
    sections
  } satisfies ResolvedProfile;
};

const normalizeSectionItem = (item: ProfileSectionItem): ResolvedProfileSectionItem => {
  if (typeof item === 'string') {
    return {
      label: null,
      value: null,
      href: null,
      icon: null,
      badge: null,
      note: null,
      copyable: false,
      text: item
    } satisfies ResolvedProfileSectionItem;
  }

  const icon = item.icon?.trim();
  const href = resolveOptionalUrl(item.href);

  return {
    label: item.label,
    value: item.value?.trim() ?? null,
    href,
    icon: icon && icon.length > 0 ? icon : null,
    badge: item.badge ?? null,
    note: item.note ?? null,
    copyable: item.copyable ?? false,
    text: null
  } satisfies ResolvedProfileSectionItem;
};

const persistProfile = (profile: Profile) => {
  if (!hasWindow) {
    return;
  }

  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch (error) {
    console.warn('Failed to persist profile data', error);
  }
};

const readPersistedProfile = (): Profile | null => {
  if (!hasWindow) {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as unknown;
    const result = profileSchema.safeParse(parsed);
    if (!result.success) {
      console.warn('Discarding cached profile due to validation errors', result.error);
      window.localStorage.removeItem(PROFILE_STORAGE_KEY);
      return null;
    }

    return result.data;
  } catch (error) {
    console.warn('Failed to read cached profile data', error);
    return null;
  }
};

const formatIssues = (issues: ZodIssue[]): string[] =>
  issues.map((issue) => {
    const path = issue.path.join('.') || 'profile';
    return `${path}: ${issue.message}`;
  });

const updateWithErrors = (errors: string[]) => {
  baseStore.update((state) => ({
    profile: lastGoodProfile ?? state.profile,
    source: lastGoodSource,
    isLoading: false,
    errors,
    lastUpdated: state.lastUpdated
  }));
};

const loadProfileFromRemote = () => {
  if (!hasWindow) {
    return Promise.resolve();
  }

  if (activeFetch) {
    return activeFetch;
  }

  baseStore.update((state) => ({
    ...state,
    isLoading: true
  }));

  activeFetch = (async () => {
    try {
      const response = await fetch(PROFILE_ENDPOINT, {
        cache: 'no-store',
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        updateWithErrors([`Failed to load profile config (${response.status} ${response.statusText}).`]);
        return;
      }

      const text = await response.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown parse error.';
        updateWithErrors([`profile.json could not be parsed as JSON: ${message}`]);
        return;
      }

      const parsed = profileSchema.safeParse(raw);
      if (!parsed.success) {
        updateWithErrors([
          'profile.json failed validation:',
          ...formatIssues(parsed.error.issues)
        ]);
        return;
      }

      const resolved = ensureResolvedProfile(parsed.data);
      lastGoodProfile = resolved;
      lastGoodSource = 'json';
      persistProfile(parsed.data);

      baseStore.set({
        profile: resolved,
        source: 'json',
        isLoading: false,
        errors: [],
        lastUpdated: Date.now()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error loading profile config.';
      updateWithErrors([`Failed to load profile config: ${message}`]);
    } finally {
      activeFetch = null;
    }
  })();

  return activeFetch;
};

export const profileStore = {
  subscribe: baseStore.subscribe
};

export const initializeProfileStore = (fallbackProfile: Profile) => {
  if (initialized) {
    return activeFetch ?? Promise.resolve();
  }

  const cachedProfile = readPersistedProfile();
  if (cachedProfile) {
    const resolved = ensureResolvedProfile(cachedProfile);
    lastGoodProfile = resolved;
    lastGoodSource = 'cache';
    baseStore.set({
      profile: resolved,
      source: 'cache',
      isLoading: hasWindow,
      errors: [],
      lastUpdated: Date.now()
    });
  } else {
    const resolved = ensureResolvedProfile(fallbackProfile);
    lastGoodProfile = resolved;
    lastGoodSource = 'content';
    baseStore.set({
      profile: resolved,
      source: 'content',
      isLoading: hasWindow,
      errors: [],
      lastUpdated: null
    });
  }

  initialized = true;

  if (hasWindow) {
    return loadProfileFromRemote();
  }

  return Promise.resolve();
};

export const reloadProfile = () => loadProfileFromRemote();
