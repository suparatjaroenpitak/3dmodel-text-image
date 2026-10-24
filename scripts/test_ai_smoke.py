import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ai_smoke", Path(__file__).with_name("ai_smoke.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class SmokeTests(unittest.TestCase):
    def test_shape_guard_rejects_low_free_memory(self):
        for ram, vram in [(0.6, 6144), (10, 686)]:
            with self.subTest(ram=ram, vram=vram), self.assertRaisesRegex(RuntimeError, "No model has been loaded"):
                smoke.check_resources({"ram_free_gib": ram, "vram_free_mib": vram}, "shape")

    def test_guard_rejects_unknown_resources(self):
        with self.assertRaisesRegex(RuntimeError, "Cannot establish"):
            smoke.check_resources({}, "shape")

    def test_guard_allows_sufficient_memory(self):
        smoke.check_resources({"ram_free_gib": 10, "vram_free_mib": 5500}, "shape")
        smoke.check_resources({"ram_free_gib": 5, "vram_free_mib": 3500}, "text")

    def test_cli_rejects_nonpositive_inference_settings(self):
        for option in ["--steps", "--resolution", "--chunks"]:
            with self.subTest(option=option), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                smoke.parser().parse_args(["shape", "--image", "input.png", option, "0"])

    def test_cli_preserves_paths_with_spaces(self):
        args = smoke.parser().parse_args(["shape", "--image", "input folder/object.png", "--output", "output folder/object.glb"])
        self.assertEqual(args.image, Path("input folder/object.png"))
        self.assertEqual(args.output, Path("output folder/object.glb"))

    def test_no_silent_export_format_mismatch(self):
        for args in [["shape", "--image", "i.png", "--output", "bad.obj"], ["text", "--prompt", "fox", "--output", "bad.jpg"]]:
            with self.subTest(args=args), self.assertRaises(SystemExit):
                smoke.main(args)

    def test_diagnostic_writes_real_report(self):
        with tempfile.TemporaryDirectory() as folder:
            report = Path(folder) / "report.json"
            with patch.object(smoke, "configure_local_runtime"), patch.object(smoke, "hardware", return_value={"ram_free_gib": 0.5}), contextlib.redirect_stdout(io.StringIO()):
                code = smoke.main(["--report", str(report), "diagnose"])
            self.assertEqual(code, 0)
            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertTrue(data["ok"])
            self.assertEqual(data["ram_free_gib"], 0.5)

    def test_failure_is_nonzero_and_reported(self):
        with tempfile.TemporaryDirectory() as folder:
            report = Path(folder) / "failure.json"
            with patch.object(smoke, "configure_local_runtime"), patch.object(smoke, "text", side_effect=RuntimeError("Not enough VRAM")), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = smoke.main(["--report", str(report), "text", "--prompt", "fox"])
            self.assertEqual(code, 1)
            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertFalse(data["ok"])
            self.assertEqual(data["error"], "Not enough VRAM")

    def test_image_requires_explicit_background_assumption(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "opaque.png"
            Image.new("RGB", (32, 32), "white").save(path)
            with self.assertRaisesRegex(ValueError, "no transparency"):
                smoke.prepare_image(path)
            with self.assertRaisesRegex(ValueError, "foreground"):
                smoke.prepare_image(path, remove_white=True)

    def test_explicit_white_threshold_preserves_foreground(self):
        from PIL import Image, ImageDraw
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "object.png"
            image = Image.new("RGB", (32, 32), "white")
            ImageDraw.Draw(image).rectangle((8, 8, 23, 23), fill="orange")
            image.save(path)
            result, method = smoke.prepare_image(path, remove_white=True)
            self.assertEqual(method, "white_threshold_test_only")
            self.assertEqual(result.getpixel((0, 0))[3], 0)
            self.assertEqual(result.getpixel((16, 16))[3], 255)

    def test_transparent_input_keeps_existing_mask(self):
        from PIL import Image, ImageDraw
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cutout.png"
            image = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
            ImageDraw.Draw(image).rectangle((8, 8, 23, 23), fill="orange")
            image.save(path)
            result, method = smoke.prepare_image(path)
            self.assertEqual(method, "input_alpha")
            self.assertEqual(result.tobytes(), image.tobytes())

    def test_glb_validator_reopens_geometry(self):
        import trimesh
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "validator-fixture.glb"
            # Synthetic fixture tests file validation only, never AI inference.
            mesh = trimesh.creation.box()
            mesh.export(str(path))
            result = smoke.validate_glb(path)
            self.assertGreater(result["faces"], 0)
            self.assertGreater(result["vertices"], 0)
            self.assertEqual(result["bytes"], path.stat().st_size)

    def test_glb_validator_rejects_corrupt_output(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "broken.glb"
            path.write_bytes(b"not a GLB file")
            with self.assertRaisesRegex(ValueError, "truncated"):
                smoke.validate_glb(path)

    def test_download_uses_revisions_and_fp16_only(self):
        calls = []
        fake_hub = types.SimpleNamespace(snapshot_download=lambda **kwargs: calls.append(kwargs))
        with tempfile.TemporaryDirectory() as folder, patch.object(smoke, "MODELS", Path(folder)), patch.dict("sys.modules", {"huggingface_hub": fake_hub}), contextlib.redirect_stdout(io.StringIO()):
            # The Hub creates each local directory before returning.
            (Path(folder) / smoke.SHAPE_REPO).mkdir(parents=True)
            (Path(folder) / smoke.TEXT_REPO).mkdir(parents=True)
            smoke.download_models("all")
            self.assertEqual(calls[0]["revision"], smoke.SHAPE_REVISION)
            self.assertEqual(calls[1]["revision"], smoke.TEXT_REVISION)
            for call in calls:
                self.assertEqual(call["max_workers"], 1)
                weights = [p for p in call["allow_patterns"] if "safetensors" in p]
                self.assertTrue(weights)
                self.assertTrue(all("fp16" in p for p in weights))


if __name__ == "__main__":
    unittest.main()
