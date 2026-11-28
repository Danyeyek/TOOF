'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadBot } = require('./helpers/load-bot');

const emptyBoard = core =>
    Array.from({ length: core.BOARD_SIZE }, () => Array(core.BOARD_SIZE).fill(core.EMPTY));

function fakeStorage(initial) {
    const data = Object.assign({}, initial);
    return {
        getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
        setItem(k, v) { data[k] = String(v); }
    };
}

test('семь уровней: случайный первый ход на всех', () => {
    const { Bot } = loadBot();
    assert.deepEqual(Bot.LEVELS.map(level => level.id), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(Bot.LEVELS.map(level => level.name),
        ['Элементарный', 'Простой', 'Умеренный', 'Средний', 'Напряжённый', 'Сложный', 'Невыносимый']);
    assert.deepEqual(Bot.LEVELS[6].profile, {
        searchDepth: 3, rootMoves: 16, limits: [12, 7, 4], attention: 1.00, winAttention: 1
    });
    assert.equal(Bot.LEVELS[6].bracketGuard, true);
    assert.equal(Bot.LEVELS[5].bracketGuard, undefined);
    assert.ok(Bot.LEVELS.every(level => level.randomFirst));
});

test('элементарный выбирается как полноценный режим', () => {
    const { Bot } = loadBot();
    assert.equal(Bot.isLevelUnlocked(1), true);
    assert.equal(Bot.setLevel(1), true);
    assert.equal(Bot.level, 1);
    assert.equal(Bot.name(), 'Элементарный');
    assert.deepEqual(Bot.profileFor('X', emptyBoard({ BOARD_SIZE: 10, EMPTY: '' })), Bot.LEVELS[0].profile);
});

test('профили прежних уровней сохранены под новыми номерами', () => {
    const { Bot } = loadBot();
    const profiles = Bot.LEVELS.map(level => level.profile);
    assert.deepEqual(profiles[1], {
        searchDepth: 1, rootMoves: 2, limits: [2, 2, 2], attention: 0.10, winAttention: 1
    });
    assert.deepEqual(profiles[3], {
        searchDepth: 2, rootMoves: 3, limits: [4, 3, 3], attention: 0.20, winAttention: 1
    });
    assert.deepEqual(profiles[4], {
        searchDepth: 3, rootMoves: 8, limits: [7, 5, 4], attention: 0.85, winAttention: 1
    });
    assert.deepEqual(profiles[5], {
        searchDepth: 3, rootMoves: 13, limits: [10, 6, 4], attention: 1.00, winAttention: 1
    });
});

test('элементарный уже простого, а умеренный между простым и средним', () => {
    const { Bot } = loadBot();
    const [elementary, easy, moderate, medium] = Bot.LEVELS.map(l => l.profile);

    assert.deepEqual(elementary, {
        searchDepth: 1, rootMoves: 1, limits: [1, 1, 1], attention: 0, winAttention: 0.6
    });
    assert.ok(elementary.rootMoves < easy.rootMoves);
    assert.ok(elementary.limits.every((limit, i) => limit < easy.limits[i]));
    assert.ok(elementary.attention < easy.attention);
    assert.ok(elementary.winAttention < easy.winAttention);

    assert.deepEqual(moderate, {
        searchDepth: 1, rootMoves: 3, limits: [3, 2, 2], attention: 0.15, winAttention: 1
    });
    assert.ok(moderate.rootMoves > easy.rootMoves);
    assert.ok(moderate.limits.every((limit, i) => limit >= easy.limits[i]));
    assert.ok(moderate.attention > easy.attention);
    assert.ok(moderate.searchDepth < medium.searchDepth);
    assert.ok(moderate.limits.every((limit, i) => limit < medium.limits[i]));
    assert.ok(moderate.attention < medium.attention);
});

test('дебют задан профилем уровня: 0, 2, 2, 2, 3, 3, 3 хода', () => {
    const core = loadBot();
    const { Bot } = core;
    const board = emptyBoard(core);

    for (const level of core.Bot.LEVELS) {
        Bot.applyLevel(level.id);
        assert.equal(Bot.openingMoves(), [0, 2, 2, 2, 3, 3, 3][level.id - 1]);
    }

    Bot.applyLevel(2);
    assert.deepEqual(Bot.profileFor(core.SIDE_O, board), Bot.LEVELS[3].profile);
    board[0][0] = core.SIDE_O;
    board[0][1] = core.SIDE_O;
    assert.deepEqual(Bot.profileFor(core.SIDE_O, board), Bot.LEVELS[1].profile);
    board[0][0] = core.EMPTY;
    board[0][1] = core.EMPTY;

    Bot.applyLevel(3);
    assert.deepEqual(Bot.profileFor(core.SIDE_O, board), Bot.LEVELS[3].profile);
    board[0][0] = core.SIDE_O;
    assert.deepEqual(Bot.profileFor(core.SIDE_O, board), Bot.LEVELS[3].profile);
    board[0][1] = core.SIDE_O;
    assert.deepEqual(Bot.profileFor(core.SIDE_O, board), Bot.LEVELS[2].profile);

    board[0][0] = core.EMPTY;
    Bot.applyLevel(4);
    assert.deepEqual(Bot.profileFor(core.SIDE_O, board), Bot.LEVELS[4].profile);
    board[0][0] = core.SIDE_O;
    board[0][1] = core.SIDE_O;
    assert.deepEqual(Bot.profileFor(core.SIDE_O, board), Bot.LEVELS[3].profile);

    board[0][0] = core.EMPTY;
    board[0][1] = core.EMPTY;
    Bot.applyLevel(5);
    assert.deepEqual(Bot.profileFor(core.SIDE_O, board), Bot.LEVELS[5].profile);
    Bot.applyLevel(6);
    assert.deepEqual(Bot.profileFor(core.SIDE_O, board), Bot.LEVELS[5].profile);
});

test('смена уровня и авто-повышение работают в пределах 1..7', () => {
    const { Bot } = loadBot();
    Bot.rankState.rankLevel =7;
    assert.equal(Bot.setLevel(6), true);
    assert.equal(Bot.name(), 'Сложный');
    assert.equal(Bot.setLevel(7), true);
    assert.equal(Bot.name(), 'Невыносимый');
    assert.equal(Bot.setLevel(8), false);
    Bot.setLevel(6);
    Bot.recordResult(true);
    Bot.recordResult(true);
    assert.equal(Bot.recordResult(true).level, 7);

    assert.equal(Bot.setLevel(1), true);
    Bot.recordResult(true);
    Bot.recordResult(true);
    assert.equal(Bot.level, 1);
    const raised = Bot.recordResult(true);
    assert.equal(raised.level, 2);
    assert.equal(raised.name, 'Простой');
    assert.equal(raised.direction, 'up');

    Bot.setLevel(1);
    Bot.recordResult(false);
    Bot.recordResult(false);
    assert.equal(Bot.level, 1, 'ниже первого уровня опускаться некуда');

    Bot.setLevel(4);
    Bot.recordResult(false);
    Bot.recordResult(false);
    assert.equal(Bot.recordResult(false).level, 3);
});

test('серия считается только подряд: победа сбрасывает поражения', () => {
    const { Bot } = loadBot();
    Bot.rankState.rankLevel =7;
    Bot.setLevel(4);

    /* Два поражения, победа, затем ещё два поражения — смены уровня нет. */
    for (const humanWon of [false, false, true, false, false]) {
        const result = Bot.recordResult(humanWon, false);
        assert.equal(result.changed, false, `уровень не должен меняться после хода ${humanWon}`);
        assert.equal(Bot.level, 4);
    }
    assert.deepEqual(Bot.streak, { wins: 0, losses: 2 });

    /* Три поражения подряд — снижение на один уровень. */
    const dropped = Bot.recordResult(false, false);
    assert.equal(dropped.changed, true);
    assert.equal(dropped.direction, 'down');
    assert.equal(dropped.level, 3);
    assert.deepEqual(Bot.streak, { wins: 0, losses: 0 });

    /* Поражение сбрасывает серию побед: W,W,L,W не повышает уровень. */
    Bot.setLevel(4);
    Bot.recordResult(true);
    Bot.recordResult(true);
    Bot.recordResult(false);
    const raised = Bot.recordResult(true);
    assert.equal(raised.changed, false);
    assert.equal(Bot.level, 4);
});

test('сохранённый старый номер мигрирует в новую шкалу', () => {
    for (const [legacy, expected] of Object.entries({ 1: 2, 2: 4, 3: 5, 4: 6 })) {
        const store = fakeStorage({ toof_difficulty: legacy });
        const { Bot } = loadBot({ localStorage: store });
        assert.equal(Bot.load(), Number(expected));
        assert.equal(store.getItem('toof_difficulty_v2'), String(expected));
    }

    const store = fakeStorage({ toof_difficulty: '1', toof_difficulty_v2: '3' });
    const { Bot } = loadBot({ localStorage: store });
    assert.equal(Bot.load(), 3, 'новое сохранение важнее старого');
    assert.equal(Bot.setLevel(5), false, 'новый игрок не может сразу выбрать 5-й уровень');
    Bot.rankState.rankLevel =5;
    assert.equal(Bot.setLevel(5), true);
    assert.equal(store.getItem('toof_difficulty_v2'), '5');
});

test('старое сохранение не открывает Средний без органической победы', () => {
    const store = fakeStorage({
        toof_difficulty_v2: '4',
        toof_rank_v1: JSON.stringify({ maxLevel: 4, rankLevel: 0, masterWins: 0 })
    });
    const { Bot } = loadBot({ localStorage: store });
    Bot.load();
    assert.equal(Bot.isLevelUnlocked(4), false);
    assert.equal(Bot.setLevel(4), false);
});

test('серия побед сохраняется между выходами из игры', () => {
    const store = fakeStorage({ toof_difficulty_v2: '3' });
    const first = loadBot({ localStorage: store });
    first.Bot.load();
    first.Bot.recordResult(true, false);
    assert.deepEqual(JSON.parse(store.getItem('toof_streak')), { wins: 1, losses: 0 });

    const second = loadBot({ localStorage: store });
    assert.equal(second.Bot.load(), 3);
    assert.deepEqual(second.Bot.streak, { wins: 1, losses: 0 });
    second.Bot.recordResult(true, false);

    const third = loadBot({ localStorage: store });
    third.Bot.load();
    const result = third.Bot.recordResult(true, false);
    assert.equal(result.level, 4, 'три победы в разных сессиях повышают режим');
    assert.equal(result.rankChanged, 'Новичок');
});

test('первый ход: монетка на всех уровнях, включая 7-й', () => {
    const randomMath = value => {
        const stub = Object.create(Math);
        stub.random = () => value;
        return stub;
    };
    const first = loadBot({ Math: randomMath(0.1) }).Bot;
    assert.equal(first.firstSide(1), 'X');
    assert.equal(first.firstSide(7), 'X');
    const second = loadBot({ Math: randomMath(0.9) }).Bot;
    assert.equal(second.firstSide(3), 'O');
    assert.equal(second.firstSide(7), 'O');
});

test('сторона первого хода считается от стороны игрока, а не наоборот', () => {
    const randomMath = value => {
        const stub = Object.create(Math);
        stub.random = () => value;
        return stub;
    };
    const humanFirst = loadBot({ Math: randomMath(0.1) }).Bot;
    assert.equal(humanFirst.firstSide(7, 'X'), 'X');
    assert.equal(humanFirst.firstSide(7, 'O'), 'O');

    const botFirst = loadBot({ Math: randomMath(0.9) }).Bot;
    assert.equal(botFirst.firstSide(7, 'X'), 'O');
    assert.equal(botFirst.firstSide(7, 'O'), 'X');
});

function winTimes(bot, count) {
    for (let i = 0; i < count; i++) bot.recordResult(true, false);
}

test('ранги даются только органическим повышением', () => {
    const { Bot } = loadBot();
    assert.equal(Bot.rankName(), '');
    assert.equal(Bot.setLevel(4), false, 'средний закрыт до трёх побед на умеренном');
    assert.equal(Bot.setLevel(5), false, 'новый игрок не может выбрать 5-й уровень');
    assert.equal(Bot.setLevel(2), true);
    assert.equal(Bot.rankName(), '', 'ручной выбор уровня ранг не даёт');

    Bot.setLevel(3);
    winTimes(Bot, 2);
    const novice = Bot.recordResult(true, false);
    assert.equal(Bot.level, 4);
    assert.equal(novice.rankChanged, 'Новичок');
    assert.equal(Bot.rankName(), 'Новичок');

    winTimes(Bot, 3);
    assert.equal(Bot.level, 5);
    assert.equal(Bot.rankName(), 'Любитель');
    assert.equal(Bot.isLevelUnlocked(5), true);

    winTimes(Bot, 3);
    assert.equal(Bot.level, 6);
    assert.equal(Bot.rankName(), 'Опытный');
    winTimes(Bot, 3);
    assert.equal(Bot.level, 7);
    assert.equal(Bot.rankName(), 'Профи');
});

test('мастер растёт с каждой победой в седьмом режиме', () => {
    const { Bot } = loadBot();
    Bot.rankState.rankLevel =7;
    Bot.setLevel(7);
    assert.equal(Bot.recordResult(true, false).rankChanged, 'Мастер Ⅰ');
    assert.equal(Bot.recordResult(true, false).rankChanged, 'Мастер Ⅱ');
    assert.equal(Bot.recordResult(true, false).rankChanged, 'Мастер Ⅲ');
});

test('ранг и разблокировка сохраняются', () => {
    const store = fakeStorage({});
    const first = loadBot({ localStorage: store });
    first.Bot.setLevel(3);
    winTimes(first.Bot, 3);
    assert.equal(first.Bot.rankName(), 'Новичок');
    assert.equal(JSON.parse(store.getItem('toof_rank_v1')).maxLevel, 4);

    const second = loadBot({ localStorage: store });
    second.Bot.load();
    assert.equal(second.Bot.rankName(), 'Новичок');
    assert.equal(second.Bot.isLevelUnlocked(5), false);
    assert.equal(second.Bot.setLevel(6), false);
});

test('элементарный может прозевать решающий ход, сложный — никогда', () => {
    const core = loadBot();
    const { Bot, makeGame, key, SIDE_X, SIDE_O } = core;
    const game = makeGame();
    game.reset();
    /* Горизонтальная линия (9,0)-(9,3): три своих клетки и свободная точка.
       Два сектора уже свои, значит достройка даёт третий — решающий ход. */
    game.board[9][0] = SIDE_O;
    game.board[9][1] = SIDE_O;
    game.board[9][2] = SIDE_O;
    const mySec = new Set([0, 1]);
    const oppSec = new Set();
    const locked = new Set();
    const spot = key(9, 3);

    const low = Bot.blindCells(game.board, locked, SIDE_O, mySec, SIDE_X, oppSec, 0, 0);
    assert.ok(low.has(spot), 'при winAttention=0 решающая точка скрыта');

    const high = Bot.blindCells(game.board, locked, SIDE_O, mySec, SIDE_X, oppSec, 0, 1);
    assert.ok(!high.has(spot), 'при winAttention=1 решающая точка видна');
});

function bracketMove(core, level, cells) {
    const { Bot, makeGame, key, SIDE_X, SIDE_O } = core;
    const game = makeGame();
    game.reset();
    for (const cell of cells) game.board[cell[0]][cell[1]] = SIDE_X;
    Bot.rankState.rankLevel =7;
    Bot.setLevel(level);
    /* Дебютный жребий здесь не нужен: проверяем саму защиту от скобы. */
    Bot.random = () => 0;
    const move = Bot.decide(game.board, game.locked, SIDE_O, new Map());
    return move ? key(move.place[0], move.place[1]) : null;
}

test('невыносимый мешает построить прямую скобу, сложный — нет', () => {
    const core = loadBot();
    const bracket = [[4, 4], [4, 5], [4, 6], [5, 4]];
    const hole = core.key(5, 6);
    assert.equal(bracketMove(core, 6, bracket), core.key(5, 5));
    assert.equal(bracketMove(core, 7, bracket), hole, 'занимает пустую клетку внутри скобы');
});

test('невыносимый мешает построить диагональную скобу', () => {
    const core = loadBot();
    const bracket = [[3, 5], [4, 4], [4, 6], [6, 4]];
    const hole = core.key(5, 3);
    assert.equal(bracketMove(core, 6, bracket), core.key(3, 3));
    assert.equal(bracketMove(core, 7, bracket), hole);
});

test('дебют: разные первые ходы на уровнях 2–7, элементарный стабилен', () => {
    const core = loadBot();
    const { Bot, makeGame, key, SIDE_O } = core;
    const game = makeGame();
    game.reset(SIDE_O);
    const savedSpikes = Bot.spikes;
    Bot.spikes = {};
    try {
        for (const level of Bot.LEVELS) {
            Bot.applyLevel(level.id);
            const seen = new Set();
            const rolls = [0, 0.08, 0.17, 0.26, 0.35, 0.44, 0.53, 0.62, 0.71, 0.8, 0.89, 0.98];
            for (const roll of rolls) {
                Bot.random = () => roll;
                const move = Bot.decide(game.board, game.locked, SIDE_O, game.owners);
                assert.ok(move, 'ход должен быть');
                seen.add(key(move.place[0], move.place[1]));
            }
            if (level.id === 1) assert.equal(seen.size, 1, 'элементарный начинает одинаково');
            else assert.ok(seen.size > 1, `уровень ${level.id}: дебют должен меняться`);
        }
    } finally {
        Bot.spikes = savedSpikes;
    }
});

test('тир-всплески: шансы заданы для 1..4 и не меняют уровень', () => {
    const { Bot, makeGame, SIDE_O } = loadBot();
    const game = makeGame();
    game.reset(SIDE_O);
    assert.deepEqual(Object.keys(Bot.spikes).map(Number), [1, 2, 3, 4]);
    assert.deepEqual(Object.values(Bot.spikes).map(s => s.chance), [0.05, 0.10, 0.15, 0.15]);

    for (const [level, chance] of [[1, 0.05], [2, 0.10], [3, 0.15], [4, 0.15]]) {
        Bot.applyLevel(level);
        Bot.random = () => chance / 2;
        Bot.decide(game.board, game.locked, SIDE_O, game.owners);
        assert.equal(Bot.lastSpike, true, `уровень ${level}: всплеск должен сработать`);
        assert.equal(Bot.level, level, 'уровень не меняется');
        Bot.random = () => 0.99;
        Bot.decide(game.board, game.locked, SIDE_O, game.owners);
        assert.equal(Bot.lastSpike, false, `уровень ${level}: всплеск не должен сработать`);
    }
});
