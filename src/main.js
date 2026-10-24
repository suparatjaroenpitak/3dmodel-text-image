import './style.css';
import { createViewer } from './viewer.js';
import { validateInput, extension } from './model-files.js';

const icon = (name, size = 20) => {
  const paths = {
    cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.2l8 4.5"/>',
    sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5L20 2Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
    text: '<path d="M4 5h16M12 5v15M8 20h8M4 5v3M20 5v3"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    rotate: '<path d="M4 8a9 9 0 0 1 15-2l2 2m0-5v5h-5M20 16a9 9 0 0 1-15 2l-2-2m0 5v-5h5"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    wire: '<path d="m12 3 9 16H3L12 3Zm0 0v16M3 19l13.5-8M21 19 7.5 11"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    folder: '<path d="M3 7V5h7l2 2h9v13H3V7Z"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cube}</svg>`;
};

const state = { mode: 'text', imageUrl: null, imageFile: null, modelName: 'Fox · Studio sample', source: 'sample', busy: false, viewer: null, status: null };
const desktop = Boolean(window.studio?.diagnose);

document.querySelector('#app').innerHTML = `
  <aside class="rail" aria-label="เมนูหลัก">
    <div class="brand-mark" title="Hunyuan Studio">${icon('cube', 25)}</div>
    <button class="rail-button active" id="studio-nav" aria-label="พื้นที่สร้างโมเดล" title="พื้นที่สร้างโมเดล">${icon('sparkle', 22)}</button>
    <button class="rail-button" id="rail-import" aria-label="นำเข้าโมเดล" title="นำเข้าโมเดล">${icon('folder', 22)}</button>
    <div class="rail-spacer"></div>
    <button class="rail-button" id="rail-system" aria-label="สถานะระบบ" title="สถานะระบบ">${icon('chip', 22)}</button>
    <div class="rail-avatar" title="Local workspace">L</div>
  </aside>
  <div class="app-shell">
    <header class="topbar">
      <div class="wordmark">HUNYUAN<span>STUDIO</span><span class="version">LOCAL · 0.1</span></div>
      <div class="top-actions"><span class="local-label"><i></i> บนเครื่องของคุณ</span><button class="button subtle compact" id="open-system">${icon('chip', 16)} สถานะระบบ</button></div>
    </header>
    <main>
      <div class="page-heading"><div><div class="eyebrow">YOUR IDEAS, ANOTHER DIMENSION</div><h1>เปลี่ยนไอเดีย ให้มีมิติ<span>.</span></h1><p>จากข้อความหรือรูปภาพ สู่พื้นที่สร้างสรรค์สามมิติของคุณ</p></div><span class="workspace-label">${icon('folder', 15)} Untitled workspace</span></div>
      <div class="workspace">
        <section class="input-panel panel" aria-labelledby="input-title">
          <div class="panel-heading"><span class="step-number">01</span><h2 id="input-title">เริ่มต้นจากไอเดีย</h2><span class="small-label">INPUT</span></div>
          <div class="mode-tabs" role="tablist" aria-label="ชนิดข้อมูลตั้งต้น">
            <button id="text-tab" class="mode-tab active" role="tab" aria-selected="true" aria-controls="text-panel">${icon('text', 17)} ข้อความ</button>
            <button id="image-tab" class="mode-tab" role="tab" aria-selected="false" aria-controls="image-panel" tabindex="-1">${icon('image', 17)} รูปภาพ</button>
          </div>
          <div id="text-panel" role="tabpanel" aria-labelledby="text-tab">
            <label class="field-label" for="prompt">อธิบายสิ่งที่อยากสร้าง <span>English recommended</span></label>
            <div class="prompt-wrap"><textarea id="prompt" maxlength="1000" placeholder="A small orange ceramic fox figurine, full object, isolated on a plain white background..."></textarea><div class="prompt-bottom"><span>${icon('sparkle', 13)} เริ่มจากวัตถุชิ้นเดียว</span><span id="char-count">0 / 1,000</span></div></div>
            <div class="example-row"><span>ลองไอเดีย</span><button class="example-chip" data-example="fox">ฟิกเกอร์จิ้งจอก</button><button class="example-chip" data-example="vase">แจกันเซรามิก</button></div>
            <p class="input-note">${icon('info', 14)} SD-Turbo สร้างภาพก่อนส่งให้ Hunyuan3D · ยังไม่ยืนยันคุณภาพภาษาไทย</p>
          </div>
          <div id="image-panel" role="tabpanel" aria-labelledby="image-tab" hidden>
            <label class="field-label" for="image-input">ภาพวัตถุตั้งต้น <span>PNG · JPG · WebP</span></label>
            <label class="drop-zone" id="image-drop" tabindex="0" role="button" aria-label="เลือกรูปภาพหรือลากรูปมาวาง">
              <input type="file" id="image-input" accept=".png,.jpg,.jpeg,.webp" hidden>
              <span class="upload-symbol">${icon('upload', 25)}</span><strong>วางรูปภาพของคุณที่นี่</strong><span>หรือคลิกเพื่อเลือกไฟล์</span><small>ไม่เกิน 20 MB · แนะนำ PNG พื้นหลังโปร่งใส</small>
            </label>
            <div class="image-preview" id="image-preview" hidden><img id="input-preview" alt="ภาพตั้งต้นที่เลือก"><div><strong id="image-name"></strong><span id="image-size"></span></div><button class="icon-button" id="remove-image" aria-label="ลบภาพที่เลือก">${icon('close', 16)}</button></div>
            <p class="input-note">${icon('info', 14)} ใช้ภาพวัตถุเดี่ยว มุมมองชัดเจน · ยังไม่มีระบบลบพื้นหลังอัตโนมัติ</p>
          </div>
          <div class="divider"></div>
          <div class="section-label">${icon('settings', 16)} การตั้งค่าสำหรับทดสอบ <span class="tag">SHAPE ONLY</span></div>
          <div class="model-choice"><span class="model-icon">${icon('cube', 22)}</span><div><strong>Hunyuan3D-2mini</strong><span>โมเดลรูปทรง · FP16 · บนเครื่อง</span></div><span class="model-dot"></span></div>
          <div class="settings-grid"><div><span>Inference steps</span><strong>8 <small>steps</small></strong></div><div><span>Mesh resolution</span><strong>128 <small>coarse</small></strong></div></div>
          <div class="pipeline"><span id="pipeline-start">ข้อความ</span>${icon('chevron', 12)}<span id="pipeline-middle">SD-Turbo</span>${icon('chevron', 12)}<span>2mini</span>${icon('chevron', 12)}<strong>3D</strong></div>
          <div class="generate-area"><button class="button generate" id="generate" disabled>${icon('sparkle', 20)} สร้างโมเดล 3D <span>${icon('arrow', 19)}</span></button><p id="generation-note">ยังไม่เปิดใช้งาน — รอทดสอบ AI และเชื่อมระบบสร้างจริง</p></div>
          <div class="privacy-note">${icon('check', 13)} การเลือกไฟล์ในหน้านี้ไม่อัปโหลดข้อมูลออกจากเครื่อง</div>
        </section>
        <section class="viewer-panel panel" aria-labelledby="viewer-title">
          <div class="viewer-header"><div><span class="step-number">02</span><h2 id="viewer-title">พื้นที่โมเดล 3D</h2><span class="beta-tag">LIVE VIEW</span></div><button class="button subtle compact" id="import-model">${icon('upload', 15)} นำเข้าโมเดล</button></div>
          <div class="viewport" id="viewport">
            <div class="viewport-top"><span class="source-badge" id="source-badge"><i></i> ตัวอย่างหน้าจอ · ไม่ใช่ผล AI</span><span class="view-label">PERSPECTIVE</span></div>
            <div id="canvas-container"></div>
            <div class="viewer-unavailable" id="viewer-unavailable" hidden><strong>ไม่สามารถเปิดพื้นที่ 3D ได้</strong><p id="viewer-error"></p></div>
            <div class="viewport-tools" role="group" aria-label="เครื่องมือดูโมเดล">
              <button class="tool-button" id="reset-camera" aria-label="รีเซ็ตมุมมอง" title="รีเซ็ตมุมมอง">${icon('reset', 19)}</button><span></span>
              <button class="tool-button" id="wireframe" aria-label="แสดงโครงตาข่าย" title="โครงตาข่าย" aria-pressed="false">${icon('wire', 19)}</button>
              <button class="tool-button" id="auto-rotate" aria-label="หมุนอัตโนมัติ" title="หมุนอัตโนมัติ" aria-pressed="false">${icon('rotate', 19)}</button>
              <button class="tool-button selected" id="toggle-grid" aria-label="แสดงกริด" title="กริด" aria-pressed="true">${icon('grid', 19)}</button>
            </div>
            <div class="viewport-bottom"><span><i class="mouse-icon"></i> ลากเพื่อหมุน <b>·</b> เลื่อนเพื่อซูม <b>·</b> คลิกขวาเพื่อลาก</span><span class="axis-legend"><i>X</i><i>Y</i><i>Z</i></span></div>
          </div>
          <div class="model-info"><div class="model-title"><span class="file-icon">${icon('cube', 22)}</span><div><h3 id="model-name">Fox · Studio sample</h3><p id="model-description">โมเดลตัวอย่างที่ประกอบด้วยเรขาคณิตสำหรับทดลองหน้าจอ</p></div></div><button class="text-button" id="load-sample">โหลดตัวอย่างใหม่</button></div>
          <div class="mesh-details"><div><span>VERTICES</span><strong id="vertex-count">—</strong></div><div><span>TRIANGLES</span><strong id="triangle-count">—</strong></div><div><span>MATERIAL</span><strong id="material-label">Sample colors</strong></div><div class="display-choice"><button id="clay-mode" aria-pressed="false">Clay view</button></div></div>
          <div class="export-row"><div><strong>นำผลงานไปต่อ</strong><span id="export-hint">ไฟล์ส่งออกจะมีชื่อ sample ไม่ใช่ผล AI</span></div><label class="sr-only" for="export-format">รูปแบบไฟล์ส่งออก</label><select id="export-format"><option value="glb">GLB</option><option value="obj">OBJ</option><option value="stl">STL</option></select><button class="button export" id="export-model">${icon('download', 17)} ส่งออก</button></div>
        </section>
      </div>
      <section class="runtime-strip" aria-label="สถานะการทำงาน"><div class="runtime-label">${icon('chip', 20)}<div><strong id="runtime-title">${desktop ? 'กำลังตรวจสถานะเครื่อง' : 'Browser preview'}</strong><span id="runtime-detail">${desktop ? 'อ่านข้อมูลจากระบบจริง' : 'ดูหน้าจอและจัดการไฟล์ได้ · ต้องเปิด Electron เพื่อตรวจ GPU และโมเดล'}</span></div></div><span class="runtime-status" id="runtime-status">${desktop ? 'กำลังตรวจสอบ' : 'AI ยังไม่เชื่อมต่อ'}</span><button class="text-button" id="runtime-more">รายละเอียด ${icon('arrow', 15)}</button></section>
      <footer><span>HUNYUAN STUDIO <b>/</b> LOCAL WORKSPACE</span><span>Shape first. Make it yours.</span></footer>
    </main>
  </div>
  <input type="file" id="model-input" accept=".glb,.obj,.stl" hidden>
  <dialog id="system-dialog"><div class="dialog-heading"><div><div class="eyebrow">LOCAL RUNTIME</div><h2>สถานะระบบ</h2></div><button class="icon-button" id="close-system" aria-label="ปิดสถานะระบบ">${icon('close', 21)}</button></div><div id="system-content"></div><div class="dialog-footer"><span id="status-time"></span><button class="button subtle compact" id="refresh-system">${icon('reset', 15)} ตรวจอีกครั้ง</button></div></dialog>
  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
`;

const $ = selector => document.querySelector(selector);
let toastTimer;
function toast(message, error = false) {
  const target = $('#toast');
  target.textContent = message;
  target.classList.toggle('error', error);
  target.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { target.hidden = true; }, 5500);
}

function switchMode(mode, focus = false) {
  state.mode = mode;
  for (const item of ['text', 'image']) {
    const selected = item === mode;
    $(`#${item}-tab`).classList.toggle('active', selected);
    $(`#${item}-tab`).setAttribute('aria-selected', String(selected));
    $(`#${item}-tab`).tabIndex = selected ? 0 : -1;
    $(`#${item}-panel`).hidden = !selected;
  }
  $('#pipeline-start').textContent = mode === 'text' ? 'ข้อความ' : 'รูปภาพ';
  $('#pipeline-middle').textContent = mode === 'text' ? 'SD-Turbo' : 'ภาพตั้งต้น';
  if (focus) $(`#${mode}-tab`).focus();
}
for (const mode of ['text', 'image']) {
  $(`#${mode}-tab`).addEventListener('click', () => switchMode(mode));
  $(`#${mode}-tab`).addEventListener('keydown', event => {
    if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      switchMode(event.key === 'Home' ? 'text' : event.key === 'End' ? 'image' : mode === 'text' ? 'image' : 'text', true);
    }
  });
}
const examples = {
  fox: 'A small orange ceramic fox figurine, full object, sitting pose, isolated on a plain white background, soft studio lighting, no text',
  vase: 'A simple teal ceramic vase, full object, rounded body and narrow neck, isolated on a plain white background, soft studio lighting, no text',
};
$('#prompt').addEventListener('input', () => { $('#char-count').textContent = `${$('#prompt').value.length.toLocaleString('en-US')} / 1,000`; });
for (const button of document.querySelectorAll('[data-example]')) button.addEventListener('click', () => {
  $('#prompt').value = examples[button.dataset.example];
  $('#prompt').dispatchEvent(new Event('input'));
  $('#prompt').focus();
});

let imageRequest = 0;
async function selectImage(file) {
  if (!file) return;
  const request = ++imageRequest;
  let url;
  try {
    validateInput(file, 'image');
    url = URL.createObjectURL(file);
    const probe = new Image();
    probe.src = url;
    await probe.decode();
    if (probe.naturalWidth * probe.naturalHeight > 40_000_000) throw new Error('รูปมีความละเอียดสูงเกิน 40 ล้านพิกเซล');
    if (request !== imageRequest) { URL.revokeObjectURL(url); return; }
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = url;
    state.imageFile = file;
    $('#input-preview').src = url;
    $('#image-name').textContent = file.name;
    $('#image-size').textContent = `${probe.naturalWidth} × ${probe.naturalHeight} · ${(file.size / 1024 / 1024).toFixed(2)} MB · ยังไม่ได้ส่งให้ AI`;
    $('#image-preview').hidden = false;
    $('#image-drop').classList.add('has-image');
    toast('เลือกรูปแล้ว · เก็บอยู่ในหน้านี้ ยังไม่ได้ประมวลผล AI');
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    toast(error.message || 'เปิดรูปไม่สำเร็จ', true);
  } finally { $('#image-input').value = ''; }
}
$('#image-input').addEventListener('change', event => selectImage(event.target.files[0]));
$('#image-drop').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('#image-input').click(); } });
for (const eventName of ['dragenter', 'dragover']) $('#image-drop').addEventListener(eventName, event => { event.preventDefault(); $('#image-drop').classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) $('#image-drop').addEventListener(eventName, event => { event.preventDefault(); $('#image-drop').classList.remove('dragging'); });
$('#image-drop').addEventListener('drop', event => selectImage(event.dataTransfer.files[0]));
$('#remove-image').addEventListener('click', () => {
  imageRequest++;
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.imageUrl = null; state.imageFile = null;
  $('#input-preview').removeAttribute('src');
  $('#image-preview').hidden = true;
  $('#image-drop').classList.remove('has-image');
});

function modelUpdated(stats, name, source) {
  state.modelName = name; state.source = source;
  $('#model-name').textContent = name;
  $('#vertex-count').textContent = stats.vertices.toLocaleString('en-US');
  $('#triangle-count').textContent = stats.triangles.toLocaleString('en-US');
  $('#source-badge').classList.toggle('imported', source === 'imported');
  $('#source-badge').innerHTML = `<i></i> ${source === 'sample' ? 'ตัวอย่างหน้าจอ · ไม่ใช่ผล AI' : 'ไฟล์ที่นำเข้า · ไม่ยืนยันแหล่งสร้าง'}`;
  $('#model-description').textContent = source === 'sample' ? 'โมเดลตัวอย่างที่ประกอบด้วยเรขาคณิตสำหรับทดลองหน้าจอ' : 'นำเข้าจากเครื่องของคุณ · ไม่ได้สร้างโดยแอปนี้';
  $('#export-hint').textContent = source === 'sample' ? 'ไฟล์ส่งออกจะมีชื่อ sample ไม่ใช่ผล AI' : 'ส่งออกสำเนาโมเดลที่แสดงในพื้นที่ดู';
}
try {
  state.viewer = createViewer($('#canvas-container'), message => toast(message, true));
  modelUpdated(state.viewer.sample(), state.modelName, 'sample');
} catch (error) {
  $('#viewer-unavailable').hidden = false;
  $('#viewer-error').textContent = `WebGL ไม่พร้อม: ${error.message}`;
  for (const id of ['export-model', 'import-model', 'load-sample', 'reset-camera', 'wireframe', 'auto-rotate', 'toggle-grid', 'clay-mode']) $(`#${id}`).disabled = true;
}
$('#load-sample').addEventListener('click', () => {
  if (!state.viewer || state.busy) return;
  try { modelUpdated(state.viewer.sample(), 'Fox · Studio sample', 'sample'); toast('โหลดโมเดลตัวอย่างแล้ว · ไม่ใช่ผล AI'); }
  catch (error) { toast(error.message, true); }
});
for (const id of ['import-model', 'rail-import']) $(`#${id}`).addEventListener('click', () => { if (state.viewer && !state.busy) $('#model-input').click(); });
$('#model-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file || !state.viewer || state.busy) return;
  state.busy = true;
  $('#import-model').disabled = true; $('#export-model').disabled = true;
  try {
    const ext = validateInput(file, 'model');
    const stats = await state.viewer.load(await file.arrayBuffer(), ext);
    modelUpdated(stats, file.name, 'imported');
    toast('นำเข้าโมเดลสำเร็จ');
  } catch (error) { toast(`นำเข้าไม่สำเร็จ: ${error.message}`, true); }
  finally { state.busy = false; $('#import-model').disabled = false; $('#export-model').disabled = false; event.target.value = ''; }
});
$('#reset-camera').addEventListener('click', () => state.viewer?.resetCamera());
for (const [id, method] of [['wireframe', 'setWireframe'], ['auto-rotate', 'setRotate'], ['toggle-grid', 'setGrid'], ['clay-mode', 'setNeutral']]) {
  $(`#${id}`).addEventListener('click', () => {
    const selected = $(`#${id}`).getAttribute('aria-pressed') !== 'true';
    $(`#${id}`).setAttribute('aria-pressed', String(selected));
    $(`#${id}`).classList.toggle('selected', selected);
    state.viewer?.[method](selected);
    if (id === 'clay-mode') $('#material-label').textContent = selected ? 'Neutral clay' : state.source === 'sample' ? 'Sample colors' : 'Original';
  });
}
$('#export-model').addEventListener('click', async () => {
  if (!state.viewer || state.busy) return;
  const format = $('#export-format').value;
  const name = state.source === 'sample' ? `studio-sample-fox.${format}` : `${state.modelName.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) || 'model'}-export.${format}`;
  state.busy = true; $('#export-model').disabled = true;
  try {
    const bytes = await state.viewer.exportModel(format);
    if (window.studio?.save) {
      const saved = await window.studio.save(name, bytes);
      toast(saved ? `ส่งออก ${name} สำเร็จ` : 'ยกเลิกการบันทึกแล้ว');
    } else {
      const url = URL.createObjectURL(new Blob([bytes], { type: format === 'glb' ? 'model/gltf-binary' : 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast(`ส่งออก ${name} แล้ว${state.source === 'sample' ? ' · โมเดลตัวอย่าง ไม่ใช่ผล AI' : ''}`);
    }
  } catch (error) { toast(`ส่งออกไม่สำเร็จ: ${error.message}`, true); }
  finally { state.busy = false; $('#export-model').disabled = false; }
});

function statusRow(label, value, kind = '') {
  const row = document.createElement('div'); row.className = 'status-row';
  const title = document.createElement('span'); title.textContent = label;
  const detail = document.createElement('strong'); detail.textContent = value; if (kind) detail.className = kind;
  row.append(title, detail); return row;
}
function renderSystem() {
  const content = $('#system-content'); content.replaceChildren();
  const notice = document.createElement('p'); notice.className = 'system-notice';
  notice.textContent = 'ส่วนสร้าง AI ยังไม่เชื่อมต่อหน้าจอ แม้ดาวน์โหลดครบ ปุ่มสร้างจะยังไม่เปิดจนกว่าทดสอบ inference จริงผ่านและเชื่อม backend แล้ว';
  content.append(notice);
  if (!desktop) {
    content.append(statusRow('โหมดปัจจุบัน', 'Browser preview'), statusRow('GPU / RAM / ดาวน์โหลด', 'อ่านไม่ได้ในเบราว์เซอร์', 'warning'), statusRow('ใช้งานได้แล้ว', 'ข้อความ · รูปภาพ · ดู/นำเข้า/ส่งออก 3D'));
    const note = document.createElement('p'); note.className = 'input-note'; note.textContent = 'เปิดแอปด้วย npm start เพื่อตรวจสถานะเครื่องจริง ไม่มี API ลับหรือข้อมูลจำลองในหน้านี้'; content.append(note);
    return;
  }
  const data = state.status;
  if (!data) { content.append(statusRow('สถานะ', 'ยังอ่านข้อมูลไม่สำเร็จ')); return; }
  content.append(statusRow('GPU', data.gpu || 'ตรวจไม่สำเร็จ'));
  content.append(statusRow('หน่วยความจำว่าง', data.hardware ? `RAM ${data.hardware.ram_free_gib ?? '—'} GiB · VRAM ${data.hardware.vram_free_mib ?? '—'} MiB (ล่าสุด)` : 'ยังไม่มีรายงาน'));
  content.append(statusRow('Python / CUDA', data.environmentReady ? 'ติดตั้งและตรวจนำเข้าโมดูลผ่านแล้ว' : 'ยังไม่ยืนยัน', data.environmentReady ? 'success' : 'warning'));
  for (const model of data.models || []) content.append(statusRow(model.name, model.complete ? 'ไฟล์ครบตามรายการ' : `${model.downloadedMiB.toLocaleString('en-US')} MiB บนดิสก์ · ยังไม่ครบ`, model.complete ? 'success' : 'warning'));
  content.append(statusRow('การดาวน์โหลด', data.downloadState));
  content.append(statusRow('AI inference', data.inferenceVerified ? 'มีรายงาน CLI ผ่าน · ยังไม่เชื่อม UI' : 'ยังไม่ผ่านการทดสอบจริง', 'warning'));
  if (data.error) content.append(statusRow('ข้อผิดพลาด', data.error, 'warning'));
  $('#status-time').textContent = `ตรวจเมื่อ ${new Date(data.checkedAt).toLocaleTimeString('th-TH')}`;
}
let checking = false;
async function refreshStatus() {
  if (!desktop || checking) { renderSystem(); return; }
  checking = true; $('#refresh-system').disabled = true;
  try {
    const data = await window.studio.diagnose(); state.status = data;
    $('#runtime-title').textContent = data.gpu || 'Local runtime';
    $('#runtime-detail').textContent = `${data.downloadState} · ${data.environmentReady ? 'Python / CUDA ตรวจผ่าน' : 'ยังไม่ยืนยัน Python / CUDA'}`;
    $('#runtime-status').textContent = 'ยังไม่เชื่อม AI กับหน้าจอ';
    renderSystem();
  } catch (error) { $('#runtime-detail').textContent = `ตรวจสถานะไม่สำเร็จ: ${error.message}`; toast('ตรวจระบบไม่สำเร็จ ลองอีกครั้ง', true); }
  finally { checking = false; $('#refresh-system').disabled = false; }
}
for (const id of ['open-system', 'rail-system', 'runtime-more']) $(`#${id}`).addEventListener('click', () => { renderSystem(); $('#system-dialog').showModal(); refreshStatus(); });
$('#close-system').addEventListener('click', () => $('#system-dialog').close());
$('#system-dialog').addEventListener('click', event => { if (event.target === $('#system-dialog')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close(); } });
$('#refresh-system').addEventListener('click', refreshStatus);
$('#studio-nav').addEventListener('click', () => { $('#input-title').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
renderSystem();
if (desktop) refreshStatus();
const statusInterval = desktop ? setInterval(() => { if (!document.hidden) refreshStatus(); }, 30_000) : null;
window.addEventListener('pagehide', () => { if (state.imageUrl) URL.revokeObjectURL(state.imageUrl); if (statusInterval) clearInterval(statusInterval); state.viewer?.dispose(); }, { once: true });
// Prevent Chromium/Electron from navigating away when a file is dropped outside a drop zone.
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
if (import.meta.hot) import.meta.hot.dispose(() => { clearInterval(statusInterval); clearTimeout(toastTimer); state.viewer?.dispose(); if (state.imageUrl) URL.revokeObjectURL(state.imageUrl); });
