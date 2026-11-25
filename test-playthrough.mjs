
import { createGame, CLASSES, XP_TABLE } from "./engine.js";

function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function biasHigh(base) {
  const inner = mulberry32(base);
  return function () {
    return 0.55 + inner() * 0.44; // about 12-20 on d20
  };
}
function biasLow(base) {
  const inner = mulberry32(base + 99991);
  return function () {
    return inner() * 0.45; // about 1-9 on d20
  };
}

function pickChoice(view, classId) {
  const ids = (view.choices || []).filter((c) => !c.disabled).map((c) => c.id);
  const has = (id) => ids.indexOf(id) >= 0;
  const prefer = (list) => {
    for (let i = 0; i < list.length; i++) if (has(list[i])) return list[i];
    return ids[0];
  };

  if (view.sceneId === "tavern") return prefer(["mira", "branko", "buy_oil", "buy_potion", "leave"]);
  if (view.sceneId === "forest_edge") return prefer(["brush", "road"]);
  if (view.sceneId === "forest_snare") return prefer(["snare_save"]);
  if (view.sceneId === "forest_after") return prefer(["help_luka", "to_gate"]);
  if (view.sceneId === "dungeon_gate") {
    if (classId === "lopov") return prefer(["secret", "lockpick", "search_entrance", "bash"]);
    if (classId === "ratnik") return prefer(["secret", "bash", "search_entrance", "lockpick"]);
    return prefer(["secret", "search_entrance", "lockpick", "bash"]);
  }
  if (view.sceneId === "dungeon_trap") {
    if (classId === "lopov") return prefer(["disarm", "walk"]);
    return prefer(["walk", "disarm"]);
  }
  if (view.sceneId === "skeleton_hall") {
    const h = view.hero;
    if (h.hp < h.hpMax && has("skel_potion")) return "skel_potion";
    if (classId === "lopov") return prefer(["sneak_skel", "fight_skel"]);
    return prefer(["fight_skel", "sneak_skel"]);
  }
  if (view.sceneId === "shrine") return prefer(["gift", "persuade_spirit", "steal"]);
  if (view.sceneId === "orc_chamber") {
    const h = view.hero;
    if (h.hp < h.hpMax && has("orc_potion")) return "orc_potion";
    return prefer(["ally", "fight_orc", "intimidate"]);
  }
  if (view.sceneId === "treasure") {
    const h = view.hero;
    if (h.hp < h.hpMax - 2 && has("rest")) return "rest";
    if (h.hp / h.hpMax <= 0.75 && has("drink_greater")) return "drink_greater";
    if (h.hp / h.hpMax <= 0.85 && has("treasure_potion")) return "treasure_potion";
    return prefer(["to_lair", "rest"]);
  }
  if (view.sceneId === "lair") {
    const h = view.hero;
    if (h.hp / h.hpMax <= 0.8 && has("lair_greater")) return "lair_greater";
    if (h.hp / h.hpMax <= 0.85 && has("lair_potion")) return "lair_potion";
    return prefer(["talk_dragon", "fight_dragon"]);
  }
  if (view.sceneId === "combat_won") return prefer(["continue"]);
  if (view.sceneId === "victory") return prefer(["new_game"]);
  return ids[0];
}

function pickCombat(view) {
  const h = view.hero;
  const acts = (view.combatActions || []).filter((a) => !a.disabled);
  const has = (id) => acts.some((a) => a.id === id);
  const hpRatio = h.hp / h.hpMax;
  const living = (view.enemies || []).filter((e) => e.alive);
  const threat = living.some((e) => e.kind === "dragon" || e.kind === "orc");

  if (has("secondWind") && hpRatio <= 0.6) return "secondWind";
  if (has("potion") && (hpRatio <= 0.4 || (threat && hpRatio <= 0.55))) return "potion";

  if (h.classId === "carobnjak") {
    const low = living.filter((e) => e.hp <= 8);
    if (has("spell:thunder") && threat) return "spell:thunder";
    if (has("spell:missile") && (threat || low.length)) return "spell:missile";
    if (has("cantrip")) return "cantrip";
  }
  if (h.classId === "lopov" && has("sneak")) return "sneak";
  if (h.classId === "ratnik" && has("strong") && threat) return "strong";
  if (has("attack")) return "attack";
  if (has("cantrip")) return "cantrip";
  return acts[0] && acts[0].id;
}

function play(seed, classId, rngFactory, foeFactory) {
  const opts = { rng: rngFactory(seed) };
  if (foeFactory) opts.foeRng = foeFactory(seed);
  const game = createGame(opts);
  game.start({ name: "Test", classId: classId });
  let steps = 0;
  let lastScene = "";
  const path = [];
  while (steps++ < 500) {
    const v = game.getView();
    if (v.ending === "victory") return { win: true, steps, view: v, path, level: v.hero.level, hp: v.hero.hp };
    if (v.ending === "defeat") return { win: false, steps, view: v, path, level: v.hero && v.hero.level, hp: 0 };
    if (v.levelUp) {
      game.ackLevelUp();
      continue;
    }
    if (v.reaction) {
      const use = v.reaction.wouldMiss || (v.hero.hp <= v.reaction.damage && v.hero.hp <= 8);
      game.react(use ? "shield" : "none");
      continue;
    }
    if (v.inCombat && v.playerTurn) {
      const act = pickCombat(v);
      if (!act) return { win: false, steps, view: v, path, error: "no combat action" };
      game.combat(act, v.enemies.filter((e) => e.alive)[0] && v.enemies.filter((e) => e.alive)[0].id);
      continue;
    }
    if (v.inCombat && !v.playerTurn && !v.reaction) {
      return { win: false, steps, view: v, path, error: "stuck in combat, not player turn" };
    }
    const id = pickChoice(v, classId);
    if (!id) return { win: false, steps, view: v, path, error: "no choice in " + v.sceneId };
    if (v.sceneId !== lastScene) {
      path.push(v.sceneId);
      lastScene = v.sceneId;
    }
    const r = game.choose(id);
    if (r === "NEW_GAME") break;
  }
  const v = game.getView();
  return { win: v.ending === "victory", steps, view: v, path, error: "too many steps", level: v.hero && v.hero.level };
}

const classes = Object.keys(CLASSES);
let luckyWins = 0;
const luckyDetails = [];
for (const c of classes) {
  const r = play(7, c, biasHigh, biasLow);
  luckyDetails.push({ classId: c, win: r.win, level: r.level, hp: r.hp, path: r.path, error: r.error, ending: r.view && r.view.ending, last: r.view && r.view.sceneId });
  if (r.win) luckyWins++;
}

const N = 20;
const stats = {};
let total = 0;
let wins = 0;
for (const c of classes) {
  stats[c] = { wins: 0, n: 0, levels: [], deathsAt: [] };
  for (let i = 0; i < N; i++) {
    const r = play(1000 + i * 17 + c.length, c, mulberry32);
    stats[c].n++;
    total++;
    if (r.win) {
      stats[c].wins++;
      wins++;
      stats[c].levels.push(r.level);
    } else {
      stats[c].deathsAt.push((r.view && r.view.sceneId) || r.error || "unknown");
    }
  }
}

console.log("LUCKY", JSON.stringify(luckyDetails, null, 2));
console.log("LUCKY_WINS", luckyWins, "/", classes.length);
console.log("FAIR", JSON.stringify(stats, null, 2));
console.log("FAIR_TOTAL", wins, "/", total, "(" + Math.round((100 * wins) / total) + "%)");

if (luckyWins < 3) {
  console.error("Expected all three classes to win with lucky dice.");
  process.exit(1);
}
if (wins / total < 0.4) {
  console.error("Win rate too low: " + wins + "/" + total);
  process.exit(1);
}
const ratnikRate = stats.ratnik.wins / stats.ratnik.n;
if (ratnikRate < 0.5) {
  console.error("Ratnik win rate too low: " + ratnikRate);
  process.exit(1);
}
console.log("PLAYTHROUGH_OK");


// --- save / restore sanitization ---
function assert(cond, msg) {
  if (!cond) {
    console.error("ASSERT", msg);
    process.exit(1);
  }
}

{
  const g = createGame({ rng: mulberry32(1) });
  g.start({ name: "Mira", classId: "carobnjak" });
  const good = g.serialize();
  const g2 = createGame({ rng: mulberry32(2) });
  assert(g2.restore(good), "valid save should restore");
  assert(g2.getView().hero.classId === "carobnjak", "class kept");
  assert(g2.getView().sceneId === "tavern", "scene kept");

  const finished = JSON.parse(JSON.stringify(good));
  finished.ending = "victory";
  const g3 = createGame();
  assert(!g3.restore(finished), "victory save should be discarded");

  const badHero = { hero: { name: "x" }, scene: "tavern" };
  assert(!createGame().restore(badHero), "invalid hero discarded");

  const mid = JSON.parse(JSON.stringify(good));
  mid.combat = { enemies: [{ id: "goblin-1", name: "Goblin", hp: 5, hpMax: 7, ac: 13, alive: true, kind: "goblin" }], order: [{ type: "player", id: "player" }, { type: "enemy", id: "goblin-1" }], index: 0, round: 1, hidden: false, sneakUsed: false, strongUsed: false, bonusUsed: false, dodging: false, onWinScene: "forest_after" };
  mid.reaction = { type: "shield", text: "Štit?", damage: 6, wouldMiss: true, typ: "attack", source: "Goblin" };
  mid.scene = "forest_edge";
  const g4 = createGame();
  assert(g4.restore(mid), "mid-combat shield save restores");
  const v4 = g4.getView();
  assert(v4.inCombat, "still in combat");
  assert(v4.reaction && v4.reaction.type === "shield", "shield reaction kept");
  g4.react("none");
  const v4b = g4.getView();
  assert(!v4b.reaction, "reaction resolved");
  assert(v4b.hero.hp < v4.hero.hp || v4b.ending === "defeat" || v4b.inCombat, "hit applied or combat continues");

  const corruptCombat = JSON.parse(JSON.stringify(good));
  corruptCombat.combat = { enemies: "nope" };
  corruptCombat.reaction = { type: "shield", damage: 4 };
  const g5 = createGame();
  assert(g5.restore(corruptCombat), "corrupt combat is sanitized, not a hard fail");
  const v5 = g5.getView();
  assert(!v5.inCombat, "bad combat dropped");
  assert(!v5.reaction, "orphan reaction dropped");
  assert((v5.choices || []).length > 0, "has a working choice");

  const enemyTurnSave = JSON.parse(JSON.stringify(mid));
  enemyTurnSave.reaction = null;
  enemyTurnSave.combat.index = 1; // enemy unit, no reaction — would softlock
  const g6 = createGame();
  assert(g6.restore(enemyTurnSave), "enemy-turn save restores");
  const v6 = g6.getView();
  assert(v6.inCombat && v6.playerTurn, "snapped to player turn");
  assert(v6.combatActions.length > 0, "has combat actions");

  const dead = JSON.parse(JSON.stringify(good));
  dead.hero.hp = 0;
  const g7 = createGame();
  assert(g7.restore(dead), "dead hero restores as defeat");
  assert(g7.getView().ending === "defeat", "ending is defeat");

  console.log("RESTORE_OK");
}
