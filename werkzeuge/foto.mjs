// Bildschirmfotos und Bedienprüfung für Kugelblitz über Edge headless und das DevTools-Protokoll.
//   node foto.mjs <zielordner> [szene ...]    Szenen: start spiel multiball ende pruefen
//   Größen: 1440x900, 1024x768, 390x844 (Handy, Pixeldichte 2, Touch); GROESSE=320 nur 320x640 (Handy)
//   SPRACHE=en (oder eine Liste: SPRACHE=de,en,ja,ru): Sprache des Spiels, die Dateinamen bekommen das Kürzel
//   angehängt (start-1440-ja.png). Ohne SPRACHE: Deutsch, Dateinamen wie bisher.
//   MODUS=hc-dark (oder eine Liste: MODUS=normal,hc-dark,hc-light,cvd,invert): Darstellung der Werkstatt
//   (werkstatt.darstellung, Abschnitt 7), die Dateinamen bekommen den Modus angehängt (start-1440-hc-dark.png).
//   FORMAT=webp: Fotos als WebP statt PNG (Qualität QUALITAET, Vorgabe 86), so entstehen die Bilder in docs/.
//   BASIS=https://…/index.html: eine andere Adresse als die Vorschau auf Port 8643, etwa die veröffentlichte Seite.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9335;
const BASIS = process.env.BASIS || "http://127.0.0.1:8643/index.html";
const FORMAT = process.env.FORMAT === "webp" ? "webp" : "png";
const hier = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const ziel = process.argv[2];
const nurSzenen = process.argv.slice(3);
const nurGroesse = process.env.GROESSE || "";
const SPRACHEN = (process.env.SPRACHE || "").split(",").map((x) => x.trim()).filter(Boolean);
// Darstellung: Kurzname → gespeicherter Wert der Werkstatt (Farbenblind wie auf einem dunklen Gerät)
const MODI = { normal: "system", "hc-dark": "hc-dark", "hc-light": "hc-light", cvd: "cvd-dark", invert: "invert" };
const MODI_LISTE = (process.env.MODUS || "").split(",").map((x) => x.trim()).filter(Boolean);
for (const m of MODI_LISTE) if (!MODI[m]) { console.error("MODUS unbekannt: " + m + " (normal, hc-dark, hc-light, cvd, invert)"); process.exit(1); }
let sprachEndung = "";
fs.mkdirSync(ziel, { recursive: true });
const profil = path.join(os.tmpdir(), "kugelblitz-edge-foto");
fs.rmSync(profil, { recursive: true, force: true });

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profil,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--force-color-profile=srgb",
  "--window-size=1440,900", ...(process.env.OHNE_GPU ? ["--disable-gpu"] : []), "about:blank"], { stdio: "ignore" });

let ws;
let nr = 0;
const offen = new Map();
const meldungen = [];
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
async function groesse(b, h, handy) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: b, height: h, deviceScaleFactor: handy ? 2 : Number(process.env.DPR || 1), mobile: !!handy });
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: !!handy, maxTouchPoints: handy ? 5 : 1 });
  // Edge headless meldet „weniger Bewegung“; für die Fotos gilt die Einstellung eines normalen Rechners
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: process.env.WENIG ? "reduce" : "no-preference" }] });
}
async function laden(url) {
  await cdp("Page.navigate", { url });
  await warte(2200);
}
async function foto(datei) {
  const r = await cdp("Page.captureScreenshot", FORMAT === "webp" ? { format: "webp", quality: Number(process.env.QUALITAET || 86) } : { format: "png" });
  const name = datei.replace(/\.png$/, sprachEndung + "." + FORMAT);
  fs.writeFileSync(path.join(ziel, name), Buffer.from(r.data, "base64"));
  console.log("Foto", name);
}

// Szenen im Browser: nutzen window.kugelblitz und die Werkzeuge der Lichtprüfung (?licht=werkzeug)
const VORSPANN = `const kb = window.kugelblitz, w = window.lichtpruefung.werkzeug, R = kb.regeln;
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));`;
const SZENEN = {
  start: `(async () => { ${VORSPANN} await warte(300); return kb.z.phase; })()`,
  spiel: `(async () => { ${VORSPANN}
    kb.neuesSpiel(); await warte(500);
    R.abschuss(0.45); await warte(500); w.waechter = true;
    for (let i = 0; i < 15; i++) { w.bumper(i); await warte(90); }
    for (const n of [1, 2, 3, 1, 2, 3, 1, 3]) { w.sensor("gasse-" + n); await warte(90); }
    w.wand("standup-1"); await warte(90); w.wand("standup-3"); await warte(90);
    w.wand("fallziel-2"); await warte(2600);
    return kb.z.phase + " " + kb.z.multiplikator + " " + kb.z.rang.schluessel + " fz " + JSON.stringify(kb.tisch.waehle("fallziel").map((x) => x.aktiv)) + " " + JSON.stringify([...kb.grafik.fallziele.values()]) + " banken " + kb.z.banken + " lampen " + JSON.stringify(kb.grafik.lampen.filter((l) => l.id.startsWith("fallziel")).map((l) => +l.wert.toFixed(2)));
  })()`,
  multiball: `(async () => { ${VORSPANN}
    kb.neuesSpiel(); await warte(500);
    R.abschuss(0.45); await warte(500); w.waechter = true;
    for (let i = 0; i < 15; i++) { w.bumper(i); await warte(80); }
    w.kammer(); await warte(300);
    for (const n of [1, 2, 3]) { w.sensor("gasse-" + n); await warte(90); }
    w.kammer(); await warte(300);
    for (const n of [1, 2, 3]) { w.wand("fallziel-" + n); await warte(90); }
    await warte(1600);
    for (const n of [1, 2, 3]) { w.wand("fallziel-" + n); await warte(90); }
    await warte(500);
    w.kammer(); await warte(1700);
    w.kammer(); await warte(1300);
    return kb.z.multiball.aktiv + " " + kb.tisch.kugeln.length + " " + kb.z.rang.schluessel;
  })()`,
  // Zeichenzeit im laufenden Spiel: Kugeln im Feld, Lichter an, 20 s messen, Bildrate dazu
  zeiten: `(async () => { ${VORSPANN}
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
  })()`,
  schein: `(async () => { ${VORSPANN}
    kb.neuesSpiel(); await warte(500);
    R.abschuss(0.45); await warte(2500);
    w.bumper(0); await warte(700); w.bumper(2); w.wand("standup-2"); await warte(140);
    return "schein";
  })()`,
  ende: `(async () => { ${VORSPANN}
    kb.neuesSpiel(); await warte(500);
    R.abschuss(0.45); await warte(500); w.waechter = true;
    for (let i = 0; i < 15; i++) { w.bumper(i); await warte(60); }
    for (const n of [1, 2, 3]) { w.sensor("gasse-" + n); await warte(60); }
    w.wand("standup-1"); w.wand("standup-2"); await warte(400);
    w.waechter = false;
    for (let runde = 0; runde < 40 && kb.z.phase !== "ende"; runde++) {
      if (kb.z.phase === "spiel" || kb.z.phase === "bereit") w.alleAblassen();
      if (kb.z.phase === "bonus") R.ueberspringeBonus();
      await warte(350);
    }
    await warte(1200);
    return kb.z.phase + " " + kb.z.punkte + " Platz " + kb.z.neuerPlatz;
  })()`,
};

// Bedienprüfung: Tasten und Finger über echte Eingabe-Ereignisse des Protokolls
async function taste(code, key, art) {
  await cdp("Input.dispatchKeyEvent", { type: art, code, key, windowsVirtualKeyCode: ({ ShiftLeft: 16, ShiftRight: 16, Space: 32, KeyX: 88, KeyP: 80, Enter: 13, KeyB: 66, KeyT: 84 })[code] || 0 });
}
async function finger(art, punkte) {
  await cdp("Input.dispatchTouchEvent", { type: art, touchPoints: punkte.map(([x, y], i) => ({ x, y, id: i + 1 })) });
}
async function pruefen(handy) {
  const ergebnis = [];
  const z = (code) => js(code);
  await js(`window.kugelblitz.neuesSpiel(), 1`);
  await warte(400);
  if (!handy) {
    await taste("ShiftLeft", "Shift", "keyDown");
    await warte(80);
    ergebnis.push("Taste Shift links hält Flipper: " + await z(`window.kugelblitz.tisch.flipper[0].gedrueckt`));
    await taste("ShiftLeft", "Shift", "keyUp");
    await warte(80);
    ergebnis.push("losgelassen: " + !(await z(`window.kugelblitz.tisch.flipper[0].gedrueckt`)));
    await taste("Space", " ", "keyDown");
    await warte(700);
    const ladung = await z(`window.kugelblitz.z.ladung`);
    await taste("Space", " ", "keyUp");
    await warte(900);
    ergebnis.push("Leertaste lädt (" + ladung.toFixed(2) + ") und schießt ab: " + await z(`window.kugelblitz.z.phase`));
    await taste("KeyX", "x", "keyDown"); await taste("KeyX", "x", "keyUp");
    await warte(60);
    ergebnis.push("X schubst: Warnung " + (await z(`window.kugelblitz.z.warnung`)).toFixed(2));
    await taste("KeyP", "p", "keyDown"); await taste("KeyP", "p", "keyUp");
    await warte(300);
    ergebnis.push("P pausiert: " + await z(`window.kugelblitz.spiel.pause`));
    await taste("KeyP", "p", "keyDown"); await taste("KeyP", "p", "keyUp");
    await warte(100);
    ergebnis.push("P weiter: " + !(await z(`window.kugelblitz.spiel.pause`)));
    return ergebnis;
  }
  // Handy: Lage der Leinwand
  const r = await z(`(() => { const b = document.getElementById("leinwand").getBoundingClientRect(); return { x: b.left, y: b.top, b: b.width, h: b.height }; })()`);
  const mitteY = r.y + r.h * 0.7;
  await finger("touchStart", [[r.x + r.b * 0.25, mitteY]]);
  await warte(80);
  ergebnis.push("Finger links hält linken Flipper: " + await z(`window.kugelblitz.tisch.flipper[0].gedrueckt && !window.kugelblitz.tisch.flipper[1].gedrueckt`));
  await finger("touchEnd", []);
  await warte(60);
  await finger("touchStart", [[r.x + r.b * 0.7, mitteY]]);
  await warte(80);
  ergebnis.push("Finger rechts hält rechten Flipper: " + await z(`window.kugelblitz.tisch.flipper[1].gedrueckt && !window.kugelblitz.tisch.flipper[0].gedrueckt`));
  await finger("touchEnd", []);
  await warte(60);
  await finger("touchStart", [[r.x + r.b * 0.2, mitteY], [r.x + r.b * 0.8, mitteY]]);
  await warte(80);
  ergebnis.push("zwei Finger, beide Flipper: " + await z(`window.kugelblitz.tisch.flipper[0].gedrueckt && window.kugelblitz.tisch.flipper[1].gedrueckt`));
  await finger("touchEnd", []);
  await warte(60);
  // Abschuss per Ziehen: an der Rampe ansetzen, nach unten ziehen, loslassen
  const rampeX = r.x + r.b * 0.94;
  const startY = r.y + r.h * 0.55;
  await finger("touchStart", [[rampeX, startY]]);
  for (let i = 1; i <= 8; i++) { await finger("touchMove", [[rampeX, startY + i * 10]]); await warte(20); }
  const zug = await z(`window.kugelblitz.spiel.zug`);
  await finger("touchEnd", []);
  await warte(900);
  ergebnis.push("Ziehen an der Rampe (Ladung " + (zug ?? 0).toFixed(2) + ") schießt ab: " + await z(`window.kugelblitz.z.phase`));
  // Schubsen über den Knopf
  const k = await z(`(() => { const b = document.getElementById("schubs-hoch").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, sichtbar: b.width > 0 }; })()`);
  await finger("touchStart", [[k.x, k.y]]);
  await finger("touchEnd", []);
  await warte(120);
  ergebnis.push("Knopf Schubs ↑ sichtbar " + k.sichtbar + ", Warnung " + (await z(`window.kugelblitz.z.warnung`)).toFixed(2));
  // Halten an der Rampe: neues Spiel, dann halten und loslassen
  await js(`window.kugelblitz.neuesSpiel(), 1`);
  await warte(300);
  await finger("touchStart", [[rampeX, startY]]);
  await warte(700);
  const ladung = await z(`window.kugelblitz.z.ladung`);
  await finger("touchEnd", []);
  await warte(900);
  ergebnis.push("Halten an der Rampe (Ladung " + ladung.toFixed(2) + ") schießt ab: " + await z(`window.kugelblitz.z.phase`));
  const p = await z(`(() => { const b = document.getElementById("knopf-pause").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await finger("touchStart", [[p.x, p.y]]);
  await finger("touchEnd", []);
  await warte(200);
  ergebnis.push("Knopf Pause: " + await z(`window.kugelblitz.spiel.pause`));
  return ergebnis;
}

const GROESSEN = [
  { name: "1440", b: 1440, h: 900, handy: false },
  { name: "1024", b: 1024, h: 768, handy: false },
  { name: "390", b: 390, h: 844, handy: true },
  { name: "320", b: 320, h: 640, handy: true, nurAufWunsch: true },
];

try {
  await verbinden();
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  // Die Sprache setzt ein Skript vor jedem Seitenaufbau in den Speicher, den auch das Auswahlfeld benutzt
  for (const modus of MODI_LISTE.length ? MODI_LISTE : [""]) {
  for (const code of SPRACHEN.length ? SPRACHEN : ["de"]) {
  sprachEndung = (SPRACHEN.length ? "-" + code : "") + (modus ? "-" + modus : "");
  const vorher = "try { localStorage.setItem('kugelblitz.lang', " + JSON.stringify(code) + "); " +
    (modus ? "localStorage.setItem('werkstatt.darstellung', " + JSON.stringify(MODI[modus]) + "); " : "") + "} catch (e) {}";
  const { identifier } = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: vorher });
  for (const g of GROESSEN) {
    if (nurGroesse && g.name !== nurGroesse) continue;
    if (g.nurAufWunsch && nurGroesse !== g.name) continue;
    await groesse(g.b, g.h, g.handy);
    for (const szene of ["start", "spiel", "multiball", "ende", "schein", "pruefen", "diverses", "licht", "zeiten"]) {
      if (nurSzenen.length && !nurSzenen.includes(szene)) continue;
      if (szene === "licht" || szene === "zeiten") {
        if (!nurSzenen.includes(szene)) continue;
        if (szene === "licht") {
          await laden(BASIS + "?licht=1");
          let bericht = null;
          for (let i = 0; i < 120 && !bericht; i++) { await warte(1000); bericht = await js("window.lichtBericht || null"); }
          console.log("L-Meter " + g.name + ": " + (bericht ? bericht.text + " | " + JSON.stringify(bericht) : "kein Ergebnis"));
          await foto("licht-" + g.name + ".png");
        } else {
          await laden(BASIS + "?licht=werkzeug");
          const z = await js(SZENEN.zeiten);
          console.log("Zeichenzeit " + g.name + ": " + JSON.stringify(z));
        }
        continue;
      }
      await laden(BASIS + "?licht=werkzeug");
      if (szene === "diverses") {
        const e = [];
        await js(`window.kugelblitz.neuesSpiel(), window.kugelblitz.regeln.abschuss(0.5), 1`);
        await warte(900);
        await taste("KeyP", "p", "keyDown"); await taste("KeyP", "p", "keyUp");
        await warte(700);
        e.push("Pause: " + await js(`window.kugelblitz.spiel.pause`));
        await foto("pause-" + g.name + ".png");
        await taste("KeyP", "p", "keyDown"); await taste("KeyP", "p", "keyUp");
        await laden(BASIS);
        await taste("KeyB", "b", "keyDown"); await taste("KeyB", "b", "keyUp");
        await warte(1500);
        e.push("Probesalve: " + await js(`window.kugelblitz.spiel.probenGesamt + " Kugeln, " + window.kugelblitz.spiel.probenDurch + " durch"`));
        await taste("KeyT", "t", "keyDown"); await taste("KeyT", "t", "keyUp");
        await warte(400);
        e.push("T: " + await js(`window.kugelblitz.tisch.modus`));
        await foto("vorfuehrung-" + g.name + ".png");
        await taste("KeyB", "b", "keyDown"); await taste("KeyB", "b", "keyUp");
        await warte(2600);
        e.push("Probesalve Einzelschritt: " + await js(`window.kugelblitz.spiel.probenGesamt + " Kugeln, " + window.kugelblitz.spiel.probenDurch + " durch"`));
        await foto("einzelschritt-" + g.name + ".png");
        // Einstellungen: weniger Bewegung an, Lichtstärke 50 %, nach dem Neuladen noch da
        await js(`(() => { const r = document.querySelector('input[name="bewegung"][value="an"]'); r.checked = true; r.dispatchEvent(new Event("change")); const s = document.getElementById("lichtstaerke"); s.value = "50"; s.dispatchEvent(new Event("input")); return 1; })()`);
        await warte(300);
        e.push("weniger Bewegung: " + await js(`document.documentElement.dataset.bewegung + ", Grafik " + window.kugelblitz.grafik.wenigBewegung + ", Aurora " + getComputedStyle(document.querySelector(".au-1")).animationPlayState + ", Licht " + window.kugelblitz.grafik.lichtstaerke`));
        await laden(BASIS);
        e.push("nach Neuladen: " + await js(`document.querySelector('input[name="bewegung"]:checked').value + ", " + document.getElementById("lichtstaerke").value + " %, Grafik " + window.kugelblitz.grafik.wenigBewegung + " " + window.kugelblitz.grafik.lichtstaerke`));
        await js(`(() => { const r = document.querySelector('input[name="bewegung"][value="system"]'); r.checked = true; r.dispatchEvent(new Event("change")); const s = document.getElementById("lichtstaerke"); s.value = "70"; s.dispatchEvent(new Event("input")); return 1; })()`);
        e.push("zurück: " + await js(`document.documentElement.dataset.bewegung + ", Aurora " + getComputedStyle(document.querySelector(".au-1")).animationPlayState`));
        console.log("Diverses " + g.name + ": " + e.join(" | "));
        continue;
      }
      if (szene === "pruefen") {
        const e = await pruefen(g.handy);
        console.log("Bedienung " + g.name + ":\n  " + e.join("\n  "));
        continue;
      }
      const antwort = await js(SZENEN[szene]);
      const mass = await js(`({ breit: document.documentElement.scrollWidth, sicht: document.documentElement.clientWidth, hoch: document.documentElement.scrollHeight, lang: document.documentElement.lang })`);
      console.log(g.name, mass.lang, modus || "", szene, "->", antwort, "| Breite", mass.breit, "von", mass.sicht, mass.breit > mass.sicht ? "ÜBERLAUF" : "ok");
      await foto(szene + "-" + g.name + ".png");
    }
  }
  await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  }
  }
  console.log("Konsole:", meldungen.length ? "\n  " + meldungen.join("\n  ") : "keine Fehler, keine Warnungen");
} catch (e) {
  console.error("Fehler:", e.message);
  process.exitCode = 1;
} finally {
  try { await cdp("Browser.close"); } catch { /* schon zu */ }
  await warte(500);
  try { edge.kill(); } catch { /* egal */ }
}
