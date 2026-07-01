import * as THREE from 'three';
import { state, config, colormaps, getColorFromLUT, updateStatus } from '../state.js';
import { generateDemoScenario } from '../data/demo-scenario.js';
import { vtkToThreeGeometry, processStreamlines, recolorOrganMesh, getGeometryScalars, getArrayMagnitude } from '../data/vtk-parser.js';
import { regenerateStreamlines, initAnimatedGlyphs } from '../pipeline/geometry.js';
import { setCameraPresetView, fitCameraToData } from '../engine/viewer.js';
import vtkXMLPolyDataReader from 'vtkXMLPolyDataReader';

export function setupUI() {
    setupTabs();
    
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
    document.getElementById('toggle-organ').addEventListener('change', (e) => {
        if (state.organGroup) state.organGroup.visible = e.target.checked;
    });
    document.getElementById('toggle-streamlines').addEventListener('change', (e) => {
        if (state.streamlinesGroup) state.streamlinesGroup.visible = e.target.checked;
    });
    document.getElementById('toggle-animated-glyphs').addEventListener('change', (e) => {
        if (state.animatedGlyphsGroup) state.animatedGlyphsGroup.visible = e.target.checked;
    });
    document.getElementById('toggle-helpers').addEventListener('change', (e) => {
        if (state.axesHelper) state.axesHelper.visible = e.target.checked;
        if (state.gridHelper) state.gridHelper.visible = e.target.checked;
    });

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
        if (slider && valSpan) {
            slider.addEventListener('input', (e) => {
                const val = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value);
                config[configKey] = val;
                valSpan.textContent = isFloat ? val.toFixed(4).replace(/\.?0+$/, '') : val;
                if (onChange) onChange(val);
            });
        }
    };

    bindSlider('setting-speed', 'val-speed', 'speed');
    bindSlider('setting-glyph-size', 'val-glyph-size', 'glyphSize');
    bindSlider('setting-glyph-density', 'val-glyph-density', 'glyphDensity', false, () => initAnimatedGlyphs());
    bindSlider('setting-tube-radius', 'val-tube-radius', 'tubeRadius', true, () => regenerateStreamlines());
    
    bindSlider('setting-organ-opacity', 'val-organ-opacity', 'organOpacity', true, (val) => {
        if (state.organGroup) {
            state.organGroup.traverse(child => { if (child.material) child.material.opacity = val; });
        }
    });

    document.getElementById('setting-scale-radius').addEventListener('change', (e) => {
        config.scaleRadiusByScalar = e.target.checked;
        regenerateStreamlines();
    });

    // Play/Pause button
    const btnPlay = document.getElementById('btn-play-pause');
    if (btnPlay) {
        btnPlay.addEventListener('click', () => {
            config.isPaused = !config.isPaused;
            btnPlay.textContent = config.isPaused ? 'Play Animation' : 'Pause Animation';
        });
    }

    // Clipping planes controls
    const setupClipAxis = (axis) => {
        const toggle = document.getElementById(`toggle-clip-${axis}`);
        const slider = document.getElementById(`clip-${axis}`);
        
        if (toggle && slider) {
            toggle.addEventListener('change', (e) => {
                config[`clip${axis.toUpperCase()}Enabled`] = e.target.checked;
                slider.disabled = !e.target.checked;
                updateClipping();
            });
            
            slider.addEventListener('input', (e) => {
                config[`clip${axis.toUpperCase()}`] = parseFloat(e.target.value);
                updateClipping();
            });
        }
    };
    
    setupClipAxis('x');
    setupClipAxis('y');
    setupClipAxis('z');
    
    const btnResetClip = document.getElementById('btn-reset-clip');
    if (btnResetClip) {
        btnResetClip.addEventListener('click', resetClipping);
    }

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

export function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            tab.classList.add('active');
            
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            const target = tab.getAttribute('data-tab');
            const targetContent = document.getElementById(target);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

export function centerModel() {
    if (!state.organGroup && !state.streamlinesGroup) return;
    
    // 1. Reset translation
    if (state.organGroup) state.organGroup.position.set(0, 0, 0);
    if (state.streamlinesGroup) state.streamlinesGroup.position.set(0, 0, 0);
    if (state.animatedGlyphsGroup) state.animatedGlyphsGroup.position.set(0, 0, 0);
    if (state.smokeGroup) state.smokeGroup.position.set(0, 0, 0);
    
    // 2. Compute combined bounding box of the active geometries
    const box = new THREE.Box3();
    let hasOrgan = false;
    if (state.organGroup) {
        state.organGroup.traverse(child => {
            if (child.isMesh || child.isPoints) {
                hasOrgan = true;
            }
        });
    }
    
    let hasStreamlines = false;
    if (state.streamlinesGroup) {
        state.streamlinesGroup.traverse(child => {
            if (child.isMesh || child.isPoints) {
                hasStreamlines = true;
            }
        });
    }
    
    if (hasOrgan && hasStreamlines) {
        box.setFromObject(state.organGroup);
        const boxStreamlines = new THREE.Box3().setFromObject(state.streamlinesGroup);
        box.union(boxStreamlines);
    } else if (hasOrgan) {
        box.setFromObject(state.organGroup);
    } else if (hasStreamlines) {
        box.setFromObject(state.streamlinesGroup);
    } else {
        return;
    }
    
    if (box.isEmpty()) return;
    
    // 3. Get center of the bounding box
    const center = box.getCenter(new THREE.Vector3());
    
    // 4. Translate groups so their center is at (0, 0, 0)
    const negCenter = center.clone().multiplyScalar(-1);
    if (state.organGroup) state.organGroup.position.copy(negCenter);
    if (state.streamlinesGroup) state.streamlinesGroup.position.copy(negCenter);
    if (state.animatedGlyphsGroup) state.animatedGlyphsGroup.position.copy(negCenter);
    if (state.smokeGroup) state.smokeGroup.position.copy(negCenter);
    
    // 5. Adjust gridHelper position y to be just below the model's floor (bottom of bounding box)
    const centeredMinY = box.min.y - center.y;
    if (state.gridHelper) {
        state.gridHelper.position.y = centeredMinY - 2;
    }
}

export function updateClipping() {
    state.activeClippingPlanes = [];
    
    if (config.clipXEnabled) {
        state.clipPlanes.x.constant = config.clipX;
        state.activeClippingPlanes.push(state.clipPlanes.x);
    }
    if (config.clipYEnabled) {
        state.clipPlanes.y.constant = config.clipY;
        state.activeClippingPlanes.push(state.clipPlanes.y);
    }
    if (config.clipZEnabled) {
        state.clipPlanes.z.constant = config.clipZ;
        state.activeClippingPlanes.push(state.clipPlanes.z);
    }
    
    // Re-bind clipping planes to all mesh materials
    if (state.organGroup) {
        state.organGroup.traverse(child => {
            if (child.material) {
                child.material.clippingPlanes = state.activeClippingPlanes;
                child.material.clipShadows = true;
                child.material.needsUpdate = true;
            }
        });
    }
    
    if (state.streamlinesGroup) {
        state.streamlinesGroup.traverse(child => {
            if (child.material) {
                child.material.clippingPlanes = state.activeClippingPlanes;
                child.material.needsUpdate = true;
            }
        });
    }
    
    if (state.instancedGlyphs && state.instancedGlyphs.material) {
        state.instancedGlyphs.material.clippingPlanes = state.activeClippingPlanes;
        state.instancedGlyphs.material.needsUpdate = true;
    }
}

export function updateClippingSliders(box) {
    if (box.isEmpty()) return;
    const min = box.min;
    const max = box.max;
    
    const sliders = {
        x: document.getElementById('clip-x'),
        y: document.getElementById('clip-y'),
        z: document.getElementById('clip-z')
    };
    
    // X slider
    if (sliders.x) {
        sliders.x.min = Math.floor(min.x - 2);
        sliders.x.max = Math.ceil(max.x + 2);
        sliders.x.value = Math.ceil(max.x + 2);
    }
    config.clipX = max.x + 2;
    state.clipPlanes.x.normal.set(-1, 0, 0); // Clip x > C
    
    // Y slider
    if (sliders.y) {
        sliders.y.min = Math.floor(min.y - 2);
        sliders.y.max = Math.ceil(max.y + 2);
        sliders.y.value = Math.ceil(max.y + 2);
    }
    config.clipY = max.y + 2;
    state.clipPlanes.y.normal.set(0, -1, 0); // Clip y > C
    
    // Z slider
    if (sliders.z) {
        sliders.z.min = Math.floor(min.z - 2);
        sliders.z.max = Math.ceil(max.z + 2);
        sliders.z.value = Math.ceil(max.z + 2);
    }
    config.clipZ = max.z + 2;
    state.clipPlanes.z.normal.set(0, 0, -1); // Clip z > C
}

export function resetClipping() {
    config.clipXEnabled = false;
    config.clipYEnabled = false;
    config.clipZEnabled = false;
    
    const toggleX = document.getElementById('toggle-clip-x');
    const toggleY = document.getElementById('toggle-clip-y');
    const toggleZ = document.getElementById('toggle-clip-z');
    if (toggleX) toggleX.checked = false;
    if (toggleY) toggleY.checked = false;
    if (toggleZ) toggleZ.checked = false;
    
    const clipX = document.getElementById('clip-x');
    const clipY = document.getElementById('clip-y');
    const clipZ = document.getElementById('clip-z');
    if (clipX) clipX.disabled = true;
    if (clipY) clipY.disabled = true;
    if (clipZ) clipZ.disabled = true;
    
    const box = new THREE.Box3().setFromObject(
        (state.organGroup && state.organGroup.children.length > 0) ? state.organGroup : state.streamlinesGroup
    );
    updateClippingSliders(box);
    updateClipping();
}

export function updateColorbar() {
    const legendEl = document.getElementById('color-legend');
    if (!legendEl) return;
    if (!state.streamlinesPolyData && !state.organPolyData) {
        legendEl.style.display = 'none';
        return;
    }
    
    // Choose active array name
    let activeArray = null;
    let name = "Scalar";
    
    if (state.streamlinesPolyData && config.streamlineScalar) {
        activeArray = getGeometryScalars(state.streamlinesPolyData, config.streamlineScalar);
        name = config.streamlineScalar;
    } else if (state.organPolyData && config.organScalar) {
        activeArray = getGeometryScalars(state.organPolyData, config.organScalar);
        name = config.organScalar;
    }
    
    if (!activeArray) {
        if (state.streamlinesPolyData && state.streamlinesPolyData.getPointData().getScalars()) {
            activeArray = state.streamlinesPolyData.getPointData().getScalars();
            name = activeArray.getName() || "Velocity Magnitude";
        } else if (state.organPolyData && state.organPolyData.getPointData().getScalars()) {
            activeArray = state.organPolyData.getPointData().getScalars();
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
    
    const fieldNameEl = document.getElementById('legend-field-name');
    const minEl = document.getElementById('legend-min');
    const midEl = document.getElementById('legend-mid');
    const maxEl = document.getElementById('legend-max');
    if (fieldNameEl) fieldNameEl.textContent = name;
    if (minEl) minEl.textContent = min.toFixed(2);
    if (midEl) midEl.textContent = ((min + max) / 2).toFixed(2);
    if (maxEl) maxEl.textContent = max.toFixed(2);
    
    const points = colormaps[config.colormap] || colormaps.coolwarm;
    const gradientString = points.map((p, idx) => {
        const pct = (idx / (points.length - 1)) * 100;
        const r = Math.floor(p.r * 255);
        const g = Math.floor(p.g * 255);
        const b = Math.floor(p.b * 255);
        return `rgb(${r},${g},${b}) ${pct}%`;
    }).join(', ');
    
    const gradientEl = document.getElementById('legend-gradient');
    if (gradientEl) gradientEl.style.background = `linear-gradient(to right, ${gradientString})`;
}

export function populateScalarDropdowns() {
    const organSelect = document.getElementById('select-organ-scalar');
    const streamlineSelect = document.getElementById('select-streamline-scalar');
    const scalarGroup = document.getElementById('active-scalar-group');
    if (!organSelect || !streamlineSelect || !scalarGroup) return;
    
    organSelect.innerHTML = '<option value="">None (Constant Gray)</option>';
    streamlineSelect.innerHTML = '<option value="">None (Constant Blue)</option>';
    
    let hasScalars = false;
    
    if (state.organPolyData) {
        const arrays = state.organPolyData.getPointData().getArrays();
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
    
    if (state.streamlinesPolyData) {
        const arrays = state.streamlinesPolyData.getPointData().getArrays();
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

export function exportScreenshot() {
    if (!state.scene || !state.renderer) return;
    // Save current settings
    const prevBg = state.scene.background;
    const prevGridVis = state.gridHelper ? state.gridHelper.visible : true;
    const prevAxesVis = state.axesHelper ? state.axesHelper.visible : true;
    
    // Apply export settings
    if (config.exportBg === 'white') {
        state.scene.background = new THREE.Color(0xffffff);
    } else if (config.exportBg === 'black') {
        state.scene.background = new THREE.Color(0x000000);
    } else {
        state.scene.background = null; // transparent
    }
    
    if (config.exportHideHelpers) {
        if (state.gridHelper) state.gridHelper.visible = false;
        if (state.axesHelper) state.axesHelper.visible = false;
    }
    
    // Render
    state.renderer.render(state.scene, state.camera);
    
    // Get image data
    const dataUrl = state.renderer.domElement.toDataURL('image/png');
    
    // Restore settings
    state.scene.background = prevBg;
    if (state.gridHelper) state.gridHelper.visible = prevGridVis;
    if (state.axesHelper) state.axesHelper.visible = prevAxesVis;
    
    // Download trigger
    const link = document.createElement('a');
    link.download = `flowvis_screenshot_${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
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
                if (state.organGroup) state.organGroup.clear();
                state.organPolyData = polydata;
                
                // Set default scalar if available
                const scalars = polydata.getPointData().getScalars();
                if (scalars) config.organScalar = scalars.getName();
                
                const geometry = vtkToThreeGeometry(polydata, config.organScalar);
                if (geometry.index && geometry.index.count > 0) {
                    const material = new THREE.MeshStandardMaterial({ 
                        color: 0xffffff, transparent: true, opacity: config.organOpacity, side: THREE.DoubleSide, roughness: 0.5, vertexColors: !!scalars
                    });
                    material.clippingPlanes = state.activeClippingPlanes;
                    if (state.organGroup) state.organGroup.add(new THREE.Mesh(geometry, material));
                } else {
                    const material = new THREE.PointsMaterial({ color: 0x4facfe, size: 0.5 });
                    if (state.organGroup) state.organGroup.add(new THREE.Points(geometry, material));
                }
                centerModel();
                if (state.organGroup) fitCameraToData(state.organGroup);
            } else if (type === 'streamlines') {
                const scalars = polydata.getPointData().getScalars();
                if (scalars) config.streamlineScalar = scalars.getName();
                
                processStreamlines(polydata);
                centerModel();
                if (state.organGroup && state.organGroup.children.length === 0 && state.streamlinesGroup) {
                    fitCameraToData(state.streamlinesGroup);
                }
            }
            
            populateScalarDropdowns();
            updateColorbar();
            
            // Adjust clipping ranges based on newly loaded data
            const box = new THREE.Box3().setFromObject(
                (state.organGroup && state.organGroup.children.length > 0) ? state.organGroup : state.streamlinesGroup
            );
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
