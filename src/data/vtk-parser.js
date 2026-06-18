import * as THREE from 'three';
import { state, config, getColorFromLUT } from '../state.js';
import { regenerateStreamlines, initAnimatedGlyphs } from '../pipeline/geometry.js';

// --- MOCK VTK DATA LAYER (DEMO MODE) ---
export class MockPolyData {
    constructor(points, lines, polys, scalarsMap, normals = null) {
        this.points = { getData: () => new Float32Array(points) };
        this.lines = lines ? { getData: () => new Int32Array(lines), getNumberOfCells: () => lines[0] ? 1 : 0 } : null;
        this.polys = polys ? { getData: () => new Int32Array(polys), getNumberOfCells: () => polys[0] ? 1 : 0 } : null;
        this.strips = null;
        this.verts = null;
        
        const arrays = Object.keys(scalarsMap).map(name => ({
            getName: () => name,
            getData: () => new Float32Array(scalarsMap[name]),
            getNumberOfComponents: () => (scalarsMap[name].length / points.length * 3) === 3 ? 3 : 1
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

export function getArrayMagnitude(array) {
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

export function getGeometryScalars(polydata, activeScalarName) {
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

export function vtkToThreeGeometry(polydata, activeScalarName) {
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

export function recolorOrganMesh() {
    if (state.organGroup.children.length === 0 || !state.organPolyData) return;
    const mesh = state.organGroup.children[0];
    if (!mesh || !mesh.geometry) return;
    
    const geom = mesh.geometry;
    const scalars = getGeometryScalars(state.organPolyData, config.organScalar);
    
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
    
    // Dynamically imported to resolve circular dependencies
    import('../ui/controls.js').then(module => {
        module.updateColorbar();
    });
}

export function processStreamlines(polydata) {
    state.streamlinesPolyData = polydata;
    regenerateStreamlines();
    initAnimatedGlyphs();
}
