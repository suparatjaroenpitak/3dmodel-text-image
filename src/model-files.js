export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_MODEL_BYTES = 50 * 1024 * 1024;
export const MODEL_EXTENSIONS = ['glb', 'obj', 'stl'];

export function extension(name) {
  return String(name).split('.').pop().toLowerCase();
}

export function validateInput(file, kind) {
  const ext = extension(file.name);
  const allowed = kind === 'image' ? ['png', 'jpg', 'jpeg', 'webp'] : MODEL_EXTENSIONS;
  const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_MODEL_BYTES;
  if (!allowed.includes(ext)) throw new Error(kind === 'image' ? 'รองรับรูป PNG, JPG และ WebP เท่านั้น' : 'รองรับโมเดล GLB, OBJ และ STL เท่านั้น');
  if (!file.size) throw new Error('ไฟล์นี้ว่างเปล่า');
  if (file.size > limit) throw new Error(`ไฟล์ต้องมีขนาดไม่เกิน ${limit / 1024 / 1024} MB`);
  return ext;
}

export function validateGlb(buffer) {
  if (buffer.byteLength < 20) throw new Error('ไฟล์ GLB ไม่สมบูรณ์');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
    throw new Error('ไฟล์นี้ไม่ใช่ GLB 2.0 ที่สมบูรณ์');
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > buffer.byteLength) throw new Error('ข้อมูล GLB ไม่ถูกต้อง');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  // A local preview must not fetch URLs, local files, or resources beside the model.
  for (const resource of [...(json.buffers || []), ...(json.images || [])]) {
    if (resource.uri && !resource.uri.startsWith('data:')) throw new Error('นำเข้าได้เฉพาะ GLB ที่ฝังข้อมูลทั้งหมดในไฟล์ ไม่โหลดไฟล์หรือ URL ภายนอก');
  }
  return json;
}

export function meshStatistics(object) {
  let vertices = 0;
  let triangles = 0;
  object.traverse(child => {
    if (!child.isMesh) return;
    const geometry = child.geometry;
    vertices += geometry.attributes.position?.count || 0;
    triangles += (geometry.index?.count || geometry.attributes.position?.count || 0) / 3;
  });
  return { vertices, triangles: Math.floor(triangles) };
}
