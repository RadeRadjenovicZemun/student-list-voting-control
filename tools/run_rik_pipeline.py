#!/usr/bin/env python3
"""Run the full RIK collection pipeline in one command.

This script is the end-to-end workflow for the project:
  1) scrape the live RIK site region-by-region and municipality-by-municipality
  2) assemble the full config JSON
  3) export a flattened CSV/JSON analysis dataset
  4) compare totals against the canonical config and print summary results

Usage examples:
  python3 tools/run_rik_pipeline.py --output-dir data
  python3 tools/run_rik_pipeline.py --output-dir data --skip-export
  python3 tools/run_rik_pipeline.py --output-dir data --regions "Београдски регион,Регион Војводине"
  python3 tools/run_rik_pipeline.py --output-dir data --dry-run
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def run_command(cmd, description, dry_run=False):
    print(f"\n> {description}")
    print("   ", " ".join(cmd))
    if dry_run:
        return 0
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        raise SystemExit(f"Command failed ({result.returncode}): {' '.join(cmd)}")
    return result.returncode


def resolve_config_path(output_dir: Path, preferred: str) -> Path:
    preferred_name = preferred or "config.json"
    candidates = [
        output_dir / "checkpoints" / preferred_name,
        output_dir / "checkpoints" / "config.json",
        output_dir / preferred_name,
        output_dir / "config.json",
        output_dir / "config_rik_full_improved.json",
        output_dir / "config_rik_full.json",
        Path("data") / "checkpoints" / "config.json",
        Path("data") / "config.json",
        Path("data") / "config_rik_full_improved.json",
        Path("data") / "config_rik_full.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return output_dir / "checkpoints" / preferred_name


def main():
    parser = argparse.ArgumentParser(description="Run the full RIK data collection pipeline.")
    parser.add_argument("--url", default="https://www.rik.parlament.gov.rs/542645/sr/rezultati/", help="RIK results URL")
    parser.add_argument("--output-dir", default="data", help="Directory where checkpoints and export files are written")
    parser.add_argument("--regions", default=None, help="Optional comma-separated list of region names to collect")
    parser.add_argument("--headful", action="store_true", help="Open a visible browser window for debugging")
    parser.add_argument("--interactive", action="store_true", help="Pause for manual selection in the browser")
    parser.add_argument("--skip-fetch", action="store_true", help="Skip the scraper and only export/compare existing files")
    parser.add_argument("--skip-export", action="store_true", help="Skip flattening to CSV/JSON export")
    parser.add_argument("--skip-compare", action="store_true", help="Skip the aggregate comparison summary")
    parser.add_argument("--config", default="config.json", help="Target config filename to write from checkpoints. Relative paths are resolved inside --output-dir. Default: config.json")
    parser.add_argument("--dry-run", action="store_true", help="Print the commands without running them")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    fetch_script = Path(__file__).resolve().with_name("fetch_rik.py")
    export_script = Path(__file__).resolve().with_name("export_rik_dataset.py")
    compare_script = Path(__file__).resolve().with_name("aggregate_rik_data.py")

    if not args.skip_fetch:
        cmd = [
            sys.executable,
            str(fetch_script),
            "--url",
            args.url,
            "--output-dir",
            str(output_dir),
            "--checkpoints",
            "--full-import",
        ]
        if args.headful:
            cmd.append("--headful")
        if args.interactive:
            cmd.append("--interactive")
        if args.regions:
            cmd.extend(["--regions", args.regions])
        run_command(cmd, "Scraping all selected RIK regions, municipalities and voting places", dry_run=args.dry_run)

    config_path = resolve_config_path(output_dir, args.config)
    if not args.skip_export:
        cmd = [
            sys.executable,
            str(export_script),
            "--config",
            str(config_path),
            "--output-dir",
            str(output_dir),
        ]
        run_command(cmd, "Flattening the canonical config into a CSV/JSON analysis dataset", dry_run=args.dry_run)

    if not args.skip_compare:
        checkpoints_dir = output_dir / "checkpoints"
        if checkpoints_dir.exists():
            cmd = [
                sys.executable,
                str(compare_script),
                "--checkpoints-dir",
                str(checkpoints_dir),
                "--config",
                str(config_path),
                "--json",
            ]
            run_command(cmd, "Comparing checkpoint totals against the canonical config", dry_run=args.dry_run)
        else:
            print(f"\nNo checkpoints directory found at {checkpoints_dir}; skipping comparison.")

    print("\nPipeline complete.")
    print(f"Canonical config: {config_path}")
    print(f"Flat export: {output_dir / 'rik_dataset_flattened.csv'}")
    print(f"Flat export JSON: {output_dir / 'rik_dataset_flattened.json'}")


if __name__ == "__main__":
    main()
