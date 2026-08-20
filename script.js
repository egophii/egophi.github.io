// ==========================================
// Interactive WebGL Hand & Object Synchronizer
// ==========================================

const FPS = 30;
const FPS_REAL = 24; 

let sequenceData = null;
let fallbackFrameCounter = 0;
let lastTime = 0;
let cameraInitialized = false;
let isLoopRunning = false;

// Dynamic Mesh References
let staticLeftMesh, staticRightMesh, staticObjMesh;
let combLeftMesh, combRightMesh, combObjMesh;

// ------------------------------------------
// 0. Jet Colormap Lookup Table (256 RGB Colors)
// ------------------------------------------
const JET_LUT = new Float32Array(256 * 3);
for (let i = 0; i < 256; i++) {
    const v = i / 255.0;
    JET_LUT[i * 3 + 0] = Math.min(Math.max(1.5 - Math.abs(v * 4.0 - 3.0), 0.0), 1.0); 
    JET_LUT[i * 3 + 1] = Math.min(Math.max(1.5 - Math.abs(v * 4.0 - 2.0), 0.0), 1.0); 
    JET_LUT[i * 3 + 2] = Math.min(Math.max(1.5 - Math.abs(v * 4.0 - 1.0), 0.0), 1.0); 
}

// ------------------------------------------
// 1. Helper: Viewport Setup
// ------------------------------------------
function createViewport(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xfafafa);

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / 360, 0.001, 100);
    camera.position.set(0, 0, 1.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, 360);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const light = new THREE.DirectionalLight(0xffffff, 0.6);
    light.position.set(1, 1, 1);
    scene.add(light);

    return { container, scene, camera, renderer };
}

// Instantiate Viewports
const vpHands = createViewport('handsCanvasContainer');
const controlsHands = vpHands ? new THREE.OrbitControls(vpHands.camera, vpHands.renderer.domElement) : null;
if (controlsHands) controlsHands.enableDamping = true;

const vpObj = createViewport('objectCanvasContainer');
const controlsObj = vpObj ? new THREE.OrbitControls(vpObj.camera, vpObj.renderer.domElement) : null;
if (controlsObj) controlsObj.enableDamping = true;

const vpCombined = createViewport('combinedCanvasContainer');
if (vpCombined) vpCombined.camera.up.set(0, -1, 0);
const controlsCombined = vpCombined ? new THREE.OrbitControls(vpCombined.camera, vpCombined.renderer.domElement) : null;
if (controlsCombined) controlsCombined.enableDamping = true;

// ------------------------------------------
// Real-World Viewports Setup
// ------------------------------------------
const vpHandsReal = createViewport('handsCanvasContainerReal');
const controlsHandsReal = vpHandsReal ? new THREE.OrbitControls(vpHandsReal.camera, vpHandsReal.renderer.domElement) : null;
if (controlsHandsReal) controlsHandsReal.enableDamping = true;

const vpObjReal = createViewport('objectCanvasContainerReal');
const controlsObjReal = vpObjReal ? new THREE.OrbitControls(vpObjReal.camera, vpObjReal.renderer.domElement) : null;
if (controlsObjReal) controlsObjReal.enableDamping = true;

const vpCombinedReal = createViewport('combinedCanvasContainerReal');
if (vpCombinedReal) vpCombinedReal.camera.up.set(0, -1, 0);
const controlsCombinedReal = vpCombinedReal ? new THREE.OrbitControls(vpCombinedReal.camera, vpCombinedReal.renderer.domElement) : null;
if (controlsCombinedReal) controlsCombinedReal.enableDamping = true;

let sequenceDataReal = null;
let fallbackFrameCounterReal = 0;
let lastTimeReal = 0;
let cameraInitializedReal = false;
let isLoopRunningReal = false;

let staticLeftMeshReal, staticRightMeshReal, staticObjMeshReal;
let combLeftMeshReal, combRightMeshReal, combObjMeshReal;

// ------------------------------------------
// 2. Mesh Helpers
// ------------------------------------------
function createDynamicMesh(facesIndices, numVertices) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(numVertices * 3);
    const colors = new Float32Array(numVertices * 3);

    for (let i = 0; i < numVertices; i++) {
        colors[i * 3 + 0] = 0.0;
        colors[i * 3 + 1] = 0.0;
        colors[i * 3 + 2] = 1.0;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const flatFaces = Array.isArray(facesIndices[0]) ? facesIndices.flat() : facesIndices;
    geometry.setIndex(flatFaces);

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.3,
        metalness: 0.1,
        side: THREE.DoubleSide
    });

    return new THREE.Mesh(geometry, material);
}

function updateMeshColors(mesh, dataArray, numVertices, isForceMode = false) {
    if (!mesh) return;

    const colAttr = mesh.geometry.attributes.color;
    const colors = colAttr.array;

    if (isForceMode && dataArray && dataArray.length > 0) {
        for (let i = 0; i < numVertices; i++) {
            const val = dataArray[i] || 0;
            colors[i * 3 + 0] = JET_LUT[val * 3 + 0];
            colors[i * 3 + 1] = JET_LUT[val * 3 + 1];
            colors[i * 3 + 2] = JET_LUT[val * 3 + 2];
        }
    } else {
        for (let i = 0; i < numVertices; i++) {
            colors[i * 3 + 0] = 0.0;
            colors[i * 3 + 1] = 0.0;
            colors[i * 3 + 2] = 1.0;
        }

        if (dataArray && dataArray.length > 0) {
            for (let idx of dataArray) {
                colors[idx * 3 + 0] = 1.0;
                colors[idx * 3 + 1] = 1.0;
                colors[idx * 3 + 2] = 0.0;
            }
        }
    }

    colAttr.needsUpdate = true;
}

function updateMeshPositions(mesh, quantizedArray, scale = 1000.0) {
    if (!mesh || !quantizedArray) return;
    const posAttr = mesh.geometry.attributes.position;
    const positions = posAttr.array;

    for (let i = 0; i < quantizedArray.length; i++) {
        positions[i] = quantizedArray[i] / scale;
    }

    posAttr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
}

// ------------------------------------------
// 3. Camera Alignment Helpers
// ------------------------------------------
function frameMeshes(meshes, camera, controls = null) {
    const box = new THREE.Box3();
    let validMeshFound = false;

    meshes.forEach(mesh => {
        if (mesh && mesh.geometry) {
            mesh.geometry.computeBoundingBox();
            if (mesh.geometry.boundingBox && !mesh.geometry.boundingBox.isEmpty()) {
                box.union(mesh.geometry.boundingBox);
                validMeshFound = true;
            }
        }
    });

    if (!validMeshFound || box.isEmpty()) return;

    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraDistance = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * 1.5;

    camera.position.set(center.x, center.y, center.z + cameraDistance);
    camera.lookAt(center);

    if (controls) {
        controls.target.copy(center);
        controls.update();
    }
}

function alignCameraToEgoView(meshes, camera, controls = null) {
    const box = new THREE.Box3();
    meshes.forEach(mesh => {
        if (mesh && mesh.geometry) {
            mesh.geometry.computeBoundingBox();
            if (mesh.geometry.boundingBox && !mesh.geometry.boundingBox.isEmpty()) {
                box.union(mesh.geometry.boundingBox);
            }
        }
    });

    if (box.isEmpty()) return;

    const center = new THREE.Vector3();
    box.getCenter(center);

    // Set camera exactly at the egocentric origin to perfectly match the video perspective
    camera.position.set(0, 0, 0);
    camera.lookAt(center);

    if (controls) {
        controls.target.copy(center);
        controls.update();
    }
}

// ------------------------------------------
// 4. Load Sequence Data
// ------------------------------------------
function loadSequence(folderName) {
    const dataPath = `sequences/${folderName}`;

    const video = document.getElementById('rgbVideo');
    if (video) {
        video.src = `${dataPath}/rgb_video.mp4`;
        video.play().catch(() => {});
    }

    if (staticLeftMesh && vpHands) vpHands.scene.remove(staticLeftMesh);
    if (staticRightMesh && vpHands) vpHands.scene.remove(staticRightMesh);
    if (staticObjMesh && vpObj) vpObj.scene.remove(staticObjMesh);

    if (combLeftMesh && vpCombined) vpCombined.scene.remove(combLeftMesh);
    if (combRightMesh && vpCombined) vpCombined.scene.remove(combRightMesh);
    if (combObjMesh && vpCombined) vpCombined.scene.remove(combObjMesh);

    cameraInitialized = false;
    fallbackFrameCounter = 0;

    Promise.all([
        fetch(`${dataPath}/motion_sequence.json?v=${Date.now()}`).then(r => r.json()),
        fetch(`${dataPath}/faces_hand_left.json`).then(r => r.json()),
        fetch(`${dataPath}/faces_hand_right.json`).then(r => r.json()),
        fetch(`${dataPath}/faces_obj.json`).then(r => r.json())
    ]).then(([data, facesL, facesR, facesO]) => {
        sequenceData = data;
        const firstFrame = sequenceData.frames[0];
        const scale = sequenceData.scale || 1000.0;
        const staticVerts = sequenceData.static_verts;

        const numStaticVertsL = staticVerts.v_l.length / 3;
        const numStaticVertsR = staticVerts.v_r.length / 3;

        staticLeftMesh = createDynamicMesh(facesL, numStaticVertsL);
        updateMeshPositions(staticLeftMesh, staticVerts.v_l, scale);
        if (vpHands) vpHands.scene.add(staticLeftMesh);

        staticRightMesh = createDynamicMesh(facesR, numStaticVertsR);
        updateMeshPositions(staticRightMesh, staticVerts.v_r, scale);
        if (vpHands) vpHands.scene.add(staticRightMesh);

        const numStaticVertsO = staticVerts.v_o.length / 3;
        staticObjMesh = createDynamicMesh(facesO, numStaticVertsO);
        updateMeshPositions(staticObjMesh, staticVerts.v_o, scale);
        if (vpObj) vpObj.scene.add(staticObjMesh);

        const numDynamicVertsL = firstFrame.v_l.length / 3;
        const numDynamicVertsR = firstFrame.v_r.length / 3;
        const numDynamicVertsO = firstFrame.v_o.length / 3;

        combLeftMesh = createDynamicMesh(facesL, numDynamicVertsL);
        combRightMesh = createDynamicMesh(facesR, numDynamicVertsR);
        combObjMesh = createDynamicMesh(facesO, numDynamicVertsO);

        updateMeshPositions(combLeftMesh, firstFrame.v_l, scale);
        updateMeshPositions(combRightMesh, firstFrame.v_r, scale);
        updateMeshPositions(combObjMesh, firstFrame.v_o, scale);

        if (vpCombined) {
            vpCombined.scene.add(combLeftMesh);
            vpCombined.scene.add(combRightMesh);
            vpCombined.scene.add(combObjMesh);
        }

        if (vpHands) frameMeshes([staticLeftMesh, staticRightMesh], vpHands.camera, controlsHands);
        if (vpObj) frameMeshes([staticObjMesh], vpObj.camera, controlsObj);
        if (vpCombined) alignCameraToEgoView([combLeftMesh, combRightMesh, combObjMesh], vpCombined.camera, controlsCombined);
        cameraInitialized = true;

        if (!isLoopRunning) {
            isLoopRunning = true;
            animate(0);
        }
    }).catch(err => {
        console.error("❌ Error loading sequence assets:", err);
    });
}

function loadSequenceReal(folderName) {
    const dataPath = `sequences/${folderName}`;

    const video = document.getElementById('rgbVideoReal');
    if (video) {
        video.src = `${dataPath}/rgb_video.mp4`;
        video.play().catch(() => {});
    }

    if (staticLeftMeshReal && vpHandsReal) vpHandsReal.scene.remove(staticLeftMeshReal);
    if (staticRightMeshReal && vpHandsReal) vpHandsReal.scene.remove(staticRightMeshReal);
    if (staticObjMeshReal && vpObjReal) vpObjReal.scene.remove(staticObjMeshReal);

    if (combLeftMeshReal && vpCombinedReal) vpCombinedReal.scene.remove(combLeftMeshReal);
    if (combRightMeshReal && vpCombinedReal) vpCombinedReal.scene.remove(combRightMeshReal);
    if (combObjMeshReal && vpCombinedReal) vpCombinedReal.scene.remove(combObjMeshReal);

    cameraInitializedReal = false;
    fallbackFrameCounterReal = 0;

    Promise.all([
        fetch(`${dataPath}/motion_sequence.json?v=${Date.now()}`).then(r => r.json()),
        fetch(`${dataPath}/faces_hand_left.json`).then(r => r.json()),
        fetch(`${dataPath}/faces_hand_right.json`).then(r => r.json()),
        fetch(`${dataPath}/faces_obj.json`).then(r => r.json())
    ]).then(([data, facesL, facesR, facesO]) => {
        sequenceDataReal = data;
        const firstFrame = sequenceDataReal.frames[0];
        const scale = sequenceDataReal.scale || 1000.0;
        const staticVerts = sequenceDataReal.static_verts;

        const numStaticVertsL = staticVerts.v_l.length / 3;
        const numStaticVertsR = staticVerts.v_r.length / 3;

        staticLeftMeshReal = createDynamicMesh(facesL, numStaticVertsL);
        updateMeshPositions(staticLeftMeshReal, staticVerts.v_l, scale);
        if (vpHandsReal) vpHandsReal.scene.add(staticLeftMeshReal);

        staticRightMeshReal = createDynamicMesh(facesR, numStaticVertsR);
        updateMeshPositions(staticRightMeshReal, staticVerts.v_r, scale);
        if (vpHandsReal) vpHandsReal.scene.add(staticRightMeshReal);

        const numStaticVertsO = staticVerts.v_o.length / 3;
        staticObjMeshReal = createDynamicMesh(facesO, numStaticVertsO);
        updateMeshPositions(staticObjMeshReal, staticVerts.v_o, scale);
        if (vpObjReal) vpObjReal.scene.add(staticObjMeshReal);

        const numDynamicVertsL = firstFrame.v_l.length / 3;
        const numDynamicVertsR = firstFrame.v_r.length / 3;
        const numDynamicVertsO = firstFrame.v_o.length / 3;

        combLeftMeshReal = createDynamicMesh(facesL, numDynamicVertsL);
        combRightMeshReal = createDynamicMesh(facesR, numDynamicVertsR);
        combObjMeshReal = createDynamicMesh(facesO, numDynamicVertsO);

        updateMeshPositions(combLeftMeshReal, firstFrame.v_l, scale);
        updateMeshPositions(combRightMeshReal, firstFrame.v_r, scale);
        updateMeshPositions(combObjMeshReal, firstFrame.v_o, scale);

        if (vpCombinedReal) {
            vpCombinedReal.scene.add(combLeftMeshReal);
            vpCombinedReal.scene.add(combRightMeshReal);
            vpCombinedReal.scene.add(combObjMeshReal);
        }

        if (vpHandsReal) frameMeshes([staticLeftMeshReal, staticRightMeshReal], vpHandsReal.camera, controlsHandsReal);
        if (vpObjReal) frameMeshes([staticObjMeshReal], vpObjReal.camera, controlsObjReal);
        if (vpCombinedReal) alignCameraToEgoView([combLeftMeshReal, combRightMeshReal, combObjMeshReal], vpCombinedReal.camera, controlsCombinedReal);
        cameraInitializedReal = true;

        if (!isLoopRunningReal) {
            isLoopRunningReal = true;
            animateReal(0);
        }
    }).catch(err => {
        console.error("❌ Error loading real-world sequence assets:", err);
    });
}

// ------------------------------------------
// 5. Animation Render Loop
// ------------------------------------------
function animate(currentTime) {
    requestAnimationFrame(animate);

    const video = document.getElementById('rgbVideo');

    if (sequenceData && sequenceData.frames.length > 0) {
        let currentFrameIdx = 0;

        if (video) {
            currentFrameIdx = Math.min(
                Math.floor(video.currentTime * FPS),
                sequenceData.frames.length - 1
            );
        } else {
            if (currentTime - lastTime > (1000 / FPS)) {
                fallbackFrameCounter = (fallbackFrameCounter + 1) % sequenceData.frames.length;
                lastTime = currentTime;
            }
            currentFrameIdx = fallbackFrameCounter;
        }

        const frameData = sequenceData.frames[currentFrameIdx];

        if (frameData) {
            const isForceMode = sequenceData.contact_type === 'force_mag' || frameData.f_l !== undefined;

            const dataL = isForceMode ? frameData.f_l : frameData.c_l;
            const dataR = isForceMode ? frameData.f_r : frameData.c_r;
            const dataO = isForceMode ? frameData.f_o : frameData.c_o;

            const scale = sequenceData.scale || 1000.0;
            const staticVerts = sequenceData.static_verts;

            updateMeshColors(staticLeftMesh, dataL, staticVerts.v_l.length / 3, isForceMode);
            updateMeshColors(staticRightMesh, dataR, staticVerts.v_r.length / 3, isForceMode);
            updateMeshColors(staticObjMesh, dataO, staticVerts.v_o.length / 3, isForceMode);

            updateMeshPositions(combLeftMesh, frameData.v_l, scale);
            updateMeshColors(combLeftMesh, dataL, frameData.v_l.length / 3, isForceMode);

            updateMeshPositions(combRightMesh, frameData.v_r, scale);
            updateMeshColors(combRightMesh, dataR, frameData.v_r.length / 3, isForceMode);

            updateMeshPositions(combObjMesh, frameData.v_o, scale);
            updateMeshColors(combObjMesh, dataO, frameData.v_o.length / 3, isForceMode);

            if (!cameraInitialized) {
                if (vpHands) frameMeshes([staticLeftMesh, staticRightMesh], vpHands.camera, controlsHands);
                if (vpObj) frameMeshes([staticObjMesh], vpObj.camera, controlsObj);
                if (vpCombined) alignCameraToEgoView([combLeftMesh, combRightMesh, combObjMesh], vpCombined.camera, controlsCombined);
                cameraInitialized = true;
            }
        }
    }

    if (controlsHands) controlsHands.update();
    if (controlsObj) controlsObj.update();
    if (controlsCombined) controlsCombined.update();

    if (vpHands) vpHands.renderer.render(vpHands.scene, vpHands.camera);
    if (vpObj) vpObj.renderer.render(vpObj.scene, vpObj.camera);
    if (vpCombined) vpCombined.renderer.render(vpCombined.scene, vpCombined.camera);
}

function animateReal(currentTime) {
    requestAnimationFrame(animateReal);

    const video = document.getElementById('rgbVideoReal');

    if (sequenceDataReal && sequenceDataReal.frames.length > 0) {
        let currentFrameIdx = 0;

        if (video) {
            currentFrameIdx = Math.min(
                Math.floor(video.currentTime * FPS_REAL),
                sequenceDataReal.frames.length - 1
            );
        } else {
            if (currentTime - lastTimeReal > (1000 / FPS_REAL)) {
                fallbackFrameCounterReal = (fallbackFrameCounterReal + 1) % sequenceDataReal.frames.length;
                lastTimeReal = currentTime;
            }
            currentFrameIdx = fallbackFrameCounterReal;
        }

        const frameData = sequenceDataReal.frames[currentFrameIdx];

        if (frameData) {
            const isForceMode = sequenceDataReal.contact_type === 'force_mag' || frameData.f_l !== undefined;

            const dataL = isForceMode ? frameData.f_l : frameData.c_l;
            const dataR = isForceMode ? frameData.f_r : frameData.c_r;
            const dataO = isForceMode ? frameData.f_o : frameData.c_o;

            const scale = sequenceDataReal.scale || 1000.0;
            const staticVerts = sequenceDataReal.static_verts;

            updateMeshColors(staticLeftMeshReal, dataL, staticVerts.v_l.length / 3, isForceMode);
            updateMeshColors(staticRightMeshReal, dataR, staticVerts.v_r.length / 3, isForceMode);
            updateMeshColors(staticObjMeshReal, dataO, staticVerts.v_o.length / 3, isForceMode);

            updateMeshPositions(combLeftMeshReal, frameData.v_l, scale);
            updateMeshColors(combLeftMeshReal, dataL, frameData.v_l.length / 3, isForceMode);

            updateMeshPositions(combRightMeshReal, frameData.v_r, scale);
            updateMeshColors(combRightMeshReal, dataR, frameData.v_r.length / 3, isForceMode);

            updateMeshPositions(combObjMeshReal, frameData.v_o, scale);
            updateMeshColors(combObjMeshReal, dataO, frameData.v_o.length / 3, isForceMode);

            if (!cameraInitializedReal) {
                if (vpHandsReal) frameMeshes([staticLeftMeshReal, staticRightMeshReal], vpHandsReal.camera, controlsHandsReal);
                if (vpObjReal) frameMeshes([staticObjMeshReal], vpObjReal.camera, controlsObjReal);
                if (vpCombinedReal) alignCameraToEgoView([combLeftMeshReal, combRightMeshReal, combObjMeshReal], vpCombinedReal.camera, controlsCombinedReal);
                cameraInitializedReal = true;
            }
        }
    }

    if (controlsHandsReal) controlsHandsReal.update();
    if (controlsObjReal) controlsObjReal.update();
    if (controlsCombinedReal) controlsCombinedReal.update();

    if (vpHandsReal) vpHandsReal.renderer.render(vpHandsReal.scene, vpHandsReal.camera);
    if (vpObjReal) vpObjReal.renderer.render(vpObjReal.scene, vpObjReal.camera);
    if (vpCombinedReal) vpCombinedReal.renderer.render(vpCombinedReal.scene, vpCombinedReal.camera);
}

// ------------------------------------------
// 6. Initialization & Event Handlers
// ------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    // Initial sequence load (ARCTIC)
    loadSequence('scissors_use_02');

    // Initial sequence load (Real-World)
    loadSequenceReal('realworld_cube');

    // Click handlers for sequence gallery thumbnails (ARCTIC)
    const thumbnails = document.querySelectorAll('.seq-thumb:not(.seq-thumb-real)');
    thumbnails.forEach(thumb => {
        thumb.addEventListener('click', () => {
            const sequenceFolder = thumb.getAttribute('data-sequence');

            thumbnails.forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');

            loadSequence(sequenceFolder);
        });
    });

    // Click handlers for real-world sequence thumbnails
    const thumbnailsReal = document.querySelectorAll('.seq-thumb-real');
    thumbnailsReal.forEach(thumb => {
        thumb.addEventListener('click', () => {
            const sequenceFolder = thumb.getAttribute('data-sequence');

            thumbnailsReal.forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');

            loadSequenceReal(sequenceFolder);
        });
    });
});

// Responsive resize
window.addEventListener('resize', () => {
    [vpHands, vpObj, vpCombined, vpHandsReal, vpObjReal, vpCombinedReal].forEach(vp => {
        if (vp && vp.container) {
            vp.camera.aspect = vp.container.clientWidth / 360;
            vp.camera.updateProjectionMatrix();
            vp.renderer.setSize(vp.container.clientWidth, 360);
        }
    });
});
