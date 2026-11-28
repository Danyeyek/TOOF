'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['js/rules.js', 'js/game-core.js', 'js/colors.js', 'js/ui.js'];

function loadUI({ preferred = null, botFirst = 'X' } = {}) {
    const store = {};
    if (preferred) store.toof_color = preferred;
    const classes = new Set();
    const elements = new Map();
    const messages = [];

    function element(id) {
        if (!elements.has(id)) {
            const own = new Set();
            let text = '';
            const el = {
                hidden: false,
                innerHTML: '',
                className: '',
                title: '',
                style: {},
                classList: {
                    toggle(name, on) {
                        const value = on === undefined ? !own.has(name) : !!on;
                        if (value) own.add(name); else own.delete(name);
                        return value;
                    },
                    add(name) { own.add(name); },
                    remove(name) { own.delete(name); },
                    contains(name) { return own.has(name); }
                },
                setAttribute() {},
                blur() {},
                addEventListener() {},
                closest() { return null; }
            };
            Object.defineProperty(el, 'textContent', {
                get() { return text; },
                set(value) {
                    text = String(value);
                    if (id === 'gameMessage') messages.push(text);
                }
            });
            elements.set(id, el);
        }
        return elements.get(id);
    }

    const sandbox = {
        console,
        localStorage: {
            getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
            setItem(k, v) { store[k] = String(v); }
        },
        document: {
            documentElement: {
                classList: {
                    toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
                    contains(name) { return classes.has(name); }
                }
            },
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
            firstSide(level, humanSide) { return botFirst; }
        },
        Profile: { state: { uid: 'me' } },
        Lobby: { leave() {} },
        NetProtocol: {}
    };

    vm.createContext(sandbox);
    vm.runInContext(
        FILES.map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n') +
        '\n;globalThis.__TOOF__ = { UI, Game, Colors };',
        sandbox,
        { filename: 'toof-color-sides.js' }
    );
    return {
        UI: sandbox.__TOOF__.UI,
        Game: sandbox.__TOOF__.Game,
        Colors: sandbox.__TOOF__.Colors,
        elements, classes, store, messages
    };
}

/* Бот, который ходит первым, сразу пишет «Бот думает…», поэтому стартовое
   сообщение берём из истории — это первая запись после UI.start(). */
function messageOf(ui) {
    return ui.messages[0];
}

test('бот-режим: игрок сохраняет выбранный цвет при любом первом ходе', () => {
    for (const [preferred, humanSide, first, text] of [
        ['orange', 'X', 'X', 'Вы ходите первым (оранжевым).'],
        ['orange', 'X', 'O', 'Бот ходит первым (фиолетовым). Вы — оранжевый.'],
        ['purple', 'O', 'O', 'Вы ходите первым (фиолетовым).'],
        ['purple', 'O', 'X', 'Бот ходит первым (оранжевым). Вы — фиолетовый.']
    ]) {
        const ui = loadUI({ preferred, botFirst: first });
        ui.UI.start('bot');
        assert.equal(ui.UI.state.human, humanSide, preferred + ': сторона игрока');
        assert.equal(ui.Game.current, first, preferred + ': сторона первого хода');
        assert.equal(messageOf(ui), text);
        assert.equal(ui.classes.has('prefer-purple'), ui.Colors.shouldSwap(humanSide),
            preferred + ': игрок видит свой выбранный цвет');

        ui.UI.cellClick(0, 0);
        const canPlace = first === humanSide;
        assert.equal(ui.Game.board[0][0], canPlace ? humanSide : '',
            preferred + ': ходить может только своя сторона');
    }
});

test('обучение начинает человек, не меняя его цвет', () => {
    const ui = loadUI({ preferred: 'purple', botFirst: 'X' });
    ui.UI.start('bot', { fixedFirst: true });
    assert.equal(ui.UI.state.human, 'O');
    assert.equal(ui.Game.current, 'O');
    assert.equal(messageOf(ui), 'Вы ходите первым (фиолетовым).');
});

test('локальный режим: выбранный цвет получает первый игрок', () => {
    const ui = loadUI({ preferred: 'purple' });
    ui.UI.start('local');
    assert.equal(ui.Game.current, 'X');
    assert.equal(messageOf(ui), 'Первым ходит фиолетовый — Игрок 1.');
    assert.equal(ui.classes.has('prefer-purple'), true);
});

test('сеть: цвета сторон фиксированы и не зависят от настройки второго игрока', () => {
    for (const preferred of ['orange', 'purple']) {
        for (const mySide of ['X', 'O']) {
            const ui = loadUI({ preferred });
            const snapshot = ui.Game.snapshot();
            ui.UI.startOnline({
                mySide,
                opponentName: 'Соперник',
                status: 'active',
                appliedPly: 0,
                snapshot
            });
            assert.equal(ui.classes.has('prefer-purple'), false,
                preferred + '/' + mySide + ': палитра не перекрашивает соперника');
            assert.equal(messageOf(ui),
                'Вы играете ' + (mySide === 'X' ? 'оранжевым' : 'фиолетовым') + '.');
        }
    }
});
