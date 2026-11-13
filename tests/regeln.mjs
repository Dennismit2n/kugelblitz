// Einzelprüfungen des Regelwerks mit künstlichen Ereignissen.
//
//   node tests/regeln.mjs
//
// Die Physik steht still (kein Takt außer dort, wo es um den Fang in der Zündkammer geht); die Prüfungen
// füttern das Regelwerk mit Ereignissen von Hand und lesen den Zustand `regelwerk.z`.
// Ausgabe: je Abschnitt die Zahl der Prüfungen, am Ende SUMME und Exit 0 (alles gut) oder 1.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const hier = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const P = require(path.join(hier, "..", "physik.js"));
const R = require(path.join(hier, "..", "regeln.js"));
const S = require(path.join(hier, "..", "sprachen.js"));

// Jede Meldung, die das Regelwerk in einer der Prüfungen unten schreibt, wird mitgeschrieben: Am Ende muss jede in
// R.MELDUNGEN stehen und in allen 14 Sprachen einen Text haben (Abschnitt „Sprachen“).
const benutzteMeldungen = new Set();
{
  const melde = R.Regelwerk.prototype.melde;
  R.Regelwerk.prototype.melde = function (schluessel, ...rest) {
    benutzteMeldungen.add(schluessel);
    return melde.call(this, schluessel, ...rest);
  };
}

const fehler = [];
let gesamt = 0;
let abschnittZaehler = 0;
let abschnittName = "";
const ausgabe = [];

function abschnitt(name) {
  if (abschnittName) ausgabe.push(`  ${abschnittName.padEnd(54)} ${abschnittZaehler} Prüfungen`);
  abschnittName = name;
  abschnittZaehler = 0;
}
function pruefe(bedingung, text) {
  gesamt++;
  abschnittZaehler++;
  if (!bedingung) fehler.push(`${abschnittName}: ${text}`);
}
function gleich(ist, soll, text) {
  pruefe(ist === soll, `${text} (ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)})`);
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Aufbau und Hilfen ---------------------------------------------------------

function neu(opt = {}) {
  const t = new P.Tisch(P.standardBauplan());
  const speicher = opt.speicher || R.speicherImArbeitsspeicher();
  const r = new R.Regelwerk(t, { zufall: mulberry32(opt.seed ?? 1), speicher, jetzt: opt.jetzt || (() => "2026-11-13"), kugeln: opt.kugeln });
  r.starte();
  return { t, r, z: r.z, speicher };
}

const kugel0 = (s) => s.r.meine()[0];

// Die Kugel von der Rampe ins Feld legen, damit das Spiel läuft
function insFeld(s, x = 0.5, y = 0.75) {
  const k = kugel0(s);
  k.pos.x = x; k.pos.y = y; k.vel.x = 0; k.vel.y = -1;
  s.r.schritt(0.001);
  return k;
}

const bumperE = (s, k, i = 0) => ({ art: "bumper", bumper: s.t.bumper[i], kugel: k });
const wandE = (s, name, k, tritt = false) => ({ art: "wand", wand: s.t.waehle(name)[0], kugel: k, tempo: 1, tritt });
const sensorE = (s, name, k) => ({ art: "sensor", sensor: s.t.waehle(name)[0], kugel: k, tempo: 1 });
const gasseE = (s, i, k) => sensorE(s, "gasse-" + (i + 1), k);

function schritt(s, ...e) { s.r.schritt(0.016, e); }
function fallend(k) { k.vel.y = -1; return k; }

// Eine echte Kugel von der Physik in die Zündkammer fangen lassen und das Ereignis ans Regelwerk geben.
function fange(s, k) {
  const l = s.t.loecher[0];
  k.pos.x = l.pos.x; k.pos.y = l.pos.y; k.vel.x = 0; k.vel.y = 0;
  l.sperre.delete(k);
  s.t.ereignisse.length = 0;
  s.t.vorruecken(1 / 120);
  const e = s.t.ereignisse.filter((x) => x.art === "loch");
  s.t.ereignisse.length = 0;
  s.r.schritt(0.0001, e);
  return e.length > 0;
}

function auswerfen(s) { s.r.schritt(1.05); }                       // Haltezeit der Zündkammer ablaufen lassen

function abfluss(s, k) { k.pos.x = 0.5; k.pos.y = 0.03; k.vel.x = 0; k.vel.y = -1; s.r.schritt(0.016); }

function bonusAus(s) {
  for (let i = 0; i < 400 && s.z.phase === "bonus"; i++) s.r.schritt(0.1);
}

// Spiel mit Kugel im Feld und abgelaufenem Ballschutz
function imSpiel(opt) {
  const s = neu(opt);
  const k = insFeld(s);
  s.r.schritt(20);                                                  // Ballschutz ist nur nach einem Abschuss aktiv, hier trotzdem sicher
  return { s, k };
}

function einBall(s) {                                               // Kugel ohne Ballschutz verlieren lassen
  const k = kugel0(s);
  k.schutzBis = 0;
  abfluss(s, k);
}

// ===============================================================================
abschnitt("Spielstart");
{
  const s = neu();
  gleich(s.z.phase, "bereit", "Phase nach dem Start");
  gleich(s.z.kugelNr, 1, "Kugel 1");
  gleich(s.r.meine().length, 1, "eine Kugel auf der Rampe");
  pruefe(s.r.inRampe(kugel0(s)), "die Kugel liegt in der Rampe");
  gleich(s.z.punkte, 0, "Punkte null");
  gleich(s.z.lichter.kickback, true, "Kickback leuchtet zu Spielbeginn");
  gleich(s.z.multiplikator, 1, "Multiplikator 1");
  gleich(s.z.rang.schluessel, "funke", "Rang Funke");
  gleich(s.z.mission.schluessel, "ladung", "erste Mission (Ladung sammeln) ist ausgewählt");
  gleich(s.z.mission.aktiv, false, "Mission noch nicht aktiv");
  gleich(s.z.lichter.zuendkammer, "mission", "Zündkammer leuchtet 'Mission starten'");
  pruefe(s.z.lichter.zielmarke >= 0 && s.z.lichter.zielmarke <= 2, "eine Gasse trägt die Zielmarke");
  const k = kugel0(s);
  insFeld(s);
  gleich(s.z.phase, "spiel", "nach dem Verlassen der Rampe läuft das Spiel");
  k.pos.x = 1.04; k.pos.y = 0.1;
  s.r.schritt(0.001);
  gleich(s.z.phase, "bereit", "wieder in der Rampe: wieder bereit");
  // Probekugeln fasst das Regelwerk nicht an
  const probe = new P.Kugel(new P.Vec2(0.5, 0.5), new P.Vec2(0, -1));
  probe.probe = true;
  s.t.kugeln.push(probe);
  abfluss(s, probe);
  gleich(s.r.meine().length, 1, "Probekugel im Abfluss zählt nicht");
  s.r.schritt(0.016, [{ art: "bumper", bumper: s.t.bumper[0], kugel: probe }]);
  gleich(s.z.punkte, 0, "Ereignis einer Probekugel gibt keine Punkte");
}

// ===============================================================================
abschnitt("Bumper, Schleudern, In- und Outlanes");
{
  const { s, k } = imSpiel();
  schritt(s, bumperE(s, k, 0));
  gleich(s.z.punkte, 100, "Bumper 100");
  schritt(s, bumperE(s, k, 2), bumperE(s, k, 1));
  gleich(s.z.punkte, 300, "drei Bumper 300");
  schritt(s, wandE(s, "schleuder-l-flaeche", k, true));
  gleich(s.z.punkte, 310, "Schleuder-Tritt 10");
  schritt(s, wandE(s, "schleuder-r-flaeche", k, false));
  gleich(s.z.punkte, 310, "Schleuder ohne Tritt: nichts");
  schritt(s, sensorE(s, "inlane-l", fallend(k)));
  gleich(s.z.punkte, 410, "Inlane 100");
  schritt(s, sensorE(s, "outlane-r", fallend(k)));
  gleich(s.z.punkte, 1410, "Outlane 1.000");
  k.vel.y = 1;
  schritt(s, sensorE(s, "outlane-l", k), sensorE(s, "inlane-r", k));
  gleich(s.z.punkte, 1410, "aufsteigende Kugel gibt in In- und Outlane nichts");
}

// ===============================================================================
abschnitt("Gassen oben, Multiplikator, Lane-Wechsel");
{
  const { s, k } = imSpiel();
  s.r.skillOffen = false;
  schritt(s, gasseE(s, 0, fallend(k)));
  gleich(s.z.punkte, 500, "Gasse L 500");
  gleich(s.z.lichter.gasse.join(), "true,false,false", "L leuchtet");
  k.vel.y = 1;
  schritt(s, gasseE(s, 1, k));
  gleich(s.z.lichter.gasse.join(), "true,false,false", "aufsteigende Kugel zündet keine Gasse");
  gleich(s.z.punkte, 500, "aufsteigende Kugel gibt nichts");
  schritt(s, gasseE(s, 0, fallend(k)));
  gleich(s.z.punkte, 1000, "dieselbe Gasse noch einmal: 500, kein neuer Posten");
  // Lane-Wechsel
  s.r.flipperTaste(1);
  gleich(s.z.lichter.gasse.join(), "false,true,false", "rechte Flippertaste schiebt das Licht nach rechts");
  s.r.flipperTaste(1);
  gleich(s.z.lichter.gasse.join(), "false,false,true", "noch einmal nach rechts");
  s.r.flipperTaste(1);
  gleich(s.z.lichter.gasse.join(), "true,false,false", "über den Rand zurück nach links");
  s.r.flipperTaste(0);
  gleich(s.z.lichter.gasse.join(), "false,false,true", "linke Flippertaste schiebt nach links, über den Rand");
  s.r.flipperTaste(0);
  gleich(s.z.lichter.gasse.join(), "false,true,false", "noch einmal nach links");
  // zwei brennen, dritte macht voll
  schritt(s, gasseE(s, 0, fallend(k)));
  schritt(s, gasseE(s, 2, fallend(k)));
  gleich(s.z.multiplikator, 2, "alle drei an: Multiplikator 2");
  gleich(s.z.lichter.gasse.join(), "false,false,false", "danach gehen die Gassen aus");
  // Multiplikator bis 5, nicht weiter
  for (let m = 3; m <= 6; m++) {
    for (let i = 0; i < 3; i++) schritt(s, gasseE(s, i, fallend(k)));
  }
  gleich(s.z.multiplikator, 5, "Multiplikator bleibt bei 5");
  gleich(s.z.lichter.multiplikator.join(), "true,true,true,true", "alle vier Multiplikator-Lichter an");
  // Tilt und Pause sperren den Lane-Wechsel
  s.z.tilt = true;
  schritt(s, gasseE(s, 0, k));
  const vor = s.z.lichter.gasse.join();
  gleich(s.r.flipperTaste(0), false, "bei Tilt kein Lane-Wechsel");
  s.r.schritt(0);
  gleich(s.z.lichter.gasse.join(), vor, "Lichter bleiben bei Tilt");
}

// ===============================================================================
abschnitt("Skill Shot");
{
  const s = neu({ seed: 7 });
  const k0 = kugel0(s);
  const ziel = s.z.lichter.zielmarke;
  pruefe(s.r.abschuss(0.5), "Abschuss mit Ladung 0,5");
  pruefe(Math.abs(k0.vel.y - (1.8 + 0.5 * 3.6)) < 1e-9, "Abschusstempo aus der Ladung");
  pruefe(k0.schutzBis > s.r.uhr + 7.9, "Ballschutz läuft nach dem Abschuss");
  const k = insFeld(s);
  schritt(s, gasseE(s, ziel, fallend(k)));
  gleich(s.z.punkte, 10500, "erste Gasse ist die Zielmarke: 10.000 und 500");
  gleich(s.z.statistik.skillShots, 1, "ein Skill Shot");
  schritt(s, gasseE(s, ziel, fallend(k)));
  gleich(s.z.punkte, 11000, "zweiter Treffer gibt keinen Skill Shot mehr");

  // falsche Gasse zuerst: später keiner mehr
  const s2 = neu({ seed: 8 });
  const zl = s2.z.lichter.zielmarke;
  s2.r.abschuss(0.5);
  const k2 = insFeld(s2);
  const falsch = (zl + 1) % 3;
  schritt(s2, gasseE(s2, falsch, fallend(k2)));
  gleich(s2.z.punkte, 500, "falsche Gasse zuerst: nur 500");
  schritt(s2, gasseE(s2, zl, fallend(k2)));
  gleich(s2.z.punkte, 1000, "danach die Zielgasse: kein Skill Shot mehr");

  // ohne Abschuss kein Skill Shot
  const s3 = neu({ seed: 9 });
  const k3 = insFeld(s3);
  schritt(s3, gasseE(s3, s3.r.zielGasse, fallend(k3)));
  gleich(s3.z.punkte, 500, "ohne Abschuss kein Skill Shot");

  // aufsteigende Kugel verbraucht den Skill Shot nicht
  const s4 = neu({ seed: 10 });
  const z4 = s4.z.lichter.zielmarke;
  s4.r.abschuss(0.5);
  const k4 = insFeld(s4);
  k4.vel.y = 1;
  schritt(s4, gasseE(s4, z4, k4));
  gleich(s4.z.punkte, 0, "Steigen zählt nicht");
  schritt(s4, gasseE(s4, z4, fallend(k4)));
  gleich(s4.z.punkte, 10500, "erster fallender Treffer nach dem Steigen zählt");

  // Zielmarke wechselt je Kugel
  const s5 = neu({ seed: 11 });
  const ziele = [s5.z.lichter.zielmarke];
  for (let nr = 1; nr <= 2; nr++) {
    const kk = insFeld(s5);
    s5.r.schritt(20);
    einBall(s5);
    bonusAus(s5);
    ziele.push(s5.z.lichter.zielmarke);
  }
  pruefe(ziele[0] !== ziele[1] && ziele[1] !== ziele[2], "Zielmarke wechselt je Kugel: " + ziele.join());
  gleich(s5.z.kugelNr, 3, "nach zwei Verlusten Kugel 3");
}

// ===============================================================================
abschnitt("Kickback und Standup-Ziele");
{
  const { s, k } = imSpiel();
  k.pos.x = 0.1; k.pos.y = 0.24; k.vel.y = -1;
  schritt(s, sensorE(s, "kickback", k));
  pruefe(k.vel.y > 2, "Kickback schießt die Kugel nach oben");
  gleich(s.z.lichter.kickback, false, "Kickback geht danach aus");
  k.vel.y = -1;
  schritt(s, sensorE(s, "kickback", k));
  pruefe(k.vel.y === -1, "ohne Licht schießt der Kickback nicht noch einmal");
  k.vel.y = 1;
  s.z.lichter.kickback = false;
  // Standup-Ziele
  schritt(s, wandE(s, "standup-1", k));
  gleich(s.z.punkte, 750, "Standup 750");
  gleich(s.z.lichter.standup.join(), "true,false,false", "Standup 1 leuchtet");
  schritt(s, wandE(s, "standup-1", k));
  gleich(s.z.punkte, 1500, "dasselbe Ziel noch einmal: 750, kein Fortschritt");
  gleich(s.z.lichter.kickback, false, "Kickback noch aus");
  schritt(s, wandE(s, "standup-2", k));
  schritt(s, wandE(s, "standup-3", k));
  gleich(s.z.lichter.kickback, true, "Satz komplett: Kickback wieder an");
  gleich(s.z.lichter.standup.join(), "false,false,false", "Satz geht zurück");
  gleich(s.z.statistik.standupSaetze, 1, "ein Satz");
  k.pos.x = 0.1; k.pos.y = 0.24; k.vel.y = -1;
  schritt(s, sensorE(s, "kickback", k));
  pruefe(k.vel.y > 2, "und der Kickback schießt wieder");
  // aufsteigend im Kickback-Sensor: nichts
  const { s: s2, k: k2 } = imSpiel();
  k2.vel.y = 1;
  schritt(s2, sensorE(s2, "kickback", k2));
  gleich(s2.z.lichter.kickback, true, "aufsteigende Kugel löst den Kickback nicht aus");
}

// ===============================================================================
abschnitt("Fallziel-Bank");
{
  const { s, k } = imSpiel();
  k.pos.x = 0.5; k.pos.y = 0.7;
  const w1 = s.t.waehle("fallziel-1")[0];
  schritt(s, wandE(s, "fallziel-1", k));
  gleich(w1.aktiv, false, "Fallziel 1 versinkt (Wand inaktiv)");
  gleich(s.z.punkte, 500, "Fallziel 500");
  gleich(s.z.lichter.fallziel.join(), "false,true,true", "Lichterzustand der Bank");
  schritt(s, wandE(s, "fallziel-2", k));
  schritt(s, wandE(s, "fallziel-3", k));
  gleich(s.z.punkte, 500 * 3 + 5000, "Bank leer 5.000");
  gleich(s.z.banken, 1, "eine Bank geleert");
  s.r.schritt(0.5);
  gleich(w1.aktiv, false, "nach 0,5 s steht die Bank noch nicht wieder");
  s.r.schritt(0.8);
  gleich(s.t.waehle("fallziel").every((w) => w.aktiv), true, "nach der Pause steht die Bank wieder");
  // Kugel im Weg: Bank bleibt unten
  const s2 = neu();
  const k2 = insFeld(s2, 0.5, 0.7);
  for (const n of ["fallziel-1", "fallziel-2", "fallziel-3"]) schritt(s2, wandE(s2, n, k2));
  k2.pos.x = 0.05; k2.pos.y = 1.0; k2.vel.x = 0; k2.vel.y = 0;      // Kugel liegt vor der Bank
  s2.r.schritt(3);
  gleich(s2.t.waehle("fallziel").every((w) => !w.aktiv), true, "Kugel im Weg: Bank bleibt unten");
  k2.pos.x = 0.5; k2.pos.y = 0.7;
  s2.r.schritt(0.1);
  gleich(s2.t.waehle("fallziel").every((w) => w.aktiv), true, "Weg frei: Bank steht auf");
  // Dritte Bank: Extraball leuchtet
  const s3 = neu();
  const k3 = insFeld(s3, 0.5, 0.7);
  for (let b = 1; b <= 3; b++) {
    for (const n of ["fallziel-1", "fallziel-2", "fallziel-3"]) schritt(s3, wandE(s3, n, k3));
    gleich(s3.z.lichter.extraball, b === 3, "Extraball leuchtet erst nach der dritten Bank (Bank " + b + ")");
    s3.r.schritt(1.5);
  }
  gleich(s3.z.lichter.zuendkammer, "extraball", "Zündkammer zeigt den Extraball");
  // Tilt: Ziel versinkt, aber keine Punkte
  const s4 = neu();
  const k4 = insFeld(s4, 0.5, 0.7);
  s4.z.tilt = true;
  schritt(s4, wandE(s4, "fallziel-1", k4));
  gleich(s4.t.waehle("fallziel-1")[0].aktiv, false, "bei Tilt versinkt das Ziel trotzdem");
  gleich(s4.z.punkte, 0, "bei Tilt keine Punkte");
}

// ===============================================================================
abschnitt("Zündkammer: Halten, Auswurf und Vorrang");
{
  const { s, k } = imSpiel();
  pruefe(fange(s, k), "Physik fängt die Kugel in der Zündkammer");
  gleich(s.z.punkte, 2500, "Zündkammer 2.500");
  pruefe(k.gehalten !== null, "Kugel wird gehalten");
  s.r.schritt(0.9);
  pruefe(k.gehalten !== null, "nach 0,9 s noch gehalten");
  s.r.schritt(0.2);
  gleich(k.gehalten, null, "nach 1,0 s ausgeworfen");
  pruefe(k.vel.length() > 2, "mit Auswurftempo");
  gleich(s.z.mission.aktiv, true, "Zündkammer startete die Mission (nichts anderes leuchtete)");
  gleich(s.z.lichter.zuendkammer, "", "danach leuchtet nichts mehr");

  // Vorrang: alles leuchtet, Extraball zuerst
  const a = imSpiel().s;
  a.z.extraballBereit = true;
  a.r.mbNaechste = 0;                                              // Multiball bereit
  a.r.aktualisiere();
  gleich(a.z.lichter.zuendkammer, "extraball", "Vorrang 1: Extraball vor Multiball und Mission (Lichterzustand)");
  fange(a, kugel0(a)); auswerfen(a);
  gleich(a.z.extraBaelle, 1, "Extraball abgeholt");
  gleich(a.z.multiball.aktiv, false, "kein Multiball in dieser Runde");
  gleich(a.z.mission.aktiv, false, "keine Mission in dieser Runde");
  gleich(a.r.zuendWahl(), "multiball", "Vorrang 2: danach Multiball vor Mission");
  fange(a, kugel0(a)); auswerfen(a);
  gleich(a.z.multiball.aktiv, true, "Multiball gestartet");
  gleich(a.z.mission.aktiv, false, "Mission läuft in dieser Runde nicht an");
  gleich(a.r.zuendWahl(), "jackpot", "Vorrang 4: im Multiball leuchtet der Jackpot, nicht 'Mission starten'");
  const b = imSpiel().s;
  b.r.mbNaechste = 0;
  b.z.mission.aktiv = false;
  gleich(b.r.zuendWahl(), "multiball", "Multiball bereit schlägt Mission");
  b.r.mbNaechste = 99;
  gleich(b.r.zuendWahl(), "mission", "Vorrang 3: Mission starten");
  b.z.mission.aktiv = true;
  gleich(b.r.zuendWahl(), "", "Mission aktiv, nichts bereit: nichts leuchtet");
  // Tilt: kein Punkt, aber die Kugel kommt nach 1 s wieder heraus
  const c = imSpiel().s;
  const kc = kugel0(c);
  c.z.tilt = true;
  fange(c, kc);
  gleich(c.z.punkte, 0, "bei Tilt keine Zündkammer-Punkte");
  c.r.schritt(1.1);
  gleich(kc.gehalten, null, "bei Tilt wird trotzdem ausgeworfen");
}

// ===============================================================================
abschnitt("Missionen und Ränge");
{
  const kurz = (s) => s.r.aktualisiere();
  // 1: Bumper
  let { s, k } = imSpiel();
  fange(s, k); auswerfen(s);                                         // Mission starten
  gleich(s.z.mission.aktiv, true, "Mission 1 aktiv");
  const nachStart = s.z.punkte;
  for (let i = 0; i < 14; i++) schritt(s, bumperE(s, k, i % 3));
  gleich(s.z.mission.fortschritt, 14, "14 von 15 Bumpertreffern");
  gleich(s.z.mission.aktiv, true, "noch nicht fertig");
  schritt(s, bumperE(s, k, 0));
  gleich(s.z.mission.aktiv, false, "15 Bumpertreffer: Mission 1 fertig");
  gleich(s.z.punkte - nachStart, 15 * 100 + 25000 * 1, "Mission 1 gibt 25.000 mal Rang 1");
  gleich(s.z.rang.schluessel, "glimmer", "Rang steigt auf Glimmer");
  gleich(s.z.mission.schluessel, "leitbahnen", "nächste Mission (Leitbahnen) ausgewählt");

  // 2: Gassen
  ({ s, k } = imSpiel());
  s.z.mission.erfuellt = 1; kurz(s);
  fange(s, k); auswerfen(s);
  const p2 = s.z.punkte;
  for (let i = 0; i < 2; i++) schritt(s, gasseE(s, i, fallend(k)));
  gleich(s.z.mission.aktiv, true, "Mission 2: zwei von drei Gassen reichen nicht");
  schritt(s, gasseE(s, 2, fallend(k)));
  gleich(s.z.mission.aktiv, false, "Mission 2 fertig nach einmal alle drei (Abschnitt 2b: vorher zweimal)");
  gleich(s.z.punkte - p2, 3 * 500 + 25000 * 2, "Mission 2 gibt 25.000 mal Rang 2");
  gleich(s.z.rang.schluessel, "leuchter", "Rang Leuchter");

  // 3: Bank
  ({ s, k } = imSpiel());
  s.z.mission.erfuellt = 2; kurz(s);
  fange(s, k); auswerfen(s);
  const p3 = s.z.punkte;
  for (let b = 0; b < 2; b++) {
    for (const n of ["fallziel-1", "fallziel-2", "fallziel-3"]) schritt(s, wandE(s, n, k));
    s.r.schritt(1.5);
  }
  gleich(s.z.mission.aktiv, false, "Mission 3 fertig nach zweimal Bank leeren");
  gleich(s.z.punkte - p3, 2 * (3 * 500 + 5000) + 25000 * 3, "Mission 3 gibt 25.000 mal Rang 3");
  gleich(s.z.rang.schluessel, "gewitter", "Rang Gewitter");

  // 4: Standups (der Mission liegen schon leuchtende Ziele zugute)
  ({ s, k } = imSpiel());
  s.z.mission.erfuellt = 3; kurz(s);
  s.r.mbNaechste = 99;
  schritt(s, wandE(s, "standup-1", k));
  fange(s, k); auswerfen(s);
  gleich(s.z.mission.fortschritt, 1, "Mission 4 startet mit dem schon leuchtenden Ziel");
  schritt(s, wandE(s, "standup-2", k));
  gleich(s.z.mission.fortschritt, 2, "zwei von drei");
  const p4 = s.z.punkte;
  schritt(s, wandE(s, "standup-3", k));
  gleich(s.z.mission.aktiv, false, "Mission 4 fertig");
  gleich(s.z.punkte - p4, 750 + 25000 * 4, "Mission 4 gibt 25.000 mal Rang 4");
  gleich(s.z.rang.schluessel, "sturmfront", "Rang Sturmfront");

  // 5: Zündkammer (der Besuch, der sie startet, zählt nicht)
  ({ s, k } = imSpiel());
  s.z.mission.erfuellt = 4; kurz(s);
  s.r.mbNaechste = 99;
  fange(s, k); auswerfen(s);
  gleich(s.z.mission.aktiv, true, "Mission 5 aktiv");
  gleich(s.z.mission.fortschritt, 0, "der Startbesuch zählt nicht");
  const p5 = s.z.punkte;
  for (let i = 0; i < 3; i++) { fange(s, k); auswerfen(s); }
  gleich(s.z.mission.aktiv, false, "Mission 5 fertig nach drei Besuchen");
  gleich(s.z.punkte - p5, 3 * 2500 + 25000 * 5, "Mission 5 gibt 25.000 mal Rang 5");
  gleich(s.z.rang.schluessel, "kugelblitz", "Rang Kugelblitz");
  gleich(s.z.mission.schluessel, "ladung", "nach der fünften beginnen die Missionen von vorn");

  // Wert bleibt bei Rang 6
  s.r.mbNaechste = 99;
  fange(s, k); auswerfen(s);
  const p6 = s.z.punkte;
  for (let i = 0; i < 15; i++) schritt(s, bumperE(s, k, 0));
  gleich(s.z.punkte - p6, 15 * 100 + 25000 * 6, "zweite Runde: 25.000 mal Rang 6");
  gleich(s.z.rang.nr, 6, "Rang bleibt 6");
  // Missionszähler zählt nur für die aktive Mission
  const { s: u, k: ku } = imSpiel();
  for (let i = 0; i < 20; i++) schritt(u, bumperE(u, ku, 0));
  gleich(u.z.mission.fortschritt, 0, "ohne aktive Mission kein Fortschritt");
  gleich(u.z.rang.nr, 1, "Rang unverändert");
}

// ===============================================================================
abschnitt("Multiball und Jackpot");
{
  const { s, k } = imSpiel();
  s.z.mission.erfuellt = 2; s.r.aktualisiere();
  gleich(s.z.multiball.bereit, false, "nach zwei Missionen noch kein Multiball");
  gleich(s.z.lichter.multiball, false, "Licht aus");
  s.z.mission.erfuellt = 3; s.r.aktualisiere();
  gleich(s.z.rang.schluessel, "gewitter", "Rang Gewitter");
  gleich(s.z.multiball.bereit, true, "mit Rang Gewitter ist der Multiball bereit");
  gleich(s.z.lichter.zuendkammer, "multiball", "Zündkammer leuchtet 'Multiball'");
  k.schutzBis = 0;
  fange(s, k);
  gleich(s.z.multiball.aktiv, true, "Multiball läuft");
  gleich(s.r.meine().length, 2, "zweite Kugel ist da");
  const zweite = s.r.meine().find((x) => x !== k);
  pruefe(zweite.vel.y > 3, "zweite Kugel schießt selbst aus der Rampe");
  pruefe(zweite.schutzBis - s.r.uhr > 11.9, "Ballschutz 12 s im Multiball");
  auswerfen(s);
  gleich(s.z.lichter.jackpot, true, "Jackpot leuchtet");
  gleich(s.z.multiball.bereit, false, "Multiball nicht noch einmal bereit");
  const p = s.z.punkte;
  fange(s, k); auswerfen(s);
  gleich(s.z.punkte - p, 2500 + 50000, "erster Jackpot 50.000");
  const p2 = s.z.punkte;
  fange(s, k); auswerfen(s);
  gleich(s.z.punkte - p2, 2500 + 60000, "zweiter Jackpot 60.000");
  const p3 = s.z.punkte;
  fange(s, k); auswerfen(s);
  gleich(s.z.punkte - p3, 2500 + 70000, "dritter Jackpot 70.000");
  gleich(s.z.statistik.jackpots, 3, "drei Jackpots");
  // Ende: nur noch eine Kugel
  zweite.schutzBis = 0;
  abfluss(s, zweite);
  gleich(s.z.multiball.aktiv, false, "Multiball endet, wenn nur noch eine Kugel da ist");
  gleich(s.z.phase, "spiel", "die verbliebene Kugel spielt weiter");
  gleich(s.z.lichter.jackpot, false, "Jackpot aus");
  gleich(s.z.multiball.bereit, false, "Multiball erst nach einer weiteren Mission wieder bereit");
  s.z.mission.erfuellt = 4;
  s.r.aktualisiere();
  gleich(s.z.multiball.bereit, true, "mit Rang Sturmfront wieder bereit");
  gleich(s.z.mission.aktiv, false, "die Mission, die der Multiball verdrängt hat, ist offen");

  // Beide Kugeln gleichzeitig weg: Kugelende mit Bonus
  const m = imSpiel().s;
  m.z.mission.erfuellt = 3; m.r.aktualisiere();
  fange(m, kugel0(m));
  m.r.schritt(1.2);
  for (const kk of m.r.meine()) { kk.schutzBis = 0; kk.pos.x = 0.5; kk.pos.y = 0.03; kk.pos.x += kk === m.r.meine()[0] ? 0 : 0.2; }
  m.r.schritt(0.016);
  gleich(m.z.phase, "bonus", "beide Kugeln weg: Bonus");
  gleich(m.z.multiball.aktiv, false, "Multiball vorbei");

  // Ballschutz im Multiball: die Kugel kommt wieder heraus
  const g = imSpiel().s;
  g.z.mission.erfuellt = 3; g.r.aktualisiere();
  fange(g, kugel0(g));
  g.r.schritt(1.2);
  const vor = g.r.meine().length;
  const opfer = g.r.meine()[1];
  abfluss(g, opfer);
  gleich(g.r.meine().length, vor, "Ballschutz im Multiball: wieder zwei Kugeln");
  gleich(g.z.multiball.aktiv, true, "Multiball läuft weiter");
  pruefe(g.r.meine().some((x) => x.vel.y > 3), "die Kugel schießt selbst wieder ab");
}

// ===============================================================================
abschnitt("Ballschutz");
{
  const s = neu();
  const k = kugel0(s);
  s.r.abschuss(0.6);
  insFeld(s);
  s.r.schritt(7.9);
  abfluss(s, k);
  gleich(s.z.statistik.ballschutz, 1, "Verlust nach 7,9 s: Ballschutz greift");
  gleich(s.z.kugelNr, 1, "Kugel wird nicht gezählt");
  gleich(s.z.phase, "bereit", "Kugel wieder auf der Rampe, bereit");
  gleich(s.r.meine().length, 1, "genau eine Kugel");
  pruefe(s.r.inRampe(kugel0(s)), "die neue Kugel liegt in der Rampe");
  gleich(s.z.bonus.aktiv, false, "kein Bonus nach Ballschutz");

  const s2 = neu();
  const k2 = kugel0(s2);
  s2.r.abschuss(0.6);
  insFeld(s2);
  s2.r.schritt(8.1);
  abfluss(s2, k2);
  gleich(s2.z.statistik.ballschutz, 0, "Verlust nach 8,1 s: kein Ballschutz");
  gleich(s2.z.phase, "bonus", "Kugel verloren: Bonus");

  // Tilt hebt den Ballschutz auf
  const s3 = neu();
  const k3 = kugel0(s3);
  s3.r.abschuss(0.6);
  insFeld(s3);
  s3.z.tilt = true;
  abfluss(s3, k3);
  gleich(s3.z.statistik.ballschutz, 0, "bei Tilt kein Ballschutz");
  gleich(s3.z.phase, "bonus", "Tilt: Kugel ist weg");

  // Ohne Abschuss (z. B. nur ins Feld gelegt) gibt es keinen Ballschutz
  const s4 = neu();
  const k4 = insFeld(s4);
  abfluss(s4, k4);
  gleich(s4.z.statistik.ballschutz, 0, "ohne Abschuss kein Ballschutz");

  // Anzeige: Rest-Schutz
  const s5 = neu();
  s5.r.abschuss(0.6);
  insFeld(s5);
  s5.r.schritt(2);
  pruefe(Math.abs(s5.z.schutz - 6) < 0.05, "z.schutz zählt herunter: " + s5.z.schutz);
}

// ===============================================================================
abschnitt("Bonus am Kugelende");
{
  const { s, k } = imSpiel();
  // Posten: 3 Gassen (je 200), 2 Fallziele (je 200), ein Standup (200), eine Mission (5.000), Multiplikator 2
  for (let i = 0; i < 3; i++) schritt(s, gasseE(s, i, fallend(k)));
  schritt(s, wandE(s, "fallziel-1", k));
  schritt(s, wandE(s, "fallziel-2", k));
  schritt(s, wandE(s, "standup-1", k));
  s.r.posten.missionen = 1;
  const vorher = s.z.punkte;
  gleich(s.z.multiplikator, 2, "Multiplikator 2 vor dem Ende");
  einBall(s);
  gleich(s.z.phase, "bonus", "Bonusphase");
  const basis = 200 * 6 + 5000;
  gleich(s.z.bonus.basis, basis, "Bonus-Basis 6 Posten mal 200 plus Mission 5.000");
  let letzter = -1;
  let monoton = true;
  let sahMitte = false;
  let sahFaktor2 = false;
  for (let i = 0; i < 400 && s.z.phase === "bonus"; i++) {
    s.r.schritt(0.05);
    if (s.z.phase !== "bonus") break;
    const zz = s.z.bonus.zaehler;
    if (zz < letzter) monoton = false;
    if (zz > 0 && zz < basis) sahMitte = true;
    if (s.z.bonus.faktor === 2) sahFaktor2 = true;
    letzter = zz;
  }
  pruefe(monoton, "Zählstand wächst nur");
  pruefe(sahMitte, "der Zählstand läuft sichtbar hoch (Zwischenwerte)");
  pruefe(sahFaktor2, "der Multiplikator wird als Stufe gezeigt");
  gleich(letzter, basis * 2, "Zählstand endet bei Basis mal 2");
  gleich(s.z.punkte - vorher, basis * 2, "Punkte wachsen um den Bonus");
  gleich(s.z.kugelNr, 2, "danach Kugel 2");
  gleich(s.z.multiplikator, 1, "Multiplikator zurück auf 1");
  gleich(s.z.phase, "bereit", "bereit für die nächste Kugel");
  const k2 = insFeld(s);
  einBall(s);
  gleich(s.z.bonus.basis, 0, "Bonus je Kugel von null: neue Kugel ohne Posten");
  bonusAus(s);

  // Bonus überspringen: gleiches Ergebnis
  const { s: t, k: kt } = imSpiel();
  for (let i = 0; i < 3; i++) schritt(t, gasseE(t, i, fallend(kt)));
  const v = t.z.punkte;
  einBall(t);
  t.r.schritt(0.2);
  pruefe(t.r.ueberspringeBonus(), "Bonus lässt sich überspringen");
  for (let i = 0; i < 40 && t.z.phase === "bonus"; i++) t.r.schritt(0.1);
  gleich(t.z.punkte - v, 600 * 2, "übersprungen: dieselben Punkte");

  // Tilt kostet den Bonus
  const { s: u, k: ku } = imSpiel();
  for (let i = 0; i < 3; i++) schritt(u, gasseE(u, i, fallend(ku)));
  const w = u.z.punkte;
  u.r.schubs(0.1, 0); u.r.schubs(0.1, 0); u.r.schubs(0.1, 0);
  gleich(u.z.tilt, true, "Tilt");
  einBall(u);
  gleich(u.z.bonus.basis, 0, "Tilt: Bonus null");
  bonusAus(u);
  gleich(u.z.punkte, w, "Tilt: keine Bonuspunkte");
  gleich(u.z.kugelNr, 2, "nach Tilt kommt die nächste Kugel");
  gleich(u.z.tilt, false, "Tilt gilt nur für die eine Kugel");
}

// ===============================================================================
abschnitt("Tilt");
{
  const { s, k } = imSpiel();
  const vorX = k.vel.x;
  gleich(s.r.schubs(0.45, 0), true, "erster Schubs");
  pruefe(k.vel.x - vorX > 0.4, "Schubs stößt die Kugel");
  gleich(s.z.band.schluessel, "vorsicht", "erste Warnung");
  s.r.schubs(0.45, 0);
  gleich(s.z.band.schluessel, "vorsicht", "zweite Warnung");
  gleich(s.z.tilt, false, "noch kein Tilt");
  s.r.schubs(0.45, 0);
  gleich(s.z.tilt, true, "dritter schneller Schubs: Tilt");
  gleich(s.z.statistik.tilts, 1, "ein Tilt");
  schritt(s, bumperE(s, k, 0));
  gleich(s.z.punkte, 0, "bei Tilt keine Punkte");
  gleich(s.r.schubs(0.45, 0), false, "bei Tilt kein weiterer Schubs");
  pruefe(s.z.band.schluessel.startsWith("tilt"), "Spruchband zeigt TILT");
  // Warnung verfällt
  const { s: t } = imSpiel();
  t.r.schubs(0.45, 0); t.r.schubs(0.45, 0);
  t.r.schritt(3);
  t.r.schubs(0.45, 0);
  gleich(t.z.tilt, false, "nach einer Pause gilt die Warnung nicht mehr");
  // Schubs nur im Spiel
  const u = neu();
  gleich(u.r.schubs(0.45, 0), false, "auf der Rampe kein Schubs");
}

// ===============================================================================
abschnitt("Extraball");
{
  const { s, k } = imSpiel();
  s.z.extraballBereit = true;
  fange(s, k); auswerfen(s);
  gleich(s.z.extraBaelle, 1, "Extraball gewonnen");
  gleich(s.z.lichter.extraball, false, "Licht aus");
  einBall(s);
  bonusAus(s);
  gleich(s.z.kugelNr, 1, "gleiche Kugelnummer nach dem Verlust");
  gleich(s.z.extraBaelle, 0, "Extraball verbraucht");
  gleich(s.z.phase, "bereit", "bereit");
  pruefe(["extraball", "extraball_nochmal"].includes(s.z.band.schluessel), "Spruchband sagt Extraball");
  const k2 = insFeld(s);
  einBall(s);
  bonusAus(s);
  gleich(s.z.kugelNr, 2, "danach geht es mit Kugel 2 weiter");
  // Nur die dritte geleerte Bank zündet den Extraball, höchstens einen je Spiel (Abschnitt 2b: vorher jede dritte, höchstens zwei)
  const t = imSpiel().s;
  const kt = kugel0(t);
  kt.pos.x = 0.5; kt.pos.y = 0.7;
  const leuchtNach = [];
  for (let b = 1; b <= 9; b++) {
    for (const n of ["fallziel-1", "fallziel-2", "fallziel-3"]) schritt(t, wandE(t, n, kt));
    t.r.schritt(1.5);
    leuchtNach.push(t.z.extraballBereit);
    if (t.z.extraballBereit) { t.z.extraballBereit = false; }
  }
  gleich(leuchtNach.join(), "false,false,true,false,false,false,false,false,false", "Extraball leuchtet nur nach der dritten Bank");
  gleich(t.r.extraGesamt, 1, "höchstens ein Extraball je Spiel angezündet");
}

// ===============================================================================
abschnitt("Kugel steckt");
{
  const { s, k } = imSpiel();
  k.pos.x = 0.5; k.pos.y = 0.6; k.vel.x = 0; k.vel.y = 0;
  k.ruhe = 2.9;
  s.r.schritt(0.016);
  gleich(s.z.statistik.steckt, 0, "2,9 s: noch kein Anstoß");
  k.ruhe = 3.1;
  s.r.schritt(0.016);
  gleich(s.z.statistik.steckt, 1, "3,1 s: Anstoß");
  pruefe(k.vel.y > 0.4, "der Anstoß schiebt nach oben");
  gleich(s.z.band.schluessel, "steckt", "Hinweis im Spruchband");
  gleich(k.ruhe, 0, "Ruhezähler zurückgesetzt");
  // Flipper gehalten: erst bei 8 s
  k.vel.x = 0; k.vel.y = 0;
  s.t.flipper[0].gedrueckt = true;
  k.ruhe = 5;
  s.r.schritt(0.016);
  gleich(s.z.statistik.steckt, 1, "bei gehaltenem Flipper reichen 5 s nicht");
  k.ruhe = 8.1;
  s.r.schritt(0.016);
  gleich(s.z.statistik.steckt, 2, "bei gehaltenem Flipper nach 8 s");
  s.t.flipper[0].gedrueckt = false;
  // Rampe und Zündkammer: ausgenommen
  const u = neu();
  const ku = kugel0(u);
  ku.ruhe = 10;
  u.r.schritt(0.016);
  gleich(u.z.statistik.steckt, 0, "auf der Rampe nie");
  const { s: w, k: kw } = imSpiel();
  fange(w, kw);
  kw.ruhe = 10;
  w.r.schritt(0.016);
  gleich(w.z.statistik.steckt, 0, "in der Zündkammer nie");
}

// ===============================================================================
abschnitt("Spielende und Bestenliste");
{
  const jetzt = () => "2026-11-13";
  // drei Kugeln durchspielen
  const s = neu({ jetzt });
  s.z.punkte = 12345;
  for (let nr = 1; nr <= 3; nr++) {
    gleich(s.z.kugelNr, nr, "Kugel " + nr);
    insFeld(s);
    einBall(s);
    bonusAus(s);
  }
  gleich(s.z.phase, "ende", "nach Kugel 3 ist das Spiel aus");
  gleich(s.z.neuerPlatz, 1, "Platz 1 in der leeren Liste");
  gleich(s.z.bestenliste.length, 1, "ein Eintrag");
  gleich(s.z.bestenliste[0].punkte, 12345, "Punkte stehen drin");
  gleich(s.z.bestenliste[0].datum, "2026-11-13", "Datum steht drin");
  gleich(s.z.rekord, 12345, "Rekord");
  const gespeichert = JSON.parse(s.speicher.lies("kugelblitz.bestenliste"));
  gleich(gespeichert[0].punkte, 12345, "in den Speicher geschrieben");

  // fünf beste, sortiert, schwächere fallen heraus
  const sp = R.speicherImArbeitsspeicher();
  const werte = [500, 9000, 100, 7000, 3000, 2000, 8000];
  let letzterPlatz = 0;
  for (const w of werte) {
    const g = neu({ speicher: sp, jetzt });
    g.z.punkte = w;
    g.r.z.phase = "bereit";
    g.r.eintragen();
    letzterPlatz = g.z.neuerPlatz;
  }
  const liste = JSON.parse(sp.lies("kugelblitz.bestenliste")).map((e) => e.punkte);
  gleich(liste.join(), "9000,8000,7000,3000,2000", "fünf beste Spiele, absteigend");
  gleich(letzterPlatz, 2, "8.000 landet auf Platz 2");
  // 100 und 500 kommen nicht hinein
  const g2 = neu({ speicher: sp, jetzt });
  g2.z.punkte = 1500;
  gleich(g2.r.eintragen(), 0, "1.500 reicht nicht für die Liste");
  g2.z.punkte = 2500;
  gleich(g2.r.eintragen(), 5, "2.500 wird Platz 5");
  // Gleichstand: der ältere bleibt vorn
  const sg = R.speicherImArbeitsspeicher({ "kugelblitz.bestenliste": JSON.stringify([{ punkte: 1000, datum: "2026-01-01" }]) });
  const g3 = neu({ speicher: sg, jetzt });
  g3.z.punkte = 1000;
  gleich(g3.r.eintragen(), 2, "Gleichstand: der neue steht dahinter");
  // Übernahme des alten Rekords
  const alt = R.speicherImArbeitsspeicher({ "kugelblitz.rekord": "4321" });
  const g4 = neu({ speicher: alt, jetzt });
  gleich(g4.z.rekord, 4321, "alter Rekord wird übernommen");
  gleich(g4.z.bestenliste[0].datum, null, "ohne Datum");
  pruefe(alt.lies("kugelblitz.bestenliste") !== null, "als Liste gespeichert");
  g4.z.punkte = 100;
  g4.r.eintragen();
  const g5 = neu({ speicher: alt, jetzt });
  gleich(g5.z.bestenliste.map((e) => e.punkte).join(), "4321,100", "Liste bleibt beim nächsten Laden");
  // alter Rekord wird nicht noch einmal übernommen, wenn die Liste schon da ist
  const doppelt = R.speicherImArbeitsspeicher({ "kugelblitz.rekord": "999", "kugelblitz.bestenliste": "[]" });
  gleich(neu({ speicher: doppelt }).z.bestenliste.length, 0, "vorhandene (leere) Liste gewinnt gegen den alten Rekord");
  // kaputter Speicher
  const kaputt = R.speicherImArbeitsspeicher({ "kugelblitz.bestenliste": "{kein json" });
  gleich(neu({ speicher: kaputt }).z.bestenliste.length, 0, "kaputte Liste: leer, keine Ausnahme");
  const wirft = { lies() { throw new Error("nein"); }, schreibe() { throw new Error("nein"); } };
  const g6 = neu({ speicher: wirft, jetzt });
  g6.z.punkte = 50;
  gleich(g6.r.eintragen(), 1, "Speicher wirft: Eintrag im Arbeitsspeicher trotzdem");
  // Mitten im Spiel neu starten: Ergebnis bleibt
  const h = neu({ jetzt });
  insFeld(h);
  h.z.punkte = 777;
  h.r.starte();
  gleich(h.z.bestenliste.length, 1, "Neustart mitten im Spiel schreibt das Ergebnis");
  gleich(h.z.punkte, 0, "neues Spiel beginnt bei null");
  gleich(h.z.kugelNr, 1, "mit Kugel 1");
  gleich(h.z.rang.nr, 1, "Rang zurück");
  // Spiel ohne Punkte: kein Eintrag
  const n = neu({ jetzt });
  n.r.starte();
  gleich(n.z.bestenliste.length, 0, "Spiel ohne Punkte kommt nicht in die Liste");
  // nach dem Ende kein zweiter Eintrag beim Neustart
  const e = neu({ jetzt });
  e.z.punkte = 5;
  for (let nr = 1; nr <= 3; nr++) { insFeld(e); einBall(e); bonusAus(e); }
  e.r.starte();
  gleich(e.z.bestenliste.length, 1, "nach dem Ende schreibt der Neustart nicht noch einmal");
}

// ===============================================================================
abschnitt("Lese-Schnittstelle und Kleinigkeiten");
{
  const { s, k } = imSpiel();
  for (const feld of ["phase", "punkte", "kugelNr", "kugelnJeSpiel", "tilt", "warnung", "ladung", "laedt", "multiplikator", "bonus", "rang",
    "mission", "multiball", "extraBaelle", "schutz", "banken", "lichter", "band", "bestenliste", "rekord", "neuerPlatz", "statistik", "spielzeit"]) {
    pruefe(feld in s.z, "Feld z." + feld + " vorhanden");
  }
  for (const feld of ["gasse", "zielmarke", "standup", "fallziel", "kickback", "zuendkammer", "extraball", "multiball", "mission", "jackpot",
    "multiplikator", "rang", "schutz", "missionAktiv", "tilt"]) {
    pruefe(feld in s.z.lichter, "Feld z.lichter." + feld + " vorhanden");
  }
  gleich(s.r.lies(), s.z, "lies() liefert denselben Zustand");
  // Alle Zahlen endlich
  const alles = JSON.stringify(s.z);
  pruefe(!alles.includes("null,null") && !alles.includes("NaN"), "keine NaN im Zustand");
  // Laden und Abschuss
  const t = neu();
  t.r.laden(true);
  gleich(t.z.laedt, true, "Laden beginnt mit Kugel in der Rampe");
  t.r.schritt(0.75);
  pruefe(Math.abs(t.z.ladung - 0.5) < 0.01, "halbe Ladung nach der halben Ladezeit");
  pruefe(t.r.abschuss(), "Abschuss mit der gehaltenen Ladung");
  gleich(t.z.ladung, 0, "Ladung zurück");
  gleich(t.z.laedt, false, "Laden aus");
  const u = imSpiel().s;
  u.r.laden(true);
  gleich(u.z.laedt, false, "ohne Kugel in der Rampe kein Laden");
  // Spruchband-Zähler zählt neue Meldungen
  const nr0 = s.z.band.nr;
  s.r.melde("kickback", null, "info", 1);
  pruefe(s.z.band.nr > nr0, "neue Meldung erhöht band.nr");
  // niedrigere Stufe verdrängt keine höhere
  s.r.melde("jackpot", { p: 1 }, "x", 4);
  s.r.melde("vorsicht", null, "x", 1);
  s.r.schritt(0.01);
  gleich(s.z.band.schluessel, "jackpot", "hohe Meldung bleibt stehen");
  gleich(s.z.band.werte.p, 1, "mit ihren Werten");
  s.r.schritt(3);
  gleich(s.z.band.schluessel, "", "nach Ablauf ist das Spruchband leer");
  gleich(R.RAENGE.length, 6, "sechs Ränge");
  gleich(R.MISSIONEN.length, 5, "fünf Missionen");
  gleich(R.RAENGE.join(), "funke,glimmer,leuchter,gewitter,sturmfront,kugelblitz", "Ränge als Schlüssel");
  // Das Regelwerk ist sprachfrei: kein Text im Zustand, nur Schlüssel, Zahlen und Wahrheitswerte
  pruefe(!/[A-ZÄÖÜ][a-zäöüß]+ [a-zäöüß]/.test(JSON.stringify(s.z)), "keine Sätze im Zustand");
  // Ausgebrochene Kugel: neue auf die Rampe
  const v = imSpiel().s;
  kugel0(v).ausgebrochen = true;
  v.r.schritt(0.016);
  gleich(v.z.phase, "bereit", "Ausbruch: Kugel zurück auf die Rampe");
  gleich(v.r.meine().length, 1, "eine Kugel");
}

// ===============================================================================
abschnitt("Start-Regel: die erste Mission beginnt von selbst");
{
  const s = neu();
  gleich(s.z.mission.aktiv, false, "vor dem Abschuss noch keine Mission");
  gleich(s.z.lichter.zuendkammer, "mission", "Zündkammer leuchtet vor dem Abschuss");
  s.r.abschuss(0.5);
  gleich(s.z.mission.aktiv, true, "erster Abschuss startet die erste Mission");
  gleich(s.z.mission.schluessel, "ladung", "es ist Ladung sammeln");
  gleich(s.z.mission.fortschritt, 0, "Fortschritt null");
  gleich(s.z.lichter.zuendkammer, "", "Zündkammer leuchtet jetzt nicht mehr");
  gleich(s.z.band.schluessel, "mission_start", "Spruchband nennt die Mission");
  gleich(s.z.band.werte.mission, "ladung", "und zwar Ladung sammeln");
  // Ein Ballschutz-Rückholer ist kein neuer Abschuss: nichts startet doppelt, Fortschritt bleibt
  const k = insFeld(s);
  for (let i = 0; i < 3; i++) schritt(s, bumperE(s, k));
  gleich(s.z.mission.fortschritt, 3, "Bumpertreffer zählen sofort");
  einBall(s);
  bonusAus(s);
  s.r.abschuss(0.5);
  gleich(s.z.mission.fortschritt, 3, "zweite Kugel: Fortschritt bleibt, keine neue Mission");
  // Zweites Spiel: wieder von selbst, auch wenn das erste Spiel mitten in der Mission endete
  s.r.starte();
  gleich(s.z.mission.aktiv, false, "neues Spiel: wieder keine aktive Mission");
  s.r.abschuss(0.5);
  gleich(s.z.mission.aktiv, true, "neues Spiel: erster Abschuss startet wieder");
  // Hat die Zündkammer die erste Mission schon gestartet (Spiel mit anderem Ablauf), startet nichts doppelt
  const u = imSpiel().s;
  fange(u, kugel0(u)); auswerfen(u);
  gleich(u.z.mission.aktiv, true, "Zündkammer startet eine Mission");
  u.z.mission.fortschritt = 4;
  const ku = insFeld(u, 1.04, 0.1);
  u.r.abschuss(0.5);
  gleich(u.z.mission.fortschritt, 4, "ein späterer Abschuss rührt eine laufende Mission nicht an");
}

// ===============================================================================
abschnitt("Kugel kreist");
{
  const { s, k } = imSpiel();
  k.pos.x = 0.5; k.pos.y = 0.9; k.vel.x = 0.1; k.vel.y = 0;
  s.r.schritt(0.016);
  k.tiefZeit = s.r.uhr;                                              // imSpiel hat 20 s ohne Physik verstreichen lassen: Zähler neu
  const bis = (sek) => { for (let i = 0; i < sek * 10; i++) { k.pos.x = 0.5; k.pos.y = 0.9; k.vel.x = 0.1; k.vel.y = 0; s.r.schritt(0.1); } };
  bis(29);
  gleich(s.z.statistik.kreist, 0, "29 s im oberen Feld: noch kein Anstoß");
  let nachher = null;
  for (let i = 0; i < 30 && s.z.statistik.kreist === 0; i++) { k.pos.x = 0.5; k.pos.y = 0.9; k.vel.x = 0.1; k.vel.y = 0; s.r.schritt(0.1); nachher = k.vel.y; }
  gleich(s.z.statistik.kreist, 1, "über 30 s im oberen Feld: Anstoß");
  gleich(s.z.band.schluessel, "kreist", "Hinweis im Spruchband");
  pruefe(nachher > 0.4, "der Anstoß schiebt nach oben");
  // Wer zwischendurch in den unteren Tischteil kommt, wird nicht angestoßen
  const { s: t, k: kt } = imSpiel();
  kt.tiefZeit = t.r.uhr;
  for (let i = 0; i < 80; i++) {
    kt.pos.x = 0.5; kt.pos.y = i % 20 === 0 ? 0.3 : 0.9; kt.vel.x = 0.1; kt.vel.y = 0;
    t.r.schritt(1);
  }
  gleich(t.z.statistik.kreist, 0, "alle 20 s kurz unten: kein Anstoß");
  // Zündkammer und Rampe zählen als unten
  const { s: w, k: kw } = imSpiel();
  fange(w, kw);
  kw.haltRest = 100;
  w.r.schritt(40);
  gleich(w.z.statistik.kreist, 0, "in der Zündkammer nie");
  const u = neu();
  u.r.schritt(60);
  gleich(u.z.statistik.kreist, 0, "auf der Rampe nie");
}

// ===============================================================================
abschnitt("Dach über den Outlanes");
{
  const t = new P.Tisch(P.standardBauplan());
  const dl = t.waehle("dach-l-klappe")[0], dr = t.waehle("dach-r-klappe")[0];
  pruefe(!!dl && !!dr, "beide Dächer sind da");
  gleich(dl?.einweg, 1, "linkes Dach hält von oben (links der Laufrichtung)");
  gleich(dr?.einweg, -1, "rechtes Dach hält von oben");
  // von oben: eine Kugel, die an der Bande entlangfällt, bleibt oben und kommt nicht in die Outlane
  const faellt = (x, y, vx, vy, seite) => {
    const tt = new P.Tisch(P.standardBauplan());
    const k = new P.Kugel(new P.Vec2(x, y), new P.Vec2(vx, vy));
    tt.kugeln = [k];
    let outlane = 0, kickbackSensor = 0;
    for (let i = 0; i < 360; i++) {
      tt.takt(P.KONST.TAKT);
      for (const e of tt.ereignisse) if (e.art === "sensor" && e.sensor.art === "outlane" && e.sensor.name === seite) outlane++;
      tt.ereignisse.length = 0;
    }
    return outlane;
  };
  let drin = 0;
  for (const x of [0.06, 0.08, 0.10, 0.12, 0.14]) drin += faellt(x, 1.0, 0, -0.5, "outlane-l");
  for (const x of [0.94, 0.92, 0.90, 0.88, 0.86]) drin += faellt(x, 1.0, 0, -0.5, "outlane-r");
  gleich(drin, 0, "zehn Kugeln, die an der Bande entlangfallen, kommen nicht in die Outlane");
  // von unten (Kickback): die Kugel geht durch das Dach und kommt oben an
  const tt = new P.Tisch(P.standardBauplan());
  const k = new P.Kugel(new P.Vec2(0.07, 0.3), new P.Vec2(0, 0));
  tt.kugeln = [k];
  tt.kickback(k);
  let maxY = 0;
  for (let i = 0; i < 240; i++) { tt.takt(P.KONST.TAKT); maxY = Math.max(maxY, k.pos.y); }
  pruefe(maxY > 0.9, `der Kickback trägt die Kugel durch das Dach nach oben (höchster Punkt ${maxY.toFixed(2)})`);
}

// ===============================================================================
// Prüfrunde (Abschnitt 4): Zustände, die über Kugeln oder Spiele hängen bleiben könnten, und Neustart mitten in
// Multiball, Bonus, Tilt und Laden.
abschnitt("Prüfrunde: Multiball ohne Abfluss beenden");
{
  const { s } = imSpiel();
  s.z.mission.erfuellt = 3; s.r.aktualisiere();
  fange(s, kugel0(s));
  gleich(s.z.multiball.aktiv, true, "Multiball läuft");
  s.r.schritt(1.2);
  const [a, b] = s.r.meine();
  b.ausgebrochen = true;                                             // die zweite Kugel bricht aus (nur im Einzelschritt möglich)
  s.r.schritt(0.016);
  gleich(s.r.meine().length, 1, "die ausgebrochene Kugel ist weg");
  gleich(s.z.multiball.aktiv, false, "mit nur einer Kugel endet der Multiball auch ohne Abfluss");
  gleich(s.z.lichter.jackpot, false, "Jackpot-Licht aus");
  gleich(s.z.phase, "spiel", "die verbliebene Kugel spielt weiter");
  pruefe(s.r.meine()[0] === a, "es ist die erste Kugel");
}

abschnitt("Prüfrunde: Neustart mitten im Bonus");
{
  // Vergleich: derselbe Bonus einmal zu Ende gezählt, einmal mitten im Zählen neu gestartet
  const bau = (opt) => {
    const { s, k } = imSpiel(opt);
    for (let i = 0; i < 3; i++) schritt(s, gasseE(s, i, fallend(k)));   // Multiplikator 2, drei Posten
    schritt(s, wandE(s, "fallziel-1", k));
    s.z.punkte = 10000;
    einBall(s);
    return s;
  };
  const voll = bau({ jetzt: () => "2026-11-13" });
  const basis = voll.z.bonus.basis;
  pruefe(basis > 0, "es gibt einen Bonus");
  bonusAus(voll);
  const erwartet = voll.z.punkte;
  gleich(erwartet, 10000 + basis * 2, "zu Ende gezählt: Bonus mal 2");
  const halb = bau({ jetzt: () => "2026-11-13" });
  halb.r.schritt(0.3);                                               // mitten in der Zählung
  pruefe(halb.z.punkte < erwartet, "die Zählung läuft noch");
  halb.r.starte();
  gleich(halb.z.bestenliste[0].punkte, erwartet, "Neustart im Bonus: der ganze Bonus steht in der Bestenliste");
  gleich(halb.z.punkte, 0, "das neue Spiel beginnt bei null");
  gleich(halb.z.phase, "bereit", "das neue Spiel wartet auf den Abschuss");
  gleich(halb.z.bonus.aktiv, false, "kein Bonus im neuen Spiel");
  // Tilt-Pause statt Bonus: nichts dazu
  const t = imSpiel({ jetzt: () => "2026-11-13" }).s;
  t.z.punkte = 3000;
  t.z.tilt = true;
  einBall(t);
  gleich(t.z.phase, "bonus", "Tilt: Pause statt Bonus");
  t.r.starte();
  gleich(t.z.bestenliste[0].punkte, 3000, "Neustart in der Tilt-Pause: nur die Punkte");
}

abschnitt("Prüfrunde: Neustart mitten im Multiball, im Tilt, beim Laden");
{
  const { s } = imSpiel();
  s.z.mission.erfuellt = 3; s.r.aktualisiere();
  fange(s, kugel0(s));
  s.r.schritt(1.2);
  s.z.extraballBereit = true;
  s.z.multiplikator = 4;
  s.r.starte(new P.Tisch(P.standardBauplan()));
  gleich(s.z.multiball.aktiv, false, "Multiball aus");
  gleich(s.z.multiball.bereit, false, "Multiball nicht bereit");
  gleich(s.r.meine().length, 1, "genau eine Kugel");
  pruefe(s.r.inRampe(kugel0(s)), "sie liegt in der Rampe");
  gleich(s.z.lichter.jackpot, false, "Jackpot-Licht aus");
  gleich(s.z.lichter.zuendkammer, "mission", "Zündkammer zeigt wieder die Mission");
  gleich(s.z.extraballBereit, false, "Extraball aus");
  gleich(s.z.multiplikator, 1, "Multiplikator 1");
  gleich(s.z.rang.nr, 1, "Rang 1");
  gleich(s.z.mission.erfuellt, 0, "keine Mission geschafft");
  gleich(s.z.schutz, 0, "kein Ballschutz vor dem Abschuss");

  const tl = imSpiel().s;
  tl.r.schubs(0.45, 0); tl.r.schubs(0.45, 0); tl.r.schubs(0.45, 0);
  gleich(tl.z.tilt, true, "Tisch gekippt");
  tl.r.starte();
  gleich(tl.z.tilt, false, "Neustart: Tilt aus");
  gleich(tl.z.warnung, 0, "Warnung null");
  gleich(tl.z.lichter.tilt, false, "Tilt-Licht aus");
  tl.r.abschuss(0.5);
  pruefe(tl.z.punkte === 0 && tl.r.zaehlt(), "das neue Spiel zählt wieder");

  const ld = neu();
  ld.r.laden(true);
  ld.r.schritt(0.5);
  pruefe(ld.z.laedt && ld.z.ladung > 0.3, "lädt");
  ld.r.starte();
  gleich(ld.z.laedt, false, "Neustart beim Laden: Laden aus");
  gleich(ld.z.ladung, 0, "Ladung null");
  gleich(ld.r.abschuss(), true, "ein späterer Abschuss geht mit Ladung null");
}

abschnitt("Prüfrunde: was je Kugel zurückgeht und was bleibt");
{
  const { s, k } = imSpiel();
  for (let i = 0; i < 3; i++) schritt(s, gasseE(s, i, fallend(k)));
  schritt(s, wandE(s, "standup-1", k));
  schritt(s, gasseE(s, 1, fallend(k)));
  s.r.schubs(0.45, 0);
  gleich(s.z.multiplikator, 2, "Multiplikator 2");
  pruefe(s.z.warnung > 0, "Warnung steht");
  einBall(s);
  bonusAus(s);
  gleich(s.z.kugelNr, 2, "Kugel 2");
  gleich(s.z.multiplikator, 1, "je Kugel: Multiplikator zurück");
  gleich(s.z.warnung, 0, "je Kugel: Warnung zurück");
  gleich(s.z.bonusLaufend, 0, "je Kugel: Bonus zurück");
  gleich(s.z.tilt, false, "je Kugel: kein Tilt");
  pruefe(s.z.lichter.zielmarke >= 0, "je Kugel: Skill-Shot-Marke steht");
  gleich(s.z.lichter.standup[0], true, "bleibt: Standup 1 leuchtet");
  gleich(s.z.lichter.gasse.filter(Boolean).length, 1, "bleibt: die Gasse A leuchtet");
  gleich(s.z.lichter.kickback, true, "bleibt: Kickback");
  // Ein Spiel endet, das nächste beginnt sauber
  for (let nr = 2; nr <= 3; nr++) { insFeld(s); einBall(s); bonusAus(s); }
  gleich(s.z.phase, "ende", "Spiel vorbei");
  s.r.starte(new P.Tisch(P.standardBauplan()));
  gleich(s.z.lichter.standup.some(Boolean), false, "neues Spiel: Standups aus");
  gleich(s.z.lichter.gasse.some(Boolean), false, "neues Spiel: Gassen aus");
  gleich(s.z.banken, 0, "neues Spiel: keine Bank");
  gleich(s.z.lichter.fallziel.every(Boolean), true, "neues Spiel: Fallziele stehen");
}

// ===============================================================================
abschnitt("Sprachen: Schlüssel, Texte, Zahlen, Erkennung");
{
  const codes = S.SPRACHEN.map((x) => x.code);
  gleich(codes.join(), "de,en,es,fr,it,nl,pl,pt,tr,ru,hi,zh,ja,ko", "dieselben 14 Sprachen wie Hourbridge");
  const de = S.TEXTE.de;
  const deSchluessel = Object.keys(de).sort();
  // Was das Regelwerk liefert, hat einen Text
  for (const k of R.MELDUNGEN) pruefe(("m_" + k) in de, "Meldung m_" + k + " hat einen Text");
  for (const k of R.RAENGE) pruefe(("rang_" + k) in de, "Rang rang_" + k + " hat einen Text");
  for (const m of R.MISSIONEN) {
    pruefe(("mi_" + m.schluessel) in de && ("mi_" + m.schluessel + "_text") in de, "Mission " + m.schluessel + " hat Name und Aufgabe");
    gleich(S.MISSIONSZIELE[m.schluessel], m.ziel, "Aufgabe zu " + m.schluessel + " ist für das Ziel " + m.ziel + " geschrieben");
  }
  for (const k of benutzteMeldungen) pruefe(R.MELDUNGEN.includes(k), "benutzte Meldung " + k + " steht in R.MELDUNGEN");
  pruefe(benutzteMeldungen.size >= 20, "die Prüfungen oben lösen mindestens 20 verschiedene Meldungen aus (" + benutzteMeldungen.size + ")");
  // Jede Sprache: dieselben Schlüssel, dieselben Platzhalter, nichts leer, keine Gedankenstriche
  for (const c of codes) {
    const T = S.TEXTE[c] || {};
    gleich(Object.keys(T).sort().join(), deSchluessel.join(), c + ": dieselben Schlüssel wie Deutsch");
    const platz = [];
    const leer = [];
    const strich = [];
    for (const k of deSchluessel) {
      const t = String(T[k] ?? "");
      const a = (de[k].match(/\{\w+\}/g) || []).sort().join();
      const b = (t.match(/\{\w+\}/g) || []).sort().join();
      if (a !== b) platz.push(k);
      if (!t.trim()) leer.push(k);
      if (/[\u2013\u2014]/.test(t)) strich.push(k);
    }
    gleich(platz.join(" "), "", c + ": dieselben Platzhalter");
    gleich(leer.join(" "), "", c + ": keine leeren Texte");
    gleich(strich.join(" "), "", c + ": keine Gedankenstriche");
    pruefe(S.SPRACHEN.find((x) => x.code === c).name.length > 1, c + ": Name im Auswahlfeld");
  }
  // Der Spielname bleibt: Rang 6 heißt in allen Sprachen „Kugelblitz“
  pruefe(codes.every((c) => S.TEXTE[c].rang_kugelblitz === "Kugelblitz"), "Rang 6 heißt überall Kugelblitz");
  // Zahlen und Datum je Sprache (Intl)
  gleich(S.zahl("de", 1234567), "1.234.567", "Zahl Deutsch");
  gleich(S.zahl("en", 1234567), "1,234,567", "Zahl Englisch");
  gleich(S.zahl("hi", 1234567), "12,34,567", "Zahl Hindi, indische Gruppierung");
  pruefe(/^1\s234\s567$/u.test(S.zahl("fr", 1234567)), "Zahl Französisch mit schmalem Leerzeichen");
  gleich(S.zahl("de", 2.6), "3", "Punkte ohne Nachkommastellen");
  gleich(S.datum("de", "2026-11-13"), "13.11.2026", "Datum Deutsch");
  gleich(S.datum("ja", "2026-11-13"), "2026/11/13", "Datum Japanisch");
  gleich(S.datum("de", null), "", "ohne Datum leer");
  pruefe(/^70\s%$/u.test(S.prozent("de", 70)), "Prozent Deutsch (geschütztes Leerzeichen)");
  gleich(S.prozent("en", 70), "70%", "Prozent Englisch");
  gleich(S.prozent("tr", 70), "%70", "Prozent Türkisch");
  // Erkennung wie Hourbridge: gespeicherte Wahl, dann navigator.languages (nur der Sprachteil), sonst Englisch
  gleich(S.erkenne(null, ["fr-CA", "en"]), "fr", "fr-CA wird Französisch");
  gleich(S.erkenne(null, ["sv-SE", "nb"]), "en", "ohne Treffer Englisch");
  gleich(S.erkenne("ja", ["de"]), "ja", "gespeicherte Wahl geht vor");
  gleich(S.erkenne("xx", ["de-AT"]), "de", "ungültige Wahl wird übergangen");
  gleich(S.erkenne(null, []), "en", "leere Liste: Englisch");
  // Platzhalter füllen, Zahlen je Sprache
  gleich(S.text("de", "m_jackpot", { p: 50000 }), "Jackpot: 50.000", "Platzhalter mit Zahl, Deutsch");
  gleich(S.text("en", "m_jackpot", { p: 50000 }), "Jackpot: 50,000", "Platzhalter mit Zahl, Englisch");
  gleich(S.text("de", "gibt_es_nicht"), "gibt_es_nicht", "fehlender Schlüssel zeigt sich selbst");
  // Schriften: jede Sprache hat eine Kette für Titel und Text, die Leserichtung ist gesetzt
  pruefe(S.SPRACHEN.every((x) => x.schriftTitel && x.schriftText && (x.dir === "ltr" || x.dir === "rtl")), "Schriftketten und Leserichtung");
}

abschnitt("");

console.log("Regelwerk: Einzelprüfungen");
for (const z of ausgabe) console.log(z);
console.log(`\nSUMME: ${gesamt} Prüfungen, ${fehler.length} Fehler`);
if (fehler.length) {
  for (const f of fehler) console.log("  FEHLER " + f);
  console.log("REGELN: DURCHGEFALLEN");
  process.exit(1);
}
console.log("REGELN: BESTANDEN");
