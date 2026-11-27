'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadSession } = require('./helpers/load-session');

function makeTransport() {
    const moves = [];
    const sent = [];
    let handlers = null;

    const transport = {
        moves,
        sent,
        subscribeGame(gameId, value) {
            handlers = value;
            return () => { handlers = null; };
        },
        emitMoves() {
            if (handlers && handlers.onMoves) handlers.onMoves(moves.slice());
        },
        emitGame(game) {
            if (handlers && handlers.onGame) handlers.onGame(game);
        },
        async fetchMoves() {
            return moves.slice();
        },
        async sendMove(payload) {
            sent.push(payload);
            moves.push({
                ply: payload.ply,
                side: payload.side,
                place: payload.move.place,
                fix: payload.move.fix
            });
            transport.emitMoves();
        },
        async requestRematch() {
            return 'game-rematch';
        },
        async setStatus() {}
    };

    return transport;
}

function startSession(core, transport, options) {
    const updates = [];
    const errors = [];
    const session = core.createOnlineSession(Object.assign({
        transport,
        protocol: core.NetProtocol,
        gameId: 'game-1',
        myUid: 'me',
        mySide: 'X',
        opponentName: 'Друг',
        onUpdate: state => updates.push(state),
        onError: error => errors.push(error)
    }, options || {}));

    session.start();
    transport.emitMoves([]);
    return { session, updates, errors };
}

test('сессия применяет свой ход и ждёт эха из журнала', async () => {
    const core = loadSession();
    const transport = makeTransport();
    const { session } = startSession(core, transport);

    const result = await session.commitMove({ place: [4, 4], fix: null });
    assert.equal(result.ok, true);
    assert.equal(transport.sent.length, 1);
    assert.equal(transport.sent[0].ply, 0);
    assert.equal(transport.sent[0].side, 'X');
    assert.equal(session.awaitingEcho, false);
    assert.equal(session.appliedPly, 1);
    assert.equal(session.snapshot.board[4][4], 'X');
    assert.equal(session.snapshot.current, 'O');
});

test('сессия отвергает ход не в свою очередь', async () => {
    const core = loadSession();
    const transport = makeTransport();
    const { session } = startSession(core, transport);

    await session.commitMove({ place: [4, 4], fix: null });
    const result = await session.commitMove({ place: [5, 5], fix: null });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'turn');
    assert.equal(transport.sent.length, 1);
});

test('сессия применяет ход соперника из журнала', async () => {
    const core = loadSession();
    const transport = makeTransport();
    const { session } = startSession(core, transport);

    await session.commitMove({ place: [4, 4], fix: null });
    transport.moves.push({ ply: 1, side: 'O', place: [5, 5], fix: null });
    transport.emitMoves();

    assert.equal(session.snapshot.board[5][5], 'O');
    assert.equal(session.snapshot.current, 'X');
    assert.equal(session.appliedPly, 2);
});

test('сессия сообщает об ошибке, если в журнале недопустимый ход', async () => {
    const core = loadSession();
    const transport = makeTransport();
    const { session, errors } = startSession(core, transport);

    transport.moves.push({ ply: 0, side: 'O', place: [0, 0], fix: null });
    transport.emitMoves();

    assert.equal(errors.length, 1);
    assert.equal(session.appliedPly, 0);
    assert.equal(session.snapshot.board[0][0], '');
});

test('сессия не отправляет фигуру неправильного размера', async () => {
    const core = loadSession();
    const transport = makeTransport();
    const { session } = startSession(core, transport);

    const result = await session.commitMove({
        place: [0, 0],
        fix: [[0, 0], [0, 1], [0, 2]]
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'size');
    assert.equal(transport.sent.length, 0);
    assert.equal(session.awaitingEcho, false);
});

test('сессия принимает статус приглашения и реванш', async () => {
    const core = loadSession();
    const transport = makeTransport();
    const { session } = startSession(core, transport, { mySide: 'O' });

    transport.emitGame({
        status: 'invited',
        players: ['me', 'friend'],
        sides: { me: 'O', friend: 'X' },
        names: { me: 'Я', friend: 'Друг' }
    });
    assert.equal(session.status, 'invited');

    const id = await session.rematch();
    assert.equal(id, 'game-rematch');
    assert.equal(session.rematchGameId, 'game-rematch');
});
