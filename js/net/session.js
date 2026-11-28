'use strict';

/* ============================================================
   TOOF — онлайн-сессия одной партии.
   Держит снимок, проверяет ходы, ждёт подтверждения из журнала.
   Не трогает DOM: UI подписывается на onUpdate.
   ============================================================ */

function createOnlineSession(options) {
    const transport = options.transport;
    const protocol = options.protocol || NetProtocol;
    const gameId = options.gameId;
    const myUid = options.myUid;

    let snapshot = options.initialSnapshot || protocol.initialSnapshot();
    let game = options.initialGame || null;
    let moves = [];
    let mySide = options.mySide || null;
    let opponentName = options.opponentName || 'Соперник';
    let awaitingEcho = false;
    let appliedPly = 0;
    let winner = null;
    let status = options.status || 'connecting';
    let rematchGameId = null;
    let destroyed = false;
    let unsub = null;
    let echoTimer = null;
    const echoTimeoutMs = options.echoTimeoutMs || 5000;

    const onUpdate = options.onUpdate || function () {};
    const onError = options.onError || function () {};

    function otherUid() {
        if (!game || !Array.isArray(game.players)) return null;
        return game.players.find(uid => uid !== myUid) || null;
    }

    function refreshNames() {
        if (!game) return;
        const other = otherUid();
        if (other && game.names && game.names[other]) opponentName = game.names[other];
        if (!mySide && game.sides) mySide = game.sides[myUid] || null;
    }

    function opponentRank() {
        const other = otherUid();
        if (!other || !game || !game.ranks) return 0;
        const number = Number(game.ranks[other]);
        return Number.isInteger(number) && number >= 0 ? number : 0;
    }

    /* Победитель при сдаче — соперник того, кто нажал «Сдаться». */
    function surrenderWinner() {
        const by = game && game.surrenderedBy;
        if (!by || !game.sides || !game.sides[by]) return null;
        return game.sides[by] === 'X' ? 'O' : 'X';
    }

    function emit() {
        if (destroyed) return;
        onUpdate({
            snapshot,
            game,
            moves: moves.slice(),
            mySide,
            opponentName,
            opponentUid: otherUid(),
            opponentRank: opponentRank(),
            awaitingEcho,
            winner,
            status,
            mode: game && game.mode || null,
            surrenderedBy: game && game.surrenderedBy || null,
            closedBy: game && game.closedBy || null,
            surrenderWinner: surrenderWinner(),
            rematchGameId,
            appliedPly
        });
    }

    function rebuild(list) {
        const sorted = (list || []).slice().sort((a, b) => Number(a.ply) - Number(b.ply));
        const result = protocol.replay(options.initialSnapshot || protocol.initialSnapshot(), sorted.map(item => ({
            side: item.side,
            move: { place: item.place, fix: item.fix || null }
        })));

        if (!result.ok) {
            onError(new Error('Соперник прислал недопустимый ход (ply ' + (result.at + 1) + ')'));
            return false;
        }

        moves = sorted;
        snapshot = result.snapshot;
        winner = result.winner;
        appliedPly = sorted.length;
        return true;
    }

    function handleGame(data) {
        game = data;
        refreshNames();

        if (data.status === 'abandoned') status = 'abandoned';
        else if (data.status === 'finished') status = 'finished';
        else if (data.status === 'invited') status = 'invited';
        else if (data.status === 'surrendered') status = 'surrendered';
        else if (data.status === 'closed') status = 'closed';
        else status = 'active';

        if (data.rematchGameId) {
            rematchGameId = data.rematchGameId;
            status = 'rematch';
        }

        emit();
    }

    function clearEchoTimer() {
        if (echoTimer) {
            clearTimeout(echoTimer);
            echoTimer = null;
        }
    }

    function watchEcho() {
        clearEchoTimer();
        echoTimer = setTimeout(() => {
            echoTimer = null;
            if (destroyed || !awaitingEcho) return;
            /* Запись хода прошла, но эхо из журнала не пришло (например,
               слушатель отвалился). Перечитаем журнал, иначе сессия
               навсегда останется в состоянии «ождём ответ». */
            resync().catch(error => onError(error));
        }, echoTimeoutMs);
    }

    function handleMoves(list) {
        const previous = appliedPly;
        if (!rebuild(list)) return;
        if (awaitingEcho && appliedPly > previous) {
            awaitingEcho = false;
            clearEchoTimer();
        }
        emit();
    }

    function handleError(error) {
        onError(error);
    }

    function start() {
        if (unsub) return;
        unsub = transport.subscribeGame(gameId, {
            onGame: handleGame,
            onMoves: handleMoves,
            onError: handleError
        });
    }

    function validateLocal(move) {
        if (!mySide) return { ok: false, reason: 'side' };
        return protocol.reduce(snapshot, mySide, move);
    }

    async function commitMove(move) {
        if (awaitingEcho) return { ok: false, reason: 'pending' };
        if (!mySide) return { ok: false, reason: 'side' };

        const check = validateLocal(move);
        if (!check.ok) return check;

        awaitingEcho = true;
        emit();

        try {
            await transport.sendMove({
                gameId,
                side: mySide,
                ply: appliedPly,
                move,
                winner: check.winner || null
            });
            watchEcho();
            return { ok: true, winner: check.winner || null };
        } catch (error) {
            clearEchoTimer();
            awaitingEcho = false;
            await resync().catch(() => {});
            onError(error);
            return { ok: false, reason: 'send', error };
        }
    }

    async function resync() {
        clearEchoTimer();
        try {
            const list = await transport.fetchMoves(gameId);
            if (!rebuild(list)) return false;
            return true;
        } finally {
            /* Даже если журнал временно недоступен, разблокируем ход,
               чтобы игрок мог повторить отправку. */
            awaitingEcho = false;
            emit();
        }
    }

    async function rematch() {
        const id = await transport.requestRematch(gameId);
        rematchGameId = id;
        return id;
    }

    async function leave() {
        await transport.setStatus(gameId, 'abandoned');
    }

    async function surrender() {
        await transport.surrender(gameId, myUid);
    }

    async function closeGame() {
        await transport.closeGame(gameId, myUid);
    }

    function destroy() {
        destroyed = true;
        clearEchoTimer();
        if (unsub) unsub();
        unsub = null;
    }

    return {
        start,
        validateLocal,
        commitMove,
        resync,
        rematch,
        leave,
        surrender,
        closeGame,
        destroy,
        get snapshot() { return snapshot; },
        get game() { return game; },
        get mySide() { return mySide; },
        get opponentName() { return opponentName; },
        get opponentUid() { return otherUid(); },
        get opponentRank() { return opponentRank(); },
        get awaitingEcho() { return awaitingEcho; },
        get winner() { return winner; },
        get status() { return status; },
        get mode() { return game && game.mode || null; },
        get surrenderedBy() { return game && game.surrenderedBy || null; },
        get closedBy() { return game && game.closedBy || null; },
        get surrenderWinner() { return surrenderWinner(); },
        get rematchGameId() { return rematchGameId; },
        get appliedPly() { return appliedPly; }
    };
}
