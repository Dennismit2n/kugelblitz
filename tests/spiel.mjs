// Automat: spielt viele ganze Spiele mit echter Physik und echtem Regelwerk.
//
//   node tests/spiel.mjs                    beide Profile, je 200 Spiele, fester Zufallssamen (reproduzierbar)
//   node tests/spiel.mjs --spiele 50        weniger Spiele je Profil
//   node tests/spiel.mjs --samen 7          anderer Samen
//   node tests/spiel.mjs --profil gut       nur ein Profil (gut | schwach)
//   node tests/spiel.mjs --ursachen         Ursachen der Verluste ausführlich (sonst zwei Zeilen je Profil)
//
// Zwei Spielerprofile, damit beide Zahlen sichtbar sind:
//
//   schwach  das alte Profil aus Abschnitt 2: drei Flipper-Strategien (zufälliges Drücken, gezieltes Schlagen,
//            Fangmulde mit zufälligem Loslassen), Abschuss halb auf die Zielmarke, halb beliebig. Es schaut nicht
//            voraus und zielt in der Fangmulde nicht. Nach dem Loslassen drückt es frühestens nach 0,1 s wieder.
//   gut      ein geübter Spieler. Er benutzt nur, was ein Mensch auch hat (Flippertasten mit Lane-Wechsel,
//            Abschuss mit Ladung, Schubsen), aber er schaut voraus: Eine Kugel, die langsam über den Flipper
//            kommt, fängt er (Taste halten), wartet, bis sie ruht, und löst sie im berechneten Zeitpunkt wieder
//            aus, sodass sie das gewünschte Ziel trifft (leuchtende Zündkammer vor allem anderen, sonst die Mission,
//            sonst Standups und Fallziele). Eine schnelle Kugel schlägt er zu einem Zeitpunkt, den er aus der Bahn
//            und der Flipperlage vorausrechnet (kleine Vorschau mit der echten Physik). Er schubst eine Kugel,
//            die an der Bande entlang in eine Outlane fällt, und tippt selten daneben (Reaktionsstreuung 8 ms).
//
// Geprüft wird: keine Ausnahme, keine nicht endlichen Zahlen, keine Durchschüsse, keine Kugel, die länger als
// Anstoßzeit plus 2 s fast steht (außer Zündkammer, Rampe), kein Spiel ohne Ende, jede Mission wird abgeschlossen,
// Multiball, Jackpot, Extraball und Ballschutz kommen vor, und die Ziele des guten Profils (siehe ZIELE unten).
// Ausgabe endet mit „SPIEL: BESTANDEN“ und Exit 0, sonst „SPIEL: DURCHGEFALLEN“ und Exit 1.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const hier = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const P = require(path.join(hier, "..", "physik.js"));
const R = require(path.join(hier, "..", "regeln.js"));
// Zahlen in der Ausgabe deutsch gruppiert (1.234.567); das Regelwerk selbst formatiert nichts mehr (Abschnitt 6)
const zahlText = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const arg = (name, std) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? Number(process.argv[i + 1]) : std;
};
const argText = (name, std) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : std;
};
const SPIELE = arg("spiele", 80);
const DAUERSPIELE = arg("dauer", 6);           // Spiele mit vielen Kugeln (gutes Profil): zeigen, ob jede Regel erreichbar ist
const DAUER_KUGELN = arg("dauerkugeln", 20);
const SAMEN = arg("samen", 2026);
const STRAT = arg("strategie", -1);            // nur schwaches Profil: eine feste Strategie 0 bis 2
const PROFIL = argText("profil", "beide");
const URSACHEN_LANG = process.argv.includes("--ursachen");
const NUR = arg("nur", 0);                      // nur dieses eine Spiel (zum Suchen von Fehlern)
const SPUR = process.argv.includes("--spur");  // bei einem nicht beendeten Spiel die letzten Kontakte der Kugeln zeigen
const MAX_SPIELZEIT = arg("maxmin", 30) * 60;       // Sekunden; länger wird abgebrochen (und gemeldet)
const STARTZEIT = Date.now();
const fehler = [];

// Ziele des guten Profils (Abschnitt 2b), geprüft in der Auswertung
const ZIELE = {
  outlaneAnteil: 0.45,        // Anteil der Outlanes an allen Kugelverlusten (ohne Ballschutz), höchstens
  spieldauerMin: 3.0,         // mittlere Dauer eines Spiels mit drei Kugeln in Minuten, mindestens
  missionen: 1.5,             // Missionen je Spiel im Mittel, mindestens
  multiballAnteil: 0.15,      // Anteil der Spiele mit Multiball, mindestens
  spieldauerMax: 25,          // Minuten: kein Dreikugelspiel darf länger dauern (Endlosschleife)
};
// Wie genau der gute Spieler ist (ein Mensch trifft ein Zeitfenster nicht auf die Millisekunde)
const KOENNEN = {
  schlagStreuung: 0.030,      // Sekunden, gleichverteilt +/-: Streuung beim vorausberechneten Schlag
  tauStreuung: 0.026,         // dasselbe beim Loslassen in der Fangmulde
  vorschau: 0.85,             // Anteil der Annäherungen, bei denen er den Schlag wirklich vorausrechnet (sonst tippt er, wenn die Kugel nah ist)
  fehler: 0.22,               // Anteil der Annäherungen, die er verschläft oder zu spät erwischt (0,12 bis 0,40 s Verzögerung)
  schubsen: 0.75,             // Wahrscheinlichkeit, eine Kugel an der Bande zu bemerken und zu schubsen
};
// Das schwache Profil soll nur sichtbar besser sein als vor Abschnitt 2b (dort 1,59 min).
const SCHWACH_DAUER_MIN = 2.0;
// Frühestens so lange nach dem Loslassen drückt der schwache Spieler wieder (Sekunden). Bis 13.11.2026 waren es 0,05 s:
// So schnell nachgetippt hüpft eine Kugel an der Flipperwurzel zwischen Arm und Schleuder-Sohle hin und her. Mit dem
// schnelleren Flipper (Winkeltempo 16) wurde daraus eine Endlosschleife, die kein Mensch 30 Minuten lang durchhält.
const SCHWACH_WIEDERDRUCK = 0.10;

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const komma = (x, n = 1) => x.toFixed(n).replace(".", ",");
const mitte = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

const STANDARD = P.standardBauplan();

// Abschussladung, mit der die erste Gasse getroffen wird (aus E14b der Abnahme: D 35 bis 41 %, A 42 bis 47 %, L 48 bis 56 %)
const LADUNG_FUER_GASSE = [0.52, 0.445, 0.38];     // Index 0 = L, 1 = A, 2 = D

// --- Hilfen für das gute Profil ------------------------------------------------------

const ruheSpitze = STANDARD.flipper.map((f) => ({
  x: f.pos[0] + Math.cos(f.ruheWinkel) * f.laenge,
  y: f.pos[1] + Math.sin(f.ruheWinkel) * f.laenge,
}));

// Fangmulde vorab ausmessen (wie E14c der Abnahme): Flipper halten, Kugel kommt zur Ruhe, loslassen, nach tau
// erneut schlagen. Für jedes tau (4-ms-Stufen) merken, welche Ziele die Kugel danach trifft. Der gute Spieler
// kennt diese Tabelle von seinem Tisch und sucht daraus das Zeitfenster für sein Ziel.
function fangTafel(i) {
  const tab = [];
  const start = i === 0 ? [0.40, 0.5] : [0.60, 0.5];
  for (let tau = 0; tau <= 0.5 + 1e-9; tau += 0.004) {
    const t = new P.Tisch(STANDARD);
    const f = t.flipper[i];
    f.gedrueckt = true;
    const k = new P.Kugel(new P.Vec2(start[0], start[1]), new P.Vec2());
    t.kugeln = [k];
    let ruhig = 0;
    for (let b = 0; b < 600 && ruhig < 30; b++) { t.vorruecken(1 / 120); ruhig = k.vel.length() < 0.05 ? ruhig + 1 : 0; }
    if (ruhig < 30) continue;
    t.ereignisse.length = 0;
    f.gedrueckt = false;
    const treffer = new Set();      // alles, was die Kugel in 6 s trifft
    let erst = null;                // das erste Ziel (ohne Schleudern): der gezielte Schuss
    const merkeZiel = (name) => { treffer.add(name); if (erst === null) erst = name; };
    let zeit = 0, gedr = false, halt = 0;
    while (zeit < 6) {
      if (!gedr && zeit >= tau) { f.gedrueckt = true; gedr = true; }
      if (gedr && zeit >= tau + 0.35) f.gedrueckt = false;
      t.vorruecken(1 / 120);
      zeit += 1 / 120;
      for (const e of t.ereignisse) {
        if (e.art === "bumper") merkeZiel("bumper-" + (t.bumper.indexOf(e.bumper) + 1));
        else if (e.art === "wand" && (e.wand.art === "standup" || e.wand.art === "fallziel")) merkeZiel(e.wand.name);
        else if (e.art === "sensor" && e.sensor.art === "gasse" && e.kugel.vel.y < 0) merkeZiel(e.sensor.name);
        else if (e.art === "loch") merkeZiel("zuendkammer");
      }
      t.ereignisse.length = 0;
      if (k.gehalten && (halt += 1 / 120) > 1) { halt = 0; t.werfeAus(k); }
      if (k.pos.y < STANDARD.abfluss.yMax) break;
    }
    tab.push({ tau, treffer, erst });
  }
  return tab;
}
let FANG = null;

// Aus der Tabelle das Zeitfenster für das erste erreichbare Ziel der Wunschliste wählen (Mitte des längsten Streifens).
function waehleTau(tab, wunsch) {
  const streifen = (ziel, direkt) => {
    const taus = tab.filter((e) => (direkt ? e.erst === ziel : e.treffer.has(ziel))).map((e) => e.tau);
    const lauf = [];
    let a = null;
    for (let j = 0; j < taus.length; j++) {
      if (a === null) a = [taus[j], taus[j]];
      else if (taus[j] - a[1] < 0.0045) a[1] = taus[j];
      else { lauf.push(a); a = [taus[j], taus[j]]; }
    }
    if (a) lauf.push(a);
    lauf.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]));
    return lauf[0] || null;
  };
  // erst die gezielten Schüsse (das Ziel ist das erste, was die Kugel trifft), dann alles, was sie später trifft
  for (const [direkt, mindest] of [[true, 0.007], [true, 0], [false, 0.015], [false, 0]]) {
    for (const ziel of wunsch) {
      const s = streifen(ziel, direkt);
      if (s && s[1] - s[0] >= mindest) return { tau: (s[0] + s[1]) / 2, ziel: ziel + (direkt ? "" : " (später)") };
    }
  }
  return { tau: 0.15, ziel: null };
}

// Was der gute Spieler gerade anspielen will, in dieser Reihenfolge.
function wunschListe(r, z) {
  const l = z.lichter;
  const def = r.missionEintrag();
  const w = [];
  if (l.zuendkammer) w.push("zuendkammer");
  if (z.mission.aktiv) {
    if (def.typ === "bumper") w.push("bumper-1", "bumper-2", "bumper-3");
    else if (def.typ === "gassen") w.push("gasse-1", "gasse-2", "gasse-3");
    else if (def.typ === "bank") w.push("fallziel-1", "fallziel-2", "fallziel-3");
    else if (def.typ === "standup") w.push("standup-1", "standup-2", "standup-3");
    else if (def.typ === "kammer") w.push("zuendkammer");
  }
  w.push("standup-2", "standup-3", "standup-1", "fallziel-2", "fallziel-3", "fallziel-1",
    "zuendkammer", "bumper-3", "bumper-1", "bumper-2", "gasse-2", "gasse-3", "gasse-1");
  return w;
}

// Kleine Vorschau für den Schlag auf eine bewegte Kugel: nur der untere Teil des Tisches, die echte Physik.
const MINI_BAUPLAN = {
  ...STANDARD,
  waende: STANDARD.waende.filter((w) => Math.min(w.a[1], w.b[1]) < 0.85 && w.art !== "fallziel" && w.art !== "standup"),
  bumper: [], sensoren: [], loecher: [], messlinien: [],
};
const KANDIDATEN = [];
for (let d = 0; d <= 0.3 + 1e-9; d += 0.02) KANDIDATEN.push(d);

function plane(mini, FL, i, k) {
  const vorz = i === 0 ? 1 : -1;
  const werte = [];
  for (const d of KANDIDATEN) {
    mini.kugeln.length = 0;
    for (let j = 0; j < 2; j++) {
      const g = mini.flipper[j], f = FL[j];
      g.drehung = f.drehung; g.drehungTaktStart = f.drehung; g.aktWinkelTempo = f.aktWinkelTempo;
      g.gedrueckt = f.gedrueckt; g.spitzeVorher = g.spitze();
    }
    const kk = new P.Kugel(k.pos, k.vel);
    mini.kugeln.push(kk);
    mini.ereignisse.length = 0;
    let t = 0, wert = null;
    for (let s = 0; s < 84; s++) {
      mini.flipper[i].gedrueckt = t >= d - 1e-9 && t < d + 0.3;
      mini.takt(P.KONST.TAKT);
      t += P.KONST.TAKT;
      if (kk.pos.y < 0.075) { wert = -10 + t; break; }
      if (kk.pos.y > 0.55 && kk.vel.y > 0.3) {
        wert = kk.vel.y + vorz * kk.vel.x * 0.8 - (kk.pos.x < 0.15 || kk.pos.x > 0.85 ? 1 : 0);
        break;
      }
    }
    werte.push(wert === null ? -5 : wert);
  }
  mini.ereignisse.length = 0;
  // Wer auf einem schmalen Zeitfenster tippt, verfehlt es: den längsten Streifen erfolgreicher Zeitpunkte nehmen, seine Mitte
  let beste = null;
  for (let a = 0; a < werte.length; a++) {
    if (!(werte[a] > -4)) continue;
    let b = a;
    while (b + 1 < werte.length && werte[b + 1] > -4) b++;
    if (!beste || b - a > beste[1] - beste[0]) beste = [a, b];
    a = b;
  }
  if (!beste) return { d: 0, ok: false };
  return { d: KANDIDATEN[Math.round((beste[0] + beste[1]) / 2)], ok: true };
}

// --- Ursachen der Verluste -------------------------------------------------------------

// Welche Teile berührt die Kugel gerade? (Namen für die Ursachenstatistik)
function kontakte(tisch, k) {
  const aus = [];
  for (const f of tisch.flipper) {
    const c = P.naechsterPunktAufStrecke(k.pos, f.pos, f.spitze());
    if (Math.hypot(k.pos.x - c.x, k.pos.y - c.y) <= k.radius + f.radius + 0.004) aus.push(Math.abs(f.aktWinkelTempo) > 1 ? "Flipper-Schlag" : "Flipper-Ruhe");
  }
  for (const w of tisch.waende) {
    if (!w.aktiv) continue;
    const c = P.naechsterPunktAufStrecke(k.pos, w.a, w.b);
    if (Math.hypot(k.pos.x - c.x, k.pos.y - c.y) > k.radius + w.radius + 0.004) continue;
    if (w.art === "fuehrung") aus.push(w.name.startsWith("schleuder") ? "Schleuder-Körper" : w.name.startsWith("rinne") ? "Rinne" : w.name.startsWith("dach") ? "Dach" : "Führung");
    else if (w.art === "wand") aus.push("Trennwand/Tor");
    else aus.push(NAME_ART[w.art] || w.art);
  }
  return aus;
}
const NAME_ART = { schleuder: "Schleuder", fallziel: "Fallziel", standup: "Standup", gasse: "Gasse" };

function spiel(nr, profil, kugeln = 3, versatz = 0, maxZeit = MAX_SPIELZEIT) {
  const gut = profil === "gut";
  const rnd = mulberry32(SAMEN * 1000 + nr + versatz + (gut ? 777000 : 0));
  const tisch = new P.Tisch(STANDARD, "unterschritte");
  const speicher = R.speicherImArbeitsspeicher();
  const r = new R.Regelwerk(tisch, { zufall: rnd, speicher, jetzt: () => "2026-11-13", kugeln });
  const z = r.z;
  r.starte();
  const FL = tisch.flipper;
  const dt = gut ? 1 / 120 : 1 / 60;
  const halten = [0, 0], sperre = [0, 0], kuehl = [0, 0], plan = [null, null];
  const vorher = [false, false];
  const bericht = {
    nr, kugeln, profil, missionDauer: { bumper: [], gassen: [], bank: [], standup: [], kammer: [] }, missionWarten: [],
    ausnahme: null, nan: 0, durch: 0, klemmt: [], abgebrochen: false, stillMax: 0, hoechstesTempo: 0,
    missionenTyp: { bumper: 0, gassen: 0, bank: 0, standup: 0, kammer: 0 },
    verluste: [], spielzeit: 0, kugelZeiten: [], skillVersuche: 0, fangZiele: {},
  };
  let wartet = 0.3 + rnd();
  let zeit = 0;
  let letzteFlipper = 0;
  let kugelStart = 0;
  let letzteKugelNr = 1;
  let schubsKuehl = 0;
  const ungeduldig = rnd() < (gut ? 0.05 : 0.08);    // manche Spieler schubsen zu oft
  let aktivVorher = false, aktivSeit = 0, wartenSeit = 0;
  const still = new WeakMap();
  const anker = new WeakMap();
  const strategieJeKugel = new WeakMap();
  const verlauf = new WeakMap();
  // gutes Profil
  const mini = gut ? new P.Tisch(MINI_BAUPLAN, "unterschritte") : null;
  const fz = [0, 1].map(() => ({ modus: "frei", t: 0, ruhig: 0, kuehl: 0, planIn: 0, druckAb: null, wartet: 0 }));
  const alleFeld = () => r.meine().filter((k) => !k.gehalten && !r.inRampe(k));
  if (gut && !FANG) FANG = [fangTafel(0), fangTafel(1)];

  const spur = (k) => { let v = verlauf.get(k); if (!v) { v = { h: [], lane: null }; verlauf.set(k, v); } return v; };
  const merke = (k, lab, x, y) => {
    const v = spur(k);
    const l = v.h[v.h.length - 1];
    if (l && l.lab === lab && zeit - l.t < 0.3) { l.t = zeit; return; }
    v.h.push({ lab, t: zeit, x, y });
    if (v.h.length > (SPUR ? 60 : 10)) v.h.shift();
  };

  try {
    while (z.phase !== "ende" && zeit < maxZeit) {
      zeit += dt;
      const typVorher = r.missionEintrag().typ;
      const erfuelltVorher = z.mission.erfuellt;

      // --- Abschuss --------------------------------------------------------------
      if (z.phase === "bereit") {
        const kr = r.meine().find((k) => r.inRampe(k));
        if (kr) {
          wartet -= dt;
          if (wartet <= 0) {
            let l;
            if (rnd() < (gut ? 0.85 : 0.5)) {
              l = LADUNG_FUER_GASSE[r.zielGasse] + (rnd() - 0.5) * 0.02;
              bericht.skillVersuche++;
            } else l = 0.3 + rnd() * 0.7;
            r.abschuss(l);
            wartet = 0.4 + rnd() * 0.8;
          }
        }
      }

      // --- Flipper ------------------------------------------------------------------
      if (!gut) {
        // schwaches Profil: unverändert aus Abschnitt 2
        const feld = r.meine().filter((k) => !r.inRampe(k) || k.pos.y > 0.3);
        const k0 = feld.sort((p, q) => p.pos.y - q.pos.y)[0];
        for (let i = 0; i < 2; i++) {
          const f = FL[i];
          if (sperre[i] > 0) sperre[i] -= dt;
          if (kuehl[i] > 0) kuehl[i] -= dt;
          if (halten[i] > 0) { halten[i] -= dt; f.gedrueckt = true; if (halten[i] <= 0) { f.gedrueckt = false; sperre[i] = SCHWACH_WIEDERDRUCK; } }
          if (!k0 || z.tilt) { if (z.tilt) f.gedrueckt = false; continue; }
          if (!strategieJeKugel.has(k0)) strategieJeKugel.set(k0, STRAT >= 0 ? STRAT : Math.floor(rnd() * 3));
          const s = strategieJeKugel.get(k0);
          const vorz = i === 0 ? 1 : -1;
          if (s !== 0 && halten[i] <= 0) f.gedrueckt = false;
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
              if (plan[i].bis <= 0) { halten[i] = 0.25; plan[i] = null; kuehl[i] = 1.5; }
            }
          }
        }
      } else {
        // gutes Profil: fangen, zielen, vorausberechnet schlagen
        const feld = alleFeld();
        for (let i = 0; i < 2; i++) {
          const f = FL[i], s = fz[i], sp = ruheSpitze[i];
          if (z.tilt) { f.gedrueckt = false; s.modus = "frei"; continue; }
          const lo = i === 0 ? f.pos.x - 0.06 : sp.x - 0.08;
          const hi = i === 0 ? sp.x + 0.08 : f.pos.x + 0.06;
          let kb = null;
          for (const k of feld) {
            if (k.pos.x >= lo && k.pos.x <= hi && k.pos.y < 0.65 && k.pos.y > 0.07 && (!kb || k.pos.y < kb.pos.y)) kb = k;
          }
          if (!kb) { s.vorschau = undefined; s.fehlerBis = undefined; }          // nächste Annäherung: neu würfeln
          const abstArm = (k) => {
            const c = P.naechsterPunktAufStrecke(k.pos, f.pos, f.spitze());
            return Math.hypot(k.pos.x - c.x, k.pos.y - c.y);
          };
          if (s.modus === "frei") {
            if (kb && s.fehlerBis === undefined) s.fehlerBis = rnd() < KOENNEN.fehler ? zeit + 0.12 + rnd() * 0.28 : 0;
            if (s.kuehl > 0) { s.kuehl -= dt; }
            else if (kb && zeit >= s.fehlerBis && kb.vel.y < 0.3) {
              const ueberArm = i === 0
                ? kb.pos.x >= f.pos.x - 0.03 && kb.pos.x <= sp.x - 0.02
                : kb.pos.x <= f.pos.x + 0.03 && kb.pos.x >= sp.x + 0.02;
              const v = kb.vel.length();
              if (ueberArm && v < 3.2) {
                const c = P.naechsterPunktAufStrecke(kb.pos, f.pos, sp);
                const d = Math.hypot(kb.pos.x - c.x, kb.pos.y - c.y);
                if (d < 0.13 + 0.05 * Math.max(0, -kb.vel.y)) { f.gedrueckt = true; s.modus = "halt"; s.t = 0; s.ruhig = 0; }
              } else {
                s.planIn -= dt;
                if (s.planIn <= 0) {
                  s.planIn = 0.08;
                  if (s.vorschau === undefined) s.vorschau = rnd() < KOENNEN.vorschau;
                  const p = s.vorschau ? plane(mini, FL, i, kb) : { d: 0, ok: false };
                  s.druckAb = p.ok ? zeit + p.d + (rnd() - 0.5) * 2 * KOENNEN.schlagStreuung : null;
                  if (!p.ok && abstArm(kb) < 0.09) s.druckAb = zeit;
                }
                if (s.druckAb !== null && zeit >= s.druckAb) { f.gedrueckt = true; s.modus = "schlag"; s.t = 0.3; s.druckAb = null; }
              }
            }
          } else if (s.modus === "halt") {
            s.t += dt;
            if (!kb) {
              if (s.t > 0.5) { f.gedrueckt = false; s.modus = "frei"; s.kuehl = 0.1; }
            } else {
              const v = kb.vel.length();
              s.ruhig = v < 0.2 && abstArm(kb) < 0.075 ? s.ruhig + dt : 0;
              if (s.ruhig > 0.12) {
                const w = waehleTau(FANG[i], wunschListe(r, z));
                bericht.fangZiele[w.ziel || "keins"] = (bericht.fangZiele[w.ziel || "keins"] || 0) + 1;
                f.gedrueckt = false;
                s.modus = "tau";
                s.wartet = Math.max(0, w.tau + (rnd() - 0.5) * 2 * KOENNEN.tauStreuung);
              } else if (s.t > 3.5 || (kb.vel.y > 1.0 && kb.pos.y > 0.40)) {
                f.gedrueckt = false; s.modus = "frei"; s.kuehl = 0.1;
              }
            }
          } else if (s.modus === "tau") {
            s.wartet -= dt;
            if (s.wartet <= 0) { f.gedrueckt = true; s.modus = "schlag"; s.t = 0.35; }
          } else if (s.modus === "schlag") {
            s.t -= dt;
            if (s.t <= 0) { f.gedrueckt = false; s.modus = "frei"; s.kuehl = 0.08; }
          }
        }
      }
      // Tastendruck = steigende Flanke: das Regelwerk schiebt die Gassenlichter
      for (let i = 0; i < 2; i++) {
        if (FL[i].gedrueckt !== vorher[i]) {
          letzteFlipper = zeit;
          vorher[i] = FL[i].gedrueckt;
          if (FL[i].gedrueckt) r.flipperTaste(i);
        }
      }

      // --- Schubs ---------------------------------------------------------------------
      if (schubsKuehl > 0) schubsKuehl -= dt;
      if (!gut) {
        // ein Spieler rettet Kugeln, die in eine Outlane rollen
        const feld = r.meine().filter((k) => !r.inRampe(k) || k.pos.y > 0.3);
        const k0 = feld.sort((p, q) => p.pos.y - q.pos.y)[0];
        if (ungeduldig && k0 && z.phase === "spiel" && !z.tilt && schubsKuehl <= 0 && k0.pos.y < 0.7 && k0.pos.y > 0.3 && k0.vel.y < -0.8) {
          r.schubs(rnd() < 0.5 ? 0.45 : -0.45, 0);
          schubsKuehl = 0.25;
        } else if (k0 && z.phase === "spiel" && !z.tilt && schubsKuehl <= 0 && k0.pos.y < 0.62 && k0.pos.y > 0.4 && k0.vel.y < -0.4) {
          if (k0.pos.x < 0.13 && rnd() < 0.5) { r.schubs(0.45, 0); schubsKuehl = 1.2; }
          else if (k0.pos.x > 0.87 && k0.pos.x < 0.96 && rnd() < 0.5) { r.schubs(-0.45, 0); schubsKuehl = 1.2; }
        }
      } else if (z.phase === "spiel" && !z.tilt && schubsKuehl <= 0) {
        // Der gute Spieler schubst eine Kugel, die an der Bande entlang auf die Outlane zufällt, einmal, mit Abstand
        // (so tippt er nie auf Tilt). Der ungeduldige schubst öfter.
        for (const k of alleFeld()) {
          if (k.vel.y < -0.2 && k.pos.y > 0.55 && k.pos.y < 0.9 && (k.pos.x < 0.11 || k.pos.x > 0.89)) {
            if (rnd() < KOENNEN.schubsen) r.schubs(k.pos.x < 0.5 ? 0.45 : -0.45, 0);
            schubsKuehl = ungeduldig ? 0.3 : 2.2;
            break;
          }
        }
        if (ungeduldig && schubsKuehl <= 0) {
          const k0 = alleFeld().sort((p, q) => p.pos.y - q.pos.y)[0];
          if (k0 && k0.pos.y < 0.7 && k0.pos.y > 0.3 && k0.vel.y < -0.8) { r.schubs(rnd() < 0.5 ? 0.45 : -0.45, 0); schubsKuehl = 0.25; }
        }
      }

      // --- Physik und Regelwerk -----------------------------------------------------------
      tisch.vorruecken(dt);
      for (const e of tisch.ereignisse) {
        if (e.art === "durchschuss" || e.art === "ausbruch") bericht.durch++;
        const k = e.kugel;
        if (!k) continue;
        if (e.art === "bumper") merke(k, "Bumper", k.pos.x, k.pos.y);
        else if (e.art === "wand") merke(k, e.wand.art === "schleuder" ? (e.tritt ? "Schleuder-Tritt" : "Schleuder-Fläche") : (NAME_ART[e.wand.art] || e.wand.art), k.pos.x, k.pos.y);
        else if (e.art === "loch") merke(k, "Zündkammer", k.pos.x, k.pos.y);
        else if (e.art === "sensor" && (e.sensor.art === "inlane" || e.sensor.art === "outlane")) spur(k).lane = { n: e.sensor.name, t: zeit };
      }
      for (const k of tisch.kugeln) {
        if (k.gehalten) continue;
        for (const lab of kontakte(tisch, k)) merke(k, lab, k.pos.x, k.pos.y);
      }
      for (const k of tisch.kugeln) {
        if (!k.probe && r.imAbfluss(k) && !z.tilt && r.uhr >= (k.schutzBis || 0) && z.phase === "spiel") {
          const x = k.pos.x;
          const weg = x < 0.13 ? "Outlane links" : x > 0.87 ? "Outlane rechts" : "Mitte";
          const v = spur(k);
          const t0 = v.lane ? v.lane.t : zeit;
          // Ursache = letzter Kontakt vor dem Lane-Sensor, der keine Führungsschiene ist
          const hh = v.h.filter((e) => e.t <= t0 + 0.05 && e.lab !== "Führung");
          const e = hh[hh.length - 1];
          const ursache = e ? e.lab : "keiner (frei gefallen)";
          bericht.verluste.push({ x, weg, ursache, seit: e ? t0 - e.t : null });
        }
      }
      r.schritt(dt, tisch.ereignisse);
      tisch.ereignisse.length = 0;

      if (z.mission.erfuellt > erfuelltVorher) {
        bericht.missionenTyp[typVorher] += z.mission.erfuellt - erfuelltVorher;
        bericht.missionDauer[typVorher].push(zeit - aktivSeit);
      }
      if (z.mission.aktiv && !aktivVorher) { aktivSeit = zeit; bericht.missionWarten.push(zeit - wartenSeit); }
      if (!z.mission.aktiv && aktivVorher) wartenSeit = zeit;
      aktivVorher = z.mission.aktiv;

      // --- Prüfungen im laufenden Spiel ---------------------------------------------------
      if (!Number.isFinite(z.punkte) || !Number.isFinite(z.warnung) || !Number.isFinite(z.bonus.zaehler)) bericht.nan++;
      const gehalten = FL[0].gedrueckt || FL[1].gedrueckt;
      for (const k of tisch.kugeln) {
        if (!Number.isFinite(k.pos.x) || !Number.isFinite(k.pos.y) || !Number.isFinite(k.vel.x) || !Number.isFinite(k.vel.y)) bericht.nan++;
        const v = k.vel.length();
        if (v > bericht.hoechstesTempo) bericht.hoechstesTempo = v;
        // Wie lange steht die Kugel fast still (ohne Zündkammer und Rampe)?
        if (k.gehalten || r.inRampe(k) || v >= P.KONST.RUHE_TEMPO) still.set(k, 0);
        else {
          const s = (still.get(k) || 0) + dt;
          still.set(k, s);
          const grenze = (gehalten ? R.KONST.STECKT_FLIPPER : R.KONST.STECKT) + 2;
          if (s > bericht.stillMax) bericht.stillMax = s;
          if (s > grenze) bericht.klemmt.push(`Spiel ${nr}: Kugel steht ${komma(s, 1)} s bei (${k.pos.x.toFixed(2)}|${k.pos.y.toFixed(2)})`);
        }
        // Zittern in einem kleinen Kreis (Anstoß hilft nicht): länger als 10 s ohne Flipper-Eingriff
        if (!k.gehalten && !r.inRampe(k) && !gehalten && zeit - letzteFlipper > 2) {
          const a = anker.get(k);
          if (!a || Math.hypot(k.pos.x - a.x, k.pos.y - a.y) > 0.05) anker.set(k, { x: k.pos.x, y: k.pos.y, t: zeit });
          else if (zeit - a.t > 10) {
            bericht.klemmt.push(`Spiel ${nr}: Kugel zittert seit 10 s bei (${a.x.toFixed(2)}|${a.y.toFixed(2)})`);
            anker.delete(k);
          }
        } else anker.delete(k);
      }
      // Kugelzeiten
      if (z.kugelNr !== letzteKugelNr) {
        bericht.kugelZeiten.push(zeit - kugelStart);
        kugelStart = zeit;
        letzteKugelNr = z.kugelNr;
      }
    }
    if (z.phase !== "ende") bericht.abgebrochen = true;
    if (SPUR && bericht.abgebrochen) for (const k of tisch.kugeln) { const v = verlauf.get(k); if (v) console.log(`SPUR Spiel ${nr} ${profil} Kugel ${z.kugelNr} Phase ${z.phase}: ` + v.h.map((e) => `${e.lab}@${e.t.toFixed(1)}(${e.x.toFixed(2)},${e.y.toFixed(2)})`).join(" ")); }
  } catch (e) {
    bericht.ausnahme = e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e);
  }
  bericht.spielzeit = zeit;
  bericht.punkte = z.punkte;
  bericht.stat = { ...z.statistik };
  bericht.rang = z.rang.nr;
  bericht.platz = z.neuerPlatz;
  bericht.liste = z.bestenliste.length;
  bericht.tempoTisch = tisch.statistik.hoechstesTempo;
  return bericht;
}

// --- Läufe ----------------------------------------------------------------------------------

const profile = PROFIL === "beide" ? ["gut", "schwach"] : [PROFIL];
console.log(`Automat: je ${SPIELE} Spiele mit ${R.KONST.KUGELN} Kugeln, Profile ${profile.join(" und ")}, dazu ${DAUERSPIELE} Dauerspiele mit ${DAUER_KUGELN} Kugeln (gut), Samen ${SAMEN}`);
const normal = {};
for (const p of profile) {
  normal[p] = [];
  for (let nr = NUR || 1; nr <= (NUR || SPIELE); nr++) normal[p].push(spiel(nr, p));
}
const dauer = [];
if (profile.includes("gut")) for (let nr = 1; nr <= DAUERSPIELE; nr++) dauer.push(spiel(nr, "gut", DAUER_KUGELN, 500000, 4 * MAX_SPIELZEIT));
const berichte = [...Object.values(normal).flat(), ...dauer];

// --- Auswertung -----------------------------------------------------------------------------

const summeIn = (liste, feld) => liste.reduce((s, b) => s + b.stat[feld], 0);
const spieleMitIn = (liste, feld) => liste.filter((b) => b.stat[feld] > 0).length;
const summe = (feld) => summeIn(berichte, feld);
const spieleMit = (feld) => spieleMitIn(berichte, feld);
const typen = [["bumper", "1 Ladung sammeln"], ["gassen", "2 Leitbahnen"], ["bank", "3 Spannung"], ["standup", "4 Zielübung"], ["kammer", "5 Entladung"]];
const zaehlen = (liste, f) => { const m = {}; for (const a of liste) { const k = f(a); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]); };
const ergebnis = {};

for (const p of profile) {
  const liste = normal[p];
  const n = liste.length;
  const dauerMin = liste.map((b) => b.spielzeit / 60);
  const punkte = liste.map((b) => b.punkte).sort((a, b) => a - b);
  const quantil = (q) => punkte[Math.min(punkte.length - 1, Math.floor(q * punkte.length))];
  const kugelZeiten = liste.flatMap((b) => b.kugelZeiten);
  const verluste = liste.flatMap((b) => b.verluste);
  const outlane = verluste.filter((v) => v.weg !== "Mitte").length;
  const anteil = verluste.length ? outlane / verluste.length : 0;
  const multiball = spieleMitIn(liste, "multiballs");
  const missionen = summeIn(liste, "missionen") / n;
  ergebnis[p] = { dauer: mitte(dauerMin), anteil, multiball: multiball / n, missionen, dauerMax: Math.max(...dauerMin) };

  console.log(`\n=== Profil ${p.toUpperCase()}: ${n} Spiele mit drei Kugeln ===`);
  console.log(`Spieldauer: Mittel ${komma(mitte(dauerMin), 2)} min, kürzestes ${komma(Math.min(...dauerMin), 2)}, längstes ${komma(Math.max(...dauerMin), 2)} min (Spielzeit, Bonus eingerechnet)`);
  console.log(`Je Kugel im Mittel ${komma(mitte(kugelZeiten), 1)} s (${kugelZeiten.length} Kugeln, ohne die letzte je Spiel)`);
  console.log(`Punkte: Mittel ${zahlText(mitte(punkte))}, Median ${zahlText(quantil(0.5))}, 10 % ${zahlText(quantil(0.1))}, 90 % ${zahlText(quantil(0.9))}, höchstes ${zahlText(punkte[punkte.length - 1])}`);
  console.log(`Missionen je Spiel im Mittel ${komma(missionen, 2)}, Rang am Ende im Mittel ${komma(mitte(liste.map((b) => b.rang)), 2)}, Multiball in ${multiball} von ${n} Spielen (${komma((100 * multiball) / n, 0)} %)`);
  console.log(`Extraball in ${spieleMitIn(liste, "extraBaelle")} Spielen, Tilt ${summeIn(liste, "tilts")} Mal, Ballschutz ${summeIn(liste, "ballschutz")} Mal, Kickback ${summeIn(liste, "kickbacks")} Mal, Kugel kreist ${summeIn(liste, "kreist")} Mal, Zündkammer ${komma(summeIn(liste, "kammer") / n, 1)} Besuche je Spiel`);
  const wege = zaehlen(verluste, (v) => v.weg);
  console.log(`Verluste (ohne Ballschutz): ${verluste.length}, davon ${wege.map(([k, c]) => `${k} ${c}`).join(", ")}; Outlane-Anteil ${komma(100 * anteil, 1)} %`);
  const ursachenOut = zaehlen(verluste.filter((v) => v.weg !== "Mitte"), (v) => v.ursache);
  const ursachenMitte = zaehlen(verluste.filter((v) => v.weg === "Mitte"), (v) => v.ursache);
  console.log(`  Ursache Outlane (letzter Kontakt vor dem Lane-Sensor): ${ursachenOut.slice(0, URSACHEN_LANG ? 20 : 5).map(([k, c]) => `${k} ${c}`).join(" | ") || "-"}`);
  console.log(`  Ursache Mitte: ${ursachenMitte.slice(0, URSACHEN_LANG ? 20 : 4).map(([k, c]) => `${k} ${c}`).join(" | ") || "-"}`);
  if (URSACHEN_LANG) {
    for (const weg of ["Outlane links", "Outlane rechts", "Mitte"]) {
      const sub = verluste.filter((v) => v.weg === weg);
      if (!sub.length) continue;
      const seit = sub.map((v) => v.seit).filter((x) => x !== null).sort((a, b) => a - b);
      console.log(`  ${weg}: ${sub.length} Verluste, Zeit vom letzten Kontakt bis Lane-Sensor Median ${seit.length ? komma(seit[Math.floor(seit.length / 2)], 2) : "-"} s`);
    }
  }
  if (p === "gut") {
    const ziele = {};
    for (const b of liste) for (const [k, c] of Object.entries(b.fangZiele)) ziele[k] = (ziele[k] || 0) + c;
    console.log(`  Fang und Zielen (gewähltes Ziel je Fang): ${Object.entries(ziele).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(" | ")}`);
  }
}

if (dauer.length) {
  const dm = dauer.map((b) => b.spielzeit / 60);
  const pk = dauer.map((b) => b.punkte).sort((a, b) => a - b);
  console.log(`\n=== ${DAUERSPIELE} Dauerspiele mit ${DAUER_KUGELN} Kugeln, gutes Profil (zeigen, ob alles erreichbar ist) ===`);
  console.log(`Spieldauer: Mittel ${komma(mitte(dm), 1)} min, Punkte Mittel ${zahlText(mitte(pk))}, Median ${zahlText(pk[Math.floor(pk.length / 2)])}, höchstes ${zahlText(pk[pk.length - 1])}`);
  console.log("Missionen abgeschlossen: " + typen.map(([t, n]) => `${n}: ${dauer.reduce((s, b) => s + b.missionenTyp[t], 0)}`).join(" | "));
  console.log("Dauer der Mission, vom Start bis zum Ziel (Mittel in Sekunden): " + typen.map(([t, n]) => {
    const a = dauer.flatMap((b) => b.missionDauer[t]);
    return `${n}: ${a.length ? komma(mitte(a), 0) : "-"} s`;
  }).join(" | "));
  const warten = dauer.flatMap((b) => b.missionWarten);
  console.log(`Wartezeit bis zum Start der nächsten Mission (Zündkammer): Mittel ${komma(mitte(warten), 0)} s (${warten.length} Starts)`);
  console.log(`Höchster Rang im Mittel ${komma(mitte(dauer.map((b) => b.rang)), 2)}; Missionen je Spiel ${komma(summeIn(dauer, "missionen") / dauer.length, 1)}`);
}

console.log(`\n--- alle ${berichte.length} Spiele zusammen ---`);
console.log(`Multiball in ${spieleMit("multiballs")} Spielen (${summe("multiballs")} gesamt), Jackpots ${summe("jackpots")} in ${spieleMit("jackpots")} Spielen`);
console.log(`Extraball in ${spieleMit("extraBaelle")} Spielen (${summe("extraBaelle")} gesamt), Bänke geleert ${summe("banken")}`);
console.log(`Ballschutz greift ${summe("ballschutz")} Mal in ${spieleMit("ballschutz")} Spielen, Tilt ${summe("tilts")} Mal in ${spieleMit("tilts")} Spielen`);
console.log(`Skill Shot ${summe("skillShots")} Mal (${berichte.reduce((s, b) => s + b.skillVersuche, 0)} Abschüsse auf die Zielmarke), Kickback ${summe("kickbacks")} Mal, Standup-Sätze ${summe("standupSaetze")}, Gassen voll ${summe("gassenVoll")}`);
console.log(`Kugel steckt: ${summe("steckt")} Anstöße in ${spieleMit("steckt")} Spielen, Kugel kreist: ${summe("kreist")} Anstöße in ${spieleMit("kreist")} Spielen, längster Stillstand ${komma(Math.max(...berichte.map((b) => b.stillMax)), 2)} s`);

const ausnahmen = berichte.filter((b) => b.ausnahme);
const nans = berichte.reduce((s, b) => s + b.nan, 0);
const durch = berichte.reduce((s, b) => s + b.durch, 0);
const klemmt = berichte.flatMap((b) => b.klemmt);
const abgebr = berichte.filter((b) => b.abgebrochen);
const tempo = Math.max(...berichte.map((b) => b.hoechstesTempo), ...berichte.map((b) => b.tempoTisch));

if (ausnahmen.length) for (const b of ausnahmen.slice(0, 3)) fehler.push(`Ausnahme in Spiel ${b.nr} (${b.profil}): ${b.ausnahme}`);
if (nans) fehler.push(`${nans} nicht endliche Werte`);
if (durch) fehler.push(`${durch} Durchschüsse oder Ausbrüche`);
for (const k of [...new Set(klemmt)].slice(0, 5)) fehler.push("Kugel hängt: " + k);
if (abgebr.length) fehler.push(`${abgebr.length} Spiele nach ${abgebr[0].kugeln > 3 ? 4 * MAX_SPIELZEIT / 60 : MAX_SPIELZEIT / 60} min Spielzeit nicht zu Ende (z. B. Spiel ${abgebr[0].nr}, ${abgebr[0].profil}): Endlosschleife?`);
if (tempo > P.KONST.TEMPO_DECKEL + 1e-9) fehler.push(`Tempo ${tempo} über dem Deckel`);
for (const [t, n] of typen) {
  if (berichte.reduce((s, b) => s + b.missionenTyp[t], 0) < 1) fehler.push(`Mission ${n} wurde kein einziges Mal abgeschlossen`);
}
if (summe("multiballs") < 1) fehler.push("kein Multiball");
if (summe("jackpots") < 1) fehler.push("kein Jackpot");
if (summe("extraBaelle") < 1) fehler.push("kein Extraball");
if (summe("ballschutz") < 1) fehler.push("Ballschutz greift nie");
if (summe("skillShots") < 1) fehler.push("kein Skill Shot");
if (summe("tilts") < 1) fehler.push("kein Tilt");

// Ziele des guten Profils und Untergrenze des schwachen
console.log("\n--- Ziele ---");
if (ergebnis.gut) {
  const g = ergebnis.gut;
  const zeile = (name, wert, ziel, ok) => console.log(`  ${ok ? "ok    " : "FEHLT "}${name}: ${wert} (Ziel ${ziel})`);
  zeile("Outlane-Anteil an den Verlusten", komma(100 * g.anteil, 1) + " %", "höchstens " + komma(100 * ZIELE.outlaneAnteil, 0) + " %", g.anteil <= ZIELE.outlaneAnteil);
  zeile("mittlere Spieldauer", komma(g.dauer, 2) + " min", "mindestens " + komma(ZIELE.spieldauerMin, 1) + " min", g.dauer >= ZIELE.spieldauerMin);
  zeile("Missionen je Spiel", komma(g.missionen, 2), "mindestens " + komma(ZIELE.missionen, 1), g.missionen >= ZIELE.missionen);
  zeile("Spiele mit Multiball", komma(100 * g.multiball, 0) + " %", "mindestens " + komma(100 * ZIELE.multiballAnteil, 0) + " %", g.multiball >= ZIELE.multiballAnteil);
  zeile("längstes Spiel", komma(g.dauerMax, 1) + " min", "höchstens " + ZIELE.spieldauerMax + " min", g.dauerMax <= ZIELE.spieldauerMax);
  if (g.anteil > ZIELE.outlaneAnteil) fehler.push(`gutes Profil: Outlane-Anteil ${komma(100 * g.anteil, 1)} % (Ziel höchstens ${komma(100 * ZIELE.outlaneAnteil, 0)} %)`);
  if (g.dauer < ZIELE.spieldauerMin) fehler.push(`gutes Profil: mittlere Spieldauer ${komma(g.dauer, 2)} min (Ziel mindestens ${ZIELE.spieldauerMin})`);
  if (g.missionen < ZIELE.missionen) fehler.push(`gutes Profil: ${komma(g.missionen, 2)} Missionen je Spiel (Ziel mindestens ${ZIELE.missionen})`);
  if (g.multiball < ZIELE.multiballAnteil) fehler.push(`gutes Profil: Multiball in ${komma(100 * g.multiball, 0)} % der Spiele (Ziel mindestens ${komma(100 * ZIELE.multiballAnteil, 0)} %)`);
  if (g.dauerMax > ZIELE.spieldauerMax) fehler.push(`gutes Profil: längstes Dreikugelspiel ${komma(g.dauerMax, 1)} min (Höchstgrenze ${ZIELE.spieldauerMax}): Endlosschleife?`);
}
if (ergebnis.schwach) {
  const s = ergebnis.schwach;
  console.log(`  schwaches Profil: Spieldauer ${komma(s.dauer, 2)} min, Outlane-Anteil ${komma(100 * s.anteil, 1)} %, Missionen ${komma(s.missionen, 2)} je Spiel (nur Bericht; Untergrenze der Dauer ${komma(SCHWACH_DAUER_MIN, 1)} min, vorher 1,59)`);
  if (s.dauer < SCHWACH_DAUER_MIN) fehler.push(`schwaches Profil: mittlere Spieldauer nur ${komma(s.dauer, 2)} min (Untergrenze ${SCHWACH_DAUER_MIN})`);
}

const laufzeit = (Date.now() - STARTZEIT) / 1000;
console.log(`\nLaufzeit ${komma(laufzeit, 1)} s`);
if (laufzeit > 150) fehler.push(`Laufzeit ${komma(laufzeit, 1)} s (Ziel unter etwa 120 s)`);
if (fehler.length) {
  for (const f of fehler) console.log("  FEHLER " + f);
  console.log("SPIEL: DURCHGEFALLEN");
  process.exit(1);
}
console.log("SPIEL: BESTANDEN");
