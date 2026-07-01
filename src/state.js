import * as THREE from 'three';

export const config = {
    speed: 0.005,
    glyphSize: 1.0,
    glyphDensity: 5,
    tubeRadius: 0.5,
    organOpacity: 0.5,
    isPaused: false,
    glyphStyle: 'cone',
    streamlineStyle: 'tube',
    colormap: 'coolwarm',
    scaleRadiusByScalar: true,
    streamlineScalar: '',
    organScalar: '',
    clipX: 100,
    clipY: 100,
    clipZ: 100,
    clipXEnabled: false,
    clipYEnabled: false,
    clipZEnabled: false,
    exportBg: 'black',
    exportHideHelpers: true
};

export const state = {
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    
    organGroup: null,
    streamlinesGroup: null,
    animatedGlyphsGroup: null,
    smokeGroup: null,
    
    axesHelper: null,
    gridHelper: null,
    statusElement: null,
    
    organPolyData: null,
    streamlinesPolyData: null,
    pathCurves: [], // Array of THREE.Curve
    pathCurvesScalars: [], // Array of arrays of scalar values
    minStreamlineScalar: 0,
    maxStreamlineScalar: 1,
    
    instancedGlyphs: null,
    glyphOffsets: [], // Current t value (0-1) for each instance
    smokeParticles: null, // THREE.Points for smoke
    smokeTexture: null,
    
    activeClippingPlanes: [],
    clipPlanes: {
        x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 100000),
        y: new THREE.Plane(new THREE.Vector3(0, -1, 0), 100000),
        z: new THREE.Plane(new THREE.Vector3(0, 0, -1), 100000)
    }
};

export const colormaps = {
    viridis: [
        { r: 0.267, g: 0.005, b: 0.329 },
        { r: 0.230, g: 0.322, b: 0.546 },
        { r: 0.128, g: 0.563, b: 0.551 },
        { r: 0.369, g: 0.789, b: 0.383 },
        { r: 0.993, g: 0.906, b: 0.144 }
    ],
    coolwarm: [
        { r: 0.230, g: 0.299, b: 0.754 }, // scientific blue
        { r: 0.548, g: 0.648, b: 0.906 }, // light blue-gray
        { r: 0.865, g: 0.865, b: 0.865 }, // neutral white-gray
        { r: 0.906, g: 0.648, b: 0.548 }, // light red-gray
        { r: 0.706, g: 0.016, b: 0.150 }  // scientific red
    ],
    jet: [
        { r: 0.0, g: 0.0, b: 0.5 },
        { r: 0.0, g: 0.0, b: 1.0 },
        { r: 0.0, g: 0.5, b: 1.0 },
        { r: 0.0, g: 1.0, b: 1.0 },
        { r: 0.5, g: 1.0, b: 0.5 },
        { r: 1.0, g: 1.0, b: 0.0 },
        { r: 1.0, g: 0.5, b: 0.0 },
        { r: 1.0, g: 0.0, b: 0.0 },
        { r: 0.5, g: 0.0, b: 0.0 }
    ],
    hot: [
        { r: 0.0, g: 0.0, b: 0.0 },
        { r: 1.0, g: 0.0, b: 0.0 },
        { r: 1.0, g: 1.0, b: 0.0 },
        { r: 1.0, g: 1.0, b: 1.0 }
    ],
    grayscale: [
        { r: 0.1, g: 0.1, b: 0.1 },
        { r: 0.9, g: 0.9, b: 0.9 }
    ]
};

export function getColorFromLUT(value, colormapName) {
    const points = colormaps[colormapName] || colormaps.coolwarm;
    const t = Math.max(0, Math.min(1, value));
    const rawIdx = t * (points.length - 1);
    const idx0 = Math.floor(rawIdx);
    const idx1 = Math.min(idx0 + 1, points.length - 1);
    const weight = rawIdx - idx0;
    
    const p0 = points[idx0];
    const p1 = points[idx1];
    
    return new THREE.Color(
        p0.r * (1 - weight) + p1.r * weight,
        p0.g * (1 - weight) + p1.g * weight,
        p0.b * (1 - weight) + p1.b * weight
    );
}

export function updateStatus(msg, type = 'idle') {
    if (state.statusElement) {
        state.statusElement.textContent = msg;
        state.statusElement.className = `status-${type}`;
    }
}
