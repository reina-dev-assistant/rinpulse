import { i18n, type Locale } from '@/i18n';

import type { TemplateGroup } from '../offer';

/**
 * The picker label of a style in `locale`. The key is built from template ids, which no type can know, so it is looked up at
 * runtime; a style without a translation shows its id name instead of a raw key.
 */
export function templateTitle(group: Pick<TemplateGroup, 'name' | 'titleKey'>, locale: Locale): string {
  const t = i18n.getFixedT(locale);
  return i18n.exists(group.titleKey, { lng: locale }) ? String(t(group.titleKey as never)) : group.name;
}
