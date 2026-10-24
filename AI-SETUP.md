# Local AI verification — Windows

Target: Windows 11, RTX 3060 Laptop (6 GB VRAM), approximately 16 GB RAM.
This is **AI runtime preparation**, not a completed desktop app or proof that inference fits this laptop.

## Scope

- Image → untextured GLB: Tencent Hunyuan3D-2mini.
- English text → PNG: SD-Turbo. Run image generation in a separate process before shape generation, so the two models are not resident together.
- Shape smoke settings: 8 steps, resolution 128, chunk size 1024, seed 12345. These are coarse functional-test settings, not a production-quality target.
- No texture generator, CUDA compiler extensions, hosted API, account, or system Python changes.
- Weights, environments, outputs and caches are ignored by Git. Do not commit weights or private input images.

## Isolated installation (Git Bash, project root)

The project uses the already-installed `uv` command. The managed Python below is project-local, creates no PATH shim, and is not registered as a system Python.

```bash
uv python install 3.10 --install-dir .venv-python --no-bin --no-registry
uv venv .venv-ai --python .venv-python/cpython-3.10-windows-x86_64-none/python.exe --seed
uv pip install --python .venv-ai/Scripts/python.exe torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu124
uv pip install --python .venv-ai/Scripts/python.exe -r requirements-ai.txt
.venv-ai/Scripts/python.exe -m pip check
```

Do not start a second installer while the current installer is running. Its log is `outputs/setup/install.log`; `outputs/setup/install.exit` is written only when that installation process finishes (0 means success). Existing source at `external/Hunyuan3D-2` is imported directly, without executing its setup script. The inspected checkout revision is `f8db63096c8282cb27354314d896feba5ba6ff8a`.

## Diagnose before loading models

```bash
.venv-ai/Scripts/python.exe scripts/ai_smoke.py --report outputs/setup/diagnose.json diagnose --imports
```

`diagnose` without `--imports` uses only Python's standard library and `nvidia-smi`; it does not prove CUDA inference works. `--imports` additionally checks Torch/CUDA and shape/text imports, but still does not generate anything.

Tencent lists approximately 6 GB VRAM for shape generation. A card with 6 GB total may have substantially less free because of Windows and other apps. Do not close or kill applications automatically; save work and close heavy apps yourself.

The smoke CLI has a **conservative trial policy**, not an official model requirement: shape requires at least 8 GiB free RAM and 5000 MiB free VRAM; text requires 4 GiB free RAM and 3000 MiB free VRAM. Passing this guard does not guarantee successful inference; failing it produces a nonzero exit and a JSON error instead of attempting a large model load. No CPU fallback or synthetic mesh is substituted.

## Explicit model downloads

Review the linked model licenses first. Download uses public Hugging Face model files, not a hosted inference service. Initial internet access is required; inference commands use local files only.

```bash
.venv-ai/Scripts/python.exe scripts/ai_smoke.py --report outputs/setup/download.json download --model all
```

Only FP16 model files/configs and license/readme files are selected. Selected weights total roughly 6.4 GB; Torch and the environment add several GB. Allow substantial extra cache/temporary disk space. Downloads are pinned to:

- `tencent/Hunyuan3D-2mini`: `f90a0f7df7d5e6f71109cf333f6a95a0ae3194a6`
- `stabilityai/sd-turbo`: `b261bac6fd2cf515557d5d0707481eafa0485ec2`

The script writes a `studio-revision.json` next to each successful download. On failure, retry the same command; Hugging Face may reuse completed files.

## Actual inference trials

Supply a prepared transparent PNG with a single object for the image path. Replace the example input below with your own image. `--white-background` is an optional, explicit smoke-test shortcut for plain-white backgrounds: it can erase white object parts and is **not** production background removal.

```bash
# Actual image → shape, offline. Requires your prepared input image.
.venv-ai/Scripts/python.exe scripts/ai_smoke.py --report outputs/smoke/image-result.json shape --image inputs/object.png --output outputs/smoke/image.glb

# Actual text → image; use English prompts as the baseline.
.venv-ai/Scripts/python.exe scripts/ai_smoke.py --report outputs/smoke/text-result.json text --prompt 'a small orange ceramic fox figurine, full object, isolated on a plain white background' --output outputs/smoke/text.png

# Only after the preceding process has exited: generated image → shape.
# Inspect text.png first: thresholding works only with a sufficiently white background.
.venv-ai/Scripts/python.exe scripts/ai_smoke.py --report outputs/smoke/text-shape-result.json shape --image outputs/smoke/text.png --white-background --output outputs/smoke/text.glb
```

Reports record errors/nonzero exit status, or actual load/inference timing and peak Torch-allocated GPU memory on success. A GLB is checked for a valid GLB 2.0 header, byte count, nonempty geometry and finite vertices by reopening it through trimesh. This is structural validation, not proof of visual quality; inspect the successful GLB in a 3D viewer before accepting it. Torch peak allocation is not total system/GPU memory use.

SD-Turbo's official pipeline configuration has no safety checker; do not assume generated images have been content-filtered. Follow model acceptable-use terms. Thai prompt performance has not been verified.

## Checks

```bash
.venv-ai/Scripts/python.exe -m unittest discover -s scripts -p 'test_*.py' -v
.venv-ai/Scripts/python.exe -m py_compile scripts/ai_smoke.py scripts/test_ai_smoke.py
npm run check
```

Unit tests cover CLI validation, resource guards, structured failure reporting and pinned download selection. They do **not** count as real model inference tests. The current repository has no TypeScript typecheck script.

## Official references / licenses

- Hunyuan3D setup and VRAM: https://github.com/Tencent-Hunyuan/Hunyuan3D-2
- Hunyuan3D-2mini: https://huggingface.co/tencent/Hunyuan3D-2mini
- Hunyuan3D-2mini license: https://huggingface.co/tencent/Hunyuan3D-2mini/blob/main/LICENSE
- SD-Turbo usage: https://huggingface.co/stabilityai/sd-turbo
- SD-Turbo license: https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md
- PyTorch CUDA wheel versions: https://pytorch.org/get-started/previous-versions/

These model licenses are not unrestricted permissive licenses. Review territorial restrictions, acceptable-use rules, attribution/redistribution requirements and any commercial registration or separate-license thresholds for your use case before distribution or commercial use. This setup does not grant additional rights.
