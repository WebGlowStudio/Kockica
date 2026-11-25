"use strict";

export const SAVE_KEY = "kockica_save_v1";
export const SETTINGS_KEY = "kockica_settings";

export const ABILITY_NAMES = {
  str: "Snaga",
  dex: "Spretnost",
  con: "Izdržljivost",
  int: "Inteligencija",
  wis: "Mudrost",
  cha: "Harizma",
};

export const ABILITY_SHORT = {
  str: "SN",
  dex: "SP",
  con: "IZ",
  int: "IN",
  wis: "MU",
  cha: "HA",
};

export const SKILL_NAMES = {
  athletics: { name: "Atletika", ability: "str" },
  stealth: { name: "Prikrivanje", ability: "dex" },
  lockpick: { name: "Obijanje brava", ability: "dex" },
  disable: { name: "Zamke", ability: "dex" },
  arcana: { name: "Tajna znanja", ability: "int" },
  investigate: { name: "Istraživanje", ability: "int" },
  insight: { name: "Opažanje", ability: "wis" },
  perception: { name: "Percepcija", ability: "wis" },
  persuade: { name: "Ubeđivanje", ability: "cha" },
  intimidate: { name: "Zastrašivanje", ability: "cha" },
};

export const XP_TABLE = [0, 0, 300, 700];

export const CLASSES = {
  ratnik: {
    id: "ratnik",
    name: "Ratnik",
    blurb: "Čvrst u oklopu, vodi borbu prsa u prsa. Najlakši za početak.",
    detail: "Snažan udarac jednom u borbi dodaje štetu, a na 3. nivou udaraš dva puta.",
    mods: { str: 3, dex: 1, con: 2, int: -1, wis: 0, cha: 0 },
    hitDie: 10,
    baseHp: 16,
    acText: "koštani oklop 16",
    weapon: { name: "Dugi mač", die: 8, able: "str" },
    profSkills: ["athletics", "intimidate"],
    expertise: [],
    profSaves: ["str", "con"],
    potions: 3,
    gold: 25,
  },
  carobnjak: {
    id: "carobnjak",
    name: "Čarobnjak",
    blurb: "Malo života, ali čarolije koje retko promašuju. Dobar izbor ako voliš da planiraš.",
    detail: "Vatrena iskra je uvek tu. Čarobni projektil uvek pogađa, a Štit može da spase udarac.",
    mods: { str: -1, dex: 1, con: 1, int: 3, wis: 1, cha: 0 },
    hitDie: 6,
    baseHp: 14,
    acText: "10 + spretnost, ili Magični oklop (13 + spretnost)",
    weapon: { name: "Štap", die: 6, able: "str" },
    profSkills: ["arcana", "investigate"],
    expertise: [],
    profSaves: ["int", "wis"],
    potions: 3,
    gold: 25,
    spells: true,
  },
  lopov: {
    id: "lopov",
    name: "Lopov",
    blurb: "Brz, tih i precizan. Najbolji u bravama, zamkama i udarcu iz senke.",
    detail: "Napad iz senke dodaje dodatnu kocku štete. Na 3. nivou ta šteta raste, a prvi udarac u rundi možeš prepoloviti.",
    mods: { str: 0, dex: 3, con: 1, int: 1, wis: 0, cha: 1 },
    hitDie: 8,
    baseHp: 13,
    acText: "kožni oklop 12 + spretnost",
    weapon: { name: "Rapir", die: 8, able: "dex" },
    profSkills: ["stealth", "lockpick", "disable", "persuade", "perception"],
    expertise: ["stealth", "lockpick", "disable"],
    profSaves: ["dex", "int"],
    potions: 3,
    gold: 25,
  },
};

function signed(n) {
  return n >= 0 ? "+" + n : String(n);
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

export function createGame(opts = {}) {
  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
  const foeRng = typeof opts.foeRng === "function" ? opts.foeRng : null;
  let foeRolling = 0;

  function withFoe(fn) {
    foeRolling += 1;
    try { return fn(); } finally { foeRolling -= 1; }
  }

  const state = {
    hero: null,
    scene: "tavern",
    flags: {},
    log: [],
    rolls: [],
    combat: null,
    pendingLevelUp: null,
    reaction: null,
    ending: null,
    combatSnapshot: null,
  };

  let endCombatWin = function () {};

  function d(sides) {
    let x = (foeRolling && foeRng) ? foeRng() : rng();
    if (!Number.isFinite(x)) x = 0;
    x = x - Math.floor(x);
    if (x < 0) x += 1;
    if (x >= 1) x = 0;
    const v = 1 + Math.floor(x * sides);
    return Math.min(sides, Math.max(1, v));
  }

  function record(sides, value, label, extra) {
    const entry = Object.assign({ sides: sides, value: value, label: label }, extra || {});
    state.rolls.push(entry);
    return entry;
  }

  function clearRolls() {
    state.rolls = [];
  }

  function log(text, kind) {
    state.log.push({ text: text, kind: kind || "normal" });
    if (state.log.length > 16) state.log = state.log.slice(-16);
  }

  function hero() {
    return state.hero;
  }

  function saveMod(h, able) {
    return h.mods[able] + (h.profSaves.indexOf(able) >= 0 ? h.prof : 0) + (h.flags.bless ? 1 : 0) + (h.flags.curse ? -1 : 0);
  }

  function skillMod(h, skillId) {
    const skill = SKILL_NAMES[skillId];
    let bonus = h.mods[skill.ability];
    const trained = h.profSkills.indexOf(skillId) >= 0;
    const expert = h.expertise.indexOf(skillId) >= 0;
    if (expert) bonus += h.prof * 2;
    else if (trained) bonus += h.prof;
    return { bonus: bonus, able: skill.ability, trained: trained, expert: expert, name: skill.name };
  }

  function computeAC(h) {
    let ac;
    if (h.classId === "ratnik") ac = 16;
    else if (h.classId === "carobnjak") ac = h.flags.mageArmor ? 13 + h.mods.dex : 10 + h.mods.dex;
    else ac = 12 + h.mods.dex;
    if (h.flags.amulet) ac += 1;
    h.ac = ac;
    return ac;
  }

  function sneakDice(h) {
    return h.level >= 3 ? 2 : 1;
  }

  function slotsForLevel(level) {
    if (level <= 1) return { 1: { max: 3, used: 0 }, 2: { max: 0, used: 0 } };
    if (level === 2) return { 1: { max: 3, used: 0 }, 2: { max: 0, used: 0 } };
    return { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } };
  }

  function slotLeft(h, level) {
    if (!h.slots || !h.slots[level]) return 0;
    return h.slots[level].max - h.slots[level].used;
  }

  function spendSlot(h, level) {
    if (slotLeft(h, level) <= 0) return false;
    h.slots[level].used += 1;
    return true;
  }

  function spellDC(h) {
    return 8 + h.prof + h.mods.int;
  }

  function spellAtk(h) {
    return h.prof + h.mods.int;
  }


  function makeHero(name, classId) {
    const cls = CLASSES[classId];
    const mods = Object.assign({}, cls.mods);
    const hp = cls.baseHp + mods.con;
    const h = {
      name: ((name || "Junak").trim() || "Junak"),
      classId: cls.id,
      className: cls.name,
      level: 1,
      xp: 0,
      mods: mods,
      prof: 2,
      profSkills: cls.profSkills.slice(),
      expertise: cls.expertise.slice(),
      profSaves: cls.profSaves.slice(),
      hp: hp,
      hpMax: hp,
      ac: 10,
      gold: cls.gold,
      potions: cls.potions,
      inventory: [],
      flags: {
        mageArmor: classId === "carobnjak",
        fireResist: false,
        bless: false,
        curse: false,
        amulet: false,
        uncannyUsed: false,
      },
      slots: cls.spells ? slotsForLevel(1) : null,
      uses: {
        strongHit: classId === "ratnik" ? 1 : 0,
        strongHitMax: classId === "ratnik" ? 1 : 0,
        secondWind: classId === "ratnik" ? 1 : 0,
        secondWindMax: classId === "ratnik" ? 1 : 0,
      },
      weapon: Object.assign({}, cls.weapon),
    };
    if (classId === "carobnjak") {
      h.inventory.push({
        id: "mage-armor",
        name: "Magični oklop",
        desc: "Počinješ zaštićen čarolijom: KO je 13 + spretnost.",
      });
    }
    computeAC(h);
    return h;
  }

  function grantXp(amount) {
    const h = hero();
    if (!h || amount <= 0) return;
    h.xp += amount;
    log("Dobijaš " + amount + " iskustva.", "gold");
    const lines = [];
    while (h.level < 3 && h.xp >= XP_TABLE[h.level + 1]) {
      h.level += 1;
      const cls = CLASSES[h.classId];
      const gain = Math.max(1, Math.ceil((cls.hitDie + 1) / 2) + h.mods.con);
      h.hpMax += gain;
      h.hp = Math.min(h.hpMax, h.hp + gain);
      lines.push("Nivo " + h.level + ": +" + gain + " maksimalnog života.");
      if (h.slots) {
        const fresh = slotsForLevel(h.level);
        const used1 = h.slots[1] ? h.slots[1].used : 0;
        const used2 = h.slots[2] ? h.slots[2].used : 0;
        h.slots = {
          1: { max: fresh[1].max, used: Math.min(used1, fresh[1].max) },
          2: { max: fresh[2].max, used: Math.min(used2, fresh[2].max) },
        };
        if (h.level === 2) lines.push("Imaš još jedan okvir čarolije prvog stepena.");
        if (h.level === 3) lines.push("Otvaraš čarolije drugog stepena: Grom.");
      }
      if (h.classId === "ratnik" && h.level === 3) {
        lines.push("Dodatni napad: u svakom svom potezu udaraš dva puta.");
      }
      if (h.classId === "lopov" && h.level === 3) {
        lines.push("Udarac iz senke sada dodaje 2k6 štete.");
        lines.push("Neuhvatljivo izvijanje: prvi udarac koji te pogodi u rundi prepolovljuje štetu.");
      }
      log("Rasteš na " + h.level + ". nivo!", "good");
    }
    if (lines.length) {
      computeAC(h);
      state.pendingLevelUp = { level: h.level, lines: lines };
    }
  }

  function addGold(n) {
    hero().gold += n;
    if (n > 0) log("Nalaziš " + n + " zlatnika.", "gold");
  }

  function addPotion(n) {
    n = n == null ? 1 : n;
    hero().potions += n;
    log(n === 1 ? "Dobijaš napitak lečenja." : "Dobijaš " + n + " napitka lečenja.", "good");
  }

  function addItem(item) {
    hero().inventory.push(item);
    log("Dobijaš: " + item.name + ".", "good");
  }

  function check(skillId, dc, opts) {
    opts = opts || {};
    const h = hero();
    const info = skillMod(h, skillId);
    let r1 = d(20);
    record(20, r1, info.name, { kind: "check" });
    let used = r1;
    if (opts.advantage && !opts.disadvantage) {
      const r2 = d(20);
      record(20, r2, info.name + " (prednost)", { kind: "check" });
      used = Math.max(r1, r2);
    } else if (opts.disadvantage && !opts.advantage) {
      const r2 = d(20);
      record(20, r2, info.name + " (smetnja)", { kind: "check" });
      used = Math.min(r1, r2);
    }
    const total = used + info.bonus;
    const fumble = used === 1;
    const crit = used === 20;
    const success = fumble ? false : crit ? true : total >= dc;
    const bits = info.name + " " + used + " " + signed(info.bonus) + " = " + total + " protiv " + dc;
    if (fumble) log("Jedinica! " + bits + " — neuspeh.", "bad");
    else if (crit) log("Dvadesetica! " + bits + " — uspeh.", "good");
    else if (success) log(bits + " — uspeh.", "good");
    else log(bits + " — nije uspelo.", "bad");
    return { roll: used, bonus: info.bonus, total: total, dc: dc, success: success, crit: crit, fumble: fumble, skillId: skillId, name: info.name };
  }

  function savingThrow(able, dc, opts) {
    opts = opts || {};
    const h = hero();
    const bonus = saveMod(h, able);
    let r1 = d(20);
    record(20, r1, "Spas (" + ABILITY_NAMES[able] + ")", { kind: "save" });
    let used = r1;
    if (opts.advantage && !opts.disadvantage) {
      const r2 = d(20);
      record(20, r2, "Spas (prednost)", { kind: "save" });
      used = Math.max(r1, r2);
    } else if (opts.disadvantage && !opts.advantage) {
      const r2 = d(20);
      record(20, r2, "Spas (smetnja)", { kind: "save" });
      used = Math.min(r1, r2);
    }
    const total = used + bonus;
    const fumble = used === 1;
    const crit = used === 20;
    const success = fumble ? false : crit ? true : total >= dc;
    const label = "Spas (" + ABILITY_SHORT[able] + ") " + used + " " + signed(bonus) + " = " + total + " protiv " + dc;
    if (fumble) log("Jedinica na spasu! " + label + ".", "bad");
    else if (crit) log("Dvadesetica na spasu! " + label + ".", "good");
    else if (success) log(label + " — uspeh.", "good");
    else log(label + " — neuspeh.", "bad");
    return { roll: used, bonus: bonus, total: total, dc: dc, success: success, crit: crit, fumble: fumble, able: able };
  }

  function rollDice(count, sides, label) {
    let sum = 0;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const v = d(sides);
      parts.push(v);
      record(sides, v, label + (count > 1 ? " " + (i + 1) + "/" + count : ""), { kind: "damage" });
      sum += v;
    }
    return { sum: sum, parts: parts };
  }

  function healPotion(kind) {
    const h = hero();
    if (kind === "greater") {
      const rolled = rollDice(4, 4, "veći napitak");
      const amt = rolled.sum + 4;
      h.hp = Math.min(h.hpMax, h.hp + amt);
      log("Veći napitak ti vraća " + amt + " života (" + rolled.parts.join(" + ") + " + 4).", "good");
      return amt;
    }
    const rolled = rollDice(2, 4, "napitak");
    const amt = rolled.sum + 2;
    h.hp = Math.min(h.hpMax, h.hp + amt);
    log("Napitak ti vraća " + amt + " života (" + rolled.parts.join(" + ") + " + 2).", "good");
    return amt;
  }

  function drinkPotion() {
    const h = hero();
    if (h.potions <= 0) return false;
    if (h.hp >= h.hpMax) {
      log("Već si na punom životu.", "normal");
      return false;
    }
    h.potions -= 1;
    healPotion("normal");
    return true;
  }


  function enemy(id, name, art, opts) {
    return {
      id: id,
      name: name,
      art: art,
      hp: opts.hp,
      hpMax: opts.hp,
      ac: opts.ac,
      attackMod: opts.attackMod,
      damageDie: opts.damageDie,
      damageBonus: opts.damageBonus,
      xp: opts.xp,
      gold: opts.gold,
      initMod: opts.initMod || 0,
      init: 0,
      alive: true,
      kind: opts.kind,
      breathReady: !!opts.breath,
      breathDie: opts.breathDie || 0,
      breathDC: opts.breathDC || 13,
      tags: opts.tags || {},
    };
  }

  function goblins(surprised) {
    return [
      enemy("goblin-1", "Goblin izviđač", "goblin", { hp: 7, ac: 13, attackMod: 4, damageDie: 6, damageBonus: 0, xp: 50, gold: 6, initMod: 2, kind: "goblin" }),
      enemy("goblin-2", "Goblin strelac", "goblin", { hp: 7, ac: 13, attackMod: 4, damageDie: 6, damageBonus: 0, xp: 50, gold: 6, initMod: 2, kind: "goblin", tags: { skipFirst: !!surprised } }),
    ];
  }

  function skeletonFoe() {
    return [enemy("kostur", "Kostur čuvar", "skeleton", { hp: 13, ac: 13, attackMod: 4, damageDie: 6, damageBonus: 1, xp: 150, gold: 12, initMod: 2, kind: "skeleton" })];
  }

  function orcFoe() {
    return [enemy("karg", "Ork Karg", "orc", { hp: 16, ac: 13, attackMod: 5, damageDie: 10, damageBonus: 2, xp: 250, gold: 20, initMod: 1, kind: "orc" })];
  }

  function dragonFoe() {
    return [enemy("zaros", "Zaros, crveni zmaj", "dragon", { hp: 34, ac: 15, attackMod: 6, damageDie: 10, damageBonus: 3, xp: 500, gold: 80, initMod: 2, kind: "dragon", breath: true, breathDie: 4, breathDC: 13 })];
  }

  function snapshot() {
    return deepClone({
      hero: state.hero,
      scene: state.scene,
      flags: state.flags,
      log: state.log,
      pendingLevelUp: state.pendingLevelUp,
      ending: state.ending,
    });
  }

  function startCombat(enemies, onWinScene, intro) {
    const h = hero();
    const list = enemies.map(function (e) { return Object.assign({}, e, { tags: Object.assign({}, e.tags) }); });
    const pInitRoll = d(20);
    record(20, pInitRoll, "Inicijativa", { kind: "init" });
    const pInit = pInitRoll + h.mods.dex;
    log("Inicijativa: " + pInitRoll + " " + signed(h.mods.dex) + " = " + pInit + ".");
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      withFoe(function () {
        const r = d(20);
        record(20, r, "Inicijativa (" + e.name + ")", { kind: "init" });
        e.init = r + e.initMod;
      });
    }
    const units = [{ type: "player", init: pInit, id: "player" }].concat(list.map(function (e) {
      return { type: "enemy", init: e.init, id: e.id };
    }));
    units.sort(function (a, b) {
      if (b.init !== a.init) return b.init - a.init;
      return a.type === "player" ? -1 : 1;
    });
    state.combat = {
      enemies: list,
      onWinScene: onWinScene,
      order: units,
      index: 0,
      round: 1,
      hidden: false,
      sneakUsed: false,
      strongUsed: false,
      bonusUsed: false,
      dodging: false,
    };
    h.flags.uncannyUsed = false;
    if (h.classId === "ratnik") h.uses.strongHit = h.uses.strongHitMax;
    state.combatSnapshot = snapshot();
    if (intro) log(intro, "normal");
    log("Borba počinje.", "gold");
    resolveTurnsUntilPlayerOrEnd();
  }

  function living() {
    return state.combat ? state.combat.enemies.filter(function (e) { return e.alive && e.hp > 0; }) : [];
  }

  function endCombatLose() {
    state.ending = "defeat";
    state.reaction = null;
    log("Padaš na tlo. Avantura se ovde prekida…", "bad");
  }

  function harmPlayer(amount, source, opts) {
    opts = opts || {};
    const h = hero();
    let dmg = amount;
    if (opts.fire && h.flags.fireResist) {
      dmg = Math.floor(dmg / 2);
      log("Zaštita od vatre prepolovljava štetu.", "good");
    }
    if (opts.typ === "attack" && h.classId === "lopov" && h.level >= 3 && !h.flags.uncannyUsed && dmg > 0) {
      dmg = Math.floor(dmg / 2);
      h.flags.uncannyUsed = true;
      log("Neuhvatljivo izvijanje prepolovljava udarac.", "good");
    }
    h.hp -= dmg;
    if (h.hp < 0) h.hp = 0;
    log(source + " ti nanosi " + dmg + " štete.", "bad");
    if (h.hp <= 0) {
      endCombatLose();
      return true;
    }
    return false;
  }

  function attackRoll(bonus, ac, label, opts) {
    opts = opts || {};
    let r1 = d(20);
    record(20, r1, label, { kind: "attack" });
    let used = r1;
    if (opts.advantage && !opts.disadvantage) {
      const r2 = d(20);
      record(20, r2, label + " (prednost)", { kind: "attack" });
      used = Math.max(r1, r2);
    } else if (opts.disadvantage && !opts.advantage) {
      const r2 = d(20);
      record(20, r2, label + " (smetnja)", { kind: "attack" });
      used = Math.min(r1, r2);
    }
    const total = used + bonus;
    const crit = used === 20;
    const fumble = used === 1;
    const hit = fumble ? false : crit ? true : total >= ac;
    return { roll: used, bonus: bonus, total: total, ac: ac, hit: hit, crit: crit, fumble: fumble };
  }

  function dealDamageTo(target, count, sides, bonus, crit, label) {
    const dice = crit ? count * 2 : count;
    const rolled = rollDice(dice, sides, label);
    const total = rolled.sum + bonus;
    target.hp -= total;
    if (target.hp < 0) target.hp = 0;
    if (target.hp <= 0) {
      target.alive = false;
      log((crit ? "Kritičan udarac! " : "") + target.name + " prima " + total + " štete i pada.", "good");
    } else {
      log((crit ? "Kritičan udarac! " : "Pogodak. ") + target.name + " prima " + total + " štete (" + target.hp + "/" + target.hpMax + ").", crit ? "good" : "normal");
    }
    return total;
  }

  function playerAttack(target, opts) {
    opts = opts || {};
    const h = hero();
    const able = h.weapon.able;
    let bonus = h.mods[able] + h.prof;
    if (opts.strong) bonus += 2;
    const atk = attackRoll(bonus, target.ac, "Napad", { advantage: opts.adv || state.combat.hidden });
    if (atk.fumble) {
      log("Jedinica! " + h.weapon.name + " potpuno promašuje " + target.name + ".", "bad");
      state.combat.hidden = false;
      return false;
    }
    if (!atk.hit) {
      log(atk.roll + " " + signed(bonus) + " = " + atk.total + " protiv KO " + target.ac + " — promašaj.", "normal");
      state.combat.hidden = false;
      return false;
    }
    log(atk.roll + " " + signed(bonus) + " = " + atk.total + " protiv KO " + target.ac + " — pogodak" + (atk.crit ? ", kritično!" : "."), atk.crit ? "good" : "normal");
    let dmgBonus = h.mods[able];
    if (opts.strong) {
      const extra = rollDice(atk.crit ? 2 : 1, 8, "snažan udarac");
      dmgBonus += extra.sum;
      log("Snažan udarac dodaje " + extra.sum + " štete.", "good");
    }
    if (opts.sneak && !state.combat.sneakUsed) {
      const sd = sneakDice(h);
      const extra = rollDice(atk.crit ? sd * 2 : sd, 6, "udarac iz senke");
      dmgBonus += extra.sum;
      state.combat.sneakUsed = true;
      log("Udarac iz senke dodaje " + extra.sum + " štete.", "good");
    }
    dealDamageTo(target, 1, h.weapon.die, dmgBonus, atk.crit, h.weapon.name);
    state.combat.hidden = false;
    return true;
  }

  function chooseTarget(id) {
    const list = living();
    if (!list.length) return null;
    if (id) {
      const found = list.filter(function (e) { return e.id === id; })[0];
      if (found) return found;
    }
    return list[0];
  }

  function afterPlayerAction() {
    if (state.ending || !state.combat) return;
    if (!living().length) {
      endCombatWin();
      return;
    }
    state.combat.dodging = false;
    state.combat.index += 1;
    resolveTurnsUntilPlayerOrEnd();
  }

  function resolveTurnsUntilPlayerOrEnd() {
    if (!state.combat || state.ending) return;
    const c = state.combat;
    let guard = 0;
    while (state.combat && !state.ending && !state.reaction && guard++ < 24) {
      if (!living().length) {
        endCombatWin();
        return;
      }
      if (c.index >= c.order.length) {
        c.index = 0;
        c.round += 1;
        c.sneakUsed = false;
        c.bonusUsed = false;
        hero().flags.uncannyUsed = false;
        log("Runda " + c.round + ".", "gold");
      }
      const unit = c.order[c.index];
      if (unit.type === "player") return;
      const en = c.enemies.filter(function (e) { return e.id === unit.id; })[0];
      if (!en || !en.alive) {
        c.index += 1;
        continue;
      }
      if (en.tags && en.tags.skipFirst && c.round === 1) {
        log(en.name + " još se nije snašao i propušta prvi potez.", "normal");
        en.tags.skipFirst = false;
        c.index += 1;
        continue;
      }
      enemyTurn(en);
      if (state.reaction || state.ending) return;
      c.index += 1;
    }
  }

  function enemyTurn(en) {
    const h = hero();
    if (en.kind === "dragon") {
      if (!en.breathReady) {
        withFoe(function () {
          const rec = d(6);
          record(6, rec, "Obnavljanje daha", { kind: "recharge" });
          if (rec >= 5) {
            en.breathReady = true;
            log("Zaros skuplja vatru u grlu.", "bad");
          }
        });
      }
      if (en.breathReady) {
        en.breathReady = false;
        log("Zaros izdahne stepenu vatre!", "bad");
        const save = savingThrow("dex", en.breathDC);
        const rolled = withFoe(function () { return rollDice(en.breathDie, 6, "zmajev dah"); });
        let dmg = rolled.sum;
        if (save.success) dmg = Math.floor(dmg / 2);
        harmPlayer(dmg, "Vatreni dah", { fire: true });
        return;
      }
    }
    const atk = withFoe(function () { return attackRoll(en.attackMod, h.ac, en.name, { disadvantage: !!state.combat.dodging }); });
    if (atk.fumble) {
      log(en.name + " baca jedinicu i teško promašuje.", "good");
      return;
    }
    if (!atk.hit) {
      log(en.name + " napada: " + atk.roll + " " + signed(en.attackMod) + " = " + atk.total + " protiv tvog KO " + h.ac + " — promašaj.", "normal");
      return;
    }
    log(en.name + " pogađa: " + atk.roll + " " + signed(en.attackMod) + " = " + atk.total + " protiv KO " + h.ac + ".", "bad");
    const rolled = withFoe(function () { return rollDice(atk.crit ? 2 : 1, en.damageDie, en.name); });
    const dmg = rolled.sum + en.damageBonus;
    if (hero().classId === "carobnjak" && slotLeft(hero(), 1) > 0) {
      const wouldMiss = atk.total < h.ac + 5 && !atk.crit;
      state.reaction = {
        type: "shield",
        text: en.name + " te pogađa (" + atk.total + " protiv KO " + h.ac + "). Štit podiže KO za 5 i može da odbije udarac.",
        damage: dmg,
        wouldMiss: wouldMiss,
        crit: atk.crit,
        typ: "attack",
        source: en.name,
      };
      return;
    }
    harmPlayer(dmg, en.name, { typ: "attack" });
  }

  function applyReaction(choice) {
    const r = state.reaction;
    if (!r) return;
    state.reaction = null;
    if (r.type === "shield" && choice === "shield" && slotLeft(hero(), 1) > 0) {
      spendSlot(hero(), 1);
      log("Štit bljesne oko tebe. KO je " + (hero().ac + 5) + " protiv ovog udarca.", "good");
      if (r.wouldMiss && !r.crit) log("Udarac sada promašuje.", "good");
      else harmPlayer(r.damage, r.source, { typ: r.typ, fire: r.fire });
    } else if (r.type === "shield") {
      harmPlayer(r.damage, r.source, { typ: r.typ, fire: r.fire });
    }
    if (state.ending) return;
    if (state.combat) {
      state.combat.index += 1;
      resolveTurnsUntilPlayerOrEnd();
    }
  }

  function maybeExtraAttack(firstTarget) {
    const h = hero();
    if (h.classId !== "ratnik" || h.level < 3 || state.ending) return;
    const next = (firstTarget && firstTarget.alive) ? firstTarget : chooseTarget();
    if (!next) return;
    log("Drugi udarac!", "gold");
    playerAttack(next, { strong: false, sneak: false, adv: false });
  }

  function combatAction(actionId, targetId) {
    if (!state.combat || state.ending || state.reaction || state.pendingLevelUp) return;
    const c = state.combat;
    const unit = c.order[c.index];
    if (!unit || unit.type !== "player") return;
    const h = hero();
    const target = chooseTarget(targetId);

    if (actionId === "potion") {
      if (!drinkPotion()) return;
      afterPlayerAction();
      return;
    }
    if (actionId === "secondWind") {
      if (h.uses.secondWind <= 0 || c.bonusUsed) return;
      h.uses.secondWind -= 1;
      c.bonusUsed = true;
      const rolled = rollDice(1, 10, "drugi dah");
      const amt = rolled.sum + h.level;
      h.hp = Math.min(h.hpMax, h.hp + amt);
      log("Drugi dah ti vraća " + amt + " života.", "good");
      return;
    }
    if (actionId === "dodge") {
      c.dodging = true;
      log("Uzimaš oprezan stav. Neprijateljima je teže da te pogode.", "normal");
      afterPlayerAction();
      return;
    }
    if (actionId === "spell:armor") {
      if (!h.slots || h.flags.mageArmor || !spendSlot(h, 1)) return;
      h.flags.mageArmor = true;
      computeAC(h);
      log("Magični oklop se zateže oko tebe. KO je sada " + h.ac + ".", "good");
      afterPlayerAction();
      return;
    }
    if (!target) return;

    if (actionId === "attack" || actionId === "strong" || actionId === "sneak") {
      const strong = actionId === "strong" && h.uses.strongHit > 0 && !c.strongUsed;
      if (actionId === "strong") {
        if (!(h.uses.strongHit > 0 && !c.strongUsed)) return;
        h.uses.strongHit -= 1;
        c.strongUsed = true;
      }
      let sneak = false;
      let adv = !!c.hidden;
      if (actionId === "sneak") {
        if (c.hidden) {
          sneak = true;
          adv = true;
        } else {
          const res = check("stealth", 13);
          if (res.success) {
            c.hidden = true;
            sneak = true;
            adv = true;
            log("Stapaš se sa senkom i udaraš iznenađenog protivnika.", "good");
          } else {
            log("Nisi se dovoljno sakrio, ali ipak udaraš.", "normal");
          }
        }
      } else if (c.hidden) {
        sneak = true;
        adv = true;
      }
      playerAttack(target, { strong: strong, sneak: sneak, adv: adv });
      maybeExtraAttack(target);
      afterPlayerAction();
      return;
    }

    if (actionId === "cantrip") {
      const bonus = spellAtk(h);
      const atk = attackRoll(bonus, target.ac, "Vatrena iskra");
      if (atk.fumble) log("Jedinica! Iskra se gasi u vazduhu.", "bad");
      else if (!atk.hit) log("Vatrena iskra: " + atk.roll + " " + signed(bonus) + " = " + atk.total + " protiv KO " + target.ac + " — promašaj.", "normal");
      else {
        log("Vatrena iskra pogađa" + (atk.crit ? " kritično!" : "."), atk.crit ? "good" : "normal");
        dealDamageTo(target, 1, 10, 0, atk.crit, "Vatrena iskra");
      }
      afterPlayerAction();
      return;
    }

    if (actionId === "spell:missile") {
      if (!spendSlot(h, 1)) return;
      const rolled = rollDice(3, 4, "čarobni projektil");
      const total = rolled.sum + 3;
      target.hp -= total;
      if (target.hp < 0) target.hp = 0;
      if (target.hp <= 0) {
        target.alive = false;
        log("Tri svetlosna projektila uvek pogađaju i nanose " + total + " štete. " + target.name + " pada.", "good");
      } else {
        log("Čarobni projektil uvek pogađa: " + total + " štete (" + rolled.parts.join(" + ") + " + 3).", "good");
      }
      afterPlayerAction();
      return;
    }

    if (actionId === "spell:thunder") {
      if (!spendSlot(h, 2)) return;
      const dc = spellDC(h);
      const saveRoll = withFoe(function () { return d(20); });
      record(20, saveRoll, "Spas protivnika (IZ)", { kind: "save" });
      const conMod = target.kind === "dragon" ? 4 : target.kind === "orc" ? 3 : 1;
      const total = saveRoll + conMod;
      const saved = saveRoll === 1 ? false : saveRoll === 20 ? true : total >= dc;
      const rolled = rollDice(3, 8, "Grom");
      let dmg = rolled.sum;
      if (saved) {
        dmg = Math.floor(dmg / 2);
        log(target.name + " odoleva gromu (spas " + saveRoll + signed(conMod) + " = " + total + ") i prima polovinu: " + dmg + ".", "normal");
      } else {
        log("Grom trešti. " + target.name + " ne uspeva spas (" + saveRoll + signed(conMod) + " = " + total + " protiv " + dc + ") i prima " + dmg + " štete.", "good");
      }
      target.hp -= dmg;
      if (target.hp <= 0) {
        target.hp = 0;
        target.alive = false;
        log(target.name + " pada.", "good");
      }
      afterPlayerAction();
    }
  }


  const SCENE = {};

  function go(id) {
    state.scene = id;
    state.combat = null;
    state.reaction = null;
    if (SCENE[id] && SCENE[id].onEnter && !state.flags["entered_" + id]) {
      state.flags["entered_" + id] = true;
      SCENE[id].onEnter();
    }
  }

  SCENE.tavern = {
    location: "Krčma „Crni vuk“",
    title: "Dim i šapat",
    art: "tavern",
    text: function () {
      return "Krčma miriše na dim, vruć kruh i mokre kapute. Kraj ognjišta lovci govore poluglasno: iz razvalina Orlova kamena noću se čuje tutanj, a stoka nestaje. Gostioničarka Mira briše šank i meri te pogledom, kao da već zna zašto si došao. U ćošku, pijan najamnik Branko lupka kriglom o sto.";
    },
    onEnter: function () {
      log("Ulaziš u krčmu „Crni vuk“. Avantura počinje.", "gold");
    },
    choices: function () {
      const f = state.flags;
      const list = [];
      if (!f.talkedMira) list.push({ id: "mira", label: "Pitaj Miru šta se dogodilo", hint: "Ubeđivanje (HA) · 11" });
      if (!f.talkedBranko) list.push({ id: "branko", label: "Nateraj Branka da progovori", hint: "Zastrašivanje (HA) · 13" });
      if (!f.boughtPotion) {
        list.push({
          id: "buy_potion",
          label: "Kupi napitak lečenja (15 zlata)",
          hint: hero().gold + " zlata kod sebe",
          disabled: hero().gold < 15,
          why: "Nemaš dovoljno zlata.",
        });
      }
      if (f.miraOil && !f.boughtOil && !hero().flags.fireResist) {
        list.push({
          id: "buy_oil",
          label: "Kupi ulje protiv vatre (20 zlata)",
          hint: "Prepolovljuje štetu od vatre",
          disabled: hero().gold < 20,
          why: "Nemaš dovoljno zlata.",
        });
      }
      list.push({ id: "leave", label: "Kreni prema šumi", hint: "Put ka Orlovom kamenu" });
      return list;
    },
  };

  SCENE.forest_edge = {
    location: "Orlova šuma",
    title: "Dve staze",
    art: "forest",
    text: function () {
      return "Borovi stoje gusto. Stara trgovačka staza puna je iscepanog platna i polomljenih točkova. Levo se vija uža staza kroz žbunje — tiša, ali neizvesna. Negde ispred čuje se kratak, grub smeh.";
    },
    onEnter: function () { log("Napuštaš selo i ulaziš u šumu.", "normal"); },
    choices: function () {
      return [
        { id: "road", label: "Idi starim trgovačkim putem", hint: "Brže, ali otvoreno" },
        { id: "brush", label: "Povuci se stazom kroz žbunje", hint: "Prikrivanje (SP) · 13" },
      ];
    },
  };

  SCENE.forest_snare = {
    location: "Orlova šuma",
    title: "Skrivena omča",
    art: "forest",
    text: function () { return "Pod lišćem zateže se užad. Omča je već krenula prema tvom gležnju."; },
    choices: function () {
      return [{ id: "snare_save", label: "Iskoči na stranu", hint: "Spas (SP) · 12" }];
    },
  };

  SCENE.forest_after = {
    location: "Orlova šuma",
    title: "Posle zasede",
    art: "forest",
    text: function () {
      return "Tišina se vraća među borove. Iza oborenog točka čuje se tih glas: putnik Luka, izgreban, vezao se sam od straha i sad ne sme da izađe.";
    },
    onEnter: function () {
      if (!state.flags.afterLoot) {
        state.flags.afterLoot = true;
        if (d(2) === 2) addPotion(1);
      }
    },
    choices: function () {
      const list = [];
      if (!state.flags.lukaDone) {
        list.push({ id: "help_luka", label: "Odveži ga i pomozi mu", hint: "Dobro delo" });
        list.push({ id: "ask_luka", label: "Pitaj ga šta zna o razvalinama", hint: "Ubeđivanje (HA) · 10" });
        list.push({ id: "search_luka", label: "Pretresi mu torbu i ostavi ga", hint: "Brzo zlato, loš glas" });
      }
      list.push({ id: "to_gate", label: "Kreni ka razvalinama", hint: "Orlov kamen" });
      return list;
    },
  };

  SCENE.dungeon_gate = {
    location: "Razvaline Orlova kamena",
    title: "Kamene dveri",
    art: "gate",
    text: function () {
      let t = "Pred tobom su teške, zarđale dveri. U kamenu su urezana stara lica, a brava je još cela. Iza vrata vuče hladan vazduh i miris pepela.";
      if (state.flags.secretPath) t += " Sećaš se Brankovog šapata: levo od vrata, iza paprati, postoji uski prolaz.";
      return t;
    },
    onEnter: function () { log("Stižeš do razvalina Orlova kamena.", "gold"); },
    choices: function () {
      const list = [
        { id: "lockpick", label: "Obij bravu", hint: "Obijanje brava (SP) · 13" },
        { id: "bash", label: "Sruši vrata snagom", hint: "Atletika (SN) · 15" },
        { id: "search_entrance", label: "Potraži drugi ulaz", hint: "Istraživanje (IN) · 12" },
      ];
      if (state.flags.secretPath) list.unshift({ id: "secret", label: "Tajni hodnik koji ti je Branko opisao", hint: "Mimo zamke" });
      return list;
    },
  };

  SCENE.dungeon_trap = {
    location: "Hodnik od kamena",
    title: "Ploče pod prašinom",
    art: "dungeon",
    text: function () {
      return "Uski hodnik tone u polumrak. Prašina na podu je isprekidana — neke kamene ploče su niže od drugih. U zidovima zijevaju uske puškarnice.";
    },
    choices: function () {
      return [
        { id: "disarm", label: "Pažljivo razori zamku", hint: "Zamke (SP) · 12" },
        { id: "walk", label: "Prođi oprezno", hint: "Spas (SP) · 13, ako zamka krene" },
      ];
    },
  };

  SCENE.skeleton_hall = {
    location: "Dvorana čuvara",
    title: "Koštani zakletnik",
    art: "skeleton",
    text: function () {
      return "U dugoj dvorani, pored ugašenih žarača, stoji kostur u starom oklopu. U ruci drži sečivo, a prazne očne duplje okreću se ka tebi. Nije samo ostavljen — postavljen je da čuva put.";
    },
    choices: function () {
      const list = [];
      if (hero().potions > 0 && hero().hp < hero().hpMax) {
        list.push({ id: "skel_potion", label: "Popij napitak pre borbe", hint: "2k4+2 života" });
      }
      list.push({ id: "sneak_skel", label: "Pokušaj da se provučeš tiho", hint: "Prikrivanje (SP) · 15" });
      list.push({ id: "fight_skel", label: "Zakorači i prihvati borbu", hint: "Borba na poteze" });
      return list;
    },
  };

  SCENE.shrine = {
    location: "Svetilište u kamenu",
    title: "Glas iz zida",
    art: "shrine",
    text: function () {
      return "Iza dvorane je malo svetilište. U udubljenju stoji stara posuda, a iz kamena se čuje tih, suh glas: „Ako ideš na vatru, reci zašto. Ako ideš na zlato, uzmi i nosi kletvu.“";
    },
    onEnter: function () { log("Ulaziš u staro svetilište.", "normal"); },
    choices: function () {
      return [
        { id: "persuade_spirit", label: "Uveri glas da ideš da zaštitiš selo", hint: "Ubeđivanje (HA) · 13" },
        { id: "gift", label: "Ostavi dar od 10 zlatnika", hint: hero().gold < 10 ? "Nemaš 10 zlata" : "Poštovanje umesto reči", disabled: hero().gold < 10, why: "Nemaš dovoljno zlata." },
        { id: "steal", label: "Uzmi žrtveni nakit i kreni dalje", hint: "Zlato, ali možda i kletva" },
      ];
    },
  };

  SCENE.orc_chamber = {
    location: "Donja dvorana",
    title: "Karg",
    art: "orc",
    text: function () {
      return "U širokoj dvorani stoji ork širokih ramena, okružen polomljenim štitovima. Na vratu mu je ožiljak od opekotine. Podiže sekiru, ali ne udara odmah. „Zmaj je uzeo moju družinu,“ reži. „A ti? Lopov, ili neko ko ide da ga ubije?“";
    },
    onEnter: function () { log("Pred tobom stoji ork Karg.", "gold"); },
    choices: function () {
      const list = [];
      if (hero().potions > 0 && hero().hp < hero().hpMax) {
        list.push({ id: "orc_potion", label: "Popij napitak pre razgovora", hint: "2k4+2 života" });
      }
      list.push({ id: "ally", label: "Ponudi mu dogovor protiv zmaja", hint: "Ubeđivanje (HA) · 14" });
      list.push({ id: "intimidate", label: "Zapreti mu da ti se skloni s puta", hint: "Zastrašivanje (HA) · 15" });
      list.push({ id: "fight_orc", label: "Napadni odmah", hint: "Borba na poteze" });
      return list;
    },
  };

  SCENE.treasure = {
    location: "Ostava pred brlogom",
    title: "Tiho zlato",
    art: "treasure",
    text: function () {
      return "Mala ostava puna je starih kovanica, poplutenog platna i jedne zatvorene bočice. Iza teških zavesa od lanca čuje se duboko, sporo disanje. Zmaj je blizu. Ovo je poslednje mesto gde možeš da predahneš.";
    },
    onEnter: function () {
      if (!state.flags.treasureTaken) {
        state.flags.treasureTaken = true;
        addGold(25);
        addPotion(1);
        if (!hero().flags.amulet) {
          hero().flags.amulet = true;
          computeAC(hero());
          addItem({ id: "amulet", name: "Amulet iskre", desc: "Stari mesingani amulet. +1 na klasu oklopa." });
        }
        if (!hero().inventory.some(function (i) { return i.id === "greater"; })) {
          addItem({ id: "greater", name: "Veći napitak lečenja", desc: "Jednom vraća 4k4+4 života." });
          state.flags.hasGreater = true;
        }
        grantXp(100);
      }
    },
    choices: function () {
      const list = [];
      if (state.flags.hasGreater) list.push({ id: "drink_greater", label: "Popij veći napitak lečenja", hint: "4k4+4 života" });
      if (!state.flags.shortRested) list.push({ id: "rest", label: "Predahni i povij rane", hint: "Kocka života + izdržljivost. Čarobnjak vraća jedan okvir." });
      if (hero().potions > 0 && hero().hp < hero().hpMax) {
        list.push({ id: "treasure_potion", label: "Popij običan napitak", hint: "2k4+2, ostaje " + hero().potions });
      }
      list.push({ id: "to_lair", label: "Siđi u brlog", hint: "Zaros te čeka" });
      return list;
    },
  };

  SCENE.lair = {
    location: "Brlog Orlova kamena",
    title: "Zaros",
    art: "dragon",
    text: function () {
      return "Dvorana je široka kao krčma i crkva zajedno. Po podu su rasute kovanice, a na hrpi leži crveni zmaj. Jedno krilo je pocepano i zgrčeno, ali oči su žive, gladne i pametne. Zaros podiže glavu. Vazduh postaje vruć.";
    },
    onEnter: function () { log("Ulaziš u brlog zmaja Zarosa.", "gold"); },
    choices: function () {
      const list = [];
      if (hero().potions > 0 && hero().hp < hero().hpMax) {
        list.push({ id: "lair_potion", label: "Popij napitak pre borbe", hint: "2k4+2 života" });
      }
      if (state.flags.hasGreater) list.push({ id: "lair_greater", label: "Popij veći napitak pre borbe", hint: "4k4+4 života" });
      list.push({ id: "talk_dragon", label: "Progovori i pokušaj da ga zadržiš rečima", hint: "Ubeđivanje (HA) · 16, prednost u prvom udarcu" });
      list.push({ id: "fight_dragon", label: "Kreni u borbu", hint: "Poslednja bitka" });
      return list;
    },
  };

  SCENE.victory = {
    location: "Orlov kamen",
    title: "Kocka je pala kako treba",
    art: "victory",
    text: function () {
      const h = hero();
      return "Zaros više ne diže glavu. Vatra u dvorani se gasi, a selo na ivici šume može ponovo da diše. " + h.name + ", " + h.className.toLowerCase() + " " + h.level + ". nivoa, stoji iznad tihog brloga sa " + h.gold + " zlatnika u torbi. Priča je gotova — a kocka je, ovog puta, bila na tvojoj strani.";
    },
    onEnter: function () {
      state.ending = "victory";
      log("Zaros pada. Avantura je završena.", "good");
    },
    choices: function () {
      return [{ id: "new_game", label: "Nova avantura", hint: "Počni ispočetka" }];
    },
  };

  SCENE.combat_won = {
    location: function () { return (SCENE[state.flags.winReturn] || {}).location || "Put"; },
    title: "Tišina posle borbe",
    art: function () { return state.flags.winArt || "dungeon"; },
    text: function () { return (state.flags.winText || "Protivnik je pao. Možeš da kreneš dalje.") + " Predahneš samo koliko treba da poviješ rane, pa ideš dalje."; },
    onEnter: function () {
      const h = hero();
      const rolled = rollDice(1, 4, "predah");
      const heal = Math.max(1, rolled.sum + Math.max(0, h.mods.con));
      h.hp = Math.min(h.hpMax, h.hp + heal);
      log("Predahneš i poviješ rane: +" + heal + " života.", "good");
      if (h.slots && slotLeft(h, 1) < h.slots[1].max) {
        h.slots[1].used = Math.max(0, h.slots[1].used - 1);
        log("Jedan okvir čarolije ti se vraća.", "good");
      }
    },
    choices: function () {
      return [{ id: "continue", label: "Nastavi", hint: "Dalje niz priču" }];
    },
  };

  const WIN_FLAVOR = {
    forest_after: { text: "Goblin izviđači padaju u lišće. U njihovim torbama ima nekoliko kovanica i miris jeftinog piva.", art: "forest" },
    shrine: { text: "Kostur se raspe po kamenu. Sečivo mu ostaje, ali zakletva je prekinuta. Hodnik se otvara dalje, prema svetilištu.", art: "skeleton" },
    treasure: { text: "Karg pada na jedno koleno, pa na oba. Predaje ti sekiru i kima glavom, kao ratnik ratniku, pre nego što utihne.", art: "orc" },
  };

  endCombatWin = function () {
    const c = state.combat;
    const xp = c.enemies.reduce(function (s, e) { return s + (e.xp || 0); }, 0);
    const gold = c.enemies.reduce(function (s, e) { return s + (e.gold || 0); }, 0);
    log("Pobeda nad: " + c.enemies.map(function (e) { return e.name; }).join(", ") + ".", "good");
    if (gold) addGold(gold);
    if (c.enemies.some(function (e) { return e.kind === "orc"; }) && !hero().inventory.some(function (i) { return i.id === "axe"; })) {
      if (hero().classId === "ratnik") {
        hero().weapon = { name: "Kargova sekira", die: 10, able: "str" };
        addItem({ id: "axe", name: "Kargova sekira", desc: "Teška sekira. Šteta 1k10 + snaga." });
      } else {
        addItem({ id: "axe", name: "Kargova sekira", desc: "Teška sekira. Ostaje ti kao trofej." });
        addGold(8);
      }
    }
    const next = c.onWinScene;
    state.combat = null;
    state.reaction = null;
    grantXp(xp);
    if (next === "victory") {
      go("victory");
      return;
    }
    const fl = WIN_FLAVOR[next] || { text: "Protivnik je pao. Možeš da kreneš dalje.", art: "dungeon" };
    state.flags.winReturn = next;
    state.flags.winText = fl.text;
    state.flags.winArt = fl.art;
    delete state.flags.entered_combat_won;
    go("combat_won");
  };


  function choose(choiceId) {
    if (state.ending === "defeat") return null;
    if (state.pendingLevelUp) return null;
    if (state.combat && state.scene !== "combat_won") return null;
    clearRolls();
    const sc = state.scene;

    if (choiceId === "new_game") return "NEW_GAME";
    if (choiceId === "continue" && sc === "combat_won") {
      go(state.flags.winReturn);
      return;
    }

    if (sc === "tavern") {
      if (choiceId === "mira") {
        state.flags.talkedMira = true;
        const res = check("persuade", 11);
        if (res.success) {
          state.flags.miraOil = true;
          grantXp(50);
          log("Mira ti tiho kaže da zmaj diše vatrom. Ima ulje koje prepolovljava opekotine, ako imaš 20 zlatnika. I još: u razvalinama čuva se stari kostur, a ispod je ork koji je izgubio družinu.", "good");
        } else {
          log("Mira slegne ramenima. „Pričaju se svakakve stvari. Ako ideš gore, povedi napitak.“", "normal");
          grantXp(20);
        }
        return;
      }
      if (choiceId === "branko") {
        state.flags.talkedBranko = true;
        const res = check("intimidate", 13);
        if (res.success) {
          state.flags.secretPath = true;
          addGold(5);
          grantXp(40);
          log("Branko podigne ruke. Kaže ti za uski prolaz levo od dveri, iza paprati — tuda se zaobilazi prva zamka.", "good");
        } else {
          log("Branko se nasmeje i gurne te kriglom u rame. Ništa korisno ne kaže, samo te zaboli.", "bad");
          hero().hp = Math.max(1, hero().hp - 1);
        }
        return;
      }
      if (choiceId === "buy_potion") {
        if (hero().gold < 15) return;
        hero().gold -= 15;
        state.flags.boughtPotion = true;
        addPotion(1);
        return;
      }
      if (choiceId === "buy_oil") {
        if (hero().gold < 20 || hero().flags.fireResist) return;
        hero().gold -= 20;
        state.flags.boughtOil = true;
        hero().flags.fireResist = true;
        addItem({ id: "oil", name: "Ulje protiv vatre", desc: "Prepolovljuje štetu od vatre." });
        return;
      }
      if (choiceId === "leave") {
        go("forest_edge");
        return;
      }
    }

    if (sc === "forest_edge") {
      if (choiceId === "road") {
        log("Ideš otvorenim putem. Goblini te vide izdaleka i jure niz kosu.", "bad");
        startCombat(goblins(false), "forest_after", "Zaseda na trgovačkom putu!");
        return;
      }
      if (choiceId === "brush") {
        const res = check("stealth", 13);
        if (res.success) {
          state.flags.surprisedGoblins = true;
          log("Provlačiš se kroz žbunje i izlaziš goblinima iza leđa.", "good");
          grantXp(30);
          startCombat(goblins(true), "forest_after", "Iznenadio si gobline!");
        } else {
          log("Grančica puca pod nogom. Omča se zateže iz lišća.", "bad");
          go("forest_snare");
        }
        return;
      }
    }

    if (sc === "forest_snare") {
      if (choiceId === "snare_save") {
        const res = savingThrow("dex", 12);
        if (!res.success) {
          const rolled = rollDice(1, 4, "omča");
          hero().hp = Math.max(1, hero().hp - rolled.sum);
          log("Omča te uhvati za gležanj i ošine o zemlju: " + rolled.sum + " štete.", "bad");
        } else {
          log("Iskačeš na vreme. Užad ostaje prazna.", "good");
        }
        startCombat(goblins(false), "forest_after", "Goblini nailaze dok se dižeš!");
        return;
      }
    }

    if (sc === "forest_after") {
      if (choiceId === "help_luka") {
        state.flags.lukaDone = true;
        state.flags.lukaFriend = true;
        addPotion(1);
        grantXp(50);
        log("Luka ti zahvaljuje kroz plač i daje ti svoj poslednji napitak. „U razvalinama čuva kostur, a ispod je nešto gore. Ako stigneš do svetilišta, ostavi dar — stari glas voli poštovanje.“", "good");
        return;
      }
      if (choiceId === "ask_luka") {
        state.flags.lukaDone = true;
        const res = check("persuade", 10);
        if (res.success) {
          grantXp(40);
          addGold(4);
          log("Luka ti nacrta prstima put: dveri, hodnik sa pločama, pa dvorana čuvara. Gura ti i par kovanica.", "good");
        } else {
          grantXp(15);
          log("Luka samo trese glavom i mrmlja o kostima i vatri. Više od toga ne može da sastavi.", "normal");
        }
        return;
      }
      if (choiceId === "search_luka") {
        state.flags.lukaDone = true;
        state.flags.lukaRobbed = true;
        addGold(9);
        log("Uzimaš mu torbu. Luka ne viče — samo te gleda. U selu se ovakve stvari ne zaboravljaju.", "bad");
        return;
      }
      if (choiceId === "to_gate") {
        if (!state.flags.lukaDone) log("Ostaviš Luku iza točka i ideš dalje.", "normal");
        go("dungeon_gate");
        return;
      }
    }

    if (sc === "dungeon_gate") {
      function enterTrap() { go("dungeon_trap"); }
      function enterQuiet() {
        state.flags.skippedTrap = true;
        grantXp(40);
        log("Ulaziš tiho, mimo prve zamke.", "good");
        go("skeleton_hall");
      }
      if (choiceId === "secret") {
        if (!state.flags.secretPath) return;
        enterQuiet();
        return;
      }
      if (choiceId === "lockpick") {
        const res = check("lockpick", 13);
        if (res.success) {
          grantXp(30);
          log("Brava klikne. Vrata se otvore bez buke.", "good");
          enterTrap();
        } else {
          log("Brava ne popušta. Moraš drugim putem, ili snagom.", "normal");
        }
        return;
      }
      if (choiceId === "bash") {
        const res = check("athletics", 15);
        if (res.success) {
          grantXp(25);
          log("Vrata se sruše uz trešak. Što god je unutra, sada zna da dolaziš.", "normal");
          state.flags.madeNoise = true;
          enterTrap();
        } else {
          const rolled = rollDice(1, 4, "udarac u vrata");
          hero().hp = Math.max(1, hero().hp - rolled.sum);
          log("Vrata stoje, a rame ti otkazuje: " + rolled.sum + " štete. Možeš da pokušaš ponovo ili drugi način.", "bad");
        }
        return;
      }
      if (choiceId === "search_entrance") {
        const res = check("investigate", 12);
        if (res.success) {
          grantXp(35);
          log("Iza obrušenog zida nalaziš rupu dovoljno široku da se provučeš.", "good");
          enterQuiet();
        } else {
          log("Sve izgleda isto: čvrst kamen i zarđala brava. Moraš kroz dveri.", "normal");
        }
        return;
      }
    }

    if (sc === "dungeon_trap") {
      if (choiceId === "disarm") {
        const res = check("disable", 12);
        if (res.success) {
          grantXp(40);
          log("Ploča se ne spušta. Igla u zidu ostaje gde jeste.", "good");
          go("skeleton_hall");
        } else {
          log("Ploča klikne pod prstima.", "bad");
          const save = savingThrow("dex", 13);
          if (!save.success) {
            const rolled = rollDice(1, 8, "strelica");
            hero().hp = Math.max(1, hero().hp - rolled.sum);
            log("Strelica te ogrebe: " + rolled.sum + " štete.", "bad");
          } else {
            log("Bacaš se u stranu i strelica pogađa zid.", "good");
          }
          go("skeleton_hall");
        }
        return;
      }
      if (choiceId === "walk") {
        const save = savingThrow("dex", 13, { disadvantage: !!state.flags.madeNoise });
        if (!save.success) {
          const rolled = rollDice(1, 8, "strelica");
          hero().hp = Math.max(1, hero().hp - rolled.sum);
          log("Zamka se okine. Strelica te pogodi: " + rolled.sum + " štete.", "bad");
        } else {
          grantXp(15);
          log("Prolaziš tačno između ploča.", "good");
        }
        go("skeleton_hall");
        return;
      }
    }

    if (sc === "skeleton_hall") {
      if (choiceId === "skel_potion") {
        drinkPotion();
        return;
      }
      if (choiceId === "sneak_skel") {
        const dc = state.flags.madeNoise ? 17 : 15;
        const res = check("stealth", dc);
        if (res.success) {
          grantXp(80);
          log("Kostur ne pomera glavu. Provlačiš se uz zid i ostavljaš zakletnika za sobom.", "good");
          go("shrine");
        } else {
          log("Kamen škrine pod čizmom. Kostur podiže sečivo.", "bad");
          startCombat(skeletonFoe(), "shrine", "Kostur čuvar kreće na tebe!");
        }
        return;
      }
      if (choiceId === "fight_skel") {
        startCombat(skeletonFoe(), "shrine", "Prihvataš borbu sa čuvarom.");
        return;
      }
    }

    if (sc === "shrine") {
      if (choiceId === "persuade_spirit") {
        const res = check("persuade", 13);
        if (res.success) {
          hero().flags.bless = true;
          hero().flags.fireResist = true;
          grantXp(75);
          addItem({ id: "blessing", name: "Blagoslov svetilišta", desc: "+1 na sve spasilačke bacaje i otpornost na vatru." });
          log("Glas omekša. „Onda idi. Vatra neće uzeti sve.“ Osećaš toplinu u grudima, ali ne onu koja peče.", "good");
        } else {
          grantXp(20);
          log("Glas ostaje hladan. „Reči su jeftine. Idi, ako smeš.“", "normal");
        }
        go("orc_chamber");
        return;
      }
      if (choiceId === "gift") {
        if (hero().gold < 10) return;
        hero().gold -= 10;
        hero().flags.fireResist = true;
        grantXp(50);
        addItem({ id: "oil", name: "Dar svetilišta", desc: "Otpornost na vatru." });
        log("Kovanice nestanu u posudi bez zvuka. Vazduh postaje blago hladniji, kao pred kišu.", "good");
        go("orc_chamber");
        return;
      }
      if (choiceId === "steal") {
        addGold(25);
        hero().flags.curse = true;
        log("Uzimaš nakit. Glas utihne, a rame ti oteža. Osećaš da će ti spasovi odsad teže padati.", "bad");
        addItem({ id: "curse", name: "Uzeti nakit", desc: "Vredi 25 zlata, ali nosi kletvu: −1 na spasilačke bacaje." });
        go("orc_chamber");
        return;
      }
    }

    if (sc === "orc_chamber") {
      if (choiceId === "orc_potion") {
        drinkPotion();
        return;
      }
      if (choiceId === "ally") {
        const res = check("persuade", 14);
        if (res.success) {
          grantXp(120);
          addPotion(1);
          state.flags.kargAlly = true;
          if (hero().classId === "ratnik" && !hero().inventory.some(function (i) { return i.id === "axe"; })) {
            hero().weapon = { name: "Kargova sekira", die: 10, able: "str" };
            addItem({ id: "axe", name: "Kargova sekira", desc: "Pozajmljena, pa poklonjena. Šteta 1k10 + snaga." });
          } else {
            addGold(10);
          }
          log("Karg spusti sekiru. „Onda idi i dokrajči ga. Ovo ti je od mene.“ Pušta te dalje i daje ti zalihe.", "good");
          go("treasure");
        } else {
          log("Karg se nakosti. „Priče. Ja verujem čeliku.“", "bad");
          startCombat(orcFoe(), "treasure", "Karg juri na tebe!");
        }
        return;
      }
      if (choiceId === "intimidate") {
        const res = check("intimidate", 15);
        if (res.success) {
          grantXp(80);
          addGold(12);
          log("Karg odmeri tvoj stav, pljune u prašinu i ustupi put. Iza njega ostaje kesa kovanica.", "good");
          go("treasure");
        } else {
          log("Karg se nasmeje i zavitla sekiru. Nisi ga uplašio — samo razljutio.", "bad");
          startCombat(orcFoe(), "treasure", "Karg napada besno!");
        }
        return;
      }
      if (choiceId === "fight_orc") {
        startCombat(orcFoe(), "treasure", "Sekire i čelik.");
        return;
      }
    }

    if (sc === "treasure") {
      if (choiceId === "drink_greater") {
        if (!state.flags.hasGreater) return;
        state.flags.hasGreater = false;
        hero().inventory = hero().inventory.filter(function (i) { return i.id !== "greater"; });
        healPotion("greater");
        return;
      }
      if (choiceId === "treasure_potion") {
        drinkPotion();
        return;
      }
      if (choiceId === "rest") {
        if (state.flags.shortRested) return;
        state.flags.shortRested = true;
        const cls = CLASSES[hero().classId];
        const rolled = rollDice(1, cls.hitDie, "odmor");
        const heal = Math.max(1, rolled.sum + hero().mods.con);
        hero().hp = Math.min(hero().hpMax, hero().hp + heal);
        log("Predahneš u tišini ostave i poviješ rane: +" + heal + " života.", "good");
        if (hero().slots && slotLeft(hero(), 1) < hero().slots[1].max) {
          hero().slots[1].used = Math.max(0, hero().slots[1].used - 1);
          log("Jedan okvir čarolije ti se vraća.", "good");
        }
        if (hero().classId === "ratnik" && hero().uses.secondWind < hero().uses.secondWindMax) {
          hero().uses.secondWind = hero().uses.secondWindMax;
          log("Drugi dah ti se obnavlja.", "good");
        }
        grantXp(25);
        return;
      }
      if (choiceId === "to_lair") {
        go("lair");
        return;
      }
    }

    if (sc === "lair") {
      if (choiceId === "lair_potion") {
        drinkPotion();
        return;
      }
      if (choiceId === "lair_greater") {
        if (!state.flags.hasGreater) return;
        state.flags.hasGreater = false;
        hero().inventory = hero().inventory.filter(function (i) { return i.id !== "greater"; });
        healPotion("greater");
        return;
      }
      if (choiceId === "talk_dragon") {
        const res = check("persuade", 16);
        if (res.success) {
          state.flags.dragonHesitate = true;
          grantXp(40);
          log("Zaros te sasluša jedan udah duže nego što mora. To je dovoljno da zakoračiš prvi.", "good");
        } else {
          log("Zaros samo zakotrlja smeh niz dvoranu. Pregovor je gotov.", "normal");
        }
        const dr = dragonFoe();
        if (state.flags.dragonHesitate) dr[0].tags = { skipFirst: true };
        dr[0].breathReady = false;
        startCombat(dr, "victory", "Zaros širi vrat i spušta se s hrpe zlata.");
        return;
      }
      if (choiceId === "fight_dragon") {
        const dr = dragonFoe();
        dr[0].breathReady = false;
        startCombat(dr, "victory", "Zaros širi vrat i spušta se s hrpe zlata.");
        return;
      }
    }
  }


  function sceneView() {
    const id = state.scene;
    const sc = SCENE[id];
    if (!sc) return { location: "", title: "", text: "", art: "tavern", choices: [], sceneId: id };
    const location = typeof sc.location === "function" ? sc.location() : sc.location;
    const title = typeof sc.title === "function" ? sc.title() : sc.title;
    const text = typeof sc.text === "function" ? sc.text() : sc.text;
    const art = typeof sc.art === "function" ? sc.art() : sc.art;
    const choices = state.ending === "defeat" ? [] : (sc.choices ? sc.choices() : []);
    return { location: location, title: title, text: text, art: art, choices: choices, sceneId: id };
  }

  function publicHero() {
    const h = hero();
    if (!h) return null;
    const saves = {};
    const ableKeys = Object.keys(ABILITY_NAMES);
    for (let i = 0; i < ableKeys.length; i++) saves[ableKeys[i]] = saveMod(h, ableKeys[i]);
    const skills = {};
    const skillKeys = Object.keys(SKILL_NAMES);
    for (let j = 0; j < skillKeys.length; j++) {
      const id = skillKeys[j];
      skills[id] = skillMod(h, id);
    }
    return {
      name: h.name,
      classId: h.classId,
      className: h.className,
      level: h.level,
      xp: h.xp,
      xpNext: h.level >= 3 ? null : XP_TABLE[h.level + 1],
      mods: Object.assign({}, h.mods),
      prof: h.prof,
      hp: h.hp,
      hpMax: h.hpMax,
      ac: h.ac,
      gold: h.gold,
      potions: h.potions,
      inventory: h.inventory.map(function (i) { return { id: i.id, name: i.name, desc: i.desc }; }),
      slots: h.slots ? deepClone(h.slots) : null,
      uses: Object.assign({}, h.uses),
      weapon: Object.assign({}, h.weapon),
      flags: Object.assign({}, h.flags),
      saves: saves,
      skills: skills,
      sneakDice: h.classId === "lopov" ? sneakDice(h) : 0,
      spellDC: h.slots ? spellDC(h) : null,
      spellAtk: h.slots ? spellAtk(h) : null,
    };
  }

  function combatActions() {
    if (!state.combat || state.ending || state.reaction) return [];
    const unit = state.combat.order[state.combat.index];
    if (!unit || unit.type !== "player") return [];
    const h = hero();
    const c = state.combat;
    const acts = [];
    acts.push({
      id: "attack",
      label: "Napad",
      hint: h.weapon.name + " · k" + h.weapon.die + " " + signed(h.mods[h.weapon.able]) + (h.classId === "ratnik" && h.level >= 3 ? " (dva udarca)" : ""),
    });
    if (h.classId === "ratnik" && h.uses.strongHit > 0 && !c.strongUsed) {
      acts.push({ id: "strong", label: "Snažan udarac", hint: "Napad +2 i +1k8 štete, jednom u borbi" });
    }
    if (h.classId === "ratnik" && h.uses.secondWind > 0 && !c.bonusUsed) {
      acts.push({ id: "secondWind", label: "Drugi dah", hint: "1k10 + nivo života, ne troši ceo potez" });
    }
    if (h.classId === "lopov") {
      acts.push({ id: "sneak", label: "Napad iz senke", hint: "Prikrivanje, pa napad sa prednošću i +" + sneakDice(h) + "k6" });
    }
    if (h.classId === "carobnjak") {
      acts.push({ id: "cantrip", label: "Vatrena iskra", hint: "Napad čarolijom, 1k10, bez okvira" });
      const s1 = slotLeft(h, 1);
      acts.push({
        id: "spell:missile",
        label: "Čarobni projektil",
        hint: "Uvek pogađa, 3k4+3 · okvir 1 (" + s1 + ")",
        disabled: s1 <= 0,
        why: "Nemaš okvir prvog stepena.",
      });
      if (!h.flags.mageArmor) {
        acts.push({ id: "spell:armor", label: "Magični oklop", hint: "KO 13 + spretnost · okvir 1", disabled: s1 <= 0 });
      }
      if (h.level >= 3) {
        const s2 = slotLeft(h, 2);
        acts.push({
          id: "spell:thunder",
          label: "Grom",
          hint: "3k8, spas izdržljivosti · okvir 2 (" + s2 + ")",
          disabled: s2 <= 0,
          why: "Nemaš okvir drugog stepena.",
        });
      }
    }
    acts.push({
      id: "potion",
      label: "Napitak lečenja",
      hint: h.potions ? "2k4+2 · ostaje " + h.potions : "Nemaš napitak",
      disabled: h.potions <= 0 || h.hp >= h.hpMax,
      why: h.potions <= 0 ? "Nemaš napitak." : "Već si na punom životu.",
    });
    acts.push({ id: "dodge", label: "Oprez", hint: "Neprijatelji ovu rundu teže pogađaju" });
    return acts;
  }

  function getView() {
    const sv = sceneView();
    const defeated = state.ending === "defeat";
    return {
      sceneId: state.scene,
      location: sv.location,
      title: defeated ? "Pad" : sv.title,
      text: defeated
        ? "Padaš na tlo. Avantura se ovde prekida, ali kocka može da se baci ponovo."
        : sv.text,
      art: defeated ? "defeat" : sv.art,
      hero: publicHero(),
      enemies: state.combat
        ? state.combat.enemies.map(function (e) {
            return { id: e.id, name: e.name, art: e.art, hp: e.hp, hpMax: e.hpMax, ac: e.ac, alive: e.alive, kind: e.kind };
          })
        : [],
      inCombat: !!(state.combat && state.ending !== "victory"),
      playerTurn: !!(
        state.combat &&
        !state.reaction &&
        !state.ending &&
        state.combat.order[state.combat.index] &&
        state.combat.order[state.combat.index].type === "player"
      ),
      round: state.combat ? state.combat.round : 0,
      choices: state.combat && !defeated && state.scene !== "combat_won" ? [] : sv.choices || [],
      combatActions: combatActions(),
      reaction: state.reaction,
      levelUp: state.pendingLevelUp,
      log: state.log.slice(),
      rolls: state.rolls.slice(),
      ending: state.ending,
      hidden: !!(state.combat && state.combat.hidden),
    };
  }

  function serialize() {
    return deepClone({
      hero: state.hero,
      scene: state.scene,
      flags: state.flags,
      log: state.log,
      pendingLevelUp: state.pendingLevelUp,
      ending: state.ending,
      combat: state.combat,
      combatSnapshot: state.combatSnapshot,
      reaction: state.reaction,
    });
  }

  function restore(data) {
    if (!data || !data.hero) return false;
    state.hero = data.hero;
    state.scene = data.scene;
    state.flags = data.flags || {};
    state.log = data.log || [];
    state.pendingLevelUp = data.pendingLevelUp || null;
    state.ending = data.ending || null;
    state.combat = data.combat || null;
    state.combatSnapshot = data.combatSnapshot || null;
    state.reaction = data.reaction || null;
    state.rolls = [];
    if (state.hero) computeAC(state.hero);
    return true;
  }

  function retryCombat() {
    if (!state.combatSnapshot) return false;
    const snap = deepClone(state.combatSnapshot);
    state.hero = snap.hero;
    state.scene = snap.scene;
    state.flags = snap.flags;
    state.log = snap.log || [];
    state.pendingLevelUp = snap.pendingLevelUp;
    state.ending = null;
    state.combat = null;
    state.reaction = null;
    state.rolls = [];
    if (state.hero) computeAC(state.hero);
    log("Bacaš kocku ponovo, iz iste dvorane.", "gold");
    return true;
  }

  function start(opts) {
    opts = opts || {};
    const classId = opts.classId;
    if (!CLASSES[classId]) throw new Error("Nepoznat lik: " + classId);
    state.hero = makeHero(opts.name, classId);
    state.scene = "tavern";
    state.flags = {};
    state.log = [];
    state.rolls = [];
    state.combat = null;
    state.pendingLevelUp = null;
    state.reaction = null;
    state.ending = null;
    state.combatSnapshot = null;
    if (SCENE.tavern.onEnter) {
      state.flags.entered_tavern = true;
      SCENE.tavern.onEnter();
    }
  }

  function ackLevelUp() {
    state.pendingLevelUp = null;
  }

  return {
    start: start,
    choose: choose,
    combat: combatAction,
    react: applyReaction,
    ackLevelUp: ackLevelUp,
    retryCombat: retryCombat,
    getView: getView,
    serialize: serialize,
    restore: restore,
    clearRolls: clearRolls,
  };
}
