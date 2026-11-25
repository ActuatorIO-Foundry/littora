import runpy
import unittest
import io
import json
import os
import subprocess
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from subprocess import CompletedProcess
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
import osmium
from shapely.geometry import box

geo = runpy.run_path(str(Path(__file__).resolve().parents[1] / "territory-inventories.py"))


class Transfers(unittest.TestCase):
    polygon = b"test\n1\n0 0\n0 4\n4 4\n4 0\n0 0\nEND\nEND\n"
    name = "bretagne-latest.osm.pbf"

    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.cache = Path(directory.name)
        self.download = geo["Downloads"](self.cache, 10000, "1M")
        self.calls, self.responses = [], []
        def transport(args, **options):
            self.calls.append(args)
            rc, status, body = self.responses.pop(0)
            Path(args[args.index("--output") + 1]).write_bytes(body)
            return CompletedProcess(args, rc, stdout=status, stderr="private test detail")
        self.enterContext(patch("subprocess.run", side_effect=transport))
        self.sleep = self.enterContext(patch("time.sleep"))

    def get(self, name):
        return self.download.get(name, "bretagne/"+name, 10000)

    def pbf(self, age):
        path = self.cache / f"fixture-{age}.osm.pbf"
        header = osmium.io.Header()
        stamp = (datetime.now(timezone.utc)-timedelta(days=age)).isoformat()
        header.set("osmosis_replication_timestamp", stamp.split(".")[0]+"Z")
        with osmium.SimpleWriter(str(path), header=header):
            pass
        return path.read_bytes()

    def test_transient_transfer_retries_once_charging_partial_bytes(self):
        self.responses = [(18,"200",b"partial"), (0,"200",self.polygon)]
        self.assertEqual(self.get("bretagne.poly").read_bytes(), self.polygon)
        self.assertEqual(self.sleep.call_count, 1)
        self.assertEqual(self.download.remaining, 10000 - 7 - len(self.polygon))
        self.assertEqual(self.calls[1][self.calls[1].index("--max-filesize")+1], "9993")

    def test_exhausted_or_throttled_transfer_never_replaces_cache(self):
        target = self.cache/"bretagne.poly"
        target.write_bytes(self.polygon)
        for rc, status, body, budget in [(22,"429",b"",10000), (22,"503",b"",10000),
                                         (6,"000",b"",10000), (18,"200",b"x",1)]:
            with self.subTest(rc=rc,status=status):
                self.calls.clear()
                self.download.remaining = budget
                self.responses = [(rc,status,body)] * (2 if rc==6 else 1)
                with self.assertRaises(geo["DownloadError"]):
                    self.get(target.name)
                self.assertFalse(self.responses)
                self.assertEqual(target.read_bytes(), self.polygon)

    def test_dated_fallback_uses_only_own_publisher_and_counts_index(self):
        payload = self.pbf(1)
        index = (b'<a href="bretagne-260101.osm.pbf">old</a><a href="bretagne-261121.osm.pbf">new</a>'
                 b'<a href="https://example.org/bretagne-991231.osm.pbf">external</a>')
        self.responses = [(22,"404",b""), (0,"200",index), (0,"200",payload)]
        self.assertEqual(self.get(self.name).read_bytes(), payload)
        self.assertEqual(self.calls[-1][-1], geo["ROOT"]+"bretagne/bretagne-261121.osm.pbf")
        self.assertEqual(self.download.remaining, 10000-len(index)-len(payload))

    def test_index_refusal_is_provider_backoff_not_a_missing_edition(self):
        self.responses = [(22,"404",b""),(22,"503",b"")]
        with self.assertRaisesRegex(geo["DownloadError"],"provider-backoff"):
            self.get(self.name)
        self.assertEqual(len(self.calls),2)

    def test_unchanged_corrupt_older_and_expired_responses_preserve_good_copy(self):
        target = self.cache/self.name
        original = self.pbf(1)
        target.write_bytes(original)
        timestamp = target.stat().st_mtime_ns
        self.responses = [(0,"304",b"")]
        self.assertEqual(self.get(self.name), target)
        for payload in (b"not a PBF", self.pbf(2), self.pbf(8), b""):
            self.responses = [(0,"200",payload)]
            with self.assertRaises((ValueError, RuntimeError, OSError)):
                self.get(self.name)
        self.assertEqual(target.read_bytes(), original)
        self.assertEqual(target.stat().st_mtime_ns, timestamp)


class Planning(unittest.TestCase):
    def test_input_error_does_not_publish_private_path(self):
        import subprocess
        import sys
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as tmp:
            marker = "missing-private-fixture"
            result = subprocess.run([sys.executable, geo["__file__"], "--sites", str(Path(tmp, marker)),
                                     "--cache", tmp, "--manifest", str(Path(tmp, "manifest"))],
                                    capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Inventory cycle failed", result.stderr)
            self.assertFalse(marker in result.stderr or tmp in result.stderr)

    def test_shared_region_border_and_unknown_are_distinct(self):
        sites = [dict(id=str(i), lon=lon, lat=44) for i, lon in enumerate((1, 1.1, 2, 8))]
        groups, uncovered = geo["plan"](sites, {"west": box(0, 43, 2, 45), "east": box(2, 43, 3, 45)})
        rows = {s["id"]: s["completeWindow"] for group in groups.values() for s in group}
        self.assertEqual(rows, {"0": True, "1": True, "2": False})
        self.assertEqual(uncovered, ["3"])
        self.assertTrue({"0", "1"} <= {s["id"] for s in groups["west"]})

    def test_polygon_holes_are_not_inventory(self):
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as tmp:
            f = Path(tmp, "cut.poly")
            f.write_text("test\n1\n0 0\n0 4\n4 4\n4 0\n0 0\nEND\n!1\n1 1\n1 2\n2 2\n2 1\n1 1\nEND\nEND\n")
            shape = geo["polygon"](f)
            self.assertFalse(shape.covers(box(1.1, 1.1, 1.2, 1.2)))
            self.assertTrue(shape.covers(box(2.1, 2.1, 2.2, 2.2)))


class PartialCycle(unittest.TestCase):
    def prepare(self, contours, sites, bundle_error=None):
        names = list(contours)
        source = Mock(aging=[])
        source.get.side_effect = list(contours.values())
        manifest, errors = io.StringIO(), io.StringIO()
        def build(region, group, downloads):
            if bundle_error: raise geo["DownloadError"](bundle_error)
            return Path("/tmp",region+".ndjson")
        builder = Mock(side_effect=build)
        prepare = geo["prepare"]
        with patch.dict(prepare.__globals__,REGIONS=names,polygon=lambda x:x,bundle=builder), redirect_stderr(errors), redirect_stdout(io.StringIO()):
            status = prepare(sites, source, set(names), manifest)
        return status, manifest.getvalue(), list(map(json.loads,errors.getvalue().splitlines())), builder, source.get.call_count

    def test_one_boundary_failure_allows_only_fully_covered_windows(self):
        bad = ValueError("private fixture path")
        site = lambda x: {"id":str(x),"lon":x,"lat":44}
        rc, manifest, events, bundle, _ = self.prepare({"failed":bad,"ok":box(0,43,2,45)},[site(1),site(2),site(7)])
        self.assertEqual(rc,2)
        self.assertEqual(manifest,"/tmp/ok.ndjson\n")
        self.assertEqual(bundle.call_args.args[1],[{**site(1),"completeWindow":True}])
        self.assertEqual(events,[{"event":"inventory_region_failed","stage":"boundary","region":"failed","reason":"invalid-input-or-storage"}])

    def test_shared_transport_outage_stops_before_large_files(self):
        error=geo["DownloadError"]("dns")
        rc, manifest, events, bundle, calls = self.prepare({"a":error,"b":error,"c":error},[])
        self.assertEqual((rc,manifest,calls),(75,"",2))
        self.assertEqual([e["reason"] for e in events],["dns","dns"])
        bundle.assert_not_called()

    def test_provider_backoff_stops_all_remaining_requests_in_either_phase(self):
        error=geo["DownloadError"]("provider-backoff")
        rc, _, _, bundle, calls = self.prepare({"a":error,"b":error},[])
        self.assertEqual((rc,calls),(2,1))
        bundle.assert_not_called()
        sites=[{"id":r,"lon":x,"lat":44} for r,x in [("1",1),("2",4)]]
        rc,manifest,events,bundle,_=self.prepare({"a":box(0,43,2,45),"b":box(3,43,5,45)},sites,"provider-backoff")
        self.assertEqual((rc,manifest,bundle.call_count),(2,"",1))
        self.assertEqual(events[0]["stage"],"extract")


class Scheduler(unittest.TestCase):
    def test_real_loop_retries_on_schedule_preserves_success_and_clears_failure_only_after_recovery(self):
        script=Path(geo["__file__"]).with_name("inventory-cycle.sh")
        with TemporaryDirectory() as tmp:
            cache=Path(tmp)
            env={**os.environ,"PATH":tmp+":"+os.environ["PATH"],"INVENTORY_CACHE_DIR":tmp}
            for name,body in {
                "python3":'exit "$PREPARATION_STATUS"',
                "node":'exit 0',
                "date":'case "$*" in *%s*) echo 10000;; *%F*) echo 2026-11-25;; *) echo date;; esac',
                "sleep":'echo "$1" >> "$INVENTORY_CACHE_DIR/waits"; exit 42',
            }.items():
                cmd=cache/name; cmd.write_text("#!/bin/sh\n"+body+"\n"); cmd.chmod(0o700)
            def run(code):
                result=subprocess.run(["sh",str(script)],env={**env,"PREPARATION_STATUS":str(code)},
                                      capture_output=True,timeout=5)
                self.assertEqual(result.returncode,42)
                return (cache/"waits").read_text().splitlines()[-1]
            (cache/"cycle.ok").write_text("2026-11-24\n")
            self.assertEqual(run(75),"900")
            self.assertEqual((cache/"cycle.ok").read_text(),"2026-11-24\n")
            self.assertEqual((cache/"cycle.retry").read_text(),"10900 900\n")
            self.assertEqual(run(0),"900")  # Restart cannot skip the outstanding wait.
            (cache/"cycle.retry").write_text("9999 900\n")
            self.assertEqual(run(75),"1800")
            (cache/"cycle.retry").write_text("9999 1800\n")
            self.assertEqual(run(2),"21600")
            (cache/"cycle.retry").write_text("9999 21600\n")
            self.assertEqual(run(0),"3600")
            self.assertFalse((cache/"cycle.failed").exists())
            self.assertFalse((cache/"cycle.retry").exists())
            self.assertEqual((cache/"cycle.ok").read_text(),"2026-11-25\n")


if __name__ == "__main__":
    unittest.main()
