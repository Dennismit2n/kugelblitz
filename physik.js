/*
 * Kugelblitz – Flipperphysik
 *
 * Aufgebaut auf „Ten Minute Physics", Lektion 04 (Pinball)
 * Copyright 2021 Matthias Müller – Ten Minute Physics – MIT-Lizenz, siehe LICENSE.
 * Das Original liegt unverändert daneben: lektion04-original.html
 *
 * Was hier anders ist als in der Lektion:
 *  1. Unterschritte: Jeder Takt wird so fein zerlegt, dass sich nichts um mehr
 *     als 40 % eines Kugelradius bewegt. Damit kann keine Kugel mehr durch einen
 *     Flipper oder eine Wand „tunneln".
 *  2. Feste Taktung mit Zeitkonto statt „ein Schritt pro Bild" – das Spiel läuft
 *     auf 60-Hz- und 144-Hz-Bildschirmen gleich schnell. Zum Zeichnen gibt es den
 *     Anteil des angebrochenen Takts, damit nichts ruckelt.
 *  3. Tempodeckel als Sicherheitsnetz.
 *  4. Rückprall (Stoßzahl) nur, wenn sich Kugel und Hindernis annähern.
 *  5. Zähler für Durchschüsse und Ausbrüche, damit man den Unterschied messen kann.
 *  6. Umschaltbar auf die Schrittweite der Lektion (Modus „einzelschritt").
 *  7. Bausteine für einen ganzen Tisch: Schleudern (Wand mit Tritt), schaltbare Wände
 *     (Fallziele), Sensoren, ein Loch (Zündkammer), Treffer-Ereignisse und Methoden,
 *     mit denen ein Regelwerk die Kugeln anfasst (nachlegen, stoßen, auswerfen, schalten).
 *  8. Flipper mit eigenem Winkeltempo für Hochschlag und Rückweg (in der Lektion eines für beide).
 *
 * Einheiten wie in der Lektion: Der Tisch ist 1,7 Einheiten hoch, y zeigt nach oben.
 * Die Datei läuft im Browser (window.Physik) und unter Node (require).
 */
(function (wurzel, fabrik) {
  if (typeof module === "object" && module.exports) module.exports = fabrik();
  else wurzel.Physik = fabrik();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KONST = Object.freeze({
    TAKT: 1 / 120,           // Physik-Takt im Modus „unterschritte"
    TAKT_LEKTION: 1 / 60,    // Physik-Takt im Modus „einzelschritt" (Schrittweite der Lektion)
    MAX_WEG: 0.4,            // höchstens so viel Kugelradius Weg pro Unterschritt
    MAX_UNTERSCHRITTE: 64,
    TEMPO_DECKEL: 9,         // Einheiten pro Sekunde
    MAX_NACHHOLZEIT: 0.1,    // mehr Rückstand wird verworfen (z. B. nach Tabwechsel)
    KUGEL_RADIUS: 0.03,
    SCHWERKRAFT: 3.0,
    TREFFER_MIN_TEMPO: 0.3,  // Wände melden einen Treffer erst ab diesem Aufpralltempo
    RUHE_TEMPO: 0.02,        // darunter gilt eine Kugel als ruhend (Zähler Kugel.ruhe)
  });

  // Diese Wandarten melden Treffer als Ereignis; Führungen und Pfosten schweigen.
  const MELDENDE_ARTEN = new Set(["schleuder", "fallziel", "standup"]);

  // --- Vektoren (Schnittstelle wie in der Lektion) ---------------------------

  class Vec2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(v) {
      this.x = v.x;
      this.y = v.y;
      return this;
    }
    clone() {
      return new Vec2(this.x, this.y);
    }
    add(v, s = 1) {
      this.x += v.x * s;
      this.y += v.y * s;
      return this;
    }
    subtract(v, s = 1) {
      this.x -= v.x * s;
      this.y -= v.y * s;
      return this;
    }
    subtractVectors(a, b) {
      this.x = a.x - b.x;
      this.y = a.y - b.y;
      return this;
    }
    length() {
      return Math.sqrt(this.x * this.x + this.y * this.y);
    }
    scale(s) {
      this.x *= s;
      this.y *= s;
      return this;
    }
    dot(v) {
      return this.x * v.x + this.y * v.y;
    }
    perp() {
      return new Vec2(-this.y, this.x);
    }
  }

  function naechsterPunktAufStrecke(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const laenge2 = abx * abx + aby * aby;
    if (laenge2 === 0) return a.clone();
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / laenge2;
    t = Math.max(0, Math.min(1, t));
    return new Vec2(a.x + abx * t, a.y + aby * t);
  }

  // Lage eines Punkts zur Strecke a–b: Seite (Vorzeichen des Kreuzprodukts)
  // und Projektionsparameter t (0 = bei a, 1 = bei b).
  function lageZurStrecke(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const px = p.x - a.x;
    const py = p.y - a.y;
    const laenge2 = abx * abx + aby * aby;
    return {
      seite: abx * py - aby * px,
      t: laenge2 === 0 ? 0 : (px * abx + py * aby) / laenge2,
    };
  }

  // Ist ein Punkt von p0 nach p1 auf die andere Seite der Strecke gewechselt,
  // die sich dabei von a0–b0 nach a1–b1 bewegt hat? Nur innerhalb der Streckenlänge.
  function wechseltSeite(p0, p1, a0, b0, a1, b1) {
    const alt = lageZurStrecke(p0, a0, b0);
    const neu = lageZurStrecke(p1, a1, b1);
    return (
      alt.seite * neu.seite < 0 &&
      alt.t >= 0 && alt.t <= 1 &&
      neu.t >= 0 && neu.t <= 1
    );
  }

  // Schneiden sich die Strecken p0–p1 und a–b echt (nicht nur am Rand)?
  function streckenSchneiden(p0, p1, a, b) {
    const rx = p1.x - p0.x;
    const ry = p1.y - p0.y;
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const nenner = rx * sy - ry * sx;
    if (nenner === 0) return false;
    const qx = a.x - p0.x;
    const qy = a.y - p0.y;
    const t = (qx * sy - qy * sx) / nenner;
    const u = (qx * ry - qy * rx) / nenner;
    return t > 0 && t < 1 && u > 0 && u < 1;
  }

  function punktInPolygon(p, poly) {
    let innen = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > p.y !== b.y > p.y &&
          p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        innen = !innen;
      }
    }
    return innen;
  }

  const endlich = (v) => Number.isFinite(v.x) && Number.isFinite(v.y);

  // --- Körper ------------------------------------------------------------------

  class Kugel {
    constructor(pos, vel = new Vec2(), radius = KONST.KUGEL_RADIUS, stosszahl = 0.2) {
      this.radius = radius;
      this.masse = Math.PI * radius * radius;
      this.stosszahl = stosszahl;
      this.pos = pos.clone();
      this.vel = vel.clone();
      this.vorher = pos.clone();      // Lage zu Beginn des Unterschritts (für die Messung)
      this.taktStart = pos.clone();   // Lage zu Beginn des Takts (zum Zeichnen)
      this.ausgebrochen = false;
      this.gehalten = null;           // Loch, das die Kugel gerade festhält (dann wird sie nicht simuliert)
      this.ruhe = 0;                  // Sekunden, die die Kugel (fast) steht
    }
    simuliere(dt, schwerkraft) {
      this.vel.add(schwerkraft, dt);
      this.pos.add(this.vel, dt);
    }
  }

  class Bumper {
    constructor(pos, radius, kick = 2.0, punkte = 100) {
      this.pos = pos.clone();
      this.radius = radius;
      this.kick = kick;       // Tempo, mit dem die Kugel abgestoßen wird
      this.punkte = punkte;
      this.leuchten = 0;      // nur für die Darstellung: 1 = gerade getroffen
    }
  }

  // Feste Wand als Kapsel: Strecke a–b mit Dicke 2 × radius.
  // einweg = +1 oder -1: Die Wand hält nur Kugeln auf, die von dieser Seite von a→b
  // kommen (+1 = links der Laufrichtung). Von der anderen Seite ist sie offen.
  // optionen (alles freiwillig, kommt 1:1 aus dem Bauplan):
  //   aktiv        false = Wand ist weg (versunkenes Fallziel): kein Stoß, kein Durchschuss
  //   kick         Tempo, mit dem die Wand die Kugel wegtritt (Schleuder), nur auf der Fläche
  //   kickSchwelle erst ab diesem Annäherungstempo tritt sie (darunter prallt die Kugel nur ab)
  //   name, art, gruppe   Namen für das Regelwerk; art "schleuder" | "fallziel" | "standup"
  //                       meldet Treffer, ebenso meldet: true
  class Wand {
    constructor(a, b, radius = 0.01, stosszahl = 0.4, einweg = 0, optionen = {}) {
      this.a = a.clone();
      this.b = b.clone();
      this.radius = radius;
      this.stosszahl = stosszahl;
      this.einweg = einweg;
      this.durchfahrt = new WeakSet();   // Kugeln, die gerade von der offenen Seite durchfahren
      this.aktiv = optionen.aktiv !== false;
      this.kick = optionen.kick || 0;
      this.kickSchwelle = optionen.kickSchwelle ?? 0.5;
      this.name = optionen.name ?? null;
      this.art = optionen.art ?? null;
      this.gruppe = optionen.gruppe ?? null;
      this.meldet = optionen.meldet ?? MELDENDE_ARTEN.has(this.art);
      this.leuchten = 0;                 // nur für die Darstellung
    }
  }

  // Sensor ohne Stoß: Linie a–b (oder Kreis, wenn a = b) mit Halbdicke radius. Meldet
  // „sensor" beim Eintreten einer Kugelmitte und erst nach dem Verlassen wieder.
  class Sensor {
    constructor(a, b, radius = 0.015, optionen = {}) {
      this.a = a.clone();
      this.b = b.clone();
      this.radius = radius;
      this.linie = a.x !== b.x || a.y !== b.y;
      this.name = optionen.name ?? null;
      this.art = optionen.art ?? null;
      this.gruppe = optionen.gruppe ?? null;
      this.aktiv = optionen.aktiv !== false;
      this.drin = new WeakSet();         // Kugeln, die gerade im Sensor sind (schon gemeldet)
      this.leuchten = 0;                 // nur für die Darstellung
    }
  }

  // Loch (Zündkammer): fängt eine Kugel, deren Mitte hineinrollt und die langsamer ist als
  // „fang". Die Kugel liegt dann fest in der Mitte, bis Tisch.werfeAus sie wieder losschickt.
  class Loch {
    constructor(pos, radius = 0.035, fang = 1.8, optionen = {}) {
      this.pos = pos.clone();
      this.radius = radius;
      this.fang = fang;
      this.name = optionen.name ?? null;
      this.art = optionen.art ?? "loch";
      this.gruppe = optionen.gruppe ?? null;
      this.aktiv = optionen.aktiv !== false;
      this.auswurfTempo = optionen.auswurfTempo ?? 2.4;
      this.auswurfWinkel = optionen.auswurfWinkel ?? 0.6;
      this.halter = null;                // die gehaltene Kugel
      this.sperre = new WeakSet();       // ausgeworfene Kugeln, bis sie das Loch verlassen haben
      this.leuchten = 0;
    }
  }

  class Flipper {
    // winkelTempo gilt für den Hochschlag, rueckTempo für den Rückweg (ohne Angabe beide gleich, wie in der Lektion).
    constructor(pos, laenge, radius, ruheWinkel, maxDrehung, winkelTempo, stosszahl = 0, rueckTempo = winkelTempo) {
      this.pos = pos.clone();
      this.laenge = laenge;
      this.radius = radius;
      this.ruheWinkel = ruheWinkel;
      this.maxDrehung = Math.abs(maxDrehung);
      this.vorzeichen = Math.sign(maxDrehung);
      this.winkelTempo = winkelTempo;
      this.rueckTempo = rueckTempo;
      this.stosszahl = stosszahl;
      this.drehung = 0;
      this.drehungTaktStart = 0;
      this.aktWinkelTempo = 0;
      this.gedrueckt = false;
      this.spitzeVorher = this.spitze();
    }
    winkel(drehung = this.drehung) {
      return this.ruheWinkel + this.vorzeichen * drehung;
    }
    spitze(drehung = this.drehung) {
      const w = this.winkel(drehung);
      return new Vec2(this.pos.x + Math.cos(w) * this.laenge, this.pos.y + Math.sin(w) * this.laenge);
    }
    simuliere(dt) {
      this.spitzeVorher = this.spitze();
      const vorher = this.drehung;
      if (this.gedrueckt) this.drehung = Math.min(this.drehung + dt * this.winkelTempo, this.maxDrehung);
      else this.drehung = Math.max(this.drehung - dt * this.rueckTempo, 0);
      // Wie in der Lektion: Winkeltempo aus der Drehung zurückgerechnet.
      // Der Arm ist kinematisch, die Kugel wirkt nicht auf ihn zurück.
      this.aktWinkelTempo = (this.vorzeichen * (this.drehung - vorher)) / dt;
    }
    // Schnellste Stelle der Oberfläche (Spitze samt Kappe) in der schnelleren Richtung: geht in die Unterschritte ein.
    hoechstesSpitzenTempo() {
      return Math.max(this.winkelTempo, this.rueckTempo) * (this.laenge + this.radius);
    }
  }

  // --- Stöße -------------------------------------------------------------------
  // „!(d > 0)" statt „d === 0": fängt auch NaN ab, damit sich nichts ausbreitet.

  function stossKugelKugel(k1, k2) {
    const stosszahl = Math.min(k1.stosszahl, k2.stosszahl);
    const dir = new Vec2().subtractVectors(k2.pos, k1.pos);
    const d = dir.length();
    if (!(d > 0) || d > k1.radius + k2.radius) return false;
    dir.scale(1 / d);
    const korr = (k1.radius + k2.radius - d) / 2;
    k1.pos.add(dir, -korr);
    k2.pos.add(dir, korr);
    const v1 = k1.vel.dot(dir);
    const v2 = k2.vel.dot(dir);
    if (v1 - v2 <= 0) return true;   // entfernen sich schon voneinander
    const m1 = k1.masse;
    const m2 = k2.masse;
    const neu1 = (m1 * v1 + m2 * v2 - m2 * (v1 - v2) * stosszahl) / (m1 + m2);
    const neu2 = (m1 * v1 + m2 * v2 - m1 * (v2 - v1) * stosszahl) / (m1 + m2);
    k1.vel.add(dir, neu1 - v1);
    k2.vel.add(dir, neu2 - v2);
    return true;
  }

  // Eine gehaltene Kugel (im Loch) ist für andere ein festes Hindernis.
  function stossKugelFest(k, h) {
    const dir = new Vec2().subtractVectors(k.pos, h.pos);
    let d = dir.length();
    const grenze = k.radius + h.radius;
    if (!(d <= grenze)) return false;
    if (d > 0) dir.scale(1 / d);
    else { dir.x = 0; dir.y = 1; d = 0; }
    k.pos.add(dir, grenze - d);
    const vn = k.vel.dot(dir);
    if (vn < 0) k.vel.add(dir, -(1 + Math.min(k.stosszahl, h.stosszahl)) * vn);
    return true;
  }

  // Gibt true zurück, wenn die Kugel auf den Bumper zuflog (zählt als Treffer).
  function stossKugelBumper(k, b) {
    const dir = new Vec2().subtractVectors(k.pos, b.pos);
    const d = dir.length();
    const grenze = k.radius + b.radius;
    if (!(d > 0) || d > grenze) return false;
    dir.scale(1 / d);
    k.pos.add(dir, grenze - d);
    const vn = k.vel.dot(dir);
    if (vn < b.kick) k.vel.add(dir, b.kick - vn);
    return vn < 0;
  }

  // Aufpralltempo, mit dem die Kugel auf die FLÄCHE einer meldenden Wand zufliegt (0 = kein zählbarer
  // Treffer). Gemessen wird vor den Stößen eines Unterschritts, damit eine Nachbarwand, die sich
  // dieselbe Kante teilt (Fallziele, Standups) und ihre Kappe zuerst bedient, den Treffer nicht schluckt.
  // Zählbar: Wand aktiv und meldend, Kugel berührt sie, Kugelmitte VOR der Fläche (Projektion t in
  // (0, 1), streifende Kappentreffer zählen nicht), Annäherung schneller als TREFFER_MIN_TEMPO.
  function wandAnflug(k, w) {
    if (!w.aktiv || !w.meldet) return 0;
    const naechster = naechsterPunktAufStrecke(k.pos, w.a, w.b);
    const dx = k.pos.x - naechster.x;
    const dy = k.pos.y - naechster.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (!(d > 0) || d > k.radius + w.radius) return 0;
    const t = lageZurStrecke(k.pos, w.a, w.b).t;
    if (!(t > 0 && t < 1)) return 0;
    const anflug = -(k.vel.x * dx + k.vel.y * dy) / d;
    return anflug > KONST.TREFFER_MIN_TEMPO ? anflug : 0;
  }

  // Gibt true zurück, wenn die Kugel die Wand berührt. Mit „info" meldet sie zusätzlich:
  //   info.tritt    true, wenn eine Schleuder getreten hat
  function stossKugelWand(k, w, info) {
    if (!w.aktiv) return false;
    const naechster = naechsterPunktAufStrecke(k.pos, w.a, w.b);
    const dir = new Vec2().subtractVectors(k.pos, naechster);
    const d = dir.length();
    const grenze = k.radius + w.radius;
    if (!(d <= grenze)) {
      if (w.einweg !== 0) w.durchfahrt.delete(k);   // Berührzone verlassen
      return false;
    }
    if (w.einweg !== 0) {
      // Wer die Berührzone von der offenen Seite betritt, fährt ungehindert durch,
      // bis er sie wieder verlässt – ohne Sprung beim Überqueren der Mittellinie.
      if (w.durchfahrt.has(k)) return false;
      if (Math.sign(lageZurStrecke(k.vorher, w.a, w.b).seite) !== w.einweg) {
        w.durchfahrt.add(k);
        return false;
      }
    }
    if (!(d > 0)) return false;
    const t = lageZurStrecke(k.pos, w.a, w.b).t;
    const vorne = t > 0 && t < 1;     // Kugelmitte vor der Fläche (nicht an der Kappe)
    dir.scale(1 / d);
    k.pos.add(dir, grenze - d);
    const vn = k.vel.dot(dir);
    if (vn < 0) {
      if (w.kick > 0 && vorne && -vn > w.kickSchwelle) {
        k.vel.add(dir, w.kick - vn);   // der Anteil senkrecht zur Fläche wird zum Trittempo
        if (info) info.tritt = true;
      } else {
        k.vel.add(dir, -(1 + w.stosszahl) * vn);
      }
    }
    return true;
  }

  function stossKugelFlipper(k, f) {
    const naechster = naechsterPunktAufStrecke(k.pos, f.pos, f.spitze());
    const dir = new Vec2().subtractVectors(k.pos, naechster);
    const d = dir.length();
    const grenze = k.radius + f.radius;
    if (!(d > 0) || d > grenze) return false;
    dir.scale(1 / d);
    k.pos.add(dir, grenze - d);
    // Geschwindigkeit der Flipperoberfläche am Berührpunkt (wie in der Lektion)
    const hebel = naechster.clone().add(dir, f.radius).subtract(f.pos);
    const oberflaeche = hebel.perp().scale(f.aktWinkelTempo);
    const vRel = k.vel.dot(dir) - oberflaeche.dot(dir);
    if (vRel < 0) k.vel.add(dir, -(1 + f.stosszahl) * vRel);
    return true;
  }

  // Außenbande als geschlossenes Polygon gegen den Uhrzeigersinn (Normale zeigt nach innen).
  // Wie in der Lektion: nächste Kante suchen; steckt die Kugel schon dahinter,
  // wird sie zurückgeholt.
  function stossKugelBande(k, bande, stosszahl) {
    const n = bande.length;
    if (n < 3) return false;
    let minDist = Infinity;
    const naechster = new Vec2();
    const normale = new Vec2();
    for (let i = 0; i < n; i++) {
      const a = bande[i];
      const b = bande[(i + 1) % n];
      const c = naechsterPunktAufStrecke(k.pos, a, b);
      const dx = k.pos.x - c.x;
      const dy = k.pos.y - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        naechster.set(c);
        normale.x = -(b.y - a.y);
        normale.y = b.x - a.x;
      }
    }
    if (!(minDist < Infinity)) return false;
    const d = new Vec2().subtractVectors(k.pos, naechster);
    const dist = d.length();
    if (dist === 0) d.set(normale).scale(1 / normale.length());
    else d.scale(1 / dist);

    // Liegt die Kugelmitte diesseits der Bande? Das entscheidet das Polygon selbst, nicht
    // die Normale der nächsten Kante: An einer überstumpfen Ecke wie (0,975 | 0,40) ist die
    // Ecke für zwei Kanten gleich nah, und die Normale der falschen zeigt von der Kugel weg.
    // Liegt die Mitte genau auf einer Kante (dist 0), zeigt d schon nach innen: drin.
    const drin = dist === 0 || punktInPolygon(k.pos, bande);

    let innen;   // Einheitsvektor Richtung Tischinneres
    if (drin) {
      if (dist > k.radius) return false;
      k.pos.add(d, k.radius - dist);
      innen = d;
    } else {
      k.pos.add(d, -(dist + k.radius));
      innen = d.scale(-1);
    }
    const vn = k.vel.dot(innen);
    if (vn < 0) k.vel.add(innen, -(1 + stosszahl) * vn);
    return true;
  }

  // --- Tisch ---------------------------------------------------------------------

  class Tisch {
    constructor(bauplan, modus = "unterschritte") {
      const v = ([x, y]) => new Vec2(x, y);
      this.bauplan = bauplan;
      this.bande = bauplan.bande.map(v);
      this.bandeStosszahl = bauplan.bandeStosszahl ?? 0.35;
      this.waende = (bauplan.waende || []).map(
        (w) => new Wand(v(w.a), v(w.b), w.radius, w.stosszahl, w.einweg || 0, w));
      this.bumper = (bauplan.bumper || []).map(
        (b) => new Bumper(v(b.pos), b.radius, b.kick, b.punkte));
      this.flipper = (bauplan.flipper || []).map(
        (f) => new Flipper(v(f.pos), f.laenge, f.radius, f.ruheWinkel, f.maxDrehung, f.winkelTempo, f.stosszahl,
          f.rueckTempo ?? f.winkelTempo));
      // Sensoren: { a, b, radius } als Linie oder { pos, radius } als Kreis
      this.sensoren = (bauplan.sensoren || []).map(
        (s) => new Sensor(v(s.a || s.pos), v(s.b || s.pos), s.radius, s));
      this.loecher = (bauplan.loecher || []).map(
        (l) => new Loch(v(l.pos), l.radius, l.fang, l));
      // Messlinien: Linien, die eine Kugelmitte nie überqueren darf (nur zum Zählen)
      this.messlinien = (bauplan.messlinien || []).map((m) => ({ a: v(m.a), b: v(m.b), name: m.name }));
      this.schwerkraft = new Vec2(0, -(bauplan.schwerkraft ?? KONST.SCHWERKRAFT));
      this.kugeln = [];
      this.modus = modus;
      this.rueckstand = 0;
      this.letzterTakt = KONST.TAKT;
      this.ereignisse = [];
      this.statistik = { durchschuesse: 0, ausbrueche: 0, unterschritte: 0, hoechstesTempo: 0 };
      // Alles, was eine Kugel mitten im Takt von selbst beschleunigen kann (Bumper, Schleuder,
      // Kickback, Auswurf aus dem Loch), fließt vorsorglich in die Zahl der Unterschritte ein.
      // Tempi von außen (Abschuss, stosse, schiesse) liegen beim nächsten Takt schon in
      // kugel.vel und zählen dort mit; sie bleiben unter dem Tempodeckel.
      this.kickReserve = Math.min(KONST.TEMPO_DECKEL, Math.max(
        0,
        ...this.bumper.map((b) => b.kick),
        ...this.waende.map((w) => w.kick),
        ...this.loecher.map((l) => l.auswurfTempo),
        bauplan.kickback ? bauplan.kickback.tempo : 0));
    }

    setzeModus(modus) {
      this.modus = modus;
      this.rueckstand = 0;
    }

    taktLaenge() {
      return this.modus === "einzelschritt" ? KONST.TAKT_LEKTION : KONST.TAKT;
    }

    // Echtzeit in Sekunden vorrücken. Gibt die Zahl der Physik-Takte zurück.
    vorruecken(sekunden) {
      if (!(sekunden > 0)) return 0;
      this.rueckstand = Math.min(this.rueckstand + sekunden, KONST.MAX_NACHHOLZEIT);
      const takt = this.taktLaenge();
      let takte = 0;
      while (this.rueckstand >= takt) {
        this.takt(takt);
        this.rueckstand -= takt;
        takte++;
      }
      return takte;
    }

    // Wie weit der nächste Takt schon angebrochen ist (0 … 1) – zum Zeichnen zwischen
    // der Lage vor und nach dem letzten Takt.
    anteil() {
      return Math.max(0, Math.min(1, this.rueckstand / this.taktLaenge()));
    }

    // Ein Takt der Länge dt, im Modus „unterschritte" fein zerlegt.
    takt(dt) {
      this.letzterTakt = dt;
      for (const k of this.kugeln) {
        if (!endlich(k.pos) || !endlich(k.vel)) this.kaputt(k);
        k.taktStart.set(k.pos);
        if (!k.gehalten && k.vel.length() < KONST.RUHE_TEMPO) k.ruhe += dt;
        else k.ruhe = 0;
      }
      for (const f of this.flipper) f.drehungTaktStart = f.drehung;

      let n = 1;
      if (this.modus !== "einzelschritt") {
        let vKugel = 0;
        let rMin = KONST.KUGEL_RADIUS;
        let beweglich = false;
        for (const k of this.kugeln) {
          if (k.gehalten) continue;
          beweglich = true;
          vKugel = Math.max(vKugel, k.vel.length());
          rMin = Math.min(rMin, k.radius);
        }
        // Ein Tritt oder Bumper setzt nur den Anteil senkrecht zur Fläche neu, die Kugel kann
        // danach schneller sein als vorher: schnellste Kugel plus Reserve statt nur das Größere.
        vKugel = beweglich ? vKugel + this.kickReserve : this.kickReserve;
        let vFlipper = 0;
        for (const f of this.flipper) vFlipper = Math.max(vFlipper, f.hoechstesSpitzenTempo());
        const weg = (vKugel + vFlipper + this.schwerkraft.length() * dt) * dt;
        n = Math.min(KONST.MAX_UNTERSCHRITTE, Math.max(1, Math.ceil(weg / (KONST.MAX_WEG * rMin))));
      }
      this.statistik.unterschritte = n;
      const h = dt / n;
      for (let i = 0; i < n; i++) this.unterschritt(h);
    }

    // Nicht endliche Werte (nur von außen möglich) nicht weiterrechnen, sondern melden.
    kaputt(k) {
      k.pos.set(endlich(k.taktStart) ? k.taktStart : new Vec2(0.5, 0.9));
      k.vel.x = 0;
      k.vel.y = 0;
      if (!k.ausgebrochen) {
        k.ausgebrochen = true;
        this.statistik.ausbrueche++;
        this.ereignisse.push({ art: "ausbruch", kugel: k, pos: k.pos.clone() });
      }
    }

    unterschritt(h) {
      for (const f of this.flipper) f.simuliere(h);
      const kugeln = this.kugeln;
      // Startlage aller Kugeln vor irgendeinem Stoß merken – auch ein Schubs durch
      // eine andere Kugel gehört dann zur gemessenen Strecke.
      for (const k of kugeln) k.vorher.set(k.pos);
      for (const l of this.loecher) {
        if (l.halter && !kugeln.includes(l.halter)) l.halter = null;   // Kugel wurde von außen entfernt
      }
      const deckeln = this.modus !== "einzelschritt";
      const info = { tritt: false };
      const meldungen = [];
      for (let i = 0; i < kugeln.length; i++) {
        const k = kugeln[i];
        if (k.gehalten) continue;     // wer im Loch liegt, wird nicht simuliert
        k.simuliere(h, this.schwerkraft);
        if (deckeln) {
          const v = k.vel.length();
          if (v > KONST.TEMPO_DECKEL) k.vel.scale(KONST.TEMPO_DECKEL / v);
        }
        for (let j = 0; j < kugeln.length; j++) {
          if (j === i) continue;
          const anderer = kugeln[j];
          if (anderer.gehalten) stossKugelFest(k, anderer);
          else if (j > i) stossKugelKugel(k, anderer);
        }
        for (const b of this.bumper) {
          if (stossKugelBumper(k, b)) this.ereignisse.push({ art: "bumper", bumper: b, kugel: k });
        }
        // Zählbare Treffer vor den Wandstößen messen, dann stoßen und den Tritt nachtragen.
        // Je Kugel, Wand und Unterschritt höchstens ein Ereignis.
        meldungen.length = 0;
        for (const w of this.waende) {
          const anflug = wandAnflug(k, w);
          if (anflug > 0) meldungen.push({ art: "wand", wand: w, kugel: k, tempo: anflug, tritt: false });
        }
        for (const w of this.waende) {
          info.tritt = false;
          if (stossKugelWand(k, w, info) && info.tritt) {
            const m = meldungen.find((x) => x.wand === w);
            if (m) m.tritt = true;
          }
        }
        for (const m of meldungen) this.ereignisse.push(m);
        for (const f of this.flipper) stossKugelFlipper(k, f);
        stossKugelBande(k, this.bande, this.bandeStosszahl);
        // Nach allen Stößen darf keine Kugel über dem Deckel liegen (Tritt, Kick)
        if (deckeln) {
          const v = k.vel.length();
          if (v > KONST.TEMPO_DECKEL) k.vel.scale(KONST.TEMPO_DECKEL / v);
        }
        this.pruefe(k);
        this.sensorenPruefen(k);
        this.lochPruefen(k);
      }
    }

    // Sensoren melden das Eintreten einer Kugelmitte einmal, danach erst nach dem Verlassen
    // wieder. Ein schneller Sprung quer über eine Linie zählt wie ein Eintreten.
    sensorenPruefen(k) {
      for (const s of this.sensoren) {
        if (!s.aktiv) { s.drin.delete(k); continue; }
        const c = naechsterPunktAufStrecke(k.pos, s.a, s.b);
        const dx = k.pos.x - c.x;
        const dy = k.pos.y - c.y;
        const beruehrt = dx * dx + dy * dy <= s.radius * s.radius ||
          (s.linie && wechseltSeite(k.vorher, k.pos, s.a, s.b, s.a, s.b));
        if (!beruehrt) s.drin.delete(k);
        else if (!s.drin.has(k)) {
          s.drin.add(k);
          this.ereignisse.push({ art: "sensor", sensor: s, kugel: k, tempo: k.vel.length() });
        }
      }
    }

    lochPruefen(k) {
      for (const l of this.loecher) {
        if (!l.aktiv) continue;
        const d = Math.hypot(k.pos.x - l.pos.x, k.pos.y - l.pos.y);
        if (d > l.radius) { l.sperre.delete(k); continue; }
        if (l.halter || l.sperre.has(k)) continue;
        if (k.vel.length() < l.fang) {
          k.gehalten = l;
          l.halter = k;
          k.pos.set(l.pos);
          k.vel.x = 0;
          k.vel.y = 0;
          k.vorher.set(k.pos);
          this.ereignisse.push({ art: "loch", loch: l, kugel: k });
        }
      }
    }

    // Messung: Ist die Kugel in diesem Unterschritt durch etwas hindurchgegangen?
    // Ein Sprung kann mehrere Prüfungen zugleich auslösen (z. B. Messlinie und
    // Bandenkante) – gezählt wird er trotzdem nur einmal.
    pruefe(k) {
      const drinnen = punktInPolygon(k.pos, this.bande);
      const wo = this.durchschussOrt(k, drinnen);
      if (wo) {
        this.statistik.durchschuesse++;
        this.ereignisse.push({ art: "durchschuss", wo, kugel: k, pos: k.pos.clone() });
      }
      if (!drinnen && !k.ausgebrochen) {
        k.ausgebrochen = true;
        this.statistik.ausbrueche++;
        this.ereignisse.push({ art: "ausbruch", kugel: k, pos: k.pos.clone() });
      }
      const v = k.vel.length();
      if (v > this.statistik.hoechstesTempo) this.statistik.hoechstesTempo = v;
    }

    // Wodurch ist die Kugel gegangen? null, wenn durch nichts.
    durchschussOrt(k, drinnen) {
      for (const f of this.flipper) {
        if (wechseltSeite(k.vorher, k.pos, f.pos, f.spitzeVorher, f.pos, f.spitze())) return "flipper";
      }
      for (const w of this.waende) {
        if (w.aktiv && w.einweg === 0 && wechseltSeite(k.vorher, k.pos, w.a, w.b, w.a, w.b)) return "wand";
      }
      for (const m of this.messlinien) {
        if (wechseltSeite(k.vorher, k.pos, m.a, m.b, m.a, m.b)) return m.name || "messlinie";
      }
      // Innen angekommen, aber auf dem Weg eine Bandenkante gekreuzt: Sprung durch die Bande
      if (drinnen) {
        const n = this.bande.length;
        for (let i = 0; i < n; i++) {
          if (streckenSchneiden(k.vorher, k.pos, this.bande[i], this.bande[(i + 1) % n])) return "bande";
        }
      }
      return null;
    }

    // --- Für das Regelwerk: Kugeln anfassen, Teile schalten ---------------------------
    // Alle Methoden hier werden zwischen zwei Takten aufgerufen und begrenzen jedes Tempo
    // auf den Tempodeckel.

    // Neue Kugel auf die Rampe legen (oder an eine andere Stelle), ohne eine andere Kugel
    // zu löschen. Ist der Startplatz auf der Rampe belegt, rückt sie nach oben.
    legeKugelNach(pos, vel) {
      const [sx, sy] = this.bauplan.rampe ? this.bauplan.rampe.start : [0.5, 0.9];
      const start = pos ? pos.clone() : new Vec2(sx, sy);
      if (!pos) {
        const frei = (y) => this.kugeln.every(
          (o) => Math.hypot(o.pos.x - start.x, o.pos.y - y) >= 2 * o.radius + 0.004);
        while (!frei(start.y) && start.y < sy + 0.5) start.y += 0.07;
      }
      const k = new Kugel(start, vel || new Vec2());
      this.kugeln.push(k);
      return k;
    }

    entferneKugel(k) {
      const i = this.kugeln.indexOf(k);
      if (i >= 0) this.kugeln.splice(i, 1);
      if (k.gehalten) { k.gehalten.halter = null; k.gehalten = null; }
    }

    // Geschwindigkeit der Kugel setzen (z. B. Kickback). Hält ein Loch sie, wird sie frei.
    schiesse(k, vx, vy) {
      if (k.gehalten) this.loeseAusLoch(k);
      k.vel.x = vx;
      k.vel.y = vy;
      const v = k.vel.length();
      if (v > KONST.TEMPO_DECKEL) k.vel.scale(KONST.TEMPO_DECKEL / v);
      k.ruhe = 0;
    }

    // Kugel anstoßen (z. B. „Kugel steckt"): Geschwindigkeit wird addiert.
    stosse(k, dx, dy) {
      if (k.gehalten) this.loeseAusLoch(k);
      k.vel.x += dx;
      k.vel.y += dy;
      const v = k.vel.length();
      if (v > KONST.TEMPO_DECKEL) k.vel.scale(KONST.TEMPO_DECKEL / v);
      k.ruhe = 0;
    }

    loeseAusLoch(k) {
      const l = k.gehalten;
      if (!l) return;
      k.gehalten = null;
      l.halter = null;
      l.sperre.add(k);
    }

    // Kugel aus dem Loch werfen. Ohne Angaben mit Tempo und Winkel des Lochs.
    // Winkel in Bogenmaß von der x-Achse (0 = nach rechts, π/2 = nach oben).
    werfeAus(k, tempo, winkel) {
      const l = k.gehalten;
      if (!l) return false;
      const t = tempo ?? l.auswurfTempo;
      const w = winkel ?? l.auswurfWinkel;
      this.loeseAusLoch(k);
      this.schiesse(k, Math.cos(w) * t, Math.sin(w) * t);
      return true;
    }

    // Kickback: Kugel mit dem Tempo des Bauplans nach oben schießen.
    kickback(k) {
      const kb = this.bauplan.kickback || { tempo: 2.3, winkel: Math.PI / 2 };
      const w = kb.winkel ?? Math.PI / 2;
      this.schiesse(k, Math.cos(w) * kb.tempo, Math.sin(w) * kb.tempo);
    }

    // Teile finden: nach Objekt, Name, Gruppe oder als Liste davon.
    waehle(wahl) {
      if (Array.isArray(wahl)) return wahl.flatMap((w) => this.waehle(w));
      const alle = [...this.waende, ...this.sensoren, ...this.loecher];
      if (typeof wahl === "string") return alle.filter((t) => t.name === wahl || t.gruppe === wahl);
      return alle.includes(wahl) ? [wahl] : [];
    }

    // Wände, Sensoren oder Löcher ein- und ausschalten (aktiv). Gibt die Teile zurück,
    // deren Zustand sich geändert hat. Eine Wand zurück „an" zu schalten, während eine
    // Kugel im Weg liegt, ist erlaubt (die Kugel wird dann hinausgeschoben); das Regelwerk
    // wartet aber besser, bis istFrei() wahr ist.
    schalte(wahl, an) {
      const geaendert = [];
      for (const t of this.waehle(wahl)) {
        if (t.aktiv === !!an) continue;
        t.aktiv = !!an;
        if (t.durchfahrt) t.durchfahrt = new WeakSet();
        if (t.drin) t.drin = new WeakSet();
        geaendert.push(t);
      }
      return geaendert;
    }

    // Liegt keine Kugel in oder dicht an diesen Wänden (Abstand: bis zur Kugelkante plus Luft)?
    istFrei(wahl, luft = 0.01) {
      for (const t of this.waehle(wahl)) {
        if (!t.a) continue;
        for (const k of this.kugeln) {
          const c = naechsterPunktAufStrecke(k.pos, t.a, t.b);
          if (Math.hypot(k.pos.x - c.x, k.pos.y - c.y) < k.radius + t.radius + luft) return false;
        }
      }
      return true;
    }
  }

  // --- Der Kugelblitz-Tisch -------------------------------------------------------

  // Maße wie Lektion 04 (Flipper, Kugel, Schwerkraft), rechts die Abschussrampe mit Einwegtor.
  // Darüber ein ganzer Tisch mit Italian Bottom: zwei Schleudern, In- und Outlanes, Kickback,
  // drei Gassen in einer Rinne oben, drei Bumper, Fallziel-Bank links, Standup-Reihe rechts, Zündkammer.
  // Bande gegen den Uhrzeigersinn.
  // Die linke Hälfte ist von Hand gesetzt, die rechte spiegelt sie an x = 0,5
  // (dort liegt die Mitte der beiden Flipper).
  function standardBauplan() {
    const R = 0.01;                                   // Dicke der Führungen und Pfosten
    const sp = ([x, y]) => [1 - x, y];                // Spiegelung an x = 0,5
    const wandSpiegeln = (w) => ({
      ...w, a: sp(w.a), b: sp(w.b), name: w.name.replace("-l-", "-r-"),
      gruppe: w.gruppe ? w.gruppe.replace("-l", "-r") : w.gruppe,
      einweg: w.einweg ? -w.einweg : 0,      // gespiegelt dreht sich die Laufrichtung, also auch die gehaltene Seite
    });
    const fuehrung = (name, a, b) =>
      ({ name, art: "fuehrung", gruppe: "fuehrung", a, b, radius: R, stosszahl: 0.4 });

    // Linke Seite: Führung zwischen Outlane und Inlane, Schleuder über dem Flipper.
    // Das schräge Stück der Führung liegt genau in der Verlängerung der Flipper-Oberseite (gleicher Winkel,
    // 0,02 über der Achse = Flipperradius 0,03 minus Führungsradius 0,01): Die Kugel rollt glatt vom Führungsblech
    // auf den Flipper. Endete die Führung über der Drehachse, entstünde zwischen Blech und Flipperkappe eine
    // Mulde, in der eine Kugel liegen bleibt (vom Automaten gefunden).
    const links = [
      fuehrung("fuehrung-l-aussen", [0.14, 0.58], [0.14, 0.3084]),
      fuehrung("fuehrung-l-schraeg", [0.14, 0.3084], [0.2696, 0.2376]),
      // Schleuder: Dreieck (Spitze oben, Fuß unten). Die schräge Kante zum Spielfeld tritt.
      { name: "schleuder-l-flaeche", art: "schleuder", gruppe: "schleuder-l",
        a: [0.26, 0.66], b: [0.34, 0.42], radius: R, stosszahl: 0.4, kick: 2.0, kickSchwelle: 0.5 },
      fuehrung("schleuder-l-ruecken", [0.26, 0.66], [0.26, 0.42]),
      fuehrung("schleuder-l-sohle", [0.26, 0.42], [0.34, 0.42]),
    ];

    // Dach über den Outlanes (Abschnitt 2b): Schräge von der Bande (unter der Fallziel-Bank oder den Standups) bis
    // über die Führung. Von oben hält sie die Kugel und lässt sie in die Inlane rollen, von unten (Kickback) lässt
    // sie die Kugel durch (Einwegwand). Wer an der Bande entlangfällt, kommt nicht mehr in die Outlane; offen bleibt
    // nur die Mündung zwischen Dach-Ende und Führungskappe, durch die eine Kugel seitlich hineinspringen kann
    // (lichte Weite links 0,088, rechts 0,117, Kugel 0,060). Die rechte Mündung ist weiter, weil die Rinne die Kugeln
    // vorwiegend links hinunterschickt und rechts sonst zu selten etwas in die Outlane kommt.
    // Nicht gespiegelt, weil die Enden verschieden hoch liegen: links Ende (0,165 | 0,685), rechts (0,835 | 0,715).
    const dach = [
      { ...fuehrung("dach-l-klappe", [0.03, 0.80], [0.165, 0.685]), einweg: 1 },
      { ...fuehrung("dach-r-klappe", [0.97, 0.80], [0.835, 0.715]), einweg: -1 },
    ];

    // Rinne oben: eine Schiene, die nach links ansteigt (0,25). Die abgeschossene Kugel rollt
    // hinauf, wird langsamer und fällt durch die erste Lücke, die sie nur noch langsam genug
    // erreicht: je stärker der Abschuss, desto weiter links. Am linken Ende hält ein Anschlag
    // sie auf, sodass auch der stärkste Abschuss in einer Lücke landet. Lücken: 0,12 breit
    // zwischen den Schienenenden, 0,10 lichte Weite.
    const rinneY = (x) => +(1.40 + 0.25 * (0.88 - x)).toFixed(4);
    const schiene = (nr, x1, x2) =>
      ({ ...fuehrung("rinne-" + nr, [x1, rinneY(x1)], [x2, rinneY(x2)]), stosszahl: 0.1 });
    const rinne = [
      schiene(1, 0.88, 0.78), schiene(2, 0.66, 0.62), schiene(3, 0.50, 0.46), schiene(4, 0.34, 0.26),
      { ...fuehrung("rinne-anschlag", [0.26, rinneY(0.26)], [0.26, 1.67]), stosszahl: 0.3 },
    ];
    const gasse = (nr, x1, x2) => ({
      name: "gasse-" + nr, art: "gasse", gruppe: "gassen",
      a: [x1 - 0.01, rinneY(x1) - 0.005], b: [x2 + 0.01, rinneY(x2) - 0.005], radius: 0.012,
    });

    // Bänke an den Seitenwänden: bündig vor der Wand, ein Ziel je 0,14 hoch (y 0,80 bis 1,22), Enden stoßen aneinander
    const bank = (art, gruppe, x, stosszahl) => [0, 1, 2].map((i) => ({
      name: gruppe + "-" + (i + 1), art, gruppe,
      a: [x, 0.80 + 0.14 * i], b: [x, 0.94 + 0.14 * i], radius: 0.012, stosszahl,
    }));

    return {
      breite: 1.1,
      hoehe: 1.7,
      bande: [
        [0.02, 0.00], [0.975, 0.00],  // Boden: alles unter y = 0,08 ist Abfluss (auch die Outlanes)
        [0.975, 0.05], [1.08, 0.05],  // Rampenboden
        [1.08, 1.50], [0.90, 1.68],   // rechte Außenwand, Umlenkschräge oben
        [0.12, 1.68], [0.02, 1.58],   // Decke, Ecke oben links
      ],
      bandeStosszahl: 0.35,
      waende: [
        // Trennwand zwischen Spielfeld und Abschussrampe, bis zum Rampenboden
        { name: "trennwand", art: "wand", a: [0.985, 0.05], b: [0.985, 1.30], radius: 0.01, stosszahl: 0.4 },
        // Einwegtor oben in der Rampe: von unten offen, von oben zu
        { name: "tor", art: "wand", a: [0.985, 1.30], b: [1.08, 1.37], radius: 0.006, stosszahl: 0.3, einweg: 1 },
        ...links,
        ...links.map(wandSpiegeln),
        ...dach,
        ...rinne,
        ...bank("fallziel", "fallziel", 0.032, 0.3),
        ...bank("standup", "standup", 0.963, 0.5),
      ],
      // Zwischen Rampe und Spielfeld darf eine Kugelmitte x = 0,98 unterhalb des Tors
      // nie überqueren (in der Rampe liegt sie bei x ≥ 1,025, im Feld bei x ≤ 0,945).
      messlinien: [
        { a: [0.98, 0.0], b: [0.98, 1.30], name: "trennwand" },
      ],
      bumper: [
        { pos: [0.34, 1.18], radius: 0.075, kick: 2.4, punkte: 100 },
        { pos: [0.66, 1.18], radius: 0.075, kick: 2.4, punkte: 100 },
        { pos: [0.50, 0.98], radius: 0.075, kick: 2.4, punkte: 100 },
      ],
      // Flipper: Hochschlag mit Winkeltempo 16, ein voller Hub (1,0 rad) dauert 62,5 ms (bis 13.11.2026: 12 und 83 ms).
      // Der Rückweg bleibt bei 12 (83 ms): Der Arm schnellt hoch und fällt weicher zurück wie bei einem echten Flipper.
      // Ab 16,5 kippt die Balance (linke Outlane und Kickback kaum noch erreichbar).
      flipper: [
        { pos: [0.26, 0.22], laenge: 0.2, radius: 0.03, ruheWinkel: -0.5,
          maxDrehung: 1.0, winkelTempo: 16, rueckTempo: 12, stosszahl: 0.25 },
        { pos: [0.74, 0.22], laenge: 0.2, radius: 0.03, ruheWinkel: Math.PI + 0.5,
          maxDrehung: -1.0, winkelTempo: 16, rueckTempo: 12, stosszahl: 0.25 },
      ],
      // Sensoren (Linien mit Halbdicke radius). Gassen von links nach rechts (L, A, D), dann In- und Outlanes
      sensoren: [
        gasse(1, 0.46, 0.34), gasse(2, 0.62, 0.50), gasse(3, 0.78, 0.66),
        { name: "inlane-l", art: "inlane", gruppe: "inlanes", a: [0.17, 0.50], b: [0.23, 0.50], radius: 0.012 },
        { name: "inlane-r", art: "inlane", gruppe: "inlanes", a: [0.83, 0.50], b: [0.77, 0.50], radius: 0.012 },
        { name: "outlane-l", art: "outlane", gruppe: "outlanes", a: [0.04, 0.50], b: [0.11, 0.50], radius: 0.012 },
        { name: "outlane-r", art: "outlane", gruppe: "outlanes", a: [0.96, 0.50], b: [0.89, 0.50], radius: 0.012 },
        // Unten in der linken Outlane: hier setzt das Regelwerk den Kickback ein
        { name: "kickback", art: "kickback", gruppe: "kickback", a: [0.035, 0.24], b: [0.18, 0.24], radius: 0.012 },
      ],
      loecher: [
        { name: "zuendkammer", art: "zuendkammer", pos: [0.20, 0.86], radius: 0.035, fang: 1.8,
          auswurfTempo: 2.4, auswurfWinkel: 0.6 },
      ],
      kickback: { sensor: "kickback", tempo: 2.4, winkel: Math.PI / 2 },
      rampe: { start: [1.0375, 0.08], xMin: 0.995, yMax: 0.2, torY: 1.30 },
      abfluss: { xMin: 0.02, xMax: 0.975, yMax: 0.08 },
    };
  }

  return {
    KONST,
    Vec2,
    Kugel,
    Bumper,
    Wand,
    Sensor,
    Loch,
    Flipper,
    Tisch,
    standardBauplan,
    naechsterPunktAufStrecke,
    lageZurStrecke,
    wechseltSeite,
    streckenSchneiden,
    punktInPolygon,
    stossKugelKugel,
    stossKugelBumper,
    stossKugelFest,
    wandAnflug,
    stossKugelWand,
    stossKugelFlipper,
    stossKugelBande,
  };
});
