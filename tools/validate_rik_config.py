#!/usr/bin/env python3
"""Clean and validate RIK config JSON.

This tool removes placeholder entries such as "Odaberite ..." and computes/repairs
aggregate fields at the regional level and at the root object.

Usage:
  python3 tools/validate_rik_config.py --path data/config_rik_full_improved.json --fix
"""

import argparse
import json
import re
import unicodedata
from pathlib import Path

PLACEHOLDER_PREFIXES = (
    'odaberite',
    'select',
    'choose',
)


def strip_accents(s):
    if s is None:
        return ''
    s = unicodedata.normalize('NFKD', str(s))
    return ''.join(ch for ch in s if not unicodedata.combining(ch))


def normalize_name(value):
    s = strip_accents(value or '')
    s = s.lower().strip()
    s = s.replace('\n', ' ').replace('\r', ' ')
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'[^a-z0-9\s]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def is_placeholder_name(name):
    normalized = normalize_name(name)
    return any(prefix in normalized for prefix in PLACEHOLDER_PREFIXES)


def as_int(value):
    try:
        return int(value)
    except Exception:
        return None


def sum_registered_from_nodes(nodes):
    total = 0
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        if node.get('name') and is_placeholder_name(node.get('name')):
            continue
        val = as_int(node.get('registeredVoters'))
        if val is not None and val >= 0:
            total += val
        for key in ('municipalities', 'places', 'subPlaces'):
            total += sum_registered_from_nodes(node.get(key))
    return total


def remove_placeholder_entries(node):
    if isinstance(node, list):
        cleaned = []
        for item in node:
            cleaned_item = remove_placeholder_entries(item)
            if cleaned_item is not None:
                cleaned.append(cleaned_item)
        return cleaned

    if not isinstance(node, dict):
        return node

    name = node.get('name')
    if isinstance(name, str) and is_placeholder_name(name):
        return None

    cleaned = {}
    for key, value in node.items():
        if key in ('regions', 'municipalities', 'places', 'subPlaces'):
            cleaned[key] = remove_placeholder_entries(value)
        else:
            cleaned[key] = value
    return cleaned


def normalize_voting_units(config):
    if isinstance(config.get('votingUnits'), list):
        config['id'] = str(config.get('id') or '0')
        config['name'] = config.get('name') or 'Избори Србија'
        return config

    if not isinstance(config.get('regions'), list):
        return config

    existing_name = config.get('name') or 'Изборна јединица Србија'
    unit = {
        'id': config.get('id') or 'izborna-jedinica-srbija',
        'name': existing_name,
        'regions': config.get('regions') or [],
    }
    if 'totalRegions' in config:
        unit['totalRegions'] = config.get('totalRegions')
    if 'totalUnitRegisteredVoters' in config:
        unit['totalUnitRegisteredVoters'] = config.get('totalUnitRegisteredVoters')
    elif 'totalRegisteredVoters' in config:
        unit['totalUnitRegisteredVoters'] = config.get('totalRegisteredVoters')

    return {
        'id': '0',
        'name': 'Избори Србија',
        'totalVotingUnits': 1,
        'votingUnits': [unit],
    }


def assign_numeric_ids(config):
    config['id'] = str(config.get('id') or '0')
    voting_units = config.get('votingUnits') or []
    for unit_index, voting_unit in enumerate(voting_units, start=1):
        if not isinstance(voting_unit, dict):
            continue
        voting_unit['id'] = str(unit_index)
        regions = voting_unit.get('regions') or []
        for region_index, region in enumerate(regions, start=1):
            if not isinstance(region, dict):
                continue
            region['id'] = f"{unit_index}.{region_index}"
            municipalities = region.get('municipalities') or []
            for municipality_index, municipality in enumerate(municipalities, start=1):
                if not isinstance(municipality, dict):
                    continue
                municipality['id'] = f"{region['id']}.{municipality_index}"
                places = municipality.get('places') or []
                for place_index, place in enumerate(places, start=1):
                    if not isinstance(place, dict):
                        continue
                    place['id'] = f"{municipality['id']}.{place_index}"
                    sub_places = place.get('subPlaces') or []
                    for sub_index, sub_place in enumerate(sub_places, start=1):
                        if isinstance(sub_place, dict):
                            sub_place['id'] = f"{place['id']}.{sub_index}"
            direct_places = region.get('places') or []
            for place_index, place in enumerate(direct_places, start=1):
                if not isinstance(place, dict):
                    continue
                place['id'] = f"{region['id']}.{place_index}"
                sub_places = place.get('subPlaces') or []
                for sub_index, sub_place in enumerate(sub_places, start=1):
                    if isinstance(sub_place, dict):
                        sub_place['id'] = f"{place['id']}.{sub_index}"
    return config


def attach_aggregates(config):
    config = normalize_voting_units(config)
    voting_units = config.get('votingUnits') or []
    cleaned_units = []

    for voting_unit in voting_units:
        if not isinstance(voting_unit, dict):
            continue
        regions = voting_unit.get('regions') or []
        cleaned_regions = []

        for region in regions:
            if not isinstance(region, dict):
                continue
            if region.get('name') and is_placeholder_name(region.get('name')):
                continue

            for municipality in region.get('municipalities') or []:
                if not isinstance(municipality, dict):
                    continue
                municipality['totalMunicipalityRegisteredVoters'] = sum_registered_from_nodes(municipality.get('places') or [])
                municipality['votingPlacesNumber'] = len([
                    p for p in (municipality.get('places') or [])
                    if isinstance(p, dict) and not is_placeholder_name(p.get('name'))
                ])
                ordered = {
                    'id': municipality.get('id'),
                    'name': municipality.get('name'),
                    'totalMunicipalityRegisteredVoters': municipality.get('totalMunicipalityRegisteredVoters'),
                    'votingPlacesNumber': municipality.get('votingPlacesNumber'),
                    'places': municipality.get('places') or [],
                }
                municipality.clear()
                municipality.update(ordered)

            municipality_total = sum(
                int(m.get('totalMunicipalityRegisteredVoters') or 0)
                for m in (region.get('municipalities') or [])
                if isinstance(m, dict) and not is_placeholder_name(m.get('name'))
            )
            direct_place_total = sum_registered_from_nodes(region.get('places') or [])
            region['votingRegionPlacesNumber'] = sum(
                int(m.get('votingPlacesNumber') or 0)
                for m in (region.get('municipalities') or [])
                if isinstance(m, dict) and not is_placeholder_name(m.get('name'))
            ) + len([
                p for p in (region.get('places') or [])
                if isinstance(p, dict) and not is_placeholder_name(p.get('name'))
            ])
            region['totalRegionRegisteredVoters'] = municipality_total + direct_place_total
            region['totalMunicipalities'] = len([
                m for m in (region.get('municipalities') or []) if isinstance(m, dict) and not is_placeholder_name(m.get('name'))
            ])
            region['totalPlaces'] = region['votingRegionPlacesNumber']
            ordered_region = {
                'id': region.get('id'),
                'name': region.get('name'),
                'totalRegionRegisteredVoters': region.get('totalRegionRegisteredVoters'),
                'votingRegionPlacesNumber': region.get('votingRegionPlacesNumber'),
                'municipalities': region.get('municipalities') or [],
            }
            region.clear()
            region.update(ordered_region)
            cleaned_regions.append(region)

        voting_unit['regions'] = cleaned_regions
        voting_unit['totalRegions'] = len(cleaned_regions)
        voting_unit['totalUnitRegisteredVoters'] = sum(int(r.get('totalRegionRegisteredVoters') or 0) for r in cleaned_regions)
        cleaned_units.append(voting_unit)

    config['id'] = str(config.get('id') or '0')
    config['name'] = config.get('name') or 'Избори Србија'
    config['totalVotingUnits'] = len(cleaned_units)
    config['totalRegisteredVoters'] = sum(int(u.get('totalUnitRegisteredVoters') or 0) for u in cleaned_units)
    config['votingUnitPlacesNumber'] = sum(
        int(r.get('votingRegionPlacesNumber') or 0)
        for u in cleaned_units for r in (u.get('regions') or [])
        if isinstance(r, dict)
    )
    config['votingUnits'] = cleaned_units
    config = assign_numeric_ids(config)
    return config


def main():
    parser = argparse.ArgumentParser(description='Clean and validate a RIK JSON config file.')
    parser.add_argument('--path', default='data/config_rik_full_improved.json', help='Path to JSON config file to clean')
    parser.add_argument('--fix', action='store_true', help='Write the cleaned JSON back to the file')
    args = parser.parse_args()

    path = Path(args.path)
    if not path.exists():
        raise SystemExit(f'File not found: {path}')

    config = json.loads(path.read_text())
    cleaned = remove_placeholder_entries(config)
    cleaned = attach_aggregates(cleaned)

    print(f'Validated {path}')
    print(f'totalRegions={cleaned.get("totalRegions")}')
    print(f'totalUnitRegisteredVoters={cleaned.get("totalUnitRegisteredVoters")}')

    if args.fix:
        tmp = path.with_suffix(path.suffix + '.tmp')
        tmp.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2))
        tmp.replace(path)
        print(f'Wrote cleaned config to {path}')


if __name__ == '__main__':
    main()
