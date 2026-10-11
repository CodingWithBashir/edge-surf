/**
 * Persistence tests: settings, wallet, cosmetics, achievements and the local
 * records table. Uses the in-memory backend so they run anywhere.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SaveManager, createMemoryStorage, DEFAULT_SETTINGS, STORAGE_KEY } from '../src/storage/SaveManager.js';
import { ACHIEVEMENTS, CHARACTERS, BOARDS, isStarter } from '../src/game/config/Content.js';

function freshSave() {
  return new SaveManager({ storage: createMemoryStorage(), debounceMs: 0 });
}

const snapshot = (overrides = {}) => ({
  modeId: 'endless',
  score: 1000,
  distance: 800,
  coins: 20,
  walletCoins: 240,
  shells: 1,
  pearls: 0,
  combo: 12,
  bestMultiplier: 2,
  jumps: 15,
  landings: 14,
  nearMisses: 4,
  obstaclesPassed: 30,
  hits: 1,
  powerUpsTaken: 2,
  krakenEscapes: 0,
  topSpeed: 30,
  bestCleanDistance: 500,
  cleanDistance: 200,
  time: 42,
  breakdown: { distance: 600, pickups: 300, bonus: 100, events: 0 },
  ...overrides,
});

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

test('a new save starts with documented defaults', () => {
  const save = freshSave();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    assert.deepEqual(save.getSetting(key), value, `default ${key}`);
  }
  assert.equal(save.coins, 0);
  assert.equal(save.stats.runs, 0);
  assert.equal(save.selectedCharacter, CHARACTERS[0].id);
  assert.equal(save.selectedBoard, BOARDS[0].id);
});

test('settings round-trip through storage', () => {
  const storage = createMemoryStorage();
  const save = new SaveManager({ storage, debounceMs: 0 });
  save.setSetting('master', 0.42);
  save.setSetting('reduceMotion', true);
  save.flush();
  assert.ok(storage.getItem(STORAGE_KEY), 'something was written');

  const reloaded = new SaveManager({ storage, debounceMs: 0 });
  assert.equal(reloaded.getSetting('master'), 0.42);
  assert.equal(reloaded.getSetting('reduceMotion'), true);
});

test('unknown setting keys are ignored', () => {
  const save = freshSave();
  save.setSetting('notAThing', 5);
  assert.equal(save.getSetting('notAThing'), undefined);
});

test('a corrupt save falls back to defaults instead of throwing', () => {
  const storage = createMemoryStorage();
  storage.setItem(STORAGE_KEY, '{not json');
  const save = new SaveManager({ storage, debounceMs: 0 });
  assert.equal(save.stats.runs, 0);
  assert.equal(save.coins, 0);
});

test('a save written by an older version is migrated', () => {
  const storage = createMemoryStorage();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 0,
      coins: 120,
      stats: { runs: 3, bestScore: 999 },
      settings: { master: 0.3 },
      selectedCharacter: 'does-not-exist',
    })
  );
  const save = new SaveManager({ storage, debounceMs: 0 });
  assert.equal(save.coins, 120, 'known fields survive');
  assert.equal(save.stats.runs, 3);
  assert.equal(save.stats.bestScore, 999);
  assert.equal(save.getSetting('master'), 0.3);
  assert.equal(save.getSetting('music'), DEFAULT_SETTINGS.music, 'missing fields filled in');
  assert.equal(save.selectedCharacter, CHARACTERS[0].id, 'invalid cosmetic reset');
});

test('a storage backend that throws on write does not break the game', () => {
  const hostile = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceeded');
    },
    removeItem: () => {},
  };
  const save = new SaveManager({ storage: hostile, debounceMs: 0 });
  assert.equal(save.save(), false);
  save.setSetting('sfx', 0.5);
  assert.equal(save.getSetting('sfx'), 0.5, 'the value is still applied in memory');
});

test('flush() cancels a pending debounced write', () => {
  const storage = createMemoryStorage();
  const save = new SaveManager({ storage, debounceMs: 500 });
  save.setSetting('music', 0.11);
  save.flush();
  const reloaded = new SaveManager({ storage, debounceMs: 0 });
  assert.equal(reloaded.getSetting('music'), 0.11);
});

/* ------------------------------------------------------------------ *
 * Wallet & cosmetics
 * ------------------------------------------------------------------ */

test('coins can be earned and spent', () => {
  const save = freshSave();
  save.addCoins(500);
  assert.equal(save.coins, 500);
  assert.equal(save.spendCoins(200), true);
  assert.equal(save.coins, 300);
  assert.equal(save.spendCoins(9999), false, 'cannot overspend');
  assert.equal(save.coins, 300, 'balance untouched after a failed purchase');
});

test('free cosmetics are owned from the start', () => {
  const save = freshSave();
  for (const character of CHARACTERS.filter(isStarter)) {
    assert.equal(save.owns('character', character.id), true, `${character.id} is a starter`);
  }
  for (const board of BOARDS.filter(isStarter)) {
    assert.equal(save.owns('board', board.id), true, `${board.id} is a starter`);
  }
  for (const character of CHARACTERS.filter((c) => !isStarter(c))) {
    assert.equal(save.owns('character', character.id), false, `${character.id} starts locked`);
  }
});

test('purchasing moves coins and unlocks the cosmetic', () => {
  const save = freshSave();
  const mira = CHARACTERS.find((c) => c.id === 'mira');
  assert.equal(save.purchase('character', mira).ok, false, 'not enough coins yet');

  save.addCoins(mira.cost);
  assert.equal(save.purchase('character', mira).ok, true);
  assert.equal(save.coins, 0);
  assert.equal(save.owns('character', mira.id), true);
  assert.equal(save.purchase('character', mira).ok, false, 'cannot buy twice');
});

test('achievement-gated cosmetics unlock when the achievement lands', () => {
  const save = freshSave();
  const sora = CHARACTERS.find((c) => c.id === 'sora');
  const krakenBoard = BOARDS.find((b) => b.id === 'kraken');
  assert.equal(save.owns('character', sora.id), false);
  assert.equal(save.owns('board', krakenBoard.id), false);

  save.data.stats.krakenEscapes = 1;
  const unlocked = save.evaluateAchievements();
  assert.ok(unlocked.some((a) => a.def.id === 'krakenEscapee'));
  assert.equal(save.owns('character', sora.id), true);
  assert.equal(save.owns('board', krakenBoard.id), true);
});

test('distance- and coin-gated cosmetics unlock from stats', () => {
  const save = freshSave();
  const tama = CHARACTERS.find((c) => c.unlock?.type === 'distance');
  save.data.stats.totalDistance = tama.unlock.value + 1;
  save.syncAchievementUnlocks();
  assert.equal(save.owns('character', tama.id), true);
});

test('selecting requires ownership', () => {
  const save = freshSave();
  const locked = CHARACTERS.find((c) => c.unlock);
  assert.equal(save.select('character', locked.id), false);
  assert.equal(save.selectedCharacter, CHARACTERS[0].id);
  assert.equal(save.select('character', CHARACTERS[1].id), true);
  assert.equal(save.selectedCharacter, CHARACTERS[1].id);
});

/* ------------------------------------------------------------------ *
 * Achievements
 * ------------------------------------------------------------------ */

test('achievements only unlock from real gameplay stats', () => {
  const save = freshSave();
  assert.equal(save.evaluateAchievements().length, 0, 'nothing unlocked on a fresh save');

  save.recordRun(snapshot({ distance: 1200 }), { modeId: 'endless' });
  assert.equal(save.isUnlocked('firstDrop'), true, 'finishing a run counts');
  assert.equal(save.isUnlocked('mileOne'), true, '1 km in one run');
  assert.equal(save.isUnlocked('marathon'), false, '10 km not reached');
});

test('unlocking an achievement pays out its coin reward once', () => {
  const save = freshSave();
  const outcome = save.recordRun(snapshot(), { modeId: 'endless' });
  const first = outcome.newAchievements;
  assert.ok(first.length > 0, 'a first run unlocks something');
  const reward = first.reduce((sum, a) => sum + a.reward, 0);
  assert.ok(reward > 0);
  assert.equal(save.evaluateAchievements().length, 0, 'no double payout');
  assert.equal(save.coins, 240 + reward, 'wallet coins plus the reward');
  for (const achievement of first) {
    assert.equal(save.isUnlocked(achievement.def.id), true);
  }
});

test('achievement progress is reported for the UI', () => {
  const save = freshSave();
  save.data.stats.totalCoins = 250;
  const summary = save.achievementSummary();
  const coinHunter = summary.find((a) => a.def.id === 'coinHunter');
  assert.equal(coinHunter.value, 250);
  assert.equal(coinHunter.target, 500);
  assert.equal(coinHunter.fraction, 0.5);
  assert.equal(coinHunter.unlocked, false);
  assert.equal(summary.length, ACHIEVEMENTS.length);
});

test('every achievement metric maps to a tracked statistic', () => {
  const save = freshSave();
  const stats = save.stats;
  for (const def of ACHIEVEMENTS) {
    assert.ok(def.metric in stats, `${def.id} metric "${def.metric}" is tracked`);
    assert.ok(def.target > 0);
    assert.ok(def.reward >= 0);
    assert.ok(def.name && def.description);
  }
});

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

test('runs are recorded, ranked and capped at ten', () => {
  const save = freshSave();
  for (let i = 1; i <= 14; i++) {
    save.recordRun(snapshot({ score: i * 100 }), { modeId: 'endless' });
  }
  const records = save.getRecords('endless');
  assert.equal(records.length, 10, 'only the top ten are kept');
  assert.equal(records[0].score, 1400, 'best first');
  assert.equal(save.bestScore('endless'), 1400);
  assert.equal(save.bestDistance('endless'), 800);
  for (let i = 1; i < records.length; i++) {
    assert.ok(records[i - 1].score >= records[i].score, 'sorted descending');
  }
});

test('records are tracked per mode', () => {
  const save = freshSave();
  save.recordRun(snapshot({ score: 500 }), { modeId: 'endless' });
  save.recordRun(snapshot({ score: 900 }), { modeId: 'timeTrial' });
  assert.equal(save.bestScore('endless'), 500);
  assert.equal(save.bestScore('timeTrial'), 900);
  assert.equal(save.getRecords('zigzag').length, 0);
});

test('practice mode never writes a record', () => {
  const save = freshSave();
  save.recordRun(snapshot({ score: 99999 }), { modeId: 'practice', recordScore: false });
  assert.equal(save.getRecords('practice').length, 0);
  assert.equal(save.bestScore('practice'), 0);
  assert.equal(save.stats.bestScore, 99999, 'lifetime stats still update');
});

test('lifetime stats accumulate across runs', () => {
  const save = freshSave();
  save.recordRun(snapshot({ distance: 500, coins: 10, jumps: 5, obstaclesPassed: 20 }), { modeId: 'endless' });
  save.recordRun(snapshot({ distance: 700, coins: 15, jumps: 6, obstaclesPassed: 25 }), { modeId: 'endless' });
  assert.equal(save.stats.runs, 2);
  assert.equal(save.stats.totalDistance, 1200);
  assert.equal(save.stats.bestDistance, 700, 'best, not sum');
  assert.equal(save.stats.totalJumps, 11);
  assert.equal(save.stats.totalObstacles, 45);
});

test('the daily challenge records one best score per date', () => {
  const save = freshSave();
  const meta = { modeId: 'daily', dateKey: '2026-10-11' };
  save.recordRun(snapshot({ score: 1000 }), meta);
  assert.equal(save.dailyBest('2026-10-11'), 1000);
  save.recordRun(snapshot({ score: 700 }), meta);
  assert.equal(save.dailyBest('2026-10-11'), 1000, 'a worse run does not overwrite');
  save.recordRun(snapshot({ score: 1500 }), meta);
  assert.equal(save.dailyBest('2026-10-11'), 1500);
  assert.equal(save.stats.dailyCompletions, 1, 'counted once per day');
  assert.equal(save.dailyBest('2026-10-12'), 0);
});

test('completing the zigzag course is recorded', () => {
  const save = freshSave();
  save.recordRun(snapshot(), { modeId: 'zigzag', completed: true });
  assert.equal(save.stats.zigzagCompletions, 1);
  save.recordRun(snapshot(), { modeId: 'zigzag', completed: false });
  assert.equal(save.stats.zigzagCompletions, 1, 'only completions count');
});

test('a run reports whether it set a new record', () => {
  const save = freshSave();
  const first = save.recordRun(snapshot({ score: 1000 }), { modeId: 'endless' });
  assert.equal(first.isRecord, true);
  const second = save.recordRun(snapshot({ score: 500 }), { modeId: 'endless' });
  assert.equal(second.isRecord, false);
});

test('reset clears everything', () => {
  const save = freshSave();
  save.addCoins(1000);
  save.recordRun(snapshot(), { modeId: 'endless' });
  save.setSetting('master', 0.1);
  save.reset();
  assert.equal(save.coins, 0);
  assert.equal(save.stats.runs, 0);
  assert.equal(save.getRecords('endless').length, 0);
  assert.equal(save.getSetting('master'), DEFAULT_SETTINGS.master);
});
