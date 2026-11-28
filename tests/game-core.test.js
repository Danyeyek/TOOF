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

test('первый ход можно отдать O, не меняя сторону игрока', () => {
    const core = loadCore();
    const game = core.makeGame();
    game.reset('O');
    assert.equal(game.current, 'O');
    assert.equal(game.place(0, 0), true);
    assert.equal(game.board[0][0], 'O');
    game.confirm();
    assert.equal(game.current, 'X');

    game.reset();
    assert.equal(game.current, 'X', 'по умолчанию первым ходит X');
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

test('moveFromGame собирает клетку и все фигуры хода', () => {
    const core = loadCore();
    const game = core.makeGame();
    game.reset();
    for (let c = 0; c < 4; c++) game.board[0][c] = 'X';
    for (let c = 0; c < 4; c++) game.toggle(0, c);
    assert.equal(game.fix().ok, true);
    game.place(5, 5);

    assert.deepEqual(core.NetProtocol.moveFromGame(game), {
        place: [5, 5],
        fix: [[[0, 0], [0, 1], [0, 2], [0, 3]]]
    });
});

test('выделение и фиксация не зависят от закрашивания клетки', () => {
    const core = loadCore();
    const game = core.makeGame();
    game.reset();
    for (let c = 0; c < 4; c++) game.board[0][c] = 'X';
    for (let c = 0; c < 4; c++) assert.equal(game.toggle(0, c), true);

    assert.equal(game.confirm().ok, false, 'без закрашенной клетки ход не завершается');
    assert.equal(game.current, 'X');

    assert.equal(game.fix().ok, true);
    assert.equal(game.current, 'X', 'фигура не передаёт ход');
    assert.equal(game.pending, null);
    assert.equal(game.figures.length, 1);
    assert.equal(game.turnFigures.length, 1);
    assert.deepEqual(game.selected, []);
});

test('за ход можно закрыть две фигуры с закрашиванием между ними', () => {
    const core = loadCore();
    const game = core.makeGame();
    game.reset();
    for (let c = 0; c < 4; c++) game.board[0][c] = 'X';
    for (let c = 0; c < 4; c++) game.board[2][c] = 'X';

    for (let c = 0; c < 4; c++) game.toggle(0, c);
    assert.equal(game.fix().ok, true, 'первая фигура — до закрашивания');
    assert.equal(game.current, 'X');

    assert.equal(game.place(9, 9), true);
    for (let c = 0; c < 4; c++) game.toggle(2, c);
    assert.equal(game.fix().ok, true, 'вторая фигура — после закрашивания');
    assert.equal(game.turnFigures.length, 2);

    const move = core.NetProtocol.moveFromGame(game);
    assert.equal(move.fix.length, 2);
    assert.equal(game.confirm().ok, true);
    assert.equal(game.current, 'O');
    assert.equal(game.figures.length, 2);
    assert.equal(game.turnFigures.length, 0);
    assert.equal(game.board[0][0], 'X');
    assert.equal(game.board[2][0], 'X');
    assert.equal(game.board[9][9], 'X');
});

test('за ход нельзя закрасить больше одной клетки', () => {
    const core = loadCore();
    const game = core.makeGame();
    game.reset();

    assert.equal(game.place(0, 0), true);
    assert.equal(game.place(1, 1), true, 'второй вызов переносит клетку');
    assert.deepEqual(game.pending, [1, 1]);
    assert.equal(game.board[0][0], core.EMPTY);
    assert.equal(game.board.flat().filter(v => v === 'X').length, 1);

    const other = core.makeGame();
    other.reset();
    other.place(0, 0);
    for (let c = 1; c < 4; c++) other.board[0][c] = 'X';
    for (let c = 0; c < 4; c++) other.toggle(0, c);
    assert.equal(other.fix().ok, true, 'закрашенная клетка вошла в фигуру');
    assert.equal(other.place(9, 9), false, 'вторую клетку за ход ставить нельзя');
    assert.equal(other.board[9][9], core.EMPTY);
    assert.equal(other.current, 'X');
    assert.equal(other.confirm().ok, true);
    assert.equal(other.current, 'O');
});

test('победная фигура присуждает победу сразу, до закрашивания клетки', () => {
    const core = loadCore();
    const game = core.makeGame();
    const board = emptyBoard(core);
    for (let c = 0; c < 4; c++) board[0][c] = 'X';
    game.restore({
        board,
        locked: [],
        owners: [['6,0', 'X'], ['0,6', 'X']],
        current: 'X',
        over: false,
        winner: null
    });

    for (let c = 0; c < 4; c++) game.toggle(0, c);
    const fixed = game.fix();
    assert.equal(fixed.ok, true);
    assert.equal(fixed.winner, 'X');
    assert.equal(game.over, true, 'победа не ждёт закрашивания и подтверждения');
    assert.equal(game.winner, 'X');
    assert.equal(game.current, 'X', 'ход не переходит после победы');
    assert.equal(game.pending, null);
    assert.equal(game.turnFigures.length, 1, 'фигура остаётся в ходе, чтобы уйти в сеть');
});

test('ход без закрашенной клетки принимается только победной фигурой', () => {
    const core = loadCore();
    const board = emptyBoard(core);
    for (let c = 0; c < 4; c++) board[0][c] = 'X';
    const snapshot = {
        board,
        locked: [],
        owners: [['6,0', 'X'], ['0,6', 'X']],
        current: 'X',
        over: false,
        winner: null
    };
    const move = { place: null, fix: [[[0, 0], [0, 1], [0, 2], [0, 3]]] };

    const win = core.NetProtocol.reduce(snapshot, 'X', move);
    assert.equal(win.ok, true);
    assert.equal(win.winner, 'X');
    assert.equal(win.snapshot.over, true);
    assert.equal(win.snapshot.current, 'X');

    const plain = core.NetProtocol.reduce({
        board,
        locked: [],
        owners: [],
        current: 'X',
        over: false,
        winner: null
    }, 'X', move);
    assert.equal(plain.ok, false, 'непобедную фигуру нельзя отправить без клетки');
    assert.equal(plain.reason, 'confirm');

    assert.equal(core.NetProtocol.normalizeMove(move).place, null);
    assert.equal(core.NetProtocol.normalizeMove({ place: null, fix: null }), null);
});

test('moveFromGame собирает победную фигуру без закрашенной клетки', () => {
    const core = loadCore();
    const game = core.makeGame();
    const board = emptyBoard(core);
    for (let c = 0; c < 4; c++) board[0][c] = 'X';
    game.restore({
        board,
        locked: [],
        owners: [['6,0', 'X'], ['0,6', 'X']],
        current: 'X',
        over: false,
        winner: null
    });
    for (let c = 0; c < 4; c++) game.toggle(0, c);
    game.fix();

    assert.deepEqual(core.NetProtocol.moveFromGame(game), {
        place: null,
        fix: [[[0, 0], [0, 1], [0, 2], [0, 3]]]
    });
});

test('applyMove принимает ход с двумя фигурами', () => {
    const core = loadCore();
    const game = core.makeGame();
    const board = emptyBoard(core);
    for (let c = 0; c < 4; c++) board[0][c] = 'X';
    for (let c = 0; c < 4; c++) board[2][c] = 'X';
    game.restore({ board, locked: [], owners: [], current: 'X', over: false, winner: null });

    const result = game.applyMove({
        place: [9, 9],
        fix: [
            [[0, 0], [0, 1], [0, 2], [0, 3]],
            [[2, 0], [2, 1], [2, 2], [2, 3]]
        ]
    });
    assert.equal(result.ok, true);
    assert.equal(result.declarer, 'X');
    assert.equal(game.figures.length, 2);
    assert.equal(game.current, 'O');
    assert.equal(game.pending, null);
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

test('normalizeMove понимает одну фигуру и список фигур', () => {
    const core = loadCore();
    const line = [[1, 1], [1, 2], [1, 3], [1, 4]];
    assert.deepEqual(core.NetProtocol.normalizeMove({ place: [0, 0], fix: line }), {
        place: [0, 0],
        fix: [line]
    });
    assert.deepEqual(core.NetProtocol.normalizeMove({ place: [0, 0], fix: [line, line] }), {
        place: [0, 0],
        fix: [line, line]
    });
});
