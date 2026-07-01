import * as THREE from 'three';
import { state, config, getColorFromLUT } from '../state.js';
import { getArrayMagnitude } from '../data/vtk-parser.js';

export function createSmokeTexture() {
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

export function createVaryingTubeGeometry(curve, scalarData, minRadius, maxRadius, minScalar, maxScalar, colormapFn, scaleRadius) {
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

export function createVaryingRibbonGeometry(curve, scalarData, minWidth, maxWidth, minScalar, maxScalar, colormapFn, scaleWidth) {
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

export function regenerateStreamlines() {
    if (!state.streamlinesPolyData) return;
    state.streamlinesGroup.clear();
    state.smokeGroup.clear();
    state.pathCurves = [];
    state.pathCurvesScalars = [];
    
    const lines = state.streamlinesPolyData.getLines() ? state.streamlinesPolyData.getLines().getData() : null;
    if (!lines) return;

    const points = state.streamlinesPolyData.getPoints().getData();
    
    // Find active scalar array
    let activeArray = null;
    if (state.streamlinesPolyData.getPointData) {
        const pointData = state.streamlinesPolyData.getPointData();
        if (pointData) {
            if (config.streamlineScalar) {
                activeArray = pointData.getArray(config.streamlineScalar);
            }
            if (!activeArray) {
                activeArray = pointData.getScalars();
            }
        }
    }
    
    // Find min and max of active scalar
    state.minStreamlineScalar = Infinity;
    state.maxStreamlineScalar = -Infinity;
    let scalarData = null;
    if (activeArray) {
        scalarData = getArrayMagnitude(activeArray);
        for (let j = 0; j < scalarData.length; j++) {
            if (scalarData[j] < state.minStreamlineScalar) state.minStreamlineScalar = scalarData[j];
            if (scalarData[j] > state.maxStreamlineScalar) state.maxStreamlineScalar = scalarData[j];
        }
    }
    if (state.minStreamlineScalar === Infinity) { state.minStreamlineScalar = 0; state.maxStreamlineScalar = 1; }

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
            state.pathCurves.push(curve);
            state.pathCurvesScalars.push(curveScalars);

            const colormapFn = (ratio) => getColorFromLUT(ratio, config.colormap);

            if (config.streamlineStyle === 'tube') {
                const minR = config.tubeRadius * 0.25;
                const maxR = config.tubeRadius * 1.5;
                const tubeGeom = createVaryingTubeGeometry(
                    curve, 
                    curveScalars, 
                    minR, 
                    maxR, 
                    state.minStreamlineScalar, 
                    state.maxStreamlineScalar, 
                    colormapFn,
                    config.scaleRadiusByScalar
                );
                const tubeMat = new THREE.MeshStandardMaterial({ 
                    transparent: true, opacity: 0.6, side: THREE.DoubleSide, vertexColors: true, roughness: 0.3
                });
                tubeMat.clippingPlanes = state.activeClippingPlanes;
                state.streamlinesGroup.add(new THREE.Mesh(tubeGeom, tubeMat));
            } else if (config.streamlineStyle === 'ribbon') {
                const minW = config.tubeRadius * 0.5;
                const maxW = config.tubeRadius * 3.0;
                const ribbonGeom = createVaryingRibbonGeometry(
                    curve, 
                    curveScalars, 
                    minW, 
                    maxW, 
                    state.minStreamlineScalar, 
                    state.maxStreamlineScalar, 
                    colormapFn,
                    config.scaleRadiusByScalar
                );
                const ribbonMat = new THREE.MeshStandardMaterial({ 
                    transparent: true, opacity: 0.75, side: THREE.DoubleSide, vertexColors: true, roughness: 0.4
                });
                ribbonMat.clippingPlanes = state.activeClippingPlanes;
                state.streamlinesGroup.add(new THREE.Mesh(ribbonGeom, ribbonMat));
            }
        }
    }

    if (config.streamlineStyle === 'smoke') {
        initSmokeEffect();
    }
}

export function initAnimatedGlyphs() {
    state.animatedGlyphsGroup.clear();
    if (state.pathCurves.length === 0) return;

    const totalGlyphs = state.pathCurves.length * config.glyphDensity;
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
    material.clippingPlanes = state.activeClippingPlanes;
    
    state.instancedGlyphs = new THREE.InstancedMesh(geometry, material, totalGlyphs);
    
    state.glyphOffsets = [];
    for (let i = 0; i < totalGlyphs; i++) {
        state.glyphOffsets.push(Math.random());
    }
    
    state.animatedGlyphsGroup.add(state.instancedGlyphs);
}

export function initSmokeEffect() {
    if (!state.smokeTexture) state.smokeTexture = createSmokeTexture();
    const particleCount = state.pathCurves.length * 40;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const alphas = new Float32Array(particleCount);
    
    state.smokeParticles = {
        data: [], // Stores { curveIndex, t, speed, age, lifetime, offset }
        points: null
    };

    for (let i = 0; i < particleCount; i++) {
        const curveIndex = Math.floor(Math.random() * state.pathCurves.length);
        const t = Math.random();
        const speed = (0.001 + Math.random() * 0.003) * (config.speed / 0.005);
        const lifetime = 100 + Math.random() * 100;
        const offset = new THREE.Vector3(
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.5
        );
        
        state.smokeParticles.data.push({ 
            curveIndex, t, speed, age: Math.random() * lifetime, lifetime, offset 
        });
        
        const pos = state.pathCurves[curveIndex].getPointAt(t);
        positions[i*3] = pos.x; positions[i*3+1] = pos.y; positions[i*3+2] = pos.z;
        
        // Set initial color based on scalar
        const scalars = state.pathCurvesScalars[curveIndex];
        const rawIdx = t * (scalars.length - 1);
        const idx0 = Math.floor(rawIdx);
        const idx1 = Math.min(idx0 + 1, scalars.length - 1);
        const weight = rawIdx - idx0;
        const scalarVal = scalars[idx0] * (1 - weight) + scalars[idx1] * weight;
        
        const range = state.maxStreamlineScalar - state.minStreamlineScalar || 1;
        const ratio = Math.max(0, Math.min(1, (scalarVal - state.minStreamlineScalar) / range));
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
            pointTexture: { value: state.smokeTexture }
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

    state.smokeParticles.points = new THREE.Points(geometry, material);
    state.smokeGroup.add(state.smokeParticles.points);
}

export function updateGlyphAnimation() {
    if (state.instancedGlyphs && !config.isPaused) {
        const density = config.glyphDensity;
        const dummy = new THREE.Object3D();
        for (let i = 0; i < state.pathCurves.length; i++) {
            const curve = state.pathCurves[i];
            const scalars = state.pathCurvesScalars[i];
            for (let d = 0; d < density; d++) {
                const index = i * density + d;
                state.glyphOffsets[index] += config.speed;
                if (state.glyphOffsets[index] > 1) state.glyphOffsets[index] = 0;
                const t = state.glyphOffsets[index];
                
                const pos = curve.getPointAt(t);
                const tangent = curve.getTangentAt(t);
                dummy.position.copy(pos);
                dummy.lookAt(pos.clone().add(tangent));
                dummy.scale.set(config.glyphSize, config.glyphSize, config.glyphSize);
                dummy.updateMatrix();
                state.instancedGlyphs.setMatrixAt(index, dummy.matrix);
                
                // Set dynamic color based on scalar
                const rawIdx = t * (scalars.length - 1);
                const idx0 = Math.floor(rawIdx);
                const idx1 = Math.min(idx0 + 1, scalars.length - 1);
                const weight = rawIdx - idx0;
                const scalarVal = scalars[idx0] * (1 - weight) + scalars[idx1] * weight;
                
                const range = state.maxStreamlineScalar - state.minStreamlineScalar || 1;
                const ratio = Math.max(0, Math.min(1, (scalarVal - state.minStreamlineScalar) / range));
                const color = getColorFromLUT(ratio, config.colormap);
                
                state.instancedGlyphs.setColorAt(index, color);
            }
        }
        state.instancedGlyphs.instanceMatrix.needsUpdate = true;
        if (state.instancedGlyphs.instanceColor) state.instancedGlyphs.instanceColor.needsUpdate = true;
    }

    if (state.smokeParticles && !config.isPaused) {
        const geo = state.smokeParticles.points.geometry;
        const positions = geo.attributes.position.array;
        const colors = geo.attributes.color.array;
        const alphas = geo.attributes.alpha.array;
        const pSizes = geo.attributes.pSize.array;
        
        for (let i = 0; i < state.smokeParticles.data.length; i++) {
            const p = state.smokeParticles.data[i];
            
            p.t += p.speed;
            p.age += 1;
            
            if (p.t > 1.0 || p.age > p.lifetime) {
                p.t = 0;
                p.age = 0;
            }

            const basePos = state.pathCurves[p.curveIndex].getPointAt(p.t);
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
            const offsetX = state.smokeGroup ? state.smokeGroup.position.x : 0;
            const offsetY = state.smokeGroup ? state.smokeGroup.position.y : 0;
            const offsetZ = state.smokeGroup ? state.smokeGroup.position.z : 0;
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
            const scalars = state.pathCurvesScalars[p.curveIndex];
            const rawIdx = p.t * (scalars.length - 1);
            const idx0 = Math.floor(rawIdx);
            const idx1 = Math.min(idx0 + 1, scalars.length - 1);
            const weight = rawIdx - idx0;
            const scalarVal = scalars[idx0] * (1 - weight) + scalars[idx1] * weight;
            
            const range = state.maxStreamlineScalar - state.minStreamlineScalar || 1;
            const ratio = Math.max(0, Math.min(1, (scalarVal - state.minStreamlineScalar) / range));
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
