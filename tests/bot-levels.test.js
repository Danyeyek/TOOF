'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadBot } = require('./helpers/load-bot');

const emptyBoard = core =>
    Array.from({ length: core.BOARD_SIZE }, () => Array(core.BOARD_SIZE).fill(core.EMPTY));

test('четыре уровня сложности идут от простого к сложному', () => {
    const { Bot } = loadBot();
    assert.deepEqual(Bot.LEVELS.map(level => level.id), [1, 2, 3, 4]);
    assert.deepEqual(Bot.LEVELS.map(level => level.name),
        ['Простой', 'Средний', 'Опытный', 'Сложный']);
});

test('прежние профили сдвинуты на один уровень вверх', () => {
    const { Bot } = loadBot();
    const profiles = Bot.LEVELS.map(level => level.profile);
    assert.deepEqual(profiles[1], {
        searchDepth: 2, rootMoves: 3, limits: [4, 3, 3], attention: 0.20
    });
    assert.deepEqual(profiles[2], {
        searchDepth: 3, rootMoves: 8, limits: [7, 5, 4], attention: 0.85
    });
    assert.deepEqual(profiles[3], {
        searchDepth: 3, rootMoves: 13, limits: [10, 6, 4], attention: 1.00
    });
});

test('у нового простого уровня перебор уже, чем у среднего', () => {
    const { Bot } = loadBot();
    const easy = Bot.LEVELS[0].profile;
    const medium = Bot.LEVELS[1].profile;
    assert.deepEqual(easy, {
        searchDepth: 2, rootMoves: 1, limits: [1, 1, 1], attention: 0.10
    });
    assert.equal(easy.searchDepth, medium.searchDepth);
    assert.ok(easy.rootMoves < medium.rootMoves);
    assert.ok(easy.limits.every((limit, i) => limit < medium.limits[i]));
    assert.ok(easy.attention < medium.attention);
});

test('у простого нет дебютного усиления, у среднего оно на два хода', () => {
    const core = loadBot();
    const { Bot } = core;
    const board = emptyBoard(core);

    assert.equal(Bot.openingMoves.call({ level: 1 }), 0);
    assert.equal(Bot.openingMoves.call({ level: 2 }), 2);
    assert.equal(Bot.openingMoves.call({ level: 3 }), 3);
    assert.equal(Bot.openingMoves.call({ level: 4 }), 3);

    Bot.applyLevel(1);
    assert.deepEqual(Bot.profileFor(core.SIDE_O, board), Bot.LEVELS[0].profile);
    Bot.applyLevel(2);
    assert.deepEqual(Bot.profileFor(core.SIDE_O, board), Bot.LEVELS[2].profile);

    board[0][0] = core.SIDE_O;
    board[0][1] = core.SIDE_O;
    assert.deepEqual(Bot.profileFor(core.SIDE_O, board), Bot.LEVELS[1].profile);
});

test('смена уровня и авто-повышение работают в пределах 1..4', () => {
    const { Bot } = loadBot();
    assert.equal(Bot.setLevel(4), true);
    assert.equal(Bot.name(), 'Сложный');
    assert.equal(Bot.setLevel(5), false);

    assert.equal(Bot.setLevel(1), true);
    Bot.recordResult(true);
    Bot.recordResult(true);
    assert.equal(Bot.level, 1);
    const raised = Bot.recordResult(true);
    assert.equal(raised.level, 2);
    assert.equal(raised.direction, 'up');

    Bot.setLevel(1);
    Bot.recordResult(false);
    Bot.recordResult(false);
    assert.equal(Bot.level, 1, 'ниже первого уровня опускаться некуда');
});
