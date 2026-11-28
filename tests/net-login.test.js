'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadFirebase(authMock) {
    const source = fs.readFileSync(path.join(ROOT, 'js/net/firebase.js'), 'utf8') +
        '\n;globalThis.__NET__ = Net;';
    const sandbox = {
        console,
        FIREBASE_CONFIG: {
            apiKey: 'k', authDomain: 'd', projectId: 'p',
            storageBucket: 's', messagingSenderId: 'm', appId: 'a'
        },
        firebase: {
            apps: [],
            app() { return {}; },
            initializeApp() { return {}; },
            auth() { return authMock; },
            firestore() { return { settings() {} }; }
        }
    };
    /* compat SDK: firebase.auth — функция со статическими подобъектами. */
    sandbox.firebase.auth = Object.assign(() => authMock, {
        Auth: { Persistence: { LOCAL: 'local' } },
        GoogleAuthProvider: function GoogleAuthProvider() { this.providerId = 'google.com'; }
    });
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-firebase-bundle.js' });
    sandbox.__NET__.init();
    return sandbox.__NET__;
}

function makeAuth(user, linkError) {
    const calls = { popup: 0, credential: 0 };
    const auth = {
        currentUser: user,
        onAuthStateChanged(callback) {
            callback(user);
            return () => {};
        },
        signInAnonymously: async () => ({ uid: 'anon' }),
        signInWithPopup() {
            calls.popup++;
            return Promise.resolve({ user: { uid: 'popup-user' } });
        },
        signInWithCredential(credential) {
            calls.credential++;
            assert.equal(credential, linkError.credential);
            return Promise.resolve({ user: { uid: 'google-user' } });
        }
    };
    if (user && user.isAnonymous) {
        user.linkWithPopup = () => Promise.reject(linkError);
    }
    return { auth, calls };
}

test('вход со второго устройства использует credential из ошибки привязки', async () => {
    const credential = { idToken: 'google-token' };
    const { auth, calls } = makeAuth(
        { uid: 'anon-local', isAnonymous: true },
        { code: 'auth/credential-already-in-use', credential }
    );

    const user = await loadFirebase(auth).signInGoogle();

    assert.equal(user.uid, 'google-user');
    assert.equal(calls.credential, 1, 'повторный popup не нужен');
    assert.equal(calls.popup, 0, 'второй popup ломается с cancelled-popup-request');
});

test('при отсутствии credential используется popup, чужие ошибки пробрасываются', async () => {
    const noCredential = makeAuth(
        { uid: 'anon-local', isAnonymous: true },
        { code: 'auth/credential-already-in-use' }
    );
    assert.equal((await loadFirebase(noCredential.auth).signInGoogle()).uid, 'popup-user');
    assert.equal(noCredential.calls.popup, 1);

    const other = makeAuth(
        { uid: 'anon-local', isAnonymous: true },
        { code: 'auth/network-request-failed', credential: { idToken: 'x' } }
    );
    await assert.rejects(() => loadFirebase(other.auth).signInGoogle(), /network-request-failed/);
    assert.equal(other.calls.credential, 0);
    assert.equal(other.calls.popup, 0);
});

function loadProfile(options) {
    const source = fs.readFileSync(path.join(ROOT, 'js/net/profile.js'), 'utf8') +
        '\n;globalThis.__PROFILE__ = Profile;';
    const storage = new Map();
    const local = options.local || {};
    storage.set('toof_profile_v1', JSON.stringify(local));
    storage.set('toof_local_friends_v1', JSON.stringify(local.friends || []));
    storage.set('toof_local_stats_v1', JSON.stringify(local.stats || {}));

    const written = [];
    const subscribed = [];
    const codes = new Map(options.codes || []);
    let currentUser = options.user;
    const transport = {
        getUser: async uid => (options.remote && options.remote[uid]) || null,
        reserveCode: async (uid, code) => {
            if (!codes.has(code)) {
                codes.set(code, uid);
                return true;
            }
            return codes.get(code) === uid;
        },
        setUser: async (uid, data, merge) => written.push({ uid, data, merge }),
        addFriend: async () => {},
        subscribeUser: (uid, cb) => {
            subscribed.push(uid);
            return () => {};
        },
        setPresence: async () => {},
        recordStats: async () => {}
    };
    const sandbox = {
        console,
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, value)
        },
        document: {
            visibilityState: 'visible',
            addEventListener() {}, removeEventListener() {}
        },
        window: { addEventListener() {}, removeEventListener() {} },
        setInterval: () => 1,
        clearInterval() {},
        Net: {
            ready: true,
            serverTimestamp: () => ({ seconds: 1 }),
            isRegistered: user => !!(user && user.email),
            ensureAuth: async () => currentUser,
            signInGoogle: async () => options.googleUser,
            signOut: async () => { currentUser = options.userAfterSignOut || options.user; }
        },
        NetTransport: transport
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'toof-profile-bundle.js' });
    return { Profile: sandbox.__PROFILE__, written, subscribed, codes };
}

test('вход со второго устройства не затирает удалённый профиль локальными данными', async () => {
    const { Profile, written } = loadProfile({
        local: {
            uid: 'anon-local', name: 'Локальное имя', code: 'LOCAL1',
            registered: false, stats: { wins: 1, losses: 0, draws: 0 }
        },
        codes: [['LOCAL1', 'anon-local'], ['REMOTE1', 'google-user']],
        user: { uid: 'anon-local', isAnonymous: true },
        googleUser: { uid: 'google-user', email: 'a@b.c' },
        remote: {
            'google-user': {
                uid: 'google-user', name: 'Имя с первого устройства', code: 'REMOTE1',
                registered: true, stats: { wins: 7, losses: 2, draws: 1 }
            }
        }
    });

    await Profile.init();
    await Profile.upgrade();

    const state = Profile.state;
    assert.equal(state.uid, 'google-user');
    assert.equal(state.name, 'Имя с первого устройства');
    assert.equal(state.code, 'REMOTE1');
    assert.equal(state.stats.wins, 7);
    assert.ok(written.some(record => record.data.code === 'REMOTE1' && record.data.registered),
        'профиль обновлён кодом и данными первого устройства');
    assert.ok(!written.some(record => record.uid === 'google-user' && record.data.code === 'LOCAL1'),
        'локальный код второго устройства не попал в Google-аккаунт');
});

test('после выхода из Google аноним получает свой код и документ', async () => {
    const { Profile, written } = loadProfile({
        local: { uid: 'google-user', name: 'Имя', code: 'REMOTE1', registered: true },
        codes: [['REMOTE1', 'google-user']],
        user: { uid: 'google-user', email: 'a@b.c' },
        userAfterSignOut: { uid: 'anon-local', isAnonymous: true },
        remote: {
            'google-user': { uid: 'google-user', name: 'Имя', code: 'REMOTE1', registered: true }
        }
    });

    await Profile.init();
    await Profile.signOut();

    const state = Profile.state;
    assert.equal(state.uid, 'anon-local');
    assert.equal(state.registered, false);
    assert.notEqual(state.code, 'REMOTE1', 'код Google-аккаунта не присвоен анониму');
    assert.equal(state.code.length, 6);
    assert.ok(written.some(record => record.uid === 'anon-local' && record.data.code === state.code),
        'создан документ анонимного профиля');
});

test('правила требуют владельца кода и соответствия номера хода имени документа', () => {
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    assert.match(rules, /get\(codePath\(request\.resource\.data\.code\)\)\.data\.uid == uid\(\)/);
    assert.match(rules, /request\.resource\.data\.ply == int\(moveId\)/);
    assert.match(rules, /resource\.data\.status != 'finished'/);
});
