// Lichtmessung für Kugelblitz (Abschnitt 4) über Edge headless und das DevTools-Protokoll.
//   node messen.mjs <art> [ausgabe.json]     art: licht (Drehbuch) | frei (freies Spiel, SEK Sekunden) | zeiten
//   GROESSE=1440|1024|390 (Vorgabe 1440), SEK=180, SPRACHE=ja (Sprache des Spiels, Vorgabe de)
//   BILDRATE=60 (Vorgabe): Das Spiel bekommt seine Bilder wie von einem 60-Hz-Bildschirm, mit genau diesem Takt im
//   Zeitstempel. So läuft das Drehbuch wie in Abschnitt 3 und 4 gemessen. Edge headless folgt sonst dem Bildschirm
//   des Rechners (13.11.2026: 144 Hz), die Kugeln nehmen dann andere Wege und das Drehbuch verpasst Ereignisse.
//   BILDRATE=0 misst mit der Bildrate des Rechners.
//   MODUS=normal|hc-dark|hc-light|cvd|invert (Abschnitt 7): Darstellung der Werkstatt (werkstatt.darstellung) vor dem
//   Laden, Vorgabe normal. Art „modi“ (index.html?licht=modi) wechselt die Darstellung selbst und zählt die Sprünge.
// Der Canvas wird in der Seite selbst gemessen (lichtpruefung.js, jedes Bild). Zusätzlich nimmt dieses Skript die
// ganze Seite per Screencast auf (PNG) und misst die Leuchtdichte der Kacheln und der Seite außerhalb des Canvas:
// größter Sprung je Bild, Übergänge und Blitze nach WCAG 2.3.1 je Kachel, und in kleinen Zellen (etwa 24 CSS-Pixel)
// die größte Änderung (Ziffern, Balken, Knöpfe).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9336;
const BASIS = process.env.BASIS || "http://127.0.0.1:8643/index.html";
const hier = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const art = process.argv[2] || "frei";
const ausgabeDatei = process.argv[3] || "";
const GROESSE = process.env.GROESSE || "1440";
const SEK = Number(process.env.SEK || 180);
const SPRACHE = process.env.SPRACHE || "de";
const BILDRATE = Number(process.env.BILDRATE ?? 60);
// Darstellung: Kurzname → gespeicherter Wert der Werkstatt (Farbenblind wie auf einem dunklen Gerät)
const MODI = { normal: "system", "hc-dark": "hc-dark", "hc-light": "hc-light", cvd: "cvd-dark", invert: "invert" };
const MODUS = process.env.MODUS || "normal";
if (!MODI[MODUS]) { console.error("MODUS unbekannt: " + MODUS + " (normal, hc-dark, hc-light, cvd, invert)"); process.exit(1); }
const profil = path.join(os.tmpdir(), "kugelblitz-edge-mess");
fs.rmSync(profil, { recursive: true, force: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profil,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--force-color-profile=srgb",
  "--window-size=1440,900", ...(process.env.OHNE_GPU ? ["--disable-gpu"] : []), "about:blank"], { stdio: "ignore" });

let ws;
let nr = 0;
const offen = new Map();
const meldungen = [];
const ereignisHoerer = [];
async function verbinden() {
  for (let i = 0; i < 60; i++) {
    try {
      const liste = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      const seite = liste.find((t) => t.type === "page");
      if (seite) {
        ws = new WebSocket(seite.webSocketDebuggerUrl);
        await new Promise((r, f) => { ws.onopen = r; ws.onerror = f; });
        ws.onmessage = (m) => {
          const d = JSON.parse(m.data);
          if (d.id && offen.has(d.id)) { offen.get(d.id)(d); offen.delete(d.id); }
          if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "warning")) {
            meldungen.push(d.params.type + ": " + d.params.args.map((a) => a.value ?? a.description).join(" "));
          }
          if (d.method === "Runtime.exceptionThrown") meldungen.push("Ausnahme: " + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
          if (d.method === "Log.entryAdded" && (d.params.entry.level === "error" || d.params.entry.level === "warning")) meldungen.push("log " + d.params.entry.level + ": " + d.params.entry.text + " " + (d.params.entry.url || ""));
          for (const h of ereignisHoerer) h(d);
        };
        return;
      }
    } catch { /* noch nicht da */ }
    await warte(250);
  }
  throw new Error("Edge antwortet nicht");
}
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const i = ++nr;
  offen.set(i, (d) => (d.error ? rej(new Error(method + ": " + d.error.message)) : res(d.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
async function js(code) {
  const r = await cdp("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

// --- PNG lesen (8 Bit, RGB oder RGBA, ohne Zeilensprung) -----------------------------------------
function pngLesen(buf) {
  let p = 8;
  let w = 0, h = 0, typ = 0, tiefe = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const name = buf.toString("ascii", p + 4, p + 8);
    const daten = buf.subarray(p + 8, p + 8 + len);
    if (name === "IHDR") { w = daten.readUInt32BE(0); h = daten.readUInt32BE(4); tiefe = daten[8]; typ = daten[9]; }
    else if (name === "IDAT") idat.push(daten);
    else if (name === "IEND") break;
    p += 12 + len;
  }
  if (tiefe !== 8 || (typ !== 2 && typ !== 6)) throw new Error("PNG-Format nicht unterstützt: Typ " + typ + ", Tiefe " + tiefe);
  const k = typ === 6 ? 4 : 3;
  const roh = zlib.inflateSync(Buffer.concat(idat));
  const zeile = w * k;
  const aus = Buffer.alloc(w * h * k);
  for (let y = 0; y < h; y++) {
    const f = roh[y * (zeile + 1)];
    const q = y * (zeile + 1) + 1;
    const o = y * zeile;
    for (let x = 0; x < zeile; x++) {
      const a = x >= k ? aus[o + x - k] : 0;
      const b = y > 0 ? aus[o - zeile + x] : 0;
      const c = x >= k && y > 0 ? aus[o - zeile + x - k] : 0;
      let v = roh[q + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c; const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      aus[o + x] = v & 255;
    }
  }
  return { w, h, k, d: aus };
}

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

// --- Messung der Seite außerhalb des Canvas --------------------------------------------------------
class Seitenmesser {
  constructor(bereiche, leinwand, vw, vh) {
    this.bereiche = bereiche.map((b) => ({ ...b, verlauf: [], richtung: 0, min: Infinity, max: -Infinity, ue: [], blitze: 0, uebergaenge: 0, sprung: 0, zellen: null, zellSprung: 0, zellWechsel: [], zellWechselMax: 0 }));
    this.leinwand = leinwand;
    this.vw = vw;
    this.vh = vh;
    this.bilder = 0;
    this.aussen = { sprung: 0, letzt: null };
    this.t0 = null;
  }
  bild(png, t) {
    const b = pngLesen(png);
    const vorherPng = this.letztesPng; this.letztesPng = png; const luecke = this.letzteZeit === undefined ? 0 : t - this.letzteZeit; this.letzteZeit = t; this.groessteLuecke = Math.max(this.groessteLuecke || 0, luecke);
    const s = b.w / this.vw;
    if (this.t0 === null) this.t0 = t;
    this.bilder++;
    const L = (x, y) => { const i = (y * b.w + x) * b.k; return 0.2126 * LIN[b.d[i]] + 0.7152 * LIN[b.d[i + 1]] + 0.0722 * LIN[b.d[i + 2]]; };
    // ganze Seite ohne Canvas
    let summe = 0, n = 0;
    const lx0 = Math.floor(this.leinwand.x * s), lx1 = Math.ceil((this.leinwand.x + this.leinwand.w) * s);
    const ly0 = Math.floor(this.leinwand.y * s), ly1 = Math.ceil((this.leinwand.y + this.leinwand.h) * s);
    for (let y = 0; y < b.h; y += 2) {
      for (let x = 0; x < b.w; x += 2) {
        if (x >= lx0 && x < lx1 && y >= ly0 && y < ly1) continue;
        summe += L(x, y); n++;
      }
    }
    const aussen = summe / Math.max(1, n);
    if (this.aussen.letzt !== null) this.aussen.sprung = Math.max(this.aussen.sprung, Math.abs(aussen - this.aussen.letzt));
    this.aussen.letzt = aussen;
    for (const r of this.bereiche) {
      const x0 = Math.max(0, Math.floor(r.x * s)), y0 = Math.max(0, Math.floor(r.y * s));
      const x1 = Math.min(b.w, Math.ceil((r.x + r.w) * s)), y1 = Math.min(b.h, Math.ceil((r.y + r.h) * s));
      if (x1 <= x0 || y1 <= y0) continue;
      const zelle = Math.max(4, Math.round(24 * s));
      const nx = Math.ceil((x1 - x0) / zelle), ny = Math.ceil((y1 - y0) / zelle);
      const zs = new Float64Array(nx * ny), zn = new Float64Array(nx * ny);
      let sm = 0, sn = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const l = L(x, y);
          sm += l; sn++;
          const zi = Math.floor((y - y0) / zelle) * nx + Math.floor((x - x0) / zelle);
          zs[zi] += l; zn[zi]++;
        }
      }
      const mittel = sm / sn;
      for (let i = 0; i < zs.length; i++) zs[i] /= Math.max(1, zn[i]);
      if (r.letzt !== undefined) r.sprung = Math.max(r.sprung, Math.abs(mittel - r.letzt));
      r.letzt = mittel;
      // Zellen: größte Änderung je Bild, Bilder mit einer Änderung über 0,02 je Sekunde, und je Zelle Übergänge nach
      // WCAG (mindestens 0,10 gegen das letzte Extrem) in einer Sekunde (Ziffern, die hochzählen)
      if (r.zellen && r.zellen.length === zs.length) {
        let wechsel = false;
        for (let i = 0; i < zs.length; i++) {
          const dd = Math.abs(zs[i] - r.zellen[i]);
          if (dd > r.zellSprung) { r.zellSprung = dd; r.zellSprungZeit = (t - this.t0); r.zellSprungLuecke = luecke; if (process.env.MAXBEREICH && r.name.includes(process.env.MAXBEREICH) && vorherPng) { fs.writeFileSync("max-vorher.png", vorherPng); fs.writeFileSync("max-nachher.png", png); } }
          if (dd > 0.02) wechsel = true;
        }
        if (wechsel) r.zellWechsel.push(t);
        while (r.zellWechsel.length && t - r.zellWechsel[0] > 1) r.zellWechsel.shift();
        r.zellWechselMax = Math.max(r.zellWechselMax, r.zellWechsel.length);
      }
      if (!r.zu || r.zu.length !== zs.length) r.zu = Array.from(zs, (l) => ({ richtung: 0, min: l, max: l, ue: [] }));
      r.zellUeMax = r.zellUeMax || 0;
      for (let i = 0; i < zs.length; i++) {
        const c = r.zu[i];
        const l = zs[i];
        let neu = false;
        if (c.richtung === 0) {
          if (l - c.min >= 0.1 && c.min < 0.8) { c.richtung = 1; c.max = l; neu = true; }
          else if (c.max - l >= 0.1 && l < 0.8) { c.richtung = -1; c.min = l; neu = true; }
          else { if (l < c.min) c.min = l; if (l > c.max) c.max = l; }
        } else if (c.richtung === 1) {
          if (l > c.max) c.max = l;
          else if (c.max - l >= 0.1 && l < 0.8) { c.richtung = -1; c.min = l; neu = true; }
        } else {
          if (l < c.min) c.min = l;
          else if (l - c.min >= 0.1 && c.min < 0.8) { c.richtung = 1; c.max = l; neu = true; }
        }
        if (neu) c.ue.push(t);
        while (c.ue.length && t - c.ue[0] > 1) c.ue.shift();
        if (c.ue.length > r.zellUeMax) r.zellUeMax = c.ue.length;
      }
      r.zellen = zs;
      // WCAG 2.3.1 auf dem Mittel der Kachel
      let neu = false;
      if (r.richtung === 0) {
        if (mittel - r.min >= 0.1 && r.min < 0.8) { r.richtung = 1; neu = true; r.max = mittel; }
        else if (r.max - mittel >= 0.1 && mittel < 0.8) { r.richtung = -1; neu = true; r.min = mittel; }
        if (!neu) { r.min = Math.min(r.min, mittel); r.max = Math.max(r.max, mittel); }
      } else if (r.richtung === 1) {
        if (mittel > r.max) r.max = mittel;
        else if (r.max - mittel >= 0.1 && mittel < 0.8) { r.richtung = -1; neu = true; r.min = mittel; }
      } else {
        if (mittel < r.min) r.min = mittel;
        else if (mittel - r.min >= 0.1 && r.min < 0.8) { r.richtung = 1; neu = true; r.max = mittel; }
      }
      if (neu) { r.uebergaenge++; r.ue.push(t); if ((r.ueListe = r.ueListe || []).length < 60) r.ueListe.push([+(t - this.t0).toFixed(3), r.richtung, +mittel.toFixed(3)]); }
      while (r.ue.length && t - r.ue[0] > 1) r.ue.shift();
      r.blitze = Math.max(r.blitze, Math.floor(r.ue.length / 2));
    }
  }
  bericht() {
    return {
      bilder: this.bilder,
      aussenSprung: this.aussen.sprung, groessteLuecke: this.groessteLuecke,
      bereiche: this.bereiche.map((r) => ({ name: r.name, flaeche: Math.round(r.w) + " × " + Math.round(r.h), sprung: r.sprung, blitze: r.blitze, uebergaenge: r.uebergaenge, zellSprung: r.zellSprung, zellSprungZeit: r.zellSprungZeit, zellSprungLuecke: r.zellSprungLuecke, zellWechselJeSekunde: r.zellWechselMax, zellUebergaengeJeSekunde: r.zellUeMax || 0, uebergangListe: r.ueListe || [] })),
    };
  }
}

async function groesse(b, h, handy) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: b, height: h, deviceScaleFactor: handy ? 2 : Number(process.env.DPR || 1), mobile: !!handy });
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: !!handy, maxTouchPoints: handy ? 5 : 1 });
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: process.env.WENIG ? "reduce" : "no-preference" }] });
}

const GROESSEN = { 1440: [1440, 900, false], 1024: [1024, 768, false], 390: [390, 844, true] };

try {
  await verbinden();
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  const [vb, vh, handy] = GROESSEN[GROESSE];
  await groesse(vb, vh, handy);
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "try { localStorage.setItem('kugelblitz.lang', " + JSON.stringify(SPRACHE) + "); localStorage.setItem('werkstatt.darstellung', " + JSON.stringify(MODI[MODUS]) + "); } catch (e) {}" });
  if (BILDRATE > 0) {
    // Feste Bildrate: requestAnimationFrame ruft höchstens alle 1000/BILDRATE ms zurück, mit genau diesem Zeitstempel
    await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      const echt = window.requestAnimationFrame.bind(window);
      const schritt = 1000 / ${BILDRATE};
      let warten = [];
      let naechster = null;
      let laeuft = false;
      function tick(t) {
        if (naechster === null) naechster = t;
        if (t + 0.5 >= naechster) {
          const stempel = naechster;
          naechster += schritt;
          if (t - naechster > 250) naechster = t + schritt;
          const liste = warten;
          warten = [];
          for (const cb of liste) { try { cb(stempel); } catch (e) { setTimeout(() => { throw e; }); } }
        }
        if (warten.length) echt(tick); else laeuft = false;
      }
      window.requestAnimationFrame = (cb) => { warten.push(cb); if (!laeuft) { laeuft = true; echt(tick); } return warten.length; };
    })();` });
  }
  if (art === "zeiten") {
    await cdp("Page.navigate", { url: BASIS + "?licht=werkzeug" });
    await warte(2200);
    const z = await js(`(async () => { const kb = window.kugelblitz, w = window.lichtpruefung.werkzeug, R = kb.regeln;
      const warte = (ms) => new Promise((r) => setTimeout(r, ms));
      kb.neuesSpiel(); await warte(400);
      R.abschuss(0.45); await warte(400); w.waechter = true;
      for (let i = 0; i < 15; i++) { w.bumper(i); await warte(80); }
      for (const n of [1, 2, 3, 1]) { w.sensor("gasse-" + n); await warte(80); }
      w.kammer(); await warte(1500);
      kb.grafik.zeitenZuruecksetzen();
      let bilder = 0; const t0 = performance.now();
      await new Promise((res) => { const f = () => { bilder++; if (performance.now() - t0 < 20000) { if (bilder % 40 === 0) w.bumper(bilder); requestAnimationFrame(f); } else res(); }; requestAnimationFrame(f); });
      const zt = kb.grafik.zeichenzeiten();
      return { ...zt, hz: bilder / ((performance.now() - t0) / 1000), kugeln: kb.tisch.kugeln.length, dpr: devicePixelRatio, leinwand: [kb.grafik.leinwand.width, kb.grafik.leinwand.height] };
    })()`);
    console.log("Zeichenzeit " + GROESSE + ": " + JSON.stringify(z));
  } else {
    const url = BASIS + (art === "licht" ? "?licht=1" : art === "modi" ? "?licht=modi" : "?licht=frei&sek=" + SEK) + (process.env.BILDER ? "&bilder=1" : "");
    await cdp("Page.navigate", { url });
    await warte(800);
    // erst messen, wenn die Schrift getauscht ist (der Tausch beim Laden ist kein Spielereignis)
    await js(`document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 300))).then(() => 1)`);
    const lage = await js(`(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
      const sicht = (b) => b.w > 0 && b.h > 0 && b.y < innerHeight && b.y + b.h > 0;
      const bereiche = [];
      for (const k of document.querySelectorAll(".kachel")) {
        if (k.id === "licht-kachel") continue;
        const b = r(k);
        if (!sicht(b)) continue;
        const h2 = k.querySelector("h2, summary");
        bereiche.push({ name: "Kachel " + (h2 ? h2.textContent.trim() : "?"), ...b });
      }
      for (const [sel, name] of [[".kopfleiste", "Kopfleiste"], [".knopf-leiste", "Knopfleiste"]]) {
        const el = document.querySelector(sel);
        if (el) { const b = r(el); if (sicht(b)) bereiche.push({ name, ...b }); }
      }
      return { bereiche, leinwand: r(document.getElementById("leinwand")), vw: innerWidth, vh: innerHeight };
    })()`);
    const messer = new Seitenmesser(lage.bereiche, lage.leinwand, lage.vw, lage.vh);
    // Verschiebungen der Kacheln (Zeilenumbruch ändert die Höhe einer Kachel, die darunter rutschen nach)
    await js(`(() => {
      const t0 = performance.now();
      window.__verschiebungen = [];
      const kacheln = [...document.querySelectorAll(".kachel")];
      let alt = kacheln.map((k) => Math.round(k.getBoundingClientRect().top));
      const f = () => {
        const neu = kacheln.map((k) => Math.round(k.getBoundingClientRect().top));
        neu.forEach((y, i) => { if (y !== alt[i] && window.__verschiebungen.length < 200) window.__verschiebungen.push({ t: +((performance.now() - t0) / 1000).toFixed(2), kachel: (kacheln[i].querySelector("h2, summary") || {}).textContent, um: y - alt[i], phase: window.kugelblitz.z.phase }); });
        alt = neu;
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
      return 1;
    })()`);
    let rahmen = 0;
    ereignisHoerer.push((d) => {
      if (d.method !== "Page.screencastFrame") return;
      cdp("Page.screencastFrameAck", { sessionId: d.params.sessionId }).catch(() => {});
      try { messer.bild(Buffer.from(d.params.data, "base64"), d.params.metadata.timestamp); rahmen++; } catch (e) { meldungen.push("Bild: " + e.message); }
    });
    await cdp("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: Math.round(vb * (handy ? 1 : 0.5)), maxHeight: Math.round(vh * (handy ? 1 : 0.5)) });
    let bericht = null;
    const grenze = art === "licht" ? 140 : art === "modi" ? 90 : SEK + 60;
    for (let i = 0; i < grenze && !bericht; i++) {
      await warte(1000);
      bericht = await js("window.lichtBericht || null");
      if (process.env.DEBUG && i % 5 === 0) console.log("  Stand", i, await js(`(() => { const kb = window.kugelblitz; return [kb.z.phase, kb.spiel.uhr.toFixed(1), kb.z.punkte, kb.spiel.pause, !!window.lichtpruefung, document.getElementById("licht-status").textContent].join(" | "); })()`));
    }
    await cdp("Page.stopScreencast");
    const verschiebungen = await js("window.__verschiebungen || []");
    // BILDER=1: Bilder des Canvas zu den ersten Übergängen ab 0,10 neben die Ausgabe legen (zum Nachsehen)
    if (process.env.BILDER && ausgabeDatei) {
      const bilder = await js("window.lichtBilder || []");
      bilder.forEach((b, i) => fs.writeFileSync(ausgabeDatei.replace(/\.json$/, "") + "-uebergang-" + i + "-" + b.t + "s.png", Buffer.from(b.bild.split(",")[1], "base64")));
    }
    console.log("Verschiebungen von Kacheln: " + verschiebungen.length + (verschiebungen.length ? "\n  " + verschiebungen.slice(0, 30).map((v) => v.t + " s " + v.kachel + " um " + v.um + " px (" + v.phase + ")").join("\n  ") : ""));
    const seite = messer.bericht();
    const ergebnis = { groesse: GROESSE, art, modus: MODUS, seite, bericht, verschiebungen, konsole: meldungen };
    console.log("L-Meter " + GROESSE + " (" + art + ", Darstellung " + (await js("window.kugelblitz.darstellung")) + ", Sprache " + (await js("document.documentElement.lang")) + ", " + (BILDRATE > 0 ? BILDRATE + " Hz fest" : "Bildrate des Rechners") + "):\n" + (bericht ? bericht.text : "kein Ergebnis"));
    console.log("Seite außerhalb des Canvas: " + seite.bilder + " Bilder (" + (seite.bilder / (art === "licht" ? 47 : art === "modi" ? 30 : SEK)).toFixed(1) + " je s), größter Sprung der mittleren Leuchtdichte " + seite.aussenSprung.toFixed(4));
    for (const r of seite.bereiche) console.log("  " + r.name.padEnd(28) + " " + r.flaeche.padEnd(10) + " Sprung " + r.sprung.toFixed(4) + ", Blitze " + r.blitze + ", Übergänge " + r.uebergaenge + ", Zelle höchstens " + r.zellSprung.toFixed(4) + " (bei " + (r.zellSprungZeit ?? 0).toFixed(1) + " s, Bildabstand " + Math.round((r.zellSprungLuecke ?? 0) * 1000) + " ms), Bilder mit Zellwechsel je s " + r.zellWechselJeSekunde + ", Zell-Übergänge je s " + r.zellUebergaengeJeSekunde);
    if (bericht && bericht.verzug) console.log("Verzug: " + JSON.stringify(bericht.verzug));
    if (ausgabeDatei) fs.writeFileSync(ausgabeDatei, JSON.stringify(ergebnis, null, 1));
  }
  console.log("Konsole:", meldungen.length ? "\n  " + meldungen.join("\n  ") : "keine Fehler, keine Warnungen");
} catch (e) {
  console.error("Fehler:", e.message);
  process.exitCode = 1;
} finally {
  try { await Promise.race([cdp("Browser.close"), warte(3000)]); } catch { /* schon zu */ }
  await warte(500);
  try { edge.kill(); } catch { /* egal */ }
  process.exit(process.exitCode || 0);
}
