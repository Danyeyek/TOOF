'use strict';

/* ============================================================
   TOOF — инициализация Firebase (Auth + Firestore).
   Если config не заполнен или SDK не загрузился, онлайн просто
   выключается, а локальные режимы продолжают работать.
   ============================================================ */

const Net = (() => {
    let ready = false;
    let reason = 'not-initialized';
    let app = null;
    let auth = null;
    let db = null;
    let authPromise = null;

    function isConfigured() {
        if (typeof FIREBASE_CONFIG !== 'object' || !FIREBASE_CONFIG) return false;
        return !Object.values(FIREBASE_CONFIG).some(value =>
            typeof value === 'string' && value.indexOf('PASTE_') === 0
        );
    }

    function init() {
        if (ready) return { ready: true };
        if (!isConfigured()) {
            reason = 'not-configured';
            return { ready: false, reason };
        }
        if (typeof firebase === 'undefined' || !firebase.initializeApp) {
            reason = 'sdk-missing';
            return { ready: false, reason };
        }

        try {
            app = firebase.apps && firebase.apps.length
                ? firebase.app()
                : firebase.initializeApp(FIREBASE_CONFIG);
            auth = firebase.auth();
            db = firebase.firestore();

            /* Для Auth используется LOCAL persistence (по умолчанию),
               поэтому сессия переживает перезагрузку страницы. */
            try {
                db.settings({ ignoreUndefinedProperties: true });
            } catch (e) { /* уже настроено */ }

            ready = true;
            reason = null;
            return { ready: true };
        } catch (error) {
            reason = 'init-failed';
            return { ready: false, reason, error };
        }
    }

    function ensureAuth() {
        if (!ready) return Promise.reject(new Error('Firebase не настроен'));
        if (authPromise) return authPromise;

        authPromise = new Promise((resolve, reject) => {
            const stop = auth.onAuthStateChanged(user => {
                if (user) {
                    stop();
                    resolve(user);
                    return;
                }
                auth.signInAnonymously().catch(error => {
                    stop();
                    reject(error);
                });
            }, reject);
        }).finally(() => {
            authPromise = null;
        });

        return authPromise;
    }

    function currentUser() {
        return auth ? auth.currentUser : null;
    }

    function isRegistered(user) {
        const account = user || currentUser();
        if (!account) return false;
        if (account.email) return true;
        return (account.providerData || []).some(provider =>
            provider.providerId === 'google.com' || provider.providerId === 'password'
        );
    }

    function signInGoogle() {
        if (!ready) return Promise.reject(new Error('Firebase не настроен'));
        const provider = new firebase.auth.GoogleAuthProvider();
        const user = auth.currentUser;

        if (user && user.isAnonymous) {
            return user.linkWithPopup(provider).then(result => result.user).catch(error => {
                /* Google уже привязан к другому Firebase-аккаунту:
                   входим в него, локальные данные перенесёт Profile. */
                if (error && error.code === 'auth/credential-already-in-use') {
                    return auth.signInWithPopup(provider).then(result => result.user);
                }
                throw error;
            });
        }
        return auth.signInWithPopup(provider).then(result => result.user);
    }

    function signOut() {
        if (!ready) return Promise.reject(new Error('Firebase не настроен'));
        return auth.signOut();
    }

    function serverTimestamp() {
        return firebase.firestore.FieldValue.serverTimestamp();
    }

    function increment(value) {
        return firebase.firestore.FieldValue.increment(value);
    }

    return {
        init,
        ensureAuth,
        currentUser,
        isRegistered,
        signInGoogle,
        signOut,
        serverTimestamp,
        increment,
        isConfigured,
        get ready() { return ready; },
        get reason() { return reason; },
        get app() { return app; },
        get auth() { return auth; },
        get db() { return db; }
    };
})();
