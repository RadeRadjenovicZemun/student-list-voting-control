#!/usr/bin/env python3
"""Collect region and municipality data without iterating individual voting places.

This script is intentionally limited to:
  - region loop
  - municipality loop
  - no Biračko mesto / place iteration

It writes a comparison file that can be used to compare the live RIK enumeration
with the local canonical config at the region and municipality level.

Usage:
  python3 tools/fetch_rik_region_municipality_only.py --output-dir data
  python3 tools/fetch_rik_region_municipality_only.py --output-dir data --regions "Београдски регион"
  python3 tools/fetch_rik_region_municipality_only.py --output-dir data --dry-run
"""

import argparse
import csv
import json
import re
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except Exception as exc:  # pragma: no cover
    raise SystemExit("ERROR: playwright is not installed. Run: pip install playwright && playwright install") from exc

KEYWORDS_REGION = ["region", "regi", "regioni", "regija"]
KEYWORDS_MUN = ["opst", "opšt", "opština", "municip", "opstina", "opstine"]


def extract_select_options(page, keywords):
    js = """
    (() => {
      const selects = Array.from(document.querySelectorAll('select'));
      function findByKeywords(keys){
        keys = keys.map(k => k.toLowerCase());
        for (const s of selects) {
          const id = s.id || '';
          const name = s.name || '';
          const parentText = (s.parentElement && s.parentElement.textContent) ? s.parentElement.textContent.toLowerCase() : '';
          const prevText = (s.previousElementSibling && s.previousElementSibling.textContent) ? s.previousElementSibling.textContent.toLowerCase() : '';
          const labelEl = (id && document.querySelector('label[for="' + id + '"]')) ? document.querySelector('label[for="' + id + '"]').textContent : '';
          const txt = (id + ' ' + name + ' ' + parentText + ' ' + prevText + ' ' + labelEl).toLowerCase();
          for (const k of keys) if (txt.includes(k)) return s;
        }
        return null;
      }
      const keys = {keywords};
      const sel = findByKeywords(keys) || selects[0] || null;
      if (!sel) return null;
      const options = Array.from(sel.options || []).map(o => ({ value: o.value, text: o.text.trim() }));
      return { selectId: sel.id || null, selectName: sel.name || null, options };
    })();
    """.replace('{keywords}', json.dumps(keywords))
    return page.evaluate(js)


def select_option_by_value(page, select_id, value):
    if not select_id:
        return False
    try:
        page.evaluate(
            "(function(selId, val){ const s = document.getElementById(selId); if (!s) return false; s.value = val; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })(arguments[0], arguments[1])",
            select_id,
            value,
        )
        return True
    except Exception:
        return False


def select_option_by_visible_text(page, text):
    try:
        js_click = """
        (() => {
          const target = arguments[0];
          const selects = Array.from(document.querySelectorAll('select'));
          for (const s of selects) {
            for (const opt of Array.from(s.options || [])) {
              if ((opt.textContent || '').trim().toLowerCase() === target.toLowerCase()) {
                s.value = opt.value;
                s.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
          }
          return false;
        })
        """
        return page.evaluate(js_click, text)
    except Exception:
        return False


def parse_number_from_body(body_text):
    if not body_text:
        return None
    match = re.search(r"Broj upisanih birača\s*\n*\s*([0-9\.,\s]+)", body_text, flags=re.IGNORECASE)
    if match:
        value = match.group(1)
        value = value.replace(".", "").replace(" ", "").replace("\n", "").replace("\r", "").replace("\t", "")
        if value.isdigit():
            return int(value)
    return None


def load_config_totals(config_path):
    config_path = Path(config_path)
    if not config_path.exists():
        return {}
    config = json.loads(config_path.read_text(encoding="utf-8"))
    rows = {}
    for unit in config.get("votingUnits", []):
        for region in unit.get("regions", []):
            region_id = str(region.get("id"))
            region_name = region.get("name")
            for municipality in region.get("municipalities", []):
                municipality_id = str(municipality.get("id"))
                municipality_name = municipality.get("name")
                place_total = 0
                for place in municipality.get("places") or []:
                    try:
                        place_total += int(place.get("registeredVoters") or 0)
                    except Exception:
                        pass
                rows[(region_name, municipality_name)] = {
                    "region_id": region_id,
                    "region_name": region_name,
                    "municipality_id": municipality_id,
                    "municipality_name": municipality_name,
                    "config_total_registered_voters": place_total,
                }
    return rows


def select_option_by_index(page, select_index, option_value):
    try:
        js = """
        (params) => {
          const s = document.querySelectorAll('select')[params.selectIndex];
          if (!s) return false;
          const found = Array.from(s.options).find(o => String(o.value) === String(params.optionValue));
          if (!found) return false;
          s.value = found.value;
          s.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        """
        return page.evaluate(js, {"selectIndex": select_index, "optionValue": option_value})
    except Exception:
        return False


def get_select_options(page, select_index):
    js = """
    (params) => {
      const s = document.querySelectorAll('select')[params.selectIndex];
      if (!s) return [];
      return Array.from(s.options).map(o => ({ value: String(o.value), text: (o.textContent || '').trim() }));
    }
    """
    return page.evaluate(js, {"selectIndex": select_index})


def build_live_rows(page, region_filter=None):
    if page.locator("select").count() < 4:
        raise RuntimeError("Not enough selects found on the page to iterate region and municipality levels")

    region_options = get_select_options(page, 2)
    region_rows = []
    region_summary_rows = []

    for region_option in region_options:
        region_value = region_option.get("value")
        region_name = region_option.get("text", "").strip()
        if not region_value or not region_name or region_name.lower().startswith("odaberite"):
            continue
        if region_filter and region_name not in region_filter:
            continue

        if not select_option_by_index(page, 2, region_value):
            continue
        page.wait_for_timeout(600)

        region_total = parse_number_from_body(page.locator("body").inner_text() or "")
        region_summary_rows.append({
            "region_id": str(region_value),
            "region_name": region_name,
            "live_total_registered_voters": region_total,
        })

        municipality_options = get_select_options(page, 3)
        for municipality_option in municipality_options:
            municipality_value = municipality_option.get("value")
            municipality_name = municipality_option.get("text", "").strip()
            if not municipality_value or not municipality_name or municipality_name.lower().startswith("odaberite"):
                continue

            if not select_option_by_index(page, 3, municipality_value):
                continue
            page.wait_for_timeout(400)
            body_text = page.locator("body").inner_text() or ""
            region_rows.append({
                "region_id": str(region_value),
                "region_name": region_name,
                "municipality_id": str(municipality_value),
                "municipality_name": municipality_name,
                "live_total_registered_voters": parse_number_from_body(body_text),
                "live_municipality_count": 1,
            })

    return {"region_summary": region_summary_rows, "municipality_rows": region_rows}


def write_json(path: Path, rows):
    payload = {
        "generated": True,
        "rows": rows,
        "row_count": len(rows),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_csv(path: Path, rows, fieldnames=None):
    if fieldnames is None:
        fieldnames = [
            "region_id",
            "region_name",
            "municipality_id",
            "municipality_name",
            "live_total_registered_voters",
            "config_total_registered_voters",
            "diff",
        ]

    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key) for key in fieldnames})


def main():
    parser = argparse.ArgumentParser(description="Collect region/municipality data without iterating voting places.")
    parser.add_argument("--url", default="https://www.rik.parlament.gov.rs/542645/sr/rezultati/", help="RIK results URL")
    parser.add_argument("--output-dir", default="data", help="Directory to write comparison output")
    parser.add_argument("--config", default="data/config_rik_full_improved.json", help="Local canonical config file")
    parser.add_argument("--regions", help="Optional comma-separated list of region names to limit the run")
    parser.add_argument("--headful", action="store_true", help="Open the browser window for debugging")
    parser.add_argument("--dry-run", action="store_true", help="Show what would run without actually scraping")
    args = parser.parse_args()

    region_filter = None
    if args.regions:
        region_filter = [r.strip() for r in args.regions.split(",") if r.strip()]

    if args.dry_run:
        print("Dry run: would open the RIK page and iterate regions/municipalities without Biračko mesto.")
        print(f"Output directory: {args.output_dir}")
        print(f"Config: {args.config}")
        print(f"Region filter: {region_filter}")
        return

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    config_totals = load_config_totals(args.config)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headful)
        context = browser.new_context(viewport={"width": 1600, "height": 1100})
        page = context.new_page()
        page.goto(args.url, wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(1000)

        # Select the default parliamentary election to make the region/municipality controls visible.
        for label in ["Parlamentarni", "Парламентарни 2023"]:
            try:
                page.locator("select").first.select_option(label=label)
            except Exception:
                pass
        page.wait_for_timeout(1000)

        try:
            page.locator("select").nth(1).select_option(label="Парламентарни 2023")
        except Exception:
            pass
        page.wait_for_timeout(1500)

        collected = build_live_rows(page, region_filter=region_filter)
        live_region_rows = collected.get("region_summary", [])
        live_rows = collected.get("municipality_rows", [])

    comparison_rows = []
    for row in live_rows:
        region_name = row.get("region_name")
        municipality_name = row.get("municipality_name")
        config_row = config_totals.get((region_name, municipality_name))
        diff = None
        live_total = row.get("live_total_registered_voters")
        config_total = None if config_row is None else config_row.get("config_total_registered_voters")
        if live_total is not None and config_total is not None:
            diff = live_total - config_total

        comparison_rows.append({
            "region_id": row.get("region_id"),
            "region_name": region_name,
            "municipality_id": row.get("municipality_id"),
            "municipality_name": municipality_name,
            "live_total_registered_voters": live_total,
            "config_total_registered_voters": config_total,
            "diff": diff,
        })

    region_comparison_rows = []
    config_region_totals = {}
    config_data = json.loads(Path(args.config).read_text(encoding="utf-8"))
    for unit in config_data.get("votingUnits", []):
        for region in unit.get("regions", []):
            region_name = region.get("name")
            config_region_totals[region_name] = int(region.get("totalRegionRegisteredVoters") or 0)

    for row in live_region_rows:
        region_name = row.get("region_name")
        live_total = row.get("live_total_registered_voters")
        config_total = config_region_totals.get(region_name)
        diff = None
        if live_total is not None and config_total is not None:
            diff = live_total - config_total
        region_comparison_rows.append({
            "region_id": row.get("region_id"),
            "region_name": region_name,
            "live_total_registered_voters": live_total,
            "config_total_registered_voters": config_total,
            "diff": diff,
        })

    combined_rows = []
    region_lookup = {r["region_name"]: r for r in region_comparison_rows}
    for municipality_row in comparison_rows:
        region_name = municipality_row.get("region_name")
        region_meta = region_lookup.get(region_name, {})
        combined_rows.append({
            "region_id": municipality_row.get("region_id"),
            "region_name": region_name,
            "region_live_total_registered_voters": region_meta.get("live_total_registered_voters"),
            "region_config_total_registered_voters": region_meta.get("config_total_registered_voters"),
            "region_diff": region_meta.get("diff"),
            "municipality_id": municipality_row.get("municipality_id"),
            "municipality_name": municipality_row.get("municipality_name"),
            "municipality_live_total_registered_voters": municipality_row.get("live_total_registered_voters"),
            "municipality_config_total_registered_voters": municipality_row.get("config_total_registered_voters"),
            "municipality_diff": municipality_row.get("diff"),
        })

    json_path = output_dir / "rik_region_municipality_comparison.json"
    csv_path = output_dir / "rik_region_municipality_comparison.csv"
    region_json_path = output_dir / "rik_region_summary_comparison.json"
    region_csv_path = output_dir / "rik_region_summary_comparison.csv"
    combined_json_path = output_dir / "rik_region_municipality_combined.json"
    combined_csv_path = output_dir / "rik_region_municipality_combined.csv"
    write_json(json_path, comparison_rows)
    write_csv(csv_path, comparison_rows)
    write_json(region_json_path, region_comparison_rows)
    write_csv(region_csv_path, region_comparison_rows, fieldnames=[
        "region_id",
        "region_name",
        "live_total_registered_voters",
        "config_total_registered_voters",
        "diff",
    ])
    write_json(combined_json_path, combined_rows)
    write_csv(combined_csv_path, combined_rows, fieldnames=[
        "region_id",
        "region_name",
        "region_live_total_registered_voters",
        "region_config_total_registered_voters",
        "region_diff",
        "municipality_id",
        "municipality_name",
        "municipality_live_total_registered_voters",
        "municipality_config_total_registered_voters",
        "municipality_diff",
    ])

    print(f"Wrote comparison JSON: {json_path}")
    print(f"Wrote comparison CSV: {csv_path}")
    print(f"Wrote region summary JSON: {region_json_path}")
    print(f"Wrote region summary CSV: {region_csv_path}")
    print(f"Wrote combined JSON: {combined_json_path}")
    print(f"Wrote combined CSV: {combined_csv_path}")
    print(f"Generated municipality rows: {len(comparison_rows)}")
    print(f"Generated region rows: {len(region_comparison_rows)}")
    print(f"Generated combined rows: {len(combined_rows)}")


if __name__ == "__main__":
    main()
