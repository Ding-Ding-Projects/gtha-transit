#!/usr/bin/env python3
import hashlib, json, subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("verify-active-graph-feeds.py")


class VerifyActiveGraphFeedsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.feeds = self.root / "feeds"; self.feeds.mkdir()
        self.provenance = self.root / "graph-provenance.json"; self.manifest = self.feeds / "manifest.json"
        self._write("ttc", b"summer"); self._write("ttc-next", b"fall")
        self._write_records(["ttc", "ttc-next"])

    def tearDown(self): self.temp.cleanup()

    def _write(self, identifier, content):
        (self.feeds / f"{identifier}.zip").write_bytes(content)

    def _write_records(self, identifiers):
        records = []
        for identifier in identifiers:
            archive = self.feeds / f"{identifier}.zip"; digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            records.append({"id": identifier, "file": archive.name, "sha256": digest})
        self.provenance.write_text(json.dumps({"feeds": records}), encoding="utf-8")
        self.manifest.write_text(json.dumps({"feeds": records}), encoding="utf-8")

    def _run(self):
        return subprocess.run([sys.executable, str(SCRIPT), "--graph-provenance", str(self.provenance), "--manifest", str(self.manifest), "--feeds-dir", str(self.feeds)], text=True, capture_output=True)

    def test_matching_versions_and_archives_are_accepted(self):
        result = self._run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("verified: 2 versions", result.stdout)

    def test_missing_version_is_refused_before_refresh(self):
        self.manifest.write_text(json.dumps({"feeds": [json.loads(self.provenance.read_text())["feeds"][0]]}), encoding="utf-8")
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing active graph feed version: ttc-next", result.stdout)

    def test_changed_archive_is_refused_before_refresh(self):
        self._write("ttc", b"not the active graph archive")
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("archive digest differs from active graph: ttc", result.stdout)


if __name__ == "__main__": unittest.main()
