'use strict';

/* ============================================================
   Звуки: реальные файлы из папки Sounds/ с синтетическим фолбэком.
   ============================================================ */

const Sound = (() => {
    const STORAGE_KEY = 'toof_sound';
    let ctx = null;
    let enabled = true;

    try {
        enabled = localStorage.getItem(STORAGE_KEY) !== '0';
    } catch (e) {
        enabled = true;
    }

    /* Файлы, которые уже есть в проекте. Остальные звуки пока синтезируются. */
    const FILES = {
        click: 'Sounds/click.mp3',
        place: 'Sounds/place.mp3'
    };

    /* Несколько экземпляров на звук — чтобы быстрые клики не обрывали друг друга. */
    const pools = {};
    const cursors = {};

    if (typeof Audio !== 'undefined') {
        Object.keys(FILES).forEach(name => {
            pools[name] = [];
            cursors[name] = 0;
            for (let i = 0; i < 3; i++) {
                const audio = new Audio(FILES[name]);
                audio.preload = 'auto';
                audio.volume = 0.8;
                try { audio.load(); } catch (e) { /* файл недоступен */ }
                pools[name].push(audio);
            }
        });
    }

    function playFile(name) {
        const pool = pools[name];
        if (!pool || !pool.length) return false;
        const audio = pool[cursors[name] = (cursors[name] + 1) % pool.length];
        try {
            audio.currentTime = 0;
            const result = audio.play();
            if (result && typeof result.catch === 'function') result.catch(() => {});
            return true;
        } catch (e) {
            return false;
        }
    }

    function audio() {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        if (!ctx) ctx = new Ctor();
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function tone(freq, duration, type, delay, volume) {
        if (!enabled) return;
        const c = audio();
        if (!c) return;

        const start = c.currentTime + (delay || 0);
        const osc = c.createOscillator();
        const gain = c.createGain();

        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(volume || 0.18, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

        osc.connect(gain).connect(c.destination);
        osc.start(start);
        osc.stop(start + duration);
    }

    /* [частота, длительность, форма, задержка, громкость] */
    const BANKS = {
        click: [[200, 0.04, 'square', 0, 0.05]],
        place: [[320, 0.1, 'sine', 0, 0.18]],
        confirm: [[620, 0.08, 'square', 0, 0.09], [840, 0.08, 'square', 0.06, 0.09]],
        figure: [[523, 0.18, 'sine', 0, 0.16], [659, 0.18, 'sine', 0.08, 0.16], [784, 0.2, 'sine', 0.16, 0.16], [1047, 0.3, 'sine', 0.24, 0.18]],
        win: [[523, 0.18, 'sine', 0, 0.18], [659, 0.18, 'sine', 0.14, 0.18], [784, 0.2, 'sine', 0.28, 0.18], [1047, 0.42, 'sine', 0.42, 0.2]],
        lose: [[400, 0.24, 'sawtooth', 0, 0.1], [330, 0.24, 'sawtooth', 0.18, 0.1], [260, 0.32, 'sawtooth', 0.36, 0.1], [180, 0.5, 'sawtooth', 0.54, 0.1]]
    };

    function play(name) {
        if (!enabled) return;
        if (FILES[name] && playFile(name)) return;
        const bank = BANKS[name];
        if (!bank) return;
        for (const args of bank) tone.apply(null, args);
    }

    function toggle() {
        enabled = !enabled;
        try {
            localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
        } catch (e) { /* приватный режим — просто не сохраняем */ }
        return enabled;
    }

    return { play, toggle, isOn: () => enabled };
})();
