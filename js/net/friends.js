'use strict';

/* ============================================================
   TOOF — друзья.
   Зарегистрированный игрок: список в Firestore и синхронизация.
   Аноним: список в localStorage, но заявки и приглашения
   всё равно ходят через Firestore.
   ============================================================ */

const Friends = (() => {
    const listeners = [];
    const presence = new Map();
    const presenceUnsubs = new Map();
    let friends = [];
    let incoming = [];
    let started = false;
    let unsubFriends = null;
    let unsubRequests = null;

    function millis(value) {
        if (!value) return 0;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (typeof value.seconds === 'number') return value.seconds * 1000;
        return 0;
    }

    function isOnline(user) {
        if (!user || user.online !== true) return false;
        const seen = millis(user.lastSeen);
        if (!seen) return true;
        return Date.now() - seen < 90000;
    }

    function snapshot() {
        return {
            friends: friends.map(friend => Object.assign({}, friend, {
                online: !!presence.get(friend.uid)
            })),
            incoming: incoming.slice()
        };
    }

    function emit() {
        const data = snapshot();
        for (const listener of listeners.slice()) {
            try { listener(data); } catch (e) { /* ignore */ }
        }
    }

    function subscribe(listener) {
        listeners.push(listener);
        if (started) listener(snapshot());
        return () => {
            const index = listeners.indexOf(listener);
            if (index !== -1) listeners.splice(index, 1);
        };
    }

    function setFriends(list) {
        friends = (list || []).filter(friend => friend && friend.uid);
        refreshPresence();
        emit();
    }

    function refreshPresence() {
        if (!Net.ready) {
            presence.clear();
            return;
        }

        const wanted = new Set(friends.map(friend => friend.uid));
        for (const [uid, unsub] of presenceUnsubs) {
            if (!wanted.has(uid)) {
                unsub();
                presenceUnsubs.delete(uid);
                presence.delete(uid);
            }
        }

        for (const friend of friends) {
            if (presenceUnsubs.has(friend.uid)) continue;
            const unsub = NetTransport.subscribeUser(friend.uid, user => {
                presence.set(friend.uid, isOnline(user));
                if (!Profile.isRegistered() && user && user.name) {
                    const local = Profile.localFriends();
                    const item = local.find(entry => entry.uid === friend.uid);
                    if (item && (item.name !== user.name || item.rank !== user.rank)) {
                        item.name = user.name;
                        item.rank = user.rank || 0;
                        Profile.saveLocalFriends(local);
                        friends = local;
                    }
                }
                emit();
            });
            presenceUnsubs.set(friend.uid, unsub);
        }
    }

    function friendById(uid) {
        return friends.find(friend => friend.uid === uid) || null;
    }

    async function addLocalOrRemote(friend) {
        if (!friend || !friend.uid) return;
        if (Profile.isRegistered()) {
            await NetTransport.addFriend(Profile.state.uid, friend);
        } else {
            Profile.addLocalFriend(friend);
            setFriends(Profile.localFriends());
        }
    }

    async function handleOutgoing(request) {
        if (!request || request.status !== 'accepted') return;
        if (!request.to || request.to === Profile.state.uid) return;
        if (friendById(request.to)) {
            await NetTransport.deleteFriendRequest(request.id).catch(() => {});
            return;
        }
        const user = await NetTransport.getUser(request.to).catch(() => null);
        if (user) await addLocalOrRemote(user);
        await NetTransport.deleteFriendRequest(request.id).catch(() => {});
    }

    function start() {
        if (started) return;
        started = true;

        if (Profile.isRegistered()) {
            unsubFriends = NetTransport.subscribeFriends(Profile.state.uid, list => {
                setFriends(list);
            });
        } else {
            setFriends(Profile.localFriends());
        }

        unsubRequests = NetTransport.subscribeFriendRequests(Profile.state.uid, data => {
            incoming = data.incoming || [];
            for (const request of data.outgoing || []) {
                handleOutgoing(request).catch(() => {});
            }
            emit();
        });
    }

    async function addByCode(code) {
        if (!Net.ready) throw new Error('Онлайн не настроен');
        const user = await NetTransport.getUserByCode(code);
        if (!user) throw new Error('Игрок с таким кодом не найден');
        if (user.uid === Profile.state.uid) throw new Error('Это ваш собственный код');
        if (friendById(user.uid)) return 'already';
        await NetTransport.sendFriendRequest(
            Profile.state.uid,
            user.uid,
            Profile.state.name,
            Profile.state.code
        );
        return 'pending';
    }

    async function accept(request) {
        if (!request) return;
        await NetTransport.acceptFriendRequest(request.id);
        const user = await NetTransport.getUser(request.from).catch(() => null);
        if (user) await addLocalOrRemote(user);
        /* Документ не удаляем сразу: отправитель увидит статус accepted,
           добавит вас в друзья и удалит заявку сам. */
        incoming = incoming.filter(item => item.id !== request.id);
        emit();
    }

    async function decline(request) {
        if (!request) return;
        await NetTransport.declineFriendRequest(request.id);
        await NetTransport.deleteFriendRequest(request.id).catch(() => {});
        incoming = incoming.filter(item => item.id !== request.id);
        emit();
    }

    async function remove(uid) {
        if (Profile.isRegistered()) {
            await NetTransport.removeFriend(Profile.state.uid, uid);
        } else {
            Profile.removeLocalFriend(uid);
            setFriends(Profile.localFriends());
        }
        emit();
    }

    function stop() {
        if (unsubFriends) unsubFriends();
        if (unsubRequests) unsubRequests();
        for (const unsub of presenceUnsubs.values()) unsub();
        presenceUnsubs.clear();
        presence.clear();
        unsubFriends = null;
        unsubRequests = null;
        started = false;
    }

    return {
        start,
        stop,
        subscribe,
        addByCode,
        accept,
        decline,
        remove,
        friendById,
        get friends() { return snapshot().friends; },
        get incoming() { return incoming.slice(); }
    };
})();
