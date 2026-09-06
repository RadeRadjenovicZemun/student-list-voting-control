#!/usr/bin/env python3
"""Fetch aggregate RIK headline numbers from the live results page.

Example:
  python3 tools/fetch_rik_aggregate.py --url "https://www.rik.parlament.gov.rs/542645/sr/rezultati/" --json

This script opens the site, selects the default election context, and extracts:
- Broj upisanih birača
- Broj biračkih mesta
- optionally Broj izašlih birača / other headline counters if present
"""

import argparse
import json
import re
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "ERROR: playwright is not installed. Run: pip install playwright && playwright install"
    ) from exc


def parse_number(value):
    if value is None:
        return None
    text = str(value)
    text = text.replace(".", "").replace(" ", "")
    m = re.search(r"(\d+)", text)
    if not m:
        return None
    return int(m.group(1))


def normalize_text(value):
    return (value or "").replace("\u00a0", " ").strip()


def select_option_if_present(page, select_index, label):
    try:
        sel = page.locator("select").nth(select_index)
        options = sel.locator("option").all_inner_texts()
        normalized = [opt.strip() for opt in options]
        matches = [opt for opt in normalized if label.lower() in opt.lower()]
        if matches:
            sel.select_option(label=matches[0])
            return True
    except Exception:
        pass
    return False


def extract_label_value(body_text, label):
    match = re.search(rf"{re.escape(label)}\s*([0-9][0-9\.\s]*)", body_text, flags=re.IGNORECASE)
    if not match:
        return None
    number = parse_number(match.group(1))
    return number


def fetch_aggregate_data(url, headless=True):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(viewport={"width": 1600, "height": 1100})
        page = context.new_page()
        page.goto(url, wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(1200)

        # The page starts on the default empty state. Select the actual election flow,
        # otherwise the summary counters stay at zero and the fallback heuristics can
        # accidentally grab unrelated small numbers from the page.
        select_option_if_present(page, 0, "Parlamentarni")
        page.wait_for_timeout(1200)
        select_option_if_present(page, 1, "Парламентарни 2023")
        page.wait_for_timeout(1800)

        data = {
            "url": url,
            "date": None,
            "election": None,
            "registeredVoters": None,
            "votingPlaces": None,
            "turnout": None,
            "raw": {},
        }

        # Extract page date/election heading from common top labels.
        date_candidate = page.locator("text=/\\d{2}\\.\\d{2}\\.\\d{4}\\s+\\d{2}:\\d{2}/").first
        try:
            if date_candidate.count():
                d = date_candidate.text_content()
                if d:
                    data["date"] = normalize_text(d)
        except Exception:
            pass

        # Try to find visible election name via a reasonably unique heading.
        election_candidates = [
            "Parlamentarni 2023",
            "Parlamentarni",
        ]
        for candidate in election_candidates:
            try:
                el = page.locator(f"text={candidate}").first
                if el.count() and normalize_text(el.text_content()):
                    data["election"] = candidate
                    break
            except Exception:
                pass

        body_text = (page.locator("body").inner_text() or "")
        for label, key in [
            ("Broj upisanih birača", "registeredVoters"),
            ("Broj biračkih mesta", "votingPlaces"),
            ("Broj izašlih birača", "turnout"),
        ]:
            value = extract_label_value(body_text, label)
            if value is not None:
                data[key] = value

        # Raw snapshot of matching labels from the page.
        raw_lines = []
        for line in body_text.splitlines():
            ls = line.strip()
            if any(token in ls.lower() for token in ["broj upisan", "broj bira", "broj izašli", "broj obrađen", "parlamentarni"]):
                raw_lines.append(ls)
        data["raw"]["headline_lines"] = raw_lines[:30]

        browser.close()
        return data


def main():
    parser = argparse.ArgumentParser(description="Fetch RIK aggregate voting numbers from the live results page.")
    parser.add_argument("--url", default="https://www.rik.parlament.gov.rs/542645/sr/rezultati/", help="RIK results URL")
    parser.add_argument("--json", action="store_true", help="Print JSON output")
    parser.add_argument("--headless", action="store_true", default=True, help="Run browser headless (default)")
    parser.add_argument("--headed", action="store_false", dest="headless", help="Open a visible browser window")
    args = parser.parse_args()

    result = fetch_aggregate_data(args.url, headless=args.headless)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Date: {result.get('date') or 'n/a'}")
        print(f"Election: {result.get('election') or 'n/a'}")
        print(f"Broj upisanih birača: {result.get('registeredVoters') or 'n/a'}")
        print(f"Broj biračkih mesta: {result.get('votingPlaces') or 'n/a'}")
        print(f"Broj izašlih birača: {result.get('turnout') or 'n/a'}")


if __name__ == "__main__":
    main()
