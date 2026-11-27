'use strict';

/* Предпочтительный цвет клеток игрока. Переключатель живёт в ряду
   языка и звука; выбор хранится локально, как и эти настройки. */

const Colors = (() => {
    const STORAGE_KEY = 'toof_color';
    let preferred = 'orange';

    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'orange' || saved === 'purple') preferred = saved;
    } catch (e) { /* localStorage недоступен */ }

    function preferredColor() { return preferred; }

    /* По умолчанию X оранжевый, O фиолетовый. Палитра меняется местами,
       только если цвет текущей стороны игрока не совпадает с его выбором. */
    function shouldSwap(side) {
        return side === 'X' ? preferred === 'purple' : preferred === 'orange';
    }

    function applyFor(side) {
        document.documentElement.classList.toggle('prefer-purple', shouldSwap(side));
    }

    function refreshButton() {
        const button = document.getElementById('colorToggle');
        if (!button) return;
        button.textContent = preferred === 'orange' ? '🟠' : '🟣';
        const title = t('Цвет игрока') + ': ' +
            t(preferred === 'orange' ? 'оранжевый' : 'фиолетовый');
        button.title = title;
        button.setAttribute('aria-label', title);
    }

    function toggle() {
        preferred = preferred === 'orange' ? 'purple' : 'orange';
        try { localStorage.setItem(STORAGE_KEY, preferred); } catch (e) { /* ignore */ }
        refreshButton();
        if (typeof CustomEvent === 'function') {
            document.dispatchEvent(new CustomEvent('toof:color'));
        }
        return preferred;
    }

    function init() {
        refreshButton();
        const button = document.getElementById('colorToggle');
        if (button) {
            button.addEventListener('click', () => {
                if (typeof Sound !== 'undefined' && Sound.play) Sound.play('click');
                toggle();
            });
        }
    }

    return { preferredColor, shouldSwap, applyFor, refreshButton, toggle, init };
})();
