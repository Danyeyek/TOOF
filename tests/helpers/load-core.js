'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const FILES = ['js/rules.js', 'js/game-core.js', 'js/net-protocol.js'];

function loadCore() {
    const source = FILES
        .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8'))
        .join('\n') + `
;globalThis.__TOOF__ = {
    Game, makeGame, NetProtocol,
    key, parseKey,
    BOARD_SIZE, SECTOR_SIZE, SECTORS_TO_WIN, MAX_FIGURE,
    EMPTY, SIDE_X, SIDE_O
};`;

    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-core-bundle.js' });
    return sandbox.__TOOF__;
}

module.exports = { loadCore };
