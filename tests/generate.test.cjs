const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createGeneration } = require('../desktop/generate.cjs');

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hunyuan-generate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const python = path.join(root, 'python.exe');
  await fs.writeFile(python, '');
  return { root, python };
}

function fakeGlb() {
  const bytes = Buffer.alloc(20);
  bytes.write('glTF', 0, 'ascii');
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(20, 8);
  return bytes;
}

function scriptedSpawn(steps) {
  const calls = [];
  let index = 0;
  function spawnImpl(command, args, options) {
    const step = steps[index++] || { code: 1 };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4000 + index;
    child.killed = false;
    child.kill = () => { child.killed = true; };
    calls.push({ command, args, options, child, step });
    if (!step.hang) {
      queueMicrotask(async () => {
        const reportPath = args[args.indexOf('--report') + 1];
        const output = args[args.indexOf('--output') + 1];
        if (step.report) await fs.writeFile(reportPath, JSON.stringify(step.report));
        if (step.output) await fs.writeFile(output, step.output);
        child.emit('close', step.code ?? (step.report?.ok ? 0 : 1));
      });
    }
    return child;
  }
  return { spawnImpl, calls };
}

test('rejects invalid input without starting Python', async t => {
  const { root, python } = await workspace(t);
  const { spawnImpl, calls } = scriptedSpawn([]);
  const generation = createGeneration({ root, python, spawnImpl });
  await assert.rejects(() => generation.start({ mode: 'text', prompt: '   ' }), /ข้อความ/);
  await assert.rejects(() => generation.start({ mode: 'image', imageName: 'x.svg', imageBytes: Buffer.from('a') }), /PNG/);
  await assert.rejects(() => generation.start({ mode: 'image', imageName: 'x.png', imageBytes: Buffer.alloc(0) }), /20 MB/);
  await assert.rejects(() => generation.start({ mode: 'shape', prompt: 'ignore' }), /ข้อความหรือรูปภาพ/);
  assert.equal(calls.length, 0);
});

test('text generation runs image creation to completion before shape, and only shape removes white', async t => {
  const { root, python } = await workspace(t);
  const { spawnImpl, calls } = scriptedSpawn([
    { report: { ok: true }, output: Buffer.from('png') },
    { report: { ok: true, validation: { faces: 12 }, mask_method: 'white_threshold_test_only' }, output: fakeGlb() },
  ]);
  const generation = createGeneration({ root, python, spawnImpl });
  const result = await generation.start({ mode: 'text', prompt: 'a fox & "figurine"' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].args[calls[0].args.indexOf('--prompt') + 1], 'a fox & "figurine"');
  assert.equal(calls[0].args.includes('--white-background'), false);
  assert.equal(calls[1].args[calls[1].args.indexOf('--report') + 2], 'shape');
  assert.equal(calls[1].args.includes('--white-background'), true);
  assert.equal(calls[1].args[calls[1].args.indexOf('--image') + 1], calls[0].args[calls[0].args.indexOf('--output') + 1]);
  assert.ok(calls[1].args[calls[1].args.indexOf('--image') + 1].includes(`${path.sep}outputs${path.sep}jobs${path.sep}`));
  assert.equal(result.glb.toString('ascii', 0, 4), 'glTF');
  assert.equal(result.preview.toString(), 'png');
  assert.equal(result.validation.faces, 12);
  assert.match(result.jobId, /^[a-z0-9-]+$/);
});

test('a failed text stage never starts shape generation', async t => {
  const { root, python } = await workspace(t);
  const { spawnImpl, calls } = scriptedSpawn([{ report: { ok: false, error: 'Resource guard stopped the trial' }, code: 1 }]);
  const generation = createGeneration({ root, python, spawnImpl });
  await assert.rejects(() => generation.start({ mode: 'text', prompt: 'a vase' }), /Resource guard/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[calls[0].args.indexOf('--report') + 2], 'text');
});

test('image generation uses the saved job file and white removal only when asked', async t => {
  const { root, python } = await workspace(t);
  const plain = scriptedSpawn([{ report: { ok: true }, output: fakeGlb() }]);
  const generation = createGeneration({ root, python, spawnImpl: plain.spawnImpl });
  await generation.start({ mode: 'image', imageName: '..\\evil.PNG', imageBytes: Buffer.from('rgba') });
  const imageArg = plain.calls[0].args[plain.calls[0].args.indexOf('--image') + 1];
  assert.match(imageArg, /input\.png$/);
  assert.equal(plain.calls[0].args.includes('--white-background'), false);
  assert.equal(await fs.readFile(imageArg, 'utf8'), 'rgba');
  const cutout = scriptedSpawn([{ report: { ok: true }, output: fakeGlb() }]);
  const second = createGeneration({ root, python, spawnImpl: cutout.spawnImpl });
  await second.start({ mode: 'image', imageName: 'object.jpg', imageBytes: Buffer.from('jpg'), whiteBackground: true });
  assert.equal(cutout.calls[0].args.includes('--white-background'), true);
  assert.match(cutout.calls[0].args[cutout.calls[0].args.indexOf('--image') + 1], /input\.jpg$/);
});

test('rejects a second job, a bad GLB, and cancellation of the running process', async t => {
  const { root, python } = await workspace(t);
  const hanging = scriptedSpawn([{ hang: true }]);
  const generation = createGeneration({ root, python, spawnImpl: hanging.spawnImpl, killImpl: child => { child.killed = true; child.emit('close', null); } });
  const pending = generation.start({ mode: 'text', prompt: 'a cup' });
  await assert.rejects(() => generation.start({ mode: 'text', prompt: 'another' }), /มีการสร้างอยู่แล้ว/);
  for (let i = 0; i < 50 && hanging.calls.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(hanging.calls.length, 1);
  assert.equal(generation.cancel(), true);
  await assert.rejects(pending, /ยกเลิก/);
  assert.equal(hanging.calls[0].child.killed, true);
  const bad = scriptedSpawn([{ report: { ok: true }, output: Buffer.from('not-a-glb-file!!!!') }]);
  const other = createGeneration({ root, python, spawnImpl: bad.spawnImpl });
  await assert.rejects(() => other.start({ mode: 'image', imageName: 'a.png', imageBytes: Buffer.from('rgba') }), /GLB/);
});
