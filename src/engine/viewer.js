import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state, config, updateStatus } from '../state.js';
import { updateGlyphAnimation } from '../pipeline/geometry.js';
import { initThemes } from '../ui/themes.js';

export function initViewer() {
    state.statusElement = document.getElementById('status-message');

    // 1. Scene & Camera
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x0f0f12);

    state.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50000);
    state.camera.position.set(150, 100, 150);

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
            state.renderer = new THREE.WebGLRenderer(opts);
            state.renderer.setSize(window.innerWidth, window.innerHeight);
            state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            state.renderer.localClippingEnabled = true;
            document.getElementById('container').appendChild(state.renderer.domElement);
            rendererCreated = true;
            
            // 3. Orbit Controls
            state.controls = new OrbitControls(state.camera, state.renderer.domElement);
            state.controls.enableDamping = true;
            state.controls.dampingFactor = 0.05;
        } catch (err) {
            console.warn('WebGL attempt failed:', err.message);
            state.renderer = null;
        }
    }
    if (!rendererCreated) {
        showWebGLError();
    }

    // 4. Lighting
    state.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(1, 1, 1).normalize();
    state.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x4facfe, 0.4);
    dirLight2.position.set(-1, -1, -1).normalize();
    state.scene.add(dirLight2);

    // 5. Layer Groups
    state.organGroup = new THREE.Group();
    state.streamlinesGroup = new THREE.Group();
    state.animatedGlyphsGroup = new THREE.Group();
    state.smokeGroup = new THREE.Group();
    state.scene.add(state.organGroup, state.streamlinesGroup, state.animatedGlyphsGroup, state.smokeGroup);

    // 6. Helpers
    state.axesHelper = new THREE.AxesHelper(60);
    state.gridHelper = new THREE.GridHelper(300, 30, 0x444444, 0x222222);
    state.gridHelper.position.y = -50;
    state.scene.add(state.axesHelper, state.gridHelper);

    window.addEventListener('resize', onWindowResize);
}

export function startAnimationLoop() {
    animate();
}

function animate() {
    requestAnimationFrame(animate);
    updateGlyphAnimation();
    if (state.controls) state.controls.update();
    if (state.renderer) state.renderer.render(state.scene, state.camera);
}

function onWindowResize() {
    state.camera.aspect = window.innerWidth / window.innerHeight;
    state.camera.updateProjectionMatrix();
    if (state.renderer) state.renderer.setSize(window.innerWidth, window.innerHeight);
}

export function fitCameraToData(object) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    
    state.camera.near = maxDim / 100;
    state.camera.far = maxDim * 100;
    state.camera.updateProjectionMatrix();
    
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(state.camera.fov * Math.PI / 360)) * 1.5;
    state.camera.position.set(center.x + cameraZ * 0.8, center.y + cameraZ * 0.5, center.z + cameraZ * 0.8);
    state.camera.lookAt(center);
    
    if (state.controls) {
        state.controls.target.copy(center);
        state.controls.update();
    }
}

export function setCameraPresetView(preset) {
    const activeObject = state.organGroup.children.length > 0 ? state.organGroup : state.streamlinesGroup;
    const box = new THREE.Box3().setFromObject(activeObject);
    if (box.isEmpty()) return;
    
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const cameraDist = Math.abs(maxDim / 2 / Math.tan(state.camera.fov * Math.PI / 360)) * 1.6;
    
    if (state.controls) {
        state.controls.target.copy(center);
    }
    
    switch(preset) {
        case 'front':
            state.camera.position.set(center.x, center.y, center.z + cameraDist);
            state.camera.up.set(0, 1, 0);
            break;
        case 'side':
            state.camera.position.set(center.x + cameraDist, center.y, center.z);
            state.camera.up.set(0, 1, 0);
            break;
        case 'top':
            state.camera.position.set(center.x, center.y + cameraDist, center.z);
            state.camera.up.set(0, 0, -1);
            break;
        case 'iso':
        default:
            state.camera.position.set(center.x + cameraDist * 0.7, center.y + cameraDist * 0.5, center.z + cameraDist * 0.7);
            state.camera.up.set(0, 1, 0);
            break;
    }
    
    state.camera.lookAt(center);
    if (state.controls) {
        state.controls.update();
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
    updateStatus('WebGL Fehler: 3D deaktiviert.', 'error');
}
