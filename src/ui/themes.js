import * as THREE from 'three';
import { state } from '../state.js';

export function initThemes() {
    const btnToggleDark = document.getElementById('btn-toggle-dark');
    const btnToggleHC = document.getElementById('btn-toggle-high-contrast');
    
    // Default theme is dark
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        if (btnToggleDark) btnToggleDark.innerHTML = '<span class="material-symbols-outlined">light_mode</span>';
    } else {
        document.body.classList.remove('light-theme');
        if (btnToggleDark) btnToggleDark.innerHTML = '<span class="material-symbols-outlined">dark_mode</span>';
    }
    
    const savedHC = localStorage.getItem('high-contrast') === 'true';
    if (savedHC) {
        document.body.classList.add('high-contrast');
    }
    
    if (btnToggleDark) {
        btnToggleDark.addEventListener('click', () => {
            const isLight = document.body.classList.toggle('light-theme');
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
            btnToggleDark.innerHTML = `<span class="material-symbols-outlined">${isLight ? 'light_mode' : 'dark_mode'}</span>`;
            updateSceneBackground();
        });
    }
    
    if (btnToggleHC) {
        btnToggleHC.addEventListener('click', () => {
            const isHC = document.body.classList.toggle('high-contrast');
            localStorage.setItem('high-contrast', isHC ? 'true' : 'false');
            updateSceneBackground();
        });
    }
    
    // Initial scene background configuration
    setTimeout(updateSceneBackground, 50);
}

export function updateSceneBackground() {
    if (!state.scene) return;
    let colorHex = 0x0f0f12; // dark default
    
    if (document.body.classList.contains('high-contrast')) {
        colorHex = 0x000000;
    } else if (document.body.classList.contains('light-theme')) {
        colorHex = 0xf3f4f7;
    }
    
    state.scene.background = new THREE.Color(colorHex);
}

export function setupTooltipSystem() {
    // Check if tooltip already exists to prevent duplicates
    let tooltipEl = document.querySelector('.custom-tooltip');
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'custom-tooltip';
        document.body.appendChild(tooltipEl);
    }
    
    const elements = document.querySelectorAll('[data-tooltip]');
    elements.forEach(el => {
        el.addEventListener('mouseenter', () => {
            const html = el.getAttribute('data-tooltip');
            if (!html) return;
            tooltipEl.innerHTML = html;
            tooltipEl.classList.add('visible');
            
            const rect = el.getBoundingClientRect();
            let top = rect.top - tooltipEl.offsetHeight - 8;
            if (top < 0) {
                top = rect.bottom + 8;
            }
            let left = rect.left + rect.width / 2 - tooltipEl.offsetWidth / 2;
            if (left < 0) left = 8;
            if (left + tooltipEl.offsetWidth > window.innerWidth) {
                left = window.innerWidth - tooltipEl.offsetWidth - 8;
            }
            
            tooltipEl.style.left = `${left}px`;
            tooltipEl.style.top = `${top}px`;
        });
        
        el.addEventListener('mouseleave', () => {
            tooltipEl.classList.remove('visible');
        });
    });
}
