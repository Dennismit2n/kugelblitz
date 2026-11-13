/*
 * Kugelblitz – Regelwerk
 *
 * Nimmt die Ereignisse der Physik (Treffer, Sensoren, Loch) und die Spielzeit entgegen und führt
 * den ganzen Spielstand: Punkte, Kugeln, Gassen, Skill Shot, Missionen, Ränge, Multiball, Bonus,
 * Tilt, Bestenliste. Ohne DOM (Browser window.Regeln, Node require), gleiches Modulmuster wie physik.js.
 *
 * Schichtung: Die Physik meldet rohe Ereignisse, dieses Regelwerk macht daraus Spielzüge, die Grafik
 * liest nur den Zustand (regelwerk.z). Das Regelwerk setzt nie
 * Positionen; es fasst die Kugeln nur über benannte Physik-Aufrufe an (legeKugelNach, schiesse, stosse,
 * kickback, werfeAus, schalte, istFrei, entferneKugel).
 *
 * Das Regelwerk liefert nur Zielzustände (an/aus, Zahl, Schlüssel). Weiches Überblenden macht die Grafik.
 * Es ist sprachfrei: Meldungen, Ränge und Missionen sind Schlüssel mit Werten (z.band.schluessel, z.band.werte,
 * z.rang.schluessel, z.mission.schluessel). Die Oberfläche übersetzt sie mit sprachen.js (Abschnitt 6).
 */
(function (wurzel, fabrik) {
  if (typeof module === "object" && module.exports) module.exports = fabrik();
  else wurzel.Regeln = fabrik();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KONST = Object.freeze({
    KUGELN: 3,                 // Kugeln je Spiel
    LADEZEIT: 1.5,             // Sekunden bis zum vollen Abschuss
    ABSCHUSS_MIN: 1.8,         // Abschusstempo bei 0 % Ladung
    ABSCHUSS_MAX: 5.4,         // bei 100 % Ladung
    MULTI_LADUNG: 0.6,         // Ladung, mit der die Rampe im Multiball selbst abschießt
    SCHUTZ: 8,                 // Sekunden Ballschutz nach einem Abschuss
    SCHUTZ_MULTI: 12,          // im Multiball
    SCHUBS: 0.45,              // Stärke eines Schubsers (Tempo), nur für die Eingabe
    TILT_GRENZE: 2.5,          // über so vielen Schubsern im Zeitfenster kippt der Tisch
    WARNUNG_ABKLINGEN: 1.5,    // Sekunden, in denen eine Warnung wieder verfällt
    LOCH_HALTEZEIT: 1.0,       // Sekunden, die die Zündkammer die Kugel hält
    BANK_WIEDER_HOCH: 1.2,     // Pause, bevor die leere Fallziel-Bank wieder aufsteht
    STECKT: 3,                 // Sekunden fast still, dann bekommt die Kugel einen Anstoß
    STECKT_FLIPPER: 8,         // dasselbe, solange ein Flipper gehalten wird (Fangen ist erlaubt)
    STECKT_STOSS: 0.45,        // Tempo des Anstoßes
    KREIST: 30,                // Sekunden ohne Abstieg in den unteren Tischteil (y < 0,40), dann bekommt die Kugel einen Anstoß
    MELDUNG_DAUER: 2.5,        // Sekunden, die eine Meldung im Spruchband steht
    MULT_MAX: 5,               // höchster Bonus-Multiplikator
    BESTENLISTE: 5,            // so viele Spiele stehen in der Bestenliste
    RANG_MAX: 6,
    EXTRABAELLE_MAX: 1,        // höchstens so viele Extrabälle je Spiel
    EXTRABALL_BANK: 3,         // die so vielte geleerte Bank des Spiels zündet den Extraball
    NACH_ABBRUCH_WARTEN: 1.5,  // Pause nach einem Tilt, bevor die nächste Kugel kommt
  });

  const PUNKTE = Object.freeze({
    bumper: 100,               // wenn der Bumper keine eigenen Punkte trägt
    schleuder: 10,
    inlane: 100,
    outlane: 1000,
    gasse: 500,
    skillShot: 10000,
    fallziel: 500,
    bank: 5000,
    standup: 750,
    kammer: 2500,
    jackpot: 50000,
    jackpotPlus: 10000,
    mission: 25000,            // mal Rangnummer
  });

  const BONUS = Object.freeze({ ziel: 200, mission: 5000 });

  // Ränge als Schlüssel (Texte in sprachen.js unter "rang_<schlüssel>"): Funke, Glimmer, Leuchter, Gewitter, Sturmfront,
  // Kugelblitz
  const RAENGE = Object.freeze(["funke", "glimmer", "leuchter", "gewitter", "sturmfront", "kugelblitz"]);

  // Fünf Missionen, der Reihe nach, über alle Kugeln eines Spiels. Keine Zeitgrenze. Name und Aufgabe stehen in
  // sprachen.js unter "mi_<schlüssel>" und "mi_<schlüssel>_text"; die Aufgabe nennt das Ziel als Wort oder Zahl.
  const MISSIONEN = Object.freeze([
    { typ: "bumper", schluessel: "ladung", ziel: 15 },       // Ladung sammeln: Triff die Bumper 15 Mal
    { typ: "gassen", schluessel: "leitbahnen", ziel: 1 },    // Leitbahnen: Schalte alle drei Gassen oben
    { typ: "bank", schluessel: "spannung", ziel: 2 },        // Spannung: Leere die Fallziel-Bank zweimal
    { typ: "standup", schluessel: "zieluebung", ziel: 3 },   // Zielübung: Triff alle drei Standup-Ziele
    { typ: "kammer", schluessel: "entladung", ziel: 3 },     // Entladung: Schick die Kugel dreimal in die Zündkammer
  ]);

  // Alle Meldungen, die das Regelwerk ins Spruchband schreibt (Texte in sprachen.js unter "m_<schlüssel>").
  // Werte: Zahlen formatiert die Oberfläche je Sprache, "mission" und "rang" sind Schlüssel.
  const MELDUNGEN = Object.freeze([
    "extraball_nochmal", "tilt", "vorsicht", "bank_leer", "extraball_leuchtet", "kickback_bereit", "kickback",
    "skill_shot", "bonus_mal", "bonus_max", "extraball", "jackpot", "mission_start", "mission_geschafft", "rang",
    "sturm_bereit", "sturm", "sturm_vorbei", "ausgebrochen", "steckt", "kreist", "ballschutz", "tilt_kein_bonus",
    // dauerhaft, solange der Zustand gilt
    "bonus_zaehlt", "bonus_zaehlt_mal", "tilt_dauer", "sturm_jackpot",
  ]);

  const MB_ERSTER_RANG_MISSIONEN = 3;   // Rang Gewitter = drei geschaffte Missionen
  const MB_DANACH_MISSIONEN = 4;        // danach wieder ab Rang Sturmfront

  // --- Hilfen -------------------------------------------------------------------

  function heute() {
    const d = new Date();
    const z2 = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + z2(d.getMonth() + 1) + "-" + z2(d.getDate());
  }

  // Speicher-Schnittstelle: { lies(schluessel) -> Text oder null, schreibe(schluessel, text) }
  function speicherImArbeitsspeicher(start) {
    const m = new Map(Object.entries(start || {}));
    return {
      lies: (k) => (m.has(k) ? m.get(k) : null),
      schreibe: (k, v) => { m.set(k, String(v)); },
    };
  }

  function speicherLocalStorage() {
    return {
      lies(k) { try { return localStorage.getItem(k); } catch { return null; } },
      schreibe(k, v) { try { localStorage.setItem(k, String(v)); } catch { /* egal */ } },
    };
  }

  const SCHLUESSEL_LISTE = "kugelblitz.bestenliste";
  const SCHLUESSEL_ALT = "kugelblitz.rekord";

  // Liste laden; fehlt sie, wird der alte einzelne Rekord übernommen und gleich als Liste gespeichert.
  function ladeBestenliste(speicher) {
    let roh = null;
    try { roh = speicher.lies(SCHLUESSEL_LISTE); } catch { roh = null; }
    if (roh !== null && roh !== undefined) {
      try {
        const l = JSON.parse(roh);
        if (Array.isArray(l)) {
          return l
            .filter((e) => e && Number.isFinite(Number(e.punkte)) && Number(e.punkte) > 0)
            .map((e) => ({ punkte: Math.floor(Number(e.punkte)), datum: typeof e.datum === "string" ? e.datum : null }))
            .sort((a, b) => b.punkte - a.punkte)
            .slice(0, KONST.BESTENLISTE);
        }
      } catch { /* kaputte Liste: wie leer behandeln */ }
      return [];
    }
    let alt = 0;
    try { alt = Math.max(0, Math.floor(Number(speicher.lies(SCHLUESSEL_ALT)) || 0)); } catch { alt = 0; }
    const liste = alt > 0 ? [{ punkte: alt, datum: null }] : [];
    if (liste.length) {
      try { speicher.schreibe(SCHLUESSEL_LISTE, JSON.stringify(liste)); } catch { /* egal */ }
    }
    return liste;
  }

  // --- Das Regelwerk ---------------------------------------------------------------

  class Regelwerk {
    // optionen: speicher, zufall (Funktion 0 bis 1), jetzt (Funktion, Datum als Text "JJJJ-MM-TT"), kugeln
    constructor(tisch, optionen = {}) {
      this.tisch = tisch;
      this.speicher = optionen.speicher || speicherImArbeitsspeicher();
      this.zufall = optionen.zufall || Math.random;
      this.jetzt = optionen.jetzt || heute;
      this.kugelnJeSpiel = optionen.kugeln ?? KONST.KUGELN;
      this.uhr = 0;
      this.meldung = null;
      this.liste = ladeBestenliste(this.speicher);
      this.z = this.leererZustand();
      this.nullen();
      this.aktualisiere();
    }

    get bauplan() { return this.tisch.bauplan; }

    // --- Zustand ---------------------------------------------------------------

    leererZustand() {
      return {
        phase: "titel",          // titel | bereit | spiel | bonus | ende
        punkte: 0,
        kugelNr: 0,
        kugelnJeSpiel: this.kugelnJeSpiel,
        tilt: false,
        warnung: 0,
        uhr: 0,                  // Spielzeit seit dem Start, ohne Pause
        spielzeit: 0,
        ladung: 0,
        laedt: false,
        multiplikator: 1,
        bonusLaufend: 0,         // Bonus-Basis der laufenden Kugel (vor dem Multiplikator)
        bonus: { aktiv: false, basis: 0, faktor: 1, zaehler: 0, tilt: false },
        rang: { nr: 1, schluessel: RAENGE[0] },
        mission: { nr: 1, schluessel: MISSIONEN[0].schluessel, ziel: MISSIONEN[0].ziel, fortschritt: 0, aktiv: false, erfuellt: 0 },
        multiball: { aktiv: false, bereit: false, jackpot: PUNKTE.jackpot, jackpots: 0 },
        extraBaelle: 0,
        extraballBereit: false,
        schutz: 0,
        banken: 0,
        lichter: {},
        band: { schluessel: "", werte: {}, art: "", nr: 0 },
        bestenliste: [],
        rekord: 0,
        neuerPlatz: 0,
        statistik: {},
      };
    }

    nullen() {
      const z = this.z;
      z.phase = "titel";
      z.punkte = 0;
      z.kugelNr = 0;
      z.tilt = false;
      z.warnung = 0;
      z.ladung = 0;
      z.laedt = false;
      z.multiplikator = 1;
      z.extraBaelle = 0;
      z.extraballBereit = false;
      z.banken = 0;
      z.neuerPlatz = 0;
      z.spielzeit = 0;
      z.multiball = { aktiv: false, bereit: false, jackpot: PUNKTE.jackpot, jackpots: 0 };
      z.mission = { nr: 1, schluessel: MISSIONEN[0].schluessel, ziel: MISSIONEN[0].ziel, fortschritt: 0, aktiv: false, erfuellt: 0 };
      z.bonus = { aktiv: false, basis: 0, faktor: 1, zaehler: 0, tilt: false };
      z.statistik = {
        ballschutz: 0, steckt: 0, tilts: 0, skillShots: 0, missionen: 0, multiballs: 0, jackpots: 0,
        extraBaelle: 0, banken: 0, kammer: 0, bumper: 0, gassenVoll: 0, standupSaetze: 0, kickbacks: 0, kreist: 0,
      };
      this.gassen = [false, false, false];
      this.standups = [false, false, false];
      this.kickbackAn = true;
      this.zielGasse = Math.floor(this.zufall() * 3);
      this.skillOffen = false;
      this.posten = { ziele: 0, missionen: 0 };
      this.extraGesamt = 0;                // so viele Extrabälle wurden in diesem Spiel schon angezündet
      this.mbNaechste = MB_ERSTER_RANG_MISSIONEN;
      this.bankWartet = false;
      this.bankPause = 0;
      this.ersteMissionGegeben = false;
      this.bonusLauf = null;
      this.abbruchWarten = 0;
      this.meldung = null;
      this.spielStart = this.uhr;
    }

    // --- Kleine Helfer -------------------------------------------------------------

    meine() { return this.tisch.kugeln.filter((k) => !k.probe); }

    inRampe(k) { return k.pos.x > this.bauplan.rampe.xMin && k.pos.y < this.bauplan.rampe.yMax; }

    // Hat die Kugel die Abschussrampe verlassen (links der Trennwand oder über dem Tor)?
    ausDerRampe(k) { return k.pos.x < 0.975 || k.pos.y > this.bauplan.rampe.torY + 0.07; }

    imAbfluss(k) {
      const a = this.bauplan.abfluss;
      return k.pos.y < a.yMax && k.pos.x > a.xMin && k.pos.x < a.xMax;
    }

    spielt() { return this.z.phase === "bereit" || this.z.phase === "spiel"; }

    // Punkte und Fortschritt zählen nur in laufendem Spiel und ohne Tilt.
    zaehlt() { return this.spielt() && !this.z.tilt; }

    plus(n) {
      if (!this.zaehlt()) return false;
      this.z.punkte += n;
      return true;
    }

    // Meldung ins Spruchband: Schlüssel aus MELDUNGEN und Werte (Zahlen, Schlüssel), übersetzt wird in der Oberfläche.
    // Eine Meldung mit niedrigerer Stufe verdrängt keine höhere, die noch steht.
    melde(schluessel, werte = null, art = "info", stufe = 1, dauer = KONST.MELDUNG_DAUER) {
      const m = this.meldung;
      if (m && this.uhr < m.bis && stufe < m.stufe) return;
      this.meldung = { schluessel, werte: werte || {}, art, stufe, bis: this.uhr + dauer };
      this.z.band.nr++;
    }

    // --- Spielablauf ---------------------------------------------------------------

    // Neues Spiel. Mit neuem Tisch, wenn die Physik frisch aufgesetzt wurde.
    starte(neuerTisch) {
      if (neuerTisch) this.tisch = neuerTisch;
      // Auch wer mitten im Spiel neu startet, behält sein Ergebnis. Ein angefangener Bonus zählt ganz: das Hochzählen
      // ist nur Darstellung (wie bei ueberspringeBonus), der Bonus selbst ist schon verdient (Prüfrunde, Abschnitt 4).
      const z = this.z;
      if (z.phase === "bonus" && this.bonusLauf) {
        const b = this.bonusLauf;
        const rest = b.basis * b.faktor - b.gezahlt;
        if (rest > 0) { z.punkte += rest; b.gezahlt += rest; }
      }
      if ((z.phase === "bereit" || z.phase === "spiel" || z.phase === "bonus") && z.punkte > 0) this.eintragen();
      this.nullen();
      this.z.kugelNr = 1;
      this.neueKugel();
      this.aktualisiere();
    }

    neueKugel(extra) {
      const z = this.z;
      const t = this.tisch;
      for (const k of this.meine()) t.entferneKugel(k);
      const k = t.legeKugelNach();
      k.schutzBis = 0;
      z.phase = "bereit";
      z.tilt = false;
      z.warnung = 0;
      z.multiplikator = 1;
      z.ladung = 0;
      z.laedt = false;
      z.bonus = { aktiv: false, basis: 0, faktor: 1, zaehler: 0, tilt: false };
      this.posten = { ziele: 0, missionen: 0 };
      this.skillOffen = false;
      this.bonusLauf = null;
      this.zielNeu();
      if (extra) this.melde("extraball_nochmal", null, "extraball", 3);
    }

    // Die Zielmarke des Skill Shots wechselt je Kugel auf eine andere Gasse.
    zielNeu() {
      this.zielGasse = (this.zielGasse + 1 + (this.zufall() < 0.5 ? 0 : 1)) % 3;
    }

    // Abschussladung halten: nur, wenn eine Kugel in der Rampe liegt.
    laden(an) {
      const z = this.z;
      if (!an) { z.laedt = false; this.aktualisiere(); return; }
      if (this.spielt() && this.meine().some((k) => this.inRampe(k))) z.laedt = true;
      this.aktualisiere();
    }

    // Eingabe loslassen oder pausieren: Ladung verwerfen.
    ladenAbbrechen() {
      this.z.laedt = false;
      this.z.ladung = 0;
    }

    // Abschuss. Ohne Angabe mit der gehaltenen Ladung; liefert true, wenn eine Kugel abgeschossen wurde.
    abschuss(ladung) {
      const z = this.z;
      const l = Math.max(0, Math.min(1, ladung ?? z.ladung));
      let geschossen = false;
      if (this.spielt()) {
        for (const k of this.meine()) {
          if (!this.inRampe(k)) continue;
          this.tisch.schiesse(k, 0, KONST.ABSCHUSS_MIN + l * (KONST.ABSCHUSS_MAX - KONST.ABSCHUSS_MIN));
          k.schutzBis = this.uhr + (z.multiball.aktiv ? KONST.SCHUTZ_MULTI : KONST.SCHUTZ);
          geschossen = true;
        }
        if (geschossen && !z.multiball.aktiv) this.skillOffen = true;
        // Start-Regel (Abschnitt 2b): Die erste Mission eines Spiels beginnt beim ersten Abschuss von selbst, damit man
        // von der ersten Sekunde an ein Ziel hat. Alle weiteren startet die Zündkammer.
        if (geschossen && !this.ersteMissionGegeben && !z.mission.aktiv && z.mission.erfuellt === 0) {
          this.ersteMissionGegeben = true;
          this.missionStart();
        }
      }
      z.ladung = 0;
      z.laedt = false;
      this.aktualisiere();
      return geschossen;
    }

    // Flippertaste gedrückt (seite 0 = links, 1 = rechts): die Lichter der oberen Gassen wandern.
    flipperTaste(seite) {
      if (!this.zaehlt()) return false;
      const g = this.gassen;
      const alt = g.slice();
      for (let i = 0; i < 3; i++) g[i] = alt[(i + (seite === 0 ? 1 : 2)) % 3];
      this.aktualisiere();
      return true;
    }

    // Schubs mit dem Tempo (dx, dy). Drei schnelle Schubser kippen den Tisch, die ersten beiden warnen.
    schubs(dx, dy) {
      const z = this.z;
      if (z.phase !== "spiel" || z.tilt) return false;
      for (const k of this.meine()) if (!k.gehalten) this.tisch.stosse(k, dx, dy);
      z.warnung += 1;
      if (z.warnung > KONST.TILT_GRENZE) {
        z.tilt = true;
        z.statistik.tilts++;
        z.laedt = false;
        this.melde("tilt", null, "tilt", 4, 4);
      } else {
        this.melde("vorsicht", null, "warnung", 2);
      }
      this.aktualisiere();
      return true;
    }

    // --- Ereignisse der Physik -----------------------------------------------------

    schritt(dt, ereignisse) {
      if (!(dt > 0)) dt = 0;
      const z = this.z;
      this.uhr += dt;
      if (z.phase !== "titel" && z.phase !== "ende") z.spielzeit = this.uhr - this.spielStart;
      z.uhr = this.uhr;
      z.warnung = Math.max(0, z.warnung - dt / KONST.WARNUNG_ABKLINGEN);
      if (z.laedt) z.ladung = Math.min(1, z.ladung + dt / KONST.LADEZEIT);
      if (ereignisse) for (const e of ereignisse) this.ereignis(e);
      this.kammerSchritt(dt);
      this.bankSchritt(dt);
      this.kugelnSchritt();
      if (z.phase === "bonus") this.bonusSchritt(dt);
      this.aktualisiere();
    }

    ereignis(e) {
      if (!e || !e.kugel || e.kugel.probe) return;
      switch (e.art) {
        case "bumper": return this.bumperTreffer(e);
        case "wand": return this.wandTreffer(e);
        case "sensor": return this.sensorTreffer(e);
        case "loch": return this.lochTreffer(e);
      }
    }

    bumperTreffer(e) {
      if (!this.plus(e.bumper.punkte || PUNKTE.bumper)) return;
      this.z.statistik.bumper++;
      this.missionZaehle("bumper");
    }

    wandTreffer(e) {
      const w = e.wand;
      if (w.art === "schleuder") {
        if (e.tritt) this.plus(PUNKTE.schleuder);
      } else if (w.art === "fallziel") {
        this.fallzielTreffer(w);
      } else if (w.art === "standup") {
        this.standupTreffer(w);
      }
    }

    fallzielTreffer(w) {
      const t = this.tisch;
      if (w.aktiv) t.schalte(w, false);                // das Ziel versinkt, auch bei Tilt
      if (!this.plus(PUNKTE.fallziel)) return;
      this.posten.ziele++;
      const bank = t.waehle("fallziel");
      if (bank.length && bank.every((x) => !x.aktiv) && !this.bankWartet) {
        this.bankWartet = true;
        this.bankPause = KONST.BANK_WIEDER_HOCH;
        this.plus(PUNKTE.bank);
        const z = this.z;
        z.banken++;
        z.statistik.banken++;
        this.melde("bank_leer", { p: PUNKTE.bank }, "bank", 2);
        this.missionZaehle("bank");
        // Die dritte geleerte Bank des Spiels zündet den Extraball (Bauplan §3; höchstens einer je Spiel)
        if (z.banken === KONST.EXTRABALL_BANK && !z.extraballBereit && this.extraGesamt < KONST.EXTRABAELLE_MAX) {
          z.extraballBereit = true;
          this.extraGesamt++;
          this.melde("extraball_leuchtet", null, "extraball", 3);
        }
      }
    }

    standupTreffer(w) {
      if (!this.plus(PUNKTE.standup)) return;
      const i = Math.max(0, Math.min(2, (parseInt(String(w.name).slice(-1), 10) || 1) - 1));
      const neu = !this.standups[i];
      this.standups[i] = true;
      if (neu) this.posten.ziele++;
      if (this.standups.every(Boolean)) {
        this.standups = [false, false, false];
        const z = this.z;
        z.statistik.standupSaetze++;
        if (!this.kickbackAn) this.melde("kickback_bereit", null, "kickback", 2);
        this.kickbackAn = true;
        this.missionZaehle("standup", 3, true);
      } else if (neu) {
        this.missionZaehle("standup", this.standups.filter(Boolean).length, true);
      }
    }

    sensorTreffer(e) {
      const s = e.sensor;
      const k = e.kugel;
      if (!this.zaehlt()) return;
      if (s.art === "kickback") {
        if (k.vel.y < 0 && this.kickbackAn) {
          this.kickbackAn = false;
          this.tisch.kickback(k);
          this.z.statistik.kickbacks++;
          this.melde("kickback", null, "kickback", 2);
        }
        return;
      }
      if (!(k.vel.y < 0)) return;                      // nur fallende Kugeln, nicht die, die wieder hochfliegen
      if (s.art === "inlane") this.plus(PUNKTE.inlane);
      else if (s.art === "outlane") this.plus(PUNKTE.outlane);
      else if (s.art === "gasse") this.gasseTreffer(Math.max(0, Math.min(2, (parseInt(String(s.name).slice(-1), 10) || 1) - 1)));
    }

    gasseTreffer(i) {
      const z = this.z;
      const skill = this.skillOffen;
      this.skillOffen = false;                         // nur der erste Gassentreffer nach dem Abschuss zählt
      this.plus(PUNKTE.gasse);
      if (skill && i === this.zielGasse) {
        this.plus(PUNKTE.skillShot);
        z.statistik.skillShots++;
        this.melde("skill_shot", { p: PUNKTE.skillShot }, "skill", 3);
      }
      if (!this.gassen[i]) {
        this.gassen[i] = true;
        this.posten.ziele++;
      }
      if (this.gassen.every(Boolean)) {
        this.gassen = [false, false, false];
        z.statistik.gassenVoll++;
        if (z.multiplikator < KONST.MULT_MAX) {
          z.multiplikator++;
          this.melde("bonus_mal", { n: z.multiplikator }, "multiplikator", 2);
        } else {
          this.melde("bonus_max", { n: KONST.MULT_MAX }, "multiplikator", 2);
        }
        this.missionZaehle("gassen");
      }
    }

    // --- Zündkammer ------------------------------------------------------------------

    // Was startet der nächste Treffer der Zündkammer? Vorrang: Extraball, Multiball, Mission, Jackpot.
    // Im Multiball leuchtet "Mission starten" nicht, sonst käme der Jackpot erst beim zweiten Besuch dran.
    zuendWahl() {
      const z = this.z;
      if (z.extraballBereit) return "extraball";
      if (this.multiballBereit()) return "multiball";
      if (z.multiball.aktiv) return "jackpot";
      if (!z.mission.aktiv) return "mission";
      return "";
    }

    multiballBereit() {
      return !this.z.multiball.aktiv && this.z.mission.erfuellt >= this.mbNaechste;
    }

    lochTreffer(e) {
      const k = e.kugel;
      k.haltRest = KONST.LOCH_HALTEZEIT;
      if (!this.zaehlt()) return;
      const z = this.z;
      this.plus(PUNKTE.kammer);
      z.statistik.kammer++;
      const was = this.zuendWahl();
      let zaehltFuerMission = true;
      if (was === "extraball") {
        z.extraballBereit = false;
        z.extraBaelle++;
        z.statistik.extraBaelle++;
        this.melde("extraball", null, "extraball", 4);
      } else if (was === "multiball") {
        this.multiballStart();
      } else if (was === "mission") {
        this.missionStart();
        zaehltFuerMission = false;                     // der Besuch, der sie startet, zählt nicht mit
      } else if (was === "jackpot") {
        const m = z.multiball;
        this.plus(m.jackpot);
        z.statistik.jackpots++;
        this.melde("jackpot", { p: m.jackpot }, "jackpot", 4);
        m.jackpot += PUNKTE.jackpotPlus;
        m.jackpots++;
      }
      if (zaehltFuerMission) this.missionZaehle("kammer");
    }

    kammerSchritt(dt) {
      for (const k of this.meine()) {
        if (!k.gehalten) continue;
        if (k.haltRest === undefined) k.haltRest = KONST.LOCH_HALTEZEIT;
        k.haltRest -= dt;
        if (k.haltRest <= 0) this.tisch.werfeAus(k);
      }
    }

    // --- Fallziel-Bank ---------------------------------------------------------------

    // Die leere Bank steht nach einer Pause wieder auf, aber erst, wenn keine Kugel im Weg liegt.
    bankSchritt(dt) {
      if (!this.bankWartet) return;
      this.bankPause -= dt;
      if (this.bankPause <= 0 && this.tisch.istFrei("fallziel")) {
        this.tisch.schalte("fallziel", true);
        this.bankWartet = false;
      }
    }

    // --- Missionen und Ränge -----------------------------------------------------------

    missionEintrag() { return MISSIONEN[this.z.mission.erfuellt % MISSIONEN.length]; }

    missionStart() {
      const m = this.z.mission;
      const def = this.missionEintrag();
      m.aktiv = true;
      m.fortschritt = def.typ === "standup" ? this.standups.filter(Boolean).length : 0;
      this.melde("mission_start", { mission: def.schluessel }, "mission", 3, 3.5);
    }

    // Zählt für die aktive Mission, wenn sie von dieser Art ist. Bei "gesetzt" ist n schon der Stand.
    missionZaehle(typ, n = 1, gesetzt = false) {
      const m = this.z.mission;
      const def = this.missionEintrag();
      if (!m.aktiv || def.typ !== typ) return;
      m.fortschritt = gesetzt ? n : m.fortschritt + n;
      if (m.fortschritt >= def.ziel) this.missionErfuellt();
    }

    missionErfuellt() {
      const z = this.z;
      const m = z.mission;
      const rangNr = z.rang.nr;
      const wert = PUNKTE.mission * rangNr;
      this.plus(wert);
      this.posten.missionen++;
      z.statistik.missionen++;
      m.erfuellt++;
      m.aktiv = false;
      m.fortschritt = 0;
      this.melde("mission_geschafft", { p: wert }, "mission", 4, 3.5);
      this.rangAktualisieren();
      if (z.rang.nr > rangNr) this.melde("rang", { rang: z.rang.schluessel }, "rang", 4, 3.5);
      if (this.multiballBereit() && m.erfuellt === this.mbNaechste) this.melde("sturm_bereit", null, "multiball", 4, 3.5);
    }

    rangAktualisieren() {
      const z = this.z;
      const nr = Math.min(KONST.RANG_MAX, 1 + z.mission.erfuellt);
      z.rang = { nr, schluessel: RAENGE[nr - 1] };
      const def = this.missionEintrag();
      if (!z.mission.aktiv) {
        z.mission.nr = (z.mission.erfuellt % MISSIONEN.length) + 1;
        z.mission.schluessel = def.schluessel;
        z.mission.ziel = def.ziel;
      }
    }

    // --- Multiball ---------------------------------------------------------------

    multiballStart() {
      const z = this.z;
      const mb = z.multiball;
      mb.aktiv = true;
      mb.jackpot = PUNKTE.jackpot;
      mb.jackpots = 0;
      z.statistik.multiballs++;
      this.mbNaechste = Math.max(MB_DANACH_MISSIONEN, z.mission.erfuellt + 1);
      this.skillOffen = false;
      for (const k of this.meine()) k.schutzBis = this.uhr + KONST.SCHUTZ_MULTI;
      this.neueKugelImMultiball();
      this.melde("sturm", null, "multiball", 4, 3.5);
    }

    // Zweite Kugel kommt selbst aus der Rampe.
    neueKugelImMultiball() {
      const k = this.tisch.legeKugelNach();
      this.tisch.schiesse(k, 0, KONST.ABSCHUSS_MIN + KONST.MULTI_LADUNG * (KONST.ABSCHUSS_MAX - KONST.ABSCHUSS_MIN));
      k.schutzBis = this.uhr + KONST.SCHUTZ_MULTI;
      return k;
    }

    multiballEnde() {
      const mb = this.z.multiball;
      if (!mb.aktiv) return;
      mb.aktiv = false;
      this.melde("sturm_vorbei", null, "multiball", 3);
    }

    // --- Kugeln im Feld ------------------------------------------------------------

    kugelnSchritt() {
      const z = this.z;
      if (!this.spielt()) return;
      const t = this.tisch;

      let ausgebrochen = false;
      for (const k of this.meine()) {
        if (k.ausgebrochen) {
          t.entferneKugel(k);
          ausgebrochen = true;
        } else if (this.imAbfluss(k)) {
          this.kugelVerloren(k);
        }
      }
      if (ausgebrochen && this.meine().length === 0) {
        t.legeKugelNach();
        z.phase = "bereit";
        this.melde("ausgebrochen", null, "info", 2);
      }
      // Ist im Multiball nur noch eine Kugel übrig, endet er, egal auf welchem Weg die andere verschwunden ist
      // (vorher nur über den Abfluss; eine ausgebrochene Kugel ließ den Multiball mit einer Kugel weiterlaufen).
      if (z.multiball.aktiv && this.meine().length === 1) this.multiballEnde();

      // Kugel steckt: lange fast still, nicht in der Zündkammer, nicht auf der Rampe
      const flipperHalt = t.flipper.some((f) => f.gedrueckt);
      const grenze = flipperHalt ? KONST.STECKT_FLIPPER : KONST.STECKT;
      for (const k of this.meine()) {
        if (k.gehalten || this.inRampe(k)) continue;
        if (k.ruhe > grenze) {
          t.stosse(k, (this.zufall() - 0.5) * 2 * KONST.STECKT_STOSS, KONST.STECKT_STOSS);
          z.statistik.steckt++;
          this.melde("steckt", null, "steckt", 2);
        }
      }

      // Kugel kreist: Läuft eine Kugel eine Dauerschleife im oberen Tischteil (Schleudern, Bumper, Ziele), ohne je
      // zu den Flippern zu kommen, bekommt sie nach KREIST Sekunden einen Anstoß. Wirklich spielen kann man so
      // lange kaum; die Regel ist die Sicherung gegen eine Endlosschleife der festen Physik.
      for (const k of this.meine()) {
        if (k.gehalten || k.pos.y < 0.40 || this.inRampe(k) || k.tiefZeit === undefined) { k.tiefZeit = this.uhr; continue; }
        if (this.uhr - k.tiefZeit > KONST.KREIST) {
          t.stosse(k, (this.zufall() - 0.5) * 2 * KONST.STECKT_STOSS, KONST.STECKT_STOSS);
          k.tiefZeit = this.uhr;
          z.statistik.kreist++;
          this.melde("kreist", null, "steckt", 2);
        }
      }

      // Erst wer die Rampe verlassen hat, spielt. Liegt die Kugel wieder in der Rampe
      // (zu schwacher Abschuss), gilt wieder „bereit“.
      const ks = this.meine();
      if (z.phase === "bereit" && ks.some((k) => this.ausDerRampe(k))) z.phase = "spiel";
      else if (z.phase === "spiel" && !z.multiball.aktiv && ks.length === 1 && this.inRampe(ks[0])) z.phase = "bereit";

      if (this.spielt() && ks.length === 0) this.kugelEnde();
    }

    kugelVerloren(k) {
      const z = this.z;
      const t = this.tisch;
      t.entferneKugel(k);
      // Ballschutz: kurz nach dem Abschuss zählt der Abfluss nicht (bei Tilt nie)
      if (!z.tilt && this.uhr < (k.schutzBis || 0)) {
        z.statistik.ballschutz++;
        const nk = t.legeKugelNach();
        nk.schutzBis = 0;
        if (z.multiball.aktiv || this.meine().length > 1) {
          t.schiesse(nk, 0, KONST.ABSCHUSS_MIN + KONST.MULTI_LADUNG * (KONST.ABSCHUSS_MAX - KONST.ABSCHUSS_MIN));
          nk.schutzBis = this.uhr + KONST.SCHUTZ_MULTI;
        } else {
          z.phase = "bereit";
          z.laedt = false;
          z.ladung = 0;
        }
        this.melde("ballschutz", null, "ballschutz", 3);
        return;
      }
      if (z.multiball.aktiv && this.meine().length <= 1) this.multiballEnde();
    }

    // Die letzte Kugel ist weg: Bonus (bei Tilt keiner), dann weiter.
    kugelEnde() {
      const z = this.z;
      z.multiball.aktiv = false;
      z.laedt = false;
      z.ladung = 0;
      this.skillOffen = false;
      z.phase = "bonus";
      const basis = z.tilt ? 0 : BONUS.ziel * this.posten.ziele + BONUS.mission * this.posten.missionen;
      const faktor = z.multiplikator;
      const stufen = [];
      if (z.tilt) {
        stufen.push({ art: "tilt", dauer: KONST.NACH_ABBRUCH_WARTEN });
      } else {
        stufen.push({ art: "basis", dauer: basis > 0 ? Math.max(0.6, Math.min(2, basis / 3000)) : 0.5 });
        for (let f = 2; f <= faktor; f++) stufen.push({ art: "faktor", faktor: f, dauer: 0.55 });
        stufen.push({ art: "halt", dauer: 0.9 });
      }
      this.bonusLauf = { basis, faktor, stufen, nr: 0, t: 0, gezahlt: 0 };
      z.bonus = { aktiv: true, basis, faktor: 1, zaehler: 0, tilt: z.tilt };
      if (z.tilt) this.melde("tilt_kein_bonus", null, "tilt", 4, 3);
    }

    // Bonus hochzählen, ruhig und ohne Blinken; die Punkte wachsen mit dem Zähler.
    bonusSchritt(dt) {
      const b = this.bonusLauf;
      if (!b) return;
      const z = this.z;
      b.t += dt;
      while (b.nr < b.stufen.length && b.t >= b.stufen[b.nr].dauer) {
        b.t -= b.stufen[b.nr].dauer;
        b.nr++;
      }
      const ziel = b.basis * b.faktor;
      let zaehler;
      let faktor = 1;
      if (b.nr >= b.stufen.length) {
        zaehler = ziel;
        faktor = b.faktor;
      } else {
        const s = b.stufen[b.nr];
        const anteil = Math.min(1, b.t / s.dauer);
        if (s.art === "basis") zaehler = Math.round(b.basis * anteil);
        else if (s.art === "faktor") { faktor = s.faktor; zaehler = b.basis * (s.faktor - 1) + Math.round(b.basis * anteil); }
        else if (s.art === "halt") { zaehler = ziel; faktor = b.faktor; }
        else zaehler = 0;
        if (s.art === "faktor" && anteil >= 1) zaehler = b.basis * s.faktor;
      }
      z.bonus.zaehler = zaehler;
      z.bonus.faktor = faktor;
      if (zaehler > b.gezahlt) {
        z.punkte += zaehler - b.gezahlt;
        b.gezahlt = zaehler;
      }
      if (b.nr >= b.stufen.length) this.naechsteKugel();
    }

    // Antippen: den Bonus sofort zu Ende zählen (nur Darstellung, das Ergebnis bleibt gleich).
    ueberspringeBonus() {
      const b = this.bonusLauf;
      if (this.z.phase !== "bonus" || !b) return false;
      b.nr = Math.max(b.nr, b.stufen.length - 1);
      b.t = Math.max(b.t, b.stufen[b.nr].dauer - 0.25);
      return true;
    }

    naechsteKugel() {
      const z = this.z;
      this.bonusLauf = null;
      z.bonus.aktiv = false;
      if (z.extraBaelle > 0) {
        z.extraBaelle--;
        this.neueKugel(true);
      } else if (z.kugelNr < this.kugelnJeSpiel) {
        z.kugelNr++;
        this.neueKugel();
      } else {
        z.phase = "ende";
        this.eintragen();
      }
    }

    // --- Bestenliste ------------------------------------------------------------

    // Das Spiel in die Liste einschreiben (nur mit Punkten). Gibt den Platz 1 bis 5 zurück, sonst 0.
    eintragen() {
      const z = this.z;
      z.neuerPlatz = 0;
      if (!(z.punkte > 0)) return 0;
      const eintrag = { punkte: Math.floor(z.punkte), datum: this.jetzt() };
      const l = this.liste;
      let pos = l.findIndex((e) => e.punkte < eintrag.punkte);   // bei Gleichstand bleibt der ältere vorn
      if (pos < 0) pos = l.length;
      if (pos >= KONST.BESTENLISTE) return 0;
      l.splice(pos, 0, eintrag);
      l.length = Math.min(l.length, KONST.BESTENLISTE);
      try { this.speicher.schreibe(SCHLUESSEL_LISTE, JSON.stringify(l)); } catch { /* egal */ }
      z.neuerPlatz = pos + 1;
      return pos + 1;
    }

    // --- Lese-Schnittstelle für die Grafik ------------------------------------------

    aktualisiere() {
      const z = this.z;
      const t = this.tisch;
      this.rangAktualisieren();
      z.multiball.bereit = this.multiballBereit();
      z.bestenliste = this.liste;
      z.rekord = this.liste.length ? this.liste[0].punkte : 0;
      let schutz = 0;
      if (!z.tilt) for (const k of this.meine()) schutz = Math.max(schutz, (k.schutzBis || 0) - this.uhr);
      z.schutz = Math.max(0, schutz);
      const wahl = this.spielt() ? this.zuendWahl() : "";
      z.lichter = {
        gasse: this.gassen.slice(),
        zielmarke: this.skillOffen || z.phase === "bereit" ? this.zielGasse : -1,
        standup: this.standups.slice(),
        fallziel: t.waehle("fallziel").map((w) => w.aktiv),
        kickback: this.kickbackAn,
        zuendkammer: wahl,                                   // was der nächste Treffer startet ("" = nichts)
        extraball: z.extraballBereit,
        multiball: this.spielt() && this.multiballBereit(),
        mission: this.spielt() && !z.mission.aktiv && !z.multiball.aktiv,
        jackpot: z.multiball.aktiv,
        multiplikator: [2, 3, 4, 5].map((n) => z.multiplikator >= n),
        rang: RAENGE.map((_, i) => z.rang.nr > i),
        schutz: z.schutz > 0,
        missionAktiv: z.mission.aktiv,
        tilt: z.tilt,
      };
      // Spruchband: eine stehende Meldung, sonst, was gerade dauerhaft gilt (Schlüssel und Werte, keine Texte)
      const m = this.meldung;
      let schluessel = "";
      let werte = {};
      let art = "";
      if (z.phase === "bonus" && z.bonus.aktiv && !z.bonus.tilt) {
        schluessel = z.bonus.faktor > 1 ? "bonus_zaehlt_mal" : "bonus_zaehlt";
        werte = { p: z.bonus.zaehler, b: z.bonus.basis, n: z.bonus.faktor };
        art = "bonus";
      } else if (m && this.uhr < m.bis) {
        schluessel = m.schluessel;
        werte = m.werte;
        art = m.art;
      } else if (z.tilt && this.spielt()) {
        schluessel = "tilt_dauer";
        art = "tilt";
      } else if (z.multiball.aktiv) {
        schluessel = "sturm_jackpot";
        werte = { p: z.multiball.jackpot };
        art = "multiball";
      }
      z.band.schluessel = schluessel;
      z.band.werte = werte;
      z.band.art = art;
      z.bonusLaufend = z.tilt ? 0 : BONUS.ziel * this.posten.ziele + BONUS.mission * this.posten.missionen;
    }

    lies() { return this.z; }
  }

  return {
    KONST,
    PUNKTE,
    BONUS,
    RAENGE,
    MISSIONEN,
    MELDUNGEN,
    Regelwerk,
    ladeBestenliste,
    speicherImArbeitsspeicher,
    speicherLocalStorage,
    SCHLUESSEL_LISTE,
    SCHLUESSEL_ALT,
  };
});
