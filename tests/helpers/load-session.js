'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const FILES = [
    'js/rules.js',
    'js/game-core.js',
    'js/net-protocol.js',
    'js/net/session.js'
];

function loadSession() {
    const source = FILES
        .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8'))
        .join('\n') + `
;globalThis.__TOOF_SESSION__ = {
    Game, makeGame, NetProtocol, createOnlineSession,
    BOARD_SIZE, EMPTY, SIDE_X, SIDE_O
};`;

    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-session-bundle.js' });
    return sandbox.__TOOF_SESSION__;
}

module.exports = { loadSession };
