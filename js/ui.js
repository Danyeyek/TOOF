'use strict';

/* ============================================================
   Интерфейс: отрисовка поля, обработка кликов, режимы игры.
   ============================================================ */

const UI = (() => {
    const NAMES = {
        local: { X: 'Игрок 1', O: 'Игрок 2' },
        bot: { X: 'Вы', O: 'Бот' }
    };

    const state = {
        mode: 'local',
        human: 'X',
        botTimer: null,
        awaitingPass: false,
        message: '',
        messageKind: '',
        mySide: 'X',
        opponentName: '',
        session: null,
        awaitingEcho: false,
        onlineStatus: 'active',
        finished: false,
        lastPly: 0,
        pendingInvite: null,
        resumable: false
    };

    const $ = id => document.getElementById(id);

    function showScreen(id) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.toggle('is-active', screen.id === id);
        });
        closeSettings();
        const resume = $('resumeGameBtn');
        if (resume) resume.hidden = !(state.session || state.resumable);
        if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    }

    function setResumable(value) {
        state.resumable = !!value;
        const resume = $('resumeGameBtn');
        if (resume) resume.hidden = !(state.session || state.resumable);
    }

    function closeSettings() {
        const popover = $('settingsPopover');
        if (!popover) return;
        popover.hidden = true;
        const button = $('settingsButton');
        if (button) button.setAttribute('aria-expanded', 'false');
    }

    function setMessage(text, kind) {
        state.message = text;
        state.messageKind = kind || '';
        const box = $('gameMessage');
        box.textContent = t(text);
        box.className = 'message' + (kind ? ' ' + kind : '');
    }

    function nameOf(symbol) {
        if (state.mode === 'online') {
            return symbol === state.mySide ? t('Вы') : state.opponentName;
        }
        return t(NAMES[state.mode][symbol]);
    }

    function cellWord(count) {
        const mod10 = count % 10;
        const mod100 = count % 100;
        if (mod10 === 1 && mod100 !== 11) return t('клетка');
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t('клетки');
        return t('клеток');
    }

    function ariaCell(r, c, value) {
        const what = t(value === 'X' ? 'оранжевая' : value === 'O' ? 'фиолетовая' : 'пусто');
        let extra = '';
        if (Game.isLocked(r, c)) extra = t(', зафиксировано');
        else if (Game.isSelected(r, c)) extra = t(', выделено');
        return what + t(', строка ') + (r + 1) + t(', столбец ') + (c + 1) + extra;
    }

    function renderBoard() {
        const selecting = Game.selected.length > 0;
        let html = '';
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const value = Game.board[r][c];
                let cls = 'cell';
                if (value === 'X') cls += ' x';
                else if (value === 'O') cls += ' o';
                if (Game.isLocked(r, c)) cls += ' locked';

                // Подсветка одна: выбранные клетки важнее «только что поставленной».
                if (Game.isSelected(r, c)) {
                    cls += ' selected';
                } else if (!selecting && Game.pending &&
                           Game.pending[0] === r && Game.pending[1] === c) {
                    cls += ' pending';
                }

                html += '<div class="' + cls + '" role="gridcell" data-r="' + r + '" data-c="' + c +
                    '" aria-label="' + ariaCell(r, c, value) + '"></div>';
            }
        }
        $('boardGrid').innerHTML = html;
    }

    function render() {
        renderBoard();

        $('xName').textContent = nameOf('X');
        $('oName').textContent = nameOf('O');
        $('xSectors').textContent = Game.sectorsOf('X').size + '/' + SECTORS_TO_WIN;
        $('oSectors').textContent = Game.sectorsOf('O').size + '/' + SECTORS_TO_WIN;

        $('playerX').classList.toggle('is-turn', !Game.over && Game.current === 'X');
        $('playerO').classList.toggle('is-turn', !Game.over && Game.current === 'O');

        const turn = $('turnIndicator');
        if (Game.over) {
            turn.textContent = Game.winner ? '🏆 ' + nameOf(Game.winner) : t('🤝 Ничья');
            turn.className = 'turn is-over';
        } else {
            turn.textContent = t('Ход: ') + nameOf(Game.current);
            turn.className = 'turn ' + (Game.current === 'X' ? 'turn-x' : 'turn-o');
        }

        const canAct = canActNow();
        $('fixFigureBtn').hidden = !(canAct && Game.pending && Game.selected.length > 0);
        $('confirmMoveBtn').hidden = !(canAct && Game.pending && Game.selected.length === 0);
        $('resetButton').hidden = !Game.over || state.mode === 'online';
        $('settingsButton').hidden = state.mode !== 'bot';
        if (state.mode !== 'bot') closeSettings();

        const surrender = $('surrenderButton');
        if (surrender) surrender.hidden = state.mode !== 'online' || Game.over;
        const rematch = $('rematchButton');
        if (rematch) rematch.hidden = !(state.mode === 'online' && Game.over);

        const netStatus = $('netStatus');
        if (netStatus) {
            let text = '';
            if (state.mode === 'online') {
                if (state.onlineStatus === 'invited') text = t('Ждём, пока друг примет приглашение…');
                else if (state.onlineStatus === 'abandoned') text = t('Соперник вышел из игры.');
                else if (state.onlineStatus === 'rematch') text = t('Соперник предлагает реванш.');
                else if (state.awaitingEcho) text = t('Отправляем ход…');
            }
            netStatus.textContent = text;
            netStatus.hidden = !text;
        }

        $('modeIndicator').textContent = state.mode === 'bot'
            ? t('Против бота · ') + t(Bot.name())
            : state.mode === 'online'
                ? t('По сети · против ') + state.opponentName
                : t('На одном экране');
    }

    function finish(winner) {
        Game.over = true;
        Game.winner = winner;
        state.awaitingPass = false;
        $('passOverlay').hidden = true;

        let text;
        let kind;
        if (state.mode === 'online') {
            const iWon = winner === state.mySide;
            if (iWon) {
                Sound.play('win');
                text = 'Вы победили! 🎉';
                kind = 'win';
            } else if (winner) {
                Sound.play('lose');
                text = t('Победил ') + nameOf(winner) + '.';
                kind = 'lose';
            } else {
                text = 'Ничья — свободных клеток не осталось.';
                kind = 'draw';
            }
            Profile.recordResult(winner ? (iWon ? 'win' : 'loss') : 'draw');
        } else if (state.mode === 'bot') {
            if (winner === state.human) {
                Sound.play('win');
                text = 'Вы победили! 🎉';
                kind = 'win';
            } else if (winner) {
                Sound.play('lose');
                text = 'Бот победил. Попробуйте ещё раз.';
                kind = 'lose';
            } else {
                text = 'Ничья — свободных клеток не осталось.';
                kind = 'draw';
            }

            const result = Bot.recordResult(winner === state.human, !winner);
            if (result.changed) {
                text += result.direction === 'up'
                    ? t(' Сложность повышена: ') + t(result.name) + '.'
                    : t(' Сложность снижена: ') + t(result.name) + '.';
            }
            if (typeof CustomEvent === 'function') {
                document.dispatchEvent(new CustomEvent('toof:difficulty'));
            }
        } else if (winner) {
            Sound.play('win');
            text = nameOf(winner) + t(' победил! 🎉');
            kind = 'win';
        } else {
            text = 'Ничья — свободных клеток не осталось.';
            kind = 'draw';
        }

        setMessage(text, kind);
        render();
    }

    function scheduleBot() {
        if (state.mode !== 'bot' || Game.over || Game.current === state.human) return;

        clearTimeout(state.botTimer);
        setMessage('Бот думает…');
        state.botTimer = setTimeout(() => {
            const decision = Bot.decide(Game.board, Game.locked, Game.current, Game.owners);
            const move = decision && decision.place;
            if (!move) {
                if (Game.checkDraw()) finish(null);
                return;
            }

            Game.place(move[0], move[1]);
            Sound.play('place');

            let fixed = false;
            if (decision.fix) {
                for (const cell of decision.fix) Game.toggle(cell[0], cell[1]);
                fixed = Game.fix().ok;
            }
            if (fixed) Sound.play('figure');
            else Game.confirm();

            if (Game.over) {
                finish(Game.winner);
                return;
            }
            if (Game.checkDraw()) {
                finish(null);
                return;
            }
            setMessage(fixed ? 'Бот зафиксировал фигуру. Ваш ход.' : 'Ваш ход.');
            render();
        }, 300 + Math.random() * 400);
    }

    function canActNow() {
        if (Game.over || state.awaitingPass) return false;
        if (state.mode === 'online') {
            return state.onlineStatus === 'active' &&
                !state.awaitingEcho &&
                Game.current === state.mySide;
        }
        return state.mode === 'local' || Game.current === state.human;
    }

    /* Смену сложности можно применить сразу до первого хода и после конца партии. */
    function canChangeDifficulty() {
        return state.mode === 'bot' && (Game.over ||
            !Game.board.some(row => row.some(value => value !== EMPTY)));
    }

    /* На одном экране ход физически передаётся следующему игроку только после его согласия. */
    function beginPass() {
        if (state.mode !== 'local' || Game.over) return;
        state.awaitingPass = true;
        const next = nameOf(Game.current);
        $('passTitle').textContent = t('Ход: ') + next;
        $('passText').textContent = t('Передайте устройство игроку ') + next +
            t(', затем нажмите «Продолжить».');
        $('passOverlay').hidden = false;
        render();
    }

    function finishPass() {
        state.awaitingPass = false;
        $('passOverlay').hidden = true;
        render();
    }

    function cellClick(r, c) {
        if (!canActNow()) return;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return;

        if (Game.board[r][c] === EMPTY) {
            if (!Game.place(r, c)) return;
            Sound.play('place');
            setMessage('Клетка закрашена. Подтвердите ход или выделите фигуру.');
            render();
            return;
        }

        if (!Game.pending) {
            setMessage('Сначала закрасьте клетку.');
            return;
        }
        if (!Game.toggle(r, c)) {
            if (Game.selected.length >= MAX_FIGURE) {
                setMessage(t('В фигуре не больше {n} клеток.', { n: MAX_FIGURE }));
            }
            return;
        }

        Sound.play('click');
        const count = Game.selected.length;
        setMessage(count
            ? t('Выделено {n} {word}.', { n: count, word: cellWord(count) })
            : t('Выделение снято.'));
        render();
    }

    function onlineCommit() {
        if (!state.session) return;
        const move = NetProtocol.moveFromGame(Game);
        if (!move) {
            setMessage('Сначала закрасьте клетку.');
            return;
        }

        const check = state.session.validateLocal(move);
        if (!check.ok) {
            const reasons = {
                size: 'Неправильная фигура.',
                'not-a-figure': 'Неправильная фигура.',
                place: 'Эта клетка уже занята.',
                turn: 'Сейчас не ваш ход.',
                over: 'Игра уже закончена.'
            };
            Game.restore(state.session.snapshot);
            setMessage(reasons[check.reason] || 'Так ходить нельзя.');
            render();
            return;
        }

        state.awaitingEcho = true;
        setMessage('Отправляем ход…');
        render();

        state.session.commitMove(move).then(result => {
            if (!result.ok) {
                state.awaitingEcho = false;
                if (result.reason !== 'pending') {
                    setMessage('Не удалось отправить ход. Проверьте соединение.');
                }
                render();
            }
        });
    }

    function onFix() {
        if (!canActNow()) return;
        if (state.mode === 'online') {
            onlineCommit();
            return;
        }
        const result = Game.fix();
        if (!result.ok) {
            const reasons = {
                'no-move': 'Сначала закрасьте клетку.',
                size: 'Неправильная фигура.',
                'not-a-figure': 'Неправильная фигура.',
                over: 'Игра уже закончена.'
            };
            setMessage(reasons[result.reason] || 'Не получилось зафиксировать фигуру.');
            Game.clearSelection();
            render();
            return;
        }

        Sound.play('figure');
        if (result.winner) {
            finish(result.winner);
            return;
        }
        if (Game.checkDraw()) {
            finish(null);
            return;
        }

        setMessage(t('Фигура зафиксирована. Ход переходит к ') + nameOf(Game.current) + '.');
        render();
        beginPass();
        scheduleBot();
    }

    function onConfirm() {
        if (!canActNow()) return;
        if (state.mode === 'online') {
            onlineCommit();
            return;
        }
        if (!Game.confirm()) return;
        Sound.play('confirm');

        if (Game.checkDraw()) {
            finish(null);
            return;
        }
        setMessage(t('Ход передан. Ходит ') + nameOf(Game.current) + '.');
        render();
        beginPass();
        scheduleBot();
    }

    function start(mode) {
        if (state.session) {
            if (typeof Lobby !== 'undefined') Lobby.leave(state.session);
            state.session = null;
        }
        state.mode = mode;
        state.human = 'X';
        state.awaitingPass = false;
        state.awaitingEcho = false;
        state.onlineStatus = 'active';
        state.finished = false;
        state.lastPly = 0;
        state.opponentName = '';
        state.mySide = 'X';
        state.resumable = false;
        clearTimeout(state.botTimer);
        Game.reset();
        setMessage(mode === 'bot' ? 'Вы ходите первым (оранжевым).' : 'Первым ходит оранжевый — Игрок 1.');
        $('passOverlay').hidden = true;
        $('difficultyConfirm').hidden = true;
        showScreen('gameScreen');
        render();
    }

    function startOnline(session) {
        if (state.session && state.session !== session) state.session.destroy();
        state.mode = 'online';
        state.session = session;
        state.mySide = session.mySide || 'X';
        state.opponentName = session.opponentName || t('Соперник');
        state.awaitingPass = false;
        state.awaitingEcho = false;
        state.onlineStatus = session.status || 'connecting';
        state.finished = false;
        state.lastPly = session.appliedPly || 0;
        state.resumable = false;
        clearTimeout(state.botTimer);
        Game.restore(session.snapshot);
        $('passOverlay').hidden = true;
        $('difficultyConfirm').hidden = true;
        showScreen('gameScreen');
        setMessage(state.onlineStatus === 'invited'
            ? 'Приглашение отправлено. Ждём друга…'
            : t('Вы играете ') + t(state.mySide === 'X' ? 'оранжевым' : 'фиолетовым') + '.');
        render();
    }

    function onlineUpdate(session, data) {
        if (state.mode !== 'online' || state.session !== session) return;

        const previousPly = state.lastPly;
        const boardChanged = (data.appliedPly || 0) !== previousPly;
        /* Не стираем незавершённый выбор игрока из-за служебного
           обновления документа партии (статус, presence и т. п.). */
        const busy = !!Game.pending || state.awaitingEcho;
        if (boardChanged || !busy) Game.restore(data.snapshot);
        state.mySide = data.mySide || state.mySide;
        state.opponentName = data.opponentName || state.opponentName;
        state.awaitingEcho = !!data.awaitingEcho;
        state.onlineStatus = data.status || state.onlineStatus;
        state.lastPly = data.appliedPly || 0;

        const fresh = (data.moves || []).slice(previousPly);
        for (const move of fresh) {
            if (move.side !== state.mySide) {
                Sound.play(move.fix ? 'figure' : 'place');
            }
        }

        if (state.onlineStatus === 'invited') {
            setMessage('Приглашение отправлено. Ждём друга…');
        } else if (state.onlineStatus === 'abandoned') {
            setMessage('Соперник вышел из игры.', 'lose');
        } else if (state.onlineStatus === 'rematch') {
            setMessage('Соперник предлагает реванш.');
        }

        render();

        if (data.snapshot && data.snapshot.over && !state.finished) {
            state.finished = true;
            finish(data.winner || null);
        }
    }

    function onlineError(error) {
        const text = error && error.message ? t(error.message) : t('Не удалось связаться с соперником.');
        setMessage(t('Сеть: ') + text, 'lose');
        render();
    }

    function showInvite(invite) {
        if (!invite || !invite.id) return;
        state.pendingInvite = invite;
        const box = $('inviteToast');
        const text = $('inviteText');
        if (!box || !text) return;

        const otherUid = (invite.players || []).find(uid => uid !== Profile.state.uid);
        const name = (invite.names && invite.names[otherUid]) || t('Друг');
        text.textContent = name + t(' приглашает в игру');
        box.hidden = false;
    }

    function hideInvite() {
        state.pendingInvite = null;
        const box = $('inviteToast');
        if (box) box.hidden = true;
    }

    function updateInviteBadge(count) {
        const badge = $('onlineBadge');
        if (!badge) return;
        badge.textContent = String(count);
        badge.hidden = !count;
    }

    function hasOnlineSession() {
        return !!state.session;
    }

    function resumeOnline() {
        if (!state.session) return;
        showScreen('gameScreen');
        render();
    }

    function init() {
        $('boardGrid').addEventListener('click', event => {
            const cell = event.target.closest('.cell');
            if (!cell) return;
            cellClick(Number(cell.dataset.r), Number(cell.dataset.c));
        });
        $('fixFigureBtn').addEventListener('click', onFix);
        $('confirmMoveBtn').addEventListener('click', onConfirm);
        $('passButton').addEventListener('click', () => {
            Sound.play('click');
            finishPass();
        });
        $('resetButton').addEventListener('click', () => {
            Sound.play('click');
            start(state.mode);
        });
        $('menuButton').addEventListener('click', () => {
            Sound.play('click');
            showScreen('menuScreen');
        });
        $('settingsButton').addEventListener('click', () => {
            Sound.play('click');
            const popover = $('settingsPopover');
            popover.hidden = !popover.hidden;
            $('settingsButton').setAttribute('aria-expanded', String(!popover.hidden));
        });
        $('settingsClose').addEventListener('click', () => {
            Sound.play('click');
            closeSettings();
        });

        const surrender = $('surrenderButton');
        if (surrender) surrender.addEventListener('click', () => {
            Sound.play('click');
            if (!state.session || typeof Lobby === 'undefined') return;
            const session = state.session;
            Lobby.leave(session).then(() => {
                session.destroy();
                if (state.session === session) state.session = null;
                state.resumable = false;
                showScreen('menuScreen');
            }).catch(onlineError);
        });

        const rematch = $('rematchButton');
        if (rematch) rematch.addEventListener('click', () => {
            Sound.play('click');
            if (state.session && typeof Lobby !== 'undefined') Lobby.rematch(state.session).catch(onlineError);
        });

        const inviteAccept = $('inviteAccept');
        if (inviteAccept) inviteAccept.addEventListener('click', () => {
            Sound.play('click');
            const invite = state.pendingInvite;
            hideInvite();
            if (!invite || typeof Lobby === 'undefined') return;
            const accept = () => Lobby.acceptInvite(invite).catch(onlineError);
            if (state.session) Lobby.leave(state.session).then(accept).catch(onlineError);
            else accept();
        });

        const inviteDecline = $('inviteDecline');
        if (inviteDecline) inviteDecline.addEventListener('click', () => {
            Sound.play('click');
            const invite = state.pendingInvite;
            hideInvite();
            if (invite && typeof Lobby !== 'undefined') Lobby.declineInvite(invite).catch(onlineError);
        });

        const resume = $('resumeGameBtn');
        if (resume) resume.addEventListener('click', () => {
            Sound.play('click');
            resumeOnline();
        });
    }

    /* Перевод уже наложен I18N: перерисовываем динамические подписи на месте. */
    function refreshLanguage() {
        setMessage(state.message, state.messageKind);
        render();
    }

    return {
        init,
        start,
        startOnline,
        onlineUpdate,
        onlineError,
        showInvite,
        hideInvite,
        updateInviteBadge,
        hasOnlineSession,
        resumeOnline,
        showScreen,
        cellClick,
        onFix,
        onConfirm,
        render,
        refreshLanguage,
        canChangeDifficulty,
        state
    };
})();
