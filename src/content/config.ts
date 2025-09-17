import { defineCollection } from 'astro:content';
import { profileSchema } from '../data/profileSchema';

const profile = defineCollection({
  type: 'data',
  schema: profileSchema
});

export const collections = {
  profile
};
