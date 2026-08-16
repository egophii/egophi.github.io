// ==========================================
// Interactive WebGL Hand & Object Synchronizer
// ==========================================

const FPS = 30;

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
    JET_LUT[i * 3 + 0] = Math.min(Math.max(1.5 - Math.abs(v * 4.0 - 3.0), 0.0), 1.0); // Red
    JET_LUT[i * 3 + 1] = Math.min(Math.max(1.5 - Math.abs(v * 4.0 - 2.0), 0.0), 1.0); // Green
    JET_LUT[i * 3 + 2] = Math.min(Math.max(1.5 - Math.abs(v * 4.0 - 1.0), 0.0), 1.0); // Blue
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
const controlsHands = new THREE.OrbitControls(vpHands.camera, vpHands.renderer.domElement);
controlsHands.enableDamping = true;

const vpObj = createViewport('objectCanvasContainer');
const controlsObj = new THREE.OrbitControls(vpObj.camera, vpObj.renderer.domElement);
controlsObj.enableDamping = true;

const vpCombined = createViewport('combinedCanvasContainer');
const controlsCombined = new THREE.OrbitControls(vpCombined.camera, vpCombined.renderer.domElement);
controlsCombined.enableDamping = true;

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

    // Update main RGB video player
    const video = document.getElementById('rgbVideo');
    if (video) {
        video.src = `${dataPath}/rgb_video.mp4`;
        video.play().catch(() => {});
    }

    // Remove existing meshes from scenes
    if (staticLeftMesh) vpHands.scene.remove(staticLeftMesh);
    if (staticRightMesh) vpHands.scene.remove(staticRightMesh);
    if (staticObjMesh) vpObj.scene.remove(staticObjMesh);

    if (combLeftMesh) vpCombined.scene.remove(combLeftMesh);
    if (combRightMesh) vpCombined.scene.remove(combRightMesh);
    if (combObjMesh) vpCombined.scene.remove(combObjMesh);

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

        // --- FIELD 2: Static Palmar Hands ---
        const numStaticVertsL = staticVerts.v_l.length / 3;
        const numStaticVertsR = staticVerts.v_r.length / 3;

        staticLeftMesh = createDynamicMesh(facesL, numStaticVertsL);
        updateMeshPositions(staticLeftMesh, staticVerts.v_l, scale);
        vpHands.scene.add(staticLeftMesh);

        staticRightMesh = createDynamicMesh(facesR, numStaticVertsR);
        updateMeshPositions(staticRightMesh, staticVerts.v_r, scale);
        vpHands.scene.add(staticRightMesh);

        // --- FIELD 3: Static Centered GT Object ---
        const numStaticVertsO = staticVerts.v_o.length / 3;
        staticObjMesh = createDynamicMesh(facesO, numStaticVertsO);
        updateMeshPositions(staticObjMesh, staticVerts.v_o, scale);
        vpObj.scene.add(staticObjMesh);

        // --- FIELD 4: Combined Moving Viewport ---
        const numDynamicVertsL = firstFrame.v_l.length / 3;
        const numDynamicVertsR = firstFrame.v_r.length / 3;
        const numDynamicVertsO = firstFrame.v_o.length / 3;

        combLeftMesh = createDynamicMesh(facesL, numDynamicVertsL);
        combRightMesh = createDynamicMesh(facesR, numDynamicVertsR);
        combObjMesh = createDynamicMesh(facesO, numDynamicVertsO);

        vpCombined.scene.add(combLeftMesh);
        vpCombined.scene.add(combRightMesh);
        vpCombined.scene.add(combObjMesh);

        if (!isLoopRunning) {
            isLoopRunning = true;
            animate(0);
        }
    }).catch(err => {
        console.error("❌ Error loading sequence assets:", err);
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

        if (video && !video.paused && video.currentTime > 0) {
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

            // 1. Update colors on STATIC meshes
            updateMeshColors(staticLeftMesh, dataL, staticVerts.v_l.length / 3, isForceMode);
            updateMeshColors(staticRightMesh, dataR, staticVerts.v_r.length / 3, isForceMode);
            updateMeshColors(staticObjMesh, dataO, staticVerts.v_o.length / 3, isForceMode);

            // 2. Update positions AND colors on DYNAMIC meshes
            updateMeshPositions(combLeftMesh, frameData.v_l, scale);
            updateMeshColors(combLeftMesh, dataL, frameData.v_l.length / 3, isForceMode);

            updateMeshPositions(combRightMesh, frameData.v_r, scale);
            updateMeshColors(combRightMesh, dataR, frameData.v_r.length / 3, isForceMode);

            updateMeshPositions(combObjMesh, frameData.v_o, scale);
            updateMeshColors(combObjMesh, dataO, frameData.v_o.length / 3, isForceMode);

            // 3. Frame cameras on first frame of loaded sequence
            if (!cameraInitialized) {
                frameMeshes([staticLeftMesh, staticRightMesh], vpHands.camera, controlsHands);
                frameMeshes([staticObjMesh], vpObj.camera, controlsObj);
                alignCameraToEgoView([combLeftMesh, combRightMesh, combObjMesh], vpCombined.camera, controlsCombined);
                cameraInitialized = true;
            }
        }
    }

    controlsHands.update();
    controlsObj.update();
    controlsCombined.update();

    vpHands.renderer.render(vpHands.scene, vpHands.camera);
    vpObj.renderer.render(vpObj.scene, vpObj.camera);
    vpCombined.renderer.render(vpCombined.scene, vpCombined.camera);
}

// ------------------------------------------
// 6. Initialization & Event Handlers
// ------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    // Initial sequence load
    loadSequence('scissors_use_02');

    // Click handlers for sequence gallery thumbnails
    const thumbnails = document.querySelectorAll('.seq-thumb');
    thumbnails.forEach(thumb => {
        thumb.addEventListener('click', () => {
            const sequenceFolder = thumb.getAttribute('data-sequence');

            thumbnails.forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');

            loadSequence(sequenceFolder);
        });
    });
});

// Responsive resize
window.addEventListener('resize', () => {
    [vpHands, vpObj, vpCombined].forEach(vp => {
        if (vp && vp.container) {
            vp.camera.aspect = vp.container.clientWidth / 360;
            vp.camera.updateProjectionMatrix();
            vp.renderer.setSize(vp.container.clientWidth, 360);
        }
    });
});
