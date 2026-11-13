/*
 * Kugelblitz: Lichtprüfung (L-Meter)
 *
 * Nur für die Prüfung. index.html?licht=1 lädt diese Datei und spielt ein festes Drehbuch ab:
 * Über die Schnittstelle des Regelwerks (künstliche Physik-Ereignisse, abschuss, schubs) löst es jedes
 * Lichtereignis des Spiels aus, dazu zehn Sekunden-Hertz Flipperklopfen über drei Sekunden. Gemessen wird
 * jedes Bild auf einem verkleinerten Abbild des Canvas, in relativer Leuchtdichte nach WCAG 2.x
 * (sRGB linearisiert, L = 0,2126 R + 0,7152 G + 0,0722 B):
 *
 *   1. größte Änderung der mittleren Leuchtdichte von Bild zu Bild (Grenze 0,02)
 *   2. „allgemeine Blitze“ nach WCAG 2.3.1 je Kachel (25 % der Spielfeldbreite × 25 % der Höhe, halb
 *      überlappend) in jedem Fenster von 1 s: Paar gegenläufiger Übergänge von je mindestens 0,10, der
 *      dunklere Zustand unter 0,80 (Grenze 0, strenger als WCAG)
 *   3. rote Blitze: Übergänge, an denen gesättigtes Rot beteiligt ist, R/(R+G+B) ≥ 0,8 (Grenze 0)
 *   4. Licht-Ereignisse je Sekunde, wie die Grafik sie zählt (Grenze 3)
 *   5. örtliche Treffer-Scheine: größte Schwankung an den Messpunkten neben Bumpern, Schleudern und
 *      Standups in 1 s, ohne Bilder, in denen eine Kugel daneben liegt (Grenze 0,10), dazu der rechnerische
 *      Höchstwert je Pixel bei Lichtstärke 100 %
 *
 * Das Ergebnis steht danach als Text in der Kachel „Lichtprüfung“ und in window.lichtBericht.
 * Mit index.html?licht=werkzeug stehen nur die Werkzeuge bereit (window.lichtpruefung), ohne Drehbuch.
 *
 * Darstellungen (Abschnitt 7): Gemessen wird in der Darstellung, die gerade gilt (werkstatt.darstellung). Bei
 * „Umgekehrte Farben“ dreht der Filter der Seite auch den Tisch; das Canvas selbst bleibt ungedreht, deshalb rechnet der
 * Messer dort mit 255 minus Wert je Kanal, also mit dem, was man sieht. index.html?licht=modi wechselt die Darstellung
 * wie jemand, der durch das Auswahlfeld läuft (ruhig und im Stakkato), und zählt die Sprünge je Wechsel.
 */
(function () {
  "use strict";
  const kb = window.kugelblitz;
  if (!kb) return;
  const { P, regeln, grafik, haken } = kb;
  const G = window.Grafik;
  const z = kb.z;
  const modus = new URLSearchParams(location.search).get("licht");
  // Zum Nachsehen: index.html?licht=1&bilder=1 legt zu den ersten Übergängen ab 0,10 ein Bild des Canvas in window.lichtBilder
  const mitBildern = new URLSearchParams(location.search).get("bilder") === "1";
  window.lichtBilder = [];

  // --- Werkzeuge: künstliche Ereignisse, Kugeln lenken -----------------------------------

  let samen = 20261113;
  const zufall = () => {
    samen ^= samen << 13; samen >>>= 0;
    samen ^= samen >>> 17;
    samen ^= samen << 5; samen >>>= 0;
    return samen / 4294967296;
  };

  // Eine Kugel, die es nicht gibt: nur Träger für Ereignisse (fällt, damit Sensoren zählen)
  const geist = () => ({ pos: new P.Vec2(0.5, 1.0), vel: new P.Vec2(0, -1), taktStart: new P.Vec2(0.5, 1.0), radius: 0.03, probe: false });

  let warteschlange = [];
  haken.vorSchritt.push(() => {
    if (!warteschlange.length) return;
    kb.tisch.ereignisse.push(...warteschlange);
    warteschlange = [];
  });
  const w = {
    bumper(i) { warteschlange.push({ art: "bumper", bumper: kb.tisch.bumper[i % kb.tisch.bumper.length], kugel: geist() }); },
    wand(name) {
      const wand = kb.tisch.waehle(name)[0];
      if (wand) warteschlange.push({ art: "wand", wand, kugel: geist(), tempo: 1.2, tritt: wand.art === "schleuder" });
    },
    sensor(name) {
      const s = kb.tisch.sensoren.find((x) => x.name === name);
      if (s) warteschlange.push({ art: "sensor", sensor: s, kugel: geist(), tempo: 1 });
    },
    kammer() { warteschlange.push({ art: "loch", loch: kb.tisch.loecher[0], kugel: geist() }); },
    // Eine echte Kugel in die Zündkammer legen: die Physik fängt sie, das Regelwerk wirft sie nach 1 s aus
    kammerEcht() { kb.tisch.legeKugelNach(new P.Vec2(0.2, 0.86)); },
    ablassen(k) {
      k.pos.x = 0.5; k.pos.y = 0.04; k.vel.x = 0; k.vel.y = 0;
      k.taktStart.x = 0.5; k.taktStart.y = 0.04;
    },
    alleAblassen() { for (const k of kb.tisch.kugeln) if (!k.probe && !k.gehalten) w.ablassen(k); },
    // Wächter: Kugeln, die nach unten fallen, schießt er wieder hoch (die Prüfung soll nicht vom Zufall abhängen)
    waechter: false,
  };
  haken.vorSchritt.push(() => {
    if (!w.waechter) return;
    for (const k of kb.tisch.kugeln) {
      if (k.probe || k.gehalten || regeln.inRampe(k)) continue;
      if (k.pos.y < 0.36 && k.vel.y < 0) kb.tisch.schiesse(k, (zufall() - 0.5) * 1.2, 3.6);
    }
  });

  // --- Messung ----------------------------------------------------------------------------

  const lin = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  const leuchtdichte = (r, g, b) => 0.2126 * lin[r] + 0.7152 * lin[g] + 0.0722 * lin[b];
  // Umgekehrte Farben: Der Filter der Seite (invert(1)) dreht jeden Kanal in sRGB um, das Canvas bleibt dabei ungedreht
  const umgekehrt = () => document.documentElement.getAttribute("data-vision") === "invert";
  const darstellung = () => grafik.modus || "normal";

  class Lichtmesser {
    constructor() {
      const q = grafik.leinwand;
      this.quelle = q;
      // Halbieren in Stufen: jede Stufe mittelt 2 × 2 Pixel (sonst lässt das Verkleinern Pixel aus)
      this.stufen = [];
      let wq = q.width;
      let hq = q.height;
      while (wq > 150) {
        wq = Math.ceil(wq / 2);
        hq = Math.ceil(hq / 2);
        const c = document.createElement("canvas");
        c.width = wq;
        c.height = hq;
        const g = c.getContext("2d");
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = "high";
        this.stufen.push({ c, g });
      }
      this.w = Math.ceil(wq / 2);
      this.h = Math.ceil(hq / 2);
      this.klein = document.createElement("canvas");
      this.klein.width = this.w;
      this.klein.height = this.h;
      this.kg = this.klein.getContext("2d", { willReadFrequently: true });
      this.kg.imageSmoothingEnabled = true;
      this.kg.imageSmoothingQuality = "high";
      this.s = this.w / q.width;
      this.L = new Float64Array(this.w * this.h);
      this.sat = new Float64Array((this.w + 1) * (this.h + 1));
      this.rotSat = new Float64Array((this.w + 1) * (this.h + 1));
      // Kacheln: 25 % × 25 % des Spielfelds, halb überlappend, über die ganze Leinwand (mit Spruchband)
      const lay = grafik.lay;
      const d = grafik.dpr;
      const kbr = lay.wp * d * this.s * 0.25;
      const kh = lay.hp * d * this.s * 0.25;
      this.kacheln = [];
      for (let y = 0; y + kh <= this.h + 0.01; y += kh / 2) {
        for (let x = 0; x + kbr <= this.w + 0.01; x += kbr / 2) {
          this.kacheln.push({
            x0: Math.round(x), y0: Math.round(y), x1: Math.min(this.w, Math.round(x + kbr)), y1: Math.min(this.h, Math.round(y + kh)),
            richtung: 0, min: Infinity, max: -Infinity, rotBeimExtrem: false, ue: [], rotUe: [], fenster: [],
          });
        }
      }
      this.punkte = grafik.messpunkte().map((p) => ({
        ...p, sx: Math.min(this.w - 1, Math.floor(p.x * this.s)), sy: Math.min(this.h - 1, Math.floor(p.y * this.s)), fenster: [],
      }));
      this.kugelSpur = [];
      this.bilder = 0;
      this.letztesMittel = null;
      this.groessterSprung = 0;
      this.sprungZeit = 0;
      this.blitze = 0;
      this.roteBlitze = 0;
      this.uebergaenge = 0;
      this.roteUebergaenge = 0;
      this.rotPixel = 0;
      this.kachelSchwankung = 0;
      this.oertlich = 0;
      this.oertlichName = "";
      this.hellstesMittel = 0;
      this.uebergangListe = [];      // Übergänge ab 0,10 mit Zeit, Kachel und Richtung (höchstens 200), zum Nachsehen
    }

    messe(t) {
      if (this.start === undefined) this.start = t;
      let src = this.quelle;
      for (const st of this.stufen) {
        st.g.clearRect(0, 0, st.c.width, st.c.height);
        st.g.drawImage(src, 0, 0, src.width, src.height, 0, 0, st.c.width, st.c.height);
        src = st.c;
      }
      this.kg.clearRect(0, 0, this.w, this.h);
      this.kg.drawImage(src, 0, 0, src.width, src.height, 0, 0, this.w, this.h);
      const daten = this.kg.getImageData(0, 0, this.w, this.h).data;
      const W = this.w;
      const H = this.h;
      const L = this.L;
      const sat = this.sat;
      const rs = this.rotSat;
      const dreh = umgekehrt() ? 255 : 0;
      let summe = 0;
      let rot = 0;
      for (let y = 0; y < H; y++) {
        let zeile = 0;
        let rotZeile = 0;
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const r = dreh ? dreh - daten[i] : daten[i];
          const g = dreh ? dreh - daten[i + 1] : daten[i + 1];
          const b = dreh ? dreh - daten[i + 2] : daten[i + 2];
          const l = leuchtdichte(r, g, b);
          L[y * W + x] = l;
          summe += l;
          zeile += l;
          const s = r + g + b;
          const istRot = s > 0 && r / s >= 0.8 ? 1 : 0;
          rot += istRot;
          rotZeile += istRot;
          sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + zeile;
          rs[(y + 1) * (W + 1) + x + 1] = rs[y * (W + 1) + x + 1] + rotZeile;
        }
      }
      this.bilder++;
      const mittel = summe / (W * H);
      if (mittel > this.hellstesMittel) this.hellstesMittel = mittel;
      if (this.letztesMittel !== null) {
        const sprung = Math.abs(mittel - this.letztesMittel);
        if (sprung > this.groessterSprung) { this.groessterSprung = sprung; this.sprungZeit = t; }
      }
      this.letztesMittel = mittel;
      if (rot > this.rotPixel) this.rotPixel = rot;

      const flaeche = (feld, k) => feld[k.y1 * (W + 1) + k.x1] - feld[k.y0 * (W + 1) + k.x1] - feld[k.y1 * (W + 1) + k.x0] + feld[k.y0 * (W + 1) + k.x0];
      for (const k of this.kacheln) {
        const n = (k.x1 - k.x0) * (k.y1 - k.y0);
        const l = flaeche(sat, k) / n;
        const rotDa = flaeche(rs, k) > 0;
        this.kachelSchritt(k, l, t, rotDa);
      }

      // Örtliche Scheine: Messpunkte neben Bumpern, Schleudern, Standups. Bilder, in denen eine Kugel
      // (oder ihre Spur, also ihre Lage der letzten 0,25 s) näher als 0,12 liegt, zählen nicht.
      this.kugelSpur.push({ t, lagen: kb.tisch.kugeln.map((k) => [k.pos.x, k.pos.y]) });
      while (this.kugelSpur.length && t - this.kugelSpur[0].t > 0.25) this.kugelSpur.shift();
      // Solange eine Tafel (Start, Pause, Ende) über dem Tisch liegt, misst dieser Wert nichts: die Tafel ist
      // kein Treffer-Schein, ihre Blende zählt in 1. bis 3.
      const tafel = grafik.tafelSichtbar() > 0;
      for (const p of this.punkte) {
        let frei = !tafel;
        if (frei) for (const s of this.kugelSpur) {
          for (const [x, y] of s.lagen) if (Math.hypot(x - p.tx, y - p.ty) < 0.12) { frei = false; break; }
          if (!frei) break;
        }
        if (!frei) { p.fenster.length = 0; continue; }
        const l = L[p.sy * W + p.sx];
        p.fenster.push({ t, l });
        while (p.fenster.length && t - p.fenster[0].t > 1) p.fenster.shift();
        let lo = Infinity;
        let hi = -Infinity;
        for (const e of p.fenster) { if (e.l < lo) lo = e.l; if (e.l > hi) hi = e.l; }
        if (hi - lo > this.oertlich) { this.oertlich = hi - lo; this.oertlichName = p.name; this.oertlichZeit = t - (this.start ?? t); }
      }
    }

    // Übergänge nach WCAG 2.3.1: Änderung von mindestens 0,10 gegen das letzte Extrem, der dunklere
    // Zustand unter 0,80. Ein Blitz ist ein Paar gegenläufiger Übergänge.
    kachelSchritt(k, l, t, rotDa) {
      let neu = false;
      if (k.richtung === 0) {
        if (l - k.min >= 0.1 && k.min < 0.8) { k.richtung = 1; neu = true; k.max = l; }
        else if (k.max - l >= 0.1 && l < 0.8) { k.richtung = -1; neu = true; k.min = l; }
        if (!neu) {
          if (l < k.min) { k.min = l; k.rotBeimExtrem = rotDa; }
          if (l > k.max) { k.max = l; k.rotBeimExtrem = rotDa; }
        }
      } else if (k.richtung === 1) {
        if (l > k.max) { k.max = l; k.rotBeimExtrem = rotDa; }
        else if (k.max - l >= 0.1 && l < 0.8) { k.richtung = -1; neu = true; k.min = l; }
      } else {
        if (l < k.min) { k.min = l; k.rotBeimExtrem = rotDa; }
        else if (l - k.min >= 0.1 && k.min < 0.8) { k.richtung = 1; neu = true; k.max = l; }
      }
      if (neu) {
        this.uebergaenge++;
        if (this.uebergangListe.length < 200) {
          this.uebergangListe.push({ t: +(t - (this.start ?? t)).toFixed(2), kachel: [k.x0, k.y0, k.x1, k.y1], richtung: k.richtung, l: +l.toFixed(3), min: +k.min.toFixed(3), max: +k.max.toFixed(3) });
          if (mitBildern && window.lichtBilder.length < 8) window.lichtBilder.push({ t: +(t - (this.start ?? t)).toFixed(2), bild: grafik.leinwand.toDataURL("image/png") });
        }
        k.ue.push(t);
        if (rotDa || k.rotBeimExtrem) { this.roteUebergaenge++; k.rotUe.push(t); }
        k.rotBeimExtrem = rotDa;
      }
      while (k.ue.length && t - k.ue[0] > 1) k.ue.shift();
      while (k.rotUe.length && t - k.rotUe[0] > 1) k.rotUe.shift();
      this.blitze = Math.max(this.blitze, Math.floor(k.ue.length / 2));
      this.roteBlitze = Math.max(this.roteBlitze, Math.floor(k.rotUe.length / 2));
      k.fenster.push({ t, l });
      while (k.fenster.length && t - k.fenster[0].t > 1) k.fenster.shift();
      let lo = Infinity;
      let hi = -Infinity;
      for (const e of k.fenster) { if (e.l < lo) lo = e.l; if (e.l > hi) hi = e.l; }
      if (hi - lo > this.kachelSchwankung) {
        this.kachelSchwankung = hi - lo;
        this.schwankungOrt = { t: +(t - (this.start ?? t)).toFixed(2), kachel: [k.x0, k.y0, k.x1, k.y1], von: +lo.toFixed(3), bis: +hi.toFixed(3) };
      }
    }
  }

  // Höchster Leuchtdichte-Sprung eines Treffer-Scheins je Pixel, gerechnet: Farbe × Deckkraft des Sprites
  // × Stärke, mit „lighter“ auf den hellsten Grund unter dem Schein addiert, bei Lichtstärke 100 %.
  // Abschnitt 7: Farben und Stärke aus der Darstellung (Farbenblind: Okabe-Ito, Umkehr: schwächer und gedreht gerechnet,
  // Hoher Kontrast: keine Scheine). Der Betrag zählt, denn nach dem Umdrehen wird ein Schein dunkler statt heller.
  function scheinRechnung() {
    const S = G.STAERKE;
    const P = grafik.pal || G.PALETTEN.normal;
    if (!(P.schein > 0)) return { hoechst: 0, name: "keine im Hohen Kontrast" };
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const feld = [0x1C, 0x1B, 0x4B];        // Spielfeld, hellste Stelle
    // Schein, Farbe, Deckkraft an der hellsten Stelle des Sprites, Gründe darunter
    const scheine = [
      ["Bumper-Ring", P.lampe.eis, 0.6 * S.bumperSchein, [feld, [0x2A, 0x26, 0x5E], [0x3F, 0x3A, 0x80]]],
      ["Bumper-Kappe", P.lampe.lavendel, S.kappenSchein, [[0x6C, 0x64, 0xBA], [0x3B, 0x35, 0x7E], [0x93, 0x8D, 0xD0]]],   // mit Glanz
      ["Schleuder", P.lampe.lavendel, S.schleuderSchein, [feld, [0x4C, 0x44, 0xA0]]],
      ["Standup", P.lampe.eis, S.standupSchein, [feld]],
    ];
    const dreh = umgekehrt();
    const L = (c) => (dreh ? leuchtdichte(255 - c[0], 255 - c[1], 255 - c[2]) : leuchtdichte(c[0], c[1], c[2]));
    let hoechst = 0;
    let name = "";
    for (const [n, farbe, a, gruende] of scheine) {
      const f = hex(farbe);
      for (const g of gruende) {
        const vorher = L(g);
        const nach = L(g.map((v, i) => Math.min(255, Math.round(v + f[i] * a * P.schein))));
        if (Math.abs(nach - vorher) > hoechst) { hoechst = Math.abs(nach - vorher); name = n; }
      }
    }
    return { hoechst, name };
  }

  // Treffer-Schein direkt am Pixel: Bild ohne Schein gegen Bild mit vollem Schein (Dauertreffer, der Schein
  // steht auf 1), größter Leuchtdichte-Sprung in einem Quadrat um den mittleren Bumper. Die Kugel liegt dabei
  // in der Rampe, am Bumper bewegt sich nichts.
  async function scheinProbe() {
    const warte = (ms) => new Promise((r) => setTimeout(r, ms));
    const b = kb.tisch.bumper[2];
    const R = b.radius * grafik.m;
    const x0 = Math.round(grafik.X(b.pos.x) - 1.6 * R);
    const y0 = Math.round(grafik.Y(b.pos.y) - 1.6 * R);
    const n = Math.round(3.2 * R);
    const hilfe = document.createElement("canvas");
    hilfe.width = n;
    hilfe.height = n;
    const hg = hilfe.getContext("2d", { willReadFrequently: true });
    const lies = () => {
      hg.clearRect(0, 0, n, n);
      hg.drawImage(grafik.leinwand, x0, y0, n, n, 0, 0, n, n);
      return hg.getImageData(0, 0, n, n).data;
    };
    const ohne = lies();
    for (let i = 0; i < 8; i++) { w.bumper(2); await warte(70); }
    const wert = grafik.scheinWert("bumper2");
    const mit = lies();
    // bei Umkehr wie gesehen (gedreht); der Betrag zählt, ein Schein macht den gedrehten Grund dunkler
    const dreh = umgekehrt();
    const L = (p, i) => (dreh ? leuchtdichte(255 - p[i], 255 - p[i + 1], 255 - p[i + 2]) : leuchtdichte(p[i], p[i + 1], p[i + 2]));
    let hoechst = 0;
    for (let i = 0; i < ohne.length; i += 4) {
      const dl = Math.abs(L(mit, i) - L(ohne, i));
      if (dl > hoechst) hoechst = dl;
    }
    await warte(1600);
    const danach = lies();
    let rest = 0;
    for (let i = 0; i < ohne.length; i += 4) {
      rest = Math.max(rest, Math.abs(L(danach, i) - L(ohne, i)));
    }
    return { hoechst, wert, rest };
  }

  // --- Drehbuch ---------------------------------------------------------------------------

  function drehbuch() {
    const schritte = [];
    const bei = (t, f) => schritte.push({ t, f, fertig: false });
    bei(0.0, () => kb.neuesSpiel());
    bei(0.8, () => regeln.abschuss(0.45));
    // Ballschutz. Fängt die Zündkammer die Kugel gerade (sie hält 1 s, dort greift das Ablassen nicht), wird bis 3,6 s
    // nachgefasst, und der zweite Abschuss wartet, bis die Kugel wieder auf der Rampe liegt (Abschnitt 6: der Weg der
    // ersten Kugel hängt an der Stelle im Takt, an der der Abschuss fällt; bei Abschnitt 4 fiel sie zufällig nicht hinein).
    for (const t of [2.4, 2.7, 3.0, 3.3, 3.6]) bei(t, () => { if (z.statistik.ballschutz === 0) w.alleAblassen(); });
    for (const t of [3.4, 3.7, 4.0]) bei(t, () => { if (z.phase === "bereit") regeln.abschuss(0.5); });
    bei(3.6, () => { w.waechter = true; });
    for (let i = 0; i < 15; i++) bei(4.5 + i * 0.17, () => w.bumper(i));   // Bumper-Serie: Mission geschafft, Rang auf
    bei(7.6, () => w.sensor("kickback"));                      // Kickback
    for (let i = 0; i < 3; i++) bei(8.4 + i * 0.3, () => w.wand("standup-" + (i + 1)));   // Standup-Satz
    bei(10.0, () => w.kammerEcht());                           // Zündkammer (echte Kugel): Mission 2 startet
    for (let i = 0; i < 3; i++) bei(12.0 + i * 0.3, () => w.sensor("gasse-" + (i + 1)));  // Gasse voll, Multiplikator
    bei(14.0, () => w.kammer());                               // Mission 3 startet
    for (let i = 0; i < 3; i++) bei(14.6 + i * 0.2, () => w.wand("fallziel-" + (i + 1)));   // Bank leer
    for (let i = 0; i < 3; i++) bei(17.4 + i * 0.2, () => w.wand("fallziel-" + (i + 1)));   // Bank leer, Mission 3 geschafft
    bei(19.5, () => w.kammer());                               // Multiball
    bei(21.5, () => w.kammer());                               // Jackpot
    for (let i = 0; i < 3; i++) bei(23.0 + i * 0.2, () => w.wand("fallziel-" + (i + 1)));   // dritte Bank: Extraball leuchtet
    bei(25.0, () => w.kammer());                               // Extraball
    bei(26.0, () => w.sensor("gasse-1"));                      // eine Gasse an, damit das Klopfen sie verschiebt
    for (let i = 0; i < 30; i++) {                             // 10 Hz Flipperklopfen über 3 s
      const code = i % 2 ? "ShiftRight" : "ShiftLeft";
      bei(26.5 + i * 0.1, () => kb.flipperDruck(code));
      bei(26.55 + i * 0.1, () => kb.flipperLos(code));
    }
    bei(30.0, () => kb.schubsen(0.45, 0));                     // Vorsicht
    bei(30.25, () => kb.schubsen(-0.45, 0));                   // Vorsicht
    bei(30.5, () => kb.schubsen(0, 0.45));                     // Tilt (die Warnung verfällt mit 1/1,5 je Sekunde)
    bei(31.6, () => { w.waechter = false; w.alleAblassen(); schluss.an = true; });
    return schritte;
  }

  // Schluss: nach dem Tilt die übrigen Kugeln ablaufen lassen (Extraball mit Bonus-Abrechnung) bis zum Spielende
  const schluss = { an: false, phase: "", seit: 0, extra: false, ende: 0 };
  function schlussSchritt(t) {
    if (!schluss.an) return;
    if (z.phase !== schluss.phase) { schluss.phase = z.phase; schluss.seit = t; }
    const dauer = t - schluss.seit;
    if (z.phase === "spiel" && dauer > 0.6) { w.alleAblassen(); schluss.seit = t; }
    if (z.phase === "bereit") {
      if (!schluss.extra && dauer > 0.3) {
        schluss.extra = true;
        w.sensor("gasse-2"); w.sensor("gasse-3");
        w.wand("standup-1"); w.wand("standup-2");
      }
      if (dauer > 1.0) { w.alleAblassen(); schluss.seit = t; }
    }
    if (z.phase === "ende" && !schluss.ende) schluss.ende = t;
  }

  // --- Ablauf -----------------------------------------------------------------------------

  const zahl = (x, n = 4) => x.toFixed(n).replace(".", ",");

  async function starte() {
    const kachel = document.getElementById("licht-kachel");
    const status = document.getElementById("licht-status");
    const ausgabe = document.getElementById("licht-bericht");
    if (kachel) kachel.hidden = false;
    if (status) status.textContent = "Drehbuch läuft, etwa 45 s. Bitte nichts drücken.";
    kb.spiel.autoPause = false;     // das Drehbuch läuft auch ohne Fokus weiter
    kb.pause(false);
    // Die Prüfung spielt zwei Spiele; die gespeicherte Bestenliste kommt danach zurück (gilt nach dem Neuladen)
    let alteListe = null;
    try { alteListe = localStorage.getItem("kugelblitz.bestenliste"); } catch { /* egal */ }
    const altStaerke = grafik.lichtstaerke;
    const altWenig = grafik.wenigBewegung;
    grafik.einstellungen({ lichtstaerke: 1, wenigBewegung: false });   // schlechtester Fall
    kb.neuesSpiel();
    await new Promise((r) => setTimeout(r, 1400));
    let probe = { hoechst: 0, wert: 0, rest: 0 };
    try { probe = await scheinProbe(); } catch { /* ohne Probe weiter */ }
    grafik.protokoll = [];
    const schritte = drehbuch();
    const messer = new Lichtmesser();
    const start = kb.spiel.uhr;
    let fertig = false;
    let messStart = null;
    haken.vorSchritt.push(() => {
      if (fertig) return;
      const t = kb.spiel.uhr - start;
      for (const s of schritte) if (!s.fertig && t >= s.t) { s.fertig = true; s.f(); }
      schlussSchritt(t);
    });
    haken.nachBild.push((zeit) => {
      if (fertig) return;
      const t = zeit / 1000;
      if (messStart === null) messStart = t;
      messer.messe(t);
      if (schluss.ende && kb.spiel.uhr - start - schluss.ende > 3.5) {
        fertig = true;
        bericht(messer, t - messStart);
        grafik.einstellungen({ lichtstaerke: altStaerke, wenigBewegung: altWenig });
        try {
          if (alteListe === null) localStorage.removeItem("kugelblitz.bestenliste");
          else localStorage.setItem("kugelblitz.bestenliste", alteListe);
        } catch { /* egal */ }
      }
    });

    function bericht(m, dauer) {
      const prot = grafik.protokoll.map((e) => e.t).sort((a, b) => a - b);
      let ereignisseMax = 0;
      for (let i = 0, j = 0; i < prot.length; i++) {
        while (prot[i] - prot[j] >= 1) j++;
        ereignisseMax = Math.max(ereignisseMax, i - j + 1);
      }
      grafik.protokoll = null;
      const rechnung = scheinRechnung();
      const st = z.statistik;
      const noetig = [
        ["Ballschutz", st.ballschutz >= 1], ["Bumper-Serie", st.bumper >= 15], ["Kickback", st.kickbacks >= 1],
        ["Standup-Satz", st.standupSaetze >= 1], ["Gasse voll", st.gassenVoll >= 1], ["Fallziel-Bank", st.banken >= 3],
        ["Mission geschafft", st.missionen >= 3], ["Multiball", st.multiballs >= 1], ["Jackpot", st.jackpots >= 1],
        ["Extraball", st.extraBaelle >= 1], ["Tilt", st.tilts >= 1], ["Spielende", z.phase === "ende"],
      ];
      const fehlt = noetig.filter(([, ok]) => !ok).map(([n]) => n);
      const ergebnis = {
        darstellung: darstellung(), dauer, bilder: m.bilder, kacheln: m.kacheln.length, klein: m.w + " × " + m.h,
        mittelSprung: m.groessterSprung, mittelSprungZeit: m.sprungZeit,
        blitze: m.blitze, uebergaenge: m.uebergaenge, roteBlitze: m.roteBlitze, roteUebergaenge: m.roteUebergaenge,
        rotPixel: m.rotPixel, kachelSchwankung: m.kachelSchwankung, hellstesMittel: m.hellstesMittel,
        ereignisseJeSekunde: ereignisseMax, ereignisseGesamt: prot.length,
        oertlich: m.oertlich, oertlichOrt: m.oertlichName, oertlichZeit: m.oertlichZeit,
        scheinPixel: probe.hoechst, scheinPixelWert: probe.wert, scheinPixelRest: probe.rest, scheinRechnerisch: rechnung.hoechst, scheinRechnerischArt: rechnung.name,
        drehbuchFehlt: fehlt, uebergangListe: m.uebergangListe, schwankungOrt: m.schwankungOrt,
      };
      ergebnis.bestanden = ergebnis.mittelSprung <= 0.02 && ergebnis.blitze === 0 && ergebnis.roteBlitze === 0 &&
        ergebnis.ereignisseJeSekunde <= 3 && ergebnis.oertlich < 0.1 && ergebnis.scheinRechnerisch < 0.1 &&
        ergebnis.scheinPixel < 0.1 && fehlt.length === 0;
      window.lichtBericht = ergebnis;
      const text = [
        "Drehbuch " + zahl(dauer, 1) + " s, " + m.bilder + " Bilder, Lichtstärke 100 %, Darstellung " + darstellung(),
        "Abbild " + m.w + " × " + m.h + ", " + m.kacheln.length + " Kacheln",
        "",
        "1. Mittlere Leuchtdichte, größter Sprung",
        "   von Bild zu Bild: " + zahl(m.groessterSprung) + " (Grenze 0,02)",
        "2. Allgemeine Blitze je Kachel in 1 s: " + m.blitze + " (Grenze 0)",
        "   Übergänge ab 0,10: " + m.uebergaenge,
        "3. Rote Blitze: " + m.roteBlitze + " (Grenze 0)",
        "   Pixel mit gesättigtem Rot: " + m.rotPixel,
        "4. Licht-Ereignisse je Sekunde, höchstens: " + ereignisseMax + " (Grenze 3)",
        "5. Treffer-Scheine örtlich: " + zahl(m.oertlich, 3) + " (Grenze 0,10, " + m.oertlichName + ")",
        "   rechnerisch je Pixel: " + zahl(rechnung.hoechst, 3) + " (" + rechnung.name + ")",
        "   gemessen je Pixel, Bumper im Dauertreffer: " + zahl(probe.hoechst, 3) + " (Schein " + zahl(probe.wert, 2) + ")",
        "   nach 1,6 s zurück auf den Grund: " + (probe.rest < 0.002 ? "ja" : "nein, " + zahl(probe.rest, 3)),
        "",
        "Größte Schwankung einer Kachel in 1 s: " + zahl(m.kachelSchwankung, 3),
        "Hellstes Bild, mittlere Leuchtdichte: " + zahl(m.hellstesMittel, 3),
        "Drehbuch vollständig: " + (fehlt.length ? "nein, es fehlt " + fehlt.join(", ") : "ja"),
        "",
        "Ergebnis: " + (ergebnis.bestanden ? "BESTANDEN" : "NICHT BESTANDEN"),
      ].join("\n");
      ergebnis.text = text;
      if (ausgabe) ausgabe.textContent = text;
      if (status) status.textContent = ergebnis.bestanden ? "Bestanden." : "Nicht bestanden.";
    }
  }

  // --- Verzug der Lampen (Abschnitt 4) ------------------------------------------------------
  // Wie lange zeigt eine Lampe etwas anderes als das Regelwerk? Je Bild nach dem Zeichnen: Weicht das Ziel der
  // Lampe (l.ziel) vom Zustand des Regelwerks ab (grafik.lampenRoh), läuft eine Uhr; stimmt es wieder, zählt der
  // Verzug. Kippt das Regelwerk vorher zurück, war es ein kurzer Zwischenzustand, der nie gezeigt wurde (verworfen).
  // Gemessen wird von außen, damit dieselbe Messung für jede Fassung der Lampenlogik gilt.
  const GRUPPE = (id) => (/^(gasse|marke)/.test(id) ? "Gassen" : id.startsWith("kammer-") ? "Zündkammer-Leiter"
    : /^(standup|zielpfeil)/.test(id) ? "Standups" : /^(fallziel|bankpfeil)/.test(id) ? "Fallziele"
      : id.startsWith("mission") ? "Missionen" : id.startsWith("rang") ? "Rang" : id.startsWith("mult") ? "Multiplikator"
        : id === "kickback" ? "Kickback" : id === "schutz" ? "Ballschutz" : id === "sturm" ? "Gewitterwolke" : "Zündkammer");
  class Verzugsmesser {
    constructor() { this.seit = new Map(); this.werte = {}; this.verworfen = {}; this.abweichend = {}; this.bilder = 0; }
    messe() {
      const roh = grafik.lampenRoh(z, kb.tisch, kb.spiel.uhr);
      const t = kb.spiel.uhr;
      this.bilder++;
      const abw = new Set();
      for (const l of grafik.lampen) {
        const g = GRUPPE(l.id);
        const r = roh[l.id] || 0;
        const s = this.seit.get(l.id);
        if (r !== l.ziel) {
          abw.add(g);
          if (!s) this.seit.set(l.id, { t, zielVorher: l.ziel });
        } else if (s) {
          // Anzeige und Regelwerk stimmen wieder überein: hat die Anzeige gewechselt, zählt der Verzug;
          // ist nur das Regelwerk zurückgekippt, wurde der Zwischenzustand nie gezeigt
          this.seit.delete(l.id);
          if (l.ziel !== s.zielVorher) (this.werte[g] = this.werte[g] || []).push(t - s.t);
          else this.verworfen[g] = (this.verworfen[g] || 0) + 1;
        }
      }
      for (const g of abw) this.abweichend[g] = (this.abweichend[g] || 0) + 1;
    }
    bericht() {
      const zeilen = [];
      const gesamt = [];
      for (const g of Object.keys({ ...this.werte, ...this.verworfen }).sort()) {
        const a = (this.werte[g] || []).slice().sort((x, y) => x - y);
        gesamt.push(...a);
        const p = (q) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0);
        const mittel = a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
        zeilen.push({ gruppe: g, n: a.length, mittel, p95: p(0.95), max: a.length ? a[a.length - 1] : 0, verworfen: this.verworfen[g] || 0, abweichendAnteil: (this.abweichend[g] || 0) / Math.max(1, this.bilder) });
      }
      gesamt.sort((x, y) => x - y);
      const p = (q) => (gesamt.length ? gesamt[Math.min(gesamt.length - 1, Math.floor(gesamt.length * q))] : 0);
      return { gruppen: zeilen, n: gesamt.length, mittel: gesamt.length ? gesamt.reduce((s, x) => s + x, 0) / gesamt.length : 0, p95: p(0.95), max: gesamt.length ? gesamt[gesamt.length - 1] : 0 };
    }
  }

  // --- Freies Spiel (Abschnitt 4) -----------------------------------------------------------
  // index.html?licht=frei&sek=180: Ein Automat spielt mehrere Minuten ohne Drehbuch, mit echter Physik und echter
  // Eingabe: Flipper nach Lage der Kugel und zufällig, Klopfphasen mit 8 bis 12 Hz (Lane-Wechsel), Abschuss mit
  // zufälliger Ladung, Schubser (ab und zu bis zum Tilt), Pause-Stakkato mit 4 Hz, Bonus überspringen, Neustart
  // mitten im Spiel, Probesalve im Einzelschritt. Jedes zweite Spiel beginnt mit Rang Gewitter (drei Missionen
  // geschafft), damit Multiball und Jackpot im freien Spiel vorkommen. Gemessen wird wie im Drehbuch, dazu der
  // Verzug der Lampen.
  function taste(code, art = "keydown") { window.dispatchEvent(new KeyboardEvent(art, { code, key: code, bubbles: true })); }
  async function freiesSpiel(sekunden) {
    const kachel = document.getElementById("licht-kachel");
    const status = document.getElementById("licht-status");
    const ausgabe = document.getElementById("licht-bericht");
    if (kachel) kachel.hidden = false;
    if (status) status.textContent = "Freies Spiel läuft, " + Math.round(sekunden) + " s. Bitte nichts drücken.";
    kb.spiel.autoPause = false;
    kb.pause(false);
    let alteListe = null;
    try { alteListe = localStorage.getItem("kugelblitz.bestenliste"); } catch { /* egal */ }
    grafik.einstellungen({ lichtstaerke: 1, wenigBewegung: false });
    kb.neuesSpiel();
    await new Promise((r) => setTimeout(r, 800));
    grafik.protokoll = [];
    const messer = new Lichtmesser();
    const verzug = new Verzugsmesser();
    const a = {                      // Zustand des Automaten
      flipper: [0, 0], klopfen: 0, klopfTakt: 0, klopfSeite: 0, laden: 0, schubsUhr: 4, pauseStakkato: 0, pauseUhr: 30,
      spiele: 0, neustarts: 0, tilts: 0, pausen: 0, salven: 0, ende: 0, f2Uhr: 70, salveUhr: 0, einzel: 0, spielStart: 0,
    };
    const r = zufall;
    const zeitReal0 = performance.now();
    let fertig = false;
    const druck = (seite, an) => {
      const code = seite ? "ShiftRight" : "ShiftLeft";
      if (an) kb.flipperDruck(code); else kb.flipperLos(code);
    };
    haken.vorSchritt.push((sek) => {
      if (fertig) return;
      const t = kb.spiel.uhr;
      // Pause-Stakkato: viermal je Sekunde P, sechs Mal
      if (a.pauseStakkato > 0) {
        a.pauseUhr -= sek;
        return;
      }
      const phase = z.phase;
      if (phase === "titel" || phase === "ende") {
        a.ende += sek;
        if (a.ende > 1.4) {
          a.ende = 0;
          if (a.einzel) { taste("KeyT"); a.einzel = 0; }
          kb.neuesSpiel();
          a.spiele++;
          if (a.spiele % 2 === 0) { z.mission.erfuellt = 3; regeln.aktualisiere(); }
          a.spielStart = t;
        } else if (a.ende > 0.2 && a.ende < 0.25 && a.spiele % 3 === 2 && !a.einzel) {
          taste("KeyT"); taste("KeyB"); a.einzel = 1; a.salven++; a.ende = -3;   // Probesalve im Einzelschritt, 3 s zuschauen
        }
        return;
      }
      if (phase === "bonus") { if (r() < 0.01) taste("Enter"); return; }
      // Abschuss: halten und loslassen
      if (phase === "bereit") {
        if (!a.laden) { a.laden = 0.2 + r() * 1.0; taste("Space"); }
        else { a.laden -= sek; if (a.laden <= 0) { taste("Space", "keyup"); a.laden = 0; } }
      }
      // Flipper: Kugel nah am Flipper, dazu zufällige Tipper und Klopfphasen
      const kugeln = kb.tisch.kugeln.filter((k) => !k.probe && !k.gehalten);
      for (let s = 0; s < 2; s++) {
        if (a.flipper[s] > 0) { a.flipper[s] -= sek; if (a.flipper[s] <= 0) druck(s, false); continue; }
        if (a.klopfen > 0) continue;
        const nah = kugeln.some((k) => (s ? k.pos.x >= 0.5 : k.pos.x < 0.5) && k.pos.y < 0.34 && k.pos.y > 0.12 && k.vel.y < 0.8);
        if ((nah && r() < 0.35) || r() < 0.006) { druck(s, true); a.flipper[s] = nah ? 0.12 + r() * 0.2 : 0.06 + r() * 0.05; }
      }
      if (a.klopfen > 0) {
        a.klopfen -= sek;
        a.klopfTakt -= sek;
        if (a.klopfTakt <= 0) {
          a.klopfSeite = 1 - a.klopfSeite;
          druck(a.klopfSeite, true);
          a.flipper[a.klopfSeite] = 0.04;
          a.klopfTakt = 1 / (8 + r() * 4);
        }
      } else if (r() < sek / 18) { a.klopfen = 1 + r() * 1.5; a.klopfTakt = 0; }
      // Schubsen: meist einzeln, ab und zu dreimal schnell (Tilt)
      a.schubsUhr -= sek;
      if (a.schubsUhr <= 0 && phase === "spiel") {
        const tilt = r() < 0.12;
        const n = tilt ? 3 : 1;
        for (let i = 0; i < n; i++) taste(["KeyX", "Period", "ArrowUp"][Math.floor(r() * 3)]);
        if (tilt) a.tilts++;
        a.schubsUhr = 5 + r() * 9;
      }
      // Pause: alle 40 bis 70 s ein Stakkato mit 4 Hz oder eine ruhige Pause von 2 s
      a.pauseUhr -= sek;
      if (a.pauseUhr <= 0) {
        a.pauseUhr = 40 + r() * 30;
        a.pausen++;
        stakkato(r() < 0.6 ? 6 : 2, r() < 0.6 ? 250 : 2000);
      }
      // Neustart mitten im Spiel (F2), selten
      a.f2Uhr -= sek;
      if (a.f2Uhr <= 0 && t - a.spielStart > 20) { a.f2Uhr = 80 + r() * 60; taste("F2"); a.neustarts++; a.spiele++; a.spielStart = t; }
    });
    // P mehrmals im Abstand ms; die Spieluhr steht dabei, also mit echten Timern
    async function stakkato(n, ms) {
      a.pauseStakkato = 1;
      for (let i = 0; i < n; i++) { taste("KeyP"); await new Promise((res) => setTimeout(res, ms)); }
      if (kb.spiel.pause) taste("KeyP");
      a.pauseStakkato = 0;
    }
    let tMess0 = null;
    await new Promise((fertigMelden) => {
      haken.nachBild.push((zeit) => {
        if (fertig) return;
        const t = zeit / 1000;
        if (tMess0 === null) tMess0 = t;
        messer.messe(t);
        verzug.messe();
        if (performance.now() - zeitReal0 > sekunden * 1000) { fertig = true; fertigMelden(); }
      });
    });
    for (let s = 0; s < 2; s++) druck(s, false);
    // Bericht
    const prot = grafik.protokoll.map((e) => e.t).sort((x, y) => x - y);
    const arten = {};
    for (const e of grafik.protokoll) arten[e.art] = (arten[e.art] || 0) + 1;
    let ereignisseMax = 0;
    for (let i = 0, j = 0; i < prot.length; i++) {
      while (prot[i] - prot[j] >= 1) j++;
      ereignisseMax = Math.max(ereignisseMax, i - j + 1);
    }
    grafik.protokoll = null;
    const v = verzug.bericht();
    const st = z.statistik;
    const m = messer;
    const ergebnis = {
      art: "frei", darstellung: darstellung(), dauer: (performance.now() - zeitReal0) / 1000, bilder: m.bilder, kacheln: m.kacheln.length,
      mittelSprung: m.groessterSprung, blitze: m.blitze, uebergaenge: m.uebergaenge, roteBlitze: m.roteBlitze, rotPixel: m.rotPixel,
      ereignisseJeSekunde: ereignisseMax, ereignisseGesamt: prot.length, ereignisArten: arten, oertlich: m.oertlich, oertlichOrt: m.oertlichName,
      kachelSchwankung: m.kachelSchwankung, hellstesMittel: m.hellstesMittel, verzug: v, uebergangListe: m.uebergangListe, schwankungOrt: m.schwankungOrt,
      automat: { spiele: a.spiele, neustarts: a.neustarts, tiltVersuche: a.tilts, pausen: a.pausen, salven: a.salven },
      spielstand: { phase: z.phase, tilts: st.tilts, multiballs: st.multiballs, jackpots: st.jackpots, bumper: st.bumper, ballschutz: st.ballschutz, kickbacks: st.kickbacks, banken: st.banken },
    };
    ergebnis.bestanden = ergebnis.mittelSprung <= 0.02 && ergebnis.blitze === 0 && ergebnis.roteBlitze === 0 &&
      ergebnis.ereignisseJeSekunde <= 3 && ergebnis.oertlich < 0.1;
    const z3 = (x) => zahl(x, 3);
    const text = [
      "Freies Spiel " + zahl(ergebnis.dauer, 0) + " s, " + m.bilder + " Bilder, Lichtstärke 100 %, Darstellung " + darstellung(),
      "Automat: " + a.spiele + " Spiele, " + a.neustarts + " Neustarts, " + a.pausen + " Pausen, " + a.salven + " Probesalven",
      "1. größter Sprung der mittleren Leuchtdichte: " + zahl(m.groessterSprung) + " (Grenze 0,02)",
      "2. allgemeine Blitze: " + m.blitze + " (Übergänge ab 0,10: " + m.uebergaenge + ")",
      "3. rote Blitze: " + m.roteBlitze,
      "4. Licht-Ereignisse je Sekunde, höchstens: " + ereignisseMax + " (" + prot.length + " gesamt)",
      "5. Treffer-Scheine örtlich: " + z3(m.oertlich) + " (" + m.oertlichName + ")",
      "Verzug der Lampen: Mittel " + z3(v.mittel) + " s, p95 " + z3(v.p95) + " s, höchstens " + z3(v.max) + " s (" + v.n + " Wechsel)",
      ...v.gruppen.map((g) => "   " + g.gruppe + ": " + g.n + " Wechsel, Mittel " + z3(g.mittel) + ", p95 " + z3(g.p95) + ", max " + z3(g.max) + ", verworfen " + g.verworfen),
      "Ergebnis: " + (ergebnis.bestanden ? "BESTANDEN" : "NICHT BESTANDEN"),
    ].join("\n");
    ergebnis.text = text;
    window.lichtBericht = ergebnis;
    if (ausgabe) ausgabe.textContent = text;
    if (status) status.textContent = ergebnis.bestanden ? "Bestanden." : "Nicht bestanden.";
    try {
      if (alteListe === null) localStorage.removeItem("kugelblitz.bestenliste");
      else localStorage.setItem("kugelblitz.bestenliste", alteListe);
    } catch { /* egal */ }
  }

  // --- Wechsel der Darstellung (Abschnitt 7) --------------------------------------------------
  // index.html?licht=modi: Die Darstellung wechselt wie bei jemandem, der durch das Auswahlfeld läuft. Erst ruhig (alle 2 s
  // ein Wechsel, über alle fünf hin und her, dunkel und hell im Wechsel), dann im Stakkato: zehn Wünsche je Sekunde
  // zwischen Normal und Hoher Kontrast hell, 3 s lang (so schalten Pfeiltasten in einem Auswahlfeld). Gemessen wird jedes
  // Bild wie im Drehbuch (Kacheln, Blitze nach WCAG), dazu je Wechsel die Bilder mit einem Sprung der mittleren
  // Leuchtdichte über 0,02 (soll: höchstens eines, Seite und Tisch im selben Bild), Sprünge ohne Wechsel und der kleinste
  // Abstand zweier Wechsel (soll: mindestens 1,5 s).
  async function modiWechsel() {
    const kachel = document.getElementById("licht-kachel");
    const status = document.getElementById("licht-status");
    const ausgabe = document.getElementById("licht-bericht");
    if (kachel) kachel.hidden = false;
    if (status) status.textContent = "Wechsel der Darstellung läuft, etwa 30 s. Bitte nichts drücken.";
    kb.spiel.autoPause = false;
    kb.pause(false);
    const warte = (ms) => new Promise((r) => setTimeout(r, ms));
    let alteWahl = null;
    try { alteWahl = localStorage.getItem("werkstatt.darstellung"); } catch { /* egal */ }
    const waehle = (wert) => { try { localStorage.setItem("werkstatt.darstellung", wert); } catch { /* egal */ } kb.darstFolgen(); };
    grafik.einstellungen({ lichtstaerke: 1, wenigBewegung: false });
    waehle("system");
    kb.neuesSpiel();
    await warte(800);
    regeln.abschuss(0.45);
    await warte(600);
    w.waechter = true;
    await warte(1600);
    const messer = new Lichtmesser();
    const wechsel = [];
    const spruenge = [];
    let letzter = kb.darstellung;
    let mittelVorher = null;
    let fertig = false;
    haken.nachBild.push((zeit) => {
      if (fertig) return;
      const t = zeit / 1000;
      messer.messe(t);
      const mittel = messer.letztesMittel;
      if (mittelVorher !== null && Math.abs(mittel - mittelVorher) > 0.02) spruenge.push({ t, sprung: Math.abs(mittel - mittelVorher) });
      mittelVorher = mittel;
      if (kb.darstellung !== letzter) { wechsel.push({ t, von: letzter, nach: kb.darstellung }); letzter = kb.darstellung; }
    });
    for (const wert of ["hc-dark", "hc-light", "cvd-dark", "invert", "system", "invert", "hc-light", "hc-dark", "system"]) {
      waehle(wert);
      await warte(2000);
    }
    for (let i = 0; i < 30; i++) { waehle(i % 2 ? "system" : "hc-light"); await warte(100); }
    waehle("system");
    await warte(3000);
    fertig = true;
    w.waechter = false;
    try {
      if (alteWahl === null) localStorage.removeItem("werkstatt.darstellung");
      else localStorage.setItem("werkstatt.darstellung", alteWahl);
    } catch { /* egal */ }
    // Je Wechsel die Sprünge in den Bildern ab dem Wechsel bis 0,5 s danach; was außerhalb liegt, ist ein fremder Sprung
    const jeWechsel = wechsel.map((x) => ({ ...x, spruenge: spruenge.filter((s) => s.t >= x.t - 0.001 && s.t < x.t + 0.5).length }));
    const fremd = spruenge.filter((s) => !wechsel.some((x) => s.t >= x.t - 0.001 && s.t < x.t + 0.5)).length;
    let abstand = Infinity;
    for (let i = 1; i < wechsel.length; i++) abstand = Math.min(abstand, wechsel[i].t - wechsel[i - 1].t);
    const mehrfach = jeWechsel.filter((x) => x.spruenge > 1).length;
    const ergebnis = {
      art: "modi", bilder: messer.bilder, wechsel: jeWechsel, kleinsterAbstand: abstand, fremdeSpruenge: fremd, mehrfach,
      groessterSprung: messer.groessterSprung, blitze: messer.blitze, uebergaenge: messer.uebergaenge, roteBlitze: messer.roteBlitze,
      uebergangListe: messer.uebergangListe,
    };
    ergebnis.bestanden = messer.blitze === 0 && messer.roteBlitze === 0 && mehrfach === 0 && fremd === 0 && abstand >= 1.5 - 0.02;
    const z3 = (x) => zahl(x, 3);
    ergebnis.text = [
      "Wechsel der Darstellung, " + messer.bilder + " Bilder, Lichtstärke 100 %",
      "Wechsel: " + wechsel.length + " (9 ruhig, dazu das Stakkato mit 30 Wünschen in 3 s)",
      ...jeWechsel.map((x) => "   " + z3(x.t - (wechsel[0] ? wechsel[0].t : 0)) + " s  " + x.von + " → " + x.nach + ": " + x.spruenge + " Bild(er) mit Sprung über 0,02"),
      "Kleinster Abstand zweier Wechsel: " + z3(abstand) + " s (mindestens 1,5)",
      "Wechsel mit mehr als einem Sprung: " + mehrfach + " (Grenze 0)",
      "Sprünge ohne Wechsel: " + fremd + " (Grenze 0)",
      "Größter Sprung (der Wechsel selbst): " + zahl(messer.groessterSprung),
      "Allgemeine Blitze je Kachel in 1 s: " + messer.blitze + " (Übergänge ab 0,10: " + messer.uebergaenge + ")",
      "Rote Blitze: " + messer.roteBlitze,
      "Ergebnis: " + (ergebnis.bestanden ? "BESTANDEN" : "NICHT BESTANDEN"),
    ].join("\n");
    window.lichtBericht = ergebnis;
    if (ausgabe) ausgabe.textContent = ergebnis.text;
    if (status) status.textContent = ergebnis.bestanden ? "Bestanden." : "Nicht bestanden.";
  }

  kb.spiel.autoPause = false;
  window.lichtpruefung = { werkzeug: w, starte, freiesSpiel, modiWechsel, Lichtmesser, Verzugsmesser, scheinRechnung };
  if (modus === "1") setTimeout(starte, 1200);
  if (modus === "modi") setTimeout(modiWechsel, 1200);
  if (modus === "frei") {
    const sek = Number(new URLSearchParams(location.search).get("sek")) || 180;
    setTimeout(() => freiesSpiel(sek), 1200);
  }
})();
