#!/usr/bin/env python3
"""Aggregate candidate vote results from child levels up to the root."""

import argparse
import json
from pathlib import Path

CFG_PATH = Path('/home/rade/VSC/First/data/config_rik_full_improved.json')


def build_zero_result(candidate_ids):
    return {
        'candidateVotes': [{'id': cid, 'votes': 0} for cid in candidate_ids],
        'nonValidVotes': [{'id': '1', 'votes': 0}],
        'nonRegularBallots': 0,
        'remainingBallots': 0,
    }


def zero_bottom_place_results(data, candidate_ids):
    for unit in data.get('votingUnits', []):
        for region in unit.get('regions', []):
            for place in region.get('places', []):
                place['result'] = build_zero_result(candidate_ids)
            for municipality in region.get('municipalities', []):
                for place in municipality.get('places', []):
                    place['result'] = build_zero_result(candidate_ids)
    return data


def remove_legacy_home_totals(data):
    if not isinstance(data, dict):
        return
    data.pop('totalVotedFromHome', None)
    for key in ('votingUnits', 'regions', 'municipalities', 'places', 'subPlaces'):
        for child in data.get(key, []) or []:
            remove_legacy_home_totals(child)


def get_candidate_ids(obj):
    ids = []
    for item in obj.get('candidateVotes', []):
        if item.get('id') is not None:
            ids.append(str(item['id']))
    return ids


def default_candidate_vote_entries(candidate_ids):
    return [{'id': cid, 'votes': 0} for cid in candidate_ids]


def sum_candidate_votes(items):
    totals = {}
    for entry in items or []:
        cid = str(entry.get('id'))
        if cid == '':
            continue
        totals[cid] = int(entry.get('votes', 0) or 0) + totals.get(cid, 0)
    ordered = []
    for cid in sorted(totals.keys(), key=lambda v: int(v) if v.isdigit() else 10**9):
        ordered.append({'id': cid, 'votes': totals[cid]})
    return ordered


def sum_non_valid(items):
    total = 0
    for entry in items or []:
        if entry.get('id') == '1':
            total += int(entry.get('votes', 0) or 0)
    return [{'id': '1', 'votes': total}]


def aggregate_candidates_from_places(places, candidate_ids):
    sums = {cid: 0 for cid in candidate_ids}
    non_valid = 0
    for place in places or []:
        result = place.get('result', {})
        for entry in result.get('candidateVotes', []):
            cid = str(entry.get('id'))
            if cid in sums:
                sums[cid] += int(entry.get('votes', 0) or 0)
        for entry in result.get('nonValidVotes', []):
            if str(entry.get('id')) == '1':
                non_valid += int(entry.get('votes', 0) or 0)
    candidate_votes = [{'id': cid, 'votes': sums.get(cid, 0)} for cid in candidate_ids]
    return candidate_votes, [{'id': '1', 'votes': non_valid}]


def aggregate_child_results(children, candidate_ids):
    sums = {cid: 0 for cid in candidate_ids}
    non_valid = 0
    non_regular = 0
    remaining = 0
    for child in children or []:
        result = child.get('result', {})
        if not isinstance(result, dict):
            continue
        for entry in result.get('candidateVotes', []):
            cid = str(entry.get('id'))
            if cid in sums:
                sums[cid] += int(entry.get('votes', 0) or 0)
        for entry in result.get('nonValidVotes', []):
            if str(entry.get('id')) == '1':
                non_valid += int(entry.get('votes', 0) or 0)
        non_regular += int(result.get('nonRegularBallots', 0) or 0)
        remaining += int(result.get('remainingBallots', 0) or 0)
    return ([{'id': cid, 'votes': sums.get(cid, 0)} for cid in candidate_ids], [{'id': '1', 'votes': non_valid}], non_regular, remaining)


def collect_root_metadata(root_result):
    out = []
    for entry in root_result.get('candidateVotes', []):
        out.append({
            'id': str(entry.get('id')),
            'name': entry.get('name', str(entry.get('id'))),
            'votes': int(entry.get('votes', 0) or 0),
            'alias': entry.get('alias', 'TBD'),
            'percentage': int(entry.get('percentage', 0) or 0),
        })
    return out


def main():
    parser = argparse.ArgumentParser(description='Aggregate candidate vote results up the hierarchy.')
    parser.add_argument(
        '--config',
        default=str(CFG_PATH),
        help='Path to the config JSON file to update.',
    )
    parser.add_argument(
        '--zero-bottom-results',
        '--reset-bottom-results',
        action='store_true',
        help='Reset all voting-place result values to zero before running aggregation.',
    )
    args = parser.parse_args()

    config_path = Path(args.config)
    data = json.loads(config_path.read_text(encoding='utf-8'))
    remove_legacy_home_totals(data)
    root_candidate_meta = collect_root_metadata(data.get('result', {}))
    if not root_candidate_meta and data.get('votingUnits'):
        first_unit = data['votingUnits'][0]
        if 'result' in first_unit and 'candidateVotes' in first_unit['result']:
            root_candidate_meta = [{
                'id': str(e['id']),
                'name': f"{e['id']}",
                'votes': int(e.get('votes', 0) or 0),
                'alias': 'TBD',
                'percentage': 0,
            } for e in first_unit['result']['candidateVotes']]

    candidate_ids = [item['id'] for item in root_candidate_meta] if root_candidate_meta else []
    if not candidate_ids:
        for unit in data.get('votingUnits', []):
            for region in unit.get('regions', []):
                candidate_ids = get_candidate_ids(region.get('result', {}))
                if candidate_ids:
                    break
            if candidate_ids:
                break

    if not candidate_ids:
        raise SystemExit('No candidate IDs found in config; cannot aggregate results.')

    if args.zero_bottom_results:
        data = zero_bottom_place_results(data, candidate_ids)

    for unit in data.get('votingUnits', []):
        for region in unit.get('regions', []):
            for municipality in region.get('municipalities', []):
                municipality_children = list(municipality.get('places', []))
                candidate_votes, non_valid_votes, non_regular, remaining = aggregate_child_results(municipality_children, candidate_ids)
                municipality['result'] = {
                    'candidateVotes': candidate_votes,
                    'nonValidVotes': non_valid_votes,
                    'nonRegularBallots': non_regular,
                    'remainingBallots': remaining,
                }

            region_children = list(region.get('municipalities', []))
            region_children.extend(region.get('places', []))
            region_candidate_votes, region_non_valid_votes, region_non_regular, region_remaining = aggregate_child_results(region_children, candidate_ids)
            region['result'] = {
                'candidateVotes': region_candidate_votes,
                'nonValidVotes': region_non_valid_votes,
                'nonRegularBallots': region_non_regular,
                'remainingBallots': region_remaining,
            }

        unit_candidate_votes, unit_non_valid_votes, unit_non_regular, unit_remaining = aggregate_child_results(unit.get('regions', []), candidate_ids)
        unit['result'] = {
            'candidateVotes': unit_candidate_votes,
            'nonValidVotes': unit_non_valid_votes,
            'nonRegularBallots': unit_non_regular,
            'remainingBallots': unit_remaining,
        }

    root_candidate_votes, root_non_valid_votes, root_non_regular, root_remaining = aggregate_child_results(data.get('votingUnits', []), candidate_ids)
    root_meta = []
    if root_candidate_meta:
        for entry in root_candidate_meta:
            cid = str(entry['id'])
            root_meta.append({
                'id': cid,
                'name': entry.get('name', cid),
                'votes': next((item['votes'] for item in root_candidate_votes if str(item['id']) == cid), 0),
                'alias': entry.get('alias', 'TBD'),
                'percentage': 0,
            })
    data['result'] = {
        'candidateVotes': root_meta if root_meta else [
            {'id': cid, 'name': cid, 'votes': next((item['votes'] for item in root_candidate_votes if str(item['id']) == cid), 0), 'alias': 'TBD', 'percentage': 0}
            for cid in candidate_ids
        ],
        'nonValidVotes': [{'id': '1', 'name': 'Неважећи листићи', 'votes': root_non_valid_votes[0]['votes'], 'alias': 'Н.Л.', 'percentage': 0}],
        'nonRegularBallots': root_non_regular,
        'remainingBallots': root_remaining,
    }

    config_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    mode_label = 'zeroed and aggregated' if args.zero_bottom_results else 'aggregated'
    print(f'All result values were {mode_label} from places -> municipalities -> regions -> units -> root.')


if __name__ == '__main__':
    main()
