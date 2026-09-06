#!/usr/bin/env python3
"""
Scrape RIK candidate lists for each election region and store them as JSON.

This script follows the same election selection flow used by the live RIK site:
  Parlamentarni -> Парламентарни 2023 -> region

It outputs one entry per region with the candidate list rows visible on the page.

Example output:
{
  "region": "Београдски регион",
  "candidateList": [
    {"rank": 1, "name": "1. Изборна листа ...", "votes": 354390, "percent": 37.48}
  ]
}
"""

import argparse
import json
import re
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except Exception:
    raise SystemExit("ERROR: playwright is not installed. Install with: pip install playwright && playwright install")

DEFAULT_URL = "https://www.rik.parlament.gov.rs/542645/sr/rezultati/"


def parse_candidate_rows(page):
    rows = []
    for row in page.locator("table tr").all():
        cells = row.locator("td").all()
        if len(cells) < 4:
            continue

        rank_text = (cells[0].inner_text() or "").strip()
        if not re.match(r"^\d+$", rank_text):
            continue

        name = (cells[1].inner_text() or "").strip()
        votes_text = (cells[2].inner_text() or "").strip()
        percent_text = (cells[3].inner_text() or "").strip()

        if not name:
            continue

        votes = None
        if votes_text:
            votes = votes_text.replace(".", "").replace(" ", "")
            try:
                votes = int(votes_text.replace(".", "").replace(" ", ""))
            except ValueError:
                pass

        percent = None
        if percent_text:
            cleaned = percent_text.replace("%", "").replace(",", ".").strip()
            try:
                percent = float(cleaned)
            except ValueError:
                pass

        rows.append({
            "rank": int(rank_text),
            "name": name,
            "votes": votes,
            "percent": percent,
        })

    return rows


def get_option_texts(page, selector):
    return [opt.text_content().strip() for opt in page.locator(selector).locator("option").all()]


def main():
    parser = argparse.ArgumentParser(description="Scrape RIK candidate lists for all regions.")
    parser.add_argument("--url", default=DEFAULT_URL, help="RIK results page URL")
    parser.add_argument("--output", default="data/rik_candidate_lists.json", help="Path to the output JSON file")
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(args.url, wait_until="networkidle", timeout=60000)

        page.select_option("#election-type-select", label="Parlamentarni")
        page.wait_for_timeout(1000)
        page.select_option("#election-round-select", label="Парламентарни 2023")
        page.wait_for_timeout(1500)

        region_selector = page.locator("#election-region-select")
        region_options = region_selector.locator("option").all()
        first_text = (region_options[0].text_content() or "").strip() if region_options else ""

        result = {
            "electionType": "Parlamentarni",
            "electionRound": "Парламентарни 2023",
            "regions": [],
        }

        for i in range(1, len(region_options)):
            region_label = (region_options[i].text_content() or "").strip()
            if not region_label or region_label == first_text:
                continue

            value = region_options[i].get_attribute("value") or str(i)
            page.select_option("#election-region-select", label=region_label)
            page.wait_for_timeout(2000)

            candidates = parse_candidate_rows(page)
            result["regions"].append({
                "id": value,
                "name": region_label,
                "candidateList": candidates,
            })
            print(f"Captured {len(candidates)} candidate rows for {region_label}")

        output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Saved candidate data to {output_path}")
        browser.close()


if __name__ == "__main__":
    main()
