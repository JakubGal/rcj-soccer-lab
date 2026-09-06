'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  resolveLocale,
  safeReadLocale,
  safeWriteLocale,
  setLocaleInHref,
  translateText,
  type Locale,
} from '@/lib/i18n';

type LocalizationContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (source: string) => string;
};

const LocalizationContext = createContext<LocalizationContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
  t: (source) => source,
});

const LOCALIZED_ATTRIBUTES = [
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'alt',
  'placeholder',
  'title',
] as const;
const SKIPPED_SELECTOR = 'code, pre, script, style, textarea, [data-i18n-skip]';

type RenderedValue = { source: string; rendered: string };
const textValues = new WeakMap<Text, RenderedValue>();
const attributeValues = new WeakMap<Element, Map<string, RenderedValue>>();

function skipped(node: Node) {
  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  return Boolean(!element || element.closest(SKIPPED_SELECTOR));
}

function localizeTextNode(node: Text, locale: Locale) {
  if (skipped(node) || !node.data.trim()) return;
  const previous = textValues.get(node);
  const source =
    previous && node.data === previous.rendered ? previous.source : node.data;
  const rendered = translateText(source, locale);
  textValues.set(node, { source, rendered });
  if (node.data !== rendered) node.data = rendered;
}

function localizeElement(element: Element, locale: Locale) {
  if (skipped(element)) return;
  const values =
    attributeValues.get(element) ?? new Map<string, RenderedValue>();
  for (const attribute of LOCALIZED_ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (!current?.trim()) continue;
    const previous = values.get(attribute);
    const source =
      previous && current === previous.rendered ? previous.source : current;
    const rendered = translateText(source, locale);
    values.set(attribute, { source, rendered });
    if (current !== rendered) element.setAttribute(attribute, rendered);
  }
  if (values.size) attributeValues.set(element, values);
}

function localizeTree(root: Node, locale: Locale) {
  if (root.nodeType === Node.TEXT_NODE) {
    localizeTextNode(root as Text, locale);
    return;
  }
  if (root.nodeType === Node.ELEMENT_NODE)
    localizeElement(root as Element, locale);
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE)
      localizeTextNode(node as Text, locale);
    else localizeElement(node as Element, locale);
    node = walker.nextNode();
  }
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const restore = () => {
      setLocaleState(
        resolveLocale({
          search: window.location.search,
          stored: safeReadLocale(browserStorage()),
          browserLocales: navigator.languages ?? [navigator.language],
        }),
      );
    };
    const frame = requestAnimationFrame(() => {
      restore();
      setReady(true);
    });
    window.addEventListener('popstate', restore);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', restore);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.lang = locale;
    safeWriteLocale(browserStorage(), locale);
    const href = setLocaleInHref(window.location.href, locale);
    if (href !== window.location.href)
      window.history.replaceState(null, '', href);

    localizeTree(document.body, locale);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData')
          localizeTree(record.target, locale);
        else if (record.type === 'attributes')
          localizeElement(record.target as Element, locale);
        else for (const added of record.addedNodes) localizeTree(added, locale);
      }
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: [...LOCALIZED_ATTRIBUTES],
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [locale, ready]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  const value = useMemo<LocalizationContextValue>(
    () => ({
      locale,
      setLocale,
      t: (source) => translateText(source, locale),
    }),
    [locale, setLocale],
  );

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization() {
  return useContext(LocalizationContext);
}
