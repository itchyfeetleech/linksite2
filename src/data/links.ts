export interface Link {
  href: string;
  label: string;
  description?: string;
  badge?: string;
}

export const links: Link[] = [
  {
    href: 'https://example.com',
    label: 'Main Site',
    description: 'Portfolio, writing, and experiments.',
    badge: 'LIVE'
  },
  {
    href: 'https://github.com/astro-build',
    label: 'GitHub',
    description: 'Open source projects and starter kits.'
  },
  {
    href: 'https://www.youtube.com/@astrodotbuild',
    label: 'Broadcast',
    description: 'Field recordings & streams with CRT vibes.'
  },
  {
    href: 'mailto:contact@example.com',
    label: 'Signal',
    description: 'Reach out for collaborations.'
  }
];
