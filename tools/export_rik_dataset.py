#!/usr/bin/env python3
"""Flatten the canonical RIK hierarchy into one row per place.

Usage:
  python3 tools/export_rik_dataset.py --config data/config_rik_full_improved.json --output-dir data

This outputs:
  - data/rik_dataset_flattened.json
  - data/rik_dataset_flattened.csv

The JSON contains metadata plus one record per voting place, with the full
region -> municipality -> place path preserved for downstream analysis.
"""

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path


def as_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def collect_flattened_records(config):
    records = []
    for unit in config.get("votingUnits", []):
        unit_id = unit.get("id")
        unit_name = unit.get("name")
        for region in unit.get("regions", []):
            region_id = region.get("id")
            region_name = region.get("name")
            region_total = as_int(region.get("totalRegionRegisteredVoters"))

            for municipality in region.get("municipalities", []):
                municipality_id = municipality.get("id")
                municipality_name = municipality.get("name")
                municipality_total = as_int(municipality.get("totalMunicipalityRegisteredVoters"))
                places = municipality.get("places") or []
                for place in places:
                    if not isinstance(place, dict):
                        continue
                    records.append({
                        "unit_id": unit_id,
                        "unit_name": unit_name,
                        "region_id": region_id,
                        "region_name": region_name,
                        "region_total_registered_voters": region_total,
                        "municipality_id": municipality_id,
                        "municipality_name": municipality_name,
                        "municipality_total_registered_voters": municipality_total,
                        "place_id": place.get("id"),
                        "place_name": place.get("name"),
                        "registered_voters": as_int(place.get("registeredVoters")),
                        "match_score": place.get("matchScore"),
                        "sender_count": len(place.get("senders") or []),
                        "has_sender_data": bool(place.get("senders")),
                    })

            for direct_place in region.get("places") or []:
                if not isinstance(direct_place, dict):
                    continue
                municipality_id = None
                municipality_name = None
                municipality_total = None
                records.append({
                    "unit_id": unit_id,
                    "unit_name": unit_name,
                    "region_id": region_id,
                    "region_name": region_name,
                    "region_total_registered_voters": region_total,
                    "municipality_id": municipality_id,
                    "municipality_name": municipality_name,
                    "municipality_total_registered_voters": municipality_total,
                    "place_id": direct_place.get("id"),
                    "place_name": direct_place.get("name"),
                    "registered_voters": as_int(direct_place.get("registeredVoters")),
                    "match_score": direct_place.get("matchScore"),
                    "sender_count": len(direct_place.get("senders") or []),
                    "has_sender_data": bool(direct_place.get("senders")),
                })
    return records


def write_json(output_path, records, config_path):
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": str(config_path),
        "total_records": len(records),
        "total_registered_voters": sum(r.get("registered_voters", 0) for r in records),
        "records": records,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_csv(output_path, records):
    fieldnames = [
        "unit_id",
        "unit_name",
        "region_id",
        "region_name",
        "region_total_registered_voters",
        "municipality_id",
        "municipality_name",
        "municipality_total_registered_voters",
        "place_id",
        "place_name",
        "registered_voters",
        "match_score",
        "sender_count",
        "has_sender_data",
    ]
    with output_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow({key: record.get(key) for key in fieldnames})


def main():
    parser = argparse.ArgumentParser(description="Flatten the canonical RIK config into a CSV/JSON dataset.")
    parser.add_argument("--config", default="data/config_rik_full_improved.json", help="Canonical config JSON path")
    parser.add_argument("--output-dir", default="data", help="Directory to write flattened export files")
    parser.add_argument("--json-only", action="store_true", help="Write JSON only")
    parser.add_argument("--csv-only", action="store_true", help="Write CSV only")
    args = parser.parse_args()

    config_path = Path(args.config)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    rows = collect_flattened_records(config)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    json_path = output_dir / "rik_dataset_flattened.json"
    csv_path = output_dir / "rik_dataset_flattened.csv"

    if not args.csv_only:
        write_json(json_path, rows, config_path)
    if not args.json_only:
        write_csv(csv_path, rows)

    print(f"Flattened records: {len(rows)}")
    print(f"Total voter count: {sum(r.get('registered_voters', 0) for r in rows)}")
    if not args.csv_only:
        print(f"JSON written to: {json_path}")
    if not args.json_only:
        print(f"CSV written to: {csv_path}")


if __name__ == "__main__":
    main()
