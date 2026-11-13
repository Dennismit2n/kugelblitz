/*
 * Kugelblitz: Grafik
 *
 * Zeichnet den ganzen Tisch auf ein Canvas: Platte mit Beschlag, Spruchband, Spielfeld, Lichter,
 * bewegte Teile, Start-, Pause- und Endtafel. Liest nur Zustand: die Physik-Objekte (tisch), den
 * Spielstand des Regelwerks (z, z.lichter) und die Ereignisse der Physik. Schreibt nie in Physik
 * oder Regeln (Schichtung Physik → Regeln → Grafik wie in FreeWPC, Bauplan §2).
 *
 * Aufbau:
 *   1. Gebackene Ebene, einmal je Größe und Pixeldichte: Platte, Rauschen gegen Stufen, Raster,
 *      Bauplan-Linien, unbeleuchtete Inserts, Schienen, Schleudern, Bumper, Zündkammer, Beschlag,
 *      Fenster des Spruchbands.
 *   2. Sprites, vorgerendert in Größe × devicePixelRatio: Kugel, Kugelschatten, Spur, Flipper,
 *      Schrauben, Linse und Schein je Insert, Treffer-Scheine, Fallziel, Tafeln.
 *   3. Bild-Takt: gebackene Ebene, Fallziele, Lichter, Scheine, Gummis, Ladung, Flipper, Kugeln,
 *      Spruchband, Tafel. Kein shadowBlur, kein filter und keine neuen Verläufe im Bild-Takt.
 *
 * Lichtsicherheit (Bauplan §1): Jede Lampe blendet weich (tau 80 bis 250 ms), hält einen neuen
 * Zustand mindestens 0,5 s, und über den ganzen Tisch gibt es höchstens drei Licht-Ereignisse je
 * Sekunde. Treffer-Scheine sind örtlich und schwach. Die Lichtstärke ist ein Faktor auf alle Lichter.
 *
 * Läuft als klassisches Skript (window.Grafik) mit demselben Modulmuster wie physik.js und regeln.js,
 * damit index.html auch per Doppelklick (file://) startet; ES-Module sperrt der Browser dort.
 *
 * Darstellungen (Abschnitt 7, Sehhilfen der Werkstatt): PALETTEN unten. Normal, Farbenblind (Okabe-Ito, Umriss um volle
 * Lampen, Zeichen an der Zündkammer-Leiter) und Umkehr (die Seite dreht den Tisch mit, Scheine schwächer) zeichnen im
 * Werkstatt-Stil; Hoher Kontrast dunkel und hell zeichnet flach (backenFlach, Sprites …Flach): deckend, volle Linien, keine
 * Verläufe, kein Rauschen, kein Glow, kein „lighter“. setzeModus() backt beim Wechsel alles neu, ohne Zustände zu verlieren.
 *
 * Sprachen (Abschnitt 6): Alle Texte im Canvas (Tafeln, Spruchband, Beschriftungen auf dem Tisch) kommen über
 * setzeSprache() aus sprachen.js, mit Schriftkette und Leserichtung der Sprache. Was nicht passt, wird erst kleiner
 * und dann zweizeilig, nie abgeschnitten. Der Spielname „Kugelblitz“, die Gassen L, A, D und Ziffern auf den Inserts
 * bleiben in Fraunces.
 */
(function (wurzel, fabrik) {
  if (typeof module === "object" && module.exports) module.exports = fabrik();
  else wurzel.Grafik = fabrik();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const BREITE = 1.1;
  const HOEHE = 1.7;
  const TAU = Math.PI * 2;

  // Farben der Startseite (dennismit2n.github.io/css/style.css, dunkle Darstellung), als Konstanten übernommen.
  const FARBE = Object.freeze({
    grund: "#0F0F21",
    flaeche: "#181831",
    linie: "#2D2C4F",
    text: "#E2E2F6",
    leise: "#B7B9DC",
    akzent: "#B4B5FF",       // primary-200
    violett: "#A5A5FF",      // primary-300
    lavendel: "#AFA1FF",     // violet-300
    eis: "#75C7FF",          // sky-200, Blitz-Eisblau
    weissgold: "#F1E4BC",    // Mitte der Schraube
    aurora: ["#4B3CAB", "#502684", "#015BA6", "#781B7E"],
  });

  // Darstellungen (Abschnitt 7, Sehhilfen der Werkstatt). „normal“, „farbenblind“ und „umkehr“ zeichnen im vollen
  // Werkstatt-Stil (Verläufe, Rauschen, Schein), „hc-dunkel“ und „hc-hell“ flach: deckende Flächen, volle Linien, keine
  // Verläufe, kein Rauschen, kein Glow, kein „lighter“. Die Werte der Seite stehen in index.html, hier die des Tisches.
  //   lampe          Lichtfarben je Familie (Lampen, Treffer-Scheine, Ladung, Skala)
  //   flach          Hoher Kontrast: eigene Zeichnung (backenFlach, Sprites, Tafel, Spruchband)
  //   zeichen        die Keile der Zündkammer-Leiter tragen ein Zeichen (Plus, zwei Kugeln, Stern, Ring), damit man sie
  //                  auch ohne Farbe und ohne Beschriftung auseinanderhält
  //   umriss         eine Lampe im vollen Zustand bekommt einen hellen Umriss (Farbenblind: an und aus, halb und voll
  //                  unterscheiden sich in der Form, nicht nur in der Farbe)
  //   schein         Faktor auf die Treffer-Scheine; lampenSchein auf den Schein um die Lampen; abdunkeln ist die
  //                  Deckkraft der Abdunklung unter einer Tafel; tafelSchatten der weiche Schatten der Tafel
  //   tafelHalten, bandHalten, bandUeberblenden   Tafel und Spruchband in den hellen Darstellungen (siehe unten)
  // Umkehr: Der Filter der Seite (filter: invert(1)) dreht auch den Tisch. Auf dem dann hellen Grund wirkt jede kleine
  // Änderung im Dunkeln (Schein, Abdunklung, Schatten) als große Änderung der Leuchtdichte. Deshalb sind dort Scheine
  // schwächer, und Abdunklung und Schatten der Tafel fallen weg.
  // Helle Darstellungen (Umkehr, Hoher Kontrast hell, der Gleichheit halber auch dunkel): Dunkle Schrift und Linien auf
  // hellem Grund wiegen im L-Meter schwer. Eine Zeile im Spruchband steht dort 1,5 s und blendet direkt in die nächste
  // über (kein leeres Band dazwischen), eine Tafel geht höchstens alle 1,1 s an oder aus.
  const OKABE_ITO = Object.freeze({ eis: "#56B4E9", lavendel: "#E69F00", violett: "#CC79A7", weissgold: "#F0E442" });
  const WERKSTATT_LICHT = Object.freeze({ eis: FARBE.eis, lavendel: FARBE.lavendel, violett: FARBE.violett, weissgold: FARBE.weissgold });
  const PALETTEN = Object.freeze({
    normal: Object.freeze({
      name: "normal", flach: false, lampe: WERKSTATT_LICHT, zeichen: false, umriss: false,
      schein: 1, lampenSchein: 1, abdunkeln: 0.42, tafelSchatten: true,
    }),
    farbenblind: Object.freeze({
      name: "farbenblind", flach: false, lampe: OKABE_ITO, zeichen: true, umriss: true, umrissFarbe: "#F4F4F4",
      schein: 1, lampenSchein: 1, abdunkeln: 0.42, tafelSchatten: true,
    }),
    umkehr: Object.freeze({
      name: "umkehr", flach: false, lampe: WERKSTATT_LICHT, zeichen: false, umriss: false,
      schein: 0.28, lampenSchein: 0.4, abdunkeln: 0, tafelSchatten: false, bandHalten: 1.5, bandUeberblenden: true,
      // Gedreht ändert das Erscheinen einer Tafel eine Kachel des L-Meters um bis zu 0,09 (sie verdeckt helle Teile, die
      // gedreht dunkel sind; im Hohen Kontrast hell ebenso, dort deckt sie dunkle Linien ab). Deshalb geht sie bei Umkehr
      // und im Hohen Kontrast höchstens alle 1,1 s an oder aus: Zwei gegenläufige Wechsel liegen dann nie in derselben
      // Sekunde, ein Pause-Stakkato wird kein Blitz.
      tafelHalten: 1.1,
    }),
    "hc-dunkel": Object.freeze({
      name: "hc-dunkel", flach: true, zeichen: true, umriss: false,
      grund: "#000000", text: "#E0E0E0", leise: "#C4C4C4", rand: "#A0A0A0", metall: "#A0A0A0", kugel: "#FFFFFF",
      aufFarbe: "#000000", akzent: "#B4B5FF",
      lampe: Object.freeze({ eis: "#75C7FF", lavendel: "#AFA1FF", violett: "#A5A5FF", weissgold: "#F1E4BC" }),
      schraube: Object.freeze({ koerper: "#F1E4BC", schlitz: "#000000", rand: "#000000" }),
      schein: 0, lampenSchein: 0, abdunkeln: 0, tafelSchatten: false, tafelHalten: 1.1, bandHalten: 1.5, bandUeberblenden: true,
    }),
    "hc-hell": Object.freeze({
      name: "hc-hell", flach: true, zeichen: true, umriss: false,
      grund: "#FFFFFF", text: "#000000", leise: "#2B2B2B", rand: "#585757", metall: "#585757", kugel: "#000000",
      aufFarbe: "#FFFFFF", akzent: "#525091",
      // Fallziele hell gefüllt mit dunklem Rand: Dunkle Flächen, die versinken und wieder aufstehen, wären auf Weiß ein
      // allgemeiner Blitz (drei Ziele sind fast ein Zehntel einer Kachel des L-Meters)
      fallziel: "#DEDBEC",
      lampe: Object.freeze({ eis: "#005C8A", lavendel: "#5B499F", violett: "#524D9E", weissgold: "#625633" }),
      schraube: Object.freeze({ koerper: "#625633", schlitz: "#FFFFFF", rand: "#000000" }),
      schein: 0, lampenSchein: 0, abdunkeln: 0, tafelSchatten: false, tafelHalten: 1.1, bandHalten: 1.5, bandUeberblenden: true,
    }),
  });

  // Zeiten in Sekunden. Lichter: tau 80 bis 250 ms (Bauplan §1).
  const ZEIT = Object.freeze({
    lampeAn: 0.11,
    lampeAus: 0.2,
    lampeRuhig: 0.24,        // bei „weniger Bewegung“ beide Richtungen
    halten: 0.5,             // eine Lampengruppe bleibt mindestens so lange im neuen Zustand
    budget: 3,               // höchstens drei Licht-Ereignisse …
    budgetFenster: 1.0,      // … je Sekunde über den ganzen Tisch
    scheinBudget: 2,         // ein Treffer-Schein startet allein nur, wenn im Fenster weniger als zwei Ereignisse liegen
    scheinHalten: 0.12,
    scheinAn: 0.08,
    scheinAus: 0.25,
    scheinAbstand: 0.6,      // derselbe Schein startet frühestens nach 0,6 s wieder (unter 2 Hz)
    bandHalten: 1.1,         // eine Zeile im Spruchband steht mindestens so lange
    bandBlende: 0.22,
    bandZahl: 0.5,           // eine Zahl in derselben Zeile (Bonus, Stand der Mission) wechselt höchstens so oft …
    bandZahlBlende: 0.16,    // … und blendet dabei weich über
    tafelBlende: 0.28,
    tafelHalten: 0.5,        // Tafel an oder aus höchstens alle 0,5 s (Pause-Stakkato wird kein Flackern)
    dtMax: 1 / 30,           // größter Zeitschritt einer Blende je Bild (nach Hängern und Hintergrund kein Sprung)
    fallen: 0.16,
    aufstehen: 0.26,
    spur: 0.11,
  });

  // Helligkeit der Lichter bei Lichtstärke 100 %
  const STAERKE = Object.freeze({
    linse: 1.0,              // Deckkraft der leuchtenden Linse
    lampenSchein: 0.42,      // Schein um eine Lampe (lighter)
    bumperSchein: 0.3,       // × 0,6 Deckkraft im Ring: 0,18 Eisblau auf dunklem Grund
    kappenSchein: 0.08,
    schleuderSchein: 0.16,
    standupSchein: 0.2,
    kammerSchein: 0.55,
    spur: 0.13,
  });

  // Plakette zwischen den Schleudern (Tischeinheiten): Name in Fraunces, Trennlinie, Ballschutz-Insert, Beschriftung.
  // Sie liegt über der Reichweite der hochgeschlagenen Flipper (deren Spitze reicht bis y 0,366) und unter dem
  // Multiplikator; die Kugel rollt über sie hinweg wie über jede Tischgrafik (keine Wand, keine Physik).
  const PLAKETTE = Object.freeze({ x0: 0.37, x1: 0.63, y0: 0.362, y1: 0.503, nameY: 0.4722, linieY: 0.4492, lampeY: 0.4196, etikettY: 0.3803 });

  // Fraunces für den Spielnamen, die Gassen und Ziffern auf den Inserts. Alle übrigen Texte nehmen die Schriftkette der
  // Sprache (setzeSprache), die Vorgabe hier ist Deutsch.
  const SCHRIFT_TITEL = '"Fraunces Kugelblitz", "Fraunces Ersatz", Georgia, serif';
  const SCHRIFT_TEXT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  // Ohne setzeSprache: deutsche Vorgaben, damit die Grafik auch allein (Tests, Werkzeuge) etwas Lesbares zeigt
  const VORGABE_TEXTE = {
    tafel_untertitel: "Flipper aus der Werkstatt", tafel_flipper: "Flipper", tafel_abschuss: "Abschuss", tafel_schubsen: "Schubsen",
    pause: "Pause", tafel_flipper_tippen: "links oder rechts tippen", tafel_abschuss_tippen: "Rampe halten oder ziehen",
    tafel_schubsen_tippen: "Knöpfe unter dem Tisch", tafel_pause_tippen: "Knopf unter dem Tisch", tafel_flipper_tasten: "Shift links und rechts",
    tafel_abschuss_tasten: "Leertaste halten, loslassen", tafel_schubsen_tasten: "X, Punkt, Pfeil hoch", tafel_pause_tasten: "P oder Esc",
    tafel_oder_tippen_start: "oder irgendwo auf den Tisch tippen", tafel_oder_tippen: "oder auf den Tisch tippen", tafel_oder_enter: "oder Enter",
    tafel_rekord: "Rekord {p}", spiel_vorbei: "Spiel vorbei", punkte: "Punkte", tafel_platz1: "Neuer Rekord: Platz 1 der Bestenliste",
    tafel_platz: "Platz {n} in der Bestenliste", tafel_kein_platz: "Diesmal nicht unter den besten fünf", weiter_tippen: "Tippen: weiter",
    weiter_tasten: "P oder Esc: weiter", tisch_extraball: "EXTRABALL", tisch_sturm: "STURM", tisch_jackpot: "JACKPOT", tisch_mission: "MISSION",
    tisch_ballschutz: "BALLSCHUTZ",
  };
  function vorgabeSprache() {
    const ganz = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return {
      code: "de",
      t: (k, w) => String(VORGABE_TEXTE[k] ?? k).replace(/\{(\w+)\}/g, (a, n) => (w && w[n] !== undefined ? (typeof w[n] === "number" ? ganz(w[n]) : String(w[n])) : a)),
      zahl: ganz,
      dezimal: (n, stellen) => Number(n).toFixed(stellen).replace(".", ","),
      richtung: "ltr",
      schriftTitel: SCHRIFT_TITEL,
      schriftText: SCHRIFT_TEXT,
    };
  }

  // Schriftgröße in einem Font-Text austauschen ("560 18px Kette" → "560 15px Kette")
  const mitGroesse = (schrift, px) => schrift.replace(/\d+(\.\d+)?px/, Math.max(1, Math.round(px)) + "px");

  // Stellen, an denen eine Zeile umbrechen darf: hinter einem Leerzeichen (das geschützte Leerzeichen bricht nie), in
  // Chinesisch und Japanisch (ohne Leerzeichen) zwischen zwei Zeichen, aber nie vor einem Satzzeichen. Koreanisch,
  // Hindi und alle anderen trennen Wörter mit Leerzeichen.
  const CJK = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/;
  const SATZZEICHEN_DAVOR = /[,.;:!?)\]}\u3001\u3002\uff0c\uff0e\uff1a\uff1b\uff01\uff1f\uff09\u300d\u300f\u3015\u3011\u30fc\u309d\u309e\u3005\u301c\u30fb%]/;
  function umbruchStellen(text) {
    const stellen = [];
    const zeichen = Array.from(text);
    let pos = 0;
    for (let i = 0; i < zeichen.length - 1; i++) {
      pos += zeichen[i].length;            // Stelle hinter Zeichen i
      const a = zeichen[i];
      const b = zeichen[i + 1];
      if (a === " ") stellen.push(pos);
      else if (CJK.test(a) && CJK.test(b) && !SATZZEICHEN_DAVOR.test(b)) stellen.push(pos);
    }
    return stellen;
  }

  // --- Hilfen ----------------------------------------------------------------------

  const klemme = (v, a, b) => (v < a ? a : v > b ? b : v);

  function hexRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(h, a) {
    const [r, g, b] = hexRgb(h);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  function mische(a, b, t, alpha = 1) {
    const x = hexRgb(a);
    const y = hexRgb(b);
    const k = (i) => Math.round(x[i] + (y[i] - x[i]) * t);
    return "rgba(" + k(0) + "," + k(1) + "," + k(2) + "," + alpha + ")";
  }
  function neueLeinwand(b, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(b));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  // Exponentielle Annäherung, unabhängig von der Bildrate
  function annaehern(wert, ziel, dt, tau) {
    if (!(dt > 0)) return wert;
    return ziel + (wert - ziel) * Math.exp(-dt / tau);
  }
  function weich(s) { return s * s * (3 - 2 * s); }

  function zufallsquelle(samen) {
    let s = samen >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function rundrechteck(g, x, y, b, h, r) {
    const rr = Math.max(0, Math.min(r, b / 2, h / 2));
    g.moveTo(x + rr, y);
    g.lineTo(x + b - rr, y);
    g.arcTo(x + b, y, x + b, y + rr, rr);
    g.lineTo(x + b, y + h - rr);
    g.arcTo(x + b, y + h, x + b - rr, y + h, rr);
    g.lineTo(x + rr, y + h);
    g.arcTo(x, y + h, x, y + h - rr, rr);
    g.lineTo(x, y + rr);
    g.arcTo(x, y, x + rr, y, rr);
    g.closePath();
  }

  // Die Schraube der Startseite (style.css --schraube-1 bis -4), Winkel der Schlitze 32, -58, 78, -14 Grad
  const SCHRAUBEN_WINKEL = [32, -58, 78, -14];
  function schraubeSvg(winkel) {
    return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><defs>" +
      "<radialGradient id='s' cx='42%' cy='58%' r='50%'><stop offset='55%' stop-opacity='.6'/><stop offset='100%' stop-opacity='0'/></radialGradient>" +
      "<radialGradient id='k' cx='66%' cy='30%' r='78%'><stop offset='0' stop-color='#FFFFFF'/><stop offset='.2' stop-color='#FFFCEE'/><stop offset='.5' stop-color='#F1E4BC'/><stop offset='.8' stop-color='#C4A964'/><stop offset='1' stop-color='#7A6226'/></radialGradient>" +
      "<linearGradient id='m' x1='1' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#8A6A22' stop-opacity='.55'/><stop offset='.5' stop-color='#FFF3C4' stop-opacity='0'/><stop offset='1' stop-color='#FFFBEA' stop-opacity='.7'/></linearGradient>" +
      "</defs>" +
      "<circle cx='5.1' cy='6.9' r='5' fill='url(#s)'/>" +
      "<circle cx='6' cy='6' r='4.3' fill='url(#k)'/>" +
      "<circle cx='6' cy='6' r='4.3' fill='none' stroke='#553E0C' stroke-opacity='.6' stroke-width='.45'/>" +
      "<circle cx='6' cy='6' r='2.9' fill='none' stroke='url(#m)' stroke-width='.5'/>" +
      "<g transform='rotate(" + winkel + " 6 6)'>" +
      "<path d='M2.5 6h7' stroke='#3A2A07' stroke-width='1.2' stroke-linecap='round'/>" +
      "<path d='M2.7 6.62h6.6' stroke='#FFF7DA' stroke-opacity='.75' stroke-width='.3' stroke-linecap='round'/>" +
      "</g>" +
      "<ellipse cx='7.7' cy='3.9' rx='1.05' ry='.6' transform='rotate(-35 7.7 3.9)' fill='#FFFFFF' fill-opacity='.9'/>" +
      "</svg>";
  }

  // --- Maße der Platte ------------------------------------------------------------------
  // wp: Breite des Spielfelds in CSS-Pixeln (entspricht 1,1 Tischeinheiten). Alle Maße in CSS-Pixeln.
  function layoutFuer(wpRoh) {
    const wp = Math.max(120, Math.floor(wpRoh));
    const k = klemme(wp / 500, 0.6, 1.25);
    const rand = Math.round(klemme(22 * k, 13, 26));
    const band = Math.round(klemme(wp * 0.105, 40, 62));
    const luecke = Math.round(klemme(10 * k, 7, 12));
    const hp = Math.round(wp * HOEHE / BREITE);
    const b = wp + 2 * rand;
    const h = rand + band + luecke + hp + rand;
    // Beschlag der Platte: eckiger Rahmen fi vom Rand, Schrauben s groß, so vom Rahmen
    const fi = Math.round(klemme(7 * k, 5, 8));
    const s = Math.round(klemme(9 * k, 7, 10));
    const so = Math.round(klemme(3 * k, 2, 3));
    const bandX = Math.max(rand, fi + so + s + 5);
    return {
      k, wp, hp, rand, band, luecke, b, h, fi, s, so,
      feldX: rand, feldY: rand + band + luecke,
      bandX, bandY: rand, bandB: b - 2 * bandX,
    };
  }

  // Größtes Layout, das in maxB × maxH (CSS-Pixel) passt
  function passendesLayout(maxB, maxH) {
    let lo = 120;
    let hi = 2400;
    for (let i = 0; i < 40; i++) {
      const mitte = (lo + hi) / 2;
      const l = layoutFuer(mitte);
      if (l.b <= maxB && l.h <= maxH) lo = mitte; else hi = mitte;
    }
    return layoutFuer(lo);
  }

  // --- Inserts (Lampen) ------------------------------------------------------------------
  // Lage in Tischeinheiten (y nach oben). Jede Lampe hat ein Ziel (0 bis 1) aus z.lichter, das
  // die Grafik geglättet anzeigt.

  function ausdehnung(l) {
    switch (l.form) {
      case "kreis": case "loch": return l.r;
      case "ring": case "pille": case "raute": return Math.max(l.rx, l.ry);
      case "rechteck": return Math.max(l.b, l.h) / 2;
      case "keil": case "pfeil": return Math.max(l.laenge, l.breite) / 2;
      default: return 0.03;
    }
  }

  // Lampen, die zusammen einen Zustand zeigen, wechseln nur gemeinsam (eine Gruppe, ein Licht-Ereignis):
  // So zeigt ein Lane-Wechsel nie zwei Gassen zugleich, und der Satz der Standups bleibt in sich stimmig.
  function lampenGruppe(id) {
    if (/^(gasse|marke)\d/.test(id)) return "gassen";
    if (id.startsWith("kammer-")) return "leiter";
    if (/^(standup|zielpfeil)\d/.test(id)) return "standups";
    if (/^fallziel\d/.test(id) || id === "bankpfeil") return "fallziele";
    if (/^mission\d/.test(id)) return "missionen";
    if (/^rang\d/.test(id)) return "rang";
    if (/^mult\d/.test(id)) return "mult";
    return id;   // Einzellampen: Kickback, Ballschutz, Gewitterwolke, Zündkammer
  }

  function lampenListe(bp) {
    const liste = [];
    const neu = (l) => {
      l.wert = 0;
      l.ziel = 0;
      l.gruppe = lampenGruppe(l.id);
      l.ausdehnung = ausdehnung(l);
      l.farbe = WERKSTATT_LICHT[l.familie];      // Farbe der Familie; setzeModus tauscht sie je Darstellung
      if (l.scheinRadius === undefined) l.scheinRadius = 2.3;
      if (l.schein === undefined) l.schein = 1;
      liste.push(l);
      return l;
    };

    // Gassen L, A, D unter den Lücken der Rinne, darum der Ring der Skill-Shot-Marke
    const namen = ["L", "A", "D"];
    for (let i = 0; i < 3; i++) {
      const s = bp.sensoren.find((x) => x.name === "gasse-" + (i + 1));
      const x = s ? (s.a[0] + s.b[0]) / 2 : 0.4 + 0.16 * i;
      const y = s ? (s.a[1] + s.b[1]) / 2 - 0.088 : 1.4;
      neu({ id: "marke" + i, form: "ring", x, y, rx: 0.035, ry: 0.048, familie: "lavendel", schein: 0 });
      neu({ id: "gasse" + i, form: "pille", x, y, rx: 0.021, ry: 0.033, familie: "eis", text: namen[i], textGroesse: 0.03 });
    }

    // Missionslichter 1 bis 5 zwischen den oberen Bumpern und den Gassen
    for (let i = 0; i < 5; i++) {
      neu({ id: "mission" + i, form: "kreis", x: 0.416 + 0.042 * i, y: 1.292, r: 0.0145, familie: "violett", text: String(i + 1), textGroesse: 0.018 });
    }

    // Gewitterwolke: Mitte des Bumper-Dreiecks, leuchtet im Multiball
    neu({ id: "sturm", form: "kreis", x: 0.5, y: 1.113, r: 0.026, familie: "lavendel", zeichen: "blitz" });

    // Leiter zur Zündkammer: vier Keile, die auf das Loch zeigen
    const kammer = bp.loecher && bp.loecher[0] ? bp.loecher[0].pos : [0.2, 0.86];
    const ux0 = 0.42 - kammer[0];
    const uy0 = 0.60 - kammer[1];
    const ul = Math.hypot(ux0, uy0);
    const ux = ux0 / ul;
    const uy = uy0 / ul;
    const zurKammer = Math.atan2(-uy, -ux);
    // Beschriftungen als Schlüssel (sprachen.js "tisch_…"), gezeichnet in der Sprache der Grafik
    const leiter = [
      ["extraball", "tisch_extraball", "eis", "plus"],
      ["multiball", "tisch_sturm", "lavendel", "zwei"],
      ["jackpot", "tisch_jackpot", "weissgold", "stern"],
      ["mission", "tisch_mission", "violett", "ring"],
    ];
    leiter.forEach(([id, etikett, familie, sinn], i) => {
      const d = 0.10 + 0.05 * i;
      neu({ id: "kammer-" + id, form: "keil", x: kammer[0] + ux * d, y: kammer[1] + uy * d, laenge: 0.036, breite: 0.05, winkel: zurKammer, familie, sinn, etikett, etikettLage: "rechts" });
    });

    // Gespiegelt: drei Keile zu den Standups (zeigen den Stand des Satzes)
    for (let i = 0; i < 3; i++) {
      const d = 0.25 - 0.05 * i;
      neu({ id: "zielpfeil" + i, form: "keil", x: 1 - (kammer[0] + ux * d), y: kammer[1] + uy * d, laenge: 0.036, breite: 0.05, winkel: Math.PI - zurKammer, familie: "eis" });
    }

    // Pfeil zur Fallziel-Bank und je eine Lampe vor den Fallzielen und Standups
    neu({ id: "bankpfeil", form: "pfeil", x: 0.142, y: 1.075, laenge: 0.075, breite: 0.036, winkel: Math.PI, familie: "lavendel" });
    for (let i = 0; i < 3; i++) {
      neu({ id: "fallziel" + i, form: "kreis", x: 0.074, y: 0.87 + 0.14 * i, r: 0.0115, familie: "lavendel" });
      neu({ id: "standup" + i, form: "kreis", x: 0.92, y: 0.87 + 0.14 * i, r: 0.0115, familie: "eis" });
    }

    // Kickback in der linken Outlane
    neu({ id: "kickback", form: "kreis", x: 0.08, y: 0.36, r: 0.019, familie: "eis", zeichen: "hoch" });

    // Rang-Leiter in der Mitte, unten Funke, oben Kugelblitz
    for (let i = 0; i < 6; i++) {
      neu({ id: "rang" + i, form: "raute", x: 0.5, y: 0.585 + 0.05 * i, rx: 0.012 + 0.0012 * i, ry: 0.015 + 0.0012 * i, familie: i === 5 ? "eis" : "lavendel" });
    }

    // Multiplikator 2× bis 5× (über der Plakette)
    for (let i = 0; i < 4; i++) {
      neu({ id: "mult" + i, form: "rechteck", x: 0.395 + 0.07 * i, y: PLAKETTE.y1 + 0.032, b: 0.054, h: 0.034, familie: "eis", text: (i + 2) + "×", textGroesse: 0.021 });
    }

    // Ballschutz in der Plakette zwischen den Schleudern (die Beschriftung trägt die Plakette)
    neu({ id: "schutz", form: "kreis", x: 0.5, y: PLAKETTE.lampeY, r: 0.0185, familie: "lavendel", zeichen: "schild" });

    // Zündkammer: ruhiger Schein, solange sie eine Kugel hält
    neu({ id: "kammer", form: "loch", x: kammer[0], y: kammer[1], r: 0.048, familie: "violett", scheinRadius: 1.9 });

    return liste;
  }

  // --- Die Grafik ------------------------------------------------------------------------

  class Grafik {
    constructor(leinwand, bauplan) {
      this.leinwand = leinwand;
      this.ctx = leinwand.getContext("2d", { alpha: false });
      this.bauplan = bauplan;
      this.statisch = neueLeinwand(1, 1);
      this.sctx = this.statisch.getContext("2d");
      this.lay = null;
      this.dpr = 1;
      this.m = 1;
      this.ox = 0;
      this.oy = 0;
      this.lichtstaerke = 0.7;
      this.wenigBewegung = false;
      this.modus = "normal";           // Darstellung (Abschnitt 7): normal, farbenblind, umkehr, hc-dunkel, hc-hell
      this.pal = PALETTEN.normal;
      this.schrauben = null;
      this.lampen = lampenListe(bauplan);
      this.gruppen = new Map();
      for (const l of this.lampen) {
        if (!this.gruppen.has(l.gruppe)) this.gruppen.set(l.gruppe, { name: l.gruppe, seit: -1e9, will: false, bereit: false });
        l.g = this.gruppen.get(l.gruppe);
      }
      this.roh = {};
      this.budget = [];
      this.protokoll = null;           // L-Meter: Liste aller Licht-Ereignisse {t, art}
      this.bildEreignis = false;       // in diesem Bild hat schon ein Licht-Ereignis begonnen
      this.lampeWartet = false;        // eine Lampengruppe wartet auf das Budget: Treffer-Scheine lassen ihr den Vortritt
      this.scheinWunsch = [];          // Treffer-Scheine aus den Ereignissen der Physik, gestartet nach den Lampen
      this.spurWunsch = [];            // Spuren von Durchschüssen, warten auf das Budget (werden nicht verworfen)
      this.scheine = new Map();
      this.fallziele = new Map();
      this.schleuder = [0, 0];
      this.spuren = [];
      this.verlauf = new WeakMap();
      this.letzterLoch = -9;
      this.band = { zeige: null, naechstes: null, modus: "steht", seit: -9, alpha: 1, fortschritt: 0, uhr: 0, alt: null, zahlSeit: -9, zahlWunsch: null };
      this.tafel = { schluessel: "", art: "", sprite: null, alpha: 0, knopf: null, ziel: "", wechsel: -9, uhr: 0 };
      this.zeiten = new Float64Array(900);
      this.zeitenN = 0;
      this.zeitenI = 0;
      this.letzteUhr = null;
      this.letzteEcht = null;
      this.textBreiten = new Map();
      this.texte = vorgabeSprache();
      this.sp = {};
      this.schraubenLaden();
    }

    // --- Einrichtung ---------------------------------------------------------------

    schraubenLaden() {
      if (typeof Image === "undefined") return;
      const bilder = SCHRAUBEN_WINKEL.map((w) => {
        const img = new Image();
        img.src = "data:image/svg+xml," + encodeURIComponent(schraubeSvg(w));
        return img;
      });
      Promise.all(bilder.map((b) => (b.decode ? b.decode() : Promise.resolve()).catch(() => {})))
        .then(() => {
          this.schrauben = bilder;
          if (this.lay) { this.spritesBauen(); this.backen(); }
        });
    }

    einstellungen({ lichtstaerke, wenigBewegung }) {
      if (lichtstaerke !== undefined) this.lichtstaerke = klemme(lichtstaerke, 0.3, 1);
      if (wenigBewegung !== undefined) this.wenigBewegung = !!wenigBewegung;
    }

    setzeGroesse(lay, dpr) {
      this.lay = lay;
      this.dpr = dpr;
      const W = Math.round(lay.b * dpr);
      const H = Math.round(lay.h * dpr);
      this.leinwand.width = W;
      this.leinwand.height = H;
      this.leinwand.style.width = lay.b + "px";
      this.leinwand.style.height = lay.h + "px";
      this.statisch.width = W;
      this.statisch.height = H;
      this.m = (lay.wp * dpr) / BREITE;
      this.ox = lay.feldX * dpr;
      this.oy = lay.feldY * dpr;
      this.textBreiten.clear();
      this.tafel.schluessel = "";
      this.spritesBauen();
      this.backen();
    }

    neuBacken() {
      if (!this.lay) return;
      this.textBreiten.clear();
      this.tafel.schluessel = "";
      this.spritesBauen();
      this.backen();
    }

    // Darstellung wechseln (Abschnitt 7): Lampenfarben tauschen, Sprites und die gebackene Ebene neu bauen, die Tafel beim
    // nächsten Bild neu setzen. Zustände (Lampen, Scheine, Spruchband, Tafel) laufen weiter, nichts blendet neu ein: Seite
    // und Tisch wechseln im selben Bild, ein einziger Sprung.
    setzeModus(modus) {
      const pal = PALETTEN[modus] || PALETTEN.normal;
      if (pal === this.pal) return;
      this.pal = pal;
      this.modus = pal.name;
      for (const l of this.lampen) l.farbe = pal.lampe[l.familie];
      this.verlauf = new WeakMap();      // Spur neu anfangen (im Hohen Kontrast gibt es keine)
      this.neuBacken();
    }

    // Sprache wechseln: { code, t(schlüssel, werte), zahl(n), dezimal(n, stellen), richtung, schriftTitel, schriftText }.
    // Beschriftungen auf dem Tisch und die Tafel werden neu gebaut (ein stiller Tausch kleiner, gedämpfter Schrift, kein
    // Lichtereignis); das Spruchband blendet von selbst weich über, weil sein Text sich ändert.
    setzeSprache(s) {
      this.texte = { ...vorgabeSprache(), ...s };
      this.neuBacken();
    }

    // Breite eines Textes in einer Schrift (für die Tafeln, ohne Bild-Takt)
    messen(schrift, text) {
      if (!this.messCtx) this.messCtx = neueLeinwand(1, 1).getContext("2d");
      this.messCtx.font = schrift;
      return this.messCtx.measureText(text).width;
    }

    // Text in höchstens zwei Zeilen aufteilen, so dass die längere Zeile möglichst kurz ist
    zweiZeilen(text, breite) {
      const stellen = umbruchStellen(text);
      let best = null;
      for (const pos of stellen) {
        const a = text.slice(0, pos).trimEnd();
        const b = text.slice(pos).trimStart();
        const w = Math.max(breite(a), breite(b));
        if (!best || w < best.w) best = { w, zeilen: [a, b] };
      }
      return best;
    }

    X(x) { return this.ox + x * this.m; }
    Y(y) { return this.oy + (HOEHE - y) * this.m; }

    // Wandelt einen Punkt der Leinwand (CSS-Pixel) in Tischeinheiten
    zuTisch(cssX, cssY) {
      const l = this.lay;
      return { x: ((cssX - l.feldX) / l.wp) * BREITE, y: HOEHE - ((cssY - l.feldY) / l.wp) * BREITE };
    }

    // --- Ereignisse der Physik (nur lesen) --------------------------------------------------

    // Treffer-Scheine und Spuren werden hier nur vorgemerkt; ob sie starten, entscheidet das Bild nach den Lampen
    // (Lampen haben Vorrang vor Effekten, siehe zeichne).
    ereignisse(liste, tisch, uhr) {
      for (const e of liste) {
        const probe = e.kugel && e.kugel.probe;
        if (e.art === "durchschuss" || e.art === "ausbruch") {
          if (e.pos && this.spurWunsch.length < 40) this.spurWunsch.push({ x: e.pos.x, y: e.pos.y });
          continue;
        }
        if (probe) continue;
        if (e.art === "bumper") {
          const i = tisch.bumper.indexOf(e.bumper);
          if (i >= 0) this.schein("bumper" + i);
        } else if (e.art === "wand") {
          const w = e.wand;
          if (w.art === "schleuder" && e.tritt) {
            const s = String(w.name).includes("-r-") ? 1 : 0;
            if (!this.wenigBewegung) this.schleuder[s] = 1;
            this.schein("schleuder" + s);
          } else if (w.art === "standup") {
            const n = (parseInt(String(w.name).slice(-1), 10) || 1) - 1;
            this.schein("standup" + n);
          }
        } else if (e.art === "loch") {
          this.letzterLoch = uhr;
        }
      }
    }

    // --- Lichter: Ziel, Haltezeit, Budget, Überblendung -------------------------------------

    budgetFrei(t, grenze) {
      let n = 0;
      for (let i = this.budget.length - 1; i >= 0; i--) {
        if (t - this.budget[i] < ZEIT.budgetFenster) n++;
        else break;
      }
      return n < grenze;
    }

    budgetNimm(t, art) {
      this.budget.push(t);
      while (this.budget.length > 12) this.budget.shift();
      if (this.protokoll) this.protokoll.push({ t, art });
    }

    lampenRoh(z, tisch, uhr) {
      const l = z.lichter || {};
      const r = this.roh;
      const an = (b) => (b ? 1 : 0);
      const spielt = z.phase === "bereit" || z.phase === "spiel" || z.phase === "bonus";
      for (let i = 0; i < 3; i++) {
        r["gasse" + i] = an(l.gasse && l.gasse[i]);
        r["marke" + i] = an(l.zielmarke === i);
        r["fallziel" + i] = an(spielt && l.fallziel && l.fallziel[i]);
        r["standup" + i] = an(l.standup && l.standup[i]);
      }
      const satz = l.standup ? l.standup.filter(Boolean).length : 0;
      for (let i = 0; i < 3; i++) r["zielpfeil" + i] = an(satz > i);
      const m = z.mission || {};
      const erfuellt = (m.erfuellt || 0) % 5;
      for (let i = 0; i < 5; i++) r["mission" + i] = i < erfuellt ? 1 : i === erfuellt && m.aktiv ? 0.5 : 0;
      const naechst = l.zuendkammer || "";
      const stufe = (b, name) => (b ? (naechst === name ? 1 : 0.5) : 0);
      r["kammer-extraball"] = stufe(l.extraball, "extraball");
      r["kammer-multiball"] = stufe(l.multiball, "multiball");
      r["kammer-jackpot"] = stufe(l.jackpot, "jackpot");
      r["kammer-mission"] = stufe(l.mission, "mission");
      const bankMission = m.aktiv && m.nr === 3;
      const extraNah = z.banken === 2 && !z.extraballBereit && !(z.statistik && z.statistik.extraBaelle);
      r.bankpfeil = spielt ? (bankMission ? 1 : extraNah ? 0.5 : 0) : 0;
      r.kickback = an(spielt && l.kickback);
      for (let i = 0; i < 4; i++) r["mult" + i] = an(l.multiplikator && l.multiplikator[i]);
      for (let i = 0; i < 6; i++) r["rang" + i] = an(spielt && l.rang && l.rang[i]);
      r.schutz = an(l.schutz);
      r.sturm = l.jackpot ? 1 : l.multiball ? 0.5 : 0;
      const loch = tisch.loecher && tisch.loecher[0];
      r.kammer = an((loch && loch.halter && !loch.halter.probe) || uhr - this.letzterLoch < 1.0);
      return r;
    }

    // Zustandslampen (Abschnitt 4): Lampen, die zusammen einen Zustand zeigen, bilden eine Gruppe und wechseln nur
    // gemeinsam. Jede Lampe hält einen neuen Zustand mindestens ZEIT.halten (höchstens 1 Hz an und aus); eine Gruppe
    // wechselt, sobald keine ihrer wechselnden Lampen mehr in der Haltezeit steckt. Gezeigt wird immer der neueste
    // Zustand des Regelwerks: Was sich während der Haltezeit oder des Wartens auf das Budget hin und her ändert, wird
    // verworfen, nicht nachgeholt. Alle Gruppen, die in einem Bild wechseln dürfen, wechseln zusammen (ein
    // Licht-Ereignis). Lampen haben Vorrang vor Effekten: Sie starten zuerst, und solange eine Gruppe auf das Budget
    // wartet, startet kein Treffer-Schein.
    lampenSchritt(z, tisch, uhr, dt) {
      const roh = this.lampenRoh(z, tisch, uhr);
      for (const g of this.gruppen.values()) { g.will = false; g.bereit = true; }
      for (const l of this.lampen) {
        if ((roh[l.id] || 0) === l.ziel) continue;
        l.g.will = true;
        if (uhr - (l.seit ?? -1e9) < ZEIT.halten) l.g.bereit = false;
      }
      let bereit = false;
      for (const g of this.gruppen.values()) {
        g.bereit = g.will && g.bereit;
        if (g.bereit) bereit = true;
      }
      this.lampeWartet = false;
      if (bereit) {
        if (this.budgetFrei(uhr, ZEIT.budget)) {
          for (const l of this.lampen) {
            const r = roh[l.id] || 0;
            if (l.g.bereit && r !== l.ziel) { l.ziel = r; l.seit = uhr; }
          }
          this.budgetNimm(uhr, "lampe");
          this.bildEreignis = true;
        } else {
          this.lampeWartet = true;
        }
      }
      const tauAn = this.wenigBewegung ? ZEIT.lampeRuhig : ZEIT.lampeAn;
      const tauAus = this.wenigBewegung ? ZEIT.lampeRuhig : ZEIT.lampeAus;
      for (const l of this.lampen) {
        if (l.wert !== l.ziel) {
          l.wert = annaehern(l.wert, l.ziel, dt, l.ziel > l.wert ? tauAn : tauAus);
          if (Math.abs(l.wert - l.ziel) < 0.002) l.wert = l.ziel;
        }
      }
    }

    // Treffer-Schein vormerken (gestartet wird in scheineStarten, nach den Lampen)
    schein(name) { this.scheinWunsch.push(name); }

    // Treffer-Schein: startet frühestens 0,6 s nach seinem letzten Start. Beginnt in diesem Bild schon ein
    // Licht-Ereignis (Lampen), gehört der Schein dazu; sonst braucht er freies Budget (weniger als zwei Ereignisse im
    // Fenster) und keine wartende Lampe. Ein Treffer, solange der Schein noch steht, verlängert ihn nur.
    scheineStarten(t) {
      if (!this.scheinWunsch.length) return;
      // Ohne Treffer-Scheine (Hoher Kontrast) verbrauchen Treffer auch kein Budget
      if (!(this.pal.schein > 0)) { this.scheinWunsch.length = 0; return; }
      for (const name of this.scheinWunsch) {
        let s = this.scheine.get(name);
        if (!s) { s = { wert: 0, ziel: 0, bis: 0, start: -99 }; this.scheine.set(name, s); }
        if (s.ziel === 1) { s.bis = Math.max(s.bis, t + ZEIT.scheinHalten); continue; }
        if (t - s.start < ZEIT.scheinAbstand) continue;
        if (!this.bildEreignis) {
          if (this.lampeWartet || !this.budgetFrei(t, ZEIT.scheinBudget)) continue;
          this.budgetNimm(t, "schein");
          this.bildEreignis = true;
        }
        s.ziel = 1;
        s.bis = t + ZEIT.scheinHalten;
        s.start = t;
      }
      this.scheinWunsch.length = 0;
    }

    // Spuren der Probesalve (Durchschüsse): warten auf das Budget, werden aber nie verworfen (sie sind ein Messwert)
    spurenStarten(uhr) {
      while (this.spurWunsch.length) {
        if (!this.bildEreignis) {
          if (!this.budgetFrei(uhr, ZEIT.budget)) break;
          this.budgetNimm(uhr, "spur");
          this.bildEreignis = true;
        }
        const s = this.spurWunsch.shift();
        this.spuren.push({ x: s.x, y: s.y, t: uhr });
      }
      if (this.spuren.length > 40) this.spuren.splice(0, this.spuren.length - 40);
    }

    scheineSchritt(t, dt) {
      const tauAn = this.wenigBewegung ? ZEIT.lampeRuhig : ZEIT.scheinAn;
      const tauAus = this.wenigBewegung ? ZEIT.lampeRuhig : ZEIT.scheinAus;
      for (const s of this.scheine.values()) {
        if (s.ziel === 1 && t >= s.bis) s.ziel = 0;
        if (s.wert !== s.ziel) {
          s.wert = annaehern(s.wert, s.ziel, dt, s.ziel > s.wert ? tauAn : tauAus);
          if (Math.abs(s.wert - s.ziel) < 0.003) s.wert = s.ziel;
        }
      }
    }

    scheinWert(name) {
      const s = this.scheine.get(name);
      return s ? s.wert : 0;
    }

    fallzieleSchritt(tisch, dt) {
      for (const w of tisch.waende) {
        if (w.art !== "fallziel") continue;
        let s = this.fallziele.get(w.name);
        if (s === undefined) s = w.aktiv ? 1 : 0;
        const ziel = w.aktiv ? 1 : 0;
        if (s > ziel) s = Math.max(ziel, s - dt / ZEIT.fallen);
        else if (s < ziel) s = Math.min(ziel, s + dt / ZEIT.aufstehen);
        this.fallziele.set(w.name, s);
      }
    }

    // --- Sprites ------------------------------------------------------------------------

    spritesBauen() {
      const m = this.m;
      const P = this.pal;
      const sp = (this.sp = {});
      const rk = 0.03 * m;
      if (P.flach) {
        // Hoher Kontrast: Kugel als volle Scheibe mit Ring, Flipper als Umriss, flache Schrauben, keine Schatten und Scheine
        sp.kugel = this.kugelFlach(rk, P.kugel);
        sp.probe = this.kugelFlach(rk, P.lampe.eis);
        sp.flipper0 = sp.flipper1 = this.flipperFlach();
        sp.schrauben = SCHRAUBEN_WINKEL.map((w, i) => this.schraubeFlachSprite(i, 0.034 * m));
        sp.fallziel = this.fallzielFlach();
        for (const l of this.lampen) l.sprite = this.lampeSpriteFlach(l);
        return;
      }
      sp.kugel = this.kugelSprite(rk, false);
      sp.probe = this.kugelSprite(rk, true);
      sp.kugelSchatten = this.weicherFleck(rk * 1.25, "rgba(2,2,10,0.6)");
      sp.spur = this.weicherFleck(rk * 0.85, rgba(P.lampe.lavendel, 0.9));
      sp.lochSchatten = this.lochSchattenSprite(rk);
      sp.flipper0 = sp.flipper1 = this.flipperSprite();
      sp.schrauben = this.schrauben ? this.schrauben.map((b) => this.schraubeSprite(b, 0.034 * m)) : null;
      // Treffer-Scheine
      const rb = 0.075 * m;
      // Der Ring liegt außerhalb des Weißgold-Rings (bis 0,85 R): Licht auf hellem Metall gäbe zu große Sprünge.
      sp.bumperSchein = this.ringSchein(rb * 0.9, rb * 1.08, rb * 1.55, P.lampe.eis);
      sp.kappenSchein = this.weicherFleck(rb * 0.66, rgba(P.lampe.lavendel, 1));
      sp.schleuderSchein = this.weicherFleck(0.06 * m, rgba(P.lampe.lavendel, 1));
      sp.standupSchein = this.halberFleck(0.046 * m, rgba(P.lampe.eis, 1));
      sp.fallziel = this.fallzielSprite();
      for (const l of this.lampen) l.sprite = this.lampeSprite(l);
    }

    weicherFleck(r, farbe) {
      const n = Math.ceil(2 * r + 2);
      const c = neueLeinwand(n, n);
      const g = c.getContext("2d");
      const v = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, r);
      v.addColorStop(0, farbe);
      v.addColorStop(0.45, farbe.replace(/[\d.]+\)$/, (a) => (parseFloat(a) * 0.45).toFixed(3) + ")"));
      v.addColorStop(1, farbe.replace(/[\d.]+\)$/, "0)"));
      g.fillStyle = v;
      g.fillRect(0, 0, n, n);
      return { c, h: n / 2 };
    }

    // Schein nur links der Mitte (vor der Fläche eines Standups, nicht auf dem hellen Kunststoff)
    halberFleck(r, farbe) {
      const f = this.weicherFleck(r, farbe);
      const g = f.c.getContext("2d");
      g.clearRect(Math.ceil(f.h), 0, f.c.width, f.c.height);
      return f;
    }

    ringSchein(innen, mitte, aussen, farbe) {
      const n = Math.ceil(2 * aussen + 2);
      const c = neueLeinwand(n, n);
      const g = c.getContext("2d");
      const v = g.createRadialGradient(n / 2, n / 2, innen, n / 2, n / 2, aussen);
      const t = (mitte - innen) / (aussen - innen);
      v.addColorStop(0, rgba(farbe, 0));
      v.addColorStop(t, rgba(farbe, 0.6));
      v.addColorStop(Math.min(1, t + (1 - t) * 0.45), rgba(farbe, 0.2));
      v.addColorStop(1, rgba(farbe, 0));
      g.fillStyle = v;
      g.fillRect(0, 0, n, n);
      return { c, h: n / 2 };
    }

    // Chromkugel: oben spiegelt sie den hellen Raum, unten den dunklen Tisch, Glanzpunkt zur Lichtquelle
    // rechts oben, Randlicht links unten (Widerschein der Lichter), dunkle Kontur gegen jeden Grund.
    kugelSprite(R, probe) {
      const d = this.dpr;
      const n = Math.ceil(2 * R + 4 * d);
      const c = neueLeinwand(n, n);
      const g = c.getContext("2d");
      const cx = n / 2;
      const cy = n / 2;
      g.save();
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.clip();
      g.translate(cx, cy);
      g.rotate(-0.22);
      const lg = g.createLinearGradient(0, -R, 0, R);
      lg.addColorStop(0, "#F6F4FF");
      lg.addColorStop(0.38, "#BDB8E6");
      lg.addColorStop(0.49, "#6E68A4");
      lg.addColorStop(0.53, "#26234B");
      lg.addColorStop(0.78, "#3A366C");
      lg.addColorStop(1, "#68629E");
      g.fillStyle = lg;
      g.fillRect(-R, -R, 2 * R, 2 * R);
      g.rotate(0.22);
      const rg = g.createRadialGradient(0.3 * R, -0.34 * R, 0.1 * R, 0, 0, R * 1.02);
      rg.addColorStop(0, "rgba(255,255,255,0)");
      rg.addColorStop(0.62, "rgba(18,14,48,0.12)");
      rg.addColorStop(1, "rgba(6,5,22,0.72)");
      g.fillStyle = rg;
      g.fillRect(-R, -R, 2 * R, 2 * R);
      // Randlicht links unten
      g.lineWidth = Math.max(1, R * 0.16);
      g.strokeStyle = "rgba(175,161,255,0.38)";
      g.beginPath();
      g.arc(0, 0, R * 0.9, Math.PI * 0.55, Math.PI * 1.05);
      g.stroke();
      // Glanzpunkt rechts oben
      g.save();
      g.translate(0.33 * R, -0.4 * R);
      g.rotate(-0.62);
      g.scale(1, 0.62);
      const gl = g.createRadialGradient(0, 0, 0, 0, 0, 0.3 * R);
      gl.addColorStop(0, "rgba(255,255,255,0.98)");
      gl.addColorStop(0.45, "rgba(255,255,255,0.75)");
      gl.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gl;
      g.beginPath();
      g.arc(0, 0, 0.3 * R, 0, TAU);
      g.fill();
      g.restore();
      if (probe) {
        g.globalCompositeOperation = "source-atop";
        g.fillStyle = rgba(this.pal.lampe.eis, 0.38);
        g.fillRect(-R, -R, 2 * R, 2 * R);
        g.globalCompositeOperation = "source-over";
      }
      g.restore();
      g.lineWidth = Math.max(1, 0.8 * d);
      g.strokeStyle = "rgba(6,6,18,0.75)";
      g.beginPath();
      g.arc(cx, cy, R - g.lineWidth / 2, 0, TAU);
      g.stroke();
      return { c, h: n / 2 };
    }

    // Schatten, den der Rand der Zündkammer auf eine gehaltene Kugel wirft (Licht von rechts oben)
    lochSchattenSprite(R) {
      const n = Math.ceil(2 * R + 4);
      const c = neueLeinwand(n, n);
      const g = c.getContext("2d");
      g.beginPath();
      g.arc(n / 2, n / 2, R, 0, TAU);
      g.clip();
      const v = g.createLinearGradient(n / 2 + R, n / 2 - R, n / 2 - R * 0.2, n / 2 + R * 0.2);
      v.addColorStop(0, "rgba(3,3,12,0.85)");
      v.addColorStop(0.55, "rgba(3,3,12,0.35)");
      v.addColorStop(1, "rgba(3,3,12,0)");
      g.fillStyle = v;
      g.fillRect(0, 0, n, n);
      return { c, h: n / 2 };
    }

    schraubeSprite(bild, groesse) {
      const n = Math.max(4, Math.round(groesse));
      const c = neueLeinwand(n, n);
      c.getContext("2d").drawImage(bild, 0, 0, n, n);
      return { c, h: n / 2 };
    }

    // --- Hoher Kontrast: flache Teile (Abschnitt 7) --------------------------------------------------------

    // Flache Schraube: Scheibe in Weißgold (im Hellen dunkles Gold), schwarzer Rand, Schlitz im Winkel der Startseite.
    // Dieselbe Form wie die Schrauben der Seite im Hohen Kontrast (CSS --schraube-1 bis -4).
    schraubeFlach(g, x, y, s, winkel) {
      const S = this.pal.schraube;
      const cx = x + s / 2;
      const cy = y + s / 2;
      g.beginPath();
      g.arc(cx, cy, s * 0.375, 0, TAU);
      g.fillStyle = S.koerper;
      g.fill();
      g.lineWidth = Math.max(1, s * 0.058);
      g.strokeStyle = S.rand;
      g.stroke();
      const w = (winkel * Math.PI) / 180;
      const dx = Math.cos(w) * s * 0.25;
      const dy = Math.sin(w) * s * 0.25;
      g.lineCap = "round";
      g.lineWidth = Math.max(1, s * 0.108);
      g.strokeStyle = S.schlitz;
      g.beginPath();
      g.moveTo(cx - dx, cy - dy);
      g.lineTo(cx + dx, cy + dy);
      g.stroke();
    }

    schraubeFlachSprite(i, groesse) {
      const n = Math.max(4, Math.round(groesse));
      const c = neueLeinwand(n, n);
      this.schraubeFlach(c.getContext("2d"), 0, 0, n, SCHRAUBEN_WINKEL[i]);
      return { c, h: n / 2 };
    }

    // Schraube Nummer i (0 bis 3) an x, y in der Größe s: im Hohen Kontrast flach, sonst die Schraube der Startseite
    schraubeAn(g, i, x, y, s) {
      if (this.pal.flach) this.schraubeFlach(g, x, y, s, SCHRAUBEN_WINKEL[i]);
      else if (this.schrauben) g.drawImage(this.schrauben[i], x, y, s, s);
    }

    // Kugel im Hohen Kontrast: Zielscheibe aus breitem Ring und Punkt in der Mitte (dunkel weiß, hell schwarz) auf einer
    // Scheibe im Grund. So ist sie vom Grund, von Wänden und vom Flipper (nur Umriss) deutlich abgesetzt und mit keiner
    // Lampe zu verwechseln. Bewusst keine volle Scheibe: Drei volle Kugeln nah beieinander änderten eine Kachel des
    // L-Meters um fast ein Zehntel (Abschnitt 7).
    kugelFlach(R, farbe) {
      const d = this.dpr;
      const n = Math.ceil(2 * R + 4 * d);
      const c = neueLeinwand(n, n);
      const g = c.getContext("2d");
      const mx = n / 2;
      g.beginPath();
      g.arc(mx, mx, R, 0, TAU);
      g.fillStyle = this.pal.grund;
      g.fill();
      const ring = Math.max(2 * d, R * 0.25);
      g.lineWidth = ring;
      g.strokeStyle = farbe;
      g.beginPath();
      g.arc(mx, mx, R - ring / 2, 0, TAU);
      g.stroke();
      g.beginPath();
      g.arc(mx, mx, Math.max(1.2 * d, R * 0.2), 0, TAU);
      g.fillStyle = farbe;
      g.fill();
      return { c, h: n / 2 };
    }

    // Flipper im Hohen Kontrast: Umriss in Schriftfarbe um eine Fläche im Grund, eine Linie längs des Arms
    flipperFlach() {
      const m = this.m;
      const d = this.dpr;
      const P = this.pal;
      const r = 0.03 * m;
      const L = 0.2 * m;
      const pad = Math.ceil(3 * d + r * 0.6);
      const b = Math.ceil(L + 2 * r + 2 * pad);
      const h = Math.ceil(2 * r + 2 * pad);
      const ax = pad + r;
      const ay = h / 2;
      const lw = Math.max(2 * d, 0.0065 * m);
      const rr = r - lw / 2;
      const c = neueLeinwand(b, h);
      const g = c.getContext("2d");
      g.beginPath();
      g.arc(ax, ay, rr, Math.PI / 2, Math.PI * 1.5);
      g.lineTo(ax + L, ay - rr * 0.84);
      g.arc(ax + L, ay, rr * 0.84, -Math.PI / 2, Math.PI / 2);
      g.closePath();
      g.fillStyle = P.grund;
      g.fill();
      g.lineJoin = "round";
      g.lineWidth = lw;
      g.strokeStyle = P.text;
      g.stroke();
      g.lineCap = "round";
      g.lineWidth = Math.max(1, Math.round(d));
      g.beginPath();
      g.moveTo(ax + r * 0.6, ay);
      g.lineTo(ax + L - r * 0.2, ay);
      g.stroke();
      return { c, schatten: null, ax, ay };
    }

    // Fallziel im Hohen Kontrast: volle Fläche in Lavendel, Rand in Schriftfarbe; im Hellen helle Fläche mit Rand in Lavendel
    fallzielFlach() {
      const m = this.m;
      const d = this.dpr;
      const b = Math.ceil(0.026 * m) + 1;
      const h = Math.ceil(0.132 * m);
      const c = neueLeinwand(b, h);
      const g = c.getContext("2d");
      const P = this.pal;
      g.fillStyle = P.fallziel || P.lampe.lavendel;
      g.fillRect(0, 0, b, h);
      const lw = P.fallziel ? Math.max(2, Math.round(2 * d)) : Math.max(1, Math.round(d));
      g.lineWidth = lw;
      g.strokeStyle = P.fallziel ? P.lampe.lavendel : P.text;
      g.strokeRect(lw / 2, lw / 2, b - lw, h - lw);
      return { c, b, h };
    }

    // Flipper: Gummiring um einen Kunststoffkörper mit heller Kante oben. Im Sprite zeigt der Arm
    // nach rechts, die Oberseite nach oben; der rechte Flipper wird gespiegelt gezeichnet.
    flipperSprite() {
      const m = this.m;
      const d = this.dpr;
      const r = 0.03 * m;
      const L = 0.2 * m;
      const pad = Math.ceil(3 * d + r * 0.6);
      const b = Math.ceil(L + 2 * r + 2 * pad);
      const h = Math.ceil(2 * r + 2 * pad);
      const ax = pad + r;
      const ay = h / 2;
      const kapsel = (g, rr) => {
        g.beginPath();
        g.arc(ax, ay, rr, Math.PI / 2, Math.PI * 1.5);
        g.lineTo(ax + L, ay - rr * 0.84);
        g.arc(ax + L, ay, rr * 0.84, -Math.PI / 2, Math.PI / 2);
        g.closePath();
      };
      // Körper: der Arm wird zur Spitze schmaler (nur Darstellung, die Physik rechnet mit der Kapsel)
      const c = neueLeinwand(b, h);
      const g = c.getContext("2d");
      kapsel(g, r);
      g.fillStyle = "#1E1A3C";
      g.fill();
      // Glanz auf dem Gummi oben
      g.save();
      kapsel(g, r);
      g.clip();
      g.strokeStyle = "rgba(190,184,240,0.30)";
      g.lineWidth = Math.max(1, r * 0.16);
      g.beginPath();
      g.moveTo(ax - r * 0.2, ay - r * 0.88);
      g.lineTo(ax + L, ay - r * 0.74);
      g.stroke();
      g.restore();
      const lg = g.createLinearGradient(0, ay - r, 0, ay + r);
      lg.addColorStop(0, "#C2BAF2");
      lg.addColorStop(0.28, "#8E86D0");
      lg.addColorStop(0.62, "#5B54A0");
      lg.addColorStop(1, "#2F2A62");
      kapsel(g, r * 0.7);
      g.fillStyle = lg;
      g.fill();
      // Kante: oben hell, unten dunkel
      g.save();
      kapsel(g, r * 0.7);
      g.clip();
      g.lineWidth = Math.max(1, 0.9 * d);
      g.strokeStyle = "rgba(246,244,255,0.75)";
      g.beginPath();
      g.moveTo(ax - r * 0.5, ay - r * 0.56);
      g.lineTo(ax + L, ay - r * 0.47);
      g.stroke();
      g.strokeStyle = "rgba(10,8,30,0.55)";
      g.beginPath();
      g.moveTo(ax - r * 0.5, ay + r * 0.6);
      g.lineTo(ax + L, ay + r * 0.52);
      g.stroke();
      g.restore();
      // Schatten (einmal weichgezeichnet, im Bild-Takt nur noch verschoben)
      const sc = neueLeinwand(b, h);
      const sg = sc.getContext("2d");
      sg.shadowColor = "rgba(0,0,0,0.6)";
      sg.shadowBlur = 0.012 * m;
      sg.shadowOffsetX = b * 3;
      sg.translate(-b * 3, 0);
      kapsel(sg, r);
      sg.fillStyle = "#000";
      sg.fill();
      return { c, schatten: sc, ax, ay };
    }

    // Stehendes Fallziel, Breite 0,028 (ragt aus der Bande), Höhe 0,132. Die Fläche zur Kugel ist rechts.
    fallzielSprite() {
      const m = this.m;
      const d = this.dpr;
      const b = Math.ceil(0.026 * m) + 1;
      const h = Math.ceil(0.132 * m);
      const c = neueLeinwand(b, h);
      const g = c.getContext("2d");
      const lg = g.createLinearGradient(0, 0, b, 0);
      lg.addColorStop(0, "#2A2558");
      lg.addColorStop(0.55, "#6C62BC");
      lg.addColorStop(1, "#9B90E4");
      g.fillStyle = lg;
      g.fillRect(0, 0, b, h);
      const og = g.createLinearGradient(0, 0, 0, h);
      og.addColorStop(0, "rgba(255,255,255,0.16)");
      og.addColorStop(0.2, "rgba(255,255,255,0)");
      og.addColorStop(0.85, "rgba(0,0,0,0)");
      og.addColorStop(1, "rgba(0,0,0,0.35)");
      g.fillStyle = og;
      g.fillRect(0, 0, b, h);
      g.fillStyle = "rgba(240,236,255,0.8)";
      g.fillRect(b - Math.max(1, d), 0, Math.max(1, d), h);
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(0, 0, b, Math.max(1, d));
      g.fillStyle = "rgba(6,5,20,0.6)";
      g.fillRect(0, h - Math.max(1, d), b, Math.max(1, d));
      return { c, b, h };
    }

    // Form einer Lampe als Pfad, in Gerätepixeln um (cx, cy)
    formPfad(g, l, cx, cy) {
      const m = this.m;
      g.beginPath();
      switch (l.form) {
        case "kreis":
        case "loch":
          g.arc(cx, cy, l.r * m, 0, TAU);
          break;
        case "ring":
          g.ellipse(cx, cy, l.rx * m, l.ry * m, 0, 0, TAU);
          break;
        case "pille": {
          const rx = l.rx * m;
          const ry = l.ry * m;
          rundrechteck(g, cx - rx, cy - ry, 2 * rx, 2 * ry, rx);
          break;
        }
        case "rechteck": {
          const b = l.b * m;
          const h = l.h * m;
          rundrechteck(g, cx - b / 2, cy - h / 2, b, h, h * 0.22);
          break;
        }
        case "raute":
          g.moveTo(cx, cy - l.ry * m);
          g.lineTo(cx + l.rx * m, cy);
          g.lineTo(cx, cy + l.ry * m);
          g.lineTo(cx - l.rx * m, cy);
          g.closePath();
          break;
        case "keil":
        case "pfeil": {
          const ux = Math.cos(l.winkel);
          const uy = -Math.sin(l.winkel);
          const nx = -uy;
          const ny = ux;
          const len = l.laenge * m;
          const w = l.breite * m;
          const P = (a, b) => [cx + ux * a + nx * b, cy + uy * a + ny * b];
          const punkte = l.form === "keil"
            ? [P(len / 2, 0), P(-len / 2, w / 2), P(-len / 2 + len * 0.2, 0), P(-len / 2, -w / 2)]
            : [P(len / 2, 0), P(len * 0.05, w / 2), P(len * 0.05, w * 0.2), P(-len / 2, w * 0.2), P(-len / 2, -w * 0.2), P(len * 0.05, -w * 0.2), P(len * 0.05, -w / 2)];
          punkte.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.closePath();
          break;
        }
      }
    }

    // Kleines Zeichen in einer Lampe (Blitz, Pfeil nach oben, Schild)
    zeichenPfad(g, art, cx, cy, r) {
      g.beginPath();
      if (art === "blitz") {
        const p = [[-0.18, -0.78], [0.38, -0.78], [0.06, -0.12], [0.42, -0.12], [-0.32, 0.86], [-0.06, 0.16], [-0.42, 0.16]];
        p.forEach(([x, y], i) => (i ? g.lineTo(cx + x * r, cy + y * r) : g.moveTo(cx + x * r, cy + y * r)));
        g.closePath();
      } else if (art === "hoch") {
        const p = [[0, -0.62], [0.55, 0.05], [0.28, 0.05], [0.28, 0.6], [-0.28, 0.6], [-0.28, 0.05], [-0.55, 0.05]];
        p.forEach(([x, y], i) => (i ? g.lineTo(cx + x * r, cy + y * r) : g.moveTo(cx + x * r, cy + y * r)));
        g.closePath();
      } else if (art === "schild") {
        g.moveTo(cx, cy - 0.62 * r);
        g.lineTo(cx + 0.5 * r, cy - 0.42 * r);
        g.quadraticCurveTo(cx + 0.5 * r, cy + 0.35 * r, cx, cy + 0.68 * r);
        g.quadraticCurveTo(cx - 0.5 * r, cy + 0.35 * r, cx - 0.5 * r, cy - 0.42 * r);
        g.closePath();
      }
    }

    schriftPx(einheiten) { return einheiten * this.m; }

    lampeSprite(l) {
      const m = this.m;
      const d = this.dpr;
      const cx = this.X(l.x);
      const cy = this.Y(l.y);
      const e = l.ausdehnung * m + 2 * d;
      let linse = null;
      let lx = 0;
      let ly = 0;
      if (l.form !== "loch") {
        lx = Math.floor(cx - e);
        ly = Math.floor(cy - e);
        linse = neueLeinwand(2 * e + 2, 2 * e + 2);
        const g = linse.getContext("2d");
        g.translate(-lx, -ly);
        this.lampeLinse(g, l, cx, cy);
      }
      let schein = null;
      let sx = 0;
      let sy = 0;
      if (l.schein) {
        const sr = l.ausdehnung * m * l.scheinRadius;
        sx = Math.floor(cx - sr);
        sy = Math.floor(cy - sr);
        schein = neueLeinwand(2 * sr + 2, 2 * sr + 2);
        const g = schein.getContext("2d");
        const mx = cx - sx;
        const my = cy - sy;
        let v;
        if (l.form === "loch") {
          const ri = l.r * m;
          v = g.createRadialGradient(mx, my, ri * 0.55, mx, my, sr);
          v.addColorStop(0, rgba(l.farbe, 0.3));
          v.addColorStop(0.25, rgba(l.farbe, 0.6));
          v.addColorStop(0.55, rgba(l.farbe, 0.2));
          v.addColorStop(1, rgba(l.farbe, 0));
        } else {
          v = g.createRadialGradient(mx, my, 0, mx, my, sr);
          v.addColorStop(0, rgba(l.farbe, 0.55));
          v.addColorStop(0.32, rgba(l.farbe, 0.24));
          v.addColorStop(0.7, rgba(l.farbe, 0.05));
          v.addColorStop(1, rgba(l.farbe, 0));
        }
        g.fillStyle = v;
        g.fillRect(0, 0, schein.width, schein.height);
      }
      // Farbenblind: heller Umriss mit schmaler Lücke um die Form, gezeigt nur im vollen Zustand (an, nächster Treffer,
      // geschafft). Halb und voll, an und aus unterscheiden sich damit in der Form, nicht nur in der Farbe.
      let umriss = null;
      let ux = 0;
      let uy = 0;
      if (this.pal.umriss && l.form !== "ring" && l.form !== "loch") {
        const luecke = Math.max(1 * d, 0.0028 * m);
        const breite = Math.max(1.3 * d, 0.0034 * m);
        const e2 = l.ausdehnung * m + luecke + breite + 3 * d;
        ux = Math.floor(cx - e2);
        uy = Math.floor(cy - e2);
        umriss = neueLeinwand(2 * e2 + 2, 2 * e2 + 2);
        const g = umriss.getContext("2d");
        g.translate(-ux, -uy);
        g.lineJoin = "round";
        this.formPfad(g, l, cx, cy);
        g.lineWidth = 2 * (luecke + breite);
        g.strokeStyle = this.pal.umrissFarbe;
        g.stroke();
        g.globalCompositeOperation = "destination-out";
        g.lineWidth = 2 * luecke;
        g.stroke();
        g.fill();
      }
      return { linse, x: lx, y: ly, schein, sx, sy, umriss, ux, uy };
    }

    // Hoher Kontrast (Abschnitt 7): zwei flache Fassungen je Lampe. „halb“ ist ein farbiger Umriss mit Schrift in der
    // Lampenfarbe, „voll“ eine deckende Fläche in der Lampenfarbe mit Schrift in der Gegenfarbe. Unbeleuchtet (gebacken)
    // ist nur ein dünner grauer Umriss. So unterscheidet man aus, halb und voll an Füllung und Umriss.
    lampeSpriteFlach(l) {
      const m = this.m;
      const d = this.dpr;
      const P = this.pal;
      const cx = this.X(l.x);
      const cy = this.Y(l.y);
      const lw = Math.max(2 * d, 0.0045 * m);
      const R = l.form === "loch" ? (l.r * 1.34 + 0.008) * m : 0;
      const e = (l.form === "loch" ? R + 2 * lw : l.ausdehnung * m + lw) + 3 * d;
      const x = Math.floor(cx - e);
      const y = Math.floor(cy - e);
      const leinwand = () => {
        const c = neueLeinwand(2 * e + 2, 2 * e + 2);
        const g = c.getContext("2d");
        g.translate(-x, -y);
        g.lineJoin = "round";
        g.strokeStyle = l.farbe;
        g.fillStyle = l.farbe;
        return { c, g };
      };
      const halb = leinwand();
      const voll = leinwand();
      if (l.form === "loch") {
        // Zündkammer hält eine Kugel: Ring um den Rand
        for (const [s, breite] of [[halb, lw], [voll, 1.25 * lw]]) {
          s.g.lineWidth = breite;
          s.g.beginPath();
          s.g.arc(cx, cy, R + breite / 2, 0, TAU);
          s.g.stroke();
        }
      } else if (l.form === "ring") {
        for (const [s, breite] of [[halb, lw], [voll, 2 * lw]]) {
          s.g.lineWidth = breite;
          this.formPfad(s.g, l, cx, cy);
          s.g.stroke();
        }
      } else {
        this.formPfad(halb.g, l, cx, cy);
        halb.g.lineWidth = lw;
        halb.g.stroke();
        this.lampenInhalt(halb.g, l, cx, cy, l.farbe);
        this.formPfad(voll.g, l, cx, cy);
        voll.g.fill();
        voll.g.lineWidth = lw;
        voll.g.stroke();
        this.lampenInhalt(voll.g, l, cx, cy, P.aufFarbe);
      }
      return { halb: halb.c, voll: voll.c, x, y };
    }

    // Inhalt einer Lampe: Buchstabe oder Ziffer, Zeichen (Blitz, Pfeil, Schild) und in den Sehhilfen das Zeichen der
    // Keile an der Zündkammer
    lampenInhalt(g, l, cx, cy, farbe) {
      const m = this.m;
      const d = this.dpr;
      g.fillStyle = farbe;
      if (l.text && this.schriftPx(l.textGroesse) >= 6 * d) {
        g.font = "600 " + Math.round(this.schriftPx(l.textGroesse)) + "px " + SCHRIFT_TITEL;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(l.text, cx, cy + this.schriftPx(l.textGroesse) * 0.06);
      }
      if (l.zeichen) {
        this.zeichenPfad(g, l.zeichen, cx, cy, (l.r || 0.02) * m * 0.78);
        g.fill();
      }
      if (l.sinn && this.pal.zeichen) this.sinnZeichen(g, l, cx, cy, farbe);
    }

    // Zeichen der Keile an der Zündkammer (Farbenblind und Hoher Kontrast): Plus für den Extraball, zwei Kugeln für den
    // Gewittersturm, Stern für den Jackpot, Ring für die Mission. Unabhängig von Farbe und Sprache; die Beschriftung neben
    // dem Keil fällt bei schmalen Tischen weg, das Zeichen bleibt. Beschnitten auf die Form des Keils.
    sinnZeichen(g, l, cx, cy, farbe) {
      const m = this.m;
      const d = this.dpr;
      const s = Math.min(l.laenge, l.breite) * m * 0.24;
      if (s < 2 * d) return;
      const ux = Math.cos(l.winkel);
      const uy = -Math.sin(l.winkel);
      const x = cx - ux * l.laenge * m * 0.06;
      const y = cy - uy * l.laenge * m * 0.06;
      g.save();
      this.formPfad(g, l, cx, cy);
      g.clip();
      g.fillStyle = farbe;
      g.strokeStyle = farbe;
      g.lineCap = "round";
      g.beginPath();
      if (l.sinn === "plus") {
        g.lineWidth = Math.max(1, s * 0.42);
        g.moveTo(x - s, y);
        g.lineTo(x + s, y);
        g.moveTo(x, y - s);
        g.lineTo(x, y + s);
        g.stroke();
      } else if (l.sinn === "zwei") {
        for (const o of [-0.58, 0.58]) {
          g.moveTo(x + o * s + s * 0.44, y);
          g.arc(x + o * s, y, s * 0.44, 0, TAU);
        }
        g.fill();
      } else if (l.sinn === "stern") {
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? s * 0.48 : s * 1.12;
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          if (i) g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        g.closePath();
        g.fill();
      } else if (l.sinn === "ring") {
        g.lineWidth = Math.max(1, s * 0.34);
        g.arc(x, y, s * 0.74, 0, TAU);
        g.stroke();
      }
      g.restore();
    }

    // Leuchtende Linse: Farbe der Lampe, zur Lichtquelle hin heller, Schrift dunkel darauf
    lampeLinse(g, l, cx, cy) {
      const m = this.m;
      const d = this.dpr;
      if (l.form === "ring") {
        // Farbenblind: der leuchtende Ring ist doppelt so dick wie der dunkle (Form statt nur Farbe)
        g.lineWidth = Math.max(1.4 * d, 0.0055 * m) * (this.pal.umriss ? 2 : 1);
        g.strokeStyle = rgba(l.farbe, 0.95);
        this.formPfad(g, l, cx, cy);
        g.stroke();
        return;
      }
      const e = l.ausdehnung * m;
      const v = g.createRadialGradient(cx + 0.22 * e, cy - 0.28 * e, 0, cx, cy, e * 1.1);
      v.addColorStop(0, mische(l.farbe, "#FFFFFF", 0.22));
      v.addColorStop(0.5, l.farbe);
      v.addColorStop(1, mische(l.farbe, "#1A1840", 0.42));
      g.fillStyle = v;
      this.formPfad(g, l, cx, cy);
      g.fill();
      g.lineWidth = Math.max(1, 0.8 * d);
      g.strokeStyle = mische(l.farbe, "#0F0F21", 0.55, 0.9);
      g.stroke();
      this.lampenInhalt(g, l, cx, cy, "rgba(14,13,34,0.82)");
    }

    // Beschriftung neben einer Lampe (Leiter der Zündkammer)
    etikettZeichnen(g, l, cx, cy, farbe) {
      const m = this.m;
      const d = this.dpr;
      const fs = this.schriftPx(0.0165);
      if (fs < 6 * d) return;
      const text = this.texte.t(l.etikett);
      g.font = "600 " + Math.round(fs) + "px " + this.texte.schriftText;
      if ("letterSpacing" in g) g.letterSpacing = Math.round(fs * 0.12) + "px";
      if ("direction" in g) g.direction = this.texte.richtung;
      g.fillStyle = farbe;
      g.textBaseline = "middle";
      // Längere Wörter anderer Sprachen werden schmaler gesetzt, statt in die Rang-Leiter zu laufen
      const maxB = 0.11 * m;
      if (l.etikettLage === "oben") {
        g.textAlign = "center";
        g.fillText(text, cx, cy - (l.ausdehnung + 0.024) * m, maxB);
      } else {
        g.textAlign = "left";
        g.fillText(text, cx + (l.ausdehnung + 0.012) * m, cy + 0.002 * m, maxB);
      }
      if ("letterSpacing" in g) g.letterSpacing = "0px";
      if ("direction" in g) g.direction = "ltr";
    }

    // Hoher Kontrast, unbeleuchtet: dünner Umriss im Randgrau, Schrift und Zeichen lesbar (leise Schriftfarbe, 12:1 und 14:1)
    lampeUnbeleuchtetFlach(g, l) {
      const P = this.pal;
      const cx = this.X(l.x);
      const cy = this.Y(l.y);
      if (l.form === "loch") return;
      g.lineWidth = Math.max(1, Math.round(this.dpr));
      g.lineJoin = "round";
      g.strokeStyle = P.rand;
      this.formPfad(g, l, cx, cy);
      g.stroke();
      if (l.form === "ring") return;
      this.lampenInhalt(g, l, cx, cy, P.leise);
      if (l.etikett) this.etikettZeichnen(g, l, cx, cy, P.leise);
    }

    // Unbeleuchtet: dunkler Kunststoff mit leichter Prägung (heller Rand rechts oben, Schatten links unten)
    lampeUnbeleuchtet(g, l) {
      const m = this.m;
      const d = this.dpr;
      const cx = this.X(l.x);
      const cy = this.Y(l.y);
      if (l.form === "loch") return;
      if (l.form === "ring") {
        g.lineWidth = Math.max(1, 0.9 * d);
        g.strokeStyle = rgba(l.farbe, 0.12);
        this.formPfad(g, l, cx, cy);
        g.stroke();
        return;
      }
      const grund = mische(l.farbe, "#0B0A20", 0.84);
      const o = Math.max(0.6, 0.7 * d);
      g.lineWidth = Math.max(1, 1.2 * d);
      g.save();
      g.translate(o, -o);
      this.formPfad(g, l, cx, cy);
      g.strokeStyle = "rgba(220,215,255,0.13)";
      g.stroke();
      g.translate(-2 * o, 2 * o);
      this.formPfad(g, l, cx, cy);
      g.strokeStyle = "rgba(0,0,0,0.55)";
      g.stroke();
      g.restore();
      this.formPfad(g, l, cx, cy);
      g.fillStyle = grund;
      g.fill();
      const e = l.ausdehnung * m;
      const v = g.createLinearGradient(cx + e, cy - e, cx - e, cy + e);
      v.addColorStop(0, rgba(l.farbe, 0.16));
      v.addColorStop(0.6, rgba(l.farbe, 0.03));
      v.addColorStop(1, "rgba(0,0,0,0.12)");
      g.fillStyle = v;
      g.fill();
      this.lampenInhalt(g, l, cx, cy, mische(l.farbe, "#0F0F21", 0.62, 0.8));
      if (l.etikett) this.etikettZeichnen(g, l, cx, cy, "rgba(183,185,220,0.36)");
    }

    // --- Gebackene Ebene ----------------------------------------------------------------------

    pfadBande(g) {
      const b = this.bauplan.bande;
      g.beginPath();
      b.forEach(([x, y], i) => (i ? g.lineTo(this.X(x), this.Y(y)) : g.moveTo(this.X(x), this.Y(y))));
      g.closePath();
    }

    wolke(g, x, y, r, farbe, a) {
      const v = g.createRadialGradient(x, y, 0, x, y, r);
      v.addColorStop(0, rgba(farbe, a));
      v.addColorStop(0.5, rgba(farbe, a * 0.45));
      v.addColorStop(1, rgba(farbe, 0));
      g.fillStyle = v;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }

    // Leichtes Rauschen (dreieckig verteilt, etwa ±1 Stufe) gegen Stufen in dunklen Verläufen, einmal je Backen
    dithern(g, W, H) {
      let bild;
      try { bild = g.getImageData(0, 0, W, H); } catch { return; }
      const p = bild.data;
      const z = zufallsquelle(0x9e3779b9);
      for (let i = 0; i < p.length; i += 4) {
        const n = (z() + z() - 1) * 1.15;
        p[i] += n;
        p[i + 1] += n;
        p[i + 2] += n;
      }
      g.putImageData(bild, 0, 0);
    }

    // Schatten erhabener Teile: Licht von rechts oben, Schatten nach links unten. Die Form wird
    // außerhalb der Leinwand gemalt, nur ihr Schatten landet auf dem Tisch (einmal beim Backen).
    mitSchatten(g, hoehe, unschaerfe, alpha, malen) {
      const m = this.m;
      const weit = this.statisch.width + 500;
      g.save();
      g.shadowColor = "rgba(0,0,0," + alpha + ")";
      g.shadowBlur = unschaerfe * m;
      g.shadowOffsetX = weit - hoehe * 0.8 * m;
      g.shadowOffsetY = hoehe * m;
      g.translate(-weit, 0);
      malen();
      g.restore();
    }

    kapselPfad(g, a, b, r) {
      g.lineCap = "round";
      g.lineWidth = 2 * r * this.m;
      g.beginPath();
      g.moveTo(this.X(a[0]), this.Y(a[1]));
      g.lineTo(this.X(b[0]), this.Y(b[1]));
    }

    // Metallschiene: Körper, hellere Seite zum Licht, helle Kante oben rechts, dunkle Kante links unten
    schiene(g, a, b, r) {
      const m = this.m;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      let nx = -dy / l;
      let ny = dx / l;
      if (nx + ny < 0) { nx = -nx; ny = -ny; }   // Normale zur Lichtquelle (rechts oben)
      const linie = (versatz, breite, farbe) => {
        g.lineCap = "round";
        g.lineWidth = breite * m;
        g.strokeStyle = farbe;
        g.beginPath();
        g.moveTo(this.X(a[0] + nx * versatz), this.Y(a[1] + ny * versatz));
        g.lineTo(this.X(b[0] + nx * versatz), this.Y(b[1] + ny * versatz));
        g.stroke();
      };
      linie(0, 2 * r, "#3E3A68");
      linie(r * 0.22, r * 1.25, "#6B66A0");
      linie(-r * 0.62, r * 0.42, "rgba(8,7,24,0.55)");
      linie(r * 0.5, Math.max(r * 0.34, 0.9 * this.dpr / m), "rgba(244,242,255,0.72)");
    }

    // Einweg-Klappe (Dach über den Outlanes, Tor der Rampe): Drahtbügel mit Ösen und einem kleinen
    // Pfeil in die Richtung, in der die Kugel hindurch darf.
    buegel(g, w) {
      const m = this.m;
      const d = this.dpr;
      const a = w.a;
      const b = w.b;
      const r = w.radius;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const lnx = -dy / l;   // links der Laufrichtung a → b
      const lny = dx / l;
      const draht = (versatz, farbe, breite) => {
        g.lineCap = "round";
        g.lineWidth = breite;
        g.strokeStyle = farbe;
        g.beginPath();
        g.moveTo(this.X(a[0] + lnx * versatz), this.Y(a[1] + lny * versatz));
        g.lineTo(this.X(b[0] + lnx * versatz), this.Y(b[1] + lny * versatz));
        g.stroke();
      };
      const dicke = Math.max(1.2 * d, r * 0.55 * m);
      for (const s of [-1, 1]) {
        draht(s * r * 0.55, "#2F2B55", dicke * 1.5);
        draht(s * r * 0.55, "#B9B4E2", dicke);
        draht(s * r * 0.55 + r * 0.12, "rgba(255,255,255,0.55)", Math.max(0.8 * d, dicke * 0.35));
      }
      // Ösen an den Enden
      for (const p of [a, b]) {
        g.beginPath();
        g.arc(this.X(p[0]), this.Y(p[1]), Math.max(2 * d, r * 1.05 * m), 0, TAU);
        g.fillStyle = "#24204A";
        g.fill();
        g.lineWidth = Math.max(1, 0.9 * d);
        g.strokeStyle = "#CFCAF0";
        g.stroke();
      }
      // Pfeil in Durchlassrichtung (zur gehaltenen Seite)
      const s = w.einweg || 1;
      const px = lnx * s;
      const py = lny * s;
      const mx = (a[0] + b[0]) / 2 + px * (r + 0.012);
      const my = (a[1] + b[1]) / 2 + py * (r + 0.012);
      const len = 0.016;
      const br = 0.011;
      const ux = dx / l;
      const uy = dy / l;
      g.beginPath();
      g.moveTo(this.X(mx + px * len * 0.6), this.Y(my + py * len * 0.6));
      g.lineTo(this.X(mx - px * len * 0.4 + ux * br), this.Y(my - py * len * 0.4 + uy * br));
      g.lineTo(this.X(mx - px * len * 0.1), this.Y(my - py * len * 0.1));
      g.lineTo(this.X(mx - px * len * 0.4 - ux * br), this.Y(my - py * len * 0.4 - uy * br));
      g.closePath();
      g.fillStyle = rgba(this.pal.lampe.eis, 0.62);
      g.fill();
    }

    pfosten(g, x, y, r) {
      const cx = this.X(x);
      const cy = this.Y(y);
      const R = r * this.m;
      const v = g.createLinearGradient(cx + R, cy - R, cx - R, cy + R);
      v.addColorStop(0, "#F2F0FF");
      v.addColorStop(0.35, "#A8A3D6");
      v.addColorStop(1, "#3C3868");
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.fillStyle = v;
      g.fill();
      g.lineWidth = Math.max(1, 0.7 * this.dpr);
      g.strokeStyle = "rgba(8,7,24,0.6)";
      g.stroke();
    }

    bumperMalen(g, b) {
      const m = this.m;
      const d = this.dpr;
      const cx = this.X(b.pos[0]);
      const cy = this.Y(b.pos[1]);
      const R = b.radius * m;
      // Sockel: an seinem Rand prallt die Kugel ab
      let v = g.createRadialGradient(cx + 0.3 * R, cy - 0.35 * R, 0.1 * R, cx, cy, R);
      v.addColorStop(0, "#3F3A80");
      v.addColorStop(0.75, "#2A265E");
      v.addColorStop(1, "#1A1840");
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.fillStyle = v;
      g.fill();
      g.lineWidth = Math.max(1, 1.1 * d);
      g.strokeStyle = "rgba(225,222,255,0.42)";
      g.beginPath();
      g.arc(cx, cy, R - g.lineWidth / 2, -Math.PI * 0.62, Math.PI * 0.12);
      g.stroke();
      g.strokeStyle = "rgba(5,4,16,0.6)";
      g.beginPath();
      g.arc(cx, cy, R - g.lineWidth / 2, Math.PI * 0.38, Math.PI * 1.12);
      g.stroke();
      // Seitenwand der Kappe
      g.beginPath();
      g.arc(cx - 0.02 * R, cy + 0.03 * R, 0.84 * R, 0, TAU);
      g.fillStyle = "#141230";
      g.fill();
      // Kappe aus Kunststoff
      v = g.createRadialGradient(cx + 0.28 * R, cy - 0.32 * R, 0.05 * R, cx, cy, 0.8 * R);
      v.addColorStop(0, "#6C64BA");
      v.addColorStop(0.5, "#3B357E");
      v.addColorStop(1, "#211E50");
      g.beginPath();
      g.arc(cx, cy, 0.77 * R, 0, TAU);
      g.fillStyle = v;
      g.fill();
      // Weißgold-Ring
      v = g.createLinearGradient(cx + 0.8 * R, cy - 0.8 * R, cx - 0.8 * R, cy + 0.8 * R);
      v.addColorStop(0, "#FFFCEE");
      v.addColorStop(0.3, "#F1E4BC");
      v.addColorStop(0.68, "#C4A964");
      v.addColorStop(1, "#7A6226");
      g.lineWidth = 0.085 * R;
      g.strokeStyle = v;
      g.beginPath();
      g.arc(cx, cy, 0.8 * R, 0, TAU);
      g.stroke();
      g.lineWidth = Math.max(1, 0.6 * d);
      g.strokeStyle = "rgba(85,62,12,0.65)";
      g.beginPath();
      g.arc(cx, cy, 0.8 * R + 0.0425 * R + g.lineWidth / 2, 0, TAU);
      g.stroke();
      // Zeichen: kleiner Blitz
      g.fillStyle = "rgba(175,161,255,0.5)";
      this.zeichenPfad(g, "blitz", cx, cy, 0.36 * R);
      g.fill();
      // Glanz
      g.save();
      g.translate(cx + 0.3 * R, cy - 0.36 * R);
      g.rotate(-0.6);
      g.scale(1, 0.5);
      v = g.createRadialGradient(0, 0, 0, 0, 0, 0.24 * R);
      v.addColorStop(0, "rgba(255,255,255,0.28)");
      v.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = v;
      g.beginPath();
      g.arc(0, 0, 0.24 * R, 0, TAU);
      g.fill();
      g.restore();
    }

    kammerMalen(g, l) {
      const m = this.m;
      const d = this.dpr;
      const cx = this.X(l.pos[0]);
      const cy = this.Y(l.pos[1]);
      const R = l.radius * m;
      const Rr = R * 1.34;
      // Metallrand
      let v = g.createLinearGradient(cx + Rr, cy - Rr, cx - Rr, cy + Rr);
      v.addColorStop(0, "#E4E0FA");
      v.addColorStop(0.4, "#8A86B8");
      v.addColorStop(1, "#2E2A58");
      g.beginPath();
      g.arc(cx, cy, Rr, 0, TAU);
      g.fillStyle = v;
      g.fill();
      // Loch mit Tiefe: rechts oben liegt der Rand im Schatten, links unten fällt Licht auf die Wand
      v = g.createLinearGradient(cx + R, cy - R, cx - R, cy + R);
      v.addColorStop(0, "#010104");
      v.addColorStop(0.55, "#07061A");
      v.addColorStop(1, "#1C1945");
      g.beginPath();
      g.arc(cx, cy, R * 1.04, 0, TAU);
      g.fillStyle = v;
      g.fill();
      v = g.createRadialGradient(cx + 0.12 * R, cy - 0.12 * R, 0, cx, cy, R * 0.8);
      v.addColorStop(0, "rgba(0,0,0,0.75)");
      v.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = v;
      g.fill();
      g.lineWidth = Math.max(1, 0.8 * d);
      g.strokeStyle = "rgba(4,3,14,0.85)";
      g.beginPath();
      g.arc(cx, cy, R * 1.04, 0, TAU);
      g.stroke();
      g.strokeStyle = "rgba(240,238,255,0.5)";
      g.beginPath();
      g.arc(cx, cy, Rr - g.lineWidth / 2, -Math.PI * 0.6, Math.PI * 0.05);
      g.stroke();
    }

    schleuderMalen(g, seite) {
      const sp = (p) => (seite ? [1 - p[0], p[1]] : p);
      const A = sp([0.26, 0.66]);
      const B = sp([0.26, 0.42]);
      const C = sp([0.34, 0.42]);
      const m = this.m;
      // Kunststoffkappe: das Dreieck, zur Mitte hin eingerückt
      const sx = (A[0] + B[0] + C[0]) / 3;
      const sy = (A[1] + B[1] + C[1]) / 3;
      const ein = (p) => [p[0] + (sx - p[0]) * 0.12, p[1] + (sy - p[1]) * 0.12];
      const ecken = [ein(A), ein(B), ein(C)];
      g.beginPath();
      ecken.forEach(([x, y], i) => (i ? g.lineTo(this.X(x), this.Y(y)) : g.moveTo(this.X(x), this.Y(y))));
      g.closePath();
      let v = g.createLinearGradient(this.X(sx + 0.06), this.Y(sy + 0.1), this.X(sx - 0.06), this.Y(sy - 0.1));
      v.addColorStop(0, "#5C52B4");
      v.addColorStop(0.5, "#3A3382");
      v.addColorStop(1, "#262058");
      g.fillStyle = v;
      g.fill();
      g.lineJoin = "round";
      g.lineWidth = Math.max(1, 0.9 * this.dpr);
      g.strokeStyle = "rgba(220,214,255,0.42)";
      g.stroke();
      // Kante der Kappe zur Lichtquelle (rechts oben) heller
      g.save();
      g.clip();
      g.lineWidth = Math.max(1.5, 0.004 * m);
      g.strokeStyle = "rgba(240,236,255,0.22)";
      const kante = seite ? ecken[1] : ecken[2];   // links die Schräge, rechts der Rücken zeigt zum Licht
      g.beginPath();
      g.moveTo(this.X(ecken[0][0]), this.Y(ecken[0][1]));
      g.lineTo(this.X(kante[0]), this.Y(kante[1]));
      g.stroke();
      g.restore();
      // kleines Blitzzeichen auf der Kappe
      g.fillStyle = "rgba(175,161,255,0.22)";
      this.zeichenPfad(g, "blitz", this.X(sx), this.Y(sy), 0.026 * m);
      g.fill();
      // Gummi an Rücken und Sohle (die Fläche zur Kugel zeichnet der Bild-Takt, sie federt)
      for (const [p, q] of [[A, B], [B, C]]) {
        this.kapselPfad(g, p, q, 0.01);
        g.strokeStyle = "#2A2448";
        g.stroke();
      }
      v = null;
    }

    standupMalen(g, w) {
      const m = this.m;
      const d = this.dpr;
      const y0 = Math.max(w.a[1], w.b[1]) - 0.004;
      const y1 = Math.min(w.a[1], w.b[1]) + 0.004;
      const x0 = this.X(w.a[0] - w.radius);
      const x1 = this.X(0.976);
      const top = this.Y(y0);
      const unten = this.Y(y1);
      const v = g.createLinearGradient(x0, 0, x1, 0);
      v.addColorStop(0, "#6FA9DA");
      v.addColorStop(0.45, "#3D6E9E");
      v.addColorStop(1, "#1C2F55");
      g.fillStyle = v;
      g.fillRect(x0, top, x1 - x0, unten - top);
      g.fillStyle = "rgba(240,248,255,0.7)";
      g.fillRect(x0, top, Math.max(1, d), unten - top);
      g.fillStyle = "rgba(255,255,255,0.3)";
      g.fillRect(x0, top, x1 - x0, Math.max(1, d));
      g.fillStyle = "rgba(4,6,20,0.55)";
      g.fillRect(x0, unten - Math.max(1, d), x1 - x0, Math.max(1, d));
      // Halter aus Weißgold oben und unten
      for (const y of [top + 0.006 * m, unten - 0.006 * m]) {
        g.fillStyle = "#C4A964";
        g.fillRect(x1 - 0.008 * m, y - 0.0025 * m, 0.008 * m, 0.005 * m);
      }
    }

    rollover(g, s) {
      const m = this.m;
      const d = this.dpr;
      const x0 = this.X(Math.min(s.a[0], s.b[0]));
      const x1 = this.X(Math.max(s.a[0], s.b[0]));
      const y = this.Y(s.a[1]);
      const h = 0.009 * m;
      g.beginPath();
      rundrechteck(g, x0, y - h / 2, x1 - x0, h, h / 2);
      g.fillStyle = "#07061A";
      g.fill();
      g.lineWidth = Math.max(1, 0.7 * d);
      g.strokeStyle = "rgba(200,195,255,0.12)";
      g.stroke();
      g.lineWidth = Math.max(1, 0.9 * d);
      g.strokeStyle = "rgba(225,222,255,0.6)";
      g.beginPath();
      g.moveTo(x0 + h * 0.6, y + h * 0.1);
      g.quadraticCurveTo((x0 + x1) / 2, y - h * 0.55, x1 - h * 0.6, y + h * 0.1);
      g.stroke();
    }

    bauplanLinien(g) {
      const bp = this.bauplan;
      const m = this.m;
      const d = this.dpr;
      g.save();
      g.lineWidth = Math.max(1, 0.8 * d);
      const kreuz = (x, y, s) => {
        g.strokeStyle = "rgba(175,161,255,0.16)";
        g.beginPath();
        g.moveTo(this.X(x - s), this.Y(y));
        g.lineTo(this.X(x + s), this.Y(y));
        g.moveTo(this.X(x), this.Y(y - s));
        g.lineTo(this.X(x), this.Y(y + s));
        g.stroke();
      };
      g.setLineDash([0.012 * m, 0.01 * m]);
      g.strokeStyle = "rgba(175,161,255,0.085)";
      for (const b of bp.bumper) {
        g.beginPath();
        g.arc(this.X(b.pos[0]), this.Y(b.pos[1]), (b.radius + 0.032) * m, 0, TAU);
        g.stroke();
      }
      for (const l of bp.loecher || []) {
        g.beginPath();
        g.arc(this.X(l.pos[0]), this.Y(l.pos[1]), (l.radius + 0.03) * m, 0, TAU);
        g.stroke();
      }
      // Schwenkbereich der Flipper
      for (const f of bp.flipper) {
        const links = f.maxDrehung > 0;
        const r = (f.laenge + f.radius) * m;
        g.beginPath();
        if (links) g.arc(this.X(f.pos[0]), this.Y(f.pos[1]), r, -0.5, 0.5);
        else g.arc(this.X(f.pos[0]), this.Y(f.pos[1]), r, Math.PI - 0.5, Math.PI + 0.5);
        g.stroke();
      }
      // Mittelachse zwischen den Flippern, vom Abfluss-Spalt bis an die Plakette
      g.setLineDash([0.02 * m, 0.012 * m]);
      g.strokeStyle = "rgba(175,161,255,0.07)";
      g.beginPath();
      g.moveTo(this.X(0.5), this.Y(0.2));
      g.lineTo(this.X(0.5), this.Y(PLAKETTE.y0 - 0.01));
      g.stroke();
      g.setLineDash([]);
      // Bemaßung des Abfluss-Spalts zwischen den Flipperspitzen in Ruhe (Kapseln, nicht die schmalere Zeichnung)
      const [fa, fb] = bp.flipper;
      if (fa && fb && this.schriftPx(0.0145) >= 6 * d) {
        const spitze = (f) => [f.pos[0] + Math.cos(f.ruheWinkel) * f.laenge, f.pos[1] + Math.sin(f.ruheWinkel) * f.laenge];
        const sa = spitze(fa);
        const sb = spitze(fb);
        const xa = sa[0] + fa.radius;
        const xb = sb[0] - fb.radius;
        const y = sa[1] + 0.058;
        g.strokeStyle = "rgba(175,161,255,0.15)";
        g.beginPath();
        for (const [x, s] of [[xa, sa], [xb, sb]]) {          // Hilfslinien von der Spitze nach oben
          g.moveTo(this.X(x), this.Y(s[1] + 0.012));
          g.lineTo(this.X(x), this.Y(y + 0.008));
        }
        g.moveTo(this.X(xa), this.Y(y));
        g.lineTo(this.X(xb), this.Y(y));
        g.stroke();
        g.fillStyle = "rgba(175,161,255,0.2)";
        for (const [x, r] of [[xa, 1], [xb, -1]]) {           // kleine Pfeilspitzen nach außen an die Hilfslinien
          g.beginPath();
          g.moveTo(this.X(x), this.Y(y));
          g.lineTo(this.X(x + r * 0.009), this.Y(y + 0.0035));
          g.lineTo(this.X(x + r * 0.009), this.Y(y - 0.0035));
          g.closePath();
          g.fill();
        }
        g.font = "500 " + Math.round(this.schriftPx(0.0145)) + "px " + SCHRIFT_TEXT;
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.fillStyle = "rgba(175,161,255,0.24)";
        g.fillText(this.texte.dezimal(+(xb - xa).toFixed(3), 3), this.X(0.5), this.Y(y + 0.005));
      }
      for (const l of bp.loecher || []) kreuz(l.pos[0], l.pos[1], 0.014);
      for (const f of bp.flipper) kreuz(f.pos[0], f.pos[1], 0.048);
      // Maßlinie über den Flippern: Abstand der Drehpunkte
      const [a, b] = bp.flipper;
      if (a && b && this.schriftPx(0.016) >= 6 * d) {
        const y = 0.092;
        g.strokeStyle = "rgba(175,161,255,0.13)";
        g.beginPath();
        g.moveTo(this.X(a.pos[0]), this.Y(y));
        g.lineTo(this.X(b.pos[0]), this.Y(y));
        for (const x of [a.pos[0], b.pos[0]]) {
          g.moveTo(this.X(x), this.Y(y - 0.008));
          g.lineTo(this.X(x), this.Y(y + 0.008));
        }
        g.stroke();
        g.font = "500 " + Math.round(this.schriftPx(0.0155)) + "px " + SCHRIFT_TEXT;
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.fillStyle = "rgba(175,161,255,0.22)";
        g.fillText(this.texte.dezimal(+(b.pos[0] - a.pos[0]).toFixed(2), 2), this.X(0.5), this.Y(y + 0.004));
      }
      g.restore();
    }

    // Plakette im Beschlag der Startseite (Abschnitt 4): gerundete Platte, Kappe im Verlauf des Claims, eckiger
    // Innenrahmen, vier Weißgold-Schrauben, Schatten nach links unten. Darauf „Kugelblitz“ in Fraunces, eine feine Linie
    // und die Fassung des Ballschutz-Inserts mit Beschriftung. Nur gebacken; die Kugel rollt darüber, keine Physik.
    plakette(g) {
      const m = this.m;
      const d = this.dpr;
      const P = PLAKETTE;
      const x0 = this.X(P.x0);
      const x1 = this.X(P.x1);
      const yo = this.Y(P.y1);
      const yu = this.Y(P.y0);
      const b = x1 - x0;
      const h = yu - yo;
      const r = Math.max(2 * d, 0.011 * m);
      const lw = Math.max(1, Math.round(d));
      this.mitSchatten(g, 0.005, 0.009, 0.6, () => {
        g.fillStyle = "#000";
        g.beginPath();
        rundrechteck(g, x0, yo, b, h, r);
        g.fill();
      });
      // Platte: Fläche der Startseite, zur Lichtquelle rechts oben eine Spur heller
      g.save();
      g.beginPath();
      rundrechteck(g, x0, yo, b, h, r);
      let v = g.createLinearGradient(x1, yo, x0, yu);
      v.addColorStop(0, "#26254F");
      v.addColorStop(0.5, "#1C1B3E");
      v.addColorStop(1, "#151432");
      g.fillStyle = v;
      g.fill();
      g.clip();
      const kappe = g.createLinearGradient(x0, 0, x1, 0);
      kappe.addColorStop(0, rgba(FARBE.violett, 0.8));
      kappe.addColorStop(0.5, rgba(FARBE.eis, 0.8));
      kappe.addColorStop(1, rgba(FARBE.lavendel, 0.8));
      g.fillStyle = kappe;
      g.fillRect(x0, yo, b, Math.max(1.5 * d, 0.0042 * m));
      g.restore();
      g.lineWidth = lw;
      g.beginPath();
      rundrechteck(g, x0 + lw / 2, yo + lw / 2, b - lw, h - lw, r);
      g.strokeStyle = FARBE.linie;
      g.stroke();
      // Kante zur Lichtquelle (oben rechts) hell, unten links dunkel
      g.save();
      g.beginPath();
      rundrechteck(g, x0, yo, b, h, r);
      g.clip();
      g.strokeStyle = "rgba(230,226,255,0.16)";
      g.beginPath();
      g.moveTo(x0 + r, yo + lw * 1.5);
      g.lineTo(x1 - lw * 1.5, yo + lw * 1.5);
      g.lineTo(x1 - lw * 1.5, yu - r);
      g.stroke();
      g.restore();
      // eckiger Innenrahmen und Schrauben
      const fi = Math.max(3 * d, 0.0066 * m);
      g.strokeStyle = "rgba(180,181,255,0.30)";
      g.lineWidth = lw;
      g.strokeRect(Math.round(x0 + fi) + lw / 2, Math.round(yo + fi) + lw / 2, Math.round(b - 2 * fi) - lw, Math.round(h - 2 * fi) - lw);
      if (this.schrauben) {
        const s = Math.max(4 * d, 0.0145 * m);
        const o = fi + Math.max(1.5 * d, 0.003 * m);
        [[x0 + o, yo + o], [x1 - o - s, yo + o], [x0 + o, yu - o - s], [x1 - o - s, yu - o - s]]
          .forEach(([sx, sy], i) => g.drawImage(this.schrauben[i], Math.round(sx), Math.round(sy), Math.round(s), Math.round(s)));
      }
      // Name in Fraunces, leicht eingeprägt (Schatten nach links unten)
      const nx = this.X(0.5);
      const ny = this.Y(P.nameY);
      g.font = "560 " + Math.round(this.schriftPx(0.0305)) + "px " + SCHRIFT_TITEL;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "rgba(4,3,16,0.75)";
      g.fillText("Kugelblitz", nx - 0.8 * d, ny + 0.8 * d);
      g.fillStyle = "#D8D2FF";
      g.fillText("Kugelblitz", nx, ny);
      // feine Linie mit einer kleinen Raute in der Mitte
      const ly = Math.round(this.Y(P.linieY)) + lw / 2;
      g.strokeStyle = "rgba(180,181,255,0.24)";
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(this.X(0.425), ly);
      g.lineTo(this.X(0.489), ly);
      g.moveTo(this.X(0.511), ly);
      g.lineTo(this.X(0.575), ly);
      g.stroke();
      const rs = Math.max(1.5 * d, 0.0055 * m);
      g.beginPath();
      g.moveTo(nx, ly - rs);
      g.lineTo(nx + rs, ly);
      g.lineTo(nx, ly + rs);
      g.lineTo(nx - rs, ly);
      g.closePath();
      g.fillStyle = "rgba(175,161,255,0.42)";
      g.fill();
      // Fassung des Ballschutz-Inserts: dünner Ring aus mattem Weißgold
      const schutz = this.lampen.find((l) => l.id === "schutz");
      if (schutz) {
        const lx = this.X(schutz.x);
        const lyy = this.Y(schutz.y);
        const ringBreite = Math.max(1, 0.0032 * m);
        const R = (schutz.r + 0.0048) * m;
        v = g.createLinearGradient(lx + R, lyy - R, lx - R, lyy + R);
        v.addColorStop(0, "#E9DDB8");
        v.addColorStop(0.4, "#C4A964");
        v.addColorStop(1, "#5E4A1C");
        g.lineWidth = ringBreite;
        g.strokeStyle = v;
        g.beginPath();
        g.arc(lx, lyy, R - ringBreite / 2, 0, TAU);
        g.stroke();
      }
      // Beschriftung unter dem Insert (der Zeichenabstand hängt auch hinter dem letzten Buchstaben: halb ausgleichen)
      const fe = this.schriftPx(0.0158);
      if (fe >= 6 * d) {
        g.font = "600 " + Math.round(fe) + "px " + this.texte.schriftText;
        const abstand = Math.round(fe * 0.14);
        if ("letterSpacing" in g) g.letterSpacing = abstand + "px";
        if ("direction" in g) g.direction = this.texte.richtung;
        g.fillStyle = "rgba(183,185,220,0.6)";
        g.fillText(this.texte.t("tisch_ballschutz"), nx + ("letterSpacing" in g ? abstand / 2 : 0), this.Y(P.etikettY), (P.x1 - P.x0 - 0.04) * m);
        if ("letterSpacing" in g) g.letterSpacing = "0px";
        if ("direction" in g) g.direction = "ltr";
      }
    }

    // Wände, die als Metallschiene gezeichnet werden (nicht Fallziele, Standups, Schleudern; Einwegwände sind Bügel)
    statischeWand(w) {
      return w.art !== "fallziel" && w.art !== "standup" && w.art !== "schleuder" && !String(w.name).startsWith("schleuder");
    }

    // Hoher Kontrast (Abschnitt 7): dieselben Teile an derselben Stelle, aber flach. Deckender Grund, Bande, Wände und
    // Schienen als volle Linien in ihrer echten Dicke, Bauteile als Umriss, Lampen unbeleuchtet als dünner Umriss mit
    // lesbarer Schrift. Keine Verläufe, kein Rauschen, keine Schatten, kein Raster, keine Bemaßung. Beschlag und
    // Schrauben bleiben, die Schrauben flach. Liest das Rauschen nicht und braucht keine Hilfsleinwand.
    backenFlach() {
      const bp = this.bauplan;
      const g = this.sctx;
      const L = this.lay;
      const d = this.dpr;
      const m = this.m;
      const P = this.pal;
      const W = this.statisch.width;
      const H = this.statisch.height;
      const X = (x) => this.X(x);
      const Y = (y) => this.Y(y);
      const lw = Math.max(1, Math.round(d));
      const umriss = Math.max(1.5 * d, 0.004 * m);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.fillStyle = P.grund;
      g.fillRect(0, 0, W, H);
      g.lineJoin = "round";
      g.lineCap = "round";

      // Plakette, Inserts, Rollover, Kickback-Platte
      this.plaketteFlach(g);
      for (const l of this.lampen) this.lampeUnbeleuchtetFlach(g, l);
      g.lineWidth = lw;
      g.strokeStyle = P.rand;
      for (const s of bp.sensoren) {
        if (s.art !== "inlane" && s.art !== "outlane") continue;
        const x0 = X(Math.min(s.a[0], s.b[0]));
        const x1 = X(Math.max(s.a[0], s.b[0]));
        const y = Y(s.a[1]);
        const h = 0.009 * m;
        g.beginPath();
        rundrechteck(g, x0, y - h / 2, x1 - x0, h, h / 2);
        g.stroke();
      }
      if (bp.kickback) {
        g.beginPath();
        rundrechteck(g, X(0.05), Y(0.228), X(0.115) - X(0.05), 0.02 * m, 2 * d);
        g.fillStyle = P.metall;
        g.fill();
      }

      // Bande (außen bündig mit der Stoßkante) und Schienen in ihrer echten Dicke
      g.strokeStyle = P.metall;
      const bande = bp.bande;
      for (let i = 0; i < bande.length; i++) {
        const p = bande[i];
        const q = bande[(i + 1) % bande.length];
        if (p[1] === 0 && q[1] === 0) continue;
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        const ax = (q[1] - p[1]) / l;
        const ay = -(q[0] - p[0]) / l;
        const rv = 0.008;
        this.kapselPfad(g, [p[0] + ax * rv, p[1] + ay * rv], [q[0] + ax * rv, q[1] + ay * rv], rv);
        g.stroke();
      }
      for (const w of bp.waende) {
        if (!this.statischeWand(w) || w.einweg) continue;
        this.kapselPfad(g, w.a, w.b, w.radius);
        g.stroke();
      }
      // Einweg-Klappen: zwei Drähte, Ösen, Pfeil in Durchlassrichtung
      for (const w of bp.waende) {
        if (!w.einweg) continue;
        const r = w.radius;
        const dx = w.b[0] - w.a[0];
        const dy = w.b[1] - w.a[1];
        const l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l;
        const ny = dx / l;
        g.lineWidth = Math.max(1.2 * d, r * 0.45 * m);
        g.strokeStyle = P.leise;
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(X(w.a[0] + nx * s * r * 0.55), Y(w.a[1] + ny * s * r * 0.55));
          g.lineTo(X(w.b[0] + nx * s * r * 0.55), Y(w.b[1] + ny * s * r * 0.55));
          g.stroke();
        }
        for (const p of [w.a, w.b]) {
          g.beginPath();
          g.arc(X(p[0]), Y(p[1]), Math.max(2 * d, r * 1.05 * m), 0, TAU);
          g.fillStyle = P.grund;
          g.fill();
          g.lineWidth = lw;
          g.stroke();
        }
        const e = w.einweg || 1;
        const px = nx * e;
        const py = ny * e;
        const mx = (w.a[0] + w.b[0]) / 2 + px * (r + 0.012);
        const my = (w.a[1] + w.b[1]) / 2 + py * (r + 0.012);
        const ux = dx / l;
        const uy = dy / l;
        g.beginPath();
        g.moveTo(X(mx + px * 0.016 * 0.6), Y(my + py * 0.016 * 0.6));
        g.lineTo(X(mx - px * 0.016 * 0.4 + ux * 0.011), Y(my - py * 0.016 * 0.4 + uy * 0.011));
        g.lineTo(X(mx - px * 0.016 * 0.1), Y(my - py * 0.016 * 0.1));
        g.lineTo(X(mx - px * 0.016 * 0.4 - ux * 0.011), Y(my - py * 0.016 * 0.4 - uy * 0.011));
        g.closePath();
        g.fillStyle = P.lampe.eis;
        g.fill();
      }

      // Schleudern: Kappe als Umriss, Gummi an Rücken und Sohle, Blitz, Pfosten
      for (const seite of [0, 1]) {
        const sp = (p) => (seite ? [1 - p[0], p[1]] : p);
        const A = sp([0.26, 0.66]);
        const B = sp([0.26, 0.42]);
        const C = sp([0.34, 0.42]);
        const sx = (A[0] + B[0] + C[0]) / 3;
        const sy = (A[1] + B[1] + C[1]) / 3;
        const ein = (p) => [p[0] + (sx - p[0]) * 0.12, p[1] + (sy - p[1]) * 0.12];
        g.beginPath();
        [ein(A), ein(B), ein(C)].forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
        g.closePath();
        g.lineWidth = lw;
        g.strokeStyle = P.rand;
        g.stroke();
        g.fillStyle = P.lampe.lavendel;
        this.zeichenPfad(g, "blitz", X(sx), Y(sy), 0.026 * m);
        g.fill();
        g.strokeStyle = P.metall;
        for (const [p, q] of [[A, B], [B, C]]) {
          this.kapselPfad(g, p, q, 0.01);
          g.stroke();
        }
      }
      const pfosten = (x, y, r) => {
        g.beginPath();
        g.arc(X(x), Y(y), r * m, 0, TAU);
        g.fillStyle = P.metall;
        g.fill();
      };
      for (const seite of [0, 1]) {
        for (const p of [[0.26, 0.66], [0.26, 0.42], [0.34, 0.42]]) pfosten(seite ? 1 - p[0] : p[0], p[1], 0.0105);
      }
      for (const w of bp.waende) {
        if (String(w.name).startsWith("fuehrung") && String(w.name).endsWith("aussen")) pfosten(w.a[0], w.a[1], 0.0115);
      }

      // Bumper: Rand in Schriftfarbe, Ring der Kappe in Weißgold, Blitz in Lavendel
      for (const b of bp.bumper) {
        const cx = X(b.pos[0]);
        const cy = Y(b.pos[1]);
        const R = b.radius * m;
        g.beginPath();
        g.arc(cx, cy, R - umriss / 2, 0, TAU);
        g.lineWidth = umriss;
        g.strokeStyle = P.text;
        g.stroke();
        g.beginPath();
        g.arc(cx, cy, 0.8 * R, 0, TAU);
        g.lineWidth = Math.max(1.5 * d, 0.085 * R);
        g.strokeStyle = P.schraube.koerper;
        g.stroke();
        g.fillStyle = P.lampe.lavendel;
        this.zeichenPfad(g, "blitz", cx, cy, 0.36 * R);
        g.fill();
      }
      // Zündkammer: Rand und Loch als Umriss
      for (const l of bp.loecher || []) {
        const cx = X(l.pos[0]);
        const cy = Y(l.pos[1]);
        const R = l.radius * m;
        g.beginPath();
        g.arc(cx, cy, R * 1.34 - umriss / 2, 0, TAU);
        g.lineWidth = umriss;
        g.strokeStyle = P.text;
        g.stroke();
        g.beginPath();
        g.arc(cx, cy, R * 1.04, 0, TAU);
        g.lineWidth = lw;
        g.strokeStyle = P.rand;
        g.stroke();
      }
      // Standups: volle Fläche in Eisblau mit Rand, Halter in Weißgold
      for (const w of bp.waende) {
        if (w.art !== "standup") continue;
        const x0 = X(w.a[0] - w.radius);
        const x1 = X(0.976);
        const top = Y(Math.max(w.a[1], w.b[1]) - 0.004);
        const unten = Y(Math.min(w.a[1], w.b[1]) + 0.004);
        g.fillStyle = P.lampe.eis;
        g.fillRect(x0, top, x1 - x0, unten - top);
        g.lineWidth = lw;
        g.strokeStyle = P.text;
        g.strokeRect(x0 + lw / 2, top + lw / 2, x1 - x0 - lw, unten - top - lw);
        g.fillStyle = P.schraube.koerper;
        for (const y of [top + 0.006 * m, unten - 0.006 * m]) g.fillRect(x1 - 0.008 * m, y - 0.0025 * m, 0.008 * m, 0.005 * m);
      }

      // Rampe: Gehäuse des Abzugs und Skala der Ladung mit den Zonen des Skill Shots
      const rx0 = X(1.019);
      const rx1 = X(1.056);
      g.lineWidth = lw;
      g.strokeStyle = P.rand;
      g.strokeRect(rx0 + lw / 2, Y(0.05), rx1 - rx0 - lw, 0.05 * m + L.rand * d * 0.6);
      const sk = this.skala();
      g.beginPath();
      rundrechteck(g, sk.x, sk.y0, sk.b, sk.y1 - sk.y0, sk.b / 2);
      g.stroke();
      g.fillStyle = P.rand;
      for (const [von, bis] of [[0.35, 0.41], [0.42, 0.47], [0.48, 0.56]]) g.fillRect(sk.x - 2.5 * d, sk.zuY(bis), 1.5 * d, sk.zuY(von) - sk.zuY(bis));

      // Beschlag der Platte: eckiger Rahmen, vier Schrauben, Fenster des Spruchbands
      const fi = L.fi * d;
      g.strokeStyle = P.rand;
      g.lineWidth = lw;
      g.strokeRect(Math.round(fi) + lw / 2, Math.round(fi) + lw / 2, W - 2 * Math.round(fi) - lw, H - 2 * Math.round(fi) - lw);
      const bx = L.bandX * d;
      const by = L.bandY * d;
      const bw = L.bandB * d;
      const bh = L.band * d;
      g.beginPath();
      rundrechteck(g, bx - lw / 2, by - lw / 2, bw + lw, bh + lw, 4 * d);
      g.fillStyle = P.grund;
      g.fill();
      g.stroke();
      const s = L.s * d;
      const off = (L.fi + L.so) * d;
      [[off, off], [W - off - s, off], [off, H - off - s], [W - off - s, H - off - s]]
        .forEach(([x, y], i) => this.schraubeFlach(g, Math.round(x), Math.round(y), Math.round(s), SCHRAUBEN_WINKEL[i]));
    }

    // Plakette im Hohen Kontrast: Platte mit Rand, Kappe in Akzentfarbe, eckiger Innenrahmen, flache Schrauben, Name in
    // Schriftfarbe ohne Prägung, Linie mit Raute, Fassung des Ballschutzes in Weißgold, Beschriftung leise
    plaketteFlach(g) {
      const m = this.m;
      const d = this.dpr;
      const P = this.pal;
      const Q = PLAKETTE;
      const x0 = this.X(Q.x0);
      const x1 = this.X(Q.x1);
      const yo = this.Y(Q.y1);
      const yu = this.Y(Q.y0);
      const b = x1 - x0;
      const h = yu - yo;
      const r = Math.max(2 * d, 0.011 * m);
      const lw = Math.max(1, Math.round(d));
      g.save();
      g.beginPath();
      rundrechteck(g, x0, yo, b, h, r);
      g.fillStyle = P.grund;
      g.fill();
      g.clip();
      g.fillStyle = P.akzent;
      g.fillRect(x0, yo, b, Math.max(1.5 * d, 0.0042 * m));
      g.restore();
      g.lineWidth = lw;
      g.strokeStyle = P.rand;
      g.beginPath();
      rundrechteck(g, x0 + lw / 2, yo + lw / 2, b - lw, h - lw, r);
      g.stroke();
      const fi = Math.max(3 * d, 0.0066 * m);
      g.strokeRect(Math.round(x0 + fi) + lw / 2, Math.round(yo + fi) + lw / 2, Math.round(b - 2 * fi) - lw, Math.round(h - 2 * fi) - lw);
      const s = Math.max(4 * d, 0.0145 * m);
      const o = fi + Math.max(1.5 * d, 0.003 * m);
      [[x0 + o, yo + o], [x1 - o - s, yo + o], [x0 + o, yu - o - s], [x1 - o - s, yu - o - s]]
        .forEach(([sx, sy], i) => this.schraubeFlach(g, Math.round(sx), Math.round(sy), Math.round(s), SCHRAUBEN_WINKEL[i]));
      const nx = this.X(0.5);
      const ny = this.Y(Q.nameY);
      g.font = "560 " + Math.round(this.schriftPx(0.0305)) + "px " + SCHRIFT_TITEL;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = P.text;
      g.fillText("Kugelblitz", nx, ny);
      const ly = Math.round(this.Y(Q.linieY)) + lw / 2;
      g.strokeStyle = P.rand;
      g.beginPath();
      g.moveTo(this.X(0.425), ly);
      g.lineTo(this.X(0.489), ly);
      g.moveTo(this.X(0.511), ly);
      g.lineTo(this.X(0.575), ly);
      g.stroke();
      const rs = Math.max(1.5 * d, 0.0055 * m);
      g.beginPath();
      g.moveTo(nx, ly - rs);
      g.lineTo(nx + rs, ly);
      g.lineTo(nx, ly + rs);
      g.lineTo(nx - rs, ly);
      g.closePath();
      g.fillStyle = P.leise;
      g.fill();
      const schutz = this.lampen.find((l) => l.id === "schutz");
      if (schutz) {
        const ringBreite = Math.max(1, 0.0032 * m);
        g.lineWidth = ringBreite;
        g.strokeStyle = P.schraube.koerper;
        g.beginPath();
        g.arc(this.X(schutz.x), this.Y(schutz.y), (schutz.r + 0.0048) * m - ringBreite / 2, 0, TAU);
        g.stroke();
      }
      const fe = this.schriftPx(0.0158);
      if (fe >= 6 * d) {
        g.font = "600 " + Math.round(fe) + "px " + this.texte.schriftText;
        const abstand = Math.round(fe * 0.14);
        if ("letterSpacing" in g) g.letterSpacing = abstand + "px";
        if ("direction" in g) g.direction = this.texte.richtung;
        g.fillStyle = P.leise;
        g.fillText(this.texte.t("tisch_ballschutz"), nx + ("letterSpacing" in g ? abstand / 2 : 0), this.Y(Q.etikettY), (Q.x1 - Q.x0 - 0.04) * m);
        if ("letterSpacing" in g) g.letterSpacing = "0px";
        if ("direction" in g) g.direction = "ltr";
      }
    }

    backen() {
      if (!this.lay) return;
      if (this.pal.flach) { this.backenFlach(); return; }
      const bp = this.bauplan;
      const g = this.sctx;
      const L = this.lay;
      const d = this.dpr;
      const m = this.m;
      const W = this.statisch.width;
      const H = this.statisch.height;
      const X = (x) => this.X(x);
      const Y = (y) => this.Y(y);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, W, H);
      // Verläufe und Rauschen entstehen auf einer frischen Hilfsleinwand, die nur einmal gelesen wird
      const ziel = g;
      const hilfe = neueLeinwand(W, H);
      let v;
      {
      const g = hilfe.getContext("2d", { willReadFrequently: true });

      // 1. Platte: Fläche der Startseite, zur Lichtquelle rechts oben eine Spur heller
      v = g.createLinearGradient(W, 0, 0, H);
      v.addColorStop(0, "#1E1D3D");
      v.addColorStop(0.5, "#181831");
      v.addColorStop(1, "#121128");
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);

      // 2. Spielfeld: tiefes Violettblau mit leichtem Verlauf, dazu ein Hauch der Aurora-Farben
      g.save();
      this.pfadBande(g);
      g.clip();
      v = g.createRadialGradient(X(0.56), Y(1.02), 0, X(0.56), Y(1.02), 1.12 * m);
      v.addColorStop(0, "#1C1B4B");
      v.addColorStop(0.5, "#16153F");
      v.addColorStop(1, "#0E0D29");
      g.fillStyle = v;
      g.fillRect(X(0), Y(HOEHE), BREITE * m, HOEHE * m);
      this.wolke(g, X(0.92), Y(1.5), 0.6 * m, FARBE.aurora[2], 0.1);
      this.wolke(g, X(0.12), Y(0.5), 0.55 * m, FARBE.aurora[3], 0.07);
      this.wolke(g, X(0.42), Y(1.12), 0.5 * m, FARBE.aurora[0], 0.09);
      // Abfluss: dunkle Rinne
      const a = bp.abfluss;
      v = g.createLinearGradient(0, Y(a.yMax), 0, Y(0));
      v.addColorStop(0, "#0A0920");
      v.addColorStop(1, "#030308");
      g.fillStyle = v;
      g.fillRect(X(a.xMin), Y(a.yMax), (a.xMax - a.xMin) * m, a.yMax * m);
      // Rampe: etwas tiefer liegende Bahn
      v = g.createLinearGradient(X(0.995), 0, X(1.08), 0);
      v.addColorStop(0, "rgba(4,4,14,0.45)");
      v.addColorStop(0.5, "rgba(4,4,14,0.25)");
      v.addColorStop(1, "rgba(4,4,14,0.5)");
      g.fillStyle = v;
      g.fillRect(X(0.995), Y(1.4), 0.085 * m, (1.4 - 0.05) * m);
      g.restore();

      // 3. Rauschen gegen Stufen (einmal, nicht im Bild-Takt)
      this.dithern(g, W, H);
      }
      ziel.drawImage(hilfe, 0, 0);
      hilfe.width = 1;
      hilfe.height = 1;

      // 4. Raster, ganz leise, nach unten ausklingend
      g.save();
      this.pfadBande(g);
      g.clip();
      const lw = Math.max(1, Math.round(0.8 * d));
      const senk = (alpha) => {
        const s = g.createLinearGradient(0, Y(HOEHE), 0, Y(0));
        s.addColorStop(0, "rgba(165,165,255," + alpha + ")");
        s.addColorStop(0.55, "rgba(165,165,255," + alpha * 0.8 + ")");
        s.addColorStop(1, "rgba(165,165,255," + alpha * 0.25 + ")");
        return s;
      };
      const fein = senk(0.032);
      const grob = senk(0.062);
      for (let i = 0; i <= 22; i++) {
        const x = Math.round(X(i * 0.05)) + lw / 2;
        g.fillStyle = i % 5 === 0 ? grob : fein;
        g.fillRect(x - lw / 2, Y(HOEHE), lw, HOEHE * m);
      }
      for (let i = 0; i <= 34; i++) {
        const y = i * 0.05;
        const yy = Math.round(Y(y));
        const t = y / HOEHE;
        const alpha = (i % 5 === 0 ? 0.062 : 0.032) * (0.25 + 0.75 * Math.min(1, t / 0.55));
        g.fillStyle = "rgba(165,165,255," + alpha.toFixed(4) + ")";
        g.fillRect(X(0), yy, BREITE * m, lw);
      }
      this.bauplanLinien(g);
      g.restore();

      // 4b. Plakette zwischen den Schleudern: Name des Tisches und Fassung des Ballschutzes (Abschnitt 4; der
      // eingravierte Schriftzug oben links ist dafür weg, er war zu dunkel, um gelesen zu werden)
      this.plakette(g);

      // 5. Inserts, unbeleuchtet
      for (const l of this.lampen) this.lampeUnbeleuchtet(g, l);

      // 6. Rollover, Kickback-Platte, Fuß der Rampe
      for (const s of bp.sensoren) {
        if (s.art === "inlane" || s.art === "outlane") this.rollover(g, s);
      }
      if (bp.kickback) {
        const kx0 = X(0.05);
        const kx1 = X(0.115);
        const ky = Y(0.228);
        const kh = 0.02 * m;
        v = g.createLinearGradient(kx1, ky, kx0, ky + kh);
        v.addColorStop(0, "#CFCAF0");
        v.addColorStop(0.5, "#6E69A2");
        v.addColorStop(1, "#2B2754");
        g.beginPath();
        rundrechteck(g, kx0, ky, kx1 - kx0, kh, 2 * d);
        g.fillStyle = v;
        g.fill();
        g.strokeStyle = "rgba(6,5,20,0.7)";
        g.lineWidth = Math.max(1, 0.7 * d);
        g.stroke();
      }

      // 7. Schatten aller erhabenen Teile, nach links unten
      const statischeWand = (w) => w.art !== "fallziel" && w.art !== "standup" && w.art !== "schleuder" &&
        !String(w.name).startsWith("schleuder");
      this.mitSchatten(g, 0.007, 0.006, 0.55, () => {
        g.strokeStyle = "#000";
        for (const w of bp.waende) {
          if (!statischeWand(w) || w.einweg) continue;
          this.kapselPfad(g, w.a, w.b, w.radius);
          g.stroke();
        }
        // Bande: rechte und obere Wände werfen Schatten aufs Feld
        g.lineWidth = 0.016 * m;
        g.lineJoin = "round";
        this.pfadBande(g);
        g.stroke();
      });
      this.mitSchatten(g, 0.004, 0.004, 0.45, () => {
        g.strokeStyle = "#000";
        for (const w of bp.waende) {
          if (!w.einweg) continue;
          this.kapselPfad(g, w.a, w.b, w.radius * 0.8);
          g.stroke();
        }
      });
      this.mitSchatten(g, 0.012, 0.012, 0.6, () => {
        g.fillStyle = "#000";
        for (const b of bp.bumper) {
          g.beginPath();
          g.arc(X(b.pos[0]), Y(b.pos[1]), b.radius * m, 0, TAU);
          g.fill();
        }
        for (const seite of [0, 1]) {
          const sp = (p) => (seite ? [1 - p[0], p[1]] : p);
          g.beginPath();
          [[0.26, 0.66], [0.26, 0.42], [0.34, 0.42]].map(sp).forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
          g.closePath();
          g.lineWidth = 0.022 * m;
          g.lineJoin = "round";
          g.strokeStyle = "#000";
          g.stroke();
          g.fill();
        }
      });
      this.mitSchatten(g, 0.006, 0.006, 0.5, () => {
        g.fillStyle = "#000";
        for (const w of bp.waende) {
          if (w.art !== "standup") continue;
          g.fillRect(X(w.a[0] - w.radius), Y(Math.max(w.a[1], w.b[1])), 0.025 * m, 0.132 * m);
        }
        for (const l of bp.loecher || []) {
          g.beginPath();
          g.arc(X(l.pos[0]), Y(l.pos[1]), l.radius * 1.34 * m, 0, TAU);
          g.fill();
        }
      });

      // 8. Bande als Metallschiene am Rand des Spielfelds (außen bündig mit der Stoßkante)
      const bande = bp.bande;
      for (let i = 0; i < bande.length; i++) {
        const p = bande[i];
        const q = bande[(i + 1) % bande.length];
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const l = Math.hypot(dx, dy) || 1;
        const ax = dy / l;   // nach außen (das Polygon läuft gegen den Uhrzeigersinn)
        const ay = -dx / l;
        const rv = 0.008;
        if (p[1] === 0 && q[1] === 0) continue;   // Boden: liegt im Abfluss, keine Schiene
        this.schiene(g, [p[0] + ax * rv, p[1] + ay * rv], [q[0] + ax * rv, q[1] + ay * rv], rv);
      }
      // Schienen: Trennwand, Führungen, Rinne mit Anschlag
      for (const w of bp.waende) {
        if (!statischeWand(w) || w.einweg) continue;
        this.schiene(g, w.a, w.b, w.radius);
      }
      for (const w of bp.waende) if (w.einweg) this.buegel(g, w);

      // 9. Schleudern mit Kappe, Gummi und Pfosten
      for (const seite of [0, 1]) this.schleuderMalen(g, seite);
      for (const seite of [0, 1]) {
        for (const p of [[0.26, 0.66], [0.26, 0.42], [0.34, 0.42]]) this.pfosten(g, seite ? 1 - p[0] : p[0], p[1], 0.0105);
      }
      // Pfosten an den Kappen der Führungen
      for (const w of bp.waende) {
        if (String(w.name).startsWith("fuehrung") && String(w.name).endsWith("aussen")) this.pfosten(g, w.a[0], w.a[1], 0.0115);
      }

      // 10. Bumper, 11. Zündkammer, 12. Standups und Schlitze der Fallziele
      for (const b of bp.bumper) this.bumperMalen(g, b);
      for (const l of bp.loecher || []) this.kammerMalen(g, l);
      for (const w of bp.waende) if (w.art === "standup") this.standupMalen(g, w);

      // 13. Rampe: Gehäuse des Abzugs und Skala der Ladung (Zonen der drei Gassen beim Skill Shot)
      const rx0 = X(1.019);
      const rx1 = X(1.056);
      g.fillStyle = "#07061A";
      g.fillRect(rx0, Y(0.05), rx1 - rx0, 0.05 * m + L.rand * d * 0.6);
      g.fillStyle = "rgba(200,195,255,0.18)";
      g.fillRect(rx0, Y(0.05), Math.max(1, d), 0.05 * m + L.rand * d * 0.6);
      g.fillRect(rx1 - Math.max(1, d), Y(0.05), Math.max(1, d), 0.05 * m + L.rand * d * 0.6);
      const sk = this.skala();
      g.beginPath();
      rundrechteck(g, sk.x, sk.y0, sk.b, sk.y1 - sk.y0, sk.b / 2);
      g.fillStyle = "#08071C";
      g.fill();
      g.lineWidth = Math.max(1, 0.7 * d);
      g.strokeStyle = "rgba(180,181,255,0.22)";
      g.stroke();
      for (const [von, bis] of [[0.35, 0.41], [0.42, 0.47], [0.48, 0.56]]) {
        g.fillStyle = rgba(this.pal.lampe.lavendel, 0.22);
        g.fillRect(sk.x - 2.5 * d, sk.zuY(bis), 1.5 * d, sk.zuY(von) - sk.zuY(bis));
      }

      // 14. Beschlag der Platte: eckiger Rahmen, vier Schrauben, Fenster des Spruchbands
      const fi = L.fi * d;
      const lwr = Math.max(1, Math.round(d));
      g.strokeStyle = "rgba(180,181,255,0.30)";
      g.lineWidth = lwr;
      g.strokeRect(Math.round(fi) + lwr / 2, Math.round(fi) + lwr / 2, W - 2 * Math.round(fi) - lwr, H - 2 * Math.round(fi) - lwr);
      // Fenster: vertieft, die Kante rechts oben wirft Schatten hinein
      const bx = L.bandX * d;
      const by = L.bandY * d;
      const bw = L.bandB * d;
      const bh = L.band * d;
      g.beginPath();
      rundrechteck(g, bx, by, bw, bh, 4 * d);
      g.fillStyle = "#0A0A1B";
      g.fill();
      g.save();
      g.clip();
      v = g.createLinearGradient(bx + bw, by, bx + bw - 0.3 * bh, by + 0.6 * bh);
      v.addColorStop(0, "rgba(0,0,0,0.55)");
      v.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = v;
      g.fillRect(bx, by, bw, bh);
      v = g.createLinearGradient(0, by, 0, by + bh * 0.35);
      v.addColorStop(0, "rgba(0,0,0,0.5)");
      v.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = v;
      g.fillRect(bx, by, bw, bh);
      g.fillStyle = "rgba(180,181,255,0.10)";
      g.fillRect(bx, by + bh - lwr, bw, lwr);
      g.fillRect(bx, by, lwr, bh);
      g.restore();
      g.beginPath();
      rundrechteck(g, bx - lwr / 2, by - lwr / 2, bw + lwr, bh + lwr, 4 * d);
      g.lineWidth = lwr;
      g.strokeStyle = FARBE.linie;
      g.stroke();
      if (this.schrauben) {
        const s = L.s * d;
        const off = (L.fi + L.so) * d;
        const lagen = [[off, off], [W - off - s, off], [off, H - off - s], [W - off - s, H - off - s]];
        lagen.forEach(([x, y], i) => g.drawImage(this.schrauben[i], Math.round(x), Math.round(y), Math.round(s), Math.round(s)));
      }
    }

    skala() {
      const d = this.dpr;
      const x = this.X(1.0835);
      const b = Math.max(3 * d, 0.0105 * this.m);
      const y1 = this.Y(0.1);
      const y0 = this.Y(0.62);
      const zuY = (ladung) => y1 - (y1 - y0) * ladung;
      return { x, b, y0, y1, zuY };
    }

    // --- Bild-Takt -----------------------------------------------------------------------------

    zeichne(tisch, z, ui) {
      if (!this.lay) return;
      const t0 = performance.now();
      const echt = t0 / 1000;
      const uhr = ui.uhr;
      // Blenden rechnen höchstens 1/30 s je Bild: nach einem Hänger oder der Rückkehr aus dem Hintergrund läuft eine
      // Blende einfach weiter, statt in einem Bild ans Ende zu springen
      const dt = this.letzteUhr === null ? 0 : klemme(uhr - this.letzteUhr, 0, ZEIT.dtMax);
      this.letzteUhr = uhr;
      const dtEcht = this.letzteEcht === null ? 0 : klemme(echt - this.letzteEcht, 0, ZEIT.dtMax);
      this.letzteEcht = echt;
      this.band.uhr += dtEcht;

      // Reihenfolge der Lichter: erst die Zustandslampen, dann Spuren, dann Treffer-Scheine (Vorrang und Budget)
      this.bildEreignis = false;
      this.lampenSchritt(z, tisch, uhr, dt);
      this.spurenStarten(uhr);
      this.scheineStarten(uhr);
      this.scheineSchritt(uhr, dt);
      this.fallzieleSchritt(tisch, dt);
      for (let i = 0; i < 2; i++) this.schleuder[i] *= Math.exp(-dt / 0.05);

      const g = this.ctx;
      const st = this.lichtstaerke;
      const alpha = tisch.anteil();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.drawImage(this.statisch, 0, 0);

      this.zeichneFallziele(g, tisch);
      this.zeichneLampen(g, st);
      this.zeichneScheine(g, tisch, st);
      this.zeichneSchleuderGummi(g);
      this.zeichneLadung(g, ui.ladung || 0);
      this.zeichneKoerper(g, tisch, alpha, echt, st);
      this.zeichneSpuren(g, uhr);
      this.zeichneBand(g, ui.band, this.band.uhr);
      this.zeichneTafel(g, ui, dtEcht);

      this.zeitMerken(performance.now() - t0);
    }

    zeichneFallziele(g, tisch) {
      const sp = this.sp.fallziel;
      if (!sp) return;
      const m = this.m;
      for (const w of tisch.waende) {
        if (w.art !== "fallziel") continue;
        const s = this.fallziele.has(w.name) ? this.fallziele.get(w.name) : (w.aktiv ? 1 : 0);
        const oben = this.Y(Math.max(w.a.y, w.b.y) - 0.004);
        const x0 = this.X(0.02);
        if (this.pal.flach) {
          // Schlitz in der Bande: Grund mit Umriss, damit man die Stelle eines versunkenen Ziels sieht
          const lw = Math.max(1, Math.round(this.dpr));
          g.fillStyle = this.pal.grund;
          g.fillRect(x0, oben, 0.009 * m, sp.h);
          g.lineWidth = lw;
          g.strokeStyle = this.pal.rand;
          g.strokeRect(x0 + lw / 2, oben + lw / 2, 0.009 * m - lw, sp.h - lw);
        } else {
          g.fillStyle = "#05051A";
          g.fillRect(x0, oben, 0.009 * m, sp.h);
        }
        if (s <= 0.002) continue;
        if (this.wenigBewegung) {
          g.globalAlpha = s;
          g.drawImage(sp.c, x0, oben);
          g.globalAlpha = 1;
        } else {
          const e = weich(s);
          const sichtbar = Math.max(1, Math.round(sp.b * (0.25 + 0.75 * e)));
          g.globalAlpha = 0.35 + 0.65 * e;
          g.drawImage(sp.c, sp.b - sichtbar, 0, sichtbar, sp.h, x0, oben, sichtbar, sp.h);
          g.globalAlpha = 1;
        }
      }
    }

    zeichneLampen(g, st) {
      const P = this.pal;
      if (P.flach) {
        // Hoher Kontrast: erst der farbige Umriss (bis halb), dann die volle Fläche (von halb bis voll). Ein Wert von 0,5
        // zeigt also nur den Umriss, 1 die Fläche. Die Lichtstärke gilt hier nicht: Hoher Kontrast verspricht 7:1, und
        // eine gedimmte Fläche hielte das nicht (Abschnitt 7).
        for (const l of this.lampen) {
          if (l.wert < 0.004 || !l.sprite) continue;
          const a1 = klemme(2 * l.wert, 0, 1);
          const a2 = klemme(2 * l.wert - 1, 0, 1);
          g.globalAlpha = a1;
          g.drawImage(l.sprite.halb, l.sprite.x, l.sprite.y);
          if (a2 > 0.002) {
            g.globalAlpha = a2;
            g.drawImage(l.sprite.voll, l.sprite.x, l.sprite.y);
          }
        }
        g.globalAlpha = 1;
        return;
      }
      for (const l of this.lampen) {
        if (l.wert < 0.004 || !l.sprite || !l.sprite.linse) continue;
        g.globalAlpha = l.wert * st * STAERKE.linse * (P.linse ?? 1);
        g.drawImage(l.sprite.linse, l.sprite.x, l.sprite.y);
      }
      // Farbenblind: Umriss im vollen Zustand (bei 0,5 noch keiner), auch bei wenig Lichtstärke gut zu sehen
      if (P.umriss) {
        for (const l of this.lampen) {
          if (!l.sprite || !l.sprite.umriss) continue;
          const a = klemme(2 * l.wert - 1, 0, 1);
          if (a < 0.004) continue;
          g.globalAlpha = a * Math.max(0.6, st);
          g.drawImage(l.sprite.umriss, l.sprite.ux, l.sprite.uy);
        }
      }
      // Schein um die Lampen (lighter); bei Umkehr nur noch um die Zündkammer und schwach
      const kammerSchein = P.kammerSchein ?? P.lampenSchein;
      if (P.lampenSchein > 0 || kammerSchein > 0) {
        g.globalCompositeOperation = "lighter";
        for (const l of this.lampen) {
          if (l.wert < 0.004 || !l.sprite || !l.sprite.schein) continue;
          const f = l.form === "loch" ? kammerSchein * STAERKE.kammerSchein : P.lampenSchein * STAERKE.lampenSchein;
          if (!(f > 0)) continue;
          g.globalAlpha = l.wert * st * f;
          g.drawImage(l.sprite.schein, l.sprite.sx, l.sprite.sy);
        }
      }
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }

    zeichneScheine(g, tisch, st) {
      const sp = this.sp;
      // Hoher Kontrast kennt keinen Schein (Treffer zeigen dort Kugel und Gummi), bei Umkehr sind sie schwächer
      if (!(this.pal.schein > 0)) return;
      st *= this.pal.schein;
      g.globalCompositeOperation = "lighter";
      tisch.bumper.forEach((b, i) => {
        const w = this.scheinWert("bumper" + i);
        if (w < 0.004) return;
        const x = this.X(b.pos.x);
        const y = this.Y(b.pos.y);
        g.globalAlpha = w * st * STAERKE.bumperSchein;
        g.drawImage(sp.bumperSchein.c, Math.round(x - sp.bumperSchein.h), Math.round(y - sp.bumperSchein.h));
        g.globalAlpha = w * st * STAERKE.kappenSchein;
        g.drawImage(sp.kappenSchein.c, Math.round(x - sp.kappenSchein.h), Math.round(y - sp.kappenSchein.h));
      });
      for (let s = 0; s < 2; s++) {
        const w = this.scheinWert("schleuder" + s);
        if (w < 0.004) continue;
        // vor der Fläche, auf dem dunklen Spielfeld (nicht auf der Kappe)
        const x = this.X(s ? 1 - 0.319 : 0.319);
        const y = this.Y(0.546);
        g.globalAlpha = w * st * STAERKE.schleuderSchein;
        g.drawImage(sp.schleuderSchein.c, Math.round(x - sp.schleuderSchein.h), Math.round(y - sp.schleuderSchein.h));
      }
      for (let i = 0; i < 3; i++) {
        const w = this.scheinWert("standup" + i);
        if (w < 0.004) continue;
        const x = this.X(0.951);
        const y = this.Y(0.87 + 0.14 * i);
        g.globalAlpha = w * st * STAERKE.standupSchein;
        g.drawImage(sp.standupSchein.c, Math.round(x - sp.standupSchein.h), Math.round(y - sp.standupSchein.h));
      }
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }

    // Gummi an der Fläche der Schleuder; nach einem Tritt federt er kurz ein (nicht bei weniger Bewegung)
    zeichneSchleuderGummi(g) {
      const m = this.m;
      for (let s = 0; s < 2; s++) {
        const sp = (p) => (s ? [1 - p[0], p[1]] : p);
        const A = sp([0.26, 0.66]);
        const C = sp([0.34, 0.42]);
        const dx = C[0] - A[0];
        const dy = C[1] - A[1];
        const l = Math.hypot(dx, dy);
        const ux = dx / l;
        const uy = dy / l;
        let nx = -uy;
        let ny = ux;
        // Normale zur Kappe hin (ins Dreieck)
        const mx = (A[0] + C[0]) / 2;
        const my = (A[1] + C[1]) / 2;
        const zx = (A[0] + C[0] + sp([0.26, 0.42])[0]) / 3;
        const zy = (A[1] + C[1] + 0.42) / 3;
        if ((zx - mx) * nx + (zy - my) * ny < 0) { nx = -nx; ny = -ny; }
        const biegen = this.schleuder[s] * 0.007;
        const k = 0.0075;
        const p0 = [A[0] + ux * k, A[1] + uy * k];
        const p1 = [C[0] - ux * k, C[1] - uy * k];
        const q = [mx + nx * biegen, my + ny * biegen];
        const kurve = (versatz, breite, farbe) => {
          g.lineWidth = breite;
          g.strokeStyle = farbe;
          g.lineCap = "butt";
          g.beginPath();
          g.moveTo(this.X(p0[0] - nx * versatz), this.Y(p0[1] - ny * versatz));
          g.quadraticCurveTo(this.X(q[0] - nx * versatz), this.Y(q[1] - ny * versatz), this.X(p1[0] - nx * versatz), this.Y(p1[1] - ny * versatz));
          g.stroke();
        };
        if (this.pal.flach) {
          kurve(0, Math.max(2 * this.dpr, 0.0065 * m), this.pal.text);
        } else {
          kurve(0, 0.02 * m, "#2A2448");
          kurve(0.0042, Math.max(1, 0.003 * m), "rgba(205,200,255,0.34)");
        }
      }
    }

    zeichneLadung(g, ladung) {
      const sk = this.skala();
      const d = this.dpr;
      const m = this.m;
      const P = this.pal;
      if (ladung > 0.001) {
        const y = sk.zuY(ladung);
        g.globalAlpha = P.flach ? 1 : 0.82;
        g.fillStyle = P.lampe.eis;
        g.beginPath();
        rundrechteck(g, sk.x + d, y, sk.b - 2 * d, sk.y1 - y - d, (sk.b - 2 * d) / 2);
        g.fill();
        g.globalAlpha = 1;
      }
      // Zielzone des Skill Shots auf der Skala (folgt der geglätteten Marke)
      const zonen = [[0.48, 0.56], [0.42, 0.47], [0.35, 0.41]];   // L, A, D
      for (let i = 0; i < 3; i++) {
        const l = this.lampen.find((x) => x.id === "marke" + i);
        if (!l || l.wert < 0.01) continue;
        const [von, bis] = zonen[i];
        g.globalAlpha = l.wert * (P.flach ? 1 : this.lichtstaerke);
        g.fillStyle = P.lampe.lavendel;
        g.fillRect(sk.x - 2.5 * d, sk.zuY(bis), (P.flach ? 2 : 1.5) * d, sk.zuY(von) - sk.zuY(bis));
        g.globalAlpha = 1;
      }
      // Abzug: Stange mit Feder, der Kopf aus Weißgold sinkt mit der Ladung
      const x0 = this.X(1.0225);
      const x1 = this.X(1.0525);
      const kopf = this.Y(0.05 - 0.034 * ladung);
      const boden = this.Y(-0.02);
      if (P.flach) {
        g.fillStyle = P.metall;
        g.fillRect((x0 + x1) / 2 - 0.004 * m, kopf, 0.008 * m, boden - kopf);
        g.strokeStyle = P.leise;
        g.lineWidth = Math.max(1, Math.round(d));
        g.beginPath();
        const fh = (boden - kopf - 0.012 * m) / 5;
        for (let i = 0; i <= 5; i++) {
          const y = kopf + 0.012 * m + i * fh;
          g.moveTo(x0 + 0.004 * m, y);
          g.lineTo(x1 - 0.004 * m, y + fh * 0.5);
        }
        g.stroke();
        g.fillStyle = P.schraube.koerper;
        g.fillRect(x0, kopf, x1 - x0, 0.011 * m);
        return;
      }
      g.fillStyle = "#2A2650";
      g.fillRect((x0 + x1) / 2 - 0.004 * m, kopf, 0.008 * m, boden - kopf);
      g.strokeStyle = "rgba(190,184,235,0.55)";
      g.lineWidth = Math.max(1, 0.8 * d);
      g.beginPath();
      const windungen = 5;
      const fh = (boden - kopf - 0.012 * m) / windungen;
      for (let i = 0; i <= windungen; i++) {
        const y = kopf + 0.012 * m + i * fh;
        g.moveTo(x0 + 0.004 * m, y);
        g.lineTo(x1 - 0.004 * m, y + fh * 0.5);
      }
      g.stroke();
      g.fillStyle = "#E7D9AE";
      g.fillRect(x0, kopf, x1 - x0, 0.011 * m);
      g.fillStyle = "rgba(255,255,255,0.6)";
      g.fillRect(x0, kopf, x1 - x0, Math.max(1, d));
      g.fillStyle = "rgba(80,58,10,0.7)";
      g.fillRect(x0, kopf + 0.011 * m - Math.max(1, d), x1 - x0, Math.max(1, d));
    }

    zeichneKoerper(g, tisch, alpha, echt, st) {
      const sp = this.sp;
      const m = this.m;
      const zw = (a, b) => a + (b - a) * alpha;
      const schatten = 0.014 * m;
      const flach = this.pal.flach;      // Hoher Kontrast: keine Schatten, keine Spur
      // Schatten der Flipper
      for (const f of tisch.flipper) {
        const s = sp["flipper" + (f.vorzeichen < 0 ? 1 : 0)];
        if (!s || !s.schatten) continue;
        const w = f.winkel(zw(f.drehungTaktStart, f.drehung));
        g.save();
        g.translate(this.X(f.pos.x) - schatten * 0.55, this.Y(f.pos.y) + schatten * 0.7);
        g.rotate(-w);
        if (f.vorzeichen < 0) g.scale(1, -1);
        g.globalAlpha = 0.85;
        g.drawImage(s.schatten, -s.ax, -s.ay);
        g.restore();
      }
      // Kugeln: Lage zwischen zwei Takten
      const kugeln = tisch.kugeln;
      const lage = [];
      for (const k of kugeln) {
        lage.push({ k, x: this.X(zw(k.taktStart.x, k.pos.x)), y: this.Y(zw(k.taktStart.y, k.pos.y)) });
      }
      // Schatten der Kugeln
      g.globalAlpha = 1;
      for (const p of lage) {
        if (p.k.gehalten || flach) continue;
        const s = sp.kugelSchatten;
        g.drawImage(s.c, p.x - s.h - 0.011 * m, p.y - s.h + 0.014 * m);
      }
      // Spur: wenige verblassende Punkte entlang der letzten 0,11 s (nicht bei weniger Bewegung, nicht im Hohen Kontrast)
      if (!this.wenigBewegung && !flach) {
        g.globalCompositeOperation = "lighter";
        for (const p of lage) this.spurZeichnen(g, p, echt, st);
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = 1;
      }
      // Flipper
      tisch.flipper.forEach((f) => {
        const s = sp["flipper" + (f.vorzeichen < 0 ? 1 : 0)];
        if (!s) return;
        const w = f.winkel(zw(f.drehungTaktStart, f.drehung));
        g.save();
        g.translate(this.X(f.pos.x), this.Y(f.pos.y));
        g.rotate(-w);
        if (f.vorzeichen < 0) g.scale(1, -1);
        g.drawImage(s.c, -s.ax, -s.ay);
        g.restore();
      });
      // Kugeln
      for (const p of lage) {
        const s = p.k.probe ? sp.probe : sp.kugel;
        if (p.k.gehalten) {
          const f = 0.86;
          g.drawImage(s.c, p.x - s.h * f, p.y - s.h * f, s.c.width * f, s.c.height * f);
          const ls = sp.lochSchatten;
          if (ls) g.drawImage(ls.c, p.x - ls.h * f, p.y - ls.h * f, ls.c.width * f, ls.c.height * f);
        } else {
          g.drawImage(s.c, p.x - s.h, p.y - s.h);
        }
      }
      // Drehpunkte: Weißgold-Schrauben
      if (sp.schrauben) {
        tisch.flipper.forEach((f, i) => {
          const s = sp.schrauben[i === 0 ? 0 : 1];
          g.drawImage(s.c, Math.round(this.X(f.pos.x) - s.h), Math.round(this.Y(f.pos.y) - s.h));
        });
      }
    }

    spurZeichnen(g, p, echt, st) {
      let v = this.verlauf.get(p.k);
      if (!v) { v = []; this.verlauf.set(p.k, v); }
      const letzte = v[v.length - 1];
      if (letzte && Math.hypot(letzte.x - p.x, letzte.y - p.y) > 0.18 * this.m) v.length = 0;   // Sprung: neu anfangen
      v.push({ t: echt, x: p.x, y: p.y });
      while (v.length > 2 && echt - v[1].t > ZEIT.spur + 0.02) v.shift();
      if (p.k.gehalten || p.k.probe || v.length < 2) return;
      const sp = this.sp.spur;
      const schritte = 6;
      let j = v.length - 1;
      for (let i = 1; i <= schritte; i++) {
        const zt = echt - (ZEIT.spur * i) / schritte;
        while (j > 0 && v[j - 1].t > zt) j--;
        if (j === 0) break;
        const a = v[j - 1];
        const b = v[j];
        const f = b.t > a.t ? (zt - a.t) / (b.t - a.t) : 0;
        const x = a.x + (b.x - a.x) * f;
        const y = a.y + (b.y - a.y) * f;
        if (Math.hypot(x - p.x, y - p.y) < 0.012 * this.m) continue;   // ruhende Kugel: keine Spur
        g.globalAlpha = STAERKE.spur * st * (1 - i / (schritte + 1));
        g.drawImage(sp.c, x - sp.h, y - sp.h);
      }
    }

    zeichneSpuren(g, uhr) {
      if (!this.spuren.length) return;
      const d = this.dpr;
      g.lineWidth = Math.max(1.5 * d, 0.005 * this.m);
      g.strokeStyle = this.pal.flach ? this.pal.lampe.lavendel : this.wenigBewegung ? "#8B77A3" : "#B699C1";
      for (const s of this.spuren) {
        const alter = uhr - s.t;
        if (alter > 2.5 || alter < 0) continue;
        g.globalAlpha = Math.min(1, alter / 0.25) * (1 - alter / 2.5) * 0.8;
        g.beginPath();
        g.arc(this.X(s.x), this.Y(s.y), 0.05 * this.m, 0, TAU);
        g.stroke();
      }
      g.globalAlpha = 1;
      this.spuren = this.spuren.filter((s) => uhr - s.t <= 2.5);
    }

    // --- Spruchband --------------------------------------------------------------------------
    // Eine Zeile steht mindestens ZEIT.bandHalten, dann blendet sie aus und die neueste ein.
    // Innerhalb derselben Meldung (gleicher Schlüssel) ändern sich Zahlen an Ort und Stelle.

    bandSchritt(neu, echt) {
      const b = this.band;
      if (!neu) return;
      if (!b.zeige) { b.zeige = { ...neu }; b.modus = "ein"; b.seit = echt; b.alpha = 0; return; }
      if (neu.schluessel === b.zeige.schluessel) {
        // Dieselbe Zeile mit neuer Zahl (Bonus zählt hoch, Stand der Mission): höchstens alle ZEIT.bandZahl, dann weich
        // übergeblendet. Was dazwischen kommt, wird verworfen; gezeigt wird immer der neueste Stand.
        const anders = neu.haupt !== b.zeige.haupt || neu.neben !== b.zeige.neben;
        if (anders && (b.modus !== "steht" || echt - b.zahlSeit >= ZEIT.bandZahl)) {
          if (b.modus === "steht") { b.alt = { haupt: b.zeige.haupt, neben: b.zeige.neben }; b.zahlSeit = echt; }
          b.zeige.haupt = neu.haupt;
          b.zeige.neben = neu.neben;
        }
        b.zeige.fortschritt = neu.fortschritt;
        b.zeige.art = neu.art;
        b.zeige.marke = neu.marke;
        b.naechstes = null;
        if (b.modus === "aus") { b.modus = "ein"; b.seit = echt - b.alpha * ZEIT.bandBlende; }
      } else {
        b.naechstes = { ...neu };
      }
      if (b.naechstes && b.modus === "steht" && echt - b.seit >= (this.pal.bandHalten ?? ZEIT.bandHalten)) {
        if (this.pal.bandUeberblenden) {
          // Helle Darstellungen (Hoher Kontrast, Umkehr): alte und neue Zeile blenden ineinander, ohne leeres Band dazwischen.
          // Dunkle Schrift auf hellem Grund wiegt im L-Meter schwer; aus, leer, ein wären zwei gegenläufige Wechsel in 0,44 s.
          b.alt = { haupt: b.zeige.haupt, neben: b.zeige.neben };
          b.zahlSeit = echt;
          b.zeige = b.naechstes;
          b.naechstes = null;
          b.seit = echt;
        } else { b.modus = "aus"; b.seit = echt; }
      }
      if (b.modus === "aus") {
        b.alpha = 1 - (echt - b.seit) / ZEIT.bandBlende;
        if (b.alpha <= 0) {
          b.zeige = b.naechstes || b.zeige;
          b.naechstes = null;
          b.modus = "ein";
          b.seit = echt;
          b.alpha = 0;
        }
      } else if (b.modus === "ein") {
        b.alpha = (echt - b.seit) / ZEIT.bandBlende;
        if (b.alpha >= 1) { b.alpha = 1; b.modus = "steht"; b.seit = echt; }
      }
    }

    // Für die Bildschirmleser: was das Band gerade zeigt (nur neue Meldungen ansagen)
    bandText() { return this.band.zeige ? this.band.zeige : null; }

    textBreite(g, schrift, text) {
      const schl = schrift + "|" + text;
      let b = this.textBreiten.get(schl);
      if (b === undefined) {
        g.font = schrift;
        b = g.measureText(text).width;
        if (this.textBreiten.size > 300) this.textBreiten.clear();
        this.textBreiten.set(schl, b);
      }
      return b;
    }

    zeichneBand(g, inhalt, echt) {
      this.bandSchritt(inhalt, echt);
      const b = this.band;
      const z = b.zeige;
      if (!z) return;
      const L = this.lay;
      const d = this.dpr;
      const bx = L.bandX * d;
      const by = L.bandY * d;
      const bw = L.bandB * d;
      const bh = L.band * d;
      const rand = 12 * d;
      const a = klemme(b.alpha, 0, 1);
      const P = this.pal;
      // Im Hohen Kontrast ohne „lighter“: alte und neue Zahl blenden normal über (im Hellen ließe „lighter“ schwarze
      // Schrift auf Weiß verschwinden)
      const plus = P.flach ? "source-over" : "lighter";
      g.save();
      g.beginPath();
      g.rect(bx, by, bw, bh);
      g.clip();
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      if ("direction" in g) g.direction = this.texte.richtung;
      const platz = bw - 2 * rand;
      const titelKette = z.marke ? SCHRIFT_TITEL : this.texte.schriftTitel;
      // Hauptzeile: erst kleiner (bis 26 % der Bandhöhe), passt sie dann noch nicht, zwei Zeilen über die ganze Höhe
      // (die Nebenzeile fällt dafür weg). Nie abgeschnitten. Liefert, ob sie zweizeilig steht.
      const hauptLage = (text) => {
        const schl = "lage|" + titelKette + "|" + Math.round(bh) + "|" + Math.round(platz) + "|" + text;
        let lage = this.textBreiten.get(schl);
        if (lage) return lage;
        const fs0 = bh * 0.37;
        const schrift0 = "560 " + Math.round(fs0) + "px " + titelKette;
        const b0 = this.textBreite(g, schrift0, text);
        const einzeilig = fs0 * platz / b0;
        if (b0 <= platz) lage = { zeilen: [text], fs: fs0, y: [0.49] };
        else if (einzeilig >= bh * 0.26) lage = { zeilen: [text], fs: einzeilig, y: [0.49] };
        else {
          // zweizeilig nur, wenn die Schrift dadurch größer wird als einzeilig
          const zw = this.zweiZeilen(text, (t) => this.textBreite(g, schrift0, t));
          const zweizeilig = zw ? Math.min(bh * 0.3, fs0 * platz / zw.w) : 0;
          lage = zweizeilig > einzeilig ? { zeilen: zw.zeilen, fs: zweizeilig, y: [0.43, 0.8] } : { zeilen: [text], fs: einzeilig, y: [0.49] };
        }
        if (this.textBreiten.size > 300) this.textBreiten.clear();
        this.textBreiten.set(schl, lage);
        return lage;
      };
      const hauptZeile = (text, alpha) => {
        const lage = hauptLage(text || "");
        g.globalAlpha = alpha;
        g.font = "560 " + Math.round(lage.fs) + "px " + titelKette;
        g.fillStyle = this.bandFarbe(z.art);
        lage.zeilen.forEach((zeile, i) => g.fillText(zeile, bx + bw / 2, by + bh * lage.y[i]));
        return lage.zeilen.length > 1;
      };
      const nebenZeile = (text, alpha) => {
        if (!text) return;
        let fs2 = Math.max(9 * d, bh * 0.205);
        let s2 = "400 " + Math.round(fs2) + "px " + this.texte.schriftText;
        const b2 = this.textBreite(g, s2, text);
        if (b2 > platz) {
          // kleiner bis 8 px, und wenn das nicht reicht, noch kleiner statt abgeschnitten
          fs2 = fs2 * platz / b2;
          s2 = "400 " + Math.max(1, Math.floor(fs2)) + "px " + this.texte.schriftText;
        }
        g.globalAlpha = alpha;
        g.font = s2;
        g.fillStyle = P.flach ? P.leise : "rgba(183,185,220,0.9)";
        g.fillText(text, bx + bw / 2, by + bh * 0.82);
      };
      const zweizeilig = (text) => hauptLage(text || "").zeilen.length > 1;
      // Neue Zahl in derselben Zeile: alte und neue Fassung addiert überblenden (lighter), so bleiben gleiche Zeichen
      // ruhig stehen und nur die geänderten Ziffern blenden weich
      const f = b.alt ? (echt - b.zahlSeit) / ZEIT.bandZahlBlende : 1;
      if (f >= 1) b.alt = null;
      if (b.alt && f < 1) {
        g.globalCompositeOperation = plus;
        if (b.alt.haupt !== z.haupt) { hauptZeile(b.alt.haupt, a * (1 - f)); hauptZeile(z.haupt, a * f); } else { g.globalCompositeOperation = "source-over"; hauptZeile(z.haupt, a); g.globalCompositeOperation = plus; }
        const altNeben = zweizeilig(b.alt.haupt) ? "" : b.alt.neben;
        const neuNeben = zweizeilig(z.haupt) ? "" : z.neben;
        if (altNeben !== neuNeben) { nebenZeile(altNeben, a * (1 - f)); nebenZeile(neuNeben, a * f); } else { g.globalCompositeOperation = "source-over"; nebenZeile(neuNeben, a); }
        g.globalCompositeOperation = "source-over";
      } else {
        const zwei = hauptZeile(z.haupt, a);
        if (!zwei) nebenZeile(z.neben, a);
      }
      if ("direction" in g) g.direction = "ltr";
      // Fortschritt der Mission als feine Linie am unteren Rand
      const ziel = z.fortschritt >= 0 ? z.fortschritt : 0;
      b.fortschritt = annaehern(b.fortschritt, ziel, echt - (b.letzt ?? echt), 0.09);   // gleich schnell bei 60 bis 240 Hz
      b.letzt = echt;
      // Im Hohen Kontrast deckend: erst die ganze Strecke als dünne Linie im Randgrau, darüber der Stand in Lavendel
      if (z.fortschritt >= 0 && P.flach) {
        g.globalAlpha = a;
        g.fillStyle = P.rand;
        g.fillRect(bx + rand, by + bh - 3 * d, bw - 2 * rand, Math.max(1, 0.75 * d));
      }
      if (z.fortschritt >= 0 && b.fortschritt > 0.002) {
        g.globalAlpha = a * (P.flach ? 1 : 0.75);
        g.fillStyle = P.lampe.lavendel;
        g.fillRect(bx + rand, by + bh - 3 * d, (bw - 2 * rand) * Math.min(1, b.fortschritt), Math.max(1, (P.flach ? 2 : 1.5) * d));
      }
      if (z.fortschritt >= 0 && !P.flach) {
        g.globalAlpha = a * 0.25;
        g.fillStyle = FARBE.akzent;
        g.fillRect(bx + rand, by + bh - 3 * d, bw - 2 * rand, Math.max(1, 0.75 * d));
      }
      g.restore();
    }

    bandFarbe(art) {
      const P = this.pal;
      if (P.flach) {
        if (art === "skill" || art === "jackpot" || art === "extraball" || art === "multiball") return P.lampe.eis;
        if (art === "mission" || art === "rang") return P.lampe.lavendel;
        if (art === "warnung" || art === "tilt" || art === "steckt") return P.lampe.weissgold;
        return P.text;
      }
      switch (art) {
        case "skill": case "jackpot": case "extraball": case "multiball":
          return "#A9DBFF";
        case "mission": case "rang":
          return "#CFC6FF";
        case "warnung": case "tilt": case "steckt":
          return FARBE.weissgold;
        default:
          return FARBE.text;
      }
    }

    // --- Tafeln: Start, Pause, Ende ---------------------------------------------------------------

    zeichneTafel(g, ui, dt) {
      const t = this.tafel;
      t.uhr += dt;
      // Die Tafel geht höchstens alle ZEIT.tafelHalten an oder aus. Wer P schnell hintereinander drückt, pausiert und
      // spielt sofort weiter, die Tafel folgt aber ruhig (kein Flackern über 1 Hz); gezeigt wird der neueste Wunsch.
      const wunsch = ui.ueberlagerung || "";
      if (wunsch !== t.ziel && t.uhr - t.wechsel >= (this.pal.tafelHalten ?? ZEIT.tafelHalten)) { t.ziel = wunsch; t.wechsel = t.uhr; }
      const art = t.ziel;
      if (art) {
        if (art === wunsch) {
          const schl = art + "|" + JSON.stringify(ui.tafel || {}) + "|" + (ui.tippen ? 1 : 0) + "|" + this.texte.code;
          if (schl !== t.schluessel) {
            t.sprite = this.tafelBauen(art, ui.tafel || {}, ui.tippen);
            t.schluessel = schl;
            t.art = art;
          }
        }
        t.alpha = Math.min(1, t.alpha + dt / ZEIT.tafelBlende);
      } else {
        t.alpha = Math.max(0, t.alpha - dt / ZEIT.tafelBlende);
        if (t.alpha === 0) t.schluessel = "";
      }
      // Der Knopf „Neues Spiel“ blendet mit der Tafel aus (bedienbar ist er nur, solange die Tafel gilt, tafelAktiv)
      t.knopf = t.alpha > 0 && t.sprite ? t.sprite.knopf : null;
      if (t.alpha <= 0 || !t.sprite) return;
      const L = this.lay;
      const d = this.dpr;
      // Abdunklung des Spielfelds unter der Tafel. Nicht im Hohen Kontrast (keine Transparenz; im Hellen würde das ganze
      // Feld grau) und nicht bei Umkehr (dort wird aus der leisen Abdunklung ein großer Sprung der Leuchtdichte, und ein
      // Pause-Stakkato wäre ein allgemeiner Blitz).
      if (this.pal.abdunkeln > 0) {
        g.globalAlpha = this.pal.abdunkeln * t.alpha;
        g.fillStyle = "#06061A";
        g.fillRect(L.feldX * d, L.feldY * d, L.wp * d, L.hp * d);
      }
      g.globalAlpha = t.alpha;
      g.drawImage(t.sprite.c, t.sprite.x, t.sprite.y);
      g.globalAlpha = 1;
    }

    // Eine Tafel im Beschlag der Startseite: gerundete Platte, eckiger Rahmen, vier Schrauben,
    // Farbkappe oben, Schatten nach links unten. Wird nur gebaut, wenn sich ihr Inhalt ändert.
    tafelBauen(art, daten, tippen) {
      const L = this.lay;
      const d = this.dpr;
      const k = Math.max(L.k, 0.82);
      const breite = Math.round(Math.min(L.wp * 0.88, 330 * k));
      const pad = Math.round(24 * k);
      const zeilen = [];
      const T = this.texte;
      const TITEL = T.schriftTitel;
      const TEXT = T.schriftText;
      // Farben: Werkstatt-Stil oder Hoher Kontrast (deckend, ohne Verlauf und Schatten)
      const P = this.pal;
      const F = P.flach
        ? { text: P.text, leise: P.leise, hinweis: P.leise, akzent: P.akzent, platz: P.lampe.lavendel, flaeche: P.grund, rand: P.rand, rahmen: P.rand, linie: P.rand }
        : { text: FARBE.text, leise: FARBE.leise, hinweis: "rgba(183,185,220,0.75)", akzent: FARBE.akzent, platz: "#CFC6FF", flaeche: "rgba(24,24,49,0.97)", rand: FARBE.linie, rahmen: "rgba(180,181,255,0.32)", linie: "rgba(180,181,255,0.18)" };
      let knopfH = 0;
      if (art === "titel") {
        zeilen.push({ text: "Kugelblitz", schrift: "560 " + Math.round(38 * k) + "px " + SCHRIFT_TITEL, farbe: F.text, h: 46 * k });
        zeilen.push({ text: T.t("tafel_untertitel"), schrift: "400 " + Math.round(13.5 * k) + "px " + TEXT, farbe: F.leise, h: 22 * k });
        zeilen.push({ linie: true, h: 18 * k });
        const art2 = tippen ? "_tippen" : "_tasten";
        const tasten = [["tafel_flipper", "tafel_flipper"], ["tafel_abschuss", "tafel_abschuss"], ["tafel_schubsen", "tafel_schubsen"], ["pause", "tafel_pause"]]
          .map(([a, b]) => [T.t(a), T.t(b + art2)]);
        for (const [a, b] of tasten) zeilen.push({ paar: [a, b], schrift: "400 " + Math.round(13 * k) + "px " + TEXT, h: 21 * k });
        zeilen.push({ abstand: true, h: 14 * k });
        knopfH = Math.round(38 * k);
        zeilen.push({ knopf: true, h: knopfH });
        zeilen.push({ text: T.t(tippen ? "tafel_oder_tippen_start" : "tafel_oder_enter"), schrift: "400 " + Math.round(12 * k) + "px " + TEXT, farbe: F.hinweis, h: 24 * k });
        if (daten.rekord > 0) zeilen.push({ text: T.t("tafel_rekord", { p: daten.rekord }), schrift: "500 " + Math.round(13 * k) + "px " + TEXT, farbe: F.akzent, h: 18 * k });
      } else if (art === "ende") {
        zeilen.push({ text: T.t("spiel_vorbei"), schrift: "560 " + Math.round(26 * k) + "px " + TITEL, farbe: F.leise, h: 34 * k });
        zeilen.push({ text: T.zahl(daten.punkte || 0), schrift: "600 " + Math.round(44 * k) + "px " + TITEL, farbe: F.text, h: 52 * k });
        zeilen.push({ text: T.t("punkte"), schrift: "400 " + Math.round(13 * k) + "px " + TEXT, farbe: F.leise, h: 20 * k });
        const platz = daten.platz || 0;
        zeilen.push({ linie: true, h: 16 * k });
        zeilen.push({
          text: platz === 1 ? T.t("tafel_platz1") : platz > 1 ? T.t("tafel_platz", { n: platz }) : T.t("tafel_kein_platz"),
          schrift: "500 " + Math.round(14 * k) + "px " + TEXT, farbe: platz ? F.platz : F.leise, h: 24 * k,
        });
        zeilen.push({ abstand: true, h: 14 * k });
        knopfH = Math.round(38 * k);
        zeilen.push({ knopf: true, h: knopfH });
        zeilen.push({ text: T.t(tippen ? "tafel_oder_tippen" : "tafel_oder_enter"), schrift: "400 " + Math.round(12 * k) + "px " + TEXT, farbe: F.hinweis, h: 24 * k });
      } else {
        zeilen.push({ text: T.t("pause"), schrift: "560 " + Math.round(32 * k) + "px " + TITEL, farbe: F.text, h: 40 * k });
        zeilen.push({ text: T.t(tippen ? "weiter_tippen" : "weiter_tasten"), schrift: "400 " + Math.round(13.5 * k) + "px " + TEXT, farbe: F.leise, h: 22 * k });
      }
      // Passend setzen (vor dem Messen der Höhe): Ein Text, der nicht in die Breite passt, wird bis auf 80 % kleiner,
      // sonst zweizeilig. Ein Tastenpaar (links Begriff, rechts Erklärung), das nicht nebeneinander passt, wird bis auf
      // 85 % kleiner, sonst steht die Erklärung unter dem Begriff. So läuft in keiner Sprache etwas über den Rand.
      const maxB = breite - 2 * pad;
      for (const z of zeilen) {
        if (z.text !== undefined) {
          const px = parseFloat(z.schrift.split(" ")[1]);
          const b0 = this.messen(z.schrift, z.text);
          if (b0 > maxB) {
            if (px * maxB / b0 >= px * 0.8) z.schrift = mitGroesse(z.schrift, Math.floor(px * maxB / b0));
            else {
              const zw = this.zweiZeilen(z.text, (t) => this.messen(z.schrift, t));
              if (zw) {
                z.zeilen = zw.zeilen;
                if (zw.w > maxB) z.schrift = mitGroesse(z.schrift, Math.floor(px * maxB / zw.w));
                z.h *= 1.75;
              } else z.schrift = mitGroesse(z.schrift, Math.floor(px * maxB / b0));
            }
          }
        } else if (z.paar) {
          const px = parseFloat(z.schrift.split(" ")[1]);
          const luecke = 12 * k;
          const summe = this.messen(z.schrift, z.paar[0]) + luecke + this.messen(z.schrift, z.paar[1]);
          if (summe > maxB) {
            if (px * maxB / summe >= px * 0.85) z.schrift = mitGroesse(z.schrift, Math.floor(px * maxB / summe));
            else {
              z.gestapelt = true;
              z.h *= 1.85;
              const breiter = Math.max(this.messen(z.schrift, z.paar[0]), this.messen(z.schrift, z.paar[1]));
              if (breiter > maxB) z.schrift = mitGroesse(z.schrift, Math.floor(px * maxB / breiter));
            }
          }
        }
      }
      const innenH = zeilen.reduce((s, z) => s + z.h, 0);
      const hoehe = Math.round(innenH + 2 * pad);
      const schatten = Math.round(26 * k);
      // Lage über dem Spielfeld (CSS-Pixel)
      const x = Math.round(L.feldX + (L.wp - breite) / 2);
      const y = Math.round(L.feldY + Math.max(L.hp * 0.12, (L.hp * 0.62 - hoehe) / 2));
      const c = neueLeinwand((breite + 2 * schatten) * d, (hoehe + 2 * schatten) * d);
      const g = c.getContext("2d");
      g.scale(d, d);
      const px = schatten;
      const py = schatten;
      const rr = 8;
      // Schatten nach links unten (nicht im Hohen Kontrast und nicht bei Umkehr: dort würde er zu einem hellen Hof)
      g.save();
      if (P.tafelSchatten) {
        g.shadowColor = "rgba(0,0,0,0.5)";
        g.shadowBlur = 28 * k * d;
        g.shadowOffsetX = -12 * k * d;
        g.shadowOffsetY = 14 * k * d;
      }
      g.beginPath();
      rundrechteck(g, px, py, breite, hoehe, rr);
      g.fillStyle = F.flaeche;
      g.fill();
      g.restore();
      g.beginPath();
      rundrechteck(g, px + 0.5, py + 0.5, breite - 1, hoehe - 1, rr);
      g.lineWidth = 1;
      g.strokeStyle = F.rand;
      g.stroke();
      // Farbkappe oben (Verlauf des Claims der Startseite: Violett, Eisblau, Lavendel)
      g.save();
      g.beginPath();
      rundrechteck(g, px, py, breite, hoehe, rr);
      g.clip();
      if (P.flach) g.fillStyle = P.akzent;
      else {
        const kap = g.createLinearGradient(px, 0, px + breite, 0);
        kap.addColorStop(0, FARBE.violett);
        kap.addColorStop(0.5, FARBE.eis);
        kap.addColorStop(1, FARBE.lavendel);
        g.fillStyle = kap;
      }
      g.fillRect(px, py, breite, 3);
      g.restore();
      // eckiger Rahmen und Schrauben
      const fi = 7;
      g.strokeStyle = F.rahmen;
      g.lineWidth = 1;
      g.strokeRect(px + fi + 0.5, py + fi + 0.5, breite - 2 * fi - 1, hoehe - 2 * fi - 1);
      {
        const s = 9;
        const o = fi + 3;
        [[px + o, py + o], [px + breite - o - s, py + o], [px + o, py + hoehe - o - s], [px + breite - o - s, py + hoehe - o - s]]
          .forEach(([sx, sy], i) => this.schraubeAn(g, i, sx, sy, s));
      }
      // Inhalt (bei Schrift von rechts nach links stehen Begriff und Erklärung gespiegelt)
      let yy = py + pad;
      let knopf = null;
      const rtl = T.richtung === "rtl";
      if ("direction" in g) g.direction = T.richtung;
      g.textBaseline = "middle";
      for (const z of zeilen) {
        const mitte = yy + z.h / 2;
        if (z.text !== undefined) {
          g.font = z.schrift;
          g.textAlign = "center";
          g.fillStyle = z.farbe;
          if (z.zeilen) {
            const abstandZ = z.h / 2;
            g.fillText(z.zeilen[0], px + breite / 2, mitte - abstandZ / 2, maxB);
            g.fillText(z.zeilen[1], px + breite / 2, mitte + abstandZ / 2, maxB);
          } else {
            g.fillText(z.text, px + breite / 2, mitte, maxB);
          }
        } else if (z.paar) {
          g.font = z.schrift;
          const links = rtl ? "right" : "left";
          const rechts = rtl ? "left" : "right";
          const xa = rtl ? px + breite - pad : px + pad;
          const xb = rtl ? px + pad : px + breite - pad;
          if (z.gestapelt) {
            g.textAlign = links;
            g.fillStyle = F.leise;
            g.fillText(z.paar[0], xa, mitte - z.h * 0.22, maxB);
            g.fillStyle = F.text;
            g.fillText(z.paar[1], xa, mitte + z.h * 0.22, maxB);
          } else {
            g.textAlign = links;
            g.fillStyle = F.leise;
            g.fillText(z.paar[0], xa, mitte);
            g.textAlign = rechts;
            g.fillStyle = F.text;
            g.fillText(z.paar[1], xb, mitte);
          }
        } else if (z.linie) {
          g.fillStyle = F.linie;
          g.fillRect(px + pad, Math.round(mitte), breite - 2 * pad, 1);
        } else if (z.knopf) {
          const kb = Math.round(Math.min(breite - 2 * pad, 200 * k));
          knopf = { x: x + Math.round((breite - kb) / 2), y: y + Math.round(yy - py), b: kb, h: z.h };
        }
        yy += z.h;
      }
      return { c, x: Math.round((x - schatten) * d), y: Math.round((y - schatten) * d), knopf };
    }

    // CSS-Rechteck des Knopfs „Neues Spiel“ (relativ zur Leinwand) oder null
    knopf() { return this.tafel.knopf; }
    tafelSichtbar() { return this.tafel.alpha; }
    tafelAktiv() { return this.tafel.ziel === "titel" || this.tafel.ziel === "ende"; }

    // --- Messung ----------------------------------------------------------------------------------

    zeitMerken(ms) {
      this.zeiten[this.zeitenI] = ms;
      this.zeitenI = (this.zeitenI + 1) % this.zeiten.length;
      this.zeitenN = Math.min(this.zeitenN + 1, this.zeiten.length);
    }

    zeichenzeiten() {
      const a = Array.from(this.zeiten.subarray(0, this.zeitenN)).sort((x, y) => x - y);
      if (!a.length) return { n: 0, mittel: 0, p95: 0, max: 0 };
      const mittel = a.reduce((s, x) => s + x, 0) / a.length;
      return { n: a.length, mittel, p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))], max: a[a.length - 1] };
    }

    zeitenZuruecksetzen() { this.zeitenN = 0; this.zeitenI = 0; }

    // Für das L-Meter: Messpunkte der Treffer-Scheine (Gerätepixel), so gewählt, dass keine Lampe in der
    // Nähe liegt (Lampen sind Zustände, keine Treffer-Effekte, und werden in 1. bis 4. gemessen)
    messpunkte() {
      const pkt = [];
      this.bauplan.bumper.forEach((b, i) => {
        for (const w of [0.25, 2.9, 4.0, 5.3]) {
          const r = b.radius * 1.08;   // dort ist der Ring am hellsten
          pkt.push({ name: "bumper" + i, tx: b.pos[0] + Math.cos(w) * r, ty: b.pos[1] + Math.sin(w) * r });
        }
      });
      for (let s = 0; s < 2; s++) pkt.push({ name: "schleuder" + s, tx: s ? 1 - 0.319 : 0.319, ty: 0.546 });
      for (let i = 0; i < 3; i++) pkt.push({ name: "standup" + i, tx: 0.94, ty: 0.9 + 0.14 * i });
      return pkt.map((p) => ({ ...p, x: this.X(p.tx), y: this.Y(p.ty) }));
    }
  }

  return { Grafik, FARBE, PALETTEN, ZEIT, STAERKE, BREITE, HOEHE, layoutFuer, passendesLayout, schraubeSvg, SCHRAUBEN_WINKEL };
});
