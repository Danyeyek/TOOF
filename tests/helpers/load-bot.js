'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const FILES = ['js/rules.js', 'js/game-core.js', 'js/bot.js'];

function loadBot() {
    const source = FILES
        .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8'))
        .join('\n') + `
;globalThis.__TOOF__ = {
    Bot, makeGame, key,
    BOARD_SIZE, EMPTY, SIDE_X, SIDE_O
};`;

    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-bot-bundle.js' });
    return sandbox.__TOOF__;
}

module.exports = { loadBot };
