'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const { loadSession } = require('./helpers/load-session');

function loadTransport() {
    const source = fs.readFileSync(path.join(ROOT, 'js/net/transport.js'), 'utf8') +
        '\n;globalThis.__TRANSPORT__ = NetTransport;';
    const now = () => ({ toMillis: () => Date.now() });
    const sandbox = {
        console,
        setTimeout,
        Net: { ready: true, db: null, serverTimestamp: now, increment: value => value },
        firebase: { firestore: { Timestamp: { fromMillis: now } } }
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-surrender-transport.js' });
    return { transport: sandbox.__TRANSPORT__, net: sandbox.Net };
}

function loadUI(uid) {
    const elements = new Map();
    const events = { results: [], calls: [], notify: [] };
    const screens = ['menuScreen', 'gameScreen', 'onlineScreen'].map(id => {
        const active = new Set();
        return {
            id,
            classList: {
                toggle(name, on) {
                    if (name !== 'is-active') return;
                    if (on) active.add(name); else active.delete(name);
                    if (on) events.calls.push('screen:' + id);
                },
                contains(name) { return active.has(name); }
            }
        };
    });

    function element(id) {
        if (!elements.has(id)) {
            const listeners = {};
            elements.set(id, {
                id,
                hidden: false,
                innerHTML: '',
                className: '',
                title: '',
                style: {},
                disabled: false,
                listeners,
                classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
                setAttribute() {},
                blur() {},
                addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
                click() { (listeners.click || []).forEach(fn => fn({ currentTarget: this, target: this })); },
                closest() { return null; },
                textContent: ''
            });
        }
        return elements.get(id);
    }

    const sandbox = {
        console,
        localStorage: { getItem() { return null; }, setItem() {} },
        document: {
            documentElement: { classList: { toggle() {}, contains() { return false; } } },
            getElementById: element,
            querySelectorAll(selector) { return selector === '.screen' ? screens : []; },
            addEventListener() {},
            dispatchEvent() {}
        },
        window: { scrollTo() {} },
        setTimeout() { return 0; },
        clearTimeout() {},
        t: text => text,
        notify: text => events.notify.push(text),
        startRandomSearch: () => events.calls.push('random'),
        Sound: { play() {} },
        Bot: {
            level: 1,
            name: () => 'Элементарный',
            rankName: () => '',
            recordResult() {},
            firstSide() { return 'X'; }
        },
        Profile: {
            state: { uid },
            recordResult: (result, meta) => events.results.push({ result, meta })
        },
        Lobby: {
            surrender: async () => { events.calls.push('surrender'); },
            exit: async () => { events.calls.push('exit'); },
            rematch: async () => { events.calls.push('rematch'); },
            leave: async () => { events.calls.push('leave'); }
        },
        NetProtocol: {}
    };

    vm.createContext(sandbox);
    vm.runInContext(
        ['js/rules.js', 'js/game-core.js', 'js/colors.js', 'js/ui.js']
            .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n') +
        '\n;globalThis.__TOOF__ = { UI, Game };',
        sandbox,
        { filename: 'toof-surrender-ui.js' }
    );
    const api = sandbox.__TOOF__;
    api.UI.init();
    api.Game.reset();

    function session(mySide, mode) {
        return {
            snapshot: api.Game.snapshot(),
            mySide,
            opponentName: 'Друг',
            status: 'active',
            mode,
            destroyed: false,
            destroy() { this.destroyed = true; }
        };
    }

    return { ...api, elements, events, session };
}

const GAME = {
    players: ['me', 'friend'],
    sides: { me: 'X', friend: 'O' },
    names: { me: 'Я', friend: 'Друг' },
    ranks: { me: 0, friend: 0 }
};

test('правила Firestore разрешают сдачу и выход только участникам партии', () => {
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    assert.match(rules, /request\.resource\.data\.status == 'surrendered'/);
    assert.match(rules, /request\.resource\.data\.surrenderedBy == uid\(\)/);
    assert.match(rules, /request\.resource\.data\.status == 'closed'/);
    assert.match(rules, /request\.resource\.data\.closedBy == uid\(\)/);
    assert.match(rules, /hasOnly\(\['status', 'surrenderedBy', 'updatedAt', 'expiresAt'\]\)/);
    assert.match(rules, /hasOnly\(\['status', 'closedBy', 'updatedAt', 'expiresAt'\]\)/);
});

test('транспорт помечает сдачу и выход', async () => {
    const { transport, net } = loadTransport();
    const updates = [];
    net.db = {
        collection(name) {
            assert.equal(name, 'games');
            return { doc: id => ({ update: async data => updates.push({ id, data }) }) };
        }
    };

    await transport.surrender('g1', 'me');
    await transport.closeGame('g1', 'friend');

    assert.equal(updates.length, 2);
    assert.equal(updates[0].id, 'g1');
    assert.equal(updates[0].data.status, 'surrendered');
    assert.equal(updates[0].data.surrenderedBy, 'me');
    assert.equal(updates[1].data.status, 'closed');
    assert.equal(updates[1].data.closedBy, 'friend');
});

test('сессия отдаёт статусы сдачи/выхода и победителя по сдаче', async () => {
    const core = loadSession();
    const calls = [];
    let handlers = null;
    const transport = {
        subscribeGame(id, value) { handlers = value; return () => { handlers = null; }; },
        async fetchMoves() { return []; },
        async sendMove() {},
        async setStatus() {},
        async surrender(id, uid) { calls.push(['surrender', id, uid]); },
        async closeGame(id, uid) { calls.push(['close', id, uid]); }
    };
    const updates = [];
    const session = core.createOnlineSession({
        transport,
        protocol: core.NetProtocol,
        gameId: 'g1',
        myUid: 'me',
        mySide: 'X',
        initialGame: Object.assign({ mode: 'friend' }, GAME),
        onUpdate: state => updates.push(state)
    });
    session.start();

    assert.equal(session.mode, 'friend');
    await session.surrender();
    await session.closeGame();
    assert.deepEqual(calls, [['surrender', 'g1', 'me'], ['close', 'g1', 'me']]);

    handlers.onGame(Object.assign({}, GAME, {
        mode: 'random', status: 'surrendered', surrenderedBy: 'friend'
    }));
    assert.equal(session.status, 'surrendered');
    assert.equal(session.mode, 'random');
    assert.equal(session.surrenderWinner, 'X', 'сдался O — победил X');
    assert.equal(updates[updates.length - 1].surrenderWinner, 'X');

    handlers.onGame(Object.assign({}, GAME, {
        mode: 'random', status: 'closed', closedBy: 'me'
    }));
    assert.equal(session.status, 'closed');
    assert.equal(session.closedBy, 'me');
});

test('соперник видит победу, кнопка сдачи скрыта, доступны реванш и выход', () => {
    const ui = loadUI('me');
    const session = ui.session('X', 'friend');
    ui.UI.startOnline(session);

    ui.UI.onlineUpdate(session, {
        status: 'surrendered',
        surrenderedBy: 'friend',
        surrenderWinner: 'X',
        mode: 'friend',
        game: Object.assign({}, GAME, { mode: 'friend', status: 'surrendered', surrenderedBy: 'friend' }),
        snapshot: ui.Game.snapshot(),
        moves: [],
        appliedPly: 0,
        mySide: 'X'
    });

    assert.equal(ui.Game.over, true);
    assert.equal(ui.Game.winner, 'X');
    assert.match(ui.elements.get('gameMessage').textContent, /Соперник сдался.*победили/);
    assert.equal(ui.elements.get('surrenderButton').hidden, true);
    assert.equal(ui.elements.get('rematchButton').hidden, false);
    assert.equal(ui.elements.get('exitGameButton').hidden, false);
    assert.equal(ui.elements.get('onlineNewGameButton').hidden, true);
    assert.deepEqual(ui.events.results.map(item => item.result), ['win']);
});

test('сдавшийся видит поражение и те же кнопки в игре с другом', () => {
    const ui = loadUI('friend');
    const session = ui.session('O', 'friend');
    ui.UI.startOnline(session);

    ui.UI.onlineUpdate(session, {
        status: 'surrendered',
        surrenderedBy: 'friend',
        surrenderWinner: 'X',
        mode: 'friend',
        game: Object.assign({}, GAME, { mode: 'friend', status: 'surrendered', surrenderedBy: 'friend' }),
        snapshot: ui.Game.snapshot(),
        moves: [],
        appliedPly: 0,
        mySide: 'O'
    });

    assert.match(ui.elements.get('gameMessage').textContent, /Вы сдались/);
    assert.deepEqual(ui.events.results.map(item => item.result), ['loss']);
    assert.equal(ui.elements.get('surrenderButton').hidden, true);
    assert.equal(ui.elements.get('rematchButton').hidden, false);
    assert.equal(ui.elements.get('exitGameButton').hidden, false);
});

test('в случайной игре после сдачи предлагается новая игра', () => {
    const ui = loadUI('me');
    const session = ui.session('X', 'random');
    ui.UI.startOnline(session);

    ui.UI.onlineUpdate(session, {
        status: 'surrendered',
        surrenderedBy: 'friend',
        surrenderWinner: 'X',
        mode: 'random',
        game: Object.assign({}, GAME, { mode: 'random', status: 'surrendered', surrenderedBy: 'friend' }),
        snapshot: ui.Game.snapshot(),
        moves: [],
        appliedPly: 0,
        mySide: 'X'
    });

    assert.match(ui.elements.get('gameMessage').textContent, /победили/);
    assert.equal(ui.elements.get('surrenderButton').hidden, true);
    assert.equal(ui.elements.get('rematchButton').hidden, true);
    assert.equal(ui.elements.get('exitGameButton').hidden, true);
    assert.equal(ui.elements.get('onlineNewGameButton').hidden, false);

    ui.elements.get('onlineNewGameButton').click();
    assert.ok(ui.events.calls.includes('random'), 'запускается поиск нового соперника');
    assert.equal(ui.UI.state.session, null);
});

test('сдача в случайной игре уводит в меню и записывает поражение', async () => {
    const ui = loadUI('me');
    const session = ui.session('X', 'random');
    ui.UI.startOnline(session);
    assert.equal(ui.elements.get('surrenderButton').hidden, false);

    ui.elements.get('surrenderButton').click();
    await Promise.resolve();
    await Promise.resolve();

    assert.ok(ui.events.calls.includes('surrender'));
    assert.deepEqual(ui.events.results.map(item => item.result), ['loss']);
    assert.ok(ui.events.calls.includes('screen:menuScreen'));
    assert.equal(ui.UI.state.session, null);
    assert.equal(session.destroyed, true);
});

test('выход одного закрывает комнату и уведомляет второго', () => {
    const ui = loadUI('me');
    const session = ui.session('X', 'friend');
    ui.UI.startOnline(session);

    ui.UI.onlineUpdate(session, {
        status: 'closed',
        closedBy: 'friend',
        mode: 'friend',
        game: Object.assign({}, GAME, { mode: 'friend', status: 'closed', closedBy: 'friend' }),
        snapshot: ui.Game.snapshot(),
        moves: [],
        appliedPly: 0,
        mySide: 'X'
    });

    assert.equal(session.destroyed, true);
    assert.equal(ui.UI.state.session, null);
    assert.equal(ui.UI.state.resumable, false);
    assert.ok(ui.events.calls.includes('screen:onlineScreen'));
    assert.deepEqual(ui.events.notify, ['Соперник вышел из комнаты. Вы тоже вышли.']);
});

test('кнопка выхода пишет закрытие партии и уводит в lobby', () => {
    const ui = loadUI('me');
    const session = ui.session('X', 'friend');
    ui.UI.startOnline(session);
    ui.Game.over = true;
    ui.UI.render();
    assert.equal(ui.elements.get('exitGameButton').hidden, false);

    ui.elements.get('exitGameButton').click();
    return Promise.resolve().then(() => Promise.resolve()).then(() => {
        assert.ok(ui.events.calls.includes('exit'));
        assert.deepEqual(ui.events.notify, ['Вы вышли из комнаты. Соперник тоже вышел.']);
        assert.equal(ui.UI.state.session, null);
    });
});
