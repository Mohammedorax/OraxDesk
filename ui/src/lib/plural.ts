/**
 * CLDR plural categories, and the one place that asks `Intl.PluralRules`
 * which of them a count falls into.
 *
 * Arabic has six categories and English two, so a sentence that counts
 * something cannot be one template with a number dropped into it: "3 أجهزة"
 * and "11 جهازًا" are different words, not different digits. The catalogue
 * stores one key per category (`base.few`, `base.many`, …) and this module
 * picks the key, so no call site has to know the grammar.
 *
 * The rules object is cached per locale: `Intl.PluralRules` construction is
 * not free, and a selection bar re-renders on every pointer move while a
 * marquee is being dragged.
 */

/**
 * The categories in CLDR's own order. Exported because the catalogue's key
 * type is derived from them: a category that is not listed here has no key,
 * and a key with a suffix that is not listed here is not a plural entry.
 */
export const PLURAL_CATEGORIES = [
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
] as const;

export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

interface CachedRules {
  rules: Intl.PluralRules;
  /** What this locale can return. Every locale includes `other`. */
  categories: ReadonlySet<string>;
}

const cache = new Map<string, CachedRules>();

function rulesFor(locale: string): CachedRules {
  const cached = cache.get(locale);
  if (cached !== undefined) return cached;

  let rules: Intl.PluralRules;
  try {
    rules = new Intl.PluralRules(locale);
  } catch {
    // A malformed tag is a caller's mistake, not a reason to lose the
    // sentence. English is the fallback every runtime ships, and its two
    // categories are a subset of every other locale's.
    rules = new Intl.PluralRules("en");
  }

  const entry: CachedRules = {
    rules,
    categories: new Set(rules.resolvedOptions().pluralCategories),
  };
  cache.set(locale, entry);
  return entry;
}

/**
 * The category `count` falls into in `locale`.
 *
 * Total on purpose: `Intl` answers `other` for a fraction, for NaN and for
 * infinity, and a locale tag it cannot parse falls back to English. A count
 * that cannot be pluralised still has to produce a sentence.
 */
export function pluralForm(locale: string, count: number): PluralCategory {
  const { rules, categories } = rulesFor(locale);
  const selected = rules.select(count);
  // `select` promises a category from `resolvedOptions().pluralCategories`,
  // and every locale has `other`. Checking anyway keeps the promise local:
  // the catalogue only carries the suffixes this function can ask for.
  return categories.has(selected) ? selected : "other";
}

/**
 * The catalogue key for `count`: `base` plus the suffix this locale uses.
 *
 * English with a count of 2 asks for `base.other`, never `base.two`, because
 * English has no dual. That is what keeps an English catalogue two sentences
 * long where the key set is six.
 */
export function pluralKey(base: string, locale: string, count: number): string {
  return `${base}.${pluralForm(locale, count)}`;
}
