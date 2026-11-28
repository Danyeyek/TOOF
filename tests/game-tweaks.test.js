'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const { loadBot } = require('./helpers/load-bot');

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function storageMap(initial) {
    const storage = new Map(Object.entries(initial || {}));
    return {
        storage,
        api: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, value)
        }
    };
}

test('плашка нового ранга собрана по центру экрана', () => {
    const css = read('css/style.css');
    const banner = css.match(/\.rank-banner\s*\{([^}]*)\}/);
    assert.ok(banner, 'есть стиль плашки ранга');
    assert.match(banner[1], /top:\s*50%/);
    assert.match(banner[1], /left:\s*50%/);
    assert.match(banner[1], /transform:\s*translate\(-50%,\s*-50%\)/);
    const frames = css.match(/@keyframes rank-pop\s*\{([\s\S]*?)\}/);
    assert.ok(frames, 'есть анимация плашки');
    assert.ok(!/translate\(-50%,\s*(?:0|-18px|-12px)\)/.test(frames[1]),
        'анимация не сбивает центр');
});

test('короткие сообщения о клетке помещаются в одну строку', () => {
    const ui = read('js/ui.js');
    const i18n = read('js/i18n.js');
    const css = read('css/style.css');

    assert.ok(ui.includes("setMessage('Клетка закрашена.')"));
    assert.ok(i18n.includes("'Клетка закрашена.': 'Cell painted.'"));
    assert.ok(!ui.includes('Можно зафиксировать фигуру и завершить ход'));
    assert.ok(!ui.includes('Ход не переходит — закрасьте клетку и завершите ход'));

    const message = css.match(/\.message\s*\{([^}]*)\}/);
    assert.ok(message);
    assert.match(message[1], /white-space:\s*nowrap/);
    assert.match(message[1], /text-overflow:\s*ellipsis/);
});

test('ранг из Google-аккаунта открывает уровни сложности', () => {
    const local = storageMap();
    const { Bot } = loadBot({ localStorage: local.api });
    Bot.load();

    assert.equal(Bot.maxUnlockedLevel(), 3);
    Bot.applyRemoteRank({ maxLevel: 5, rankLevel: 5, masterWins: 1 });
    assert.equal(Bot.rankName(), 'Мастер Ⅰ');
    assert.equal(Bot.maxUnlockedLevel(), 5);
    assert.ok(Bot.isLevelUnlocked(5));
    assert.ok(!Bot.isLevelUnlocked(6));

    /* Меньший ранг из аккаунта не отбирает уже заслуженный. */
    Bot.applyRemoteRank({ maxLevel: 3, rankLevel: 3, masterWins: 0 });
    assert.equal(Bot.maxUnlockedLevel(), 5);
    assert.equal(Bot.rankName(), 'Мастер Ⅰ');
});

test('аккаунт без вызова бота тоже задаёт доступный уровень', () => {
    const { Bot } = loadBot({
        localStorage: storageMap().api,
        Profile: { state: { botRank: { rankLevel: 6, maxLevel: 6, masterWins: 0 } } }
    });
    Bot.load();
    assert.equal(Bot.maxUnlockedLevel(), 6);
    assert.ok(Bot.isLevelUnlocked(6));
});

function loadProfile(options) {
    const opts = options || {};
    const local = storageMap(opts.localStorage);
    const written = [];
    const applied = [];
    const events = [];
    const remoteUid = 'me';
    const remoteProfile = Object.assign({
        name: 'Удалённый', code: 'ABC123', registered: true,
        stats: { wins: 1, losses: 0, draws: 0 }, rank: 0, ladder: []
    }, opts.remote);

    const sandbox = {
        console,
        localStorage: local.api,
        document: {
            visibilityState: 'visible',
            addEventListener() {}, removeEventListener() {},
            dispatchEvent(event) { events.push(event); }
        },
        window: { addEventListener() {}, removeEventListener() {} },
        setInterval: () => 1,
        clearInterval() {},
        CustomEvent: function CustomEvent(type, init) {
            this.type = type;
            this.detail = init && init.detail;
        },
        Bot: {
            applyRemoteRank(data) { applied.push(Object.assign({}, data)); }
        },
        Net: {
            ready: true,
            serverTimestamp: () => ({ seconds: 1 }),
            isRegistered: user => !!(user && user.email),
            ensureAuth: async () => ({ uid: remoteUid, email: 'a@b.c' }),
            signInGoogle: async () => ({ uid: remoteUid, email: 'a@b.c' }),
            signOut: async () => {}
        },
        NetTransport: {
            getUser: async () => remoteProfile,
            reserveCode: async () => true,
            setUser: async (uid, data, merge) => written.push({ uid, data, merge }),
            addFriend: async () => {},
            subscribeUser: () => () => {},
            setPresence: async () => {},
            recordStats: async () => {},
            setRank: async () => {}
        }
    };

    const source = read('js/net/profile.js') + '\n;globalThis.__PROFILE__ = Profile;';
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-account-rank-profile.js' });
    return {
        Profile: sandbox.__PROFILE__, written, applied, events, storage: local.storage
    };
}

test('ранг бот-режима приходит из аккаунта и не стирает локальный', async () => {
    const { Profile, applied, storage } = loadProfile({
        localStorage: {
            toof_rank_v1: JSON.stringify({ maxLevel: 5, rankLevel: 5, masterWins: 0 })
        },
        remote: {
            botRank: { maxLevel: 4, rankLevel: 4, masterWins: 0 }
        }
    });
    await Profile.init();

    assert.deepEqual(Profile.state.botRank, { maxLevel: 5, rankLevel: 5, masterWins: 0 });
    assert.deepEqual(applied, [{ maxLevel: 5, rankLevel: 5, masterWins: 0 }]);
    assert.deepEqual(JSON.parse(storage.get('toof_rank_v1')),
        { maxLevel: 5, rankLevel: 5, masterWins: 0 });
});

test('ранг бот-режима записывается в аккаунт после победы', async () => {
    const { Profile, written } = loadProfile();
    await Profile.init();

    Profile.saveBotRank({ maxLevel: 6, rankLevel: 6, masterWins: 0 });

    assert.ok(written.some(record => record.merge === true &&
        record.data.botRank && record.data.botRank.rankLevel === 6),
    'ранг записан в users/{uid}');
    assert.equal(Profile.state.botRank.rankLevel, 6);
});

test('правила Firestore проверяют ранг бот-режима в профиле', () => {
    const rules = read('firestore.rules');
    assert.match(rules, /function validBotRank\(value\)/);
    const users = rules.match(/match \/users\/\{userId\}\s*\{([\s\S]*?)\n    \}/);
    assert.ok(users);
    assert.equal((users[1].match(/validBotRank\(request\.resource\.data\.botRank\)/g) || []).length, 2,
        'проверка и при создании, и при обновлении профиля');
});

function loadUI(options) {
    const opts = options || {};
    const elements = new Map();
    const screens = ['menuScreen', 'gameScreen', 'onlineScreen'].map(id => {
        const active = new Set();
        return {
            id,
            classList: {
                toggle(name, on) {
                    if (name !== 'is-active') return;
                    if (on) active.add(name); else active.delete(name);
                },
                contains(name) { return active.has(name); }
            }
        };
    });
    function element(id) {
        if (!elements.has(id)) {
            const listeners = {};
            elements.set(id, {
                id, hidden: false, innerHTML: '', className: '', title: '',
                style: {}, disabled: false, textContent: '', listeners,
                classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
                setAttribute() {}, blur() {},
                addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
                click() { (listeners.click || []).forEach(fn => fn({ currentTarget: this, target: this })); },
                closest() { return null; }
            });
        }
        return elements.get(id);
    }

    const results = [];
    const botResults = [];
    const surrendered = [];
    const sandbox = {
        console,
        localStorage: { getItem() { return null; }, setItem() {} },
        document: {
            documentElement: { classList: { toggle() {}, contains() { return false; } } },
            getElementById: element,
            querySelectorAll(selector) { return selector === '.screen' ? screens : []; },
            addEventListener() {}, dispatchEvent() {}
        },
        window: { scrollTo() {} },
        setTimeout: () => 0,
        clearTimeout() {},
        t: text => text,
        Sound: { play() {} },
        Colors: { applyFixed() {}, applyFor() {} },
        Bot: {
            level: 1,
            name: () => 'Элементарный',
            rankName: () => '',
            firstSide: () => 'X',
            recordResult(...args) {
                botResults.push(args);
                return { changed: false, rank: '' };
            }
        },
        Profile: {
            state: { uid: opts.uid || 'me' },
            recordResult: (result, meta) => results.push({ result, meta })
        },
        Lobby: {
            surrender: async session => { surrendered.push(session); },
            leave: async () => {}
        }
    };

    const source = ['js/rules.js', 'js/game-core.js', 'js/colors.js', 'js/ui.js']
        .map(file => read(file)).join('\n') + '\n;globalThis.__TOOF__ = { UI, Game };';
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-exit-menu-ui.js' });
    const api = sandbox.__TOOF__;
    api.UI.init();
    api.Game.reset();
    return { ...api, element, screens, results, botResults, surrendered };
}

test('выход в меню во время игры против бота — поражение', () => {
    const ui = loadUI();
    ui.UI.start('bot');

    ui.element('menuButton').click();

    assert.deepEqual(ui.botResults, [[false, false]], 'записано поражение');
    assert.ok(ui.screens[0].classList.contains('is-active'), 'показывается меню');

    ui.element('menuButton').click();
    assert.equal(ui.botResults.length, 1, 'повторный выход не считается дважды');
});

test('выход в меню во время онлайн-партии — сдача и поражение', () => {
    const ui = loadUI();
    const session = {
        snapshot: ui.Game.snapshot(),
        mySide: 'X',
        opponentName: 'Друг',
        opponentUid: 'other',
        opponentRank: 2,
        status: 'active',
        mode: 'random',
        destroy() { this.destroyed = true; }
    };
    ui.UI.startOnline(session);

    ui.element('menuButton').click();

    assert.deepEqual(ui.surrendered, [session], 'соперник увидит сдачу');
    assert.deepEqual(ui.results, [{ result: 'loss', meta: { uid: 'other', rank: 2 } }]);
    assert.equal(session.destroyed, true);
    assert.ok(ui.screens[0].classList.contains('is-active'));
});
