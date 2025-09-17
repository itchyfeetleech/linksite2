import { z } from 'zod';

export const profileThemeSchema = z.enum(['green', 'amber']);

export const profileLinkSchema = z.object({
  label: z.string().min(1, 'Link label is required.'),
  url: z.string().min(1, 'Link URL is required.'),
  icon: z.string().min(1).optional(),
  badge: z.string().min(1).optional(),
  cta: z.boolean().optional()
});

export const profileSectionSchema = z.object({
  title: z.string().min(1, 'Section title is required.'),
  items: z.array(z.string().min(1, 'Section items cannot be empty.')).min(
    1,
    'Sections must include at least one item.'
  )
});

export const profileSchema = z.object({
  displayName: z.string().min(1, 'Display name is required.'),
  handle: z.string().min(1).optional(),
  avatar: z.string().min(1).optional(),
  bio: z.string().min(1, 'Bio copy is required.'),
  theme: profileThemeSchema.optional(),
  links: z.array(profileLinkSchema).min(1, 'At least one link is required.'),
  sections: z.array(profileSectionSchema).optional()
});

export type ProfileTheme = z.infer<typeof profileThemeSchema>;
export type ProfileLink = z.infer<typeof profileLinkSchema>;
export type ProfileSection = z.infer<typeof profileSectionSchema>;
export type Profile = z.infer<typeof profileSchema>;

export const DEFAULT_PROFILE_THEME: ProfileTheme = 'green';
