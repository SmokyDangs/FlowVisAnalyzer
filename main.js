import { initViewer, startAnimationLoop } from './src/engine/viewer.js';
import { setupUI } from './src/ui/controls.js';
import { initThemes, setupTooltipSystem } from './src/ui/themes.js';

function init() {
    initViewer();
    initThemes();
    setupUI();
    setupTooltipSystem();
    startAnimationLoop();
}

init();
