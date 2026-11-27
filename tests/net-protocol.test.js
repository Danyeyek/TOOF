'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./helpers/load-core');

test('otherSide меняет сторону', () => {
    const core = loadCore();
    assert.equal(core.NetProtocol.otherSide('X'), 'O');
    assert.equal(core.NetProtocol.otherSide('O'), 'X');
    assert.equal(core.NetProtocol.otherSide('?'), null);
});

test('initialSnapshot — пустая доска, ход X', () => {
    const core = loadCore();
    const snapshot = core.NetProtocol.initialSnapshot();
    assert.equal(snapshot.current, 'X');
    assert.equal(snapshot.over, false);
    assert.equal(snapshot.board.length, core.BOARD_SIZE);
    assert.equal(snapshot.locked.length, 0);
    assert.equal(snapshot.owners.length, 0);
});

test('stateHash не зависит от порядка locked/owners', () => {
    const core = loadCore();
    const a = core.NetProtocol.initialSnapshot();
    const b = core.NetProtocol.initialSnapshot();

    a.locked = ['1,1', '0,0'];
    a.owners = [['1,1', 'X'], ['0,0', 'O']];
    b.locked = ['0,0', '1,1'];
    b.owners = [['0,0', 'O'], ['1,1', 'X']];

    assert.equal(core.NetProtocol.stateHash(a), core.NetProtocol.stateHash(b));
});

test('reduce не меняет исходный снимок', () => {
    const core = loadCore();
    const snapshot = core.NetProtocol.initialSnapshot();
    const before = JSON.stringify(snapshot);

    const result = core.NetProtocol.reduce(snapshot, 'X', { place: [0, 0], fix: null });
    assert.equal(result.ok, true);
    assert.equal(JSON.stringify(snapshot), before);
    assert.equal(result.snapshot.board[0][0], 'X');
});

test('replay сообщает номер плохого хода', () => {
    const core = loadCore();
    const result = core.NetProtocol.replay(core.NetProtocol.initialSnapshot(), [
        { side: 'X', move: { place: [0, 0], fix: null } },
        { side: 'X', move: { place: [1, 1], fix: null } }
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'turn');
    assert.equal(result.at, 1);
    assert.equal(result.applied, undefined);
});
