'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadTutorial(globals) {
    const source = ['js/rules.js', 'js/tutorial.js']
        .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8'))
        .join('\n') + '\n;globalThis.__Tutorial = Tutorial;';

    const sandbox = Object.assign({
        console,
        I18N: { lang: 'ru' },
        Sound: { play() {} },
        Bot: { setLevel() { return true; } },
        UI: { start() {} },
        setTimeout,
        clearTimeout
    }, globals || {});
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-tutorial-bundle.js' });
    return { sandbox, Tutorial: sandbox.__Tutorial };
}

test('кнопка обучения запускает элементарный режим и обновляет подсветку', () => {
    const levels = [];
    const events = [];
    const started = [];
    const elements = new Map();
    const fakeElement = () => ({
        hidden: false, innerHTML: '', textContent: '', style: {},
        addEventListener() {}, setAttribute() {}, blur() {}, focus() {}
    });
    const document = {
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, fakeElement());
            return elements.get(id);
        },
        addEventListener() {},
        dispatchEvent(event) { events.push(event.type); }
    };

    const { Tutorial } = loadTutorial({
        document,
        CustomEvent: class CustomEvent {
            constructor(type) { this.type = type; }
        },
        Bot: { setLevel(level) { levels.push(level); return true; } },
        UI: { start(mode, opts) { started.push([mode, opts]); } }
    });

    Tutorial.play();

    assert.deepEqual(levels, [1], 'обучение выбирает элементарный уровень');
    assert.ok(events.includes('toof:difficulty'), 'список режимов обновляется сразу');
    assert.deepEqual(started, [['bot', { fixedFirst: true }]]);
});
