'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadColors(saved) {
    const data = {};
    if (saved) data.toof_color = saved;
    const classes = new Set();
    const sandbox = {
        console,
        localStorage: {
            getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
            setItem(k, v) { data[k] = String(v); }
        },
        document: {
            documentElement: { classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } } },
            getElementById() { return null; }
        },
        t: text => text
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/colors.js'), 'utf8') +
        '\n;globalThis.__COLORS__ = Colors;', sandbox);
    return { Colors: sandbox.__COLORS__, data, classes };
}

test('цвет по умолчанию оранжевый, переключатель меняет сторону палитры', () => {
    const { Colors, data, classes } = loadColors(null);
    assert.equal(Colors.preferredColor(), 'orange');
    assert.equal(Colors.shouldSwap('X'), false);
    assert.equal(Colors.shouldSwap('O'), true);

    Colors.applyFor('X');
    assert.equal(classes.has('prefer-purple'), false);

    assert.equal(Colors.toggle(), 'purple');
    assert.equal(data.toof_color, 'purple');
    assert.equal(Colors.shouldSwap('X'), true);
    assert.equal(Colors.shouldSwap('O'), false);

    Colors.applyFor('X');
    assert.equal(classes.has('prefer-purple'), true);
    Colors.applyFor('O');
    assert.equal(classes.has('prefer-purple'), false);
});

test('выбор цвета сохраняется', () => {
    const { Colors } = loadColors('purple');
    assert.equal(Colors.preferredColor(), 'purple');
});
