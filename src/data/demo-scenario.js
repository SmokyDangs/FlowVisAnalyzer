import * as THREE from 'three';
import { state, config, updateStatus } from '../state.js';
import { MockPolyData, vtkToThreeGeometry, processStreamlines } from './vtk-parser.js';
import { fitCameraToData } from '../engine/viewer.js';

export function generateDemoScenario() {
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
    const organVorticity = [];
    const organHelicity = [];
    const organShearRate = [];
    
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
        
        // Wall Shear Rate / Stress approximation: proportional to velocity gradient near the wall
        const shearRate = 2.5 * (vMag / radRatio);
        // Vorticity magnitude at the wall
        let d_twist = 0;
        if (y > -15) {
            d_twist = 0.04 * Math.exp(-(y - 15) / 50) * (1 - (y + 15) / 50);
        }
        const vorticity = Math.abs(d_twist * 0.5 * vMag);
        const helicity = d_twist * 0.5 * vMag * vMag;
        
        for (let it = 0; it < nt; it++) {
            const theta = (it / nt) * Math.PI * 2;
            const x = radius * Math.cos(theta);
            const z = radius * Math.sin(theta);
            
            organPoints.push(x, y, z);
            organVelocity.push(vMag);
            organPressure.push(pressure);
            organVorticity.push(vorticity);
            organHelicity.push(helicity);
            organShearRate.push(shearRate);
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
    
    state.organPolyData = new MockPolyData(
        organPoints,
        null,
        organPolys,
        {
            "Velocity Magnitude": organVelocity,
            "Hydrostatic Pressure": organPressure,
            "Vorticity Magnitude": organVorticity,
            "Helicity Density": organHelicity,
            "Wall Shear Stress": organShearRate
        }
    );
    
    // --- 2. Generate Streamlines (Swirling Flow lines) ---
    const M = 22; // number of streamlines
    const ptsPerLine = 120;
    const streamlinePoints = [];
    const streamlineLines = [];
    const streamlineVelocity = [];
    const streamlinePressure = [];
    const streamlineVorticity = [];
    const streamlineHelicity = [];
    const streamlineShearRate = [];
    
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
            
            // Vorticity & Helicity
            let d_twist = 0;
            if (y > -15) {
                d_twist = 0.04 * Math.exp(-(y - 15) / 50) * (1 - (y + 15) / 50);
            }
            const vorticity = Math.abs(d_twist * (1.2 - rStart / rNormal) * vMag);
            const helicity = d_twist * (1.2 - rStart / rNormal) * vMag * vMag;
            // Shear rate estimate based on velocity spatial derivative
            const d_radRatio_dy = -(0.65 / 18) * (-y / 18) * Math.exp(-(y * y) / (2 * 18 * 18));
            const shearRate = Math.abs(-2 * vMag * d_radRatio_dy / radRatio) + vorticity * 0.3;
            
            streamlineVelocity.push(vMag);
            streamlinePressure.push(pressure);
            streamlineVorticity.push(vorticity);
            streamlineHelicity.push(helicity);
            streamlineShearRate.push(shearRate);
            
            currentPointIdx++;
        }
    }
    
    state.streamlinesPolyData = new MockPolyData(
        streamlinePoints,
        streamlineLines,
        null,
        {
            "Velocity Magnitude": streamlineVelocity,
            "Hydrostatic Pressure": streamlinePressure,
            "Vorticity Magnitude": streamlineVorticity,
            "Helicity Density": streamlineHelicity,
            "Shear Rate / Turbulence": streamlineShearRate
        }
    );
    
    // Clean and rebuild scene
    state.organGroup.clear();
    state.streamlinesGroup.clear();
    state.animatedGlyphsGroup.clear();
    state.smokeGroup.clear();
    
    // Load geometries
    config.organScalar = "Velocity Magnitude";
    config.streamlineScalar = "Velocity Magnitude";
    
    // Build Organ Mesh
    const organGeom = vtkToThreeGeometry(state.organPolyData, config.organScalar);
    const organMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: config.organOpacity,
        side: THREE.DoubleSide,
        roughness: 0.4,
        metalness: 0.1,
        vertexColors: true
    });
    organMat.clippingPlanes = state.activeClippingPlanes;
    state.organGroup.add(new THREE.Mesh(organGeom, organMat));
    
    // Process streamlines
    processStreamlines(state.streamlinesPolyData);
    
    // Fit camera
    fitCameraToData(state.organGroup);
    
    // Import dynamically to handle circular imports between components
    Promise.all([
        import('../ui/controls.js')
    ]).then(([controlsModule]) => {
        controlsModule.centerModel();
        controlsModule.populateScalarDropdowns();
        controlsModule.updateColorbar();
        
        // Initialize clipping sliders based on loaded bounds
        const box = new THREE.Box3().setFromObject(state.organGroup);
        controlsModule.updateClippingSliders(box);
    });
    
    updateStatus("Stenosis demo loaded. Try switching fields, clipping or colormaps!", "success");
}
