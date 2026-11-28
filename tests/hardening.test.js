'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./helpers/load-core');
const { loadSession } = require('./helpers/load-session');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadTransport() {
    const source = fs.readFileSync(path.join(ROOT, 'js/net/transport.js'), 'utf8') +
        '\n;globalThis.__TRANSPORT__ = NetTransport;';

    const now = () => ({ toMillis: () => Date.now() });
    const sandbox = {
        console,
        setTimeout,
        Net: {
            ready: true,
            db: null,
            serverTimestamp: now,
            increment: value => value
        },
        firebase: { firestore: { Timestamp: { fromMillis: now } } }
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-transport-bundle.js' });
    return { transport: sandbox.__TRANSPORT__, net: sandbox.Net };
}

function makeFakeDb(queue) {
    const created = [];
    const deleted = [];
    const docs = new Map(Object.entries(queue));
    let gameCounter = 0;

    const queueDoc = id => ({
        id,
        async get() { return { exists: docs.has(id), data: () => docs.get(id) }; },
        async set(data) { docs.set(id, data); },
        async delete() { deleted.push(id); docs.delete(id); }
    });

    const db = {
        collection(name) {
            if (name === 'queue') {
                return {
                    doc: queueDoc,
                    orderBy() {
                        return {
                            limit() {
                                return {
                                    async get() {
                                        return {
                                            docs: [...docs.entries()].map(([id, data]) => ({
                                                id,
                                                data: () => data
                                            }))
                                        };
                                    }
                                };
                            }
                        };
                    }
                };
            }
            if (name === 'games') {
                return {
                    doc(id) {
                        const gameId = id || 'game-' + (++gameCounter);
                        return {
                            id: gameId,
                            async set(data) { created.push({ id: gameId, data }); }
                        };
                    }
                };
            }
            throw new Error('unexpected collection ' + name);
        },
        async runTransaction(fn) {
            return fn({
                get: ref => ref.get(),
                set: (ref, data) => ref.set(data),
                delete: ref => ref.delete()
            });
        }
    };
    return { db, created, deleted, docs };
}

test('stateHash не зависит от порядка owners с одинаковыми ключами', () => {
    const core = loadCore();
    const a = core.NetProtocol.initialSnapshot();
    const b = core.NetProtocol.initialSnapshot();

    a.owners = [['0,0', 'X'], ['0,0', 'O'], ['1,1', 'X']];
    b.owners = [['0,0', 'O'], ['0,0', 'X'], ['1,1', 'X']];

    assert.equal(core.NetProtocol.stateHash(a), core.NetProtocol.stateHash(b));
});

test('normalizeMove ограничивает число фигур в одном ходе', () => {
    const core = loadCore();
    const line = [[1, 1], [1, 2], [1, 3], [1, 4]];
    const many = Array.from({ length: 7 }, (_, i) => line.map(([r, c]) => [i, c]));
    assert.equal(core.NetProtocol.normalizeMove({ place: [0, 0], fix: many }), null);
    assert.equal(core.NetProtocol.normalizeMove({ place: [0, 0], fix: many.slice(0, 6) }).fix.length, 6);
});

test('commitMove возвращает победителя победной фигуры', async () => {
    const core = loadSession();
    const board = Array.from({ length: core.BOARD_SIZE },
        () => Array(core.BOARD_SIZE).fill(core.EMPTY));
    for (let c = 0; c < 4; c++) board[0][c] = 'X';
    const snapshot = {
        board,
        locked: [],
        owners: [['6,0', 'X'], ['0,6', 'X']],
        current: 'X',
        over: false,
        winner: null
    };

    const transport = {
        subscribeGame() { return () => {}; },
        async fetchMoves() { return []; },
        async sendMove() {},
        async setStatus() {}
    };
    const session = core.createOnlineSession({
        transport,
        protocol: core.NetProtocol,
        gameId: 'game-1',
        myUid: 'me',
        mySide: 'X',
        initialSnapshot: snapshot
    });
    session.start();

    const result = await session.commitMove({
        place: null,
        fix: [[[0, 0], [0, 1], [0, 2], [0, 3]]]
    });
    assert.equal(result.ok, true);
    assert.equal(result.winner, 'X');
});

test('случайный подбор берёт соперника из id документа очереди', async () => {
    const { transport, net } = loadTransport();
    const fake = makeFakeDb({
        /* Поле uid подменено: оно не совпадает с id документа. */
        victim: { uid: 'attacker', name: 'Жертва', createdAt: { toMillis: () => Date.now() } }
    });
    net.db = fake.db;

    const gameId = await transport.findRandom(
        { uid: 'me', name: 'Я', code: 'ABC123' },
        { timeoutMs: 200, pollMs: 10 }
    );

    assert.ok(gameId, 'игра должна быть создана');
    assert.equal(fake.created.length, 1);
    assert.deepEqual(fake.created[0].data.players, ['me', 'victim']);
    assert.ok(!('attacker' in fake.created[0].data.sides), 'подменённый uid не попал в партию');
});
