// Reviewed reconstruction terminology: frame means an image, never a border or an actor/person.
const choose =
  'Choose a clear frame where the field and objects are visible, then use it as the reference. Detection searches the whole selected range, including footage before this frame.';
const identify =
  'Identify the objects on the reference frame. Select Use this frame as reference to choose a different clear frame.';
const original =
  'in the original reference frame. Choose the same visible point throughout. Identify only actors you can see.';
const reference =
  'Use this frame as the appearance reference? Existing identities and tracking will be cleared. Confirmed events remain.';
const detection =
  'Field-aware object detection searches every frame and re-detects missing objects automatically. You assign the team and robot number when identifying each reference object. Up to four robots and one ball are assigned without duplicating identities. Hidden or ambiguous objects remain gaps, not invented motion.';
const counts =
  'Frames processed: {0} · Detected now: {1}/5 · Re-detections: {2}';
const warning =
  'Visibility counts are not an accuracy score. Review identities and hidden objects against the recording.';
const finished =
  'Tracking finished. Review gaps and identity changes before trusting the reconstruction.';
const full =
  'Full range processed. Camera changes were marked for review; add separately calibrated clips for different views.';
const cut =
  'Large image change. Detection resumes when the calibrated view returns; use a separate calibration for a different view.';
const reconstructionTranslations = {
  sk: {
    'Play original': 'Prehrať originál',
    'Pause original': 'Pozastaviť originál',
    'The browser stopped presenting video frames. Try a remuxed MP4 copy.':
      'Prehliadač prestal zobrazovať nové snímky videa. Skúste kópiu MP4 s opraveným kontajnerom.',
    'The original recording could not play.':
      'Pôvodný záznam sa nepodarilo prehrať.',
    'This recording has damaged video timestamps. If playback freezes, open a remuxed MP4 copy; your original file is unchanged.':
      'Tento záznam má poškodené časové údaje videa. Ak prehrávanie zamŕza, otvorte kópiu MP4 s opraveným kontajnerom; pôvodný súbor zostáva nezmenený.',
    'Live tracking preview': 'Živý náhľad sledovania',
    'Stop and review': 'Zastaviť a skontrolovať',
    'Processing: {0} · {1} frames': 'Spracovanie: {0} · {1} snímok',
    [choose]:
      'Vyberte zreteľnú snímku, na ktorej vidno ihrisko aj objekty, a použite ju ako referenčnú. Detekcia prehľadá celý vybraný úsek vrátane záberov pred touto snímkou.',
    [identify]:
      'Označte objekty na referenčnej snímke. Inú zreteľnú snímku vyberiete tlačidlom Použiť túto snímku ako referenčnú.',
    [original]:
      'na pôvodnej referenčnej snímke. Vždy vyberajte rovnaký viditeľný bod objektu. Označujte iba roboty a loptičku, ktoré skutočne vidíte.',
    [reference]:
      'Použiť túto snímku ako referenciu vzhľadu? Existujúce označenia objektov a výsledky sledovania sa vymažú. Potvrdené udalosti zostanú.',
    [detection]:
      'Detekcia objektov využíva geometriu ihriska, prehľadáva každú snímku a automaticky znovu hľadá stratené objekty. Tím a číslo robota určíte pri označení referenčných objektov. Priraďuje najviac štyroch robotov a jednu loptičku bez duplicitných identít. Skryté alebo nejednoznačné objekty zostávajú medzerami, ich pohyb sa nevymýšľa.',
    [counts]:
      'Spracované snímky: {0} · Aktuálne detekované objekty: {1}/5 · Opätovné nájdenia: {2}',
    [warning]:
      'Počet viditeľných objektov nie je hodnotením presnosti. Overte identity a skryté objekty podľa záznamu.',
    [finished]:
      'Sledovanie je dokončené. Pred použitím rekonštrukcie skontrolujte medzery a prípadné zámeny identít.',
    [full]:
      'Celý vybraný úsek je spracovaný. Zmeny záberu sú označené na kontrolu; pre iné pohľady pridajte samostatne kalibrované klipy.',
    [cut]:
      'Výrazná zmena obrazu. Detekcia sa obnoví po návrate kalibrovaného pohľadu; iný pohľad potrebuje samostatnú kalibráciu.',
    'Use this frame as reference': 'Použiť túto snímku ako referenčnú',
    'Reference frame:': 'Referenčná snímka:',
    'Identify reference objects': 'Označiť referenčné objekty',
    'Use whole recording': 'Použiť celý záznam',
  },
  de: {
    'Play original': 'Original abspielen',
    'Pause original': 'Original pausieren',
    'The browser stopped presenting video frames. Try a remuxed MP4 copy.':
      'Der Browser zeigt keine neuen Videobilder mehr an. Versuche eine neu gemuxte MP4-Kopie.',
    'The original recording could not play.':
      'Die Originalaufnahme konnte nicht abgespielt werden.',
    'This recording has damaged video timestamps. If playback freezes, open a remuxed MP4 copy; your original file is unchanged.':
      'Diese Aufnahme enthält beschädigte Videozeitstempel. Falls die Wiedergabe einfriert, öffne eine neu gemuxte MP4-Kopie; die Originaldatei bleibt unverändert.',
    'Live tracking preview': 'Live-Vorschau der Erkennung',
    'Stop and review': 'Anhalten und prüfen',
    'Processing: {0} · {1} frames': 'Verarbeitung: {0} · {1} Bilder',
    [choose]:
      'Wähle ein deutliches Bild, auf dem das Spielfeld und die Objekte sichtbar sind, als Referenz. Die Erkennung untersucht den gesamten gewählten Abschnitt, auch die Aufnahmen vor diesem Bild.',
    [identify]:
      'Markiere die Objekte im Referenzbild. Mit Dieses Bild als Referenz verwenden kannst du ein anderes deutliches Bild wählen.',
    [original]:
      'im ursprünglichen Referenzbild. Wähle stets denselben sichtbaren Punkt des Objekts. Markiere nur Roboter und den Ball, die du tatsächlich siehst.',
    [reference]:
      'Dieses Bild als Aussehensreferenz verwenden? Vorhandene Objektzuordnungen und Tracking-Ergebnisse werden gelöscht. Bestätigte Ereignisse bleiben erhalten.',
    [detection]:
      'Die Objekterkennung berücksichtigt das Spielfeld, untersucht jedes Bild und sucht verlorene Objekte automatisch erneut. Team und Roboternummer legst du beim Markieren der Referenzobjekte fest. Höchstens vier Roboter und ein Ball werden ohne doppelte Identitäten zugeordnet. Verdeckte oder mehrdeutige Objekte bleiben als Lücken bestehen; ihre Bewegung wird nicht erfunden.',
    [counts]:
      'Verarbeitete Bilder: {0} · Aktuell erkannte Objekte: {1}/5 · Wiedererkennungen: {2}',
    [warning]:
      'Die Zahl sichtbarer Objekte ist kein Genauigkeitswert. Prüfe Identitäten und verdeckte Objekte anhand der Aufnahme.',
    [finished]:
      'Tracking abgeschlossen. Prüfe Lücken und mögliche Identitätsverwechslungen, bevor du die Rekonstruktion verwendest.',
    [full]:
      'Der gesamte Abschnitt wurde verarbeitet. Kamerawechsel wurden zur Prüfung markiert; füge für andere Ansichten separat kalibrierte Clips hinzu.',
    [cut]:
      'Starke Bildänderung. Die Erkennung wird fortgesetzt, sobald die kalibrierte Ansicht zurückkehrt; eine andere Ansicht benötigt eine eigene Kalibrierung.',
    'Use this frame as reference': 'Dieses Bild als Referenz verwenden',
    'Reference frame:': 'Referenzbild:',
    'Identify reference objects': 'Referenzobjekte markieren',
    'Use whole recording': 'Gesamte Aufnahme verwenden',
  },
  ja: {
    'Play original': '元の映像を再生',
    'Pause original': '元の映像を一時停止',
    'The browser stopped presenting video frames. Try a remuxed MP4 copy.':
      'ブラウザーが新しい動画フレームを表示しなくなりました。再多重化したMP4のコピーを試してください。',
    'The original recording could not play.':
      '元の録画を再生できませんでした。',
    'This recording has damaged video timestamps. If playback freezes, open a remuxed MP4 copy; your original file is unchanged.':
      'この録画には破損した動画タイムスタンプがあります。再生が止まる場合は、再多重化したMP4のコピーを開いてください。元のファイルは変更されていません。',
    'Live tracking preview': '追跡のライブプレビュー',
    'Stop and review': '停止して確認',
    'Processing: {0} · {1} frames': '処理中: {0} · {1}フレーム',
    [choose]:
      'フィールドと各物体がはっきり見えるフレームを選び、参照フレームに設定してください。このフレームより前の映像も含め、選択範囲全体を検出します。',
    [identify]:
      '参照フレーム上の物体を指定してください。別の見やすいフレームに変更するには「このフレームを参照にする」を選択します。',
    [original]:
      'を元の参照フレームで指定します。常に物体上の同じ見える位置を選び、実際に見えているロボットとボールだけを指定してください。',
    [reference]:
      'このフレームを外観の参照にしますか？既存の物体の指定と追跡結果は消去されます。確認済みのイベントは保持されます。',
    [detection]:
      'フィールドの形状を考慮して各フレームで物体を検出し、見失った物体も自動的に再検索します。チームとロボット番号は参照物体を指定する際に設定します。同じ物体を重複して割り当てず、最大4台のロボットと1個のボールを識別します。隠れている物体や曖昧な物体は欠測のままにし、動きを作り出すことはありません。',
    [counts]: '処理済みフレーム: {0} · 現在の検出数: {1}/5 · 再検出数: {2}',
    [warning]:
      '見えている物体の数は精度を示すものではありません。識別結果や隠れている物体を元の映像と照合してください。',
    [finished]:
      '追跡が完了しました。再構成結果を使用する前に、欠測や物体の識別の入れ替わりを確認してください。',
    [full]:
      '選択範囲全体の処理が完了しました。カメラの切り替わりを確認用に記録しました。別の視点には個別にキャリブレーションしたクリップを追加してください。',
    [cut]:
      '映像が大きく変化しました。キャリブレーション済みの視点に戻ると検出を再開します。別の視点には個別のキャリブレーションが必要です。',
    'Use this frame as reference': 'このフレームを参照にする',
    'Reference frame:': '参照フレーム:',
    'Identify reference objects': '参照物体を指定',
    'Use whole recording': '録画全体を使用',
  },
};
export default reconstructionTranslations;
