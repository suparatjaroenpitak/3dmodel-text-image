import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { meshStatistics, validateGlb } from './model-files.js';

export function createViewer(container, onError) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.domElement.setAttribute('aria-label', 'พื้นที่ดูโมเดล 3D ลากเพื่อหมุน เลื่อนล้อเมาส์เพื่อซูม');
  renderer.domElement.setAttribute('role', 'img');
  container.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 0.5;
  controls.maxDistance = 12;
  controls.autoRotateSpeed = 0.9;
  scene.add(new THREE.HemisphereLight(0xdce9ff, 0x252231, 3));
  const key = new THREE.DirectionalLight(0xffe6d2, 4.8);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88c6ff, 3.8);
  rim.position.set(-4, 2, -2);
  scene.add(rim);
  const grid = new THREE.GridHelper(12, 36, 0x424657, 0x272b35);
  grid.material.transparent = true;
  grid.material.opacity = 0.45;
  scene.add(grid);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.08, 64), new THREE.MeshStandardMaterial({ color: 0x262b35, metalness: 0.45, roughness: 0.6 }));
  stand.position.y = -0.045;
  scene.add(stand);
  let object = null;
  let wireframe = false;
  let neutral = false;
  let currentMaterials = [];
  const clay = new THREE.MeshStandardMaterial({ color: 0xc0b5a8, roughness: 0.75, metalness: 0.08 });

  function disposeObject(target) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    target.traverse(child => {
      if (child.geometry) geometries.add(child.geometry);
      for (const material of Array.isArray(child.material) ? child.material : child.material ? [child.material] : []) {
        if (material === clay) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
  }

  function resetCamera() {
    camera.position.set(3.1, 2.1, 4.4);
    controls.target.set(0, 1.1, 0);
    controls.update();
  }

  function setObject(next) {
    const stats = meshStatistics(next);
    if (!stats.triangles || stats.triangles > 2_000_000) {
      disposeObject(next);
      throw new Error('โมเดลว่างเปล่าหรือมีมากกว่า 2 ล้านสามเหลี่ยม');
    }
    let valid = true;
    next.traverse(child => {
      const values = child.geometry?.attributes.position?.array;
      if (values) for (const value of values) if (!Number.isFinite(value)) { valid = false; break; }
    });
    const bounds = new THREE.Box3().setFromObject(next);
    const size = bounds.getSize(new THREE.Vector3());
    if (!valid || !Number.isFinite(size.length()) || size.length() === 0) {
      disposeObject(next);
      throw new Error('โมเดลมีพิกัดไม่ถูกต้อง');
    }
    if (object) {
      // Restore original materials before disposing so imported textures are freed.
      currentMaterials.forEach(({ child, material }) => { child.material = material; });
      scene.remove(object);
      disposeObject(object);
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 2.3 / Math.max(size.x, size.y, size.z);
    const group = new THREE.Group();
    group.add(next);
    next.position.sub(center);
    group.scale.setScalar(scale);
    group.position.y = size.y * scale / 2 + 0.03;
    object = group;
    currentMaterials = [];
    object.traverse(child => {
      if (child.isMesh) {
        if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
        currentMaterials.push({ child, material: child.material });
      }
    });
    scene.add(object);
    applyMaterial();
    resetCamera();
    return stats;
  }

  function applyMaterial() {
    clay.wireframe = wireframe;
    currentMaterials.forEach(({ child, material }) => {
      child.material = neutral ? clay : material;
      for (const item of Array.isArray(child.material) ? child.material : [child.material]) {
        item.wireframe = wireframe;
        item.needsUpdate = true;
      }
    });
  }

  function sample() {
    const fox = new THREE.Group();
    const orange = new THREE.MeshStandardMaterial({ color: 0xc57b45, roughness: 0.78, flatShading: true });
    const cream = new THREE.MeshStandardMaterial({ color: 0xddd4bf, roughness: 0.9, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x302b2d, roughness: 0.75 });
    function part(geometry, material, position, scale = [1, 1, 1], rotation = [0, 0, 0]) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.scale.set(...scale);
      mesh.rotation.set(...rotation);
      fox.add(mesh);
      return mesh;
    }
    part(new THREE.IcosahedronGeometry(0.72, 1), orange, [0, 0.82, 0], [0.8, 1.1, 0.74]);
    part(new THREE.IcosahedronGeometry(0.5, 1), cream, [0, 0.92, 0.35], [0.67, 0.95, 0.38]);
    part(new THREE.IcosahedronGeometry(0.6, 1), orange, [0, 1.68, 0.1], [1, 0.85, 0.82]);
    for (const side of [-1, 1]) {
      part(new THREE.ConeGeometry(0.25, 0.73, 3), orange, [side * 0.39, 2.15, 0.06], [1, 1, 0.65], [0, side * 0.25, side * -0.18]);
      part(new THREE.ConeGeometry(0.14, 0.45, 3), cream, [side * 0.39, 2.15, 0.155], [1, 1, 0.4], [0, 0, side * -0.18]);
      part(new THREE.IcosahedronGeometry(0.28, 0), cream, [side * 0.22, 1.5, 0.49], [1.1, 0.6, 0.6]);
      part(new THREE.SphereGeometry(0.052, 12, 8), dark, [side * 0.23, 1.74, 0.53]);
      part(new THREE.IcosahedronGeometry(0.21, 0), dark, [side * 0.26, 0.13, 0.3], [0.8, 0.65, 1.45]);
    }
    part(new THREE.IcosahedronGeometry(0.09, 0), dark, [0, 1.52, 0.7], [1.2, 0.8, 0.8]);
    part(new THREE.ConeGeometry(0.35, 1.25, 7), orange, [0.66, 0.47, -0.12], [1, 1, 1], [0, 0, -0.95]);
    part(new THREE.ConeGeometry(0.23, 0.48, 7), cream, [1.1, 0.78, -0.12], [1, 1, 1], [0, 0, -0.95]);
    return setObject(fox);
  }

  async function load(buffer, ext) {
    let next;
    if (ext === 'glb') {
      validateGlb(buffer);
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(url => {
        if (url.startsWith('data:') || url.startsWith('blob:')) return url;
        throw new Error('ไม่อนุญาตให้โหลดทรัพยากรภายนอก');
      });
      next = (await new GLTFLoader(manager).parseAsync(buffer, '')).scene;
    } else if (ext === 'obj') {
      next = new OBJLoader().parse(new TextDecoder().decode(buffer));
    } else {
      next = new THREE.Mesh(new STLLoader().parse(buffer), new THREE.MeshStandardMaterial({ color: 0xbfc1c9, roughness: 0.72 }));
    }
    return setObject(next);
  }

  async function exportModel(format) {
    if (!object) throw new Error('ยังไม่มีโมเดลให้ส่งออก');
    object.updateMatrixWorld(true);
    if (format === 'glb') return new Uint8Array(await new GLTFExporter().parseAsync(object, { binary: true }));
    if (format === 'obj') return new TextEncoder().encode(new OBJExporter().parse(object));
    return new Uint8Array(new STLExporter().parse(object, { binary: true }).buffer);
  }

  const resize = new ResizeObserver(() => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  resize.observe(container);
  const visibility = () => {
    renderer.setAnimationLoop(document.hidden ? null : render);
  };
  function render() { controls.update(); renderer.render(scene, camera); }
  document.addEventListener('visibilitychange', visibility);
  renderer.setAnimationLoop(render);
  const contextLost = event => { event.preventDefault(); onError('WebGL หยุดทำงาน กรุณาโหลดหน้าใหม่'); };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  resetCamera();
  return {
    sample, load, exportModel, resetCamera,
    setWireframe(value) { wireframe = value; applyMaterial(); },
    setNeutral(value) { neutral = value; applyMaterial(); },
    setRotate(value) { controls.autoRotate = value; },
    setGrid(value) { grid.visible = value; stand.visible = value; },
    dispose() {
      resize.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.setAnimationLoop(null);
      controls.dispose();
      currentMaterials.forEach(({ child, material }) => { child.material = material; });
      if (object) disposeObject(object);
      grid.geometry.dispose(); grid.material.dispose();
      stand.geometry.dispose(); stand.material.dispose(); clay.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
