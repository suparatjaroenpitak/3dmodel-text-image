"""Local, shape-only AI smoke tests; never substitutes a demo mesh for AI output."""
from __future__ import annotations

import argparse
import ctypes
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
SHAPE_REPO = "tencent/Hunyuan3D-2mini"
SHAPE_REVISION = "f90a0f7df7d5e6f71109cf333f6a95a0ae3194a6"
TEXT_REPO = "stabilityai/sd-turbo"
TEXT_REVISION = "b261bac6fd2cf515557d5d0707481eafa0485ec2"
SHAPE_SUBFOLDER = "hunyuan3d-dit-v2-mini"
SHAPE_DIR = MODELS / SHAPE_REPO / SHAPE_SUBFOLDER
TEXT_DIR = MODELS / TEXT_REPO
GIB = 1024 ** 3


def configure_local_runtime():
    os.environ["HF_HOME"] = str(MODELS / ".hf-cache")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    os.environ["HY3DGEN_MODELS"] = str(MODELS)
    os.environ.setdefault("PYTHONUTF8", "1")
    # Source is already present; do not run its setup.py or install texture extensions.
    sys.path.insert(0, str(ROOT / "external" / "Hunyuan3D-2"))


def hardware():
    info = {"python": sys.version.split()[0], "platform": sys.platform}
    if sys.platform == "win32":
        class MemoryStatus(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
                (name, ctypes.c_ulonglong) for name in
                ("total_phys", "avail_phys", "total_page", "avail_page", "total_virtual", "avail_virtual", "extended")
            ]
        status = MemoryStatus()
        status.length = ctypes.sizeof(status)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            raise OSError("Cannot query available system memory")
        info.update(ram_total_gib=round(status.total_phys / GIB, 2),
                    ram_free_gib=round(status.avail_phys / GIB, 2))
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=15, check=True,
        )
        name, total, free = result.stdout.strip().splitlines()[0].rsplit(",", 2)
        info.update(gpu=name.strip(), vram_total_mib=int(total), vram_free_mib=int(free))
    except (OSError, subprocess.SubprocessError, ValueError, IndexError) as error:
        info["gpu_query_error"] = str(error)
    return info


def check_resources(info, stage):
    # Conservative local trial policy, not manufacturer minimum requirements.
    min_ram = 8 if stage == "shape" else 4
    min_vram = 5000 if stage == "shape" else 3000
    if "ram_free_gib" not in info or "vram_free_mib" not in info:
        raise RuntimeError("Cannot establish available RAM/VRAM; run diagnose and resolve hardware detection first.")
    if info["ram_free_gib"] < min_ram or info["vram_free_mib"] < min_vram:
        raise RuntimeError(
            f"Resource guard: {stage} trial needs at least {min_ram} GiB free RAM and "
            f"{min_vram} MiB free VRAM under our conservative test policy; "
            f"found {info['ram_free_gib']} GiB RAM / {info['vram_free_mib']} MiB VRAM. "
            "Close GPU/memory-heavy applications, then retry. No model has been loaded."
        )


def download_models(which):
    from huggingface_hub import snapshot_download
    targets = ("shape", "text") if which == "all" else (which,)
    for target in targets:
        if target == "shape":
            repo, revision = SHAPE_REPO, SHAPE_REVISION
            patterns = [f"{SHAPE_SUBFOLDER}/config.yaml", f"{SHAPE_SUBFOLDER}/model.fp16.safetensors", "LICENSE*", "NOTICE*", "README.md"]
        else:
            repo, revision = TEXT_REPO, TEXT_REVISION
            patterns = ["model_index.json", "scheduler/*", "tokenizer/*", "*/config.json", "*/diffusion_pytorch_model.fp16.safetensors", "*/model.fp16.safetensors", "LICENSE*", "README.md"]
        print(f"Downloading {repo}@{revision} (FP16 only)", flush=True)
        snapshot_download(repo_id=repo, revision=revision, local_dir=str(MODELS / repo),
                          allow_patterns=patterns, max_workers=1)
        (MODELS / repo / "studio-revision.json").write_text(
            json.dumps({"repo": repo, "revision": revision}, indent=2) + "\n", encoding="utf-8")
    return {"downloaded": list(targets)}


def prepare_image(path, remove_white=False):
    import numpy as np
    from PIL import Image
    with Image.open(path) as original:
        image = original.convert("RGBA")
    pixels = np.array(image)
    method = "input_alpha"
    if pixels[:, :, 3].min() == 255:
        if not remove_white:
            raise ValueError("Input has no transparency. Supply an RGBA cutout, or explicitly use --white-background for a plain-white test image.")
        # Explicit test-only approximation, not a production background remover.
        pixels[:, :, 3] = np.where(pixels[:, :, :3].min(axis=2) > 245, 0, 255).astype("uint8")
        method = "white_threshold_test_only"
    alpha = pixels[:, :, 3]
    if not (alpha > 0).any() or not (alpha == 0).any():
        raise ValueError("Input mask must contain foreground and transparent background; check the image/white-background assumption.")
    coords = np.argwhere(alpha > 0)
    if (coords.max(axis=0) - coords.min(axis=0)).min() < 2:
        raise ValueError("Foreground is too small for a 3D smoke test")
    return Image.fromarray(pixels), method


def validate_glb(path):
    import numpy as np
    import trimesh
    data = Path(path).read_bytes()
    if len(data) < 20:
        raise ValueError("GLB file is truncated")
    magic, version, length = struct.unpack("<4sII", data[:12])
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("Invalid GLB 2.0 header or byte length")
    scene = trimesh.load(str(path), file_type="glb", force="scene")
    if not scene.geometry:
        raise ValueError("Generated GLB contains no geometry")
    meshes = list(scene.geometry.values())
    for mesh in meshes:
        if len(mesh.faces) == 0 or not np.isfinite(mesh.vertices).all():
            raise ValueError("Generated GLB has empty/non-finite geometry")
    return {"bytes": len(data), "vertices": sum(len(m.vertices) for m in meshes),
            "faces": sum(len(m.faces) for m in meshes), "bounds": scene.bounds.tolist()}


def shape(args):
    image, mask_method = prepare_image(args.image, args.white_background)
    info = hardware()
    check_resources(info, "shape")
    checkpoint = SHAPE_DIR / "model.fp16.safetensors"
    config = SHAPE_DIR / "config.yaml"
    if not checkpoint.is_file() or not config.is_file():
        raise FileNotFoundError("Shape weights are missing. Run: ai_smoke.py download --model shape")
    # Do not fetch anything implicitly during a smoke test.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import torch
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
    if not torch.cuda.is_available():
        raise RuntimeError("The installed PyTorch cannot access CUDA")
    torch.cuda.reset_peak_memory_stats()
    start = time.perf_counter()
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_single_file(
        str(checkpoint), str(config), device="cuda", dtype=torch.float16, use_safetensors=True)
    torch.cuda.synchronize()
    loaded = time.perf_counter()
    mesh = pipe(image=image, num_inference_steps=args.steps, octree_resolution=args.resolution,
                num_chunks=args.chunks, generator=torch.Generator(device="cuda").manual_seed(args.seed))[0]
    torch.cuda.synchronize()
    generated = time.perf_counter()
    if mesh is None:
        raise ValueError("Hunyuan returned no mesh")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(str(args.output), file_type="glb")
    validation = validate_glb(args.output)
    return {"output": str(args.output), "model": SHAPE_REPO, "revision": SHAPE_REVISION,
            "load_seconds": round(loaded - start, 3), "inference_seconds": round(generated - loaded, 3),
            "peak_allocated_mib": round(torch.cuda.max_memory_allocated() / 1024 ** 2, 1),
            "mask_method": mask_method, "hardware": info, "validation": validation,
            "settings": {"steps": args.steps, "resolution": args.resolution, "chunks": args.chunks, "seed": args.seed},
            "quality": "coarse shape-only smoke test; not a production-quality assessment"}


def text(args):
    info = hardware()
    check_resources(info, "text")
    if not (TEXT_DIR / "model_index.json").is_file():
        raise FileNotFoundError("SD-Turbo weights are missing. Run: ai_smoke.py download --model text")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import torch
    from diffusers import AutoPipelineForText2Image
    if not torch.cuda.is_available():
        raise RuntimeError("The installed PyTorch cannot access CUDA")
    torch.cuda.reset_peak_memory_stats()
    start = time.perf_counter()
    pipe = AutoPipelineForText2Image.from_pretrained(
        str(TEXT_DIR), variant="fp16", torch_dtype=torch.float16, local_files_only=True)
    pipe.enable_model_cpu_offload()
    torch.cuda.synchronize()
    loaded = time.perf_counter()
    image = pipe(args.prompt, height=512, width=512, num_inference_steps=1, guidance_scale=0.0,
                 generator=torch.Generator(device="cpu").manual_seed(args.seed)).images[0]
    torch.cuda.synchronize()
    generated = time.perf_counter()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output, format="PNG")
    from PIL import Image
    with Image.open(args.output) as saved:
        saved.verify()
    return {"output": str(args.output), "model": TEXT_REPO, "revision": TEXT_REVISION,
            "prompt": args.prompt, "size": list(image.size), "seed": args.seed,
            "load_seconds": round(loaded - start, 3), "inference_seconds": round(generated - loaded, 3),
            "peak_allocated_mib": round(torch.cuda.max_memory_allocated() / 1024 ** 2, 1), "hardware": info}


def positive(value):
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    commands = cli.add_subparsers(dest="command", required=True)
    diag = commands.add_parser("diagnose", help="Query RAM/GPU without loading model weights")
    diag.add_argument("--imports", action="store_true", help="Also verify PyTorch CUDA and shape/text imports")
    download = commands.add_parser("download", help="Download pinned FP16 weights; no inference")
    download.add_argument("--model", choices=["shape", "text", "all"], default="all")
    shape_cli = commands.add_parser("shape", help="Actual image -> untextured GLB (offline)")
    shape_cli.add_argument("--image", type=Path, required=True)
    shape_cli.add_argument("--output", type=Path, default=ROOT / "outputs" / "smoke" / "image.glb")
    shape_cli.add_argument("--white-background", action="store_true", help="Test-only white threshold, may erase white object parts")
    shape_cli.add_argument("--steps", type=positive, default=8)
    shape_cli.add_argument("--resolution", type=positive, default=128)
    shape_cli.add_argument("--chunks", type=positive, default=1024)
    shape_cli.add_argument("--seed", type=int, default=12345)
    text_cli = commands.add_parser("text", help="Actual prompt -> PNG; run shape separately after this process exits")
    text_cli.add_argument("--prompt", required=True)
    text_cli.add_argument("--output", type=Path, default=ROOT / "outputs" / "smoke" / "text.png")
    text_cli.add_argument("--seed", type=int, default=12345)
    cli.add_argument("--report", type=Path, help="Write JSON results, including failures")
    return cli


def main(argv=None):
    args = parser().parse_args(argv)
    if args.command == "shape" and args.output.suffix.lower() != ".glb":
        raise SystemExit("Shape output must end in .glb")
    if args.command == "text" and args.output.suffix.lower() != ".png":
        raise SystemExit("Text output must end in .png")
    configure_local_runtime()
    start = time.perf_counter()
    report = {"command": args.command, "ok": False}
    try:
        if args.command == "diagnose":
            report.update(hardware())
            if args.imports:
                import torch
                from diffusers import AutoPipelineForText2Image
                from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
                report.update(torch=torch.__version__, cuda_build=torch.version.cuda,
                              cuda_available=torch.cuda.is_available(), imports_ok=True)
                if not torch.cuda.is_available():
                    raise RuntimeError("PyTorch CUDA is unavailable")
        elif args.command == "download":
            report.update(download_models(args.model))
        elif args.command == "shape":
            report.update(shape(args))
        else:
            report.update(text(args))
        report["ok"] = True
    except Exception as error:
        report.update(error_type=type(error).__name__, error=str(error))
        traceback.print_exc()
    report["total_seconds"] = round(time.perf_counter() - start, 3)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
