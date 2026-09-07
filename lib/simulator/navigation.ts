export type AppMode = 'rules' | 'play' | 'referee' | 'academy';
export type AcademyPage = 'profile' | 'certification' | 'referees';
export type CertificationTrack = 'rules' | 'step' | 'continuous' | null;
export type AppNavigation = {
  mode: AppMode;
  sectionId: string;
  situationId: string | null;
  arrange: boolean;
  embed: string | null;
  academyPage: AcademyPage;
  certificationTrack: CertificationTrack;
};
export const INITIAL_NAVIGATION: AppNavigation = {
  mode: 'rules',
  sectionId: 'soccer:inside-penalty-area',
  situationId: null,
  arrange: false,
  embed: null,
  academyPage: 'profile',
  certificationTrack: null,
};
export function readNavigation(search: string): AppNavigation {
  const query = new URLSearchParams(search);
  const mode = query.get('mode');
  const academy = query.get('academy');
  const certification = query.get('cert');
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
            : mode === 'academy'
              ? 'academy'
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
    academyPage:
      academy === 'certification' || academy === 'referees'
        ? academy
        : 'profile',
    certificationTrack:
      certification === 'rules' ||
      certification === 'step' ||
      certification === 'continuous'
        ? certification
        : null,
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
  if (nav.mode === 'academy') query.set('academy', nav.academyPage);
  if (nav.certificationTrack) query.set('cert', nav.certificationTrack);
  if (nav.embed) query.set('embed', nav.embed);
  return `?${query}`;
}

export type NavigationHost = {
  location: { search: string };
  addEventListener(type: 'popstate', listener: () => void): void;
  removeEventListener(type: 'popstate', listener: () => void): void;
};
/**
 * Applies the navigation encoded in the host URL right away and again after
 * every history traversal. The first application is deliberately synchronous:
 * a deep link such as `?mode=referee` must not wait for an animation frame,
 * which never arrives while the document is hidden, the display is asleep or
 * the screen is locked. Returns the unsubscribe function.
 */
export function watchNavigation(
  host: NavigationHost,
  onChange: (nav: AppNavigation, robot: string | null) => void,
) {
  const restore = () => {
    const search = host.location.search;
    onChange(readNavigation(search), new URLSearchParams(search).get('robot'));
  };
  restore();
  host.addEventListener('popstate', restore);
  return () => host.removeEventListener('popstate', restore);
}
