/**
 * The built-in templates, parsed and validated once. A template that fails validation would be replaced by the engine's
 * fallback card, so `templates.test.ts` asserts every built-in parses with no issue and none degrades.
 */
import { parseTemplate } from './core/parse';
import type { Template } from './core/schema';
import { TEMPLATE_INPUTS } from './templates';

export const TEMPLATES: readonly Template[] = TEMPLATE_INPUTS.map((input) => parseTemplate(input).template);
