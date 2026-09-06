export type AppMode = 'rules' | 'play' | 'referee';
export type AppNavigation = {
  mode: AppMode;
  sectionId: string;
  situationId: string | null;
  arrange: boolean;
  embed: string | null;
};
export const INITIAL_NAVIGATION: AppNavigation = {
  mode: 'rules',
  sectionId: 'soccer:inside-penalty-area',
  situationId: null,
  arrange: false,
  embed: null,
};
export function readNavigation(search: string): AppNavigation {
  const query = new URLSearchParams(search);
  const mode = query.get('mode');
  const legacyStudy =
    mode === 'explore' ||
    mode === 'learn' ||
    (mode === 'referee' && query.has('scenario'));
  return {
    mode: legacyStudy
      ? 'rules'
      : mode === 'manual'
        ? 'play'
        : mode === 'referee' ||
            (mode === 'play' && query.get('referee') === '1')
          ? 'referee'
          : mode === 'play'
            ? 'play'
            : 'rules',
    sectionId: query.get('rule') ?? INITIAL_NAVIGATION.sectionId,
    situationId:
      query.get('situation') ??
      (query.get('scenario')
        ? `scenario:${query.get('scenario')}`
        : legacyStudy && !query.has('rule')
          ? 'scenario:legal-dribbler-backspin'
          : null),
    arrange: mode === 'manual' || query.get('arrange') === '1',
    embed: query.get('embed'),
  };
}
export function navigationSearch(
  nav: AppNavigation,
  robot: string,
  locale = 'en',
) {
  const query = new URLSearchParams({ mode: nav.mode, robot });
  query.set('lang', locale);
  if (nav.mode === 'rules') {
    query.set('rule', nav.sectionId);
    if (nav.situationId) query.set('situation', nav.situationId);
  }
  if (nav.mode === 'play' && nav.arrange) query.set('arrange', '1');
  if (nav.embed) query.set('embed', nav.embed);
  return `?${query}`;
}
