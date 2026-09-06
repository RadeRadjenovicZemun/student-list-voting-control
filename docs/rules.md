Project data cleaning and matching rules

1. Placeholder detection and filtering

- Treat any place/municipality/region name that begins (case-insensitive) with the following prefixes as placeholders and ignore them in aggregates and automatic matching:
  - "Odaberite", "Odaberite opštinu", "Odaberite biračko mesto"
  - "Select", "Choose", and local language equivalents (add as discovered)
- Names that are exactly numeric, extremely short (<3 chars), or identical to the region/municipality name should be treated as suspect and flagged.
- When placeholder entries are found in the scraped structure, keep them in checkpoints but exclude them from aggregated sums and auto-match routines.

2. registeredVoters handling and aggregation

- registeredVoters at the place/subPlace level must be integers >= 0.
- When computing aggregated totals for municipalities or regions:
  - Exclude placeholder entries (see rule #1).
  - Sum only from non-placeholder places (including subPlaces).
  - Provide both "rawSum" (sum of all numeric entries found) and "verifiedSum" (after placeholder filtering).
- Flag a place when registeredVoters changes by more than a configurable threshold (default: 50%) between consecutive checkpoints; log these for manual review.
- If a place's registeredVoters equals a site-wide page counter (e.g., very large number matching totals), suspect extraction error and flag for manual inspection.

3. Name normalization and matching strategy

- Normalization pipeline applied to any name before matching:
  1. Trim whitespace and collapse internal whitespace to a single space.
  2. Lowercase.
  3. Unicode normalization (NFKD) and removal of diacritics.
  4. Transliterate Cyrillic to Latin for Serbian/Croatian/Bosnian names when present (best-effort mapping).
  5. Remove punctuation characters (preserve digits and letters and spaces).
- Matching order and thresholds:
  - First attempt exact normalized match within the same municipality (region+municipality context).
  - If not found, attempt fuzzy matching among municipality candidates using SequenceMatcher or Levenshtein distance.
  - Thresholds:
    - High-confidence auto-assign: >= 0.88
    - Medium-confidence proposal (record but do not auto-assign): 0.74 — 0.88
    - Below 0.74: no match (leave senders as "TBD").
  - If multiple candidates have equal scores, prefer the one whose region/municipality exactly matches the RIK context.

4. Overrides and manual mapping

- Overrides file: data/place_overrides.json (optional). Format:
  {
    "municipality_value": {
      "normalized RIK place text": "override-value-or-visible-text",
      "another place text": "option_value"
    },
    "another_municipality": { ... }
  }
- Overrides take precedence over automatic matching. When an override is present:
  - Attempt to select the given option value first.
  - If not available, attempt to select by visible text fragment.
  - If both fail, log the failure to missing_places.json with reason "override_selection_failed".
- Provide a small CLI utility to add/remove overrides interactively (future task).

5. Interactive fallback and terminal picker

- In interactive (--interactive) runs when auto-selection fails:
  - Extract current visible options and present them in the terminal with indices.
  - Accept index to select, 's' to skip (logs missing_places.json), or Enter to manually select in the browser.
- In non-interactive runs, do not block; log missing_places.json when selection fails.

6. Checkpointing, resume and assembly

- Per-region checkpoint files in data/checkpoints:
  - region_<id>.json — final checkpoint (atomic replace via .tmp)
  - region_<id>.inprogress.json — saved on KeyboardInterrupt or crash
  - progress.json — index of completed_region_ids
- Resume semantics:
  - --resume reads progress.json; for region ids listed there, the script skips processing if region_<id>.json exists and is readable.
  - If inprogress exists for a region but final checkpoint is missing, prefer to reprocess that region unless user indicates otherwise.
- Assemble checkpoints (assemble_checkpoints) reads progress.json or all region_*.json and writes data/config_rik_full.json atomically.

7. Merge policy and backups

- data/config_rik_full.json is an assembled authoritative snapshot of scraped RIK data.
- data/config.json is the system configuration mapping operators to places; merges are append-only by region name unless --replace or explicit mapping is requested.
- Always create timestamped backups before merging; do not overwrite original without creating a backup.

8. Logging and audit

- missing_places.json — append-only log of places where selection or matching failed, with timestamp and context (region, municipality, place id, reason).
- match_proposals.json — store medium-confidence matches with scores and candidate list for human review.
- operations.log — chronological audit of automated assignments, merges, and manual interventions.

9. CLI flags

- --auto-fuzzy-threshold (float, default 0.88)
- --propose-threshold (float, default 0.74)
- --skip-place-patterns (comma-separated list of placeholder prefixes)
- --overrides-file (path, default data/place_overrides.json)
- --verify-aggregates (run post-extract verification and write summary report)

10. Structural schema and identifiers

- The authoritative data file is config_rik_full_improved.json.
- The root MUST be a container for one or more voting units, with a stable parent id, a root name, and a root-level total:
  {
    "id": "0",
    "name": "Избори Србија",
    "totalVotingUnits": 1,
    "totalRegisteredVoters": 13252350,
    "votingUnits": [
      {
        "id": "1",
        "name": "Изборна јединица Србија",
        "totalRegions": 7,
        "totalUnitRegisteredVoters": 13252350,
        "regions": [ ... ]
      }
    ]
  }
- The root id is the parent container id and is set to "0" so all voting-unit ids can start at "1".
- Each voting unit must have a stable numeric-string id (e.g., "1").
- Each region must have a dotted numeric-string id built from its parent hierarchy, for example "1.1" for the first region in the first voting unit.
- Each municipality id must continue the hierarchy: "1.1.1".
- Each place id must continue the hierarchy: "1.1.1.1".
- For nested places/subPlaces, continue the same pattern: "1.1.1.1.1", etc.
- IDs are stored as strings in JSON because they contain dots, but each segment must be an unsigned integer.
- The schema must remain stable across runs; validation should reassign IDs when the hierarchy is rebuilt.

11. Aggregation rules

- Root-level totalRegisteredVoters is the sum of all voting-unit totals.
- Root-level totalUnitRegisteredVoters is not used at the root; the canonical root total is totalRegisteredVoters.
- Root-level votingUnitPlacesNumber is the sum of all regional place counts across the file.
- Region totals are recalculated as the sum of all non-placeholder municipality totals, plus any direct region-level place totals.
- Municipality and region records MUST expose only the explicit aggregate field for that level:
  - Region: totalRegionRegisteredVoters
  - Municipality: totalMunicipalityRegisteredVoters
  - Voting unit: totalUnitRegisteredVoters
  - Root: totalRegisteredVoters, votingUnitPlacesNumber
  - No duplicate registeredVoters field is kept at region or municipality level.
- Formula:
  - totalMunicipalityRegisteredVoters = sum(place.registeredVoters for non-placeholder places in that municipality)
  - votingPlacesNumber = count of non-placeholder place entries under the municipality
  - votingRegionPlacesNumber = sum(votingPlacesNumber for all municipalities in the region) + count(direct region place entries)
  - totalRegionRegisteredVoters = sum(totalMunicipalityRegisteredVoters for all municipalities in the region) + sum(direct region place registeredVoters)
  - totalUnitRegisteredVoters = sum(totalRegionRegisteredVoters for all regions in the voting unit)
  - totalRegisteredVoters = sum(totalUnitRegisteredVoters for all voting units in the file)
  - votingUnitPlacesNumber = sum(votingRegionPlacesNumber for all regions in the file)
- Placeholder entries (names starting with "Odaberite" or equivalent) are excluded from aggregation totals.
- If a placeholder value appears at the top level or in a summary object, it is treated as a sentinel and should not be counted as real voters.

12. Future extensions (notes)

- Add a lightweight UI for reviewing match_proposals and accepting/rejecting.
- Integrate a small testing harness for the scraper (unit tests for JS snippets, heuristics).
- Add optional heuristics for operator mapping using phone-number matching from Signal groups when available.


End of rules document.
