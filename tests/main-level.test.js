'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadClamp(bot) {
    const source = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8') +
        '\n;globalThis.__clampBotLevel = clampBotLevel;';
    const calls = { apply: [], save: 0 };
    const sandbox = {
        console,
        document: { addEventListener() {}, querySelectorAll() { return []; } },
        Bot: Object.assign({
            level: 1,
            isLevelUnlocked(level) { return level <= this.maxUnlockedLevel(); },
            maxUnlockedLevel() { return 3; },
            applyLevel(level) { calls.apply.push(level); this.level = level; return true; },
            save() { calls.save++; }
        }, bot || {})
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-main-bundle.js' });
    return { clamp: sandbox.__clampBotLevel, bot: sandbox.Bot, calls };
}

test('закрытый уровень из старого сохранения заменяется доступным', () => {
    const { clamp, bot, calls } = loadClamp({ level: 7 });

    clamp();

    assert.deepEqual(calls.apply, [3]);
    assert.equal(calls.save, 1);
    assert.equal(bot.level, 3);
});

test('доступный уровень не меняется', () => {
    const { clamp, calls } = loadClamp({ level: 2 });

    clamp();

    assert.deepEqual(calls.apply, []);
    assert.equal(calls.save, 0);
});
