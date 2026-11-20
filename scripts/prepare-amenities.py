"""Prepare a bounded OSM France extract for the offline amenities importer (pyosmium)."""
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

import osmium


keys = ("amenity", "shop", "rental", "emergency", "lifeguard")


def open_extract(path):
    return osmium.FileProcessor(path).with_locations("sparse_mem_array").with_areas(osmium.filter.KeyFilter(*keys))


def objects(reader):
    keep = (*keys, "name", "access", "disused", "abandoned")
    for obj in reader.with_filter(osmium.filter.KeyFilter(*keys)):
        if obj.is_node():
            if not obj.location.valid():
                continue
            lat, lon, kind, ident = obj.location.lat, obj.location.lon, "node", obj.id
        else:
            if obj.is_way():
                nodes, kind, ident = obj.nodes, "way", obj.id
            elif obj.is_area() and not obj.from_way():
                nodes = (n for ring in obj.outer_rings() for n in ring)
                kind, ident = "relation", obj.orig_id()
            else:
                continue
            locations = [n.location for n in nodes]
            if not locations or not all(p.valid() for p in locations):
                continue
            lat = (min(p.lat for p in locations) + max(p.lat for p in locations)) / 2
            lon = (min(p.lon for p in locations) + max(p.lon for p in locations)) / 2
        yield dict(type=kind, id=ident, lat=lat, lon=lon,
                                 timestamp=obj.timestamp.isoformat(),
                                 tags={k: obj.tags[k] for k in keep if k in obj.tags})


def prepare(path, source, bounds):
    south, west, north, east = bounds
    if not (41 <= south < north <= 52 and -6 <= west < east <= 10 and
            north - south <= 0.5 and east - west <= 0.5):
        raise ValueError("Expected a small metropolitan window (south west north east)")
    if not source.startswith("https://download.openstreetmap.fr/extracts/europe/france/") or not (
            Path(urlsplit(source).path).name == path.name and path.name.endswith("-latest.osm.pbf")):
        raise ValueError("Source must identify the original department extract")
    reader = open_extract(path)
    date = reader.header.get("osmosis_replication_timestamp")
    if not date:
        raise ValueError("Missing replication date")
    elements = []
    for obj in objects(reader):
        if south <= obj["lat"] <= north and west <= obj["lon"] <= east:
            elements.append(obj)
            if len(elements) > 5000:
                raise ValueError("Window too large; narrow it before importing")
    return dict(version=1, source=source, asOf=date, bounds=bounds, elements=elements)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("pbf", type=Path)
    cli.add_argument("source")
    cli.add_argument("bounds", nargs=4, type=float)
    args = cli.parse_args()
    json.dump(prepare(args.pbf, args.source, args.bounds), sys.stdout, separators=(",", ":"), allow_nan=False)
