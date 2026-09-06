#!/usr/bin/env python3
"""Collect aggregate RIK data from checkpoint files.

Usage:
  python3 tools/aggregate_rik_data.py --checkpoints-dir data/checkpoints --config data/config_rik_full_improved.json --json

The script reads region_*.json checkpoint files, ignores placeholder entries,
computes municipal and regional aggregates, and compares them against the
canonical config file.
"""

import argparse
import json
import re
import unicodedata
from pathlib import Path

PLACEHOLDER_PREFIXES = ("odaberite", "select", "choose")


def strip_accents(value):
    if value is None:
        return ""
    value = unicodedata.normalize("NFKD", str(value))
    return "".join(ch for ch in value if not unicodedata.combining(ch))


def normalize_name(value):
    value = strip_accents(value or "")
    value = value.lower().strip()
    value = value.replace("\n", " ").replace("\r", " ")
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def is_placeholder_name(name):
    normalized = normalize_name(name)
    return any(prefix in normalized for prefix in PLACEHOLDER_PREFIXES)


def as_int(value):
    try:
        return int(value)
    except Exception:
        return 0


def sum_place_values(nodes):
    total = 0
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        if is_placeholder_name(node.get("name")):
            continue
        total += as_int(node.get("registeredVoters"))
        total += sum_place_values(node.get("places"))
        total += sum_place_values(node.get("subPlaces"))
    return total


def summarize_region(region_data):
    region_name = region_data.get("name") or ""
    municipality_totals = []
    total_municipality_voters = 0

    for municipality in region_data.get("municipalities") or []:
        if not isinstance(municipality, dict):
            continue
        if is_placeholder_name(municipality.get("name")):
            continue

        municipality_places = municipality.get("places") or []
        place_total = 0
        for place in municipality_places:
            if not isinstance(place, dict):
                continue
            if is_placeholder_name(place.get("name")):
                continue
            place_total += as_int(place.get("registeredVoters"))

        municipality_totals.append({
            "id": municipality.get("id"),
            "name": municipality.get("name"),
            "registeredVoters": place_total,
            "votingPlacesNumber": len([
                p for p in municipality_places if isinstance(p, dict) and not is_placeholder_name(p.get("name"))
            ]),
        })
        total_municipality_voters += place_total

    direct_region_places = region_data.get("places") or []
    direct_region_total = 0
    for place in direct_region_places:
        if not isinstance(place, dict):
            continue
        if is_placeholder_name(place.get("name")):
            continue
        direct_region_total += as_int(place.get("registeredVoters"))

    total = total_municipality_voters + direct_region_total
    return {
        "id": region_data.get("id"),
        "name": region_name,
        "totalRegionRegisteredVoters": total,
        "votingRegionPlacesNumber": sum(
            int(m.get("votingPlacesNumber", 0)) for m in municipality_totals
        ) + len([
            p for p in direct_region_places if isinstance(p, dict) and not is_placeholder_name(p.get("name"))
        ]),
        "municipalities": municipality_totals,
    }


def collect_checkpoint_totals(checkpoints_dir):
    region_summaries = []
    checkpoints = sorted(Path(checkpoints_dir).glob("region_*.json"))
    for checkpoint in checkpoints:
        if checkpoint.name == "region_0.json":
            continue
        try:
            data = json.loads(checkpoint.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        region_summary = summarize_region(data)
        region_summaries.append(region_summary)
    return region_summaries


def build_summary_from_config(config_path):
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    result = []
    for unit in config.get("votingUnits", []):
        for region in unit.get("regions", []):
            result.append({
                "id": region.get("id"),
                "name": region.get("name"),
                "totalRegionRegisteredVoters": region.get("totalRegionRegisteredVoters"),
                "votingRegionPlacesNumber": region.get("votingRegionPlacesNumber"),
            })
    return result


def main():
    parser = argparse.ArgumentParser(description="Collect aggregate RIK data from region checkpoints.")
    parser.add_argument("--checkpoints-dir", default="data/checkpoints", help="Directory containing region_*.json checkpoint files")
    parser.add_argument("--config", default="data/config_rik_full_improved.json", help="Canonical config JSON to compare against")
    parser.add_argument("--json", action="store_true", help="Print results as JSON")
    args = parser.parse_args()

    checkpoints_dir = Path(args.checkpoints_dir)
    checkpoint_regions = collect_checkpoint_totals(checkpoints_dir)
    config_regions = build_summary_from_config(args.config)

    by_id = {item["id"]: item for item in config_regions}
    diffs = []
    for region in checkpoint_regions:
        rid = region["id"]
        expected = by_id.get(rid)
        expected_total = expected["totalRegionRegisteredVoters"] if expected else None
        diff = region["totalRegionRegisteredVoters"] - expected_total if expected_total is not None else None
        diffs.append({
            "id": rid,
            "name": region["name"],
            "checkpoint_total": region["totalRegionRegisteredVoters"],
            "config_total": expected_total,
            "diff": diff,
        })

    overall_checkpoint_total = sum(r["totalRegionRegisteredVoters"] for r in checkpoint_regions)
    overall_config_total = sum(int(r["totalRegionRegisteredVoters"]) for r in config_regions)

    summary = {
        "regions": checkpoint_regions,
        "totalCheckpointRegions": len(checkpoint_regions),
        "totalCheckpointRegisteredVoters": overall_checkpoint_total,
        "totalConfigRegisteredVoters": overall_config_total,
        "totalDiff": overall_checkpoint_total - overall_config_total,
        "differences": diffs,
    }

    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    print(f"Checkpoint regions: {summary['totalCheckpointRegions']}")
    print(f"Checkpoint total: {summary['totalCheckpointRegisteredVoters']}")
    print(f"Config total: {summary['totalConfigRegisteredVoters']}")
    print(f"Difference: {summary['totalDiff']}")
    for item in diffs:
        if item["diff"] not in (None, 0):
            print(f"Mismatch {item['id']} {item['name']}: checkpoint={item['checkpoint_total']} config={item['config_total']} diff={item['diff']}")


if __name__ == "__main__":
    main()
