
import { createGame, CLASSES, SAVE_KEY, SETTINGS_KEY, ABILITY_NAMES, ABILITY_SHORT } from "./engine.js";

const $ = (id) => document.getElementById(id);

const settings = { muted: false };
try {
  const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
  if (raw && typeof raw === "object") settings.muted = !!raw.muted;
} catch (e) {}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ muted: settings.muted })); } catch (e) {}
}

const audio = { ctx: null, muted: settings.muted };
function ac() {
  if (!audio.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio.ctx = new AC();
  }
  if (audio.ctx.state === "suspended") audio.ctx.resume();
  return audio.ctx;
}
function toneAt(c, freq, dur, type, gain, at, slide) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), at + dur);
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}
function beep(kind) {
  if (audio.muted) return;
  const c = ac();
  if (!c) return;
  const now = c.currentTime;
  const tone = (freq, dur, type, gain, at, slide) => toneAt(c, freq, dur, type, gain, at, slide);
  if (kind === "click") tone(420, 0.05, "sine", 0.04, now);
  else if (kind === "dice") {
    tone(180, 0.05, "square", 0.03, now);
    tone(260, 0.06, "triangle", 0.03, now + 0.04);
    tone(140, 0.08, "square", 0.025, now + 0.08);
  }
  else if (kind === "crit") [523, 659, 784].forEach((f, i) => tone(f, 0.14, "triangle", 0.06, now + i * 0.07));
  else if (kind === "fumble") tone(180, 0.22, "sawtooth", 0.05, now, 70);
  else if (kind === "hit") tone(160, 0.1, "square", 0.05, now, 90);
  else if (kind === "hurt") tone(220, 0.16, "sawtooth", 0.05, now, 80);
  else if (kind === "good") { tone(392, 0.1, "triangle", 0.05, now); tone(523, 0.14, "triangle", 0.05, now + 0.08); }
  else if (kind === "level") [392, 494, 587, 784].forEach((f, i) => tone(f, 0.16, "triangle", 0.06, now + i * 0.1));
  else if (kind === "win") [392, 523, 659, 784].forEach((f, i) => tone(f, 0.22, "triangle", 0.07, now + i * 0.12));
  else if (kind === "lose") { tone(300, 0.2, "sawtooth", 0.05, now, 140); tone(140, 0.35, "sawtooth", 0.05, now + 0.15, 60); }
  else if (kind === "dragon") tone(90, 0.5, "sawtooth", 0.045, now, 50);
}

function syncMute() {
  $("icon-on").hidden = audio.muted;
  $("icon-off").hidden = !audio.muted;
  $("btn-mute").setAttribute("aria-pressed", audio.muted ? "true" : "false");
  $("btn-mute").setAttribute("aria-label", audio.muted ? "Uključi zvuk" : "Utišaj zvuk");
}

let game = null;
let busy = false;
let screen = "title";

function hasSave() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
    if (!raw || !raw.hero) return false;
    const probe = createGame();
    if (!probe.restore(raw)) {
      clearSave();
      return false;
    }
    return true;
  } catch (e) {
    clearSave();
    return false;
  }
}

function persist() {
  if (!game) return;
  try {
    const data = game.serialize();
    if (data.ending === "victory") localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) {}
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}

function show(id) {
  ["screen-title", "screen-create", "screen-play"].forEach((s) => {
    $(s).hidden = s !== id;
  });
  $("btn-sheet").hidden = id !== "screen-play";
  screen = id.replace("screen-", "");
}

function signed(n) { return n >= 0 ? "+" + n : String(n); }

function renderTitle() {
  show("screen-title");
  $("btn-continue").hidden = !hasSave();
  $("btn-new").className = hasSave() ? "btn" : "btn primary";
}

function classCard(cls) {
  const mods = Object.keys(ABILITY_SHORT).map((k) => {
    return '<span class="mod">' + ABILITY_SHORT[k] + " " + signed(cls.mods[k]) + "</span>";
  }).join("");
  const hp = cls.baseHp + cls.mods.con;
  let ac;
  if (cls.id === "ratnik") ac = 16;
  else if (cls.id === "carobnjak") ac = 13 + cls.mods.dex;
  else ac = 12 + cls.mods.dex;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pick";
  btn.innerHTML = "<h3>" + cls.name + "</h3><p class='blurb'>" + cls.blurb + "</p><p class='stats'>Život " + hp + " · KO " + ac + " · " + cls.weapon.name + " k" + cls.weapon.die + "<br>" + cls.detail + "</p><div class='mods'>" + mods + "</div>";
  btn.addEventListener("click", () => startAdventure(cls.id));
  return btn;
}

function renderCreate() {
  show("screen-create");
  const box = $("class-picks");
  box.innerHTML = "";
  Object.keys(CLASSES).forEach((id) => box.appendChild(classCard(CLASSES[id])));
}

function renderLog(view) {
  const box = $("log");
  box.innerHTML = view.log.map((l) => '<p class="' + (l.kind || "") + '">' + l.text + "</p>").join("");
  box.scrollTop = box.scrollHeight;
}

function renderHud(view) {
  const h = view.hero;
  if (!h) return;
  $("hud-name").textContent = h.name;
  $("hud-class").textContent = h.className + (h.weapon ? " · " + h.weapon.name : "");
  $("hud-level").textContent = "Nivo " + h.level;
  $("hud-ac").textContent = "KO " + h.ac;
  $("hud-gold").textContent = h.gold + " zlata";
  $("hud-hp").textContent = h.hp + "/" + h.hpMax;
  $("hp-fill").style.width = Math.max(0, (h.hp / h.hpMax) * 100) + "%";
  if (h.xpNext) {
    const prev = h.level === 1 ? 0 : (h.level === 2 ? 300 : 0);
    const span = h.xpNext - prev;
    $("xp-fill").style.width = Math.min(100, Math.max(0, ((h.xp - prev) / span) * 100)) + "%";
    $("hud-xp").textContent = h.xp + "/" + h.xpNext;
  } else {
    $("xp-fill").style.width = "100%";
    $("hud-xp").textContent = "Nivo 3";
  }
}

function renderFoes(view) {
  const box = $("foes");
  if (!view.inCombat || !view.enemies.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = view.enemies.map((e) => {
    const pct = Math.max(0, (e.hp / e.hpMax) * 100);
    return '<div class="foe' + (e.alive ? "" : " down") + '"><div class="row"><span>' + e.name + (e.alive ? "" : " (pao)") + '</span><span>KO ' + e.ac + ' · ' + Math.max(0, e.hp) + '/' + e.hpMax + '</span></div><div class="bar hp"><div style="width:' + pct + '%"></div></div></div>';
  }).join("");
}

function renderActions(view) {
  const box = $("actions");
  box.innerHTML = "";
  if (view.ending === "victory" || view.ending === "defeat") return;
  const list = view.inCombat && view.playerTurn ? view.combatActions : (view.inCombat ? [] : view.choices);
  list.forEach((a, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn" + (i === 0 && !view.inCombat ? " primary wide" : (list.length === 1 ? " primary wide" : ""));
    if (a.id === "attack" || a.id === "fight_dragon" || a.id === "fight_orc" || a.id === "fight_skel") b.className = "btn primary wide";
    b.innerHTML = a.label + (a.hint ? "<small>" + a.hint + "</small>" : "");
    b.disabled = !!a.disabled;
    if (a.disabled && a.why) b.title = a.why;
    b.addEventListener("click", () => onAction(a.id, view));
    box.appendChild(b);
  });
}

async function animateRolls(rolls) {
  if (!rolls || !rolls.length) return;
  const die = $("die");
  const num = $("die-num");
  const lbl = $("die-lbl");
  const cap = $("die-caption");
  for (let i = 0; i < rolls.length; i++) {
    const r = rolls[i];
    die.className = "die on spin";
    lbl.textContent = "k" + r.sides;
    cap.textContent = r.label || "";
    beep("dice");
    const spins = r.sides === 20 ? 8 : 5;
    for (let s = 0; s < spins; s++) {
      num.textContent = 1 + Math.floor(Math.random() * r.sides);
      await sleep(r.sides === 20 ? 50 : 36);
    }
    num.textContent = r.value;
    const isCrit = r.sides === 20 && r.value === 20;
    const isFail = r.sides === 20 && r.value === 1;
    die.className = "die on land" + (isCrit ? " crit" : "") + (isFail ? " fail" : "");
    if (isCrit) beep("crit");
    else if (isFail) beep("fumble");
    cap.textContent = r.label + ": " + r.value;
    await sleep(260);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function renderPlay(view, { skipDice } = {}) {
  show("screen-play");
  $("scene-place").textContent = view.location || "";
  $("scene-title").textContent = view.title || "";
  $("scene-text").textContent = view.text || "";
  $("scene-art").dataset.art = view.art || "tavern";
  renderHud(view);
  renderFoes(view);
  renderLog(view);
  renderActions(view);
  if (!skipDice && (!view.rolls || !view.rolls.length)) {
    $("die").className = "die";
    $("die-caption").textContent = view.inCombat ? (view.playerTurn ? "Tvoj potez" : "Čeka se...") : "Kocka čeka tvoj potez";
  }
}

function renderSheet(view) {
  const h = view.hero;
  if (!h) return;
  const mods = Object.keys(ABILITY_NAMES).map((k) => {
    return '<div class="sheet-stat"><b>' + signed(h.mods[k]) + '</b><span>' + ABILITY_NAMES[k] + '<br>spas ' + signed(h.saves[k]) + '</span></div>';
  }).join("");
  let extra = "<p class='inv'><b>Oružje:</b> " + h.weapon.name + " (k" + h.weapon.die + " " + signed(h.mods[h.weapon.able]) + ")</p>";
  extra += "<p class='inv'><b>Napitci:</b> " + h.potions + " · <b>Zlato:</b> " + h.gold + "</p>";
  if (h.slots) {
    const s1 = h.slots[1].max - h.slots[1].used;
    const s2 = h.slots[2].max - h.slots[2].used;
    extra += "<p class='inv'><b>Okviri čarolija:</b> 1. stepen " + s1 + "/" + h.slots[1].max;
    if (h.slots[2].max) extra += " · 2. stepen " + s2 + "/" + h.slots[2].max;
    extra += "<br>Napad čarolijom " + signed(h.spellAtk) + " · teškoća spasa " + h.spellDC + "</p>";
  }
  if (h.classId === "lopov") extra += "<p class='inv'><b>Udarac iz senke:</b> +" + h.sneakDice + "k6</p>";
  if (h.inventory.length) {
    extra += "<p class='inv'><b>Stvari:</b><br>" + h.inventory.map((i) => i.name + " — " + i.desc).join("<br>") + "</p>";
  }
  const flags = [];
  if (h.flags.fireResist) flags.push("otpornost na vatru");
  if (h.flags.bless) flags.push("blagoslov (+1 na spasove)");
  if (h.flags.curse) flags.push("kletva (−1 na spasove)");
  if (h.flags.mageArmor) flags.push("magični oklop");
  if (flags.length) extra += "<p class='inv'><b>Stanje:</b> " + flags.join(", ") + "</p>";
  $("sheet-body").innerHTML = "<div class='sheet-grid'>" + mods + "</div>" + extra;
}

function openOverlay(id) {
  closeOverlays();
  $(id).hidden = false;
}

function openSheet() {
  if (!game) return;
  renderSheet(game.getView());
  openOverlay("overlay-sheet");
}

function closeOverlays() {
  $("overlay-sheet").hidden = true;
  $("overlay-level").hidden = true;
  $("overlay-react").hidden = true;
  $("overlay-end").hidden = true;
}

function presentSpecial(view) {
  if (view.levelUp) {
    $("lvl-title").textContent = "Nivo " + view.levelUp.level;
    $("lvl-body").innerHTML = view.levelUp.lines.map((l) => "<p class='inv'>" + l + "</p>").join("");
    openOverlay("overlay-level");
    beep("level");
    return true;
  }
  if (view.reaction) {
    $("react-text").textContent = view.reaction.text || "Napad te pogađa. Hoćeš li da upotrebiš Štit?";
    openOverlay("overlay-react");
    return true;
  }
  if (view.ending === "victory") {
    $("end-title").textContent = "Pobeda";
    $("end-text").textContent = view.text;
    $("btn-retry").hidden = true;
    openOverlay("overlay-end");
    clearSave();
    beep("win");
    return true;
  }
  if (view.ending === "defeat") {
    $("end-title").textContent = "Pad";
    $("end-text").textContent = view.text;
    $("btn-retry").hidden = !(game && typeof game.canRetryCombat === "function" && game.canRetryCombat());
    openOverlay("overlay-end");
    beep("lose");
    return true;
  }
  closeOverlays();
  return false;
}

async function afterAction(prevHp) {
  const view = game.getView();
  if (view.art === "dragon" && view.inCombat && view.round === 1) beep("dragon");
  if (view.rolls && view.rolls.length) await animateRolls(view.rolls);
  const now = game.getView();
  renderPlay(now, { skipDice: true });
  if (prevHp != null && now.hero && now.hero.hp < prevHp) beep("hurt");
  else if (now.log.some((l) => /pada\./.test(l.text) || l.kind === "good")) beep("good");
  persist();
  presentSpecial(now);
}

async function onAction(id, view) {
  if (busy || !game) return;
  busy = true;
  beep("click");
  ac();
  const hp = view.hero ? view.hero.hp : 0;
  try {
    if (id === "new_game") {
      newAdventure();
      return;
    }
    if (view.inCombat && view.playerTurn) game.combat(id);
    else game.choose(id);
    await afterAction(hp);
  } finally {
    busy = false;
  }
}

function startAdventure(classId) {
  beep("click");
  ac();
  const name = ($("hero-name").value || "").trim() || "Junak";
  game = createGame();
  game.start({ name, classId });
  closeOverlays();
  renderPlay(game.getView());
  persist();
}

function continueAdventure() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
    if (!raw || !raw.hero) {
      clearSave();
      return renderCreate();
    }
    game = createGame();
    if (!game.restore(raw)) {
      clearSave();
      game = null;
      closeOverlays();
      return renderTitle();
    }
    closeOverlays();
    const view = game.getView();
    renderPlay(view);
    presentSpecial(view);
    persist();
  } catch (e) {
    clearSave();
    game = null;
    closeOverlays();
    renderTitle();
  }
}

function newAdventure() {
  clearSave();
  game = null;
  closeOverlays();
  $("hero-name").value = "";
  renderCreate();
}

$("btn-new").addEventListener("click", () => { beep("click"); ac(); newAdventure(); });
$("btn-continue").addEventListener("click", () => { beep("click"); ac(); continueAdventure(); });
$("btn-sheet").addEventListener("click", () => { beep("click"); openSheet(); });
$("btn-close-sheet").addEventListener("click", () => { $("overlay-sheet").hidden = true; });
$("overlay-sheet").addEventListener("click", (e) => { if (e.target.id === "overlay-sheet") $("overlay-sheet").hidden = true; });
$("btn-ack-level").addEventListener("click", async () => {
  if (!game || busy) return;
  game.ackLevelUp();
  $("overlay-level").hidden = true;
  persist();
  const v = game.getView();
  renderPlay(v);
  presentSpecial(v);
});
$("btn-shield").addEventListener("click", async () => {
  if (!game || busy) return;
  busy = true;
  const hp = game.getView().hero.hp;
  $("overlay-react").hidden = true;
  game.react("shield");
  try { await afterAction(hp); } finally { busy = false; }
});
$("btn-no-shield").addEventListener("click", async () => {
  if (!game || busy) return;
  busy = true;
  const hp = game.getView().hero.hp;
  $("overlay-react").hidden = true;
  game.react("none");
  try { await afterAction(hp); } finally { busy = false; }
});
$("btn-retry").addEventListener("click", () => {
  if (!game || !game.retryCombat()) {
    closeOverlays();
    return newAdventure();
  }
  closeOverlays();
  renderPlay(game.getView());
  persist();
});
$("btn-again").addEventListener("click", () => { beep("click"); newAdventure(); });
$("btn-mute").addEventListener("click", () => {
  audio.muted = !audio.muted;
  settings.muted = audio.muted;
  saveSettings();
  syncMute();
  if (!audio.muted) { ac(); beep("click"); }
});

syncMute();
renderTitle();

window.__KOCKICA__ = {
  getGame: () => game,
  startAdventure,
  continueAdventure,
};
