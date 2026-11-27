'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./helpers/load-core');

function emptyBoard(core) {
    return Array.from({ length: core.BOARD_SIZE }, () => Array(core.BOARD_SIZE).fill(core.EMPTY));
}

test('makeGame создаёт независимые партии', () => {
    const core = loadCore();
    const a = core.makeGame();
    const b = core.makeGame();
    a.reset();
    b.reset();

    a.place(0, 0);
    assert.equal(a.board[0][0], 'X');
    assert.equal(b.board[0][0], '');
});

test('snapshot/restore сохраняет доску, locked, owners и очередь', () => {
    const core = loadCore();
    const a = core.makeGame();
    a.reset();

    const board = emptyBoard(core);
    board[0][0] = 'X';
    board[0][1] = 'X';
    board[0][2] = 'X';
    board[0][3] = 'X';
    a.restore({
        board,
        locked: ['0,0', '0,1', '0,2', '0,3'],
        owners: [['0,0', 'X'], ['0,1', 'X'], ['0,2', 'X'], ['0,3', 'X']],
        current: 'O',
        over: false,
        winner: null
    });

    const b = core.makeGame();
    assert.equal(b.restore(a.snapshot()), true);
    assert.equal(core.NetProtocol.stateHash(a.snapshot()), core.NetProtocol.stateHash(b.snapshot()));
    assert.equal(b.current, 'O');
    assert.equal(b.locked.size, 4);
    assert.equal(b.owners.get('0,2'), 'X');
    assert.deepEqual(b.selected, []);
    assert.equal(b.pending, null);
});

test('applyMove без фиксации завершает ход', () => {
    const core = loadCore();
    const game = core.makeGame();
    game.reset();

    const result = game.applyMove({ place: [4, 4], fix: null });
    assert.equal(result.ok, true);
    assert.equal(game.board[4][4], 'X');
    assert.equal(game.current, 'O');
    assert.equal(game.pending, null);
});

test('applyMove с фиксацией линии из 4 клеток', () => {
    const core = loadCore();
    const game = core.makeGame();
    const board = emptyBoard(core);
    for (let c = 0; c < 4; c++) board[0][c] = 'X';
    game.restore({
        board,
        locked: [],
        owners: [],
        current: 'X',
        over: false,
        winner: null
    });

    const result = game.applyMove({
        place: [5, 5],
        fix: [[0, 0], [0, 1], [0, 2], [0, 3]]
    });

    assert.equal(result.ok, true);
    assert.equal(result.declarer, 'X');
    assert.equal(game.locked.size, 4);
    assert.equal(game.owners.get('0,0'), 'X');
    assert.equal(game.current, 'O');
    assert.equal(game.pending, null);
});

test('applyMove фиксирует ничью, когда клеток не осталось', () => {
    const core = loadCore();
    const game = core.makeGame();
    const board = emptyBoard(core);
    for (let r = 0; r < core.BOARD_SIZE; r++) {
        for (let c = 0; c < core.BOARD_SIZE; c++) {
            board[r][c] = (r === 9 && c === 9) ? core.EMPTY : 'X';
        }
    }
    game.restore({
        board,
        locked: [],
        owners: [],
        current: 'X',
        over: false,
        winner: null
    });

    const result = game.applyMove({ place: [9, 9], fix: null });
    assert.equal(result.ok, true);
    assert.equal(result.draw, true);
    assert.equal(game.over, true);
    assert.equal(game.winner, null);
});

test('reduce отвергает ход не в свою очередь', () => {
    const core = loadCore();
    const snapshot = core.NetProtocol.initialSnapshot();
    const result = core.NetProtocol.reduce(snapshot, 'O', { place: [0, 0], fix: null });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'turn');
});

test('reduce отвергает занятую клетку и битую фигуру', () => {
    const core = loadCore();
    let snapshot = core.NetProtocol.initialSnapshot();
    const first = core.NetProtocol.reduce(snapshot, 'X', { place: [0, 0], fix: null });
    assert.equal(first.ok, true);
    snapshot = first.snapshot;

    const occupied = core.NetProtocol.reduce(snapshot, 'O', { place: [0, 0], fix: null });
    assert.equal(occupied.ok, false);
    assert.equal(occupied.reason, 'place');

    const badFix = core.NetProtocol.reduce(snapshot, 'O', {
        place: [1, 1],
        fix: [[0, 0], [0, 1], [0, 2]]
    });
    assert.equal(badFix.ok, false);
    assert.equal(badFix.reason, 'size');
});

test('replay восстанавливает ту же позицию, что и последовательное применение', () => {
    const core = loadCore();
    const moves = [
        { side: 'X', move: { place: [0, 0], fix: null } },
        { side: 'O', move: { place: [9, 9], fix: null } },
        { side: 'X', move: { place: [0, 1], fix: null } },
        { side: 'O', move: { place: [9, 8], fix: null } }
    ];

    let snapshot = core.NetProtocol.initialSnapshot();
    for (const item of moves) {
        const result = core.NetProtocol.reduce(snapshot, item.side, item.move);
        assert.equal(result.ok, true);
        snapshot = result.snapshot;
    }

    const replayed = core.NetProtocol.replay(core.NetProtocol.initialSnapshot(), moves);
    assert.equal(replayed.ok, true);
    assert.equal(replayed.applied, moves.length);
    assert.equal(core.NetProtocol.stateHash(snapshot), core.NetProtocol.stateHash(replayed.snapshot));
});

test('moveFromGame собирает pending и selected', () => {
    const core = loadCore();
    const game = core.makeGame();
    game.reset();
    game.place(2, 3);
    game.toggle(2, 3);

    assert.deepEqual(core.NetProtocol.moveFromGame(game), {
        place: [2, 3],
        fix: [[2, 3]]
    });
});

test('normalizeMove отбрасывает дубли и выходящие за поле клетки', () => {
    const core = loadCore();
    assert.equal(core.NetProtocol.normalizeMove({ place: [0, 0], fix: [[1, 1], [1, 1]] }), null);
    assert.equal(core.NetProtocol.normalizeMove({ place: [10, 0], fix: null }), null);
    assert.deepEqual(core.NetProtocol.normalizeMove({ place: [0, 0], fix: [] }), {
        place: [0, 0],
        fix: null
    });
});
