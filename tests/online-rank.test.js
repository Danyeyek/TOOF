'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadSession } = require('./helpers/load-session');
const { loadCore } = require('./helpers/load-core');

const ROOT = path.join(__dirname, '..');

function loadProfile(options) {
    const opts = options || {};
    const source = fs.readFileSync(path.join(ROOT, 'js/net/profile.js'), 'utf8') +
        '\n;globalThis.__PROFILE__ = Profile;';
    const storage = new Map();
    storage.set('toof_online_rank_v1', JSON.stringify(opts.savedRank || {}));
    storage.set('toof_profile_v1', JSON.stringify(opts.local || {}));
    const written = [];
    const events = [];

    const sandbox = {
        console,
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, value)
        },
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
        Net: {
            ready: true,
            serverTimestamp: () => ({ seconds: 1 }),
            isRegistered: user => !!(user && user.email),
            ensureAuth: async () => opts.user || { uid: 'me', isAnonymous: true },
            signInGoogle: async () => ({ uid: 'me' }),
            signOut: async () => {}
        },
        NetTransport: {
            getUser: async uid => (opts.remote || {})[uid] || null,
            reserveCode: async () => true,
            setUser: async (uid, data, merge) => written.push({ uid, data, merge }),
            addFriend: async () => {},
            subscribeUser: () => () => {},
            setPresence: async () => {},
            recordStats: async () => {},
            setRank: async (uid, rank, ladder) => written.push({ uid, rank, ladder })
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-online-rank-profile.js' });
    return { Profile: sandbox.__PROFILE__, written, events, storage };
}

test('три победы над разными игроками выше ранга повышают ранг до их ранга', async () => {
    const { Profile, written, events } = loadProfile();
    await Profile.init();

    Profile.recordResult('win', { uid: 'a', rank: 1 });
    assert.equal(Profile.state.rank, 0, 'одна победа ранг не меняет');
    Profile.recordResult('win', { uid: 'b', rank: 1 });
    assert.equal(Profile.state.rank, 0, 'две победы ранг не меняют');
    Profile.recordResult('win', { uid: 'c', rank: 1 });

    assert.equal(Profile.state.rank, 1);
    assert.deepEqual(Profile.state.ladder, [], 'соперники 1-го ранга больше не выше');
    assert.ok(written.some(record => record.uid === 'me' && record.rank === 1),
        'новый ранг записан в Firestore');
    assert.ok(events.some(event => event.type === 'toof:online-rank' && event.detail.rank === 1));
});

test('смешанные ранги: две победы над 1-м и одна над 2-м дают 1-й, цепочка на 2-й жива', async () => {
    const { Profile } = loadProfile();
    await Profile.init();

    Profile.recordResult('win', { uid: 'a', rank: 1 });
    Profile.recordResult('win', { uid: 'b', rank: 1 });
    Profile.recordResult('win', { uid: 'c', rank: 2 });

    assert.equal(Profile.state.rank, 1);
    assert.deepEqual(Profile.state.ladder, [{ uid: 'c', rank: 2 }]);

    Profile.recordResult('win', { uid: 'd', rank: 2 });
    assert.equal(Profile.state.rank, 1);
    Profile.recordResult('win', { uid: 'e', rank: 2 });
    assert.equal(Profile.state.rank, 2);
    assert.deepEqual(Profile.state.ladder, [], 'после повышения старые победы не переносятся');
});

test('повторные победы над тем же игроком, слабые соперники и ничьи цепочку не двигают', async () => {
    const { Profile } = loadProfile();
    await Profile.init();

    Profile.recordResult('win', { uid: 'a', rank: 3 });
    Profile.recordResult('win', { uid: 'a', rank: 3 });       // тот же игрок
    Profile.recordResult('win', { uid: 'weak', rank: 0 });   // слабее
    Profile.recordResult('draw', { uid: 'b', rank: 3 });     // ничья цепочку сохраняет
    assert.equal(Profile.state.ladder.length, 1);
    assert.equal(Profile.state.rank, 0);

    Profile.recordResult('win', { uid: 'b', rank: 3 });
    Profile.recordResult('win', { uid: 'c', rank: 3 });
    assert.equal(Profile.state.rank, 3);
    assert.equal(Profile.state.stats.wins, 5);
});

test('поражение сбрасывает цепочку и этот сброс записывается в Firestore', async () => {
    const { Profile, written } = loadProfile();
    await Profile.init();

    Profile.recordResult('win', { uid: 'a', rank: 2 });
    assert.equal(Profile.state.ladder.length, 1);
    Profile.recordResult('loss', { uid: 'b', rank: 2 });

    assert.deepEqual(Profile.state.ladder, []);
    assert.equal(Profile.state.rank, 0, 'ранг от поражения не падает');
    assert.equal(Profile.state.stats.losses, 1);
    assert.ok(written.some(record => record.uid === 'me' &&
        record.rank === 0 && Array.isArray(record.ladder) && record.ladder.length === 0),
        'пустая цепочка записана на сервере');

    Profile.recordResult('win', { uid: 'b', rank: 2 });
    Profile.recordResult('win', { uid: 'c', rank: 2 });
    assert.equal(Profile.state.rank, 0, 'старые победы после поражения не считаются');
});

test('удалённый ранг является источником правды и сохраняется между сессиями', async () => {
    const { Profile, storage } = loadProfile({
        savedRank: { rank: 1, ladder: [{ uid: 'old', rank: 2 }] },
        remote: { me: { rank: 4, ladder: [{ uid: 'x', rank: 5 }] } }
    });
    await Profile.init();

    assert.equal(Profile.state.rank, 4);
    assert.deepEqual(Profile.state.ladder, [{ uid: 'x', rank: 5 }]);
    assert.deepEqual(JSON.parse(storage.get('toof_online_rank_v1')), {
        rank: 4, ladder: [{ uid: 'x', rank: 5 }]
    });
});

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
    vm.runInContext(source, sandbox, { filename: 'toof-online-rank-transport.js' });
    return { transport: sandbox.__TRANSPORT__, net: sandbox.Net };
}

test('случайный подбор сначала берёт соперника с тем же рангом', async () => {
    const { transport, net } = loadTransport();
    const created = [];
    const queue = new Map([
        ['far', { uid: 'far', name: 'Далёкий', rank: 9, createdAt: nowStamp() }],
        ['near', { uid: 'near', name: 'Близкий', rank: 4, createdAt: nowStamp() }],
        ['same', { uid: 'same', name: 'Равный', rank: 5, createdAt: nowStamp() }]
    ]);
    function nowStamp() { return { toMillis: () => Date.now() }; }

    const queueWrites = [];
    const queueDoc = id => ({
        id,
        get: async () => ({ exists: queue.has(id), data: () => queue.get(id) }),
        set: async data => { queue.set(id, data); queueWrites.push({ id, data }); },
        delete: async () => { queue.delete(id); }
    });
    let counter = 0;
    net.db = {
        collection(name) {
            if (name === 'queue') {
                return {
                    doc: queueDoc,
                    orderBy() { return { limit() { return {
                        get: async () => ({ docs: [...queue.entries()].map(([id, data]) => ({
                            id, data: () => data
                        })) })
                    }; } }; }
                };
            }
            if (name === 'games') {
                return {
                    doc(id) {
                        const gameId = id || 'game-' + (++counter);
                        return { id: gameId, set: async data => created.push({ id: gameId, data }) };
                    },
                    where() { return { where() { return {
                        limit() { return { get: async () => ({ docs: [] }) }; }
                    }; } }; }
                };
            }
            throw new Error('unexpected collection ' + name);
        },
        runTransaction: async fn => fn({
            get: ref => ref.get(),
            set: (ref, data) => ref.set(data),
            delete: ref => ref.delete()
        })
    };

    await transport.findRandom({ uid: 'me', name: 'Я', code: 'ABC123', rank: 5 },
        { timeoutMs: 100, pollMs: 5 });

    assert.equal(created.length, 1, 'партия создана');
    assert.deepEqual(created[0].data.players.slice().sort(), ['me', 'same']);
    assert.equal(created[0].data.ranks.same, 5, 'ранг соперника зафиксирован в партии');
    assert.equal(created[0].data.ranks.me, 5);
    assert.ok(queueWrites.some(record => record.id === 'me' && record.data.rank === 5),
        'ранг записан в очередь');
});

test('если равного ранга нет, берётся максимально близкий', async () => {
    const { transport, net } = loadTransport();
    const created = [];
    const stamp = () => ({ toMillis: () => Date.now() });
    const queue = new Map([
        ['far', { uid: 'far', name: 'Далёкий', rank: 9, createdAt: stamp() }],
        ['near', { uid: 'near', name: 'Близкий', rank: 4, createdAt: stamp() }]
    ]);
    const queueDoc = id => ({
        id,
        get: async () => ({ exists: queue.has(id), data: () => queue.get(id) }),
        set: async data => { queue.set(id, data); },
        delete: async () => { queue.delete(id); }
    });
    net.db = {
        collection(name) {
            if (name === 'queue') {
                return { doc: queueDoc, orderBy() { return { limit() { return {
                    get: async () => ({ docs: [...queue.entries()].map(([id, data]) => ({
                        id, data: () => data
                    })) })
                }; } }; } };
            }
            if (name === 'games') {
                return {
                    doc(id) { return { id: id || 'g', set: async data => created.push(data) }; },
                    where() { return { where() { return {
                        limit() { return { get: async () => ({ docs: [] }) }; }
                    }; } }; }
                };
            }
            throw new Error('unexpected collection ' + name);
        },
        runTransaction: async fn => fn({
            get: ref => ref.get(),
            set: (ref, data) => ref.set(data),
            delete: ref => ref.delete()
        })
    };

    await transport.findRandom({ uid: 'me', name: 'Я', code: 'ABC123', rank: 5 },
        { timeoutMs: 100, pollMs: 5 });
    assert.deepEqual(created[0].players.slice().sort(), ['me', 'near']);
    assert.equal(created[0].ranks.near, 4);
});

test('сессия отдаёт uid и ранг соперника из документа партии', () => {
    const core = loadSession();
    const game = {
        id: 'g',
        players: ['me', 'other'],
        sides: { me: 'X', other: 'O' },
        names: { me: 'Я', other: 'Соперник' },
        ranks: { me: 3, other: 5 },
        status: 'active'
    };
    let updates = [];
    const transport = {
        subscribeGame(gameId, handlers) {
            handlers.onGame(game);
            handlers.onMoves([]);
            return () => {};
        },
        fetchMoves: async () => []
    };
    const session = core.createOnlineSession({
        transport,
        gameId: 'g',
        myUid: 'me',
        mySide: 'X',
        onUpdate: state => updates.push(state)
    });
    session.start();

    assert.equal(session.opponentUid, 'other');
    assert.equal(session.opponentRank, 5);
    const last = updates[updates.length - 1];
    assert.equal(last.opponentUid, 'other');
    assert.equal(last.opponentRank, 5);
});

test('ничья при заполненном поле фиксируется и в сетевом реплее', () => {
    const core = loadCore();
    const board = Array.from({ length: core.BOARD_SIZE }, () =>
        Array(core.BOARD_SIZE).fill('X'));
    board[core.BOARD_SIZE - 1][core.BOARD_SIZE - 1] = core.EMPTY;
    /* Владельцев нет: секторы не захвачены, значит последняя клетка — ничья. */
    const snapshot = {
        board, locked: [], owners: [], current: 'X',
        over: false, winner: null, figures: []
    };

    const reduced = core.NetProtocol.reduce(snapshot, 'X',
        { place: [core.BOARD_SIZE - 1, core.BOARD_SIZE - 1], fix: null });
    assert.equal(reduced.ok, true);
    assert.equal(reduced.snapshot.over, true);
    assert.equal(reduced.winner, null, 'победителя нет — UI запишет draw');

    const replay = core.NetProtocol.replay(snapshot, [{
        side: 'X', move: { place: [core.BOARD_SIZE - 1, core.BOARD_SIZE - 1], fix: null }
    }]);
    assert.equal(replay.ok, true);
    assert.equal(replay.snapshot.over, true);
    assert.equal(replay.winner, null);
});

test('правила Firestore проверяют ранг, цепочку и ранг в партии', () => {
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    assert.match(rules, /function validRank\(rank\)/);
    assert.match(rules, /function validLadder\(ladder\)/);
    assert.match(rules, /validRanks\(request\.resource\.data\.ranks, request\.resource\.data\.players\)/);
    assert.match(rules, /validRank\(request\.resource\.data\.rank\)/);
    assert.match(rules, /request\.resource\.data\.ranks == resource\.data\.ranks/);
});

test('версия игры — 1.0', () => {
    const rules = fs.readFileSync(path.join(ROOT, 'js/rules.js'), 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.match(rules, /const VERSION = '1\.0'/);
    assert.equal(pkg.version, '1.0');
});
