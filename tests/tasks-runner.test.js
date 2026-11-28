'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');

const tasksBat = read('tasks.bat');
const deployBat = read('deploy.bat');

function parseRegistry(source) {
    const tasks = new Map();
    const re = /^set "TASK_(\d+)_(ID|NAME|LABEL|AUTO)=(.*)"$/gm;
    let match;
    while ((match = re.exec(source)) !== null) {
        const [, index, field, value] = match;
        if (!tasks.has(index)) tasks.set(index, {});
        tasks.get(index)[field] = value;
    }
    return tasks;
}

function labels(source) {
    return new Set(
        [...source.matchAll(/^:([A-Za-z_][A-Za-z0-9_]*)$/gm)].map(match => match[1])
    );
}

test('tasks.bat registry is complete and consistent', () => {
    const tasks = parseRegistry(tasksBat);
    const declared = Number(
        tasksBat.match(/^set "TASK_COUNT=(\d+)"$/m)?.[1]
    );

    assert.equal(tasks.size, declared, 'TASK_COUNT must match the number of registered tasks');

    const definedLabels = labels(tasksBat);
    const ids = new Set();
    for (const [index, task] of tasks) {
        for (const field of ['ID', 'NAME', 'LABEL', 'AUTO']) {
            assert.ok(task[field], `task ${index} is missing ${field}`);
        }
        assert.ok(!ids.has(task.ID), `duplicate task id: ${task.ID}`);
        ids.add(task.ID);
        assert.ok(definedLabels.has(task.LABEL), `task ${task.ID} points to a missing label: ${task.LABEL}`);
        assert.ok(['0', '1'].includes(task.AUTO), `task ${task.ID} has invalid AUTO flag`);
    }
});

test('deploy-rules task runs the Firestore rules and indexes deploy', () => {
    assert.match(tasksBat, /:taskDeployRules[\s\S]*?firebase deploy --only firestore:rules,firestore:indexes/);
    assert.match(tasksBat, /:taskDeploySite[\s\S]*?firebase deploy --only hosting/);
});

test('every deploy task supports dry-run mode', () => {
    const bodies = tasksBat.split(/^:task[A-Za-z]+\s*$/m).slice(1);
    assert.ok(bodies.length >= 2, 'expected at least two task implementations');
    for (const body of bodies.filter(body => body.includes('firebase deploy'))) {
        assert.match(body, /if defined DRY exit \/b 0/);
    }
});

test('deploy.bat delegates to the deploy-rules task and keeps the window open', () => {
    assert.match(deployBat, /call "%~dp0tasks\.bat" deploy-rules -pause/);
    assert.match(deployBat, /call "%~dp0tasks\.bat" deploy-rules %\*/);
});

test('scripts are excluded from Firebase Hosting', () => {
    const firebaseJson = JSON.parse(read('firebase.json'));
    const ignore = firebaseJson.hosting.ignore;
    assert.ok(ignore.includes('tasks.bat'));
    assert.ok(ignore.includes('deploy.bat'));
});

test('README documents every task id', () => {
    const readme = read('README.md');
    const ids = [...parseRegistry(tasksBat).values()].map(task => task.ID);
    for (const id of ids) {
        assert.match(readme, new RegExp(`\\b${id}\\b`), `README is missing task ${id}`);
    }
    assert.match(readme, /-dry/);
});
