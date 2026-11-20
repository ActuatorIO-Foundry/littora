import runpy
import unittest
from pathlib import Path
from shapely.geometry import box

geo = runpy.run_path(str(Path(__file__).resolve().parents[1] / "territory-inventories.py"))


class Planning(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
