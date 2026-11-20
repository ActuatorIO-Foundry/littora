"""One bounded, cached regional extract per territory; never queries a public Overpass instance."""
import argparse
import hashlib
import json
import math
import os
import re
import runpy
import subprocess
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

osm = runpy.run_path(str(Path(__file__).with_name("prepare-amenities.py")))
REGIONS = """alsace aquitaine auvergne basse_normandie bourgogne bretagne centre champagne_ardenne corse
franche_comte haute_normandie ile_de_france languedoc_roussillon limousin lorraine midi_pyrenees
nord_pas_de_calais pays_de_la_loire picardie poitou_charentes provence_alpes_cote_d_azur rhone_alpes""".replace("_","-").split()
ROOT = "https://download.geofabrik.de/europe/france/"
MIB = 1024**2


class DatedLinks(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.alias, self.links = ROOT+path, []

    def handle_starttag(self, tag, attrs):
        url = urljoin(self.alias, dict(attrs).get("href") or "")
        if tag == "a" and re.fullmatch(re.escape(self.alias.removesuffix("latest.osm.pbf"))+r"\d{6}\.osm\.pbf", url):
            self.links.append(url)


class Downloads:
    def __init__(self, cache, budget, rate):
        self.cache, self.remaining, self.rate = cache, budget, rate
        self.aging = []

    def get(self, name, path, limit):
        target = self.cache / name
        with tempfile.NamedTemporaryFile(dir=self.cache) as tmp:
            # The outer temporary file is private to this attempt, including errors and HTTP 304.
            cmd = ["curl", "--silent", "--show-error", "--fail", "--proto", "=https", "--location",
                   "--proto-redir", "=https", "--max-redirs", "2", "--remote-time",
                   "--connect-timeout", "20", "--max-time", "900", "--limit-rate", self.rate,
                   "--max-filesize", str(min(limit, self.remaining)), "--output", tmp.name,
                   "--write-out", "%{http_code}", "--user-agent", "Littora/0.1 (+https://github.com/ActuatorIO-Foundry/littora)"]
            if self.remaining <= 0:
                raise ValueError("Cycle transfer quota exhausted")
            if target.exists():
                cmd.extend(["--time-cond", str(target)])
            result = subprocess.run([*cmd, ROOT + path], capture_output=True, text=True)
            if result.returncode == 47 and name.endswith("-latest.osm.pbf"):
                # A looping latest alias must not prevent use of the dated file in the official index.
                index = subprocess.run(["curl","-fsSL","--max-redirs","2","--max-filesize",str(MIB),
                                        "--max-time","20","--proto","=https","--proto-redir","=https",
                                        urljoin(ROOT+path,"./")], capture_output=True,text=True)
                links = DatedLinks(path)
                links.feed(index.stdout)
                if index.returncode == 0 and links.links:
                    result = subprocess.run([*cmd,max(links.links)], capture_output=True, text=True)
            self.remaining -= os.stat(tmp.name).st_size
            if result.returncode:
                raise ValueError(f"Download failed: {name} (curl {result.returncode})")
            if result.stdout == "304" and target.is_file():
                return target
            if result.stdout != "200" or not os.stat(tmp.name).st_size:
                raise ValueError(f"Invalid download: {name}")
            # Hard-link then rename on the same filesystem; retain the provider's modification date.
            staged = Path(tmp.name + ".ready")
            os.link(tmp.name, staged)
            os.replace(staged, target)
        return target


def polygon(path):
    parts, holes, ring = [], [], None
    for line in path.read_text().splitlines()[1:]:
        line = line.strip()
        if not line:
            continue
        if line == "END":
            if ring is None:
                break
            (holes if hole else parts).append(Polygon(ring))
            ring = None
        elif ring is None:
            ring, hole = [], line.startswith("!")
        else:
            x, y = map(float, line.split())
            ring.append((x, y))
    shape = unary_union(parts).difference(unary_union(holes))
    if ring is not None or shape.is_empty or not shape.is_valid:
        raise ValueError("Invalid territory polygon")
    return shape


def window(site):
    dy = 2.52 / 110
    dx = dy / math.cos(math.radians(abs(site["lat"]) + dy))
    return box(site["lon"]-dx, site["lat"]-dy, site["lon"]+dx, site["lat"]+dy)


def plan(sites, shapes):
    groups, uncovered = defaultdict(list), []
    for site in sites:
        disk = window(site)
        region = next((r for r, p in shapes.items() if p.covers(disk)), None)
        if region:
            groups[region].append({**site,"completeWindow":True})
        else:
            # E.g. a border or a coastal extract cut offshore: publish positive evidence only.
            overlaps = [(p.intersection(disk).area, r) for r,p in shapes.items() if p.covers(Point(site["lon"], site["lat"]))]
            if overlaps:
                groups[max(overlaps)[1]].append({**site,"completeWindow":False})
            else:
                uncovered.append(site["id"])
    return groups, uncovered


def bundle(region, sites, downloads):
    name = region + "-latest.osm.pbf"
    path = region + "/" + name
    pbf = downloads.get(name, path, 650*MIB)
    reader = osm["open_extract"](pbf)
    date = reader.header.get("osmosis_replication_timestamp")
    age = (datetime.now(timezone.utc)-datetime.fromisoformat(date.replace("Z","+00:00"))).total_seconds()
    if not 0 <= age < 7*86400:
        raise ValueError("Missing, future or expired replication date")
    if age >= 48*3600:
        downloads.aging.append(region)
        print(f"{region}: warning: replication older than 48 h ({date})", file=sys.stderr)
    signature = hashlib.sha256(json.dumps([3, region, date, sites], sort_keys=True).encode()).hexdigest()[:24]
    out = downloads.cache / f"{region}-{signature}.ndjson"
    if out.exists():
        return out
    windows = [window(s) for s in sites]
    tree = STRtree(windows)
    rows = [[] for _ in sites]
    for obj in osm["objects"](reader):
        t = obj["tags"]
        if not (t.get("amenity") in {"parking","parking_space","toilets","restaurant","cafe","ice_cream","fast_food","boat_rental"}
                or t.get("shop") in {"ice_cream","rental"} or "rental" in t or "lifeguard" in t
                or t.get("emergency") in {"lifeguard","lifeguard_tower"}):
            continue
        for idx in tree.query(Point(obj["lon"], obj["lat"])):
            rows[idx].append(obj)
            if len(rows[idx]) > 5000:
                raise ValueError("Site exceeds object limit; refusing truncated inventory")
    with tempfile.NamedTemporaryFile(mode="w", dir=downloads.cache, delete=False) as f:
        try:
            for site, rect, elements in zip(sites, windows, rows):
                w,s,e,n = rect.bounds
                record = dict(version=1, site=site, bounds=[s,w,n,e], elements=elements,
                              asOf=date, source=ROOT+path)
                f.write(json.dumps(record,separators=(",",":"),allow_nan=False)+"\n")
            f.flush()
            os.replace(f.name, out)
        finally:
            Path(f.name).unlink(missing_ok=True)
    for old in downloads.cache.glob(region + "-*.ndjson"):
        if old != out:
            old.unlink()
    return out


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--sites", type=Path, required=True)
    cli.add_argument("--cache", type=Path, required=True)
    cli.add_argument("--manifest", type=Path, required=True)
    cli.add_argument("--regions", default=os.getenv("INVENTORY_REGIONS", "all"))
    cli.add_argument("--plan", action="store_true")
    args = cli.parse_args()
    allowed = set(REGIONS if args.regions == "all" else args.regions.split(","))
    if not allowed or not allowed <= set(REGIONS):
        cli.error("Unknown region")
    args.cache.mkdir(parents=True, exist_ok=True)
    downloads = Downloads(args.cache, int(os.getenv("INVENTORY_MAX_MIB","4096"))*MIB, os.getenv("INVENTORY_RATE","8M"))
    sites = json.loads(args.sites.read_text())
    if not 0 < len(sites) <= 5000 or len({s["id"] for s in sites}) != len(sites):
        raise ValueError("Invalid catalogue size or duplicate site")
    shapes = {r:polygon(downloads.get(r+".poly",r+"/"+r+".poly",MIB)) for r in REGIONS}
    groups, uncovered = plan(sites,shapes)
    print(json.dumps({"sites":len(sites),"regions":{r:len(v) for r,v in groups.items()},"uncovered":len(uncovered)}),flush=True)
    failures = []
    with args.manifest.open("w") as manifest:
        if not args.plan:
            for r in sorted(allowed & groups.keys()):
                try:
                    out = bundle(r, groups[r], downloads)
                    print(str(out.resolve()), file=manifest, flush=True)
                    print(f"{r}: {len(groups[r])} inventories prepared", flush=True)
                except (ValueError, OSError, RuntimeError) as err:
                    failures.append(r)
                    print(f"{r}: {err}", file=sys.stderr, flush=True)
    return 2 if failures or uncovered or downloads.aging else 0


if __name__ == "__main__":
    sys.exit(main())
