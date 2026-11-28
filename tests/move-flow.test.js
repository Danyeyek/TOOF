'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['js/rules.js', 'js/game-core.js', 'js/colors.js', 'js/ui.js'];

function loadUI() {
    const elements = new Map();

    function element(id) {
        if (!elements.has(id)) {
            elements.set(id, {
                hidden: false,
                innerHTML: '',
                className: '',
                title: '',
                style: {},
                classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
                setAttribute() {},
                blur() {},
                addEventListener() {},
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
            querySelectorAll() { return []; },
            addEventListener() {},
            dispatchEvent() {}
        },
        window: { scrollTo() {} },
        setTimeout() { return 0; },
        clearTimeout() {},
        t: text => text,
        Sound: { play() {} },
        CustomEvent: class CustomEvent {
            constructor(type, detail) { this.type = type; this.detail = detail; }
        },
        Bot: {
            level: 1,
            name: () => 'Элементарный',
            rankName: () => '',
            recordResult() {},
            firstSide() { return 'X'; }
        },
        Profile: { state: { uid: 'me' } },
        Lobby: { leave() {} },
        NetProtocol: {}
    };

    vm.createContext(sandbox);
    vm.runInContext(
        FILES.map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n') +
        '\n;globalThis.__TOOF__ = { UI, Game };',
        sandbox,
        { filename: 'toof-move-flow.js' }
    );
    return { UI: sandbox.__TOOF__.UI, Game: sandbox.__TOOF__.Game, elements };
}

/* Готовые четыре клетки в ряд: фигуру можно подтвердить в любом ходу. */
function setupLine(ui) {
    for (let c = 0; c < 4; c++) ui.Game.board[0][c] = 'X';
    ui.UI.render();
}

test('при выделении фигуры доступна только кнопка подтверждения фигуры', () => {
    const ui = loadUI();
    ui.UI.start('local');
    setupLine(ui);
    assert.equal(ui.Game.pending, null);
    assert.equal(ui.elements.get('confirmMoveBtn').hidden, true);

    ui.UI.cellClick(5, 5);
    assert.equal(ui.elements.get('confirmMoveBtn').hidden, false);
    assert.equal(ui.elements.get('fixFigureBtn').hidden, true);

    ui.UI.cellClick(0, 0);
    assert.equal(ui.elements.get('confirmMoveBtn').hidden, true, 'выделение скрывает подтверждение хода');
    assert.equal(ui.elements.get('fixFigureBtn').hidden, false);

    ui.UI.cellClick(0, 0);
    assert.equal(ui.Game.selected.length, 0);
    assert.equal(ui.elements.get('confirmMoveBtn').hidden, false, 'снятие выделения возвращает кнопку');
});

test('подтверждение фигуры после закрашивания сразу закрывает ход', () => {
    const ui = loadUI();
    ui.UI.start('local');
    setupLine(ui);

    ui.UI.cellClick(5, 5);
    for (let c = 0; c < 4; c++) ui.UI.cellClick(0, c);
    assert.equal(ui.elements.get('confirmMoveBtn').hidden, true);

    ui.UI.onFix();

    assert.equal(ui.Game.figures.length, 1);
    assert.equal(ui.Game.turnFigures.length, 0);
    assert.equal(ui.Game.pending, null);
    assert.equal(ui.Game.selected.length, 0);
    assert.equal(ui.Game.current, 'O', 'ход перешёл без отдельного подтверждения');
    assert.equal(ui.elements.get('confirmMoveBtn').hidden, true);
});

test('фигура до закрашивания не закрывает ход', () => {
    const ui = loadUI();
    ui.UI.start('local');
    setupLine(ui);

    for (let c = 0; c < 4; c++) ui.UI.cellClick(0, c);
    ui.UI.onFix();

    assert.equal(ui.Game.figures.length, 1);
    assert.equal(ui.Game.current, 'X', 'ход остался у игрока');
    assert.equal(ui.elements.get('confirmMoveBtn').hidden, true, 'клетка ещё не закрашена');

    ui.UI.cellClick(5, 5);
    assert.equal(ui.elements.get('confirmMoveBtn').hidden, false);
    ui.UI.onConfirm();
    assert.equal(ui.Game.current, 'O');
});
