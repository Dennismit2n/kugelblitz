// Tunneling-Messung: Lektion 04 (unverändert) gegen Kugelblitz-Physik
//
//   node tests/tunnel.mjs            Messtabellen ausgeben
//   node tests/tunnel.mjs --pruefen  zusätzlich Abnahme: Exit-Code 1, wenn die
//                                    Unterschritt-Physik irgendwo durchlässt ODER
//                                    eine Positivprobe fehlschlägt (Kugel kommt nicht an,
//                                    prallt nicht ab, Zähler bleibt blind …)
//
// Die Lektion läuft in einer vm-Sandbox mit Attrappen für Canvas und DOM.
// A–D vergleichen auf der Geometrie der Lektion (Zahlen unverändert seit Meilenstein 1), A2b beschießt dort den
// Flipper mit dem Tempo des echten Tischs,
// E beschießt den echten Kugelblitz-Tisch: E1–E3 die Rampe und den Zähler, E4–E14 (Abschnitt 1)
// jede Wand, Ecke, Schleuder, Fallziele, Sensoren, Zündkammer, Kugelpaare, das Zufallsspiel,
// die Engstellen und die Erreichbarkeit jedes Bauteils. E15 (Abschnitt 4) wacht über die Einwegwände
// im ganzen Tisch, die der eingebaute Zähler auslässt.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const hier = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const P = require(path.join(hier, "..", "physik.js"));
const PRUEFEN = process.argv.includes("--pruefen");
const STARTZEIT = Date.now();
const fehler = [];

// --- Lektion 04 in der Sandbox ---------------------------------------------------

function ladeLektion() {
  const html = fs.readFileSync(path.join(hier, "..", "lektion04-original.html"), "utf8");
  const skript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const ausfuhr = "\n;globalThis.__L = { Vector2, Ball, Flipper, physicsScene, simulate };";
  const leererKontext = new Proxy({}, { get: () => () => {} });
  const leinwand = {
    width: 0, height: 0,
    getContext: () => leererKontext,
    addEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const sandbox = {
    window: { innerWidth: 820, innerHeight: 1100 },
    document: { getElementById: (id) => (id === "myCanvas" ? leinwand : { innerHTML: "" }) },
    requestAnimationFrame: () => 0,
    Math,
  };
  vm.createContext(sandbox);
  vm.runInContext(skript + ausfuhr, sandbox);
  return sandbox.__L;
}

const L = ladeLektion();
const LEKTION_BANDE = L.physicsScene.border.map((p) => [p.x, p.y]);
const LEKTION_FLIPPER = L.physicsScene.flippers[0];
const STANDARD = P.standardBauplan();
// Bande des Kugelblitz-Tischs aus Meilenstein 1 (vor Abschnitt 1). Abschnitt C misst weiter auf ihr,
// damit seine Zahlen unverändert bleiben; die neue Bande prüft E5.
const BANDE_MEILENSTEIN_1 = [
  [0.26, 0.00], [0.74, 0.00], [0.74, 0.25], [0.975, 0.40], [0.975, 0.05], [1.08, 0.05],
  [1.08, 1.50], [0.90, 1.68], [0.12, 1.68], [0.02, 1.58], [0.02, 0.40], [0.26, 0.25],
];

function lektionAdapter({ mitBande = true, mitFlipper = true, schwerkraft = 0 } = {}) {
  const S = L.physicsScene;
  const bande = S.border.slice();
  return {
    name: "Original",
    zuruecksetzen() {
      S.obstacles = [];
      S.flippers = mitFlipper ? [LEKTION_FLIPPER] : [];
      S.border = mitBande ? bande.slice() : [];
      S.gravity = new L.Vector2(0, -schwerkraft);
      LEKTION_FLIPPER.touchIdentifier = -1;
      LEKTION_FLIPPER.rotation = 0;
      LEKTION_FLIPPER.currentAngularVelocity = 0;
    },
    kugel(pos, vel) {
      const r = 0.03;
      S.balls = [new L.Ball(r, Math.PI * r * r, new L.Vector2(pos.x, pos.y), new L.Vector2(vel.x, vel.y), 0.2)];
    },
    druecken(an) { LEKTION_FLIPPER.touchIdentifier = an ? 0 : -1; },
    flipperLage() { return { a: LEKTION_FLIPPER.pos.clone(), b: LEKTION_FLIPPER.getTip() }; },
    bild() { L.simulate(); },
    pos() { return S.balls[0].pos; },
    vel() { return S.balls[0].vel; },
  };
}

// Testflipper mit den Maßen der Lektion (Winkeltempo 10, Stoßzahl 0). Mit „tempo" bekommt er Winkeltempo,
// Rückweg und Stoßzahl eines anderen Flippers (A2b: der echte Tischflipper), die Geometrie bleibt.
function kugelblitzAdapter(modus, { bande = LEKTION_BANDE, mitFlipper = true, waende = [], schwerkraft = 0, tempo = null } = {}) {
  const testFlipper = { pos: [0.26, 0.22], laenge: 0.2, radius: 0.03, ruheWinkel: -0.5,
    maxDrehung: 1.0, winkelTempo: 10, stosszahl: 0 };
  const bauplan = {
    bande,
    bandeStosszahl: 0.2,
    waende,
    bumper: [],
    flipper: mitFlipper ? [tempo ? { ...testFlipper, ...tempo } : testFlipper] : [],
    schwerkraft,
  };
  let tisch;
  return {
    name: modus === "einzelschritt" ? "Einzelschritt" : "Unterschritte",
    zuruecksetzen() { tisch = new P.Tisch(bauplan, modus); },
    kugel(pos, vel) { tisch.kugeln = [new P.Kugel(new P.Vec2(pos.x, pos.y), new P.Vec2(vel.x, vel.y))]; },
    druecken(an) { tisch.flipper[0].gedrueckt = an; },
    flipperLage() { const f = tisch.flipper[0]; return { a: f.pos.clone(), b: f.spitze() }; },
    bild(dt = 1 / 60) { tisch.vorruecken(dt); },
    pos() { return tisch.kugeln[0].pos; },
    vel() { return tisch.kugeln[0].vel; },
    get tisch() { return tisch; },
  };
}

// --- Hilfen ------------------------------------------------------------------------

const v2 = (x, y) => ({ x, y });
const prozent = (n, von) => (von ? ((100 * n) / von).toFixed(0).padStart(3) + " %" : "  –  ");
const komma = (z, s = 1) => z.toFixed(s).replace(".", ",");

// Kleiner Zufallsgenerator mit festem Startwert, damit jeder Lauf gleich ausfällt
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ruhender linker Flipper der Lektion
const FA = v2(0.26, 0.22);
const FDIR = v2(Math.cos(-0.5), Math.sin(-0.5));
const FB = v2(FA.x + FDIR.x * 0.2, FA.y + FDIR.y * 0.2);
const FN = v2(-FDIR.y, FDIR.x);   // zeigt nach oben

// --- A: Kugel auf den ruhenden Flipper ------------------------------------------------

// Der Startabstand wird über einen ganzen Bildschritt verschoben, damit jede Lage
// zum Takt einmal vorkommt. Jeder Schuss muss eindeutig „durch" oder „gehalten" sein.
function flipperBeschuss(adapter, tempo, phasen = 48, trefferpunkte = [0.3, 0.5, 0.7]) {
  let durch = 0, gehalten = 0, unklar = 0, versuche = 0;
  for (const s of trefferpunkte) {
    for (let i = 0; i < phasen; i++) {
      adapter.zuruecksetzen();
      const ziel = v2(FA.x + FDIR.x * 0.2 * s, FA.y + FDIR.y * 0.2 * s);
      const abstand = 0.25 + (i / phasen) * (tempo / 60);
      adapter.kugel(v2(ziel.x + FN.x * abstand, ziel.y + FN.y * abstand), v2(-FN.x * tempo, -FN.y * tempo));
      let ergebnis = "unklar";
      for (let bild = 0; bild < 400; bild++) {
        adapter.bild();
        const p = adapter.pos();
        const v = adapter.vel();
        const lage = P.lageZurStrecke(p, FA, FB);
        if (lage.seite < 0 && lage.t >= 0 && lage.t <= 1) { ergebnis = "durch"; break; }
        if (lage.seite > 0 && v.x * FN.x + v.y * FN.y >= -1e-9) { ergebnis = "gehalten"; break; }
      }
      versuche++;
      if (ergebnis === "durch") durch++;
      else if (ergebnis === "gehalten") gehalten++;
      else unklar++;
    }
  }
  return { durch, gehalten, unklar, versuche };
}

// --- A2: Kugel und hochschlagender Flipper -----------------------------------------------

// Taste von Anfang an gedrückt: Der Arm schlägt hoch, während die Kugel von oben kommt –
// der normale Spielfall. Gezählt wird ein Seitenwechsel gegenüber dem BEWEGTEN Arm.
function flipperSchlag(adapter, tempo, phasen = 36, trefferpunkte = [0.3, 0.5, 0.7, 0.9]) {
  let durch = 0, versuche = 0, getroffen = 0;
  for (const s of trefferpunkte) {
    for (let i = 0; i < phasen; i++) {
      adapter.zuruecksetzen();
      adapter.druecken(true);
      const ziel = v2(FA.x + FDIR.x * 0.2 * s, FA.y + FDIR.y * 0.2 * s);
      const abstand = 0.12 + (i / phasen) * (tempo / 60);
      adapter.kugel(v2(ziel.x + FN.x * abstand, ziel.y + FN.y * abstand), v2(-FN.x * tempo, -FN.y * tempo));
      let ergebnis = "gehalten";
      for (let bild = 0; bild < 45; bild++) {
        const alt = adapter.flipperLage();
        const p0 = { x: adapter.pos().x, y: adapter.pos().y };
        const vorherTempo = adapter.vel().x * FN.x + adapter.vel().y * FN.y;
        adapter.bild();
        const neu = adapter.flipperLage();
        if (P.wechseltSeite(p0, adapter.pos(), alt.a, alt.b, neu.a, neu.b)) { ergebnis = "durch"; break; }
        const nachherTempo = adapter.vel().x * FN.x + adapter.vel().y * FN.y;
        if (nachherTempo > vorherTempo + 1e-9) getroffen++;
      }
      versuche++;
      if (ergebnis === "durch") durch++;
    }
  }
  return { durch, versuche, getroffen };
}

// --- B: Dünne Wand (wie die Trennwand zur Rampe) ------------------------------------

function wandBeschuss(modus, tempo, phasen = 48) {
  const wand = { a: [0.5, 0.6], b: [0.5, 1.2], radius: 0.01, stosszahl: 0.4 };
  const adapter = kugelblitzAdapter(modus, { mitFlipper: false, waende: [wand] });
  let durch = 0, abgeprallt = 0;
  for (let i = 0; i < phasen; i++) {
    adapter.zuruecksetzen();
    const abstand = 0.2 + (i / phasen) * (tempo / 60);
    adapter.kugel(v2(0.5 - abstand, 0.9), v2(tempo, 0));
    for (let bild = 0; bild < 400; bild++) {
      adapter.bild();
      const p = adapter.pos();
      if (p.x > 0.5) { durch++; break; }
      if (adapter.vel().x < 0) { abgeprallt++; break; }
    }
  }
  return { durch, abgeprallt, versuche: phasen };
}

// --- C: Außenbande ----------------------------------------------------------------------

// Zufällige Startpunkte im ganzen Tisch, zufällige Richtungen, mit Schwerkraft.
// „draußen": Kugel liegt am Bildende hinter der Bande.
// „Sprung": Die Strecke zwischen zwei Bildern kreuzt eine Bandenkante, obwohl beide
// Enden innen liegen – die Rettung hat die Kugel in einen anderen Tischteil gesetzt.
function bandeBeschuss(adapter, bandePunkte, tempo, schuesse = 300, seed = 7) {
  const poly = bandePunkte.map(([x, y]) => new P.Vec2(x, y));
  const rnd = mulberry32(seed);
  const xs = bandePunkte.map((p) => p[0]);
  const ys = bandePunkte.map((p) => p[1]);
  let draussen = 0, sprung = 0;
  for (let i = 0; i < schuesse; i++) {
    let start;
    do {
      start = new P.Vec2(Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)),
        Math.min(...ys) + rnd() * (Math.max(...ys) - Math.min(...ys)));
    } while (!P.punktInPolygon(start, poly) || randAbstand(start, poly) < 0.035);
    const w = rnd() * Math.PI * 2;
    adapter.zuruecksetzen();
    adapter.kugel(start, v2(Math.cos(w) * tempo, Math.sin(w) * tempo));
    let vorher = start.clone();
    for (let bild = 0; bild < 90; bild++) {
      adapter.bild();
      const p = new P.Vec2(adapter.pos().x, adapter.pos().y);
      if (!P.punktInPolygon(p, poly)) { draussen++; break; }
      if (kreuztKante(vorher, p, poly)) { sprung++; break; }
      vorher = p;
    }
  }
  return { draussen, sprung, versuche: schuesse };
}

function randAbstand(p, poly) {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const c = P.naechsterPunktAufStrecke(p, poly[i], poly[(i + 1) % poly.length]);
    m = Math.min(m, Math.hypot(p.x - c.x, p.y - c.y));
  }
  return m;
}

function kreuztKante(p0, p1, poly) {
  for (let i = 0; i < poly.length; i++) {
    if (P.streckenSchneiden(p0, p1, poly[i], poly[(i + 1) % poly.length])) return true;
  }
  return false;
}

// --- D: Bildwiederholrate ---------------------------------------------------------------

// Kugel fällt frei, eine Sekunde Echtzeit bei R Bildern pro Sekunde.
function bildrate(R) {
  const g = 3;
  const o = lektionAdapter({ mitBande: false, mitFlipper: false, schwerkraft: g });
  o.zuruecksetzen();
  o.kugel(v2(0.5, 0.9), v2(0, 0));
  for (let i = 0; i < R; i++) o.bild();
  const original = -o.vel().y / g;

  const k = kugelblitzAdapter("unterschritte", { bande: [], mitFlipper: false, schwerkraft: g });
  k.zuruecksetzen();
  k.kugel(v2(0.5, 0.9), v2(0, 0));
  for (let i = 0; i < R; i++) k.bild(1 / R);
  const tempo = -k.vel().y / g;
  const weg = (0.9 - k.pos().y) / (0.5 * g);   // 1,0 = eine Sekunde freier Fall
  return { original, tempo, weg };
}

// --- E: Der echte Kugelblitz-Tisch -----------------------------------------------------

function standardTisch(modus) {
  return new P.Tisch(P.standardBauplan(), modus);
}

// Hat die Kugelmitte zwischen zwei Bildern x = 0,98 unterhalb des Tors überquert?
// Unabhängig vom eingebauten Zähler gerechnet.
function trennwandGequert(p0, p1) {
  if ((p0.x - 0.98) * (p1.x - 0.98) >= 0) return false;
  const y = p0.y + ((p1.y - p0.y) * (0.98 - p0.x)) / (p1.x - p0.x);
  return y < STANDARD.rampe.torY;
}

// E1: Kugel an der Trennwand. Die überstumpfe Ecke (0,975 | 0,40) aus Meilenstein 1 gibt es seit
// Abschnitt 1 nicht mehr (die Trennwand reicht jetzt bis zum Rampenboden); die alten Fälle bleiben als
// Regression, dazu der Wandfuß bei (0,985 | 0,05) und Schüsse aus der rechten Outlane auf die Trennwand.
function eckRegression(modus) {
  const faelle = [];
  for (const [x, y, vx, vy] of [
    [1.026, 0.41, 0, -2], [1.026, 0.41, 0, 2], [1.0265, 0.43, 0, -1],
    [1.027, 0.60, -0.3, -2.5], [1.025, 0.405, 0, 0], [1.0268, 0.44, -0.2, -0.5],
    [1.03, 0.082, -5, 0], [1.026, 0.083, -9, 0.3], [1.03, 0.2, -9, -2], [1.0265, 0.09, -2, -1],
    [0.94, 0.082, 5, 0], [0.94, 0.082, 9, 0.5], [0.945, 0.3, 9, -1], [0.93, 0.5, 6, 3],
  ]) {
    const t = standardTisch(modus);
    const k = new P.Kugel(new P.Vec2(x, y), new P.Vec2(vx, vy));
    t.kugeln = [k];
    let gequert = false;
    let vorher = k.pos.clone();
    for (let b = 0; b < 60; b++) {
      t.vorruecken(1 / 60);
      if (trennwandGequert(vorher, k.pos)) gequert = true;
      vorher = k.pos.clone();
    }
    faelle.push({ start: [x, y, vx, vy], gequert, zaehler: t.statistik.durchschuesse });
  }
  return faelle;
}

// E2: Zufallsspiel auf dem echten Tisch – schwache und starke Abschüsse, Schubser in
// der Rampe, wildes Flippen. Zählt Übertritte zwischen Rampe und Spielfeld.
function zufallsspiel(modus, laeufe, seed) {
  const rnd = mulberry32(seed);
  let gequert = 0, zaehler = 0, torDurch = 0;
  for (let l = 0; l < laeufe; l++) {
    const t = standardTisch(modus);
    const [x, y] = STANDARD.rampe.start;
    const k = new P.Kugel(new P.Vec2(x, y));
    t.kugeln = [k];
    let vorher = k.pos.clone();
    for (let b = 0; b < 360; b++) {
      const inRampe = k.pos.x > STANDARD.rampe.xMin && k.pos.y < STANDARD.rampe.yMax;
      if (inRampe && Math.abs(k.vel.y) < 0.05 && rnd() < 0.08) k.vel.y = 1.8 + rnd() ** 2 * 3.6;
      if (rnd() < 0.04) k.vel.x += (rnd() < 0.5 ? -1 : 1) * 0.45;
      if (rnd() < 0.1) t.flipper[0].gedrueckt = rnd() < 0.5;
      if (rnd() < 0.1) t.flipper[1].gedrueckt = rnd() < 0.5;
      t.vorruecken(1 / 60);
      if (trennwandGequert(vorher, k.pos)) gequert++;
      if (vorher.x > 0.98 && k.pos.y > STANDARD.rampe.torY + 0.07) torDurch++;
      vorher = k.pos.clone();
      if (k.pos.y < STANDARD.abfluss.yMax && k.pos.x > STANDARD.abfluss.xMin && k.pos.x < STANDARD.abfluss.xMax) break;
    }
    zaehler += t.statistik.durchschuesse;
  }
  return { gequert, zaehler, torDurch, laeufe };
}

// E3: Sieht der eingebaute Zähler überhaupt etwas? Im Einzelschritt muss er Durchschüsse
// durch den Flipper melden, mit Unterschritten keine.
function zaehlerProbe(modus) {
  const t = standardTisch(modus);
  const f = t.flipper[0];
  const dir = new P.Vec2(Math.cos(f.ruheWinkel), Math.sin(f.ruheWinkel));
  const n = dir.perp();
  if (n.y < 0) n.scale(-1);
  for (let i = 0; i < 40; i++) {
    const ziel = f.pos.clone().add(dir, f.laenge * (0.25 + 0.5 * ((i * 7) % 40) / 40));
    const start = ziel.clone().add(n, 0.32 + 0.15 * ((i + 0.5) / 40));
    t.kugeln = [new P.Kugel(start, n.clone().scale(-9))];
    for (let b = 0; b < 20; b++) t.vorruecken(1 / 60);
  }
  return t.statistik.durchschuesse;
}

// --- Ausgabe -----------------------------------------------------------------------------

console.log("\nA  Kugel senkrecht auf den RUHENDEN Flipper (Geometrie der Lektion, 144 Schüsse je Tempo)");
console.log("   Anteil, der auf der Unterseite ankommt\n");
console.log("   Tempo   Original   Einzelschritt   Unterschritte");
let abweichung = 0;
for (const t of [2, 3, 3.5, 3.6, 3.7, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20]) {
  const o = flipperBeschuss(lektionAdapter(), t);
  const e = flipperBeschuss(kugelblitzAdapter("einzelschritt"), t);
  const u = flipperBeschuss(kugelblitzAdapter("unterschritte"), t);
  abweichung = Math.max(abweichung, Math.abs(o.durch - e.durch));
  if (u.durch > 0) fehler.push(`A: Flipper bei Tempo ${t}: ${u.durch} von ${u.versuche} durch`);
  for (const [name, r] of [["Original", o], ["Einzelschritt", e], ["Unterschritte", u]]) {
    if (r.unklar > 0 || r.durch + r.gehalten !== r.versuche)
      fehler.push(`A: ${name} bei Tempo ${t}: ${r.unklar} Schüsse ohne Ergebnis`);
  }
  console.log(
    "   " + komma(t).padStart(5) + "   " + prozent(o.durch, o.versuche).padStart(8) +
    "   " + prozent(e.durch, e.versuche).padStart(13) +
    "   " + prozent(u.durch, u.versuche).padStart(13) +
    (t > P.KONST.TEMPO_DECKEL ? "   (Unterschritte: auf 9 gedeckelt)" : ""));
}
console.log(`\n   Gleiche Schrittweite: Original und Einzelschritt zählen hier gleich viele Durchschüsse`);
console.log(`   (größte Abweichung ${abweichung} von 144). Nach einem Kontakt verhalten sie sich verschieden –`);
console.log(`   die Lektion bremst beim Abheben, Kugelblitz nicht.`);

console.log("\nA2 Kugel trifft den HOCHSCHLAGENDEN Flipper (Taste gedrückt, 144 Schüsse je Tempo)\n");
console.log("   Tempo   Original   Einzelschritt   Unterschritte");
for (const t of [0.5, 1, 1.5, 1.8, 2, 2.5, 3, 4, 6, 9]) {
  const o = flipperSchlag(lektionAdapter(), t);
  const e = flipperSchlag(kugelblitzAdapter("einzelschritt"), t);
  const u = flipperSchlag(kugelblitzAdapter("unterschritte"), t);
  if (u.durch > 0) fehler.push(`A2: schlagender Flipper bei Tempo ${t}: ${u.durch} von ${u.versuche} durch`);
  if (u.getroffen === 0) fehler.push(`A2: Unterschritte bei Tempo ${t}: der Arm trifft die Kugel nie`);
  console.log("   " + komma(t).padStart(5) + "   " + prozent(o.durch, o.versuche).padStart(8) +
    "   " + prozent(e.durch, e.versuche).padStart(13) + "   " + prozent(u.durch, u.versuche).padStart(13));
}

// A2b: dieselbe Probe mit Winkeltempo, Rückweg und Stoßzahl des echten Tischflippers. A2 bleibt beim Testflipper der
// Lektion, damit der Vergleich mit dem Original stimmt; erst A2b zeigt, dass auch der schnellere Arm des Spiels nichts
// durchlässt (die Unterschritte zählen seine Spitze mit, Physik.Flipper.hoechstesSpitzenTempo).
const TF = STANDARD.flipper[0];
const TISCH_TEMPO = { winkelTempo: TF.winkelTempo, rueckTempo: TF.rueckTempo ?? TF.winkelTempo, stosszahl: TF.stosszahl };
console.log(`\nA2b Dasselbe mit dem Tischflipper (Hochschlag ${komma(TISCH_TEMPO.winkelTempo)}, Rückweg ${komma(TISCH_TEMPO.rueckTempo)}, ` +
  `Stoßzahl ${komma(TISCH_TEMPO.stosszahl, 2)}; Lektion: 10, 10, 0), 144 Schüsse je Tempo\n`);
console.log("   Tempo   Einzelschritt   Unterschritte");
let a2bEinzel = 0;
for (const t of [0.5, 1, 1.5, 1.8, 2, 2.5, 3, 4, 6, 9]) {
  const e = flipperSchlag(kugelblitzAdapter("einzelschritt", { tempo: TISCH_TEMPO }), t);
  const u = flipperSchlag(kugelblitzAdapter("unterschritte", { tempo: TISCH_TEMPO }), t);
  a2bEinzel += e.durch;
  if (u.durch > 0) fehler.push(`A2b: schlagender Tischflipper bei Tempo ${t}: ${u.durch} von ${u.versuche} durch`);
  if (u.getroffen === 0) fehler.push(`A2b: Unterschritte bei Tempo ${t}: der Tischflipper trifft die Kugel nie`);
  console.log("   " + komma(t).padStart(5) + "   " + prozent(e.durch, e.versuche).padStart(13) + "   " + prozent(u.durch, u.versuche).padStart(13));
}
if (a2bEinzel === 0) fehler.push("A2b: auch im Einzelschritt kein Durchschuss, die Probe wäre blind");

console.log("\nB  Dünne Wand (Kapsel, Radius 0,01) – nur Kugelblitz, die Lektion hat keine\n");
console.log("   Tempo   Einzelschritt   Unterschritte   davon abgeprallt");
for (const t of [1, 2, 2.4, 2.5, 3, 4, 6, 9]) {
  const e = wandBeschuss("einzelschritt", t);
  const u = wandBeschuss("unterschritte", t);
  if (u.durch > 0) fehler.push(`B: Wand bei Tempo ${t}: ${u.durch} von ${u.versuche} durch`);
  if (u.abgeprallt !== u.versuche) fehler.push(`B: Wand bei Tempo ${t}: nur ${u.abgeprallt} von ${u.versuche} abgeprallt`);
  console.log("   " + komma(t).padStart(5) + "   " + prozent(e.durch, e.versuche).padStart(13) +
    "   " + prozent(u.durch, u.versuche).padStart(13) + "   " + prozent(u.abgeprallt, u.versuche).padStart(16));
}

console.log("\nC  Außenbande – 300 Schüsse je Tempo aus zufälligen Punkten, mit Schwerkraft");
console.log("   „draußen / Sprung durch eine Kante in einen anderen Tischteil\"\n");
for (const [titel, bande] of [["Lektion", LEKTION_BANDE], ["Kugelblitz", BANDE_MEILENSTEIN_1]]) {
  console.log(`   Bande der ${titel}:`);
  console.log("   Tempo      Original        Einzelschritt     Unterschritte");
  for (const t of [3, 6, 9, 15, 30]) {
    const zeile = [];
    const adapterListe = [
      titel === "Lektion" ? lektionAdapter({ mitFlipper: false, schwerkraft: 3 }) : null,
      kugelblitzAdapter("einzelschritt", { bande, mitFlipper: false, schwerkraft: 3 }),
      kugelblitzAdapter("unterschritte", { bande, mitFlipper: false, schwerkraft: 3 }),
    ];
    adapterListe.forEach((a, i) => {
      if (!a) { zeile.push("        –       "); return; }
      const r = bandeBeschuss(a, bande, t);
      if (i === 2 && (r.draussen > 0 || r.sprung > 0))
        fehler.push(`C: Bande ${titel} bei Tempo ${t}: ${r.draussen} draußen, ${r.sprung} Sprünge`);
      zeile.push((prozent(r.draussen, r.versuche) + " / " + prozent(r.sprung, r.versuche)).padStart(16));
    });
    console.log("   " + komma(t).padStart(5) + "  " + zeile.join("  "));
  }
}

console.log("\nD  Eine Sekunde Echtzeit bei verschiedenen Bildschirmen (1,00 = richtig)\n");
console.log("   Bildschirm   Original   Kugelblitz Tempo   Kugelblitz Weg");
for (const R of [60, 120, 144, 165, 240]) {
  const { original, tempo, weg } = bildrate(R);
  if (Math.abs(tempo - 1) > 0.02) fehler.push(`D: ${R} Hz: Spieltempo ${tempo.toFixed(3)}`);
  if (Math.abs(weg - 1) > 0.03) fehler.push(`D: ${R} Hz: Fallweg ${weg.toFixed(3)}`);
  console.log("   " + (R + " Hz").padStart(10) + "   " + (komma(original, 2) + "×").padStart(8) +
    "   " + (komma(tempo, 2) + "×").padStart(16) + "   " + (komma(weg, 2) + "×").padStart(14));
}

console.log("\nE  Der echte Kugelblitz-Tisch\n");
for (const modus of ["einzelschritt", "unterschritte"]) {
  const faelle = eckRegression(modus);
  const schlecht = faelle.filter((f) => f.gequert);
  console.log(`   E1 Trennwand und Rampenfuß, ${modus}: ${schlecht.length} von ${faelle.length} Kugeln durch die Trennwand`);
  if (modus === "unterschritte") {
    for (const f of schlecht) fehler.push(`E1: Kugel ab (${f.start.join(" | ")}) springt durch die Trennwand`);
    for (const f of faelle) {
      if (f.gequert && f.zaehler === 0) fehler.push(`E1: Sprung ab (${f.start.slice(0, 2).join(" | ")}) vom Zähler nicht bemerkt`);
    }
  }
}
for (const modus of ["einzelschritt", "unterschritte"]) {
  const r = zufallsspiel(modus, 400, 2026);
  console.log(`   E2 Zufallsspiel, ${modus}: ${r.gequert} Übertritte Rampe↔Feld, Zähler ${r.zaehler}, ` +
    `${r.torDurch} Bilder mit Kugel über dem Tor (${r.laeufe} Läufe)`);
  if (modus === "unterschritte") {
    if (r.gequert > 0) fehler.push(`E2: ${r.gequert} Übertritte zwischen Rampe und Spielfeld`);
    if (r.gequert > 0 && r.zaehler === 0) fehler.push(`E2: ${r.gequert} Übertritte, aber der Zähler meldet keinen`);
    if (r.torDurch === 0) fehler.push("E2: keine Kugel kommt je durchs Tor – Abschuss kaputt?");
  }
}
const zE = zaehlerProbe("einzelschritt");
const zU = zaehlerProbe("unterschritte");
console.log(`   E3 Zählerprobe Tempo 9 auf den Flipper: Einzelschritt ${zE} Durchschüsse, Unterschritte ${zU}`);
if (zE === 0) fehler.push("E3: Der Zähler bemerkt im Einzelschritt keinen einzigen Durchschuss – blind?");
if (zU !== 0) fehler.push(`E3: Unterschritte melden ${zU} Durchschüsse`);


// --- E4–E14: Abschnitt 1, der neue Tisch ------------------------------------------------
// Jedes neue Teil wird einzeln und im Ganzen beschossen. Immer zwei Modi: „unterschritte"
// darf nichts durchlassen, „einzelschritt" MUSS Durchschüsse zeigen (sonst wäre die Probe blind).

const KASTEN = [[-3, -3], [4, -3], [4, 5], [-3, 5]];   // große Bande, nie im Weg

function leererTisch(modus, zusatz = {}) {
  return new P.Tisch({ bande: KASTEN, bandeStosszahl: 0.35, waende: [], bumper: [], flipper: [], schwerkraft: 0, ...zusatz }, modus);
}

const norm = (x, y) => { const l = Math.hypot(x, y); return v2(x / l, y / l); };
const drehe = (d, w) => v2(d.x * Math.cos(w) - d.y * Math.sin(w), d.x * Math.sin(w) + d.y * Math.cos(w));
const vorzeichen = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

// Ein Schuss auf eine einzelne Wand. t = Stelle entlang der Wand (0 und 1 = die Enden), winkel =
// Abweichung von der Senkrechten, phase (0…1) verschiebt den Startabstand über eine Schrittlänge.
function wandSchuss(def, modus, tempo, t, winkel, phase, seite) {
  const a = v2(def.a[0], def.a[1]);
  const b = v2(def.b[0], def.b[1]);
  const laenge = Math.hypot(b.x - a.x, b.y - a.y);
  const u = norm(b.x - a.x, b.y - a.y);
  const n = v2(-u.y * seite, u.x * seite);
  const ziel = v2(a.x + u.x * laenge * t, a.y + u.y * laenge * t);
  const dir = drehe(v2(-n.x, -n.y), winkel);
  const abstand = 0.2 + phase * (tempo / 60);
  const start = v2(ziel.x - dir.x * abstand, ziel.y - dir.y * abstand);
  const tisch = leererTisch(modus, { waende: [def] });
  const k = new P.Kugel(new P.Vec2(start.x, start.y), new P.Vec2(dir.x * tempo, dir.y * tempo));
  tisch.kugeln = [k];
  const seite0 = vorzeichen(P.lageZurStrecke(k.pos, a, b).seite);
  let durch = false, treffer = 0, tritte = 0;
  const frames = Math.ceil((abstand + 0.6) / (tempo / 60)) + 6;
  for (let f = 0; f < frames; f++) {
    tisch.vorruecken(1 / 60);
    const lage = P.lageZurStrecke(k.pos, a, b);
    if (vorzeichen(lage.seite) !== seite0 && lage.t >= 0 && lage.t <= 1) durch = true;
    for (const e of tisch.ereignisse) if (e.art === "wand") { treffer++; if (e.tritt) tritte++; }
    tisch.ereignisse.length = 0;
  }
  if (tisch.statistik.durchschuesse > 0) durch = true;
  const zurueck = k.vel.x * dir.x + k.vel.y * dir.y < 0;   // fliegt gegen die Schussrichtung
  return { durch, treffer, tritte, endTempo: k.vel.length(), zurueck, tisch };
}

function wandProbe(def, modus) {
  let durch = 0, versuche = 0, senkrecht = 0, zurueck = 0;
  const seiten = def.einweg ? [def.einweg] : [1, -1];
  for (const seite of seiten) {
    for (const tempo of [2, 5, 9]) {
      for (const t of [0, 0.1, 0.5, 0.9, 1]) {
        for (const winkel of [0, 0.7]) {
          for (let i = 0; i < 5; i++) {
            const r = wandSchuss(def, modus, tempo, t, t === 0 || t === 1 ? winkel * 0.3 : winkel, (i + 0.5) / 5, seite);
            versuche++;
            if (r.durch) durch++;
            if (winkel === 0 && t > 0 && t < 1) { senkrecht++; if (r.zurueck) zurueck++; }
          }
        }
      }
    }
  }
  return { durch, versuche, senkrecht, zurueck };
}

// E4: jede Wand des Tisches einzeln beschießen
console.log("\nE4 Jede Wand einzeln beschießen (Tempo 2 bis 9, Enden, schräg, beide Seiten, Startabstände über eine Schrittlänge)");
console.log("   Wand                  Schüsse   Einzelschritt durch   Unterschritte durch   senkrecht zurückgeprallt");
let e4Blind = 0, e4Gesamt = 0;
for (const def of STANDARD.waende) {
  const e = wandProbe(def, "einzelschritt");
  const u = wandProbe(def, "unterschritte");
  e4Gesamt += e.durch;
  if (u.durch > 0) fehler.push(`E4: Wand ${def.name}: ${u.durch} von ${u.versuche} Schüssen gehen durch (Unterschritte)`);
  if (u.zurueck !== u.senkrecht) fehler.push(`E4: Wand ${def.name}: nur ${u.zurueck} von ${u.senkrecht} senkrechten Schüssen prallen zurück (Positivprobe)`);
  if (e.durch === 0) { e4Blind++; fehler.push(`E4: Wand ${def.name}: Einzelschritt zeigt keinen einzigen Durchschuss, die Probe ist blind`); }
  console.log("   " + def.name.padEnd(22) + String(u.versuche).padStart(7) + "   " + String(e.durch).padStart(19) + "   " + String(u.durch).padStart(19) + "   " + String(u.zurueck).padStart(8) + " von " + u.senkrecht);
}
console.log(`   Summe Einzelschritt durch: ${e4Gesamt}, Wände mit blinder Probe: ${e4Blind}`);

// E4b: Einwegwände (Tor, Dächer über den Outlanes) von der offenen Seite: Die Kugel muss bei jedem Tempo glatt hindurch.
// Der Kickback schießt mit 2,4 von unten durchs Dach; bleibt die Kugel hängen, ist die Outlane eine Falle.
console.log("\nE4b Einwegwände von der offenen Seite (Tempo 1 bis 9, senkrecht und schräg)");
{
  let versuche = 0, hindurch = 0;
  for (const def of STANDARD.waende.filter((w) => w.einweg)) {
    let v = 0, h = 0;
    for (const tempo of [1, 2, 2.4, 5, 9]) {
      for (const [t, winkel] of [[0.25, 0], [0.5, 0], [0.75, 0], [0.5, 0.4], [0.5, -0.4]]) {   // schräg nur in der Mitte, sonst läuft die Linie am Ende vorbei
        {
          for (let i = 0; i < 5; i++) {
            const r = wandSchuss(def, "unterschritte", tempo, t, winkel, (i + 0.5) / 5, -def.einweg);
            v++;
            if (r.durch) h++;
          }
        }
      }
    }
    versuche += v; hindurch += h;
    console.log("   " + def.name.padEnd(16) + `${h} von ${v} Kugeln kommen von der offenen Seite hindurch`);
    if (h !== v) fehler.push(`E4b: Einwegwand ${def.name}: nur ${h} von ${v} Kugeln kommen von der offenen Seite hindurch`);
  }
  if (versuche === 0) fehler.push("E4b: keine Einwegwand im Tisch gefunden");
}

// E5: jede Ecke der Bande, besonders die überstumpfe bei (0,975 | 0,05)
function eckenProbe(modus) {
  const poly = STANDARD.bande.map(([x, y]) => new P.Vec2(x, y));
  const rnd = mulberry32(5150);
  const bauplan = { bande: STANDARD.bande, bandeStosszahl: 0.35, waende: [], bumper: [], flipper: [], schwerkraft: 0 };
  const ergebnis = [];
  for (let e = 0; e < poly.length; e++) {
    const ecke = poly[e];
    let schlecht = 0, versuche = 0;
    for (const tempo of [3, 6, 9]) {
      for (let i = 0; i < 80; i++) {
        let start;
        let zaehler = 0;
        do {
          const w = rnd() * Math.PI * 2;
          const r = 0.06 + rnd() * 0.24;
          start = new P.Vec2(ecke.x + Math.cos(w) * r, ecke.y + Math.sin(w) * r);
        } while ((!P.punktInPolygon(start, poly) || randAbstand(start, poly) < 0.032) && ++zaehler < 400);
        if (zaehler >= 400) continue;
        const ziel = new P.Vec2(ecke.x + (rnd() - 0.5) * 0.08, ecke.y + (rnd() - 0.5) * 0.08);
        const d = norm(ziel.x - start.x, ziel.y - start.y);
        const tisch = new P.Tisch(bauplan, modus);
        const k = new P.Kugel(start, new P.Vec2(d.x * tempo, d.y * tempo));
        tisch.kugeln = [k];
        let vorher = k.pos.clone();
        let schlimm = false;
        for (let f = 0; f < 45; f++) {
          tisch.vorruecken(1 / 60);
          const p = k.pos.clone();
          if (!P.punktInPolygon(p, poly) || kreuztKante(vorher, p, poly)) schlimm = true;
          vorher = p;
        }
        if (tisch.statistik.durchschuesse > 0 || tisch.statistik.ausbrueche > 0) schlimm = true;
        versuche++;
        if (schlimm) schlecht++;
      }
    }
    ergebnis.push({ ecke: `${ecke.x} | ${ecke.y}`, schlecht, versuche });
  }
  return ergebnis;
}
console.log("\nE5 Jede Ecke der Bande beschossen (Tempo 3, 6, 9, Richtung auf die Ecke, ohne Schwerkraft)");
{
  const einzel = eckenProbe("einzelschritt");
  const unter = eckenProbe("unterschritte");
  let blind = 0;
  unter.forEach((u, i) => {
    if (u.schlecht > 0) fehler.push(`E5: Ecke (${u.ecke}): ${u.schlecht} von ${u.versuche} Kugeln dringen durch die Bande`);
    blind += einzel[i].schlecht;
    console.log(`   Ecke (${u.ecke})`.padEnd(26) + `Einzelschritt ${String(einzel[i].schlecht).padStart(2)} von ${einzel[i].versuche}   Unterschritte ${u.schlecht} von ${u.versuche}`);
  });
  if (blind === 0) fehler.push("E5: Einzelschritt zeigt an keiner Ecke einen Durchbruch, die Probe ist blind");
}

// E6: Schleudern treten nur auf der Fläche, nur über der Schwelle, und lassen nichts durch
console.log("\nE6 Schleudern");
for (const def of STANDARD.waende.filter((w) => w.art === "schleuder")) {
  let fehlerHier = 0;
  const zeile = [];
  for (const tempo of [0.2, 0.4, 0.6, 1, 3, 6, 9]) {
    let ok = true;
    for (let i = 0; i < 6; i++) {
      const r = wandSchuss(def, "unterschritte", tempo, 0.2 + 0.12 * i, 0, (i + 0.5) / 6, 1);
      const erwarteTritt = tempo > def.kickSchwelle;
      const erwarteTreffer = tempo > P.KONST.TREFFER_MIN_TEMPO;
      // Annäherungstempo senkrecht zur Fläche = Schusstempo (Schuss senkrecht), Tritt = Normalanteil auf Trittempo
      if (r.durch) { ok = false; fehler.push(`E6: ${def.name} Tempo ${tempo}: Kugel geht durch`); }
      if (r.tritte !== (erwarteTritt ? 1 : 0)) { ok = false; fehler.push(`E6: ${def.name} Tempo ${tempo} Stelle ${i}: ${r.tritte} Tritte, erwartet ${erwarteTritt ? 1 : 0}`); }
      if (r.treffer !== (erwarteTreffer ? 1 : 0)) { ok = false; fehler.push(`E6: ${def.name} Tempo ${tempo} Stelle ${i}: ${r.treffer} Treffer-Ereignisse, erwartet ${erwarteTreffer ? 1 : 0}`); }
      if (erwarteTritt && Math.abs(r.endTempo - def.kick) > 0.05) { ok = false; fehler.push(`E6: ${def.name} Tempo ${tempo}: Austritt mit ${r.endTempo.toFixed(2)} statt ${def.kick}`); }
      if (r.endTempo > P.KONST.TEMPO_DECKEL + 1e-9) { ok = false; fehler.push(`E6: ${def.name}: Tempo über dem Deckel`); }
    }
    zeile.push(`${komma(tempo)}:${ok ? "ok" : "FEHLER"}`);
    if (!ok) fehlerHier++;
  }
  // Kappe: Schuss knapp an der Fläche vorbei auf das Ende (t < 0 oder t > 1) darf weder treten
  // noch einen Treffer melden (streifende Kappentreffer zählen nicht)
  let kappeTritte = 0, kappeTreffer = 0;
  for (const tempo of [3, 9]) for (const t of [-0.1, 1.1]) for (let i = 0; i < 6; i++) {
    const r = wandSchuss(def, "unterschritte", tempo, t, 0, (i + 0.5) / 6, 1);
    kappeTritte += r.tritte;
    kappeTreffer += r.treffer;
  }
  // Direkt am Wandobjekt: Kugel liegt an der Kappe (Mitte hinter dem Ende), fliegt schnell darauf zu
  {
    const wand = new P.Tisch({ bande: KASTEN, waende: [def], bumper: [], flipper: [] }).waende[0];
    const a = wand.a, b = wand.b;
    const u = norm(b.x - a.x, b.y - a.y);
    const n = v2(-u.y, u.x);
    for (const [ende, richtung] of [[a, -1], [b, 1]]) {
      for (const tempo of [1, 4, 9]) {
        const k = new P.Kugel(new P.Vec2(ende.x + u.x * richtung * 0.02 + n.x * 0.032, ende.y + u.y * richtung * 0.02 + n.y * 0.032),
          new P.Vec2(-n.x * tempo, -n.y * tempo));
        k.vorher.set(k.pos);
        const info = { tritt: false };
        const beruehrt = P.stossKugelWand(k, wand, info);
        if (!beruehrt) fehler.push(`E6: ${def.name}: Testkugel an der Kappe berührt die Wand nicht`);
        if (info.tritt) { kappeTritte++; }
        if (P.wandAnflug(new P.Kugel(new P.Vec2(ende.x + u.x * richtung * 0.02 + n.x * 0.032, ende.y + u.y * richtung * 0.02 + n.y * 0.032),
          new P.Vec2(-n.x * tempo, -n.y * tempo)), wand) > 0) kappeTreffer++;
      }
    }
  }
  if (kappeTritte > 0 || kappeTreffer > 0) fehler.push(`E6: ${def.name}: ${kappeTritte} Tritte und ${kappeTreffer} Treffer auf der Kappe (nur die Fläche zählt)`);
  console.log(`   ${def.name}: Tempo ${zeile.join(" ")}, Kappe: ${kappeTritte} Tritte, ${kappeTreffer} Treffer`);
}

// E7: Fallziele. Inaktiv zählen sie weder im Stoß noch als Durchschuss. Beim Wiederaufstellen mit
// einer Kugel daneben darf keine Kugel eingeschlossen oder durchgeschossen werden.
console.log("\nE7 Fallziel-Bank");
{
  const fall = STANDARD.waende.filter((w) => w.art === "fallziel");
  const bankU = Math.min(...fall.map((w) => w.a[1])), bankO = Math.max(...fall.map((w) => w.b[1]));
  const bankY = (anteil) => bankU + 0.01 + (bankO - bankU - 0.02) * anteil;    // Höhe innerhalb der Bank
  const bank = () => new P.Tisch({ bande: STANDARD.bande, bandeStosszahl: 0.35, waende: fall, bumper: [], flipper: [], schwerkraft: 0 }, "unterschritte");
  const bankMitSchwerkraft = () => new P.Tisch({ bande: STANDARD.bande, bandeStosszahl: 0.35, waende: fall, bumper: [], flipper: [] }, "unterschritte");

  // (a) inaktiv: Kugel fliegt bis zur Bande, keine Treffer, kein Durchschuss
  {
    let treffer = 0, durch = 0, versuche = 0, ohneBande = 0, zuTief = 0;
    for (const tempo of [2, 5, 9]) for (let i = 0; i < 24; i++) {
      const t = bank();
      t.schalte("fallziel", false);
      const y = bankY(i / 24);
      const k = new P.Kugel(new P.Vec2(0.4, y), new P.Vec2(-tempo, 0));
      t.kugeln = [k];
      let minX = 9, maxVx = -9;
      for (let f = 0; f < 40; f++) {
        t.vorruecken(1 / 60);
        minX = Math.min(minX, k.pos.x);
        maxVx = Math.max(maxVx, k.vel.x);
        for (const e of t.ereignisse) if (e.art === "wand") treffer++;
        t.ereignisse.length = 0;
      }
      versuche++;
      durch += t.statistik.durchschuesse + t.statistik.ausbrueche;
      if (maxVx <= 0) ohneBande++;       // die Kugel muss von der Bande (x = 0,05) zurückgeprallt sein
      if (minX < 0.05 - 1e-6) zuTief++;
    }
    console.log(`   inaktiv: ${versuche} Schüsse, ${treffer} Treffer-Ereignisse, ${durch} Durchschüsse/Ausbrüche, ${ohneBande} nicht von der Bande zurückgeprallt, ${zuTief} hinter der Bande`);
    if (treffer > 0) fehler.push(`E7: versunkene Ziele melden ${treffer} Treffer`);
    if (durch > 0) fehler.push(`E7: ${durch} Durchschüsse bei versunkenen Zielen`);
    if (ohneBande > 0) fehler.push(`E7: ${ohneBande} Kugeln prallen an der Bande hinter den versunkenen Zielen nicht zurück`);
    if (zuTief > 0) fehler.push(`E7: ${zuTief} Kugeln dringen hinter den versunkenen Zielen in die Bande ein`);
  }

  // (b) aktiv: dieselben Schüsse prallen am Ziel ab und melden genau einen Treffer
  {
    let falsch = 0, versuche = 0;
    for (const tempo of [2, 5, 9]) for (let i = 0; i < 24; i++) {
      const t = bank();
      const y = bankY(i / 24);
      const k = new P.Kugel(new P.Vec2(0.4, y), new P.Vec2(-tempo, 0));
      t.kugeln = [k];
      let treffer = 0, minX = 9;
      for (let f = 0; f < 40; f++) {
        t.vorruecken(1 / 60);
        minX = Math.min(minX, k.pos.x);
        for (const e of t.ereignisse) if (e.art === "wand") treffer++;
        t.ereignisse.length = 0;
      }
      versuche++;
      if (treffer !== 1 || minX < 0.074 - 1e-6 || t.statistik.durchschuesse > 0) falsch++;
    }
    console.log(`   aktiv: ${versuche} Schüsse, ${falsch} ohne genau einen Treffer oder mit Durchschuss`);
    if (falsch > 0) fehler.push(`E7: aktive Fallziele: ${falsch} von ${versuche} Schüssen ohne genau einen Treffer oder durchgelassen`);
  }

  // (c) Wiederaufstellen mit Kugel daneben, davor, mittendrin; ruhend, langsam, schnell; ein und zwei Kugeln
  {
    let schlecht = 0, versuche = 0, eingeschlossen = 0;
    const rnd = mulberry32(77);
    for (let i = 0; i < 400; i++) {
      const t = i % 2 ? bank() : bankMitSchwerkraft();
      t.schalte("fallziel", false);
      const anzahl = i % 5 === 0 ? 2 : 1;
      t.kugeln = [];
      for (let q = 0; q < anzahl; q++) {
        const x = 0.05 + rnd() * 0.12;               // von „in der Wand" (x 0,05) bis ein Stück davor
        const y = bankU + rnd() * (bankO - bankU);
        const tempo = [0, 0.3, 2, 6, 9][Math.floor(rnd() * 5)];
        const w = rnd() * Math.PI * 2;
        const k = new P.Kugel(new P.Vec2(x, y), new P.Vec2(Math.cos(w) * tempo, Math.sin(w) * tempo));
        if (t.kugeln.every((o) => Math.hypot(o.pos.x - x, o.pos.y - y) > 0.062)) t.kugeln.push(k);
      }
      for (let f = 0; f < Math.floor(rnd() * 6); f++) t.vorruecken(1 / 60);
      const frei = t.istFrei("fallziel");
      const liegtImWeg = t.kugeln.some((k) => ["fallziel-1", "fallziel-2", "fallziel-3"].some((n) => {
        const w = t.waende.find((x) => x.name === n);
        const c = P.naechsterPunktAufStrecke(k.pos, w.a, w.b);
        return Math.hypot(k.pos.x - c.x, k.pos.y - c.y) < k.radius + w.radius + 0.01;
      }));
      if (liegtImWeg === frei) { schlecht++; fehler.push("E7: istFrei() stimmt nicht mit der Lage der Kugeln überein"); }
      t.schalte("fallziel", true);
      for (let f = 0; f < 90; f++) t.vorruecken(1 / 60);
      versuche++;
      const nachher = t.kugeln.some((k) => {
        const innen = punktImPolygon(k);
        return !innen || !(Number.isFinite(k.pos.x) && Number.isFinite(k.pos.y));
      });
      // eingeschlossen: Kugelmitte liegt noch in einer aktiven Wand (näher als die Dicke erlaubt)
      const drin = t.kugeln.some((k) => t.waende.some((w) => {
        const c = P.naechsterPunktAufStrecke(k.pos, w.a, w.b);
        return Math.hypot(k.pos.x - c.x, k.pos.y - c.y) < k.radius + w.radius - 0.002;
      }));
      if (drin) eingeschlossen++;
      if (nachher || t.statistik.durchschuesse > 0 || t.statistik.ausbrueche > 0) {
        schlecht++;
        if (schlecht < 4) fehler.push(`E7: Wiederaufstellen ${i}: Kugel draußen oder durchgeschossen (Durchschüsse ${t.statistik.durchschuesse}, Ausbrüche ${t.statistik.ausbrueche})`);
      }
    }
    function punktImPolygon(k) { return P.punktInPolygon(k.pos, STANDARD.bande.map(([x, y]) => new P.Vec2(x, y))); }
    console.log(`   Wiederaufstellen mit Kugeln daneben: ${versuche} Läufe, ${schlecht} schlecht, ${eingeschlossen} Kugeln noch in der Wand`);
    if (eingeschlossen > 0) fehler.push(`E7: ${eingeschlossen} Kugeln stecken nach dem Wiederaufstellen in einem Fallziel`);
  }

  // (d) schalte/istFrei am Beispiel
  {
    const t = bank();
    const k = new P.Kugel(new P.Vec2(0.07, (fall[1].a[1] + fall[1].b[1]) / 2), new P.Vec2());
    t.kugeln = [k];
    const frei1 = t.istFrei("fallziel-2");
    const frei2 = t.istFrei("fallziel-3");
    const geaendert = t.schalte("fallziel", false).length;
    const nochmal = t.schalte("fallziel", false).length;
    if (frei1 !== false || frei2 !== true || geaendert !== 3 || nochmal !== 0) fehler.push("E7: schalte/istFrei verhalten sich falsch");
    console.log(`   schalte/istFrei: Kugel davor → Ziel 2 frei ${frei1}, Ziel 3 frei ${frei2}, geschaltet ${geaendert}, erneut ${nochmal}`);
  }
}

// E8: Sensoren melden jedes Durchfahren genau einmal, auch bei Tempo 9
console.log("\nE8 Sensoren (leeres Feld, Tempo 1 bis 9, senkrecht und schräg, beide Richtungen)");
{
  const synth = [
    { name: "kreis-probe", art: "probe", pos: [1.0, 1.0], radius: 0.03 },
    { name: "linie-probe", art: "probe", a: [0.5, 1.0], b: [0.62, 1.0], radius: 0.012 },
  ];
  const alle = [...STANDARD.sensoren, ...synth];
  let gesamtU = 0, falschU = 0, gesamtE = 0, falschE = 0;
  for (const def of alle) {
    const a = v2(...(def.a || def.pos));
    const b = v2(...(def.b || def.pos));
    const kreis = !def.b;
    const laenge = Math.hypot(b.x - a.x, b.y - a.y);
    const u = laenge > 0 ? norm(b.x - a.x, b.y - a.y) : v2(1, 0);
    let n0 = 0, n1 = 0, nE = 0, n1E = 0;
    for (const tempo of [1, 3, 6, 9]) for (const seite of [1, -1]) for (const winkel of [0, 0.6, -0.6]) for (let i = 0; i < 10; i++) {
      for (const modus of ["unterschritte", "einzelschritt"]) {
        const tisch = leererTisch(modus, { sensoren: [def] });
        const s = tisch.sensoren[0];
        const t = kreis ? 0 : 0.15 + 0.7 * ((i * 3) % 10) / 10;
        const ziel = v2(a.x + u.x * laenge * t, a.y + u.y * laenge * t);
        const nn = v2(-u.y * seite, u.x * seite);
        const dir = drehe(v2(-nn.x, -nn.y), winkel);
        const abstand = 0.3 + ((i + 0.5) / 10) * (tempo / 60);
        const k = new P.Kugel(new P.Vec2(ziel.x - dir.x * abstand, ziel.y - dir.y * abstand), new P.Vec2(dir.x * tempo, dir.y * tempo));
        tisch.kugeln = [k];
        let events = 0;
        const frames = Math.ceil((abstand + 0.5) / (tempo / 60)) + 2;
        for (let f = 0; f < frames; f++) {
          tisch.vorruecken(1 / 60);
          for (const e of tisch.ereignisse) if (e.art === "sensor" && e.sensor === s) events++;
          tisch.ereignisse.length = 0;
        }
        if (modus === "unterschritte") { n0++; if (events !== 1) n1++; }
        else { nE++; if (events !== 1) n1E++; }
      }
    }
    gesamtU += n0; falschU += n1; gesamtE += nE; falschE += n1E;
    if (n1 > 0) fehler.push(`E8: Sensor ${def.name}: ${n1} von ${n0} Durchfahrten nicht genau einmal gemeldet`);
    console.log("   " + def.name.padEnd(14) + `Unterschritte: ${n0 - n1} von ${n0} genau einmal   Einzelschritt: ${nE - n1E} von ${nE}`);
  }
  console.log(`   Summe: Unterschritte ${gesamtU - falschU} von ${gesamtU}, Einzelschritt ${gesamtE - falschE} von ${gesamtE}`);

  // Erneutes Melden erst nach dem Verlassen, ruhende Kugel einmal, ausgeschalteter Sensor nie
  let fz = 0;
  for (const def of alle) {
    const a = v2(...(def.a || def.pos)), b = v2(...(def.b || def.pos));
    const mitte = v2((a.x + b.x) / 2, (a.y + b.y) / 2);
    // ruhende Kugel mitten im Sensor
    {
      const t = leererTisch("unterschritte", { sensoren: [def] });
      t.kugeln = [new P.Kugel(new P.Vec2(mitte.x, mitte.y), new P.Vec2())];
      let ev = 0;
      for (let f = 0; f < 90; f++) { t.vorruecken(1 / 60); for (const e of t.ereignisse) if (e.art === "sensor") ev++; t.ereignisse.length = 0; }
      if (ev !== 1) { fz++; fehler.push(`E8: Sensor ${def.name}: ruhende Kugel meldet ${ev}-mal`); }
    }
    // hin, zurück, hin: dreimal Durchfahrt = drei Meldungen
    {
      const t = leererTisch("unterschritte", { sensoren: [def] });
      const u = def.b ? norm(b.x - a.x, b.y - a.y) : v2(1, 0);
      const nn = v2(-u.y, u.x);
      const k = new P.Kugel(new P.Vec2(mitte.x - nn.x * 0.3, mitte.y - nn.y * 0.3), new P.Vec2(nn.x * 4, nn.y * 4));
      t.kugeln = [k];
      let ev = 0, richtung = 1;
      for (let f = 0; f < 200; f++) {
        t.vorruecken(1 / 60);
        for (const e of t.ereignisse) if (e.art === "sensor") ev++;
        t.ereignisse.length = 0;
        const d = (k.pos.x - mitte.x) * nn.x + (k.pos.y - mitte.y) * nn.y;
        if (richtung === 1 && d > 0.3) { richtung = -1; k.vel.x = -nn.x * 4; k.vel.y = -nn.y * 4; }
        else if (richtung === -1 && d < -0.3) { richtung = 1; k.vel.x = nn.x * 4; k.vel.y = nn.y * 4; richtung = 2; }
        else if (richtung === 2 && d > 0.3) break;
      }
      if (ev !== 3) { fz++; fehler.push(`E8: Sensor ${def.name}: hin-zurück-hin meldet ${ev}-mal statt 3-mal`); }
    }
    // ausgeschaltet
    {
      const t = leererTisch("unterschritte", { sensoren: [def] });
      t.schalte(t.sensoren[0], false);
      t.kugeln = [new P.Kugel(new P.Vec2(mitte.x, mitte.y), new P.Vec2())];
      let ev = 0;
      for (let f = 0; f < 30; f++) { t.vorruecken(1 / 60); for (const e of t.ereignisse) if (e.art === "sensor") ev++; t.ereignisse.length = 0; }
      if (ev !== 0) { fz++; fehler.push(`E8: ausgeschalteter Sensor ${def.name} meldet ${ev}-mal`); }
    }
  }
  console.log(`   Ruhende Kugel, hin-zurück-hin, ausgeschaltet: ${fz} Fehler bei ${alle.length} Sensoren`);
}

// E9: Zündkammer (Loch) fängt, hält, wirft aus; eine gehaltene Kugel ist für andere ein festes Hindernis
console.log("\nE9 Zündkammer");
{
  const def = STANDARD.loecher[0];
  const lp = v2(...def.pos);
  const neuLoch = (modus = "unterschritte", g = 0) => leererTisch(modus, { loecher: [def], schwerkraft: g });
  let fz = 0;
  const f = (txt) => { fz++; fehler.push("E9: " + txt); };

  // Langsame Kugeln, quer von allen Seiten, werden gefangen
  let gefangen = 0, versuche = 0;
  for (const tempo of [0.3, 1, 1.7]) for (let i = 0; i < 24; i++) {
    const t = neuLoch();
    const w = (i / 24) * Math.PI * 2;
    const versatz = (((i * 7) % 10) / 10 - 0.5) * def.radius * 1.2;
    const dir = v2(-Math.cos(w), -Math.sin(w));
    const q = v2(-dir.y * versatz, dir.x * versatz);
    const k = new P.Kugel(new P.Vec2(lp.x - dir.x * 0.3 + q.x, lp.y - dir.y * 0.3 + q.y), new P.Vec2(dir.x * tempo, dir.y * tempo));
    t.kugeln = [k];
    let ev = 0;
    for (let b = 0; b < 240; b++) { t.vorruecken(1 / 60); for (const e of t.ereignisse) if (e.art === "loch") ev++; t.ereignisse.length = 0; }
    versuche++;
    if (k.gehalten && ev === 1 && k.pos.x === lp.x && k.pos.y === lp.y && k.vel.length() === 0) gefangen++;
    else f(`langsame Kugel (Tempo ${tempo}) nicht sauber gefangen (gehalten ${!!k.gehalten}, Ereignisse ${ev})`);
  }
  console.log(`   fängt: ${gefangen} von ${versuche} langsamen Kugeln, Mitte fest, Tempo 0, ein Ereignis`);

  // Schnelle Kugeln fliegen über das Loch
  let ueber = 0, vers2 = 0;
  for (const tempo of [2, 3, 6, 9]) for (let i = 0; i < 12; i++) {
    const t = neuLoch();
    const w = (i / 12) * Math.PI * 2;
    const dir = v2(-Math.cos(w), -Math.sin(w));
    const k = new P.Kugel(new P.Vec2(lp.x - dir.x * 0.4, lp.y - dir.y * 0.4), new P.Vec2(dir.x * tempo, dir.y * tempo));
    t.kugeln = [k];
    let ev = 0;
    for (let b = 0; b < 40; b++) { t.vorruecken(1 / 60); for (const e of t.ereignisse) if (e.art === "loch") ev++; t.ereignisse.length = 0; }
    vers2++;
    if (!k.gehalten && ev === 0) ueber++; else f(`schnelle Kugel (Tempo ${tempo}) wird gefangen`);
  }
  console.log(`   schnelle Kugeln (über Fanggeschwindigkeit ${def.fang}) fliegen drüber: ${ueber} von ${vers2}`);

  // Hält mit Schwerkraft, auch nach Stoß einer anderen Kugel; die zweite Kugel prallt ab und wird nicht gefangen
  {
    const t = neuLoch("unterschritte", 3);
    const k = new P.Kugel(new P.Vec2(lp.x + 0.01, lp.y + 0.01), new P.Vec2(0.2, 0));
    t.kugeln = [k];
    for (let b = 0; b < 30; b++) t.vorruecken(1 / 60);
    if (!k.gehalten) f("Kugel im Loch nicht gehalten (Schwerkraft)");
    t.ereignisse.length = 0;
    const zweite = new P.Kugel(new P.Vec2(lp.x + 0.3, lp.y), new P.Vec2(-9, 0));
    t.kugeln.push(zweite);
    t.schwerkraft.y = 0;
    let ev = 0, links = false;
    for (let b = 0; b < 60; b++) {
      t.vorruecken(1 / 60);
      for (const e of t.ereignisse) if (e.art === "loch") ev++;
      t.ereignisse.length = 0;
      if (zweite.pos.x < lp.x - 1e-9) links = true;
    }
    if (ev !== 0 || zweite.gehalten) f("zweite Kugel wird trotz besetzter Zündkammer gefangen");
    if (links) f("schnelle Kugel (Tempo 9) fliegt durch die gehaltene Kugel hindurch");
    if (k.pos.x !== lp.x || k.pos.y !== lp.y || !k.gehalten) f("gehaltene Kugel wurde von einer anderen Kugel bewegt");
    if (zweite.vel.x <= 0) f("zweite Kugel prallt an der gehaltenen nicht ab");
    console.log(`   besetzt: zweite Kugel (Tempo 9) prallt ab (${zweite.vel.x > 0}), kein Durchgang (${!links}), Gehaltene unbewegt (${k.pos.x === lp.x}), Ereignisse ${ev}`);
  }

  // Auswerfen: Tempo und Winkel, Deckel, keine sofortige Wiederholung, später wieder fangbar
  {
    const t = neuLoch();
    const k = new P.Kugel(new P.Vec2(lp.x, lp.y), new P.Vec2(0.1, 0));
    t.kugeln = [k];
    for (let b = 0; b < 10; b++) t.vorruecken(1 / 60);
    if (!k.gehalten) f("Ausgangslage: Kugel nicht gefangen");
    t.ereignisse.length = 0;
    const ok1 = t.werfeAus(k, 1.0, 0);                       // langsam, innerhalb der Fanggeschwindigkeit
    const ok2 = t.werfeAus(k);                                // zweimal geht nicht
    let ev = 0, maxAbstand = 0;
    for (let b = 0; b < 30; b++) { t.vorruecken(1 / 60); for (const e of t.ereignisse) if (e.art === "loch") ev++; t.ereignisse.length = 0; maxAbstand = Math.max(maxAbstand, k.pos.x - lp.x); }
    if (!ok1 || ok2 || k.gehalten || Math.abs(k.vel.x - 1.0) > 1e-9) f(`Auswerfen mit Tempo 1 falsch (ok1 ${ok1}, ok2 ${ok2}, vx ${k.vel.x})`);
    if (ev !== 0) f(`ausgeworfene Kugel wird sofort wieder gefangen (${ev} Ereignisse)`);
    // wieder zurückrollen lassen: jetzt muss sie wieder gefangen werden
    k.vel.x = -0.8;
    for (let b = 0; b < 90; b++) { t.vorruecken(1 / 60); for (const e of t.ereignisse) if (e.art === "loch") ev++; t.ereignisse.length = 0; }
    if (ev !== 1 || !k.gehalten) f(`zurückrollende Kugel wird nicht erneut gefangen (Ereignisse ${ev})`);
    // Standardauswurf: Tempo und Winkel aus dem Bauplan; Tempo darüber wird auf den Deckel gekappt
    t.werfeAus(k);
    const soll = v2(Math.cos(def.auswurfWinkel) * def.auswurfTempo, Math.sin(def.auswurfWinkel) * def.auswurfTempo);
    if (Math.hypot(k.vel.x - soll.x, k.vel.y - soll.y) > 1e-9) f("Standardauswurf hat nicht das Tempo aus dem Bauplan");
    k.pos.set(lp); t.loecher[0].halter = null;
    t.kugeln = [new P.Kugel(new P.Vec2(lp.x, lp.y), new P.Vec2(0.1, 0))];
    const k2 = t.kugeln[0];
    for (let b = 0; b < 10; b++) t.vorruecken(1 / 60);
    t.werfeAus(k2, 50, 1);
    if (k2.vel.length() > P.KONST.TEMPO_DECKEL + 1e-9) f(`Auswurf mit Tempo 50 ergibt ${k2.vel.length()}`);
    // stosse und schiesse lösen eine gehaltene Kugel; entferneKugel gibt das Loch wieder frei
    const t3 = neuLoch();
    const k3 = new P.Kugel(new P.Vec2(lp.x, lp.y), new P.Vec2(0.1, 0));
    t3.kugeln = [k3];
    for (let b = 0; b < 10; b++) t3.vorruecken(1 / 60);
    t3.stosse(k3, 0, 12);
    if (k3.gehalten || k3.vel.length() > P.KONST.TEMPO_DECKEL + 1e-9) f("stosse löst die Kugel nicht oder überschreitet den Deckel");
    const t4 = neuLoch();
    const k4 = new P.Kugel(new P.Vec2(lp.x, lp.y), new P.Vec2(0.1, 0));
    t4.kugeln = [k4];
    for (let b = 0; b < 10; b++) t4.vorruecken(1 / 60);
    t4.entferneKugel(k4);
    const k5 = new P.Kugel(new P.Vec2(lp.x - 0.2, lp.y), new P.Vec2(0.5, 0));
    t4.kugeln.push(k5);
    for (let b = 0; b < 90; b++) t4.vorruecken(1 / 60);
    if (!k5.gehalten) f("nach entferneKugel fängt das Loch die nächste Kugel nicht");
    console.log(`   Auswerfen, Deckel, Wiederfangen, stosse, entferneKugel: ${fz === 0 ? "alles in Ordnung" : fz + " Fehler"}`);
  }
}

// E10: Kugelpaare, frontal und streifend, Relativtempo bis 18. Fliegen die Mitten dicht genug
// aneinander vorbei (Versatz bis 0,045), MUSS ein Stoß geschehen (Geschwindigkeiten ändern sich),
// sonst sind die Kugeln ineinander durchgegangen. Dazu bleibt die Summe der Geschwindigkeiten
// gleich (gleiche Massen). Streifende Stöße ändern die Reihenfolge entlang der Achse legitim,
// deshalb taugt „Reihenfolge getauscht" hier nicht als Maß.
console.log("\nE10 Kugelpaare (ohne Schwerkraft, Relativtempo bis 18, frontal bis streifend)");
{
  let abwU = 0, abwE = 0, vers = 0, ueberlapp = 0, getroffen = 0, impulsFehler = 0;
  const rnd = mulberry32(1818);
  for (const [v1, v2t] of [[9, -9], [9, 0], [6, -6], [4, -4], [9, -3], [2, -2]]) {
    for (const versatz of [0, 0.01, 0.02, 0.035, 0.05]) {
      for (let i = 0; i < 12; i++) {
        const abst = 0.4 + ((i + 0.5) / 12) * (Math.abs(v1 - v2t) / 60);
        const w = rnd() * Math.PI * 2;
        const dir = v2(Math.cos(w), Math.sin(w));
        const q = v2(-dir.y, dir.x);
        const bauen = (modus) => {
          const t = leererTisch(modus);
          const k1 = new P.Kugel(new P.Vec2(0.5 - dir.x * abst / 2 + q.x * versatz / 2, 0.5 - dir.y * abst / 2 + q.y * versatz / 2), new P.Vec2(dir.x * v1, dir.y * v1));
          const k2 = new P.Kugel(new P.Vec2(0.5 + dir.x * abst / 2 - q.x * versatz / 2, 0.5 + dir.y * abst / 2 - q.y * versatz / 2), new P.Vec2(dir.x * v2t, dir.y * v2t));
          t.kugeln = [k1, k2];
          return t;
        };
        // Stoß erwartet, wenn die Kugelmitten dicht genug aneinander vorbeifliegen (Versatz unter 0,045)
        const stoss = versatz <= 0.045;
        const geaendert = (t) => {
          const [a1, a2] = t.kugeln;
          return Math.max(Math.hypot(a1.vel.x - v1 * dir.x, a1.vel.y - v1 * dir.y),
            Math.hypot(a2.vel.x - v2t * dir.x, a2.vel.y - v2t * dir.y)) > 0.4;
        };
        const impuls = (t) => {
          const [a1, a2] = t.kugeln;
          return Math.hypot(a1.vel.x + a2.vel.x - (v1 + v2t) * dir.x, a1.vel.y + a2.vel.y - (v1 + v2t) * dir.y);
        };
        const u = bauen("unterschritte");
        let tief = Infinity;
        for (let b = 0; b < 16; b++) {
          u.vorruecken(1 / 60);
          tief = Math.min(tief, Math.hypot(u.kugeln[1].pos.x - u.kugeln[0].pos.x, u.kugeln[1].pos.y - u.kugeln[0].pos.y));
        }
        const e = bauen("einzelschritt");
        for (let b = 0; b < 16; b++) e.vorruecken(1 / 60);
        vers++;
        if (stoss) getroffen++;
        if (stoss && !geaendert(u)) abwU++;               // Stoß verpasst = Durchgang
        if (stoss && !geaendert(e)) abwE++;
        if (impuls(u) > 1e-6) impulsFehler++;             // gleiche Massen: Summe der Geschwindigkeiten bleibt
        if (tief < 0.045) ueberlapp++;                    // höchstens ein halber Durchmesser tief
      }
    }
  }
  console.log(`   Unterschritte: von ${getroffen} Paaren mit Treffer verpassen ${abwU} den Stoß (Durchgang), ${ueberlapp} dringen tiefer als einen halben Durchmesser ein, ${impulsFehler} verletzen den Impulssatz`);
  console.log(`   Einzelschritt: ${abwE} von ${getroffen} Paaren verpassen den Stoß (muss über 0 sein, sonst ist die Probe blind)`);
  if (abwU > 0) fehler.push(`E10: ${abwU} Kugelpaare gehen ineinander durch`);
  if (ueberlapp > 0) fehler.push(`E10: ${ueberlapp} Kugelpaare dringen mehr als einen halben Durchmesser ineinander`);
  if (impulsFehler > 0) fehler.push(`E10: ${impulsFehler} Kugelpaare verletzen den Impulssatz`);
  if (abwE === 0) fehler.push("E10: Einzelschritt verpasst nie einen Stoß, die Probe ist blind");
}

// E11: Beschuss des ganzen Tisches. Zufällige Kugeln aus dem Innern, gezielt auf Wandpunkte, Enden und
// Gelenke (jedes Wandende, jede Bandenecke), Tempo bis 9, mit und ohne Schwerkraft.
console.log("\nE11 Beschuss des ganzen Tisches (alle Wände, Bumper, Flipper, Ziele, zugleich)");
{
  const poly = STANDARD.bande.map(([x, y]) => new P.Vec2(x, y));
  const punkte = [];
  for (const w of STANDARD.waende) punkte.push(w.a, w.b, [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]);
  for (const p of STANDARD.bande) punkte.push(p);
  // Die Kugel muss frei starten: im Feld, nicht in oder an einer Wand (auch nicht im Dreieck einer Schleuder),
  // einem Bumper, einem Flipper oder der Bande
  const startFrei = (t, p, poly) => {
    if (!P.punktInPolygon(p, poly) || randAbstand(p, poly) < 0.032 || p.x > 0.97) return false;
    for (const w of t.waende) {
      const c = P.naechsterPunktAufStrecke(p, w.a, w.b);
      if (Math.hypot(p.x - c.x, p.y - c.y) < 0.06) return false;
    }
    for (const b of t.bumper) if (Math.hypot(p.x - b.pos.x, p.y - b.pos.y) < b.radius + 0.06) return false;
    for (const f of t.flipper) {
      for (const d of [0, 0.5, 1]) {
        const c = P.naechsterPunktAufStrecke(p, f.pos, f.spitze(d * f.maxDrehung));
        if (Math.hypot(p.x - c.x, p.y - c.y) < f.radius + 0.06) return false;
      }
    }
    for (const l of t.loecher) if (Math.hypot(p.x - l.pos.x, p.y - l.pos.y) < 0.1) return false;
    // Dreieck der Schleudern (Fläche, Rücken, Sohle bilden eine geschlossene Figur)
    for (const gruppe of ["schleuder-l", "schleuder-r"]) {
      const hull = [];
      for (const w of t.waende.filter((x) => x.name.startsWith(gruppe))) {
        for (const e of [w.a, w.b]) if (!hull.some((h) => Math.hypot(h.x - e.x, h.y - e.y) < 1e-9)) hull.push(e);
      }
      if (hull.length === 3 && P.punktInPolygon(p, hull)) return false;
    }
    return true;
  };
  const lauf = (modus, schuesse, seed) => {
    const rnd = mulberry32(seed);
    let durch = 0, ausbruch = 0, rampenUebertritt = 0, gesehenDurch = 0;
    for (let i = 0; i < schuesse; i++) {
      const t = new P.Tisch(STANDARD, modus);
      if (i % 2) t.schwerkraft.y = 0;
      for (const f of t.flipper) f.gedrueckt = rnd() < 0.3;
      let start;
      let versuche = 0;
      do {
        start = new P.Vec2(0.03 + rnd() * 0.94, 0.1 + rnd() * 1.5);
      } while (!startFrei(t, start, poly) && ++versuche < 800);
      const ziel = punkte[Math.floor(rnd() * punkte.length)];
      const d = norm(ziel[0] - start.x + (rnd() - 0.5) * 0.03, ziel[1] - start.y + (rnd() - 0.5) * 0.03);
      const tempo = 1 + rnd() * 8;
      const k = new P.Kugel(start, new P.Vec2(d.x * tempo, d.y * tempo));
      t.kugeln = [k];
      let vorher = k.pos.clone();
      for (let b = 0; b < 60; b++) {
        t.vorruecken(1 / 60);
        if (trennwandGequert(vorher, k.pos)) rampenUebertritt++;
        vorher = k.pos.clone();
        if (t.kugeln[0].gehalten) t.werfeAus(k);
        t.ereignisse.length = 0;
      }
      durch += t.statistik.durchschuesse;
      ausbruch += t.statistik.ausbrueche;
    }
    return { durch, ausbruch, rampenUebertritt };
  };
  const e = lauf("einzelschritt", 2000, 1111);
  const u = lauf("unterschritte", 2000, 1111);
  console.log(`   Einzelschritt: ${e.durch} Durchschüsse, ${e.ausbruch} Ausbrüche, ${e.rampenUebertritt} Übertritte Rampe↔Feld`);
  console.log(`   Unterschritte: ${u.durch} Durchschüsse, ${u.ausbruch} Ausbrüche, ${u.rampenUebertritt} Übertritte Rampe↔Feld`);
  if (u.durch > 0 || u.ausbruch > 0 || u.rampenUebertritt > 0) fehler.push(`E11: ganzer Tisch lässt etwas durch (${u.durch} Durchschüsse, ${u.ausbruch} Ausbrüche, ${u.rampenUebertritt} Übertritte)`);
  if (e.durch + e.ausbruch === 0) fehler.push("E11: Einzelschritt zeigt auf dem ganzen Tisch keinen Durchschuss, die Probe ist blind");
}

// E12: Zufallsspiel auf dem neuen Tisch mit allem, was ein Regelwerk tut: Abschuss, Flippern, Schubsen,
// Zündkammer auswerfen, Kickback, Fallziele versenken und wieder aufstellen, ein bis drei Kugeln
function zufallsspielNeu(modus, laeufe, seed, sekunden = 30) {
  const rnd = mulberry32(seed);
  let uebertritt = 0, durch = 0, ausbruch = 0, draussen = 0, nichtEndlich = 0, ueberDeckel = 0, kugelnVerloren = 0;
  let hoechst = 0;
  let einwegDurch = 0;
  for (let l = 0; l < laeufe; l++) {
    const t = new P.Tisch(STANDARD, modus);
    const einweg = einwegWaechter(t);   // für E15: zählt nur mit, ändert nichts an der Physik
    const nKugeln = 1 + (l % 3);
    for (let q = 0; q < nKugeln; q++) t.legeKugelNach();
    const polyV = t.bande;
    let bankPause = 0;
    const letzte = new Map();
    for (let b = 0; b < sekunden * 60; b++) {
      for (const k of t.kugeln) {
        const inR = k.pos.x > STANDARD.rampe.xMin && k.pos.y < STANDARD.rampe.yMax;
        if (inR && Math.abs(k.vel.y) < 0.05 && rnd() < 0.05) k.vel.y = 1.8 + rnd() ** 1.5 * 3.6;
        if (rnd() < 0.01) t.stosse(k, (rnd() < 0.5 ? -1 : 1) * 0.45 * rnd(), rnd() * 0.45);
      }
      if (rnd() < 0.12) t.flipper[0].gedrueckt = rnd() < 0.5;
      if (rnd() < 0.12) t.flipper[1].gedrueckt = rnd() < 0.5;
      t.vorruecken(1 / 60);
      for (const e of t.ereignisse) {
        if (e.art === "wand" && e.wand.art === "fallziel" && e.wand.aktiv) { t.schalte(e.wand, false); bankPause = 1; }
        else if (e.art === "sensor" && e.sensor.art === "kickback" && e.kugel.vel.y < 0) t.kickback(e.kugel);
      }
      t.ereignisse.length = 0;
      for (const k of t.kugeln) if (k.gehalten) { k.halt = (k.halt || 0) + 1 / 60; if (k.halt > 1) { k.halt = 0; t.werfeAus(k, 2.4, 0.3 + rnd() * 2.4); } }
      if (t.waehle("fallziel").every((w) => !w.aktiv)) { bankPause -= 1 / 60; if (bankPause <= 0 && t.istFrei("fallziel")) t.schalte("fallziel", true); }
      for (const k of [...t.kugeln]) {
        const vor = letzte.get(k);
        if (vor && trennwandGequert(vor, k.pos)) uebertritt++;
        letzte.set(k, k.pos.clone());
        if (!Number.isFinite(k.pos.x) || !Number.isFinite(k.pos.y) || !Number.isFinite(k.vel.x) || !Number.isFinite(k.vel.y)) nichtEndlich++;
        else if (!P.punktInPolygon(k.pos, polyV)) draussen++;
        if (modus === "unterschritte" && k.vel.length() > P.KONST.TEMPO_DECKEL + 1e-9) ueberDeckel++;
        hoechst = Math.max(hoechst, k.vel.length());
        if (k.pos.y < STANDARD.abfluss.yMax && k.pos.x > STANDARD.abfluss.xMin && k.pos.x < STANDARD.abfluss.xMax) {
          t.entferneKugel(k); kugelnVerloren++;
          letzte.delete(k);
          t.legeKugelNach();
        }
      }
    }
    durch += t.statistik.durchschuesse;
    ausbruch += t.statistik.ausbrueche;
    einwegDurch += einweg.durch;
  }
  return { uebertritt, durch, ausbruch, draussen, nichtEndlich, ueberDeckel, kugelnVerloren, hoechst, einwegDurch };
}

// E15-Wächter (Abschnitt 4): Der eingebaute Zähler (durchschussOrt) überspringt Einwegwände, weil eine Kugel von
// der offenen Seite ja hindurch darf. E11 und E12 sehen deshalb nicht, wenn eine Kugel von der GEHALTENEN Seite
// durch das Tor oder ein Dach tunnelt; E4 beschießt jede Einwegwand nur allein. Der Wächter sitzt auf tisch.pruefe
// (läuft je Kugel und Unterschritt nach allen Stößen) und führt die Durchfahrt selbst, unabhängig von der Physik:
// Eine Kugel ist auf Durchfahrt, wenn sie die Berührzone (Abstand bis Kugelradius plus Wandradius) von der offenen
// Seite betreten und seitdem nicht verlassen hat. Wechselt die Kugelmitte innerhalb der Wandlänge von der gehaltenen
// auf die offene Seite, ohne auf Durchfahrt zu sein, ist sie durchgetunnelt. Er zählt nur und ruft danach die echte
// Prüfung auf.
function einwegWaechter(t) {
  const waende = t.waende.filter((w) => w.einweg).map((w) => ({ w, fahrt: new WeakSet() }));
  const z = { durch: 0, orte: {}, durchfahrten: 0 };
  const abstand = (p, w) => { const c = P.naechsterPunktAufStrecke(p, w.a, w.b); return Math.hypot(p.x - c.x, p.y - c.y); };
  const echtePruefung = t.pruefe.bind(t);
  t.pruefe = (k) => {
    for (const { w, fahrt } of waende) {
      if (!w.aktiv) { fahrt.delete(k); continue; }
      const zone = k.radius + w.radius;
      const vorherDrin = abstand(k.vorher, w) <= zone;
      const jetztDrin = abstand(k.pos, w) <= zone;
      const alt = P.lageZurStrecke(k.vorher, w.a, w.b);
      const neu = P.lageZurStrecke(k.pos, w.a, w.b);
      if (!vorherDrin && jetztDrin && vorzeichen(alt.seite) === -w.einweg) { fahrt.add(k); z.durchfahrten++; }
      if (vorzeichen(alt.seite) === w.einweg && vorzeichen(neu.seite) === -w.einweg &&
          alt.t >= 0 && alt.t <= 1 && neu.t >= 0 && neu.t <= 1 && !fahrt.has(k)) {
        z.durch++;
        z.orte[w.name] = (z.orte[w.name] || 0) + 1;
      }
      if (!jetztDrin) fahrt.delete(k);
    }
    echtePruefung(k);
  };
  return z;
}
let e12Einweg = null;
console.log("\nE12 Zufallsspiel auf dem neuen Tisch (1 bis 3 Kugeln, Zündkammer, Kickback, Fallziele, Schubser)");
{
  const e = zufallsspielNeu("einzelschritt", 45, 31337);
  const u = zufallsspielNeu("unterschritte", 60, 31337);
  const zeile = (r) => `${r.uebertritt} Übertritte Rampe↔Feld, ${r.durch} Durchschüsse, ${r.ausbruch + r.draussen} Ausbrüche, ${r.nichtEndlich} nicht endliche Werte, ${r.kugelnVerloren} Verluste, höchstes Tempo ${komma(r.hoechst, 2)}`;
  console.log(`   Einzelschritt: ${zeile(e)}`);
  console.log(`   Unterschritte: ${zeile(u)}`);
  for (const [was, n] of [["Übertritte", u.uebertritt], ["Durchschüsse", u.durch], ["Ausbrüche", u.ausbruch + u.draussen], ["nicht endliche Werte", u.nichtEndlich], ["Kugeln über dem Tempodeckel", u.ueberDeckel]]) {
    if (n > 0) fehler.push(`E12: Zufallsspiel Unterschritte: ${n} ${was}`);
  }
  if (e.durch + e.ausbruch + e.draussen + e.uebertritt === 0) fehler.push("E12: Einzelschritt zeigt im Zufallsspiel keinen einzigen Fehler, die Probe ist blind");
  e12Einweg = { e: e.einwegDurch, u: u.einwegDurch };
}

// E13: Engstellen. Alle Abstände zwischen festen Teilen (Wände, Bande, Bumper, Flipper in drei Stellungen,
// Zündkammer). Schlitze zwischen 0,003 und 0,075 klemmen oder halten eine Kugel an: nur bekannte, harmlose erlaubt.
console.log("\nE13 Engstellen (Abstand zwischen festen Teilen kleiner als Kugeldurchmesser plus 0,015)");
{
  const streckeStrecke = (a, b, c, d) => {
    if (P.streckenSchneiden(a, b, c, d)) return 0;
    const ab = (p, q, r) => { const n = P.naechsterPunktAufStrecke(p, q, r); return Math.hypot(p.x - n.x, p.y - n.y); };
    return Math.min(ab(a, c, d), ab(b, c, d), ab(c, a, b), ab(d, a, b));
  };
  const t = new P.Tisch(STANDARD);
  const teile = [];
  for (const w of t.waende) teile.push({ n: w.name, a: w.a, b: w.b, r: w.radius, art: "wand" });
  for (let i = 0; i < t.bande.length; i++) teile.push({ n: "bande-" + i, a: t.bande[i], b: t.bande[(i + 1) % t.bande.length], r: 0, art: "bande" });
  for (const b of t.bumper) teile.push({ n: "bumper(" + b.pos.x + "|" + b.pos.y + ")", a: b.pos, b: b.pos, r: b.radius, art: "bumper" });
  t.flipper.forEach((f, i) => { for (const d of [0, 0.5, 1]) teile.push({ n: `flipper${i}@${d}`, a: f.pos, b: f.spitze(d * f.maxDrehung), r: f.radius, art: "flipper" }); });
  for (const l of t.loecher) teile.push({ n: l.name, a: l.pos, b: l.pos, r: 0, art: "loch" });
  // erlaubt, weil harmlos (jeweils mit Grund):
  const erlaubt = [
    ["flipper0@0.5", "flipper1@0.5", "die Flipper kreuzen sich beim Schlag; der Spalt ist enger als die Kugel, das ist gewollt"],
    ["flipper0@0", "flipper1@0", "Abfluss-Spalt in Ruhe (0,069 für die Kugel 0,060), fester Teil des Spiels"],
    ["flipper0@1", "flipper1@1", "Spalt bei beiden Flippern oben, wie in Ruhe"],
    ["fallziel-1", "fallziel-3", "liegen in einer Reihe, das Ziel dazwischen füllt den Spalt"],
    ["standup-1", "standup-3", "liegen in einer Reihe, das Ziel dazwischen füllt den Spalt"],
    ["tor", "standup-3", "Tasche zwischen Ziel und Tor ist zur Trennwand hin zu"],
    ["trennwand", "bande-0", "Spalt zwischen Wandende und Bodenecke führt in den toten Winkel unter dem Rampenboden"],
  ];
  const gefunden = [];
  for (let i = 0; i < teile.length; i++) {
    for (let j = i + 1; j < teile.length; j++) {
      const p = teile[i], q = teile[j];
      if (p.art === "bande" && q.art === "bande") continue;
      if (p.art === "flipper" && q.art === "flipper" && p.n.slice(0, 8) === q.n.slice(0, 8)) continue;
      let gap;
      if (p.art === "loch" || q.art === "loch") {
        const lo = p.art === "loch" ? p : q, an = p.art === "loch" ? q : p;
        gap = streckeStrecke(lo.a, lo.a, an.a, an.b) - an.r - 0.035;   // Fangradius
      } else gap = streckeStrecke(p.a, p.b, q.a, q.b) - p.r - q.r;
      if (gap > 0.003 && gap < 0.075) gefunden.push({ gap, p: p.n, q: q.n });
    }
  }
  let unbekannt = 0;
  for (const g of gefunden.sort((x, y) => x.gap - y.gap)) {
    const bekannt = erlaubt.find(([a, b]) => (a === g.p && b === g.q) || (a === g.q && b === g.p));
    if (!bekannt) { unbekannt++; fehler.push(`E13: Engstelle ${komma(g.gap, 3)} zwischen ${g.p} und ${g.q}`); }
    console.log(`   ${komma(g.gap, 3)}  ${g.p} ↔ ${g.q}  ${bekannt ? "(erlaubt: " + bekannt[2] + ")" : "<-- UNBEKANNT"}`);
  }
  // Lichte Weiten der wichtigen Gassen (Kugel 0,060)
  const get = (n) => t.waende.find((w) => w.name === n);
  const abstandWand = (n1, n2) => { const a = get(n1), b = get(n2); return streckeStrecke(a.a, a.b, b.a, b.b) - a.radius - b.radius; };
  const outlane = 0.14 - 0.01 - 0.02;      // Führung (Mitte 0,14, Dicke 0,01) zur Bande bei x = 0,02
  const inlane = abstandWand("fuehrung-l-aussen", "schleuder-l-ruecken");
  const luecke = (n1, n2) => abstandWand(n1, n2);
  const l1 = luecke("rinne-3", "rinne-4"), l2 = luecke("rinne-2", "rinne-3"), l3 = luecke("rinne-1", "rinne-2");
  console.log(`   Lichte Weiten: Outlane ${komma(outlane, 3)}, Inlane ${komma(inlane, 3)}, Gassen ${komma(l1, 3)} | ${komma(l2, 3)} | ${komma(l3, 3)} (Kugel 0,060)`);
  for (const [n, w] of [["Outlane", outlane], ["Inlane", inlane], ["Gasse 1", l1], ["Gasse 2", l2], ["Gasse 3", l3]]) {
    if (w < 0.09) fehler.push(`E13: ${n} nur ${komma(w, 3)} breit (mindestens 0,090 für eine Kugel von 0,060)`);
  }
  console.log(`   ${unbekannt} unbekannte Engstellen`);
}

// E14: Erreichbarkeit. Ein einfacher Automat spielt auf dem echten Tisch und zählt, was er trifft.
//   Strategie 0: zufälliges Drücken
//   Strategie 1: gezieltes Drücken (Kugel dicht über dem Arm → schlagen)
//   Strategie 2: Fangmulde (Flipper oben halten, loslassen, nach kurzer Pause schlagen)
//   vierter Lauf: jede Kugel wechselt die Strategie zufällig (Mehrkugelspiel stresst E12)
// Kickback ist einmal je Kugel an, Zündkammer wirft nach 1 s aus, versunkene Fallziele stehen nach
// 1,2 s wieder auf (wie in index.html). Die Kugel wird nach einem Verlust neu abgeschossen.
function automat(strategie, minuten, seed, kugeln = 1) {
  const rnd = mulberry32(seed);
  const t = new P.Tisch(STANDARD, "unterschritte");
  const FL = t.flipper;
  const treffer = {};
  const zaehle = (n) => { treffer[n] = (treffer[n] || 0) + 1; };
  const stellen = [];
  const gemeldet = new Set();
  const erste = { L: 0, A: 0, D: 0 };
  const dt = 1 / 60;
  const inRampe = (k) => k.pos.x > STANDARD.rampe.xMin && k.pos.y < STANDARD.rampe.yMax;
  const imAbfluss = (k) => k.pos.y < STANDARD.abfluss.yMax && k.pos.x > STANDARD.abfluss.xMin && k.pos.x < STANDARD.abfluss.xMax;
  let zeit = 0, imFeld = 0, bankPause = 0, kickbackAn = true, wartet = 0, offeneGasse = true;
  let letzteFlipper = 0;
  const vorherGedrueckt = [false, false];
  const halten = [0, 0], sperre = [0, 0], kuehl = [0, 0], plan = [null, null];
  let verluste = 0, durch = 0;

  function neueKugel() {
    const k = t.legeKugelNach();
    kickbackAn = true;
    offeneGasse = true;
    // Abschussstärke: halb im Bereich der Gassen (33–63 %), halb über alles
    const stark = rnd() < 0.5 ? 0.33 + rnd() * 0.3 : 0.28 + rnd() * 0.72;
    k.vel.y = 1.8 + stark * 3.6;
    return k;
  }
  for (let q = 0; q < kugeln; q++) neueKugel();

  for (let b = 0; b < (minuten * 60) / dt; b++) {
    zeit += dt;
    if (wartet > 0) { wartet -= dt; if (wartet <= 0) neueKugel(); }
    // Steuerung nach der Kugel, die am tiefsten im Feld steht
    const k0 = t.kugeln.filter((k) => !inRampe(k) || k.pos.y > 0.3).sort((p, q) => p.pos.y - q.pos.y)[0];
    for (let i = 0; i < 2; i++) {
      const f = FL[i];
      if (sperre[i] > 0) sperre[i] -= dt;
      if (kuehl[i] > 0) kuehl[i] -= dt;
      if (halten[i] > 0) { halten[i] -= dt; f.gedrueckt = true; if (halten[i] <= 0) { f.gedrueckt = false; sperre[i] = 0.05; } }
      if (!k0) continue;
      const s = k0.strat ?? (k0.strat = strategie ?? Math.floor(rnd() * 3));
      const vorz = i === 0 ? 1 : -1;
      if (s !== 0 && halten[i] <= 0) f.gedrueckt = false;     // von Strategie 0 übrig gebliebenes Drücken lösen
      if (s === 0) {
        if (rnd() < 0.08) f.gedrueckt = !f.gedrueckt;
        continue;
      }
      const dx = (k0.pos.x - f.pos.x) * vorz;
      const nah = dx > -0.02 && dx < 0.26 && k0.pos.y < 0.36 && k0.pos.y > 0.08;
      const abst = k0.pos.y - f.pos.y;
      if (s === 1) {
        if (nah && k0.vel.y < 0.3 && sperre[i] <= 0 && !f.gedrueckt && halten[i] <= 0 && abst < 0.12 + rnd() * 0.1) halten[i] = 0.18 + rnd() * 0.2;
      } else {
        if (nah && sperre[i] <= 0 && kuehl[i] <= 0 && !f.gedrueckt && halten[i] <= 0 && !plan[i] && k0.vel.length() < 4 && abst < 0.14) {
          halten[i] = 0.6 + rnd() * 0.8;
          plan[i] = { loesen: true, tau: rnd() * 0.3 };
        }
        if (plan[i] && halten[i] <= 0 && plan[i].loesen) { plan[i].loesen = false; plan[i].bis = plan[i].tau; }
        else if (plan[i] && !plan[i].loesen) {
          plan[i].bis -= dt;
          if (plan[i].bis <= 0) { halten[i] = 0.25; plan[i] = null; kuehl[i] = 1.5; }   // nach dem Schlag nicht gleich wieder fangen
        }
      }
    }
    for (let i = 0; i < 2; i++) if (FL[i].gedrueckt !== vorherGedrueckt[i]) { letzteFlipper = zeit; vorherGedrueckt[i] = FL[i].gedrueckt; }

    t.vorruecken(dt);
    for (const e of t.ereignisse) {
      if (e.art === "bumper") zaehle("bumper-" + (t.bumper.indexOf(e.bumper) + 1));
      else if (e.art === "wand") {
        zaehle(e.wand.name);
        if (e.wand.art === "fallziel" && e.wand.aktiv) { t.schalte(e.wand, false); bankPause = 1.2; }
      } else if (e.art === "sensor") {
        const s = e.sensor;
        if (s.art === "gasse") {
          if (e.kugel.vel.y < 0) {
            zaehle(s.name);
            if (offeneGasse) { offeneGasse = false; erste[{ "gasse-1": "L", "gasse-2": "A", "gasse-3": "D" }[s.name]]++; }
          }
        } else if (s.art === "kickback") {
          if (e.kugel.vel.y < 0 && kickbackAn) { zaehle("kickback"); t.kickback(e.kugel); kickbackAn = false; }
        } else zaehle(s.name);
      } else if (e.art === "loch") zaehle("zuendkammer");
      else if (e.art === "durchschuss" || e.art === "ausbruch") durch++;
    }
    t.ereignisse.length = 0;
    for (const k of t.kugeln) if (k.gehalten) { k.halt = (k.halt || 0) + dt; if (k.halt >= 1.0) { k.halt = 0; t.werfeAus(k); } }
    if (t.waehle("fallziel").every((w) => !w.aktiv)) {
      bankPause -= dt;
      if (bankPause <= 0 && t.istFrei("fallziel")) t.schalte("fallziel", true);
    }

    let imFeldJetzt = false;
    for (const k of [...t.kugeln]) {
      if (imAbfluss(k)) {
        t.entferneKugel(k); verluste++;
        if (t.kugeln.length < kugeln) wartet = 0.8;
        continue;
      }
      if (!inRampe(k)) imFeldJetzt = true;
      // „steht": fast keine Geschwindigkeit länger als 3 s (nicht in der Zündkammer, nicht auf der Rampe)
      // Wer den Flipper hält, hält die Kugel mit Absicht: dann gilt „steht" nicht.
      const gehalten = FL[0].gedrueckt || FL[1].gedrueckt;
      if (!k.gehalten && !inRampe(k) && !gehalten && k.ruhe > 3) {
        const sl = k.pos.x.toFixed(2) + "|" + k.pos.y.toFixed(2);
        if (!gemeldet.has("steht" + sl)) { gemeldet.add("steht" + sl); stellen.push(`steht bei (${sl}) ab ${zeit.toFixed(0)} s`); }
        t.stosse(k, (rnd() - 0.5) * 0.9, 0.45);
      }
      // oder bleibt trotz Bewegung in einem kleinen Kreis (Zittern in einer Ecke); wer gerade flippert, ist ausgenommen
      if (!k.gehalten && !inRampe(k) && !gehalten && zeit - letzteFlipper > 2) {
        const an = k.anker;
        if (!an || Math.hypot(k.pos.x - an.x, k.pos.y - an.y) > 0.05) k.anker = { x: k.pos.x, y: k.pos.y, t: zeit };
        else if (zeit - an.t > 4) {
          const sl = an.x.toFixed(2) + "|" + an.y.toFixed(2);
          if (!gemeldet.has("zittert" + sl)) { gemeldet.add("zittert" + sl); stellen.push(`zittert bei (${sl}) ab ${zeit.toFixed(0)} s`); }
          t.stosse(k, (rnd() - 0.5) * 0.9, 0.45);
          k.anker = null;
        }
      } else k.anker = null;
      // zu schwacher Abschuss: auf der Rampe liegen geblieben, neu schießen
      if (inRampe(k) && k.ruhe > 1.0 && k.pos.y < 0.3) { k.vel.y = 1.8 + (0.28 + rnd() * 0.72) * 3.6; offeneGasse = true; kickbackAn = true; }
    }
    if (imFeldJetzt) imFeld += dt;
  }
  return { treffer, stellen, erste, verluste, durch, imFeld, statistik: t.statistik };
}

console.log("\nE14 Erreichbarkeit: Automat spielt (Kugel im Feld, Treffer je Minute)");
{
  const NAMEN = [
    ["bumper-1", "Bumper links"], ["bumper-2", "Bumper rechts"], ["bumper-3", "Bumper Mitte"],
    ["schleuder-l-flaeche", "Schleuder links"], ["schleuder-r-flaeche", "Schleuder rechts"],
    ["standup-1", "Standup 1 (unten)"], ["standup-2", "Standup 2"], ["standup-3", "Standup 3 (oben)"],
    ["fallziel-1", "Fallziel 1 (unten)"], ["fallziel-2", "Fallziel 2"], ["fallziel-3", "Fallziel 3 (oben)"],
    ["gasse-1", "Gasse L"], ["gasse-2", "Gasse A"], ["gasse-3", "Gasse D"],
    ["inlane-l", "Inlane links"], ["inlane-r", "Inlane rechts"], ["outlane-l", "Outlane links"], ["outlane-r", "Outlane rechts"],
    ["kickback", "Kickback"], ["zuendkammer", "Zündkammer"],
  ];
  const MIN_JE_MINUTE = 0.2;
  const laeufe = [];
  for (const [strategie, kugeln, minuten, seed] of [[0, 1, 12, 101], [1, 1, 12, 102], [2, 1, 12, 103], [null, 1, 12, 104]]) {
    laeufe.push(automat(strategie, minuten, seed, kugeln));
  }
  const minGesamt = laeufe.reduce((s, r) => s + r.imFeld, 0) / 60;
  const summe = {};
  for (const r of laeufe) for (const [n, c] of Object.entries(r.treffer)) summe[n] = (summe[n] || 0) + c;
  console.log("   Bauteil               zufällig  gezielt  Fangmulde  gemischt   je Minute (alle)");
  for (const [n, anzeige] of NAMEN) {
    const je = laeufe.map((r) => String(r.treffer[n] || 0).padStart(8));
    const rate = (summe[n] || 0) / minGesamt;
    console.log("   " + anzeige.padEnd(20) + je.join(" ") + "   " + komma(rate, 2).padStart(8));
    if (rate < MIN_JE_MINUTE) fehler.push(`E14: ${anzeige} wird nur ${komma(rate, 2)} mal je Minute getroffen (mindestens ${komma(MIN_JE_MINUTE, 1)})`);
  }
  const verluste = laeufe.reduce((s, r) => s + r.verluste, 0);
  const durchA = laeufe.reduce((s, r) => s + r.durch, 0);
  console.log(`   Kugel im Feld insgesamt ${komma(minGesamt, 1)} min, ${verluste} Verluste (im Mittel ${komma((minGesamt * 60) / verluste, 1)} s je Kugel), ${durchA} Durchschüsse/Ausbrüche`);
  const stellen = laeufe.flatMap((r) => r.stellen);
  console.log(`   Stellen, an denen eine Kugel länger als 3 s fast steht oder zittert: ${stellen.length ? stellen.join("; ") : "keine"}`);
  for (const s of stellen) fehler.push("E14: Klemmstelle: " + s);
  if (durchA > 0) fehler.push(`E14: ${durchA} Durchschüsse oder Ausbrüche im Automatenspiel`);
  const hoechst = Math.max(...laeufe.map((r) => r.statistik.hoechstesTempo));
  if (hoechst > P.KONST.TEMPO_DECKEL + 1e-9) fehler.push(`E14: höchstes Tempo ${hoechst} über dem Deckel`);
}

// Skill Shot: Welche Gasse trifft die abgeschossene Kugel zuerst, je nach Stärke? (Tempo wie in index.html)
console.log("\nE14b Skill Shot: erste Gasse nach der Abschussstärke (Ladung 30 bis 56 %; darüber prallt die Kugel am Anschlag zurück)");
{
  const bandenGrenzen = { D: [], A: [], L: [], keine: [] };
  const zeile = [];
  for (let l = 30; l <= 56; l++) {
    const t = new P.Tisch(STANDARD);
    const k = new P.Kugel(new P.Vec2(...STANDARD.rampe.start));
    t.kugeln = [k];
    k.vel.y = 1.8 + (l / 100) * 3.6;
    let gasse = "keine";
    for (let b = 0; b < 900 && gasse === "keine"; b++) {
      t.vorruecken(1 / 60);
      for (const e of t.ereignisse) if (e.art === "sensor" && e.sensor.art === "gasse" && gasse === "keine") gasse = { "gasse-1": "L", "gasse-2": "A", "gasse-3": "D" }[e.sensor.name];
      t.ereignisse.length = 0;
      if (k.pos.y < STANDARD.abfluss.yMax) break;
    }
    bandenGrenzen[gasse].push(l);
  }
  const bereich = (a) => (a.length ? `${a[0]}–${a[a.length - 1]} % (${a.length} Stufen)` : "nie");
  console.log(`   Gasse D (rechts):  ${bereich(bandenGrenzen.D)}`);
  console.log(`   Gasse A (Mitte):   ${bereich(bandenGrenzen.A)}`);
  console.log(`   Gasse L (links):   ${bereich(bandenGrenzen.L)}`);
  console.log(`   keine Gasse:       ${bereich(bandenGrenzen.keine)}`);
  for (const g of ["D", "A", "L"]) if (bandenGrenzen[g].length < 4) fehler.push(`E14b: Gasse ${g} wird nur von ${bandenGrenzen[g].length} Abschussstärken (je 1 %) getroffen`);
  const letztes = (a) => (a.length ? a[a.length - 1] : Infinity);
  if (!(letztes(bandenGrenzen.D) < bandenGrenzen.A[0] && letztes(bandenGrenzen.A) < bandenGrenzen.L[0])) fehler.push("E14b: die Reihenfolge D, A, L nach Abschussstärke stimmt nicht (die Bereiche überlappen)");
}

// Fangmulde: Flipper oben halten, Kugel kommt zur Ruhe, loslassen, nach tau erneut schlagen.
// Wie breit ist das Zeitfenster (in 4-ms-Stufen), in dem die Kugel ein Bauteil trifft?
console.log("\nE14c Anspielen aus der Fangmulde (Flipper loslassen, nach tau schlagen, tau 0 bis 500 ms in 4-ms-Stufen)");
{
  const scan = (seite) => {
    const i = seite === "links" ? 0 : 1;
    const fenster = {};
    let verlorenOhneTreffer = 0, n = 0;
    for (let tau = 0; tau <= 0.5 + 1e-9; tau += 0.004) {
      const t = new P.Tisch(STANDARD);
      const f = t.flipper[i];
      f.gedrueckt = true;
      const k = new P.Kugel(new P.Vec2(i === 0 ? 0.40 : 0.60, 0.5), new P.Vec2());
      t.kugeln = [k];
      let ruhig = 0;
      for (let b = 0; b < 600 && ruhig < 30; b++) { t.vorruecken(1 / 120); ruhig = k.vel.length() < 0.05 ? ruhig + 1 : 0; }
      if (ruhig < 30) continue;
      n++;
      t.ereignisse.length = 0;
      f.gedrueckt = false;
      const getroffen = new Set();
      let zeit = 0, gedr = false, halt = 0;
      while (zeit < 8) {
        if (!gedr && zeit >= tau) { f.gedrueckt = true; gedr = true; }
        if (gedr && zeit >= tau + 0.35) f.gedrueckt = false;
        t.vorruecken(1 / 120);
        zeit += 1 / 120;
        for (const e of t.ereignisse) {
          if (e.art === "bumper") getroffen.add("Bumper " + (t.bumper.indexOf(e.bumper) + 1));
          else if (e.art === "wand" && e.wand.art !== "wand") getroffen.add(e.wand.name);
          else if (e.art === "sensor" && e.sensor.art === "gasse") getroffen.add(e.sensor.name);
          else if (e.art === "loch") getroffen.add("zuendkammer");
        }
        t.ereignisse.length = 0;
        if (k.gehalten && (halt += 1 / 120) > 1) { halt = 0; t.werfeAus(k); }
        if (k.pos.y < STANDARD.abfluss.yMax) break;
      }
      for (const g of getroffen) fenster[g] = (fenster[g] || 0) + 4;
    }
    return fenster;
  };
  const ziele = ["standup-1", "standup-2", "standup-3", "fallziel-1", "fallziel-2", "fallziel-3", "zuendkammer", "gasse-1", "gasse-2", "gasse-3"];
  const links = scan("links"), rechts = scan("rechts");
  const text = (f) => ziele.filter((z) => f[z]).map((z) => `${z} ${f[z]} ms`).join(", ") || "nichts davon";
  console.log(`   linker Flipper:  ${text(links)}`);
  console.log(`   rechter Flipper: ${text(rechts)}`);
  const standupLinks = ["standup-1", "standup-2", "standup-3"].some((z) => links[z]);
  const fallRechts = ["fallziel-1", "fallziel-2", "fallziel-3"].some((z) => rechts[z]);
  if (!standupLinks) fehler.push("E14c: aus der Fangmulde des linken Flippers ist kein Standup-Ziel gezielt anspielbar");
  if (!fallRechts) fehler.push("E14c: aus der Fangmulde des rechten Flippers ist kein Fallziel gezielt anspielbar");
}

// E15 (Abschnitt 4, Prüfrunde): Einwegwände im ganzen Tisch, von der gehaltenen Seite. Der Wächter (einwegWaechter,
// siehe E12) zählt jeden Durchgang. a) Beschuss: eine Kugel fliegt mit Tempo 1 bis 9 von der gehaltenen Seite auf
// einen Punkt des Tors oder eines Dachs (auch die Enden), in der Hälfte der Läufe liegt dort schon eine zweite Kugel
// (die Kugel auf dem Dach wird in die Wand gedrückt), in einem Viertel fliegt eine dritte dazwischen; Flipper zufällig,
// teils ohne Schwerkraft. b) das Zufallsspiel aus E12 (1 bis 3 Kugeln, eine Minute je Lauf) mit dem Wächter.
console.log("\nE15 Einwegwände (Tor, Dächer) von der gehaltenen Seite im ganzen Tisch, mit Kugelpaaren");
{
  const EINWEG = STANDARD.waende.filter((w) => w.einweg);
  const dreiecke = ["schleuder-l", "schleuder-r"].map((gruppe) => {
    const ecken = [];
    for (const w of STANDARD.waende.filter((x) => x.gruppe === gruppe)) {
      for (const e of [w.a, w.b]) if (!ecken.some((h) => Math.hypot(h.x - e[0], h.y - e[1]) < 1e-9)) ecken.push(v2(e[0], e[1]));
    }
    return ecken;
  });
  const lauf = (modus, schuesse, seed) => {
    const rnd = mulberry32(seed);
    let durch = 0, sonst = 0, kugelnGesamt = 0, beruehrt = 0;
    const orte = {};
    for (let i = 0; i < schuesse; i++) {
      const t = new P.Tisch(STANDARD, modus);
      const waechter = einwegWaechter(t);
      if (i % 4 === 3) t.schwerkraft.y = 0;
      for (const f of t.flipper) f.gedrueckt = rnd() < 0.3;
      const w = t.waende.filter((x) => x.einweg)[i % EINWEG.length];
      const lang = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      const u = norm(w.b.x - w.a.x, w.b.y - w.a.y);
      const n = v2(-u.y * w.einweg, u.x * w.einweg);          // zeigt zur gehaltenen Seite
      const tt = i % 9 === 0 ? 0 : i % 9 === 1 ? 1 : rnd();
      const ziel = v2(w.a.x + u.x * lang * tt, w.a.y + u.y * lang * tt);
      const kugeln = [];
      const frei = (p) => {
        if (!P.punktInPolygon(p, t.bande) || randAbstand(p, t.bande) < 0.0305) return false;
        for (const x of t.waende) {
          const c = P.naechsterPunktAufStrecke(p, x.a, x.b);
          if (Math.hypot(p.x - c.x, p.y - c.y) < 0.03 + x.radius + 0.0005) return false;
        }
        for (const b of t.bumper) if (Math.hypot(p.x - b.pos.x, p.y - b.pos.y) < b.radius + 0.031) return false;
        for (const f of t.flipper) {
          const c = P.naechsterPunktAufStrecke(p, f.pos, f.spitze());
          if (Math.hypot(p.x - c.x, p.y - c.y) < f.radius + 0.031) return false;
        }
        for (const d of dreiecke) if (P.punktInPolygon(p, d)) return false;
        for (const l of t.loecher) if (Math.hypot(p.x - l.pos.x, p.y - l.pos.y) < 0.07) return false;
        return kugeln.every((k) => Math.hypot(k.pos.x - p.x, k.pos.y - p.y) >= 0.0605);
      };
      const setze = (p, vx, vy) => { if (!frei(p)) return false; kugeln.push(new P.Kugel(p, new P.Vec2(vx, vy))); return true; };
      // eine Kugel liegt auf der Wand (gehaltene Seite), dicht daneben
      if (rnd() < 0.5) setze(new P.Vec2(ziel.x + n.x * 0.0406 + u.x * (rnd() - 0.5) * 0.05, ziel.y + n.y * 0.0406 + u.y * (rnd() - 0.5) * 0.05), 0, 0);
      // das Geschoss von der gehaltenen Seite
      for (let v = 0; v < 40; v++) {
        const abstand = 0.07 + rnd() * 0.3;
        const quer = (rnd() - 0.5) * 0.2;
        const start = new P.Vec2(ziel.x + n.x * abstand + u.x * quer, ziel.y + n.y * abstand + u.y * quer);
        const d = drehe(norm(ziel.x - start.x, ziel.y - start.y), (rnd() - 0.5) * 1.0);
        const tempo = 1 + rnd() * 8;
        if (setze(start, d.x * tempo, d.y * tempo)) break;
      }
      // eine dritte Kugel, die irgendwo in der Nähe mitfliegt
      if (rnd() < 0.25) {
        for (let v = 0; v < 40; v++) {
          const start = new P.Vec2(ziel.x + n.x * (0.05 + rnd() * 0.2) + u.x * (rnd() - 0.5) * 0.3, ziel.y + n.y * (0.05 + rnd() * 0.2) + u.y * (rnd() - 0.5) * 0.3);
          const r = rnd() * Math.PI * 2;
          const tempo = rnd() * 6;
          if (setze(start, Math.cos(r) * tempo, Math.sin(r) * tempo)) break;
        }
      }
      if (!kugeln.length) continue;
      t.kugeln = kugeln;
      kugelnGesamt += kugeln.length;
      for (let b = 0; b < 60; b++) {
        t.vorruecken(1 / 60);
        for (const k of t.kugeln) {
          if (k.gehalten) t.werfeAus(k);
          if (w.durchfahrt.has(k) || Math.hypot(k.pos.x - P.naechsterPunktAufStrecke(k.pos, w.a, w.b).x, k.pos.y - P.naechsterPunktAufStrecke(k.pos, w.a, w.b).y) < 0.041) beruehrt++;
        }
        t.ereignisse.length = 0;
      }
      durch += waechter.durch;
      for (const [o, z] of Object.entries(waechter.orte)) orte[o] = (orte[o] || 0) + z;
      sonst += t.statistik.durchschuesse + t.statistik.ausbrueche;
    }
    return { durch, sonst, kugelnGesamt, beruehrt, orte };
  };
  // c) Hin und zurück: Die Kugel fährt von der offenen Seite hindurch (wie nach dem Kickback oder dem Abschuss) und
  // kommt danach von der gehaltenen Seite auf dieselbe Wand zurück (sobald sie die Berührzone oben verlassen hat, fliegt
  // sie mit Tempo 3 bis 9 senkrecht auf die Wand). Dort muss sie halten: Eine Durchfahrt darf nicht hängen bleiben.
  const hinUndZurueck = () => {
    let laeufe = 0, hindurch = 0, gehalten = 0, durchgang = 0;
    for (const def of EINWEG) {
      // senkrecht von unten durch die Wand
      for (const tt of def.name === "tor" ? [0.45, 0.5, 0.55] : def.name === "dach-r-klappe" ? [0.3, 0.4, 0.5] : [0.25, 0.35, 0.5]) {
        for (const tempo of [1.4, 1.8, 2.2, 2.6]) {
          const t = new P.Tisch(STANDARD);
          const waechter = einwegWaechter(t);
          const w = t.waende.find((x) => x.name === def.name);
          const lang = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
          const u = norm(w.b.x - w.a.x, w.b.y - w.a.y);
          const p = new P.Vec2(w.a.x + u.x * lang * tt, w.a.y + u.y * lang * tt - 0.075);
          const k = new P.Kugel(p, new P.Vec2(0, tempo));
          t.kugeln = [k];
          laeufe++;
          let warOben = false, wiederAufDerWand = false;
          // je Unterschritt nach allen Stößen: Ist die Kugel über der Wand, berührt sie sie wieder von oben?
          const pruefeVorher = t.pruefe;
          t.pruefe = (kk) => {
            const lage = P.lageZurStrecke(kk.pos, w.a, w.b);
            const c = P.naechsterPunktAufStrecke(kk.pos, w.a, w.b);
            const d = Math.hypot(kk.pos.x - c.x, kk.pos.y - c.y);
            if (vorzeichen(lage.seite) === w.einweg && d > kk.radius + w.radius + 0.002) warOben = true;
            if (warOben && d <= kk.radius + w.radius + 1e-6 && lage.t > 0 && lage.t < 1 && vorzeichen(lage.seite) === w.einweg) wiederAufDerWand = true;
            pruefeVorher(kk);
          };
          const n = v2(-u.y * w.einweg, u.x * w.einweg);       // zeigt zur gehaltenen Seite
          let zurueck = false;
          for (let b = 0; b < 240; b++) {
            t.vorruecken(1 / 120);
            if (warOben && !zurueck) {
              zurueck = true;
              const v = 3 + (tempo - 1.4) * 5;                  // 3 bis 9
              k.vel.x = -n.x * v;
              k.vel.y = -n.y * v;
            }
            if (k.gehalten) t.werfeAus(k);
            t.ereignisse.length = 0;
          }
          if (warOben) hindurch++;
          if (wiederAufDerWand) gehalten++;
          durchgang += waechter.durch;
        }
      }
    }
    return { laeufe, hindurch, gehalten, durchgang };
  };
  const e = lauf("einzelschritt", 1500, 4040);
  const u = lauf("unterschritte", 1500, 4040);
  const hz = hinUndZurueck();
  const orteText = (o) => Object.entries(o).map(([n, z]) => n + " " + z).join(", ") || "keine";
  console.log(`   a) Beschuss, 1.500 Läufe je Modus (${u.kugelnGesamt} Kugeln, ${u.beruehrt} Bilder mit Kugel an der Einwegwand)`);
  console.log(`      Einzelschritt: ${e.durch} Durchgänge von der gehaltenen Seite (${orteText(e.orte)}), ${e.sonst} sonstige Durchschüsse oder Ausbrüche`);
  console.log(`      Unterschritte: ${u.durch} Durchgänge von der gehaltenen Seite (${orteText(u.orte)}), ${u.sonst} sonstige Durchschüsse oder Ausbrüche`);
  if (e12Einweg) console.log(`   b) Zufallsspiel aus E12: Einzelschritt ${e12Einweg.e}, Unterschritte ${e12Einweg.u} Durchgänge von der gehaltenen Seite`);
  console.log(`   c) Hin und zurück, Unterschritte: ${hz.laeufe} Kugeln, ${hz.hindurch} von der offenen Seite hindurch, ${hz.gehalten} landen wieder auf der Wand, ${hz.durchgang} fallen zurück durch`);
  if (hz.durchgang > 0) fehler.push(`E15: ${hz.durchgang} Kugeln fallen nach einer Durchfahrt von der gehaltenen Seite zurück durch die Einwegwand`);
  if (hz.hindurch < hz.laeufe || hz.gehalten < hz.laeufe * 0.75) fehler.push(`E15: nur ${hz.gehalten} von ${hz.laeufe} Kugeln landen nach der Durchfahrt wieder auf der Wand, die Probe prüft zu wenig`);
  if (u.durch > 0) fehler.push(`E15: ${u.durch} Kugeln tunneln von der gehaltenen Seite durch eine Einwegwand (${orteText(u.orte)})`);
  if (u.sonst > 0) fehler.push(`E15: ${u.sonst} sonstige Durchschüsse oder Ausbrüche beim Beschuss der Einwegwände`);
  if (e.durch === 0) fehler.push("E15: Einzelschritt zeigt an keiner Einwegwand einen Durchgang, der Wächter ist blind");
  if (!e12Einweg) fehler.push("E15: das Zufallsspiel aus E12 hat keinen Wächter-Stand geliefert");
  else if (e12Einweg.u > 0) fehler.push(`E15: im Zufallsspiel (E12) tunneln ${e12Einweg.u} Kugeln von der gehaltenen Seite durch eine Einwegwand`);
}

console.log("");
console.log(`Laufzeit: ${((Date.now() - STARTZEIT) / 1000).toFixed(1)} s`);
if (PRUEFEN) {
  if (fehler.length) {
    console.log("ABNAHME: DURCHGEFALLEN");
    for (const f of fehler) console.log("  - " + f);
    process.exit(1);
  }
  console.log("ABNAHME: BESTANDEN – Unterschritte lassen nichts durch (Wände, Ecken, Schleudern, Fallziele, Sensoren, Zündkammer, Kugelpaare, Zufallsspiel), jedes Bauteil wird erreicht, keine Klemmstelle, Tempo stimmt.");
}
