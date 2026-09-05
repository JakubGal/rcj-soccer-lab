"""Index official document headings, never mirror the copyrighted rule text.

The reader embeds each full original document. This checked-in manifest is its
navigation/coverage inventory; rerun deliberately when reviewing a new revision.
"""
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
import json
import re
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://robocup-junior.github.io/soccer-rules/master/'
SOURCES = [
    ('soccer', 'Soccer rules', BASE + 'rules.html'),
    ('field', 'Field specification', BASE + 'field_specification.html'),
    ('ball', 'Ball specification', BASE + 'ball_specification.html'),
    ('scoring', 'Awards & interviews', BASE + 'scoring.html'),
    ('superteam', 'SuperTeam rules', BASE + 'superteam_rules.html'),
    ('entry', 'Entry league', 'https://robocup-junior.github.io/soccer-rules-entry/master/rules.html'),
]


class Indexer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.headings = []
        self.heading = None
        self.revision = ''
        self.paragraphs = 0
        self.footnotes = 0
        self.in_content = False
        self.ids = set()
        self.duplicates = set()

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        anchor = attrs.get('id', '')
        if anchor in self.ids:
            self.duplicates.add(anchor)
        if anchor:
            self.ids.add(anchor)
        if tag == 'meta' and attrs.get('name') == 'author':
            self.revision = attrs.get('content', '')
        if anchor == 'content':
            self.in_content = True
        if anchor == 'footer':
            self.in_content = False
        if anchor.startswith('_footnotedef_'):
            self.footnotes += 1
        if self.in_content and tag == 'p':
            self.paragraphs += 1
        if self.in_content and re.fullmatch(r'h[2-6]', tag) and anchor:
            self.heading = {'anchor': anchor, 'depth': int(tag[1]) - 2, 'title': ''}

    def handle_data(self, text):
        if self.heading is not None:
            self.heading['title'] += text

    def handle_endtag(self, tag):
        if self.heading is not None and re.fullmatch(r'h[2-6]', tag):
            self.heading['title'] = re.sub(r'\s+', ' ', self.heading['title']).strip()
            self.headings.append(self.heading)
            self.heading = None


documents = []
sections = []
for document_id, label, url in SOURCES:
    response = urlopen(url, timeout=30)
    raw = response.read()
    html = raw.decode('utf-8')
    parser = Indexer()
    parser.feed(html)
    if not parser.headings:
        raise RuntimeError(f'No official headings found in {url}')
    document_sections = []
    chapter = 'Introduction'
    seen = {}
    for heading in parser.headings:
        original_anchor = heading['anchor']
        seen[original_anchor] = seen.get(original_anchor, 0) + 1
        anchor = original_anchor
        # Duplicate IDs in the committee scoring document resolve to the first
        # occurrence. Link later rubric entries to their verified parent.
        if document_id == 'scoring' and seen[anchor] > 1:
            anchor = 'score-criteria-and-rubrics'
        if heading['depth'] == 0:
            chapter = heading['title']
        number = re.match(r'^(\d+(?:\.\d+)*\.)\s', heading['title'])
        number = number.group(1).rstrip('.') if number else ''
        title = re.sub(r'^\d+(?:\.\d+)*\.\s+', '', heading['title'])
        item = {
            'id': f'{document_id}:{original_anchor}' + (f'-{seen[original_anchor]}' if seen[original_anchor] > 1 else ''),
            'document': document_id, 'anchor': anchor, 'title': title,
            'number': number, 'depth': heading['depth'], 'chapter': chapter,
        }
        sections.append(item)
        document_sections.append(item)
    if parser.footnotes:
        sections.append({'id': f'{document_id}:footnotes', 'document': document_id, 'anchor': 'footnotes', 'title': 'Footnotes & references', 'number': '', 'depth': 0, 'chapter': 'Footnotes & references'})
    documents.append({
        'id': document_id, 'title': label, 'url': url, 'revision': parser.revision,
        'headingCount': len(document_sections), 'paragraphCount': parser.paragraphs,
        'footnoteCount': parser.footnotes, 'sha256': sha256(raw).hexdigest(),
        'duplicateAnchors': sorted(parser.duplicates),
    })
    print(f'{label}: {len(document_sections)} sections, {parser.paragraphs} paragraphs, {parser.footnotes} footnotes')

output = ROOT / 'lib' / 'rulebook' / 'official-index.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'checkedOn': datetime.now(timezone.utc).date().isoformat(), 'documents': documents, 'sections': sections}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
