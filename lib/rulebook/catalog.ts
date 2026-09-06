import index from './official-index.json';

export const RULE_DOCUMENTS = index.documents;
export const RULE_SECTIONS = index.sections;
export const RULEBOOK_CHECKED_ON = index.checkedOn;
export type RuleSection = (typeof RULE_SECTIONS)[number];
export type GuideKind =
  | 'animation'
  | 'inspection'
  | 'kicker'
  | 'field'
  | 'ball'
  | 'scoring'
  | 'team'
  | 'documentation'
  | 'competition'
  | 'conduct'
  | 'decision'
  | 'companion'
  | 'overview';

export function guideFor(section: RuleSection): GuideKind {
  if (section.document === 'field') return 'field';
  if (section.document === 'ball') return 'ball';
  if (section.document === 'scoring') return 'scoring';
  if (section.document === 'entry' || section.document === 'superteam')
    return 'companion';
  if (
    section.anchor === 'kicker-power-measuring' ||
    section.anchor === 'regulations-limitations'
  )
    return 'kicker';
  if (section.number === '2' || section.number.startsWith('2.'))
    return 'animation';
  if (section.number === '3.7') return 'field';
  if (section.number === '3.8' || section.number === '3.9') return 'ball';
  if (
    section.number.startsWith('3') ||
    section.number.startsWith('6') ||
    section.number.startsWith('1.3') ||
    section.number === '7.1'
  )
    return 'inspection';
  if (section.number.startsWith('1.4')) return 'documentation';
  if (section.number.startsWith('1.5') || section.number.startsWith('4'))
    return 'conduct';
  if (section.number.startsWith('1')) return 'team';
  if (section.number.startsWith('5')) return 'decision';
  if (section.number.startsWith('7')) return 'competition';
  return 'overview';
}

export function sectionUrl(section: RuleSection) {
  const document = RULE_DOCUMENTS.find((item) => item.id === section.document)!;
  return `${document.url}#${section.anchor}`;
}

/** Appendices have titles but no numeric section number in the official index. */
export function sectionReference(section: RuleSection) {
  if (section.number)
    return /^\d/.test(section.number) ? `§${section.number}` : section.number;
  if (section.title.startsWith('Appendix A:')) return 'Appendix A';
  if (section.title.startsWith('Appendix B:')) return 'Appendix B';
  return section.title;
}

export function findSections(
  query: string,
  document: string,
  localize: (value: string) => string = (value) => value,
) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return RULE_SECTIONS.filter((section) => {
    if (!terms.length) return section.document === document;
    const aliases =
      guideFor(section) === 'inspection'
        ? 'technical inspection robot size weight measurements'
        : guideFor(section) === 'kicker'
          ? 'kicking power test rebound'
          : '';
    const source = `${section.number} ${section.title} ${section.chapter} ${section.document} ${aliases}`;
    const searchable =
      `${source} ${localize(section.title)} ${localize(section.chapter)} ${localize(aliases)}`.toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}
