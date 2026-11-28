'use strict';

const test = require('node:test');
const assert = require('node:assert');
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

test('sendMove отвергает битый ход до транзакции', async () => {
    const { transport, net } = loadTransport();
    let transactions = 0;
    net.db = {
        runTransaction: async fn => { transactions++; return fn({}); },
        collection: () => { throw new Error('должна быть ошибка до обращения к базе'); }
    };

    await assert.rejects(
        () => transport.sendMove({ gameId: 'g', side: 'X', ply: 0,
            move: { place: [99, 0], fix: null } }),
        /Недопустимый ход/
    );
    assert.equal(transactions, 0);
});

test('reserveCode резервирует код и не отдаёт его другому игроку', async () => {
    const { transport, net } = loadTransport();
    const codes = new Map();
    const doc = code => ({
        get: async () => ({ exists: codes.has(code), data: () => codes.get(code) }),
        set: async data => { codes.set(code, data); }
    });
    net.db = {
        collection(name) {
            assert.equal(name, 'profileCodes');
            return { doc };
        },
        runTransaction: async fn => fn({
            get: ref => ref.get(),
            set: (ref, data) => ref.set(data)
        })
    };

    assert.equal(await transport.reserveCode('u1', 'ABC123'), true);
    assert.equal(await transport.reserveCode('u2', 'ABC123'), false);
    assert.equal(await transport.reserveCode('u1', 'ABC123'), true);
    assert.equal(await transport.reserveCode('u3', 'BAD'), false, 'код должен быть из 6 символов');
});

test('партия получает expiresAt для TTL', async () => {
    const { transport, net } = loadTransport();
    const created = [];
    let gameCounter = 0;
    const now = { toMillis: () => Date.now() };
    const queue = new Map([
        ['other', { uid: 'other', name: 'Друг', createdAt: now }]
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
                        const gameId = id || 'game-' + (++gameCounter);
                        return { id: gameId, set: async data => created.push({ id: gameId, data }) };
                    }
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

    await transport.findRandom({ uid: 'me', name: 'Я', code: 'ABC123' },
        { timeoutMs: 200, pollMs: 10 });

    assert.equal(created.length, 1);
    assert.ok(created[0].data.expiresAt, 'у партии есть срок жизни');
});

test('CDN-скрипты Firebase защищены SRI', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const scripts = html.match(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^>]*>/g) || [];
    assert.equal(scripts.length, 3);
    assert.ok(scripts.every(tag => /integrity="sha384-[A-Za-z0-9+/=]+"/.test(tag)));
    assert.ok(scripts.every(tag => /crossorigin="anonymous"/.test(tag)));
});

test('вход по ссылке требует подтверждения', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8') +
        '\n;globalThis.__MAIN__ = { handleDeepLink, closeConfirm, getAction: () => confirmAction };';
    const elements = new Map();
    const element = () => ({ hidden: true, textContent: '' });
    const sandbox = {
        console,
        document: {
            addEventListener() {},
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, element());
                return elements.get(id);
            },
            querySelectorAll() { return []; }
        },
        window: { location: { search: '?room=ABC123' } },
        URLSearchParams,
        UI: { showScreen() {} },
        t: text => text
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-main-confirm-bundle.js' });

    sandbox.__MAIN__.handleDeepLink();

    assert.equal(elements.get('confirmOverlay').hidden, false);
    assert.equal(typeof sandbox.__MAIN__.getAction(), 'function');
    sandbox.__MAIN__.closeConfirm();
    assert.equal(sandbox.__MAIN__.getAction(), null);
});
