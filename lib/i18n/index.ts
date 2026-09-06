import generatedCatalog from './catalog.generated.json';

export const SUPPORTED_LOCALES = ['en', 'sk', 'de', 'ja'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'rcj-soccer-lab-locale-v1';

export const LOCALE_OPTIONS: ReadonlyArray<{
  id: Locale;
  label: string;
  shortLabel: string;
}> = [
  { id: 'en', label: 'English', shortLabel: 'EN' },
  { id: 'sk', label: 'Slovenčina', shortLabel: 'SK' },
  { id: 'de', label: 'Deutsch', shortLabel: 'DE' },
  { id: 'ja', label: '日本語', shortLabel: 'JA' },
];

type TranslationPattern = { source: string; translation: string };
type TranslationSet = {
  exact: Record<string, string>;
  patterns: TranslationPattern[];
};
type GeneratedCatalog = {
  generatedAt: string;
  locales: Record<Exclude<Locale, 'en'>, TranslationSet>;
};

const catalog = generatedCatalog as GeneratedCatalog;
const patternCache = new Map<
  Locale,
  Array<TranslationPattern & { regex: RegExp }>
>();
const translationCache = new Map<string, string>();

export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(primary as Locale)
    ? (primary as Locale)
    : null;
}

export function safeReadLocale(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): Locale | null {
  try {
    return normalizeLocale(storage?.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function safeWriteLocale(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  locale: Locale,
) {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function resolveLocale({
  search = '',
  stored = null,
  browserLocales = [],
}: {
  search?: string;
  stored?: unknown;
  browserLocales?: readonly string[];
}): Locale {
  const query = new URLSearchParams(search);
  if (query.has('lang')) return normalizeLocale(query.get('lang')) ?? 'en';
  const saved = normalizeLocale(stored);
  if (saved) return saved;
  for (const candidate of browserLocales) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function setLocaleInHref(href: string, locale: Locale) {
  const url = new URL(href);
  url.searchParams.set('lang', locale);
  return url.toString();
}

export function appendLocaleToSearch(
  search: string,
  locale: Locale,
  values: Record<string, string | null | undefined> = {},
) {
  const query = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  query.set('lang', locale);
  for (const [key, value] of Object.entries(values)) {
    if (value == null) query.delete(key);
    else query.set(key, value);
  }
  return `?${query}`;
}

const normalizeText = (value: string) => value.trim().replace(/\s+/g, ' ');
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compiledPatterns(locale: Exclude<Locale, 'en'>) {
  const cached = patternCache.get(locale);
  if (cached) return cached;
  const compiled = catalog.locales[locale].patterns
    .map((pattern) => {
      const pieces = pattern.source.split(/\{\d+\}/);
      const parameters = [...pattern.source.matchAll(/\{(\d+)\}/g)].map(
        (match) => Number(match[1]),
      );
      if (!parameters.length) return null;
      let expression = '^';
      pieces.forEach((piece, index) => {
        expression += escapeRegExp(piece);
        if (index < parameters.length) expression += '(.+?)';
      });
      expression += '$';
      return { ...pattern, regex: new RegExp(expression, 'su') };
    })
    .filter(
      (
        pattern,
      ): pattern is TranslationPattern & {
        regex: RegExp;
      } => Boolean(pattern),
    )
    .sort((a, b) => b.source.length - a.source.length);
  patternCache.set(locale, compiled);
  return compiled;
}

/**
 * Translate authored display copy while keeping the simulation engine and its
 * stable IDs language-neutral. Unknown strings deliberately fall back to the
 * English source rather than making a runtime network request.
 */
export function translateText(value: string, locale: Locale): string {
  if (locale === 'en' || !value.trim()) return value;
  const leading = value.match(/^\s*/u)?.[0] ?? '';
  const trailing = value.match(/\s*$/u)?.[0] ?? '';
  const source = normalizeText(value);
  if (!/\p{L}/u.test(source)) return value;
  const cacheKey = `${locale}\u0000${source}`;
  const cached = translationCache.get(cacheKey);
  if (cached != null) return `${leading}${cached}${trailing}`;
  const exact = catalog.locales[locale].exact[source];
  if (exact) {
    translationCache.set(cacheKey, exact);
    return `${leading}${exact}${trailing}`;
  }

  for (const pattern of compiledPatterns(locale)) {
    const match = pattern.regex.exec(source);
    if (!match) continue;
    const translated = pattern.translation.replace(
      /\{(\d+)\}/g,
      (_, index: string) =>
        translateText(match[Number(index) + 1] ?? '', locale),
    );
    translationCache.set(cacheKey, translated);
    return `${leading}${translated}${trailing}`;
  }
  const segments = source.split(/(\s+[·—]\s+)/u);
  if (segments.length > 1) {
    const translated = segments
      .map((segment, index) =>
        index % 2 ? segment : translateText(segment, locale),
      )
      .join('');
    if (translated !== source) {
      translationCache.set(cacheKey, translated);
      return `${leading}${translated}${trailing}`;
    }
  }
  const joined = source.split(/(\s+(?:and|or)\s+)/u);
  if (joined.length > 1) {
    const translated = joined
      .map((segment) => translateText(segment, locale))
      .join('');
    if (translated !== source) {
      translationCache.set(cacheKey, translated);
      return `${leading}${translated}${trailing}`;
    }
  }
  const parenthetical = /^(.+?)\s+\(([^()]+)\)$/u.exec(source);
  if (parenthetical) {
    const translated = `${translateText(parenthetical[1], locale)} (${translateText(parenthetical[2], locale)})`;
    if (translated !== source) {
      translationCache.set(cacheKey, translated);
      return `${leading}${translated}${trailing}`;
    }
  }
  translationCache.set(cacheKey, source);
  return value;
}

export function hasTranslation(value: string, locale: Locale) {
  return locale === 'en' || translateText(value, locale) !== value;
}

export const TRANSLATION_CATALOG_GENERATED_AT = catalog.generatedAt;
