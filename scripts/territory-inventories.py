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
import time
from collections import defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

from shapely.geometry import Point, Polygon, box
from shapely.errors import ShapelyError
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


class DownloadError(ValueError):
    """Only fixed reason codes reach the operator's diagnostics."""


TRANSIENT = {"dns", "connect", "timeout", "interrupted", "temporary-http"}
STOP_PROVIDER = {"provider-backoff", "transfer-quota"}


def transfer_reason(result):
    if result.stdout in {"429", "503"}:
        return "provider-backoff"
    if result.returncode == 22 and result.stdout in {"408", "500", "502", "504"}:
        return "temporary-http"
    return {6:"dns", 7:"connect", 28:"timeout", 18:"interrupted", 52:"interrupted",
            55:"interrupted", 56:"interrupted"}.get(result.returncode, "transfer-failed")


def failure(stage, region, error):
    reason = str(error) if isinstance(error, DownloadError) else "invalid-input-or-storage"
    print(json.dumps({"event":"inventory_region_failed","stage":stage,"region":region,
                      "reason":reason}), file=sys.stderr, flush=True)
    return reason


def replication(reader):
    stamp = reader.header.get("osmosis_replication_timestamp")
    if not stamp:
        raise ValueError("Missing replication date")
    dt = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if dt.tzinfo is None or not 0 <= (datetime.now(timezone.utc) - dt).total_seconds() < 7*86400:
        raise ValueError("Invalid replication date")
    return stamp, dt


class Downloads:
    def __init__(self, cache, budget, rate):
        self.cache, self.remaining, self.rate = cache, budget, rate
        self.aging = []

    def request(self, url, dest, limit, cached=None, timeout=900):
        for attempt in range(2):
            if self.remaining <= 0:
                raise DownloadError("transfer-quota")
            dest.write_bytes(b"")
            cmd = ["curl", "--silent", "--show-error", "--fail", "--proto", "=https", "--location",
                   "--proto-redir", "=https", "--max-redirs", "2", "--remote-time",
                   "--connect-timeout", "20", "--max-time", str(timeout), "--limit-rate", self.rate,
                   "--max-filesize", str(min(limit, self.remaining)), "--output", str(dest),
                   "--write-out", "%{http_code}", "--user-agent", "Littora/0.1 (+https://github.com/ActuatorIO-Foundry/littora)"]
            if cached and cached.is_file():
                cmd.extend(["--time-cond", str(cached)])
            result = subprocess.run([*cmd, url], capture_output=True, text=True)
            self.remaining -= dest.stat().st_size
            transient = transfer_reason(result) in TRANSIENT
            if not transient or attempt or self.remaining <= 0:
                return result
            time.sleep(3)

    def get(self, name, path, limit):
        target = self.cache / name
        pbf = name.endswith("-latest.osm.pbf")
        with tempfile.NamedTemporaryFile(dir=self.cache, suffix=".osm.pbf" if pbf else ".poly") as tmp:
            dest = Path(tmp.name)
            result = self.request(ROOT + path, dest, limit, cached=target)
            if pbf and (result.returncode == 47 or result.returncode == 22 and result.stdout in {"404", "410"}):
                # Only the publisher's dated file for this exact region is eligible.
                index = self.request(urljoin(ROOT+path,"./"), dest, MIB, timeout=20)
                if index.returncode and transfer_reason(index) in STOP_PROVIDER | TRANSIENT:
                    raise DownloadError(transfer_reason(index))
                links = DatedLinks(path)
                if index.returncode == 0 and index.stdout == "200":
                    links.feed(dest.read_text())
                if not links.links:
                    raise DownloadError("edition-index")
                result = self.request(max(links.links), dest, limit, cached=target)
            if result.returncode:
                raise DownloadError(transfer_reason(result))
            if result.stdout == "304" and target.is_file():
                return target
            if result.stdout != "200" or not dest.stat().st_size:
                raise DownloadError("invalid-response")
            if pbf:
                _, incoming = replication(osm["open_extract"](dest))
                if target.is_file():
                    try:
                        _, existing = replication(osm["open_extract"](target))
                    except (ValueError, OSError, RuntimeError):
                        existing = None
                    if existing and incoming < existing:
                        raise DownloadError("older-edition")
            else:
                polygon(dest)
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


def plan(sites, shapes, allow_partial=True):
    groups, uncovered = defaultdict(list), []
    for site in sites:
        disk = window(site)
        region = next((r for r, p in shapes.items() if p.covers(disk)), None)
        if region:
            groups[region].append({**site,"completeWindow":True})
        elif allow_partial:
            # E.g. a border or a coastal extract cut offshore: publish positive evidence only.
            overlaps = [(p.intersection(disk).area, r) for r,p in shapes.items() if p.covers(Point(site["lon"], site["lat"]))]
            if overlaps:
                groups[max(overlaps)[1]].append({**site,"completeWindow":False})
            else:
                uncovered.append(site["id"])
        else:
            uncovered.append(site["id"])
    return groups, uncovered


def bundle(region, sites, downloads):
    name = region + "-latest.osm.pbf"
    path = region + "/" + name
    pbf = downloads.get(name, path, 650*MIB)
    reader = osm["open_extract"](pbf)
    date, edition = replication(reader)
    age = (datetime.now(timezone.utc)-edition).total_seconds()
    if age >= 48*3600:
        downloads.aging.append(region)
        print(f"{region}: replication older than 48 h", file=sys.stderr)
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


def prepare(sites, downloads, allowed, manifest, plan_only=False):
    shapes, missing = {}, set()
    consecutive = 0
    for r in REGIONS:
        try:
            shapes[r] = polygon(downloads.get(r+".poly", r+"/"+r+".poly", MIB))
            consecutive = 0
        except (ValueError, OSError, RuntimeError, ShapelyError) as error:
            reason = failure("boundary", r, error)
            missing.add(r)
            if reason in STOP_PROVIDER:
                return 2
            consecutive = consecutive + 1 if reason in TRANSIENT else 0
            # A shared transport outage needs a later preflight, not 22 requests in a row.
            if consecutive >= 2:
                return 75
    groups, uncovered = plan(sites, shapes, allow_partial=not missing)
    print(json.dumps({"sites":len(sites),"regions":{r:len(v) for r,v in groups.items()},
                      "uncovered":len(uncovered),"missingBoundaries":len(missing)}), flush=True)
    incomplete = bool(missing or uncovered)
    if not plan_only:
        for r in sorted(allowed & groups.keys()):
            try:
                out = bundle(r, groups[r], downloads)
                print(str(out.resolve()), file=manifest, flush=True)
                print(f"{r}: {len(groups[r])} inventories prepared", flush=True)
            except (ValueError, OSError, RuntimeError, ShapelyError) as error:
                incomplete = True
                if failure("extract", r, error) in STOP_PROVIDER:
                    break
    return 2 if incomplete or downloads.aging else 0


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
    with args.manifest.open("w") as manifest:
        return prepare(sites, downloads, allowed, manifest, args.plan)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit("Inventory cycle failed: check inputs, provider and storage.")
