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
    streamlineStyle: 'tube'
};

// --- UTILS ---

function createSmokeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
}

// --- ENGINE LAYER ---

let scene, camera, renderer, controls;
let organGroup, streamlinesGroup, animatedGlyphsGroup, smokeGroup;
let axesHelper, gridHelper;
let statusElement;

// Animation State
let pathCurves = []; // Array of THREE.Curve
let instancedGlyphs = null;
let glyphOffsets = []; // Current t value (0-1) for each instance
let smokeParticles = null; // THREE.Points for smoke
let smokeTexture = null;

function init() {
    statusElement = document.getElementById('status-message');
    smokeTexture = createSmokeTexture();

    // 1. Scene & Camera
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000);
    camera.position.set(200, 200, 200);

    // 2. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('container').appendChild(renderer.domElement);

    // 3. Orbit Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // 4. Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    hemiLight.position.set(0, 1000, 0);
    scene.add(hemiLight);

    // 5. Layer Groups
    organGroup = new THREE.Group();
    streamlinesGroup = new THREE.Group();
    animatedGlyphsGroup = new THREE.Group();
    smokeGroup = new THREE.Group();
    scene.add(organGroup, streamlinesGroup, animatedGlyphsGroup, smokeGroup);

    // 6. Helpers
    axesHelper = new THREE.AxesHelper(100);
    gridHelper = new THREE.GridHelper(500, 50);
    scene.add(axesHelper, gridHelper);

    window.addEventListener('resize', onWindowResize);

    setupUI();
    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- DATA PROCESSING ---

function vtkToThreeGeometry(polydata) {
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

    const scalars = polydata.getPointData().getScalars();
    if (scalars) {
        const scalarData = scalars.getData();
        const colors = new Float32Array(scalarData.length * 3);
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < scalarData.length; i++) {
            if (scalarData[i] < min) min = scalarData[i];
            if (scalarData[i] > max) max = scalarData[i];
        }
        const range = max - min || 1;
        for (let i = 0; i < scalarData.length; i++) {
            const ratio = (scalarData[i] - min) / range;
            const c = new THREE.Color().setHSL(0.6 - ratio * 0.5, 1, 0.5);
            colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    return geometry;
}

let streamlinesPolyData = null;

function processStreamlines(polydata) {
    streamlinesPolyData = polydata;
    regenerateStreamlines();
    initAnimatedGlyphs();
}

function regenerateStreamlines() {
    if (!streamlinesPolyData) return;
    streamlinesGroup.clear();
    smokeGroup.clear();
    pathCurves = [];
    
    const lines = streamlinesPolyData.getLines() ? streamlinesPolyData.getLines().getData() : null;
    if (!lines) return;

    const points = streamlinesPolyData.getPoints().getData();
    let i = 0;
    while (i < lines.length) {
        const numPoints = lines[i];
        i++;
        const curvePoints = [];
        for (let j = 0; j < numPoints; j++) {
            const idx = lines[i + j];
            curvePoints.push(new THREE.Vector3(points[idx * 3], points[idx * 3 + 1], points[idx * 3 + 2]));
        }
        i += numPoints;

        if (curvePoints.length > 1) {
            const curve = new THREE.CatmullRomCurve3(curvePoints);
            pathCurves.push(curve);

            if (config.streamlineStyle === 'tube') {
                const tubeGeom = new THREE.TubeGeometry(curve, Math.max(2, curvePoints.length), config.tubeRadius, 8, false);
                const tubeMat = new THREE.MeshStandardMaterial({ 
                    color: 0x00f2fe, transparent: true, opacity: 0.4, side: THREE.DoubleSide 
                });
                streamlinesGroup.add(new THREE.Mesh(tubeGeom, tubeMat));
            } else if (config.streamlineStyle === 'ribbon') {
                // Custom Ribbon Geometry
                const ribbonGeom = createRibbonGeometry(curve, config.tubeRadius * 2);
                const ribbonMat = new THREE.MeshStandardMaterial({ 
                    color: 0x00f2fe, transparent: true, opacity: 0.6, side: THREE.DoubleSide 
                });
                streamlinesGroup.add(new THREE.Mesh(ribbonGeom, ribbonMat));
            }
        }
    }

    if (config.streamlineStyle === 'smoke') {
        initSmokeEffect();
    }
}

function createRibbonGeometry(curve, width) {
    const segments = Math.max(2, curve.points.length * 4);
    const points = curve.getPoints(segments);
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const indices = [];

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const pos = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t);
        const normal = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
        
        const p1 = pos.clone().addScaledVector(normal, width / 2);
        const p2 = pos.clone().addScaledVector(normal, -width / 2);
        
        vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        
        if (i < segments) {
            const base = i * 2;
            indices.push(base, base + 1, base + 2);
            indices.push(base + 1, base + 3, base + 2);
        }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
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
            geometry = new THREE.SphereGeometry(0.8, 8, 8);
            break;
        case 'ribbon':
            geometry = new THREE.PlaneGeometry(0.5, 2);
            geometry.rotateX(Math.PI / 2);
            break;
        default: // cone
            geometry = new THREE.ConeGeometry(0.5, 2, 8);
            geometry.rotateX(Math.PI / 2);
    }
    
    const material = new THREE.MeshStandardMaterial({ color: 0x4facfe, metalness: 0.8, roughness: 0.2 });
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
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
        );
        
        smokeParticles.data.push({ 
            curveIndex, t, speed, age: Math.random() * lifetime, lifetime, offset 
        });
        
        const pos = pathCurves[curveIndex].getPointAt(t);
        positions[i*3] = pos.x; positions[i*3+1] = pos.y; positions[i*3+2] = pos.z;
        
        colors[i*3] = 0.0; colors[i*3+1] = 0.95; colors[i*3+2] = 1.0;
        sizes[i] = 1.0;
        alphas[i] = 1.0;
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
                gl_PointSize = pSize * ( 300.0 / -mvPosition.z );
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
            }
        }
        instancedGlyphs.instanceMatrix.needsUpdate = true;
    }

    if (smokeParticles && !config.isPaused) {
        const geo = smokeParticles.points.geometry;
        const positions = geo.attributes.position.array;
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
            const driftScale = 2.0;
            const time = Date.now() * 0.002;
            const driftX = Math.sin(time + i) * p.offset.x * driftScale;
            const driftY = Math.cos(time * 0.7 + i) * p.offset.y * driftScale;
            const driftZ = Math.sin(time * 0.5 + i) * p.offset.z * driftScale;
            
            positions[i*3] = basePos.x + driftX;
            positions[i*3+1] = basePos.y + driftY;
            positions[i*3+2] = basePos.z + driftZ;

            pSizes[i] = (1.0 + (p.age / p.lifetime) * 4.0) * config.glyphSize * 5.0;

            let alpha = 1.0;
            if (p.t < 0.1) alpha = p.t / 0.1;
            else if (p.t > 0.8) alpha = 1.0 - (p.t - 0.8) / 0.2;
            
            const ageAlpha = 1.0 - (p.age / p.lifetime);
            alphas[i] = Math.min(alpha, ageAlpha) * 0.6;
        }
        
        geo.attributes.position.needsUpdate = true;
        geo.attributes.alpha.needsUpdate = true;
        geo.attributes.pSize.needsUpdate = true;
    }
}

// --- UI & CONTROLS ---

function setupUI() {
    document.getElementById('upload-organ').addEventListener('change', (e) => handleFileUpload(e, 'organ'));
    document.getElementById('upload-streamlines').addEventListener('change', (e) => handleFileUpload(e, 'streamlines'));

    document.getElementById('toggle-organ').addEventListener('change', (e) => organGroup.visible = e.target.checked);
    document.getElementById('toggle-streamlines').addEventListener('change', (e) => streamlinesGroup.visible = e.target.checked);
    document.getElementById('toggle-animated-glyphs').addEventListener('change', (e) => animatedGlyphsGroup.visible = e.target.checked);
    document.getElementById('toggle-helpers').addEventListener('change', (e) => axesHelper.visible = gridHelper.visible = e.target.checked);

    document.getElementById('setting-speed').addEventListener('input', (e) => config.speed = parseFloat(e.target.value));
    document.getElementById('setting-glyph-size').addEventListener('input', (e) => config.glyphSize = parseFloat(e.target.value));
    document.getElementById('setting-glyph-density').addEventListener('input', (e) => {
        config.glyphDensity = parseInt(e.target.value);
        initAnimatedGlyphs();
    });
    document.getElementById('setting-tube-radius').addEventListener('input', (e) => {
        config.tubeRadius = parseFloat(e.target.value);
        regenerateStreamlines();
    });
    document.getElementById('setting-organ-opacity').addEventListener('input', (e) => {
        config.organOpacity = parseFloat(e.target.value);
        organGroup.traverse(child => { if (child.material) child.material.opacity = config.organOpacity; });
    });

    document.getElementById('setting-glyph-style').addEventListener('change', (e) => {
        config.glyphStyle = e.target.value;
        initAnimatedGlyphs();
    });
    document.getElementById('setting-streamline-style').addEventListener('change', (e) => {
        config.streamlineStyle = e.target.value;
        regenerateStreamlines();
    });

    const btnPlay = document.getElementById('btn-play-pause');
    btnPlay.addEventListener('click', () => {
        config.isPaused = !config.isPaused;
        btnPlay.textContent = config.isPaused ? 'Play Animation' : 'Pause Animation';
    });
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
                const geometry = vtkToThreeGeometry(polydata);
                if (geometry.index && geometry.index.count > 0) {
                    const material = new THREE.MeshStandardMaterial({ 
                        color: 0xaaaaaa, transparent: true, opacity: config.organOpacity, side: THREE.DoubleSide, roughness: 0.5 
                    });
                    organGroup.add(new THREE.Mesh(geometry, material));
                } else {
                    organGroup.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x4facfe, size: 0.5 })));
                }
                fitCameraToData(organGroup);
            } else if (type === 'streamlines') {
                processStreamlines(polydata);
                if (organGroup.children.length === 0) fitCameraToData(streamlinesGroup);
            }
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
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(camera.fov * Math.PI / 360)) * 2.5;
    camera.position.set(center.x + cameraZ, center.y + cameraZ, center.z + cameraZ);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
}

function updateStatus(msg, type = 'idle') {
    statusElement.textContent = msg;
    statusElement.className = `status-${type}`;
}

function animate() {
    requestAnimationFrame(animate);
    updateGlyphAnimation();
    controls.update();
    renderer.render(scene, camera);
}

init();
