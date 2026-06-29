import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import vtkXMLPolyDataReader from 'vtkXMLPolyDataReader';

// --- CONFIGURATION ---
const config = {
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

// --- SCIENTIFIC COLORMAPS ---
const colormaps = {
    viridis: [
        { r: 0.267, g: 0.005, b: 0.329 },
        { r: 0.230, g: 0.322, b: 0.546 },
        { r: 0.128, g: 0.563, b: 0.551 },
        { r: 0.369, g: 0.789, b: 0.383 },
        { r: 0.993, g: 0.906, b: 0.144 }
    ],
    coolwarm: [
        { r: 0.230, g: 0.299, b: 0.754 },
        { r: 0.865, g: 0.865, b: 0.865 },
        { r: 0.706, g: 0.016, b: 0.150 }
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

function getColorFromLUT(value, colormapName) {
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

function getArrayMagnitude(array) {
    if (!array) return null;
    const data = array.getData();
    const numComponents = array.getNumberOfComponents ? array.getNumberOfComponents() : 1;
    if (numComponents <= 1) return data;
    
    const magData = new Float32Array(data.length / numComponents);
    for (let i = 0; i < magData.length; i++) {
        let sumSq = 0;
        for (let c = 0; c < numComponents; c++) {
            sumSq += data[i * numComponents + c] * data[i * numComponents + c];
        }
        magData[i] = Math.sqrt(sumSq);
    }
    return magData;
}

// --- UTILS ---
function createSmokeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.6)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
}

// --- ENGINE LAYER ---
let scene, camera, renderer, controls;
let organGroup, streamlinesGroup, animatedGlyphsGroup, smokeGroup, modelGroup;
let axesHelper, gridHelper;
let statusElement;

// Animation & Data State
let organPolyData = null;
let streamlinesPolyData = null;
let pathCurves = []; // Array of THREE.Curve
let pathCurvesScalars = []; // Array of arrays of scalar values mapped to pathCurves
let minStreamlineScalar = 0;
let maxStreamlineScalar = 1;

let instancedGlyphs = null;
let glyphOffsets = []; // Current t value (0-1) for each instance
let smokeParticles = null; // THREE.Points for smoke
let smokeTexture = null;

// Clipping State
let activeClippingPlanes = [];
const clipPlanes = {
    x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 100000),
    y: new THREE.Plane(new THREE.Vector3(0, -1, 0), 100000),
    z: new THREE.Plane(new THREE.Vector3(0, 0, -1), 100000)
};

function init() {
    statusElement = document.getElementById('status-message');
    smokeTexture = createSmokeTexture();

    // 1. Scene & Camera
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f0f12); // darker background matching stylesheet

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50000);
    camera.position.set(150, 100, 150);

    // 2. Renderer - try multiple WebGL options with fallback
    let rendererCreated = false;
    const rendererOptionsList = [
        { antialias: true,  preserveDrawingBuffer: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false },
        { antialias: false, preserveDrawingBuffer: true, powerPreference: 'low-power',        failIfMajorPerformanceCaveat: false },
        { antialias: false, preserveDrawingBuffer: true, powerPreference: 'default',           failIfMajorPerformanceCaveat: false },
    ];
    for (const opts of rendererOptionsList) {
        if (rendererCreated) break;
        try {
            renderer = new THREE.WebGLRenderer(opts);
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.localClippingEnabled = true;
            document.getElementById('container').appendChild(renderer.domElement);
            rendererCreated = true;
        } catch (err) {
            console.warn('WebGL attempt failed:', err.message);
            renderer = null;
        }
    }
    if (!rendererCreated) { showWebGLError(); }

    // 3. Orbit Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // 4. Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(1, 1, 1).normalize();
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x4facfe, 0.4);
    dirLight2.position.set(-1, -1, -1).normalize();
    scene.add(dirLight2);

    // 5. Layer Groups
    organGroup = new THREE.Group();
    streamlinesGroup = new THREE.Group();
    animatedGlyphsGroup = new THREE.Group();
    smokeGroup = new THREE.Group();
    modelGroup = new THREE.Group();
    modelGroup.add(organGroup, streamlinesGroup, animatedGlyphsGroup, smokeGroup);
    scene.add(modelGroup);

    // 6. Helpers
    axesHelper = new THREE.AxesHelper(60);
    gridHelper = new THREE.GridHelper(300, 30, 0x444444, 0x222222);
    gridHelper.position.y = -50;
    scene.add(axesHelper, gridHelper);

    window.addEventListener('resize', onWindowResize);

    initThemes();
    setupTabs();
    setupUI();
    setupTooltipSystem();
    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- TABS CONTROL ---
function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from buttons
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            // Add active to clicked
            tab.classList.add('active');
            
            // Hide all tab content
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            // Show selected tab content
            const target = tab.getAttribute('data-tab');
            document.getElementById(target).classList.add('active');
        });
    });
}

// --- MOCK VTK DATA LAYER (DEMO MODE) ---
class MockPolyData {
    constructor(points, lines, polys, scalarsMap, normals = null) {
        this.points = { getData: () => new Float32Array(points) };
        this.lines = lines ? { getData: () => new Int32Array(lines), getNumberOfCells: () => lines[0] ? 1 : 0 } : null;
        this.polys = polys ? { getData: () => new Int32Array(polys), getNumberOfCells: () => polys[0] ? 1 : 0 } : null;
        this.strips = null;
        this.verts = null;
        
        const arrays = Object.keys(scalarsMap).map(name => ({
            getName: () => name,
            getData: () => new Float32Array(scalarsMap[name])
        }));
        
        this.pointData = {
            getNormals: () => normals ? { getData: () => new Float32Array(normals) } : null,
            getScalars: () => arrays[0] || null,
            getArrays: () => arrays,
            getArray: (name) => arrays.find(a => a.getName() === name) || null
        };
    }
    getPoints() { return this.points; }
    getPolys() { return this.polys; }
    getStrips() { return this.strips; }
    getVerts() { return this.verts; }
    getLines() { return this.lines; }
    getPointData() { return this.pointData; }
}

function generateDemoScenario() {
    updateStatus("Generating medical stenosis flow demo...", "loading");
    
    // Geometry Parameters
    const ny = 80;  // length divisions
    const nt = 24;  // circle divisions
    const length = 160;
    const rNormal = 16;
    
    // --- 1. Generate Organ Mesh (Stenosed Cylinder) ---
    const organPoints = [];
    const organPolys = [];
    const organVelocity = [];
    const organPressure = [];
    
    for (let iy = 0; iy <= ny; iy++) {
        const y = -length/2 + (iy / ny) * length;
        
        // Constriction (stenosis) profile
        // Radius reduces up to 65% in the center (y=0)
        const stenosisConstriction = 0.65;
        const stenosisWidth = 18;
        const radRatio = 1 - stenosisConstriction * Math.exp(-(y * y) / (2 * stenosisWidth * stenosisWidth));
        const radius = rNormal * radRatio;
        
        // Physical calculations
        // V = V0 * (A0/A) => proportional to 1 / radius^2
        const vMag = 3 * Math.pow(rNormal / radius, 2);
        // Bernoulli Pressure: P = P0 - 0.5 * rho * (V^2 - V0^2)
        const pressure = 110 - 0.5 * (vMag * vMag - 9) * 0.8;
        
        for (let it = 0; it < nt; it++) {
            const theta = (it / nt) * Math.PI * 2;
            const x = radius * Math.cos(theta);
            const z = radius * Math.sin(theta);
            
            organPoints.push(x, y, z);
            organVelocity.push(vMag);
            organPressure.push(pressure);
        }
    }
    
    // Polys indices
    for (let iy = 0; iy < ny; iy++) {
        for (let it = 0; it < nt; it++) {
            const nextY = iy + 1;
            const nextT = (it + 1) % nt;
            
            const p0 = iy * nt + it;
            const p1 = iy * nt + nextT;
            const p2 = nextY * nt + it;
            const p3 = nextY * nt + nextT;
            
            // Triangle 1
            organPolys.push(3, p0, p1, p3);
            // Triangle 2
            organPolys.push(3, p0, p3, p2);
        }
    }
    
    organPolyData = new MockPolyData(
        organPoints,
        null,
        organPolys,
        { "Velocity Magnitude": organVelocity, "Hydrostatic Pressure": organPressure }
    );
    
    // --- 2. Generate Streamlines (Swirling Flow lines) ---
    const M = 22; // number of streamlines
    const ptsPerLine = 120;
    const streamlinePoints = [];
    const streamlineLines = [];
    const streamlineVelocity = [];
    const streamlinePressure = [];
    
    let currentPointIdx = 0;
    
    for (let m = 0; m < M; m++) {
        // Distribute starting points in a circle at y = -length/2
        const rStart = Math.sqrt(Math.random()) * (rNormal - 2.5);
        const thetaStart = Math.random() * Math.PI * 2;
        
        streamlineLines.push(ptsPerLine); // VTK format: number of points in line
        
        for (let n = 0; n < ptsPerLine; n++) {
            const t = n / (ptsPerLine - 1);
            const y = -length/2 + t * length;
            
            // Stenosis radius ratio
            const radRatio = 1 - 0.65 * Math.exp(-(y * y) / (2 * 18 * 18));
            
            // swirl angle (vorticity downstream of stenosis y > -10)
            let twist = 0;
            if (y > -15) {
                // swirling starts post stenosis, peaks, and decays
                twist = 0.04 * (y + 15) * Math.exp(-(y - 15) / 50);
            }
            
            // Helical coordinates
            const theta = thetaStart + twist * (1.2 - rStart / rNormal); // inner streams rotate slightly faster
            const x = rStart * radRatio * Math.cos(theta);
            const z = rStart * radRatio * Math.sin(theta);
            
            streamlinePoints.push(x, y, z);
            streamlineLines.push(currentPointIdx);
            
            // Physical data
            // Velocity magnitude (accelerates inside the constriction)
            const vMag = (2.8 + (rNormal - rStart) * 0.15) / (radRatio * radRatio);
            // Pressure drop in throat
            const pressure = 110 - 0.5 * (vMag * vMag - 8) * 0.8;
            
            streamlineVelocity.push(vMag);
            streamlinePressure.push(pressure);
            
            currentPointIdx++;
        }
    }
    
    streamlinesPolyData = new MockPolyData(
        streamlinePoints,
        streamlineLines,
        null,
        { "Velocity Magnitude": streamlineVelocity, "Hydrostatic Pressure": streamlinePressure }
    );
    
    // Clean and rebuild scene
    organGroup.clear();
    streamlinesGroup.clear();
    animatedGlyphsGroup.clear();
    smokeGroup.clear();
    
    // Load geometries
    config.organScalar = "Velocity Magnitude";
    config.streamlineScalar = "Velocity Magnitude";
    
    // Build Organ Mesh
    const organGeom = vtkToThreeGeometry(organPolyData, config.organScalar);
    const organMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: config.organOpacity,
        side: THREE.DoubleSide,
        roughness: 0.4,
        metalness: 0.1,
        vertexColors: true
    });
    organMat.clippingPlanes = activeClippingPlanes;
    organGroup.add(new THREE.Mesh(organGeom, organMat));
    
    // Process streamlines
    processStreamlines(streamlinesPolyData);
    
    // Center the model in the coordinate system
    centerModel();
    
    // Fit camera
    fitCameraToData(organGroup);
    
    // Update dashboard elements
    populateScalarDropdowns();
    updateColorbar();
    
    // Initialize clipping sliders based on loaded bounds
    const box = new THREE.Box3().setFromObject(organGroup);
    updateClippingSliders(box);
    
    updateStatus("Stenosis demo loaded. Try switching fields, clipping or colormaps!", "success");
}

function centerModel() {
    if (!modelGroup) return;
    
    // 1. Reset translation
    modelGroup.position.set(0, 0, 0);
    modelGroup.updateMatrixWorld(true);
    
    // 2. Compute combined bounding box of the active geometries
    const box = new THREE.Box3();
    let hasOrgan = false;
    organGroup.traverse(child => {
        if (child.isMesh || child.isPoints) {
            hasOrgan = true;
        }
    });
    
    let hasStreamlines = false;
    streamlinesGroup.traverse(child => {
        if (child.isMesh || child.isPoints) {
            hasStreamlines = true;
        }
    });
    
    if (hasOrgan && hasStreamlines) {
        box.setFromObject(organGroup);
        const boxStreamlines = new THREE.Box3().setFromObject(streamlinesGroup);
        box.union(boxStreamlines);
    } else if (hasOrgan) {
        box.setFromObject(organGroup);
    } else if (hasStreamlines) {
        box.setFromObject(streamlinesGroup);
    } else {
        return;
    }
    
    if (box.isEmpty()) return;
    
    // 3. Get center of the bounding box
    const center = box.getCenter(new THREE.Vector3());
    
    // 4. Translate modelGroup so its center is at (0, 0, 0)
    modelGroup.position.copy(center).multiplyScalar(-1);
    modelGroup.updateMatrixWorld(true);
    
    // 5. Adjust gridHelper position y to be just below the model's floor (bottom of bounding box)
    const centeredMinY = box.min.y - center.y;
    if (gridHelper) {
        gridHelper.position.y = centeredMinY - 2;
    }
}

// --- DATA PROCESSING LAYER ---
function vtkToThreeGeometry(polydata, activeScalarName) {
    const geometry = new THREE.BufferGeometry();
    const points = polydata.getPoints().getData();
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));

    const polys = polydata.getPolys();
    const strips = polydata.getStrips();
    const verts = polydata.getVerts();
    
    let vtkCells = null;
    if (polys && polys.getNumberOfCells() > 0) vtkCells = polys.getData();
    else if (strips && strips.getNumberOfCells() > 0) vtkCells = strips.getData();
    else if (verts && verts.getNumberOfCells() > 0) vtkCells = verts.getData();

    if (vtkCells && vtkCells.length > 0) {
        const indices = [];
        let i = 0;
        const isStrips = strips && vtkCells === strips.getData();
        while (i < vtkCells.length) {
            const numPointsInCell = vtkCells[i];
            i++;
            if (isStrips) {
                for (let j = 0; j < numPointsInCell - 2; j++) {
                    if (j % 2 === 0) indices.push(vtkCells[i + j], vtkCells[i + j + 1], vtkCells[i + j + 2]);
                    else indices.push(vtkCells[i + j + 1], vtkCells[i + j], vtkCells[i + j + 2]);
                }
            } else {
                for (let j = 0; j < numPointsInCell; j++) indices.push(vtkCells[i + j]);
            }
            i += numPointsInCell;
        }
        geometry.setIndex(indices);
    }
    
    const normals = polydata.getPointData().getNormals();
    if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals.getData(), 3));
    else geometry.computeVertexNormals();

    // Set colors from selected scalar array
    const scalars = getGeometryScalars(polydata, activeScalarName);
    if (scalars) {
        const scalarData = getArrayMagnitude(scalars);
        const colors = new Float32Array(scalarData.length * 3);
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < scalarData.length; i++) {
            if (scalarData[i] < min) min = scalarData[i];
            if (scalarData[i] > max) max = scalarData[i];
        }
        const range = max - min || 1;
        for (let i = 0; i < scalarData.length; i++) {
            const ratio = (scalarData[i] - min) / range;
            const color = getColorFromLUT(ratio, config.colormap);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    return geometry;
}

function getGeometryScalars(polydata, activeScalarName) {
    if (!polydata) return null;
    const pointData = polydata.getPointData();
    if (!pointData) return null;
    
    let array = null;
    if (activeScalarName) {
        array = pointData.getArray(activeScalarName);
    }
    if (!array) {
        array = pointData.getScalars();
    }
    return array;
}

function recolorOrganMesh() {
    if (organGroup.children.length === 0 || !organPolyData) return;
    const mesh = organGroup.children[0];
    if (!mesh || !mesh.geometry) return;
    
    const geom = mesh.geometry;
    const scalars = getGeometryScalars(organPolyData, config.organScalar);
    
    if (scalars) {
        const scalarData = getArrayMagnitude(scalars);
        const colors = new Float32Array(scalarData.length * 3);
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < scalarData.length; i++) {
            if (scalarData[i] < min) min = scalarData[i];
            if (scalarData[i] > max) max = scalarData[i];
        }
        const range = max - min || 1;
        for (let i = 0; i < scalarData.length; i++) {
            const ratio = (scalarData[i] - min) / range;
            const color = getColorFromLUT(ratio, config.colormap);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        mesh.material.vertexColors = true;
        mesh.material.color.setRGB(1, 1, 1);
    } else {
        geom.removeAttribute('color');
        mesh.material.vertexColors = false;
        mesh.material.color.setHex(0xcccccc);
    }
    mesh.material.needsUpdate = true;
    updateColorbar();
}

function processStreamlines(polydata) {
    streamlinesPolyData = polydata;
    regenerateStreamlines();
    initAnimatedGlyphs();
}

// --- DYNAMIC GEOMETRY GENERATORS ---
function createVaryingTubeGeometry(curve, scalarData, minRadius, maxRadius, minScalar, maxScalar, colormapFn, scaleRadius) {
    const segments = Math.max(30, Math.floor(curve.getLength() / 1.5));
    const radialSegments = 8;
    const geometry = new THREE.BufferGeometry();
    
    const vertices = [];
    const colors = [];
    const normals = [];
    const indices = [];
    
    const frames = curve.computeFrenetFrames(segments, false);
    
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const pos = curve.getPointAt(t);
        const tangent = frames.tangents[i];
        const normal = frames.normals[i];
        const binormal = frames.binormals[i];
        
        // Interpolate scalar
        const rawIdx = t * (scalarData.length - 1);
        const idx0 = Math.floor(rawIdx);
        const idx1 = Math.min(idx0 + 1, scalarData.length - 1);
        const weight = rawIdx - idx0;
        const scalarVal = scalarData[idx0] * (1 - weight) + scalarData[idx1] * weight;
        
        const range = maxScalar - minScalar || 1;
        const ratio = Math.max(0, Math.min(1, (scalarVal - minScalar) / range));
        
        // Scale radius
        const radius = scaleRadius ? (minRadius + ratio * (maxRadius - minRadius)) : config.tubeRadius;
        
        // Color mapping
        const color = colormapFn(ratio);
        
        for (let j = 0; j <= radialSegments; j++) {
            const theta = (j / radialSegments) * Math.PI * 2;
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            
            const vNormal = new THREE.Vector3()
                .copy(normal).multiplyScalar(cos)
                .addScaledVector(binormal, sin)
                .normalize();
                
            const vPos = new THREE.Vector3()
                .copy(pos)
                .addScaledVector(vNormal, radius);
                
            vertices.push(vPos.x, vPos.y, vPos.z);
            normals.push(vNormal.x, vNormal.y, vNormal.z);
            colors.push(color.r, color.g, color.b);
        }
    }
    
    for (let i = 0; i < segments; i++) {
        for (let j = 0; j < radialSegments; j++) {
            const nextI = i + 1;
            const nextJ = j + 1;
            
            const a = i * (radialSegments + 1) + j;
            const b = nextI * (radialSegments + 1) + j;
            const c = nextI * (radialSegments + 1) + nextJ;
            const d = i * (radialSegments + 1) + nextJ;
            
            indices.push(a, b, d);
            indices.push(b, c, d);
        }
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    
    return geometry;
}

function createVaryingRibbonGeometry(curve, scalarData, minWidth, maxWidth, minScalar, maxScalar, colormapFn, scaleWidth) {
    const segments = Math.max(30, Math.floor(curve.getLength() / 1.5));
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const colors = [];
    const normals = [];
    const indices = [];

    const frames = curve.computeFrenetFrames(segments, false);

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const pos = curve.getPointAt(t);
        const normal = frames.normals[i];
        
        const rawIdx = t * (scalarData.length - 1);
        const idx0 = Math.floor(rawIdx);
        const idx1 = Math.min(idx0 + 1, scalarData.length - 1);
        const weight = rawIdx - idx0;
        const scalarVal = scalarData[idx0] * (1 - weight) + scalarData[idx1] * weight;
        
        const range = maxScalar - minScalar || 1;
        const ratio = Math.max(0, Math.min(1, (scalarVal - minScalar) / range));
        
        const width = scaleWidth ? (minWidth + ratio * (maxWidth - minWidth)) : config.tubeRadius * 2;
        const color = colormapFn(ratio);
        
        const p1 = pos.clone().addScaledVector(normal, width / 2);
        const p2 = pos.clone().addScaledVector(normal, -width / 2);
        
        vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        
        const binormal = frames.binormals[i];
        normals.push(binormal.x, binormal.y, binormal.z, binormal.x, binormal.y, binormal.z);
        
        if (i < segments) {
            const base = i * 2;
            indices.push(base, base + 2, base + 1);
            indices.push(base + 1, base + 2, base + 3);
        }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    return geometry;
}

function regenerateStreamlines() {
    if (!streamlinesPolyData) return;
    streamlinesGroup.clear();
    smokeGroup.clear();
    pathCurves = [];
    pathCurvesScalars = [];
    
    const lines = streamlinesPolyData.getLines() ? streamlinesPolyData.getLines().getData() : null;
    if (!lines) return;

    const points = streamlinesPolyData.getPoints().getData();
    
    // Find active scalar array
    let activeArray = getGeometryScalars(streamlinesPolyData, config.streamlineScalar);
    
    // Find min and max of active scalar
    minStreamlineScalar = Infinity;
    maxStreamlineScalar = -Infinity;
    let scalarData = null;
    if (activeArray) {
        scalarData = getArrayMagnitude(activeArray);
        for (let j = 0; j < scalarData.length; j++) {
            if (scalarData[j] < minStreamlineScalar) minStreamlineScalar = scalarData[j];
            if (scalarData[j] > maxStreamlineScalar) maxStreamlineScalar = scalarData[j];
        }
    }
    if (minStreamlineScalar === Infinity) { minStreamlineScalar = 0; maxStreamlineScalar = 1; }

    let i = 0;
    while (i < lines.length) {
        const numPoints = lines[i];
        i++;
        const curvePoints = [];
        const curveScalars = [];
        for (let j = 0; j < numPoints; j++) {
            const idx = lines[i + j];
            curvePoints.push(new THREE.Vector3(points[idx * 3], points[idx * 3 + 1], points[idx * 3 + 2]));
            if (activeArray && scalarData) {
                curveScalars.push(scalarData[idx]);
            } else {
                curveScalars.push(1);
            }
        }
        i += numPoints;

        if (curvePoints.length > 1) {
            const curve = new THREE.CatmullRomCurve3(curvePoints);
            pathCurves.push(curve);
            pathCurvesScalars.push(curveScalars);

            const colormapFn = (ratio) => getColorFromLUT(ratio, config.colormap);

            if (config.streamlineStyle === 'tube') {
                const minR = config.tubeRadius * 0.25;
                const maxR = config.tubeRadius * 1.5;
                const tubeGeom = createVaryingTubeGeometry(
                    curve, 
                    curveScalars, 
                    minR, 
                    maxR, 
                    minStreamlineScalar, 
                    maxStreamlineScalar, 
                    colormapFn,
                    config.scaleRadiusByScalar
                );
                const tubeMat = new THREE.MeshStandardMaterial({ 
                    transparent: true, opacity: 0.6, side: THREE.DoubleSide, vertexColors: true, roughness: 0.3
                });
                tubeMat.clippingPlanes = activeClippingPlanes;
                streamlinesGroup.add(new THREE.Mesh(tubeGeom, tubeMat));
            } else if (config.streamlineStyle === 'ribbon') {
                const minW = config.tubeRadius * 0.5;
                const maxW = config.tubeRadius * 3.0;
                const ribbonGeom = createVaryingRibbonGeometry(
                    curve, 
                    curveScalars, 
                    minW, 
                    maxW, 
                    minStreamlineScalar, 
                    maxStreamlineScalar, 
                    colormapFn,
                    config.scaleRadiusByScalar
                );
                const ribbonMat = new THREE.MeshStandardMaterial({ 
                    transparent: true, opacity: 0.75, side: THREE.DoubleSide, vertexColors: true, roughness: 0.4
                });
                ribbonMat.clippingPlanes = activeClippingPlanes;
                streamlinesGroup.add(new THREE.Mesh(ribbonGeom, ribbonMat));
            }
        }
    }

    if (config.streamlineStyle === 'smoke') {
        initSmokeEffect();
    }
}

function initAnimatedGlyphs() {
    animatedGlyphsGroup.clear();
    if (pathCurves.length === 0) return;

    const totalGlyphs = pathCurves.length * config.glyphDensity;
    let geometry;
    
    switch(config.glyphStyle) {
        case 'capsule':
            geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
            break;
        case 'sphere':
            geometry = new THREE.SphereGeometry(0.7, 8, 8);
            break;
        case 'ribbon':
            geometry = new THREE.PlaneGeometry(0.5, 1.8);
            geometry.rotateX(Math.PI / 2);
            break;
        default: // cone
            geometry = new THREE.ConeGeometry(0.5, 1.8, 8);
            geometry.rotateX(Math.PI / 2);
    }
    
    const material = new THREE.MeshStandardMaterial({ 
        metalness: 0.7, 
        roughness: 0.2 
    });
    material.clippingPlanes = activeClippingPlanes;
    
    instancedGlyphs = new THREE.InstancedMesh(geometry, material, totalGlyphs);
    
    glyphOffsets = [];
    for (let i = 0; i < totalGlyphs; i++) {
        glyphOffsets.push(Math.random());
    }
    
    animatedGlyphsGroup.add(instancedGlyphs);
}

function initSmokeEffect() {
    const particleCount = pathCurves.length * 40;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const alphas = new Float32Array(particleCount);
    
    smokeParticles = {
        data: [], // Stores { curveIndex, t, speed, age, lifetime, offset }
        points: null
    };

    for (let i = 0; i < particleCount; i++) {
        const curveIndex = Math.floor(Math.random() * pathCurves.length);
        const t = Math.random();
        const speed = (0.001 + Math.random() * 0.003) * (config.speed / 0.005);
        const lifetime = 100 + Math.random() * 100;
        const offset = new THREE.Vector3(
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.5
        );
        
        smokeParticles.data.push({ 
            curveIndex, t, speed, age: Math.random() * lifetime, lifetime, offset 
        });
        
        const pos = pathCurves[curveIndex].getPointAt(t);
        positions[i*3] = pos.x; positions[i*3+1] = pos.y; positions[i*3+2] = pos.z;
        
        // Set initial color based on scalar
        const scalars = pathCurvesScalars[curveIndex];
        const rawIdx = t * (scalars.length - 1);
        const idx0 = Math.floor(rawIdx);
        const idx1 = Math.min(idx0 + 1, scalars.length - 1);
        const weight = rawIdx - idx0;
        const scalarVal = scalars[idx0] * (1 - weight) + scalars[idx1] * weight;
        
        const range = maxStreamlineScalar - minStreamlineScalar || 1;
        const ratio = Math.max(0, Math.min(1, (scalarVal - minStreamlineScalar) / range));
        const color = getColorFromLUT(ratio, config.colormap);
        
        colors[i*3] = color.r; colors[i*3+1] = color.g; colors[i*3+2] = color.b;
        sizes[i] = 1.0;
        alphas[i] = 0.8;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('pSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            pointTexture: { value: smokeTexture }
        },
        vertexShader: `
            attribute float pSize;
            attribute float alpha;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                vAlpha = alpha;
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
                gl_PointSize = pSize * ( 250.0 / -mvPosition.z );
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform sampler2D pointTexture;
            varying float vAlpha;
            varying vec3 vColor;
            void main() {
                gl_FragColor = vec4( vColor, vAlpha );
                gl_FragColor = gl_FragColor * texture2D( pointTexture, gl_PointCoord );
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true
    });

    smokeParticles.points = new THREE.Points(geometry, material);
    smokeGroup.add(smokeParticles.points);
}

function updateGlyphAnimation() {
    if (instancedGlyphs && !config.isPaused) {
        const density = config.glyphDensity;
        const dummy = new THREE.Object3D();
        for (let i = 0; i < pathCurves.length; i++) {
            const curve = pathCurves[i];
            const scalars = pathCurvesScalars[i];
            for (let d = 0; d < density; d++) {
                const index = i * density + d;
                glyphOffsets[index] += config.speed;
                if (glyphOffsets[index] > 1) glyphOffsets[index] = 0;
                const t = glyphOffsets[index];
                
                const pos = curve.getPointAt(t);
                const tangent = curve.getTangentAt(t);
                dummy.position.copy(pos);
                dummy.lookAt(pos.clone().add(tangent));
                dummy.scale.set(config.glyphSize, config.glyphSize, config.glyphSize);
                dummy.updateMatrix();
                instancedGlyphs.setMatrixAt(index, dummy.matrix);
                
                // Set dynamic color of the cone/capsule instance based on scalar at t
                const rawIdx = t * (scalars.length - 1);
                const idx0 = Math.floor(rawIdx);
                const idx1 = Math.min(idx0 + 1, scalars.length - 1);
                const weight = rawIdx - idx0;
                const scalarVal = scalars[idx0] * (1 - weight) + scalars[idx1] * weight;
                
                const range = maxStreamlineScalar - minStreamlineScalar || 1;
                const ratio = Math.max(0, Math.min(1, (scalarVal - minStreamlineScalar) / range));
                const color = getColorFromLUT(ratio, config.colormap);
                
                instancedGlyphs.setColorAt(index, color);
            }
        }
        instancedGlyphs.instanceMatrix.needsUpdate = true;
        if (instancedGlyphs.instanceColor) instancedGlyphs.instanceColor.needsUpdate = true;
    }

    if (smokeParticles && !config.isPaused) {
        const geo = smokeParticles.points.geometry;
        const positions = geo.attributes.position.array;
        const colors = geo.attributes.color.array;
        const alphas = geo.attributes.alpha.array;
        const pSizes = geo.attributes.pSize.array;
        
        for (let i = 0; i < smokeParticles.data.length; i++) {
            const p = smokeParticles.data[i];
            
            p.t += p.speed;
            p.age += 1;
            
            if (p.t > 1.0 || p.age > p.lifetime) {
                p.t = 0;
                p.age = 0;
            }

            const basePos = pathCurves[p.curveIndex].getPointAt(p.t);
            const driftScale = 1.2;
            const time = Date.now() * 0.002;
            const driftX = Math.sin(time + i) * p.offset.x * driftScale;
            const driftY = Math.cos(time * 0.7 + i) * p.offset.y * driftScale;
            const driftZ = Math.sin(time * 0.5 + i) * p.offset.z * driftScale;
            
            const actualX = basePos.x + driftX;
            const actualY = basePos.y + driftY;
            const actualZ = basePos.z + driftZ;
            
            positions[i*3] = actualX;
            positions[i*3+1] = actualY;
            positions[i*3+2] = actualZ;

            // Clip points in JS for the custom Points/ShaderMaterial
            let isClipped = false;
            const offsetX = modelGroup ? modelGroup.position.x : 0;
            const offsetY = modelGroup ? modelGroup.position.y : 0;
            const offsetZ = modelGroup ? modelGroup.position.z : 0;
            if (config.clipXEnabled && (actualX + offsetX) > config.clipX) isClipped = true;
            if (config.clipYEnabled && (actualY + offsetY) > config.clipY) isClipped = true;
            if (config.clipZEnabled && (actualZ + offsetZ) > config.clipZ) isClipped = true;

            pSizes[i] = (1.0 + (p.age / p.lifetime) * 3.5) * config.glyphSize * 4.0;

            if (isClipped) {
                alphas[i] = 0.0;
            } else {
                let alpha = 1.0;
                if (p.t < 0.1) alpha = p.t / 0.1;
                else if (p.t > 0.85) alpha = 1.0 - (p.t - 0.85) / 0.15;
                
                const ageAlpha = 1.0 - (p.age / p.lifetime);
                alphas[i] = Math.min(alpha, ageAlpha) * 0.65;
            }
            
            // Update dynamic color matching position
            const scalars = pathCurvesScalars[p.curveIndex];
            const rawIdx = p.t * (scalars.length - 1);
            const idx0 = Math.floor(rawIdx);
            const idx1 = Math.min(idx0 + 1, scalars.length - 1);
            const weight = rawIdx - idx0;
            const scalarVal = scalars[idx0] * (1 - weight) + scalars[idx1] * weight;
            
            const range = maxStreamlineScalar - minStreamlineScalar || 1;
            const ratio = Math.max(0, Math.min(1, (scalarVal - minStreamlineScalar) / range));
            const color = getColorFromLUT(ratio, config.colormap);
            
            colors[i*3] = color.r;
            colors[i*3+1] = color.g;
            colors[i*3+2] = color.b;
        }
        
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        geo.attributes.alpha.needsUpdate = true;
        geo.attributes.pSize.needsUpdate = true;
    }
}

// --- CLIPPING PLANES ---
function updateClipping() {
    activeClippingPlanes = [];
    
    if (config.clipXEnabled) {
        clipPlanes.x.constant = config.clipX;
        activeClippingPlanes.push(clipPlanes.x);
    }
    if (config.clipYEnabled) {
        clipPlanes.y.constant = config.clipY;
        activeClippingPlanes.push(clipPlanes.y);
    }
    if (config.clipZEnabled) {
        clipPlanes.z.constant = config.clipZ;
        activeClippingPlanes.push(clipPlanes.z);
    }
    
    // Re-bind clipping planes to all mesh materials
    organGroup.traverse(child => {
        if (child.material) {
            child.material.clippingPlanes = activeClippingPlanes;
            child.material.clipShadows = true;
            child.material.needsUpdate = true;
        }
    });
    
    streamlinesGroup.traverse(child => {
        if (child.material) {
            child.material.clippingPlanes = activeClippingPlanes;
            child.material.needsUpdate = true;
        }
    });
    
    if (instancedGlyphs && instancedGlyphs.material) {
        instancedGlyphs.material.clippingPlanes = activeClippingPlanes;
        instancedGlyphs.material.needsUpdate = true;
    }
}

function updateClippingSliders(box) {
    if (box.isEmpty()) return;
    const min = box.min;
    const max = box.max;
    
    const sliders = {
        x: document.getElementById('clip-x'),
        y: document.getElementById('clip-y'),
        z: document.getElementById('clip-z')
    };
    
    // X slider
    sliders.x.min = Math.floor(min.x - 2);
    sliders.x.max = Math.ceil(max.x + 2);
    sliders.x.value = Math.ceil(max.x + 2);
    config.clipX = max.x + 2;
    clipPlanes.x.normal.set(-1, 0, 0); // Clip x > C
    
    // Y slider
    sliders.y.min = Math.floor(min.y - 2);
    sliders.y.max = Math.ceil(max.y + 2);
    sliders.y.value = Math.ceil(max.y + 2);
    config.clipY = max.y + 2;
    clipPlanes.y.normal.set(0, -1, 0); // Clip y > C
    
    // Z slider
    sliders.z.min = Math.floor(min.z - 2);
    sliders.z.max = Math.ceil(max.z + 2);
    sliders.z.value = Math.ceil(max.z + 2);
    config.clipZ = max.z + 2;
    clipPlanes.z.normal.set(0, 0, -1); // Clip z > C
}

function resetClipping() {
    config.clipXEnabled = false;
    config.clipYEnabled = false;
    config.clipZEnabled = false;
    
    document.getElementById('toggle-clip-x').checked = false;
    document.getElementById('toggle-clip-y').checked = false;
    document.getElementById('toggle-clip-z').checked = false;
    
    document.getElementById('clip-x').disabled = true;
    document.getElementById('clip-y').disabled = true;
    document.getElementById('clip-z').disabled = true;
    
    const box = new THREE.Box3().setFromObject(organGroup.children.length > 0 ? organGroup : streamlinesGroup);
    updateClippingSliders(box);
    updateClipping();
}

// --- COLORBAR / LEGEND ---
function updateColorbar() {
    const legendEl = document.getElementById('color-legend');
    if (!streamlinesPolyData && !organPolyData) {
        legendEl.style.display = 'none';
        return;
    }
    
    // Choose active array name
    let activeArray = null;
    let name = "Scalar";
    
    if (streamlinesPolyData && config.streamlineScalar) {
        activeArray = getGeometryScalars(streamlinesPolyData, config.streamlineScalar);
        name = config.streamlineScalar;
    } else if (organPolyData && config.organScalar) {
        activeArray = getGeometryScalars(organPolyData, config.organScalar);
        name = config.organScalar;
    }
    
    if (!activeArray) {
        if (streamlinesPolyData && streamlinesPolyData.getPointData().getScalars()) {
            activeArray = streamlinesPolyData.getPointData().getScalars();
            name = activeArray.getName() || "Velocity Magnitude";
        } else if (organPolyData && organPolyData.getPointData().getScalars()) {
            activeArray = organPolyData.getPointData().getScalars();
            name = activeArray.getName() || "Surface Metric";
        }
    }
    
    if (!activeArray) {
        legendEl.style.display = 'none';
        return;
    }
    
    legendEl.style.display = 'flex';
    
    const data = getArrayMagnitude(activeArray);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
    }
    if (min === Infinity) { min = 0; max = 1; }
    
    document.getElementById('legend-field-name').textContent = name;
    document.getElementById('legend-min').textContent = min.toFixed(2);
    document.getElementById('legend-mid').textContent = ((min + max) / 2).toFixed(2);
    document.getElementById('legend-max').textContent = max.toFixed(2);
    
    const points = colormaps[config.colormap] || colormaps.coolwarm;
    const gradientString = points.map((p, idx) => {
        const pct = (idx / (points.length - 1)) * 100;
        const r = Math.floor(p.r * 255);
        const g = Math.floor(p.g * 255);
        const b = Math.floor(p.b * 255);
        return `rgb(${r},${g},${b}) ${pct}%`;
    }).join(', ');
    
    document.getElementById('legend-gradient').style.background = `linear-gradient(to right, ${gradientString})`;
}

function populateScalarDropdowns() {
    const organSelect = document.getElementById('select-organ-scalar');
    const streamlineSelect = document.getElementById('select-streamline-scalar');
    const scalarGroup = document.getElementById('active-scalar-group');
    
    organSelect.innerHTML = '<option value="">None (Constant Gray)</option>';
    streamlineSelect.innerHTML = '<option value="">None (Constant Blue)</option>';
    
    let hasScalars = false;
    
    if (organPolyData) {
        const arrays = organPolyData.getPointData().getArrays();
        if (arrays && arrays.length > 0) {
            hasScalars = true;
            arrays.forEach(arr => {
                const name = arr.getName();
                if (name) {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    if (name === config.organScalar) opt.selected = true;
                    organSelect.appendChild(opt);
                }
            });
        }
    }
    
    if (streamlinesPolyData) {
        const arrays = streamlinesPolyData.getPointData().getArrays();
        if (arrays && arrays.length > 0) {
            hasScalars = true;
            arrays.forEach(arr => {
                const name = arr.getName();
                if (name) {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    if (name === config.streamlineScalar) opt.selected = true;
                    streamlineSelect.appendChild(opt);
                }
            });
        }
    }
    
    scalarGroup.style.display = hasScalars ? 'flex' : 'none';
}

// --- SCREENSHOT EXPORTER ---
function exportScreenshot() {
    // Save current settings
    const prevBg = scene.background;
    const prevGridVis = gridHelper.visible;
    const prevAxesVis = axesHelper.visible;
    
    // Apply export settings
    if (config.exportBg === 'white') {
        scene.background = new THREE.Color(0xffffff);
    } else if (config.exportBg === 'black') {
        scene.background = new THREE.Color(0x000000);
    } else {
        scene.background = null; // transparent
    }
    
    if (config.exportHideHelpers) {
        gridHelper.visible = false;
        axesHelper.visible = false;
    }
    
    // Render
    renderer.render(scene, camera);
    
    // Get image data
    const dataUrl = renderer.domElement.toDataURL('image/png');
    
    // Restore settings
    scene.background = prevBg;
    gridHelper.visible = prevGridVis;
    axesHelper.visible = prevAxesVis;
    
    // Download trigger
    const link = document.createElement('a');
    link.download = `flowvis_screenshot_${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
}

// --- UI & CONTROLS ---
function setupUI() {
    // File uploads
    document.getElementById('upload-organ').addEventListener('change', (e) => handleFileUpload(e, 'organ'));
    document.getElementById('upload-streamlines').addEventListener('change', (e) => handleFileUpload(e, 'streamlines'));
    document.getElementById('btn-load-demo').addEventListener('click', generateDemoScenario);

    // Active scalar selectors
    document.getElementById('select-organ-scalar').addEventListener('change', (e) => {
        config.organScalar = e.target.value;
        recolorOrganMesh();
    });
    document.getElementById('select-streamline-scalar').addEventListener('change', (e) => {
        config.streamlineScalar = e.target.value;
        regenerateStreamlines();
        updateColorbar();
    });

    // Visibility toggles
    document.getElementById('toggle-organ').addEventListener('change', (e) => organGroup.visible = e.target.checked);
    document.getElementById('toggle-streamlines').addEventListener('change', (e) => streamlinesGroup.visible = e.target.checked);
    document.getElementById('toggle-animated-glyphs').addEventListener('change', (e) => animatedGlyphsGroup.visible = e.target.checked);
    document.getElementById('toggle-helpers').addEventListener('change', (e) => axesHelper.visible = gridHelper.visible = e.target.checked);

    // Colormaps & Styles
    document.getElementById('setting-colormap').addEventListener('change', (e) => {
        config.colormap = e.target.value;
        recolorOrganMesh();
        regenerateStreamlines();
        initAnimatedGlyphs();
        updateColorbar();
    });
    document.getElementById('setting-streamline-style').addEventListener('change', (e) => {
        config.streamlineStyle = e.target.value;
        regenerateStreamlines();
    });
    document.getElementById('setting-glyph-style').addEventListener('change', (e) => {
        config.glyphStyle = e.target.value;
        initAnimatedGlyphs();
    });

    // Tuning Sliders
    const bindSlider = (id, valId, configKey, isFloat = true, onChange = null) => {
        const slider = document.getElementById(id);
        const valSpan = document.getElementById(valId);
        slider.addEventListener('input', (e) => {
            const val = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value);
            config[configKey] = val;
            valSpan.textContent = isFloat ? val.toFixed(4).replace(/\.?0+$/, '') : val;
            if (onChange) onChange(val);
        });
    };

    bindSlider('setting-speed', 'val-speed', 'speed');
    bindSlider('setting-glyph-size', 'val-glyph-size', 'glyphSize');
    bindSlider('setting-glyph-density', 'val-glyph-density', 'glyphDensity', false, () => initAnimatedGlyphs());
    bindSlider('setting-tube-radius', 'val-tube-radius', 'tubeRadius', true, () => regenerateStreamlines());
    
    bindSlider('setting-organ-opacity', 'val-organ-opacity', 'organOpacity', true, (val) => {
        organGroup.traverse(child => { if (child.material) child.material.opacity = val; });
    });

    document.getElementById('setting-scale-radius').addEventListener('change', (e) => {
        config.scaleRadiusByScalar = e.target.checked;
        regenerateStreamlines();
    });

    // Play/Pause button
    const btnPlay = document.getElementById('btn-play-pause');
    btnPlay.addEventListener('click', () => {
        config.isPaused = !config.isPaused;
        btnPlay.textContent = config.isPaused ? 'Play Animation' : 'Pause Animation';
    });

    // Clipping planes controls
    const setupClipAxis = (axis) => {
        const toggle = document.getElementById(`toggle-clip-${axis}`);
        const slider = document.getElementById(`clip-${axis}`);
        
        toggle.addEventListener('change', (e) => {
            config[`clip${axis.toUpperCase()}Enabled`] = e.target.checked;
            slider.disabled = !e.target.checked;
            updateClipping();
        });
        
        slider.addEventListener('input', (e) => {
            config[`clip${axis.toUpperCase()}`] = parseFloat(e.target.value);
            updateClipping();
        });
    };
    
    setupClipAxis('x');
    setupClipAxis('y');
    setupClipAxis('z');
    
    document.getElementById('btn-reset-clip').addEventListener('click', resetClipping);

    // Export Controls
    document.getElementById('setting-export-bg').addEventListener('change', (e) => {
        config.exportBg = e.target.value;
    });
    document.getElementById('setting-export-hide-helpers').addEventListener('change', (e) => {
        config.exportHideHelpers = e.target.checked;
    });
    document.getElementById('btn-screenshot').addEventListener('click', exportScreenshot);

    // Preset Views
    document.getElementById('btn-view-front').addEventListener('click', () => setCameraPresetView('front'));
    document.getElementById('btn-view-side').addEventListener('click', () => setCameraPresetView('side'));
    document.getElementById('btn-view-top').addEventListener('click', () => setCameraPresetView('top'));
    document.getElementById('btn-view-iso').addEventListener('click', () => setCameraPresetView('iso'));
}

async function handleFileUpload(event, type) {
    const file = event.target.files[0];
    if (!file) return;
    updateStatus(`Loading ${type}...`, 'loading');
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const vtpReader = vtkXMLPolyDataReader.newInstance();
            vtpReader.parseAsArrayBuffer(e.target.result);
            const polydata = vtpReader.getOutputData(0);
            
            if (type === 'organ') {
                organGroup.clear();
                organPolyData = polydata;
                
                // Set default scalar if available
                const scalars = polydata.getPointData().getScalars();
                if (scalars) config.organScalar = scalars.getName();
                
                const geometry = vtkToThreeGeometry(polydata, config.organScalar);
                if (geometry.index && geometry.index.count > 0) {
                    const material = new THREE.MeshStandardMaterial({ 
                        color: 0xffffff, transparent: true, opacity: config.organOpacity, side: THREE.DoubleSide, roughness: 0.5, vertexColors: !!scalars
                    });
                    material.clippingPlanes = activeClippingPlanes;
                    organGroup.add(new THREE.Mesh(geometry, material));
                } else {
                    const material = new THREE.PointsMaterial({ color: 0x4facfe, size: 0.5 });
                    organGroup.add(new THREE.Points(geometry, material));
                }
                centerModel();
                fitCameraToData(organGroup);
            } else if (type === 'streamlines') {
                // Set default scalar if available
                const scalars = polydata.getPointData().getScalars();
                if (scalars) config.streamlineScalar = scalars.getName();
                
                processStreamlines(polydata);
                centerModel();
                if (organGroup.children.length === 0) fitCameraToData(streamlinesGroup);
            }
            
            populateScalarDropdowns();
            updateColorbar();
            
            // Adjust clipping ranges based on newly loaded data
            const box = new THREE.Box3().setFromObject(organGroup.children.length > 0 ? organGroup : streamlinesGroup);
            updateClippingSliders(box);
            updateClipping(); // update bounds and active planes
            
            updateStatus(`${type} loaded successfully.`, 'success');
        } catch (err) {
            console.error(err);
            updateStatus(`Error parsing ${type}: ${err.message}`, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function fitCameraToData(object) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    
    // adjust camera bounds based on object size
    camera.near = maxDim / 100;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();
    
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(camera.fov * Math.PI / 360)) * 1.5;
    camera.position.set(center.x + cameraZ * 0.8, center.y + cameraZ * 0.5, center.z + cameraZ * 0.8);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
}

function updateStatus(msg, type = 'idle') {
    statusElement.textContent = msg;
    statusElement.className = `status-${type}`;
}

// --- ACCESSIBILITY, TOOLTIPS, THEMES & PRESET VIEWS ---
function initThemes() {
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

function updateSceneBackground() {
    if (!scene) return;
    let colorHex = 0x0f0f12; // dark default
    
    if (document.body.classList.contains('high-contrast')) {
        colorHex = 0x000000;
    } else if (document.body.classList.contains('light-theme')) {
        colorHex = 0xf3f4f7;
    }
    
    scene.background = new THREE.Color(colorHex);
}

function setupTooltipSystem() {
    const tooltipEl = document.createElement('div');
    tooltipEl.className = 'custom-tooltip';
    document.body.appendChild(tooltipEl);
    
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

function setCameraPresetView(preset) {
    const activeObject = organGroup.children.length > 0 ? organGroup : streamlinesGroup;
    const box = new THREE.Box3().setFromObject(activeObject);
    if (box.isEmpty()) return;
    
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const cameraDist = Math.abs(maxDim / 2 / Math.tan(camera.fov * Math.PI / 360)) * 1.6;
    
    controls.target.copy(center);
    
    switch(preset) {
        case 'front':
            camera.position.set(center.x, center.y, center.z + cameraDist);
            camera.up.set(0, 1, 0);
            break;
        case 'side':
            camera.position.set(center.x + cameraDist, center.y, center.z);
            camera.up.set(0, 1, 0);
            break;
        case 'top':
            camera.position.set(center.x, center.y + cameraDist, center.z);
            camera.up.set(0, 0, -1);
            break;
        case 'iso':
        default:
            camera.position.set(center.x + cameraDist * 0.7, center.y + cameraDist * 0.5, center.z + cameraDist * 0.7);
            camera.up.set(0, 1, 0);
            break;
    }
    
    camera.lookAt(center);
    controls.update();
}


function animate() {
    requestAnimationFrame(animate);
    if (renderer) {
        updateGlyphAnimation();
        controls.update();
        renderer.render(scene, camera);
    }
}

function showWebGLError() {
    const container = document.getElementById('container');
    if (!container) return;
    container.innerHTML = `
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
            padding:32px;background:rgba(15,15,20,0.97);backdrop-filter:blur(12px);
            border:1px solid rgba(255,100,100,0.35);border-radius:16px;color:#ff6b6b;
            max-width:520px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,0.8);
            z-index:9999;font-family:'Outfit',sans-serif;">
            <span class='material-symbols-outlined' style='font-size:52px;margin-bottom:16px;display:block'>display_settings</span>
            <h2 style='margin:0 0 12px;font-size:1.4rem;color:#fff'>WebGL ist deaktiviert</h2>
            <p style='margin:0 0 20px;font-size:0.9rem;line-height:1.6;color:#ccc'>
                Chrome konnte keinen 3D-Kontext erstellen, weil Hardware-Beschleunigung
                deaktiviert ist.<br>
                <code style='font-size:0.75rem;color:#aaa'>GL_RENDERER = Disabled</code>
            </p>
            <div style='background:rgba(0,0,0,0.4);padding:16px;border-radius:10px;text-align:left;font-size:0.82rem;color:#bbb;line-height:1.7'>
                <strong style='color:#fff'>So aktivieren Sie WebGL in Chrome:</strong>
                <ol style='margin:8px 0 0 0;padding-left:20px'>
                    <li>URL: <strong style='color:#4facfe'>chrome://settings/system</strong></li>
                    <li>Aktivieren: <em>Grafikbeschleunigung verwenden, wenn verfuegbar</em></li>
                    <li>Chrome neu starten</li>
                    <li>Alternativ: <strong style='color:#4facfe'>chrome://flags/#use-angle</strong> setzen auf <em>OpenGL</em></li>
                </ol>
            </div>
            <button onclick='window.location.reload()' style='
                margin-top:20px;padding:10px 24px;background:#4facfe;
                border:none;border-radius:8px;color:#000;font-weight:700;
                font-size:0.9rem;cursor:pointer'>Seite neu laden</button>
        </div>`;
    const statusEl = document.getElementById('status-message');
    if (statusEl) { statusEl.textContent = 'WebGL Fehler: 3D deaktiviert.'; statusEl.className = 'status-error'; }
}

init();
