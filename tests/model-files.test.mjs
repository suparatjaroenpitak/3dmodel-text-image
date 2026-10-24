import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInput, validateGlb, meshStatistics } from '../src/model-files.js';

function glb(json) {
  const text = JSON.stringify(json);
  const bytes = new TextEncoder().encode(text + ' '.repeat((4 - text.length % 4) % 4));
  const buffer = new ArrayBuffer(20 + bytes.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, bytes.byteLength, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20).set(bytes);
  return buffer;
}

test('allow only image/model formats within their byte limits', () => {
  assert.equal(validateInput({ name: 'FOX.GLB', size: 400 }, 'model'), 'glb');
  assert.equal(validateInput({ name: 'cutout.PNG', size: 200 }, 'image'), 'png');
  assert.throws(() => validateInput({ name: 'script.svg', size: 200 }, 'image'), /PNG/);
  assert.throws(() => validateInput({ name: 'scene.gltf', size: 200 }, 'model'), /GLB/);
  assert.throws(() => validateInput({ name: 'empty.stl', size: 0 }, 'model'), /ว่างเปล่า/);
  assert.throws(() => validateInput({ name: 'large.glb', size: 51 * 1024 ** 2 }, 'model'), /50 MB/);
});

test('embedded GLB metadata is accepted', () => {
  const data = validateGlb(glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 64 }], images: [{ uri: 'data:image/png;base64,AA==' }] }));
  assert.equal(data.asset.version, '2.0');
});

test('reject remote and relative dependencies before GLTFLoader sees them', () => {
  for (const uri of ['https://example.com/file.bin', 'texture.png', 'file:///private/file', '//example.com/file']) {
    assert.throws(() => validateGlb(glb({ buffers: [{ uri }] })), /ภายนอก/);
    assert.throws(() => validateGlb(glb({ images: [{ uri }] })), /ภายนอก/);
  }
});

test('reject malformed GLB headers and truncated JSON', () => {
  assert.throws(() => validateGlb(new ArrayBuffer(8)), /ไม่สมบูรณ์/);
  const buffer = glb({ asset: { version: '2.0' } });
  new DataView(buffer).setUint32(8, 5000, true);
  assert.throws(() => validateGlb(buffer), /GLB 2.0/);
});

test('count indexed and non-indexed mesh statistics', () => {
  const object = { traverse(callback) {
    callback({ isMesh: true, geometry: { attributes: { position: { count: 24 } }, index: { count: 36 } } });
    callback({ isMesh: true, geometry: { attributes: { position: { count: 9 } } } });
    callback({ isMesh: false });
  } };
  assert.deepEqual(meshStatistics(object), { vertices: 33, triangles: 15 });
});
