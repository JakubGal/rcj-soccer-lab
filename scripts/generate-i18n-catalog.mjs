import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT = path.join(ROOT, 'lib', 'i18n', 'catalog.generated.json');
const CACHE = path.join(ROOT, 'scripts', '.i18n-cache.json');
const SOURCE_ROOTS = ['app', 'components', 'lib'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'i18n', 'api', 'server']);
const TARGETS = ['sk', 'de', 'ja'];
const CACHE_REVISION = 3;

// These names and rule-defined calls intentionally remain in the official
// English wording. Longer entries must win before their shorter substrings.
const PROTECTED_TERMS = [
  'RoboCupJunior Soccer League Committee',
  'RoboCupJunior Soccer',
  'RoboCup Federation',
  'RoboCupJunior',
  'SuperTeam Challenges',
  'SuperTeam Challenge',
  'Soccer Lightweight',
  'Soccer Infrared',
  'Soccer Vision',
  'Soccer Open',
  'Yellow 2',
  'Yellow 1',
  'Blue 2',
  'Blue 1',
  'Repeated multiple defense',
  'Neutral kick-offs',
  'Neutral kick-off',
  'Neutral kickoffs',
  'Neutral kickoff',
  'Multiple defense',
  'Lack of progress',
  'Out of bounds',
  'Out-of-bounds',
  'Pushed out',
  'Pushed-out',
  'Ball sent out',
  'Early start',
  'Play on',
  'No goal',
  'Damaged robots',
  'Damaged robot',
  'Ball holding',
  'Ball-holding',
  'Holding a ball',
  'Holding the ball',
  'Kick-offs',
  'Kick-off',
  'Kickoffs',
  'Kickoff',
  'Dribblers',
  'Dribbler',
  'Pushing',
  'Holding',
  'Damage',
  'Damaged',
  'RoboCup',
  'SuperTeam',
  'Entry League',
  'RCJ',
  'EIRP',
  'RMS',
  'TDP',
  'CAD',
  'rad/s',
  'm/s',
  'GHz',
  'Hz',
  'mW',
  'mm',
  'cm',
  'kg',
  'IR',
  'AC',
  'DC',
  'V',
  'g',
].sort((a, b) => b.length - a.length);

const CACHE_INVALIDATION_TERMS = [
  'Yellow 2',
  'Yellow 1',
  'Blue 2',
  'Blue 1',
  'Ball sent out',
  'Early start',
  'Play on',
  'No goal',
  'rad/s',
  'm/s',
  'GHz',
  'Hz',
  'mW',
  'mm',
  'cm',
  'kg',
  'IR',
  'AC',
  'DC',
  'V',
  'g',
];

const PRESERVED_SENTENCES = new Set([
  'at least partially in a penalty area',
  'The line is part of the area.',
  'Blue 1',
  'Blue 2',
  'Yellow 1',
  'Yellow 2',
  ...CACHE_INVALIDATION_TERMS,
]);

const MANUAL = {
  sk: {
    Rules: 'Pravidlá',
    Play: 'Hra',
    Referee: 'Rozhodca',
    Academy: 'Akadémia',
    'Learn the rules. Play. Referee. Certify.':
      'Spoznávajte pravidlá. Hrajte. Rozhodujte. Certifikujte sa.',
    'Training and certification': 'Tréning a certifikácia',
    Profile: 'Profil',
    Certification: 'Certifikácia',
    'Certified referees': 'Certifikovaní rozhodcovia',
    'Sign in': 'Prihlásiť sa',
    'Sign out': 'Odhlásiť sa',
    'Create local profile': 'Vytvoriť lokálny profil',
    'Local profile': 'Lokálny profil',
    'Use guest mode': 'Používať režim hosťa',
    'An optional profile, on this device': 'Voliteľný profil v tomto zariadení',
    'Training certified': 'Tréning úspešne certifikovaný',
    'Ready for verification': 'Pripravené na overenie',
    'GitHub identity': 'Identita na GitHube',
    'GitHub identity verified': 'Identita na GitHube je overená',
    'Training certification verified': 'Tréningová certifikácia je overená',
    'Submit for verification': 'Odoslať na overenie',
    'Your submission will be public': 'Vaše podanie bude verejné',
    'Connect through GitHub': 'Prepojiť cez GitHub',
    'Prepare certification submission': 'Pripraviť podanie na certifikáciu',
    'Preparing submission…': 'Pripravuje sa podanie…',
    'Copy submission': 'Kopírovať podanie',
    'Submission copied': 'Podanie bolo skopírované',
    'Open GitHub issue': 'Otvoriť issue na GitHube',
    'Check verification result': 'Skontrolovať výsledok overenia',
    'Checking…': 'Kontroluje sa…',
    'View verification issue on GitHub': 'Zobraziť overovacie issue na GitHube',
    'Submission not accepted': 'Podanie nebolo prijaté',
    'Your progress stays on this device':
      'Váš postup zostáva v tomto zariadení',
    'Export progress backup': 'Exportovať zálohu postupu',
    'Import progress backup': 'Importovať zálohu postupu',
    'Importing backup…': 'Importuje sa záloha…',
    'Progress backup imported': 'Záloha postupu bola importovaná',
    'Local profile created': 'Vytvorenie lokálneho profilu',
    'Update public GitHub profile': 'Aktualizovať verejný profil na GitHube',
    'Prepare profile update': 'Pripraviť aktualizáciu profilu',
    '2026 referee training certification':
      'Tréningová certifikácia rozhodcov 2026',
    'GitHub issues are public. Your GitHub username, chosen display name and optional country will be visible. Certification submissions also include your answers and game action logs. Do not include an email address, password or other private information.':
      'Issue na GitHube sú verejné. Vaše používateľské meno na GitHube, zvolené zobrazované meno a voliteľne aj krajina budú viditeľné. Certifikačné podania obsahujú aj vaše odpovede a záznamy úkonov v zápasoch. Neuvádzajte e-mailovú adresu, heslo ani iné súkromné údaje.',
    'Progress is saved in this browser, not synced to an account online. Download a backup to move it to another device or protect it before clearing browser data. A backup may contain your private profile and training history; keep it somewhere safe.':
      'Postup sa ukladá v tomto prehliadači a nesynchronizuje sa s online účtom. Stiahnite si zálohu, ak ho chcete preniesť do iného zariadenia alebo uchovať pred vymazaním údajov prehliadača. Záloha môže obsahovať váš súkromný profil a históriu tréningu; uložte ju na bezpečnom mieste.',
    'Importing a backup replaces this browser’s current local profile and progress. Export your current progress first. Imported scores cannot issue a verified certificate.':
      'Import zálohy nahradí aktuálny lokálny profil a postup v tomto prehliadači. Najprv exportujte svoj aktuálny postup. Importované skóre samo osebe neumožňuje vydať overený certifikát.',
    'This verifies completion of the training programme. It is not an official competition appointment.':
      'Toto overuje absolvovanie tréningového programu. Nejde o oficiálne vymenovanie za rozhodcu súťaže.',
    'Awaiting a signed verification result. Preparing or opening an issue does not submit it for you.':
      'Čaká sa na podpísaný výsledok overenia. Samotná príprava alebo otvorenie issue ho za vás neodošle.',
    'Rules examination': 'Skúška z pravidiel',
    'Step mode': 'Krokový režim',
    'Continuous mode': 'Plynulý režim',
    'Restart certification': 'Reštartovať certifikáciu',
    'Start certification round': 'Začať certifikačné kolo',
    'Public display name': 'Verejné zobrazované meno',
    'Country or region': 'Krajina alebo región',
    'Referee number': 'Číslo rozhodcu',
    Certified: 'Certifikovaný',
    Restarted: 'Reštartované',
    'Load more': 'Načítať ďalšie',
    'Loading more…': 'Načítavajú sa ďalšie…',
    'In progress': 'Prebieha',
    Failed: 'Neúspešné',
    'CERTIFICATION RULES / FIRST ANSWER COUNTS':
      'CERTIFIKAČNÉ PRAVIDLÁ / PRVÁ ODPOVEĎ SA POČÍTA',
    'This certification round has failed':
      'Toto certifikačné kolo je neúspešné',
    'Restart required': 'Vyžaduje sa reštart',
    Language: 'Jazyk',
    English: 'Angličtina',
    Slovak: 'Slovenčina',
    German: 'Nemčina',
    Japanese: 'Japončina',
    'Official English source': 'Oficiálny anglický zdroj',
    Resume: 'Obnoviť hru',
    'Reset match': 'Resetovať zápas',
    'Open rule': 'Otvoriť pravidlo',
    'Open rule & situations': 'Otvoriť pravidlo a situácie',
    'Open original': 'Otvoriť originál',
    'Play again': 'Hrať znova',
    'Resolve for me': 'Vyriešiť za mňa',
    'Referee match results': 'Výsledky rozhodcu v zápase',
    'Arrange field': 'Rozmiestniť objekty na ihrisku',
    'Finish arranging': 'Dokončiť rozmiestnenie',
    Overhead: 'Pohľad zhora',
    Broadcast: 'Televízny pohľad',
    'Follow ball': 'Sledovať loptu',
    'Free orbit': 'Voľná kamera',
    'Ball trail': 'Dráha lopty',
    'Kicker test': 'Test kopacieho mechanizmu',
    Run: 'Spustiť',
    'Copy embed': 'Kopírovať kód na vloženie',
    'Embed copied': 'Kód na vloženie bol skopírovaný',
    remove: 'odstrániť',
    'Award goal': 'Uznať gól',
    'Disallow goal': 'Neuznať gól',
    'Multiple defense · relocate': 'Multiple defense · premiestniť',
    'Full entry is out of bounds. Remove the robot for one minute or until an earlier kickoff.':
      'Úplný vstup robota znamená out of bounds. Odstráňte robota na jednu minútu alebo do skoršieho kick-off.',
  },
  de: {
    Rules: 'Regeln',
    Play: 'Spielen',
    Referee: 'Schiedsrichter',
    Academy: 'Akademie',
    'Learn the rules. Play. Referee. Certify.':
      'Regeln lernen. Spielen. Entscheiden. Zertifizieren.',
    'Training and certification': 'Training und Zertifizierung',
    Profile: 'Profil',
    Certification: 'Zertifizierung',
    'Certified referees': 'Zertifizierte Schiedsrichter',
    'Sign in': 'Anmelden',
    'Sign out': 'Abmelden',
    'Create local profile': 'Lokales Profil erstellen',
    'Local profile': 'Lokales Profil',
    'Use guest mode': 'Gastmodus verwenden',
    'An optional profile, on this device':
      'Ein optionales Profil auf diesem Gerät',
    'Training certified': 'Training zertifiziert',
    'Ready for verification': 'Bereit zur Überprüfung',
    'GitHub identity': 'GitHub-Identität',
    'GitHub identity verified': 'GitHub-Identität bestätigt',
    'Training certification verified': 'Trainingszertifizierung bestätigt',
    'Submit for verification': 'Zur Überprüfung einreichen',
    'Your submission will be public': 'Ihre Einreichung wird öffentlich',
    'Connect through GitHub': 'Über GitHub verknüpfen',
    'Prepare certification submission':
      'Zertifizierungseinreichung vorbereiten',
    'Preparing submission…': 'Einreichung wird vorbereitet…',
    'Copy submission': 'Einreichung kopieren',
    'Submission copied': 'Einreichung kopiert',
    'Open GitHub issue': 'GitHub-Issue öffnen',
    'Check verification result': 'Prüfergebnis abrufen',
    'Checking…': 'Wird geprüft…',
    'View verification issue on GitHub': 'Prüfungs-Issue auf GitHub ansehen',
    'Submission not accepted': 'Einreichung nicht akzeptiert',
    'Your progress stays on this device':
      'Ihr Fortschritt bleibt auf diesem Gerät',
    'Export progress backup': 'Fortschrittssicherung exportieren',
    'Import progress backup': 'Fortschrittssicherung importieren',
    'Importing backup…': 'Sicherung wird importiert…',
    'Progress backup imported': 'Fortschrittssicherung importiert',
    'Local profile created': 'Lokales Profil erstellt',
    'Update public GitHub profile': 'Öffentliches GitHub-Profil aktualisieren',
    'Prepare profile update': 'Profilaktualisierung vorbereiten',
    '2026 referee training certification':
      'Schiedsrichter-Trainingszertifizierung 2026',
    'GitHub issues are public. Your GitHub username, chosen display name and optional country will be visible. Certification submissions also include your answers and game action logs. Do not include an email address, password or other private information.':
      'GitHub-Issues sind öffentlich. Ihr GitHub-Benutzername, Ihr gewählter Anzeigename und optional Ihr Land werden sichtbar sein. Zertifizierungseinreichungen enthalten auch Ihre Antworten und Aktionsprotokolle aus den Spielen. Geben Sie keine E-Mail-Adresse, kein Passwort und keine anderen privaten Informationen an.',
    'Progress is saved in this browser, not synced to an account online. Download a backup to move it to another device or protect it before clearing browser data. A backup may contain your private profile and training history; keep it somewhere safe.':
      'Ihr Fortschritt wird in diesem Browser gespeichert und nicht mit einem Online-Konto synchronisiert. Laden Sie eine Sicherung herunter, um ihn auf ein anderes Gerät zu übertragen oder vor dem Löschen von Browserdaten zu schützen. Eine Sicherung kann Ihr privates Profil und Ihren Trainingsverlauf enthalten; bewahren Sie sie sicher auf.',
    'Importing a backup replaces this browser’s current local profile and progress. Export your current progress first. Imported scores cannot issue a verified certificate.':
      'Der Import einer Sicherung ersetzt das aktuelle lokale Profil und den Fortschritt in diesem Browser. Exportieren Sie zuerst Ihren aktuellen Fortschritt. Importierte Punktzahlen allein können kein verifiziertes Zertifikat erzeugen.',
    'This verifies completion of the training programme. It is not an official competition appointment.':
      'Dies bestätigt den Abschluss des Trainingsprogramms. Es ist keine offizielle Ernennung für einen Wettbewerb.',
    'Awaiting a signed verification result. Preparing or opening an issue does not submit it for you.':
      'Ein signiertes Prüfergebnis wird erwartet. Das Vorbereiten oder Öffnen eines Issues reicht es noch nicht für Sie ein.',
    'Rules examination': 'Regelprüfung',
    'Step mode': 'Schrittmodus',
    'Continuous mode': 'Fortlaufender Modus',
    'Restart certification': 'Zertifizierung neu starten',
    'Start certification round': 'Zertifizierungsrunde starten',
    'Public display name': 'Öffentlicher Anzeigename',
    'Country or region': 'Land oder Region',
    'Referee number': 'Schiedsrichternummer',
    Certified: 'Zertifiziert',
    Restarted: 'Neu gestartet',
    'Load more': 'Mehr laden',
    'Loading more…': 'Weitere werden geladen…',
    'In progress': 'In Bearbeitung',
    Failed: 'Nicht bestanden',
    'CERTIFICATION RULES / FIRST ANSWER COUNTS':
      'ZERTIFIZIERUNGSREGELN / DIE ERSTE ANTWORT ZÄHLT',
    'This certification round has failed':
      'Diese Zertifizierungsrunde wurde nicht bestanden',
    'Restart required': 'Neustart erforderlich',
    Language: 'Sprache',
    English: 'Englisch',
    Slovak: 'Slowakisch',
    German: 'Deutsch',
    Japanese: 'Japanisch',
    'Official English source': 'Offizielle englische Quelle',
    Resume: 'Fortsetzen',
    'Reset match': 'Spiel zurücksetzen',
    'Open rule': 'Regel öffnen',
    'Open rule & situations': 'Regel und Situationen öffnen',
    'Open original': 'Original öffnen',
    'Play again': 'Erneut spielen',
    'Resolve for me': 'Automatisch lösen',
    'Referee match results': 'Ergebnisse der Schiedsrichterübung',
    'Arrange field': 'Spielfeld anordnen',
    'Finish arranging': 'Anordnung beenden',
    Overhead: 'Draufsicht',
    Broadcast: 'Übertragungsansicht',
    'Follow ball': 'Ball verfolgen',
    'Free orbit': 'Freie Kamera',
    'Match length': 'Spieldauer',
    'Signal kickoff': 'kickoff signalisieren',
    Run: 'Starten',
    Whistle: 'Pfeifen',
    'Copy embed': 'Einbettungscode kopieren',
    'Embed copied': 'Einbettungscode kopiert',
    'Full match review': 'Vollständige Spielauswertung',
    remove: 'entfernen',
    Ball: 'Ball',
    different: 'anderen',
    furthest: 'entferntesten',
    nearest: 'nächstgelegenen',
    'Award goal': 'Tor geben',
    'Disallow goal': 'Tor aberkennen',
    'Multiple defense · relocate': 'Multiple defense · neu positionieren',
    'Ball moved to the {0} available{1} neutral spot.':
      'Der Ball wurde zum{1} {0} verfügbaren neutralen Punkt verschoben.',
    'Full entry is out of bounds. Remove the robot for one minute or until an earlier kickoff.':
      'Das vollständige Einfahren gilt als out of bounds. Entfernen Sie den Roboter für eine Minute oder bis zu einem früheren kick-off.',
  },
  ja: {
    Rules: 'ルール',
    Play: 'プレイ',
    Referee: '審判',
    Academy: 'アカデミー',
    'Learn the rules. Play. Referee. Certify.':
      'ルールを学び、プレイし、審判し、認定を取得しましょう。',
    'Training and certification': 'トレーニングと認定',
    Profile: 'プロフィール',
    Certification: '認定',
    'Certified referees': '認定審判員',
    'Sign in': 'ログイン',
    'Sign out': 'ログアウト',
    'Create local profile': 'ローカルプロフィールを作成',
    'Local profile': 'ローカルプロフィール',
    'Use guest mode': 'ゲストモードを使用',
    'An optional profile, on this device': 'この端末に任意のプロフィールを作成',
    'Training certified': 'トレーニング認定済み',
    'Ready for verification': '検証に提出できます',
    'GitHub identity': 'GitHubでの本人確認',
    'GitHub identity verified': 'GitHubでの本人確認済み',
    'Training certification verified': 'トレーニング認定の検証済み',
    'Submit for verification': '検証に提出',
    'Your submission will be public': '提出内容は公開されます',
    'Connect through GitHub': 'GitHubで連携',
    'Prepare certification submission': '認定の提出データを準備',
    'Preparing submission…': '提出データを準備中…',
    'Copy submission': '提出データをコピー',
    'Submission copied': '提出データをコピーしました',
    'Open GitHub issue': 'GitHubのIssueを開く',
    'Check verification result': '検証結果を確認',
    'Checking…': '確認中…',
    'View verification issue on GitHub': 'GitHubで検証のIssueを見る',
    'Submission not accepted': '提出は承認されませんでした',
    'Your progress stays on this device': '進捗はこの端末に保存されます',
    'Export progress backup': '進捗のバックアップを保存',
    'Import progress backup': '進捗のバックアップを読み込む',
    'Importing backup…': 'バックアップを読み込み中…',
    'Progress backup imported': '進捗のバックアップを読み込みました',
    'Local profile created': 'ローカルプロフィール作成日',
    'Update public GitHub profile': '公開GitHubプロフィールを更新',
    'Prepare profile update': 'プロフィールの更新データを準備',
    '2026 referee training certification': '2026年審判トレーニング認定',
    'GitHub issues are public. Your GitHub username, chosen display name and optional country will be visible. Certification submissions also include your answers and game action logs. Do not include an email address, password or other private information.':
      'GitHubのIssueは公開されます。GitHubのユーザー名、選択した表示名、任意で入力した国が表示されます。認定の提出内容には回答や試合中の操作ログも含まれます。メールアドレス、パスワード、その他の個人情報は含めないでください。',
    'Progress is saved in this browser, not synced to an account online. Download a backup to move it to another device or protect it before clearing browser data. A backup may contain your private profile and training history; keep it somewhere safe.':
      '進捗はこのブラウザーに保存され、オンラインアカウントとは同期されません。別の端末への移行やブラウザーデータ削除に備えて、バックアップをダウンロードしてください。バックアップには非公開のプロフィールやトレーニング履歴が含まれる場合があるため、安全な場所に保管してください。',
    'Importing a backup replaces this browser’s current local profile and progress. Export your current progress first. Imported scores cannot issue a verified certificate.':
      'バックアップを読み込むと、このブラウザーの現在のローカルプロフィールと進捗が置き換わります。先に現在の進捗を保存してください。読み込んだスコアだけで検証済みの認定証が発行されることはありません。',
    'This verifies completion of the training programme. It is not an official competition appointment.':
      'これはトレーニングプログラムの修了を確認するものです。大会への正式な審判任命ではありません。',
    'Awaiting a signed verification result. Preparing or opening an issue does not submit it for you.':
      '署名付きの検証結果を待っています。Issueを準備したり開いたりしただけでは、提出は完了しません。',
    'Rules examination': 'ルール試験',
    'Step mode': 'ステップモード',
    'Continuous mode': '連続モード',
    'Restart certification': '認定を最初からやり直す',
    'Start certification round': '認定ラウンドを開始',
    'Public display name': '公開表示名',
    'Country or region': '国または地域',
    'Referee number': '審判員番号',
    Certified: '認定済み',
    Restarted: '再開始済み',
    'Load more': 'さらに読み込む',
    'Loading more…': 'さらに読み込み中…',
    'In progress': '進行中',
    Failed: '不合格',
    'CERTIFICATION RULES / FIRST ANSWER COUNTS':
      '認定ルール / 最初の回答が採点対象',
    'This certification round has failed': 'この認定ラウンドは不合格です',
    'Restart required': '最初からやり直す必要があります',
    Language: '言語',
    English: '英語',
    Slovak: 'スロバキア語',
    German: 'ドイツ語',
    Japanese: '日本語',
    'Official English source': '英語の公式原文',
    Resume: '再開',
    'Reset match': '試合をリセット',
    'Open rule': 'ルールを開く',
    'Open rule & situations': 'ルールと状況を開く',
    'Open original': '公式原文を開く',
    'Full-width official text': '公式原文を全幅表示',
    'Situation & checking questions': '状況と確認問題',
    'Play again': 'もう一度プレイ',
    'Resolve for me': '自動で解決',
    'Referee match results': '審判トレーニング結果',
    'Arrange field': 'フィールドを配置編集',
    'Finish arranging': '配置を完了',
    Overhead: '俯瞰',
    Broadcast: '中継視点',
    'Follow ball': 'ボールを追う',
    'Free orbit': '自由カメラ',
    'Match length': '試合時間',
    'Signal kickoff': 'kickoff を合図',
    Run: '開始',
    Whistle: '笛を吹く',
    'Copy embed': '埋め込みコードをコピー',
    'Embed copied': '埋め込みコードをコピーしました',
    'Full match review': '試合全体の振り返り',
    remove: '退場させる',
    'Award goal': 'ゴールを認定',
    'Disallow goal': 'ゴールを認めない',
    'Multiple defense · relocate': 'Multiple defense · 再配置',
    'Full entry is out of bounds. Remove the robot for one minute or until an earlier kickoff.':
      'ロボット全体が進入すると out of bounds です。ロボットを1分間、またはそれより前に kick-off が行われるまで退場させます。',
  },
};

const normalize = (value) => value.trim().replace(/\s+/g, ' ');
const hasLetters = (value) => /\p{L}/u.test(value);

function looksHuman(value) {
  const text = normalize(value);
  if (!text || text.length > 900 || !hasLetters(text)) return false;
  if (/^(?:https?:|data:|blob:|file:|\/|\.\/|\.\.\/|@\/)/i.test(text))
    return false;
  if (/^[.#[][-_a-z0-9='"\]\s:>+~*(),]+$/i.test(text)) return false;
  if (/\.(?:tsx?|jsx?|json|glb|gltf|png|jpe?g|svg|css|mjs|cjs)$/i.test(text))
    return false;
  if (/^[a-z0-9_.:/-]+$/.test(text) && /[-_/:.]/.test(text)) return false;
  if (
    /^(?:rgb|rgba|linear-gradient|radial-gradient|translate|rotate|scale)\(/i.test(
      text,
    )
  )
    return false;
  return true;
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(target)));
    else if (/\.tsx?$/.test(entry.name)) files.push(target);
  }
  return files;
}

const TRANSLATABLE_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-roledescription',
  'aria-valuetext',
  'caption',
  'description',
  'emptyMessage',
  'heading',
  'helpText',
  'label',
  'message',
  'placeholder',
  'title',
]);

function jsxAttributeAncestor(node) {
  let current = node.parent;
  while (
    current &&
    !ts.isJsxElement(current) &&
    !ts.isJsxSelfClosingElement(current)
  ) {
    if (ts.isJsxAttribute(current)) return current;
    current = current.parent;
  }
  return null;
}

function isDisplayLiteral(node) {
  const attribute = jsxAttributeAncestor(node);
  if (attribute) return TRANSLATABLE_ATTRIBUTES.has(attribute.name.getText());
  if (
    ts.isImportDeclaration(node.parent) ||
    ts.isExportDeclaration(node.parent) ||
    ts.isExternalModuleReference(node.parent)
  )
    return false;
  let current = node.parent;
  for (let depth = 0; current && depth < 20; depth += 1) {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      ['cn', 'cva', 'twMerge'].includes(current.expression.text)
    )
      return false;
    if (
      ts.isPropertyAssignment(current) &&
      ['class', 'className', 'selector'].includes(current.name.getText())
    )
      return false;
    current = current.parent;
  }
  return true;
}

function templatePattern(node) {
  if (!ts.isTemplateExpression(node)) return null;
  let value = node.head.text;
  node.templateSpans.forEach((span, index) => {
    value += `{${index}}${span.literal.text}`;
  });
  value = normalize(value);
  // Submission packets and other code-fenced machine-readable payloads are
  // deliberately displayed verbatim, not localized prose.
  if (value.includes('```')) return null;
  return value.includes('{0}') && looksHuman(value) ? value : null;
}

function swappedTeams(value) {
  return value
    .replace(/Blue/g, 'ZXQBLUETEAMQXZ')
    .replace(/Yellow/g, 'Blue')
    .replace(/ZXQBLUETEAMQXZ/g, 'Yellow');
}

async function extract() {
  const exact = new Set([
    'Language',
    'English',
    'Slovak',
    'German',
    'Japanese',
    'Official English source',
    'remove',
  ]);
  const patterns = new Set();
  for (const sourceRoot of SOURCE_ROOTS) {
    for (const file of await filesUnder(path.join(ROOT, sourceRoot))) {
      const source = await readFile(file, 'utf8');
      const tree = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node) => {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isJsxText(node)
        ) {
          const value = normalize(node.text);
          if (
            (ts.isJsxText(node) || isDisplayLiteral(node)) &&
            looksHuman(value)
          )
            exact.add(value);
        }
        const pattern = templatePattern(node);
        if (pattern && isDisplayLiteral(node)) patterns.add(pattern);
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
  }

  const officialIndex = JSON.parse(
    await readFile(
      path.join(ROOT, 'lib', 'rulebook', 'official-index.json'),
      'utf8',
    ),
  );
  for (const document of officialIndex.documents)
    if (looksHuman(document.title ?? '')) exact.add(normalize(document.title));
  for (const section of officialIndex.sections)
    for (const key of ['title', 'chapter'])
      if (looksHuman(section[key] ?? '')) exact.add(normalize(section[key]));

  const exactTeamVariants = [];
  for (const phrase of exact) exactTeamVariants.push(swappedTeams(phrase));
  for (const phrase of exactTeamVariants) exact.add(phrase);
  const patternTeamVariants = [];
  for (const pattern of patterns)
    patternTeamVariants.push(swappedTeams(pattern));
  for (const pattern of patternTeamVariants) patterns.add(pattern);

  return {
    exact: [...exact].sort((a, b) => a.localeCompare(b)),
    patterns: [...patterns].sort((a, b) => a.localeCompare(b)),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function protect(source) {
  const preserved = [];
  let text = source;
  for (const term of PROTECTED_TERMS) {
    const expression = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`,
      'giu',
    );
    text = text.replace(expression, (match) => {
      const token = `ZXQTERM${preserved.length}QXZ`;
      preserved.push(match);
      return token;
    });
  }
  text = text.replace(/\{\d+\}/g, (match) => {
    const token = `ZXQTERM${preserved.length}QXZ`;
    preserved.push(match);
    return token;
  });
  return { text, preserved };
}

function restore(translated, preserved) {
  let output = translated;
  preserved.forEach((value, index) => {
    output = output.replaceAll(`ZXQTERM${index}QXZ`, value);
    output = output.replaceAll(`ZXQ TERM ${index} QXZ`, value);
  });
  return output;
}

async function requestTranslation(text, target) {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'dict-chrome-ex');
  url.searchParams.set('sl', 'en');
  url.searchParams.set('tl', target);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);
  let error;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'RCJ-Soccer-Lab-localization-builder/1.0' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const translated = body[0].map((part) => part[0]).join('');
      return translated;
    } catch (caught) {
      error = caught;
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  throw new Error(
    `Could not translate a catalog batch to ${target}: ${String(error)}`,
  );
}

async function translateBatch(items, target) {
  const resolved = new Map();
  const pending = [];
  for (const item of items) {
    if (PRESERVED_SENTENCES.has(item)) resolved.set(item, item);
    else if (MANUAL[target]?.[item]) resolved.set(item, MANUAL[target][item]);
    else {
      const protectedItem = protect(item);
      if (!hasLetters(protectedItem.text.replace(/ZXQTERM\d+QXZ/g, '')))
        resolved.set(item, item);
      else pending.push({ source: item, ...protectedItem });
    }
  }
  if (!pending.length) return resolved;
  const payload = pending
    .map((item, index) => `ZXQITEM${index}QXZ\n${item.text}`)
    .join('\n');
  const translated = await requestTranslation(payload, target);
  const marker = /ZXQ\s*ITEM\s*(\d+)\s*QXZ\s*/giu;
  const found = [...translated.matchAll(marker)];
  if (found.length !== pending.length)
    throw new Error(
      `Translation service returned ${found.length}/${pending.length} item markers for ${target}`,
    );
  for (let index = 0; index < found.length; index += 1) {
    const itemIndex = Number(found[index][1]);
    const start = found[index].index + found[index][0].length;
    const end = found[index + 1]?.index ?? translated.length;
    const item = pending[itemIndex];
    resolved.set(
      item.source,
      restore(translated.slice(start, end).trim(), item.preserved),
    );
  }
  return resolved;
}

function makeBatches(jobs) {
  const batches = [];
  let batch = [];
  let characters = 0;
  for (const job of jobs) {
    if (
      batch.length &&
      (batch[0].locale !== job.locale ||
        batch.length >= 18 ||
        characters + job.phrase.length > 5200)
    ) {
      batches.push(batch);
      batch = [];
      characters = 0;
    }
    batch.push(job);
    characters += job.phrase.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function main() {
  const source = await extract();
  let cache = {};
  try {
    cache = JSON.parse(await readFile(CACHE, 'utf8'));
  } catch {
    // A cache is optional; the generated catalog is the runtime artifact.
  }
  if (cache._revision !== CACHE_REVISION) {
    for (const locale of TARGETS) {
      for (const phrase of Object.keys(cache[locale] ?? {})) {
        if (
          CACHE_INVALIDATION_TERMS.some((term) =>
            new RegExp(
              `(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`,
              'iu',
            ).test(phrase),
          )
        )
          delete cache[locale][phrase];
      }
    }
    cache._revision = CACHE_REVISION;
  }
  const jobs = [];
  for (const locale of TARGETS) {
    cache[locale] ??= {};
    for (const phrase of [...source.exact, ...source.patterns])
      if (!cache[locale][phrase]) jobs.push({ locale, phrase });
  }
  const batches = makeBatches(jobs);
  let cursor = 0;
  let completed = 0;
  const workers = Array.from({ length: 3 }, async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor++];
      const locale = batch[0].locale;
      const translated = await translateBatch(
        batch.map((job) => job.phrase),
        locale,
      );
      for (const job of batch)
        cache[locale][job.phrase] = translated.get(job.phrase);
      completed += batch.length;
      if (completed % 180 < batch.length || completed === jobs.length) {
        await writeFile(CACHE, `${JSON.stringify(cache, null, 2)}\n`);
        process.stdout.write(`Translated ${completed}/${jobs.length}\n`);
      }
    }
  });
  await Promise.all(workers);
  await writeFile(CACHE, `${JSON.stringify(cache, null, 2)}\n`);

  const output = { generatedAt: new Date().toISOString(), locales: {} };
  for (const locale of TARGETS) {
    output.locales[locale] = {
      exact: Object.fromEntries(
        source.exact.map((key) => [
          key,
          PRESERVED_SENTENCES.has(key)
            ? key
            : (MANUAL[locale]?.[key] ?? cache[locale][key]),
        ]),
      ),
      patterns: source.patterns.map((key) => ({
        source: key,
        translation: MANUAL[locale]?.[key] ?? cache[locale][key],
      })),
    };
  }
  for (const [locale, translations] of Object.entries(output.locales)) {
    for (const pattern of translations.patterns) {
      const sourcePlaceholders = [...pattern.source.matchAll(/\{(\d+)\}/g)]
        .map((match) => match[1])
        .sort((a, b) => a.localeCompare(b));
      const translatedPlaceholders = [
        ...pattern.translation.matchAll(/\{(\d+)\}/g),
      ]
        .map((match) => match[1])
        .sort((a, b) => a.localeCompare(b));
      if (sourcePlaceholders.join(',') !== translatedPlaceholders.join(','))
        throw new Error(
          `Translation placeholder mismatch for ${locale}: ${pattern.source}`,
        );
    }
  }
  await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(
    `Wrote ${source.exact.length} exact phrases and ${source.patterns.length} templates per locale to ${path.relative(ROOT, OUTPUT)}\n`,
  );
}

await main();
