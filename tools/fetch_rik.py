#!/usr/bin/env python3
"""
fetch_rik.py

Playwright-based scraper to extract the full Region→Opština→Biračko mesto structure including "Broj upisanih birača".

Manual / usage examples:
  # interactive first-run flow (recommended)
  python3 tools/fetch_rik.py --output-dir data --full-import --checkpoints --interactive --headful --config my_election_config.json

  # standard non-interactive run
  python3 tools/fetch_rik.py --output-dir data --full-import --checkpoints --config my_election_config.json

  # resume from saved checkpoints
  python3 tools/fetch_rik.py --output-dir data --full-import --checkpoints --resume

  # assemble a final config from checkpoint files only
  python3 tools/fetch_rik.py --output-dir data --assemble-checkpoints --config assembled_config.json

Outputs (in output dir):
  config.json or custom --config file - final assembled config: regions -> municipalities -> places (with registeredVoters)
  checkpoints/region_<id>.json        - per-region intermediate snapshots
  checkpoints/progress.json           - completed region tracking
  rik_municipalities.json             - { selectId, selectName, options: [...] }
  rik_polling_places_by_mun.json      - mapping municipality_value -> { mun_text, places: {...} }

Requirements:
  python3 -m pip install playwright
  python3 -m playwright install

Notes:
- The site is dynamic. Use --interactive the first time to ensure the correct election/round/region is selected manually.
- If automated selections fail because the site uses custom widgets, interactive mode lets you populate controls before extraction.
- For full documentation, see tools/README.md.
"""

import json
import argparse
import os
import re
import time
from pathlib import Path
from datetime import datetime

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print("ERROR: playwright not installed. Install with: pip install playwright && playwright install")
    raise

KEYWORDS_MUN = ['opst', 'opšt', 'opština', 'municip', 'opstina', 'opstine']
KEYWORDS_PLACE = ['bira', 'birack', 'biračko', 'mesto', 'station', 'poll']
KEYWORDS_REGION = ['region', 'regi', 'regioni', 'regija']
KEYWORDS_REGISTERED = ['broj upisan', 'upisanih', 'upisanih bira', 'broj bira', 'upisanih birača', 'upisanih birača']

def as_int(val):
    try:
        return int(val)
    except Exception:
        return None



def is_placeholder_option_text(text):
    if text is None:
        return False
    t = str(text).strip().lower()
    if not t:
        return True
    placeholders = ['odaberite', 'izaberite', 'select', 'choose', 'please select']
    return any(p in t for p in placeholders)


def is_placeholder_region_payload(payload):
    if not isinstance(payload, dict):
        return False
    name = payload.get('name')
    if is_placeholder_option_text(name):
        return True
    municipalities = payload.get('municipalities', [])
    if not municipalities:
        return True
    non_placeholder_muns = [
        m for m in municipalities
        if isinstance(m, dict) and not is_placeholder_option_text(m.get('name'))
    ]
    return len(non_placeholder_muns) == 0


def safe_page_evaluate(page, js, context_name):
    try:
        return page.evaluate(js)
    except Exception as e:
        msg = str(e).lower()
        if 'target crashed' not in msg:
            raise
        print(f"Browser target crashed while evaluating {context_name}; reloading the page and retrying once...")
        try:
            page.reload(wait_until='networkidle', timeout=30000)
            page.wait_for_timeout(1000)
            return page.evaluate(js)
        except Exception:
            raise


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
    return safe_page_evaluate(page, js, 'select extraction')


def extract_candidate_elements(page, keywords):
    js = """
    (() => {
      const keywords = {keywords_json};
      const results = [];
      const all = Array.from(document.querySelectorAll('body *'));
      for (const el of all) {
        const txt = (el.textContent || '').toLowerCase();
        for (const k of keywords) if (txt.includes(k)) {
          results.push({ tag: el.tagName, text: txt.trim().slice(0,200), outerHTML: el.outerHTML.slice(0,2000) });
          break;
        }
      }
      return results.slice(0,200);
    })();
    """.replace('{keywords_json}', json.dumps(keywords))
    return safe_page_evaluate(page, js, 'candidate extraction')


def find_registered_voters(page):
    # improved heuristics: first try known IDs/selectors, then keyword proximity, then visual heuristics
    js = """
    (() => {
      const keywords = %s;
      function extractNumber(s){
        if (!s) return null;
        const m = s.replace(/\./g,'').match(/(\d[\d\s]*\d|\d+)/);
        if (m) return parseInt(m[0].replace(/\s+/g,''), 10);
        return null;
      }

      // 0) Try known IDs and selectors that often contain the total
      const knownSelectors = ['#total_voters', '#total-voters', '#broj_upisanih', '#broj-upisanih', '#broj_upisanih_biraca', '.total-voters', '.broj-upisanih'];
      for (const sel of knownSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el && el.textContent) {
            const n = extractNumber(el.textContent);
            if (n !== null && n > 0) return n;
          }
        } catch(e) {}
      }

      function searchNearby(el){
        // 1) exact element
        const txt = (el.textContent || '').trim();
        const n0 = extractNumber(txt);
        if (n0 !== null && n0 > 0) return n0;
        // 2) immediate siblings
        if (el.nextElementSibling && el.nextElementSibling.textContent) {
          const n1 = extractNumber(el.nextElementSibling.textContent);
          if (n1 !== null && n1 > 0) return n1;
        }
        if (el.previousElementSibling && el.previousElementSibling.textContent) {
          const n2 = extractNumber(el.previousElementSibling.textContent);
          if (n2 !== null && n2 > 0) return n2;
        }
        // 3) children
        for (const c of Array.from(el.querySelectorAll('*'))) {
          const nc = extractNumber(c.textContent || '');
          if (nc !== null && nc > 0) return nc;
        }
        // 4) parent and parent's siblings
        if (el.parentElement) {
          const np = extractNumber(el.parentElement.textContent || '');
          if (np !== null && np > 0) return np;
          if (el.parentElement.nextElementSibling && el.parentElement.nextElementSibling.textContent) {
            const npp = extractNumber(el.parentElement.nextElementSibling.textContent);
            if (npp !== null && npp > 0) return npp;
          }
        }
        return null;
      }

      // 1) Look for keyword-bearing elements and try to extract nearby numbers
      const all = Array.from(document.querySelectorAll('body *'));
      for (const el of all) {
        const txt = (el.textContent || '').toLowerCase();
        for (const k of keywords) {
          if (txt.includes(k)) {
            const found = searchNearby(el);
            if (found !== null) return found;
          }
        }
      }

      // 2) Look for visually prominent numbers: prefer larger font-size and red color (header counters)
      const candidates = [];
      for (const el of all) {
        const txt = (el.textContent || '').trim();
        const n = extractNumber(txt);
        if (n === null) continue;
        // skip small numbers
        if (n <= 10) continue;
        let score = 0;
        try {
          const style = window.getComputedStyle(el);
          const fs = parseFloat(style.fontSize) || 0;
          const color = style.color || '';
          // boost red/orange colors which RIK seems to use for counters
          const isRed = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
          if (isRed) {
            const r = parseInt(isRed[1],10);
            const g = parseInt(isRed[2],10);
            const b = parseInt(isRed[3],10);
            if (r > 150 && g < 100 && b < 100) score += 50;
          }
          score += fs; // bigger font gets higher score
        } catch(e) {}
        candidates.push({n: n, score: score, text: txt.slice(0,120)});
      }
      if (candidates.length) {
        candidates.sort((a,b) => b.score - a.score);
        return candidates[0].n;
      }

      // 3) fallback: any large number on page
      for (const el of all) {
        const n = extractNumber(el.textContent || '');
        if (n && n > 10) return n;
      }
      return null;
    })();
    """ % json.dumps(KEYWORDS_REGISTERED)
    return page.evaluate(js)


def extract_page_totals(page):
    """Read RIK's displayed voter and polling-place totals for the current selection."""
    try:
        body_text = page.locator('body').inner_text() or ''
    except Exception:
        return {}

    lines = [line.strip() for line in body_text.splitlines() if line.strip()]

    def extract_after_label(label):
        for index, line in enumerate(lines):
            if label.lower() not in line.lower():
                continue
            remainder = line.split(label, 1)[-1]
            match = re.search(r'(\d[\d.,\s]*)', remainder)
            if not match and index + 1 < len(lines):
                match = re.search(r'(\d[\d.,\s]*)', lines[index + 1])
            if match:
                value = re.sub(r'[.\s,]', '', match.group(1))
                if value.isdigit():
                    return int(value)
        return None

    totals = {}
    registered_voters = extract_after_label('Broj upisanih birača')
    voting_places = extract_after_label('Broj biračkih mesta')
    if registered_voters is not None:
        totals['registeredVoters'] = registered_voters
    if voting_places is not None:
        totals['votingPlaces'] = voting_places
    return totals


def select_option_by_value(page, select_id, value):
    if not select_id:
        # fallback: try to set first select
        try:
            page.evaluate("(function(v){ const s = document.querySelectorAll('select')[0]; if (!s) return false; s.value=v; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})(arguments[0])", value)
            return True
        except Exception:
            return False
    try:
        page.select_option(f'#{select_id}', value)
        return True
    except Exception:
        # fallback to JS
        try:
            page.evaluate("(function(id,v){ const s = document.getElementById(id); if (!s) return false; s.value=v; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})(arguments[0], arguments[1])", select_id, value)
            return True
        except Exception:
            return False


def select_option_by_visible_text(page, option_text, container_keywords=None):
    """Try to select an option (or click a control) whose visible text contains option_text.
    Returns True if something was done, else False."""
    # 1) Try standard select elements where an option's text contains option_text
    js_select = '(function(opt){' + \
                "const selects = Array.from(document.querySelectorAll('select'));" + \
                "for (const s of selects) {" + \
                "  for (const o of Array.from(s.options || [])) {" + \
                "    if (o.text && o.text.toLowerCase().includes(opt.toLowerCase())) {" + \
                "      s.value = o.value;" + \
                "      s.dispatchEvent(new Event('change', {bubbles:true}));" + \
                "      return true;" + \
                "    }" + \
                "  }" + \
                "}" + \
                "return false;" + \
                "})(arguments[0]);"
    try:
        done = page.evaluate(js_select, option_text)
        if done:
            return True
    except Exception:
        pass

    # 2) Try clickable elements (buttons/links) that contain the text
    try:
        elems = page.query_selector_all('button, a, label, .btn, .option, li')
        for e in elems:
            try:
                txt = (e.inner_text() or '').strip()
                if option_text.lower() in txt.lower():
                    e.click()
                    return True
            except Exception:
                continue
    except Exception:
        pass

    # 3) Try elements by searching text nodes
    try:
        js_click = ('(function(opt){' +
                   "const all = Array.from(document.querySelectorAll('body *'));" +
                   "for (const el of all) {" +
                   "  if ((el.innerText || '').toLowerCase().includes(opt.toLowerCase())) {" +
                   "    // try to find a clickable ancestor" +
                   "    let a = el;" +
                   "    for (let i=0;i<4;i++) {" +
                   "      if (!a) break;" +
                   "      if (a.tagName === 'BUTTON' || a.tagName === 'A') { a.click(); return true; }" +
                   "      a = a.parentElement;" +
                   "    }" +
                   "    try { el.click(); return true; } catch(e) {}" +
                   "  }" +
                   "}" +
                   "return false;" +
                   "})(arguments[0]);")
        done = page.evaluate(js_click, option_text)
        if done:
            return True
    except Exception:
        pass

    return False


def load_place_overrides(out_dir):
    """Load place_overrides.json if present in out_dir. Returns a dict mapping municipality_id -> { normalized_place_text: override_value }"""
    try:
        p = Path(out_dir) / 'place_overrides.json'
        if p.exists():
            return json.loads(p.read_text())
    except Exception:
        pass
    return {}


def log_missing_place(out_dir, entry):
    """Append a missing place entry to missing_places.json in out_dir (atomic write)."""
    try:
        p = Path(out_dir) / 'missing_places.json'
        data = []
        if p.exists():
            try:
                data = json.loads(p.read_text()) or []
            except Exception:
                data = []
        data.append(entry)
        tmp = Path(out_dir) / 'missing_places.json.tmp'
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        os.replace(str(tmp), str(p))
        print(f'Logged missing place to {p}')
    except Exception as e:
        print(f'Warning: failed to log missing place: {e}')



def extract_candidate_lists_from_page(page):
    """Extract candidate list rows directly from the table on the RIK page."""
    try:
        rows = []
        for row in page.locator("table tr").all():
            cells = row.locator("td").all()
            if len(cells) < 4:
                continue

            rank_text = (cells[0].inner_text() or "").strip()
            if not re.match(r"^\d+$", rank_text):
                continue

            name = (cells[1].inner_text() or "").strip()
            if not name:
                continue

            rows.append({
                "id": str(rank_text),
                "name": name,
                "votes": 0,
                "alias": "TBD",
                "percentage": 0.0
            })
        return rows
    except Exception as e:
        print(f"Warning: could not extract candidate lists from page table: {e}")
        return []


def load_checkpoint_candidate_votes(checkpoints_dir):
    if not checkpoints_dir:
        return []
    candidate_path = Path(checkpoints_dir) / 'candidates.json'
    if not candidate_path.exists():
        return []
    try:
        data = json.loads(candidate_path.read_text())
        candidates = data.get('candidateVotes', []) if isinstance(data, dict) else []
        return candidates if isinstance(candidates, list) else []
    except Exception as e:
        print(f'Warning: failed to read candidate checkpoint {candidate_path}: {e}')
        return []


def load_checkpoint_candidate_data(checkpoints_dir):
    if not checkpoints_dir:
        return {}
    candidate_path = Path(checkpoints_dir) / 'candidates.json'
    if not candidate_path.exists():
        return {}
    try:
        data = json.loads(candidate_path.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def capture_candidate_checkpoint(page, checkpoints_dir):
    """Capture candidates once, before the region/municipality sweep starts."""
    checkpoints_dir = Path(checkpoints_dir)
    existing_data = load_checkpoint_candidate_data(checkpoints_dir)
    existing = existing_data.get('candidateVotes', [])
    if existing and existing_data.get('RIK_totals'):
        print(f'Using candidate checkpoint: {checkpoints_dir / "candidates.json"}')
        return existing, existing_data['RIK_totals']

    candidates = extract_candidate_lists_from_page(page)
    page_totals = extract_page_totals(page)
    if not candidates:
        print('Warning: no candidate rows found; candidate checkpoint was not written')
        return [], page_totals

    checkpoints_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        'candidateVotes': candidates,
        'RIK_totals': page_totals,
        'capturedAt': datetime.utcnow().isoformat()
    }
    candidate_path = checkpoints_dir / 'candidates.json'
    candidate_tmp = checkpoints_dir / 'candidates.json.tmp'
    candidate_tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    os.replace(str(candidate_tmp), str(candidate_path))
    print(f'Wrote candidate checkpoint: {candidate_path} ({len(candidates)} candidates)')
    return candidates, page_totals


def load_default_candidate_votes(page=None, out_dir=None, checkpoints_dir=None):
    checkpoint_candidates = load_checkpoint_candidate_votes(checkpoints_dir)
    if checkpoint_candidates:
        return checkpoint_candidates

    if page:
        cand_from_page = extract_candidate_lists_from_page(page)
        if cand_from_page:
            return cand_from_page

    candidates = []
    dirs_to_check = [out_dir, Path('data')] if out_dir else [Path('data')]
    for d in dirs_to_check:
        if not d:
            continue
        for candidate_filename in ['config.json', 'config_reconstructed.json', 'rik_candidate_lists.json']:
            candidate_file = Path(d) / candidate_filename
            if candidate_file.exists():
                try:
                    data = json.loads(candidate_file.read_text())
                    if isinstance(data, dict) and 'result' in data and isinstance(data['result'], dict) and 'candidateVotes' in data['result'] and data['result']['candidateVotes']:
                        return data['result']['candidateVotes']
                    if isinstance(data, dict) and 'regions' in data and isinstance(data['regions'], list):
                        for r in data['regions']:
                            if isinstance(r, dict) and 'candidateLists' in r:
                                for item in r['candidateLists']:
                                    candidates.append({
                                        'id': str(item.get('number', '') or item.get('rank', '')),
                                        'name': item.get('name', ''),
                                        'votes': 0,
                                        'alias': item.get('alias', 'TBD'),
                                        'percentage': 0.0
                                    })
                                if candidates:
                                    return candidates
                except Exception:
                    pass
    if not candidates:
        for i in range(1, 19):
            candidates.append({
                'id': str(i),
                'name': f"{i}. ИЗБОРНА ЛИСТА {i}",
                'votes': 0,
                'alias': 'TBD',
                'percentage': 0.0
            })
    return candidates


def load_default_sender_statuses():
    return [
        {'id': '0', 'name': 'Неактиван', 'codeName': 'Passive', 'alias': 'Н'},
        {'id': '1', 'name': 'Присутан', 'codeName': 'Active', 'alias': 'А'},
        {'id': '2', 'name': 'Гласање у току', 'codeName': 'Voting', 'alias': 'Г'},
        {'id': '3', 'name': 'Прекид на изборном месту', 'codeName': 'Stopped', 'alias': 'П'},
        {'id': '4', 'name': 'Бројање гласове', 'codeName': 'Counting', 'alias': 'Б'},
        {'id': '5', 'name': 'Прелиминарни резултати', 'codeName': 'Preliminary', 'alias': 'Р'},
        {'id': '6', 'name': 'Потписан записник', 'codeName': 'Official', 'alias': 'З'}
    ]


def post_process_config(raw_config, page=None, out_dir=None, checkpoints_dir=None):
    """Post-process raw scraped or assembled config.
    Computes summed parameters (totalRegisteredVoters, votingPlacesNumber, etc.) from the level below
    while preserving RIK captured parameters (RIK_totalRegisteredVoters, RIK_votingPlacesNumber, etc.).
    Structures candidate lists with 'name' only at root level, and 'id' only at lower levels.
    """
    candidate_lists_root = load_default_candidate_votes(page, out_dir, checkpoints_dir)
    candidate_lists_lower = [
        {'id': str(c['id']), 'votes': 0, 'alias': c.get('alias', 'TBD'), 'percentage': 0.0}
        for c in candidate_lists_root
    ]
    sender_statuses = load_default_sender_statuses()

    raw_regions = raw_config.get('regions', []) if isinstance(raw_config, dict) else []
    processed_regions = []

    unit_idx = 1
    for r_idx, reg in enumerate(raw_regions, start=1):
        if not isinstance(reg, dict) or is_placeholder_option_text(reg.get('name')):
            continue
        r_id = f"{unit_idx}.{r_idx}"
        raw_muns = reg.get('municipalities', []) or []
        processed_muns = []

        for m_idx, mun in enumerate(raw_muns, start=1):
            if not isinstance(mun, dict) or is_placeholder_option_text(mun.get('name')):
                continue
            m_id = f"{r_id}.{m_idx}"
            raw_places = mun.get('places', []) or []
            processed_places = []

            for p_idx, plc in enumerate(raw_places, start=1):
                if not isinstance(plc, dict) or is_placeholder_option_text(plc.get('name')):
                    continue
                p_id = f"{m_id}.{p_idx}"
                reg_voters = as_int(plc.get('registeredVoters')) or 0
                p_obj = {
                    'id': p_id,
                    'name': plc.get('name'),
                    'timeZone': plc.get('timeZone', 0),
                    'registeredVoters': reg_voters,
                    'correction': plc.get('correction', 0),
                    'voted': plc.get('voted', 0),
                    'votedFromHome': plc.get('votedFromHome', 0),
                    'senderStatus': plc.get('senderStatus', 0),
                    'sender': plc.get('sender', [
                        {
                            'name': 'TBD',
                            'signalUser': 'TBD',
                            'displayName': 'TBD',
                            'surname': 'TBD',
                            'phone': 'TBD',
                            'email': 'TBD',
                            'keep_data': 'NO'
                        }
                    ]),
                    'matchScore': plc.get('matchScore', 0.0),
                    'result': plc.get('result', {
                        'candidateVotes': candidate_lists_lower,
                        'nonValidVotes': [{'id': '1', 'votes': 0}]
                    }),
                    'totalVoted': plc.get('totalVoted', 0),
                    'totalVotedFromHome': plc.get('totalVotedFromHome', 0)
                }
                processed_places.append(p_obj)

            mun_reg_voters_sum = sum(p['registeredVoters'] for p in processed_places)
            mun_places_count = len(processed_places)
            rik_mun_voters = as_int(mun.get('RIK_totalMunicipalityRegisteredVoters')) or mun_reg_voters_sum
            rik_mun_places = as_int(mun.get('RIK_votingPlacesNumber')) or mun_places_count

            m_obj = {
                'id': m_id,
                'name': mun.get('name'),
                'totalMunicipalityRegisteredVoters': mun_reg_voters_sum,
                'RIK_totalMunicipalityRegisteredVoters': rik_mun_voters,
                'votingPlacesNumber': mun_places_count,
                'RIK_votingPlacesNumber': rik_mun_places,
                'voted': mun.get('voted', 0),
                'votedFromHome': mun.get('votedFromHome', 0),
                'result': mun.get('result', {
                    'candidateVotes': candidate_lists_lower,
                    'nonValidVotes': [{'id': '1', 'votes': 0}]
                }),
                'places': processed_places,
                'totalVoted': mun.get('totalVoted', 0),
                'totalVotedFromHome': mun.get('totalVotedFromHome', 0)
            }
            processed_muns.append(m_obj)

        reg_voters_sum = sum(m['totalMunicipalityRegisteredVoters'] for m in processed_muns)
        reg_places_count = sum(m['votingPlacesNumber'] for m in processed_muns)
        rik_reg_voters_sum = sum(m['RIK_totalMunicipalityRegisteredVoters'] for m in processed_muns)
        rik_reg_places_sum = sum(m['RIK_votingPlacesNumber'] for m in processed_muns)
        rik_reg_voters = as_int(reg.get('RIK_totalRegionRegisteredVoters')) or rik_reg_voters_sum or reg_voters_sum
        rik_reg_places = as_int(reg.get('RIK_votingRegionPlacesNumber')) or rik_reg_places_sum or reg_places_count

        r_obj = {
            'id': r_id,
            'name': reg.get('name'),
            'totalRegionRegisteredVoters': reg_voters_sum,
            'RIK_totalRegionRegisteredVoters': rik_reg_voters,
            'votingRegionPlacesNumber': reg_places_count,
            'RIK_votingRegionPlacesNumber': rik_reg_places,
            'voted': reg.get('voted', 0),
            'votedFromHome': reg.get('votedFromHome', 0),
            'result': reg.get('result', {
                'candidateVotes': candidate_lists_lower,
                'nonValidVotes': [{'id': '1', 'votes': 0}]
            }),
            'municipalities': processed_muns,
            'totalVoted': reg.get('totalVoted', 0),
            'totalVotedFromHome': reg.get('totalVotedFromHome', 0)
        }
        processed_regions.append(r_obj)

    tot_voters_sum = sum(r['totalRegionRegisteredVoters'] for r in processed_regions)
    tot_places_count = sum(r['votingRegionPlacesNumber'] for r in processed_regions)
    rik_tot_voters = sum(r['RIK_totalRegionRegisteredVoters'] for r in processed_regions)
    rik_tot_places = sum(r['RIK_votingRegionPlacesNumber'] for r in processed_regions)

    out = {
        'id': '0',
        'name': 'Избори Србија',
        'totalRegisteredVoters': tot_voters_sum,
        'RIK_totalRegisteredVoters': as_int(raw_config.get('RIK_totalRegisteredVoters')) if isinstance(raw_config, dict) and as_int(raw_config.get('RIK_totalRegisteredVoters')) else rik_tot_voters,
        'votingUnitsPlacesNumber': tot_places_count,
        'RIK_votingUnitsPlacesNumber': as_int(raw_config.get('RIK_votingUnitsPlacesNumber')) if isinstance(raw_config, dict) and as_int(raw_config.get('RIK_votingUnitsPlacesNumber')) else rik_tot_places,
        'totalVotingUnits': 1,
        'result': raw_config.get('result', {
            'candidateVotes': candidate_lists_root
        }) if isinstance(raw_config, dict) and 'result' in raw_config and raw_config['result'].get('candidateVotes') else {'candidateVotes': candidate_lists_root},
        'regions': processed_regions,
        'totalVoted': raw_config.get('totalVoted', 0) if isinstance(raw_config, dict) else 0,
        'totalVotedFromHome': raw_config.get('totalVotedFromHome', 0) if isinstance(raw_config, dict) else 0,
        'senderStatuses': raw_config.get('senderStatuses', sender_statuses) if isinstance(raw_config, dict) else sender_statuses,
        'defaultLanguage': raw_config.get('defaultLanguage', 'sr') if isinstance(raw_config, dict) else 'sr',
        'multiLanguage': raw_config.get('multiLanguage', {}) if isinstance(raw_config, dict) else {},
        'templates': raw_config.get('templates', []) if isinstance(raw_config, dict) else [],
        'voted': raw_config.get('voted', 0) if isinstance(raw_config, dict) else 0,
        'votedFromHome': raw_config.get('votedFromHome', 0) if isinstance(raw_config, dict) else 0
    }
    return out


def resolve_output_config_path(out_dir, config_name=None):

    """Resolve the target config path.
    To prevent unintentional overwriting of main config.json files, simple filenames or relative config paths without
    subdirectories are output inside <out_dir>/checkpoints/ (e.g. data/checkpoints/config.json).
    Explicit multi-segment relative paths or absolute paths are respected as given.
    """
    target_name = (config_name or 'config.json').strip()
    if not target_name:
        target_name = 'config.json'
    candidate = Path(target_name)
    if candidate.is_absolute():
        return candidate
    if len(candidate.parts) > 1:
        return (Path(out_dir) / candidate).resolve()
    return (Path(out_dir) / 'checkpoints' / candidate).resolve()


def build_full_config(page, out_dir, region_filter=None, interactive=False, checkpoints_dir=None, resume_ids=None, config_name='config.json', test_mode=False):
    """Build the full config by iterating regions->municipalities->places.
    Supports optional per-municipality and per-region checkpointing and resume.
    """
    root_totals = {}
    if checkpoints_dir:
        _, root_totals = capture_candidate_checkpoint(page, checkpoints_dir)

    # Attempt to get region select
    region_select = extract_select_options(page, KEYWORDS_REGION)
    if not region_select:
        print('No standard <select> for regions found. Collecting candidate elements...')
        cand = extract_candidate_elements(page, KEYWORDS_REGION)
        (out_dir / 'rik_region_candidates.json').write_text(json.dumps(cand, ensure_ascii=False, indent=2))
        print('Wrote region candidates to rik_region_candidates.json. Use --interactive to manually prepare the page.')
        return None

    regions = region_select.get('options', [])
    result = {
        'regions': [],
        'RIK_totalRegisteredVoters': root_totals.get('registeredVoters'),
        'RIK_votingUnitsPlacesNumber': root_totals.get('votingPlaces')
    }
    for region in regions:
        rv = region.get('value')
        rname = region.get('text')
        if not rv:
            continue
        if region_filter and rname not in region_filter:
            continue
        # If resuming and this region was already completed, try to load its checkpoint and skip processing
        if resume_ids and rv in resume_ids:
            if checkpoints_dir:
                chk = checkpoints_dir / f'region_{rv}.json'
                if chk.exists():
                    try:
                        loaded = json.loads(chk.read_text())
                        if is_placeholder_region_payload(loaded):
                            print(f"Skipping stale placeholder checkpoint for region {rv}; will reprocess")
                        else:
                            result['regions'].append(loaded)
                            print(f"Skipping region (already completed): {rname}")
                            continue
                    except Exception as e:
                        print(f"Warning: failed to read checkpoint for region {rv}: {e}; will reprocess")
                else:
                    print(f"Warning: resume requested but checkpoint for region {rv} not found; will reprocess")
            else:
                print(f"Skipping region id {rv} due to resume_ids but no checkpoints_dir provided; skipping")
                continue

        if is_placeholder_option_text(rname):
            print(f"Skipping placeholder region option: {rname}")
            continue

        region_obj = { 'id': rv, 'name': rname, 'municipalities': [] }
        try:
            print(f"Processing region: {rname}")
            # select region
            ok = select_option_by_value(page, region_select.get('selectId'), rv)
            if not ok and interactive:
                input(f"Please select region '{rname}' in the browser then press Enter to continue...")
            page.wait_for_timeout(600)
            region_totals = extract_page_totals(page)
            if region_totals.get('registeredVoters') is not None:
                region_obj['RIK_totalRegionRegisteredVoters'] = region_totals['registeredVoters']
            if region_totals.get('votingPlaces') is not None:
                region_obj['RIK_votingRegionPlacesNumber'] = region_totals['votingPlaces']
            # extract municipalities
            mun_info = extract_select_options(page, KEYWORDS_MUN)
            if not mun_info:
                print(f"No municipality select for region {rname}; saving candidates and skipping.")
                cand = extract_candidate_elements(page, KEYWORDS_MUN)
                (out_dir / f'rik_municipality_candidates_{rv}.json').write_text(json.dumps(cand, ensure_ascii=False, indent=2))
                continue
            municipalities = mun_info.get('options', [])
            completed_municipality_ids = set()
            valid_mun_count = 0
            if checkpoints_dir:
                prog_path = checkpoints_dir / 'progress.json'
                if prog_path.exists():
                    try:
                        progress = json.loads(prog_path.read_text())
                        completed_municipality_ids = set(
                            progress.get('completed_municipality_ids', {}).get(rv, [])
                        )
                    except Exception:
                        completed_municipality_ids = set()
            for mun in municipalities:
                mval = mun.get('value')
                mname = mun.get('text')
                if not mval or is_placeholder_option_text(mname):
                    continue
                if test_mode and len(region_obj['municipalities']) >= 2:
                    print(f"  Test mode: Reached limit of 2 municipalities for region '{rname}', stopping municipality sweep.")
                    break
                if mval in completed_municipality_ids:
                    mun_chk = checkpoints_dir / f'region_{rv}_municipality_{mval}.json'
                    if mun_chk.exists():
                        try:
                            mun_obj = json.loads(mun_chk.read_text())
                            region_obj['municipalities'].append(mun_obj)
                            valid_mun_count += 1
                            print(f"  Skipping municipality (already completed): {mname}")
                            continue
                        except Exception as e:
                            print(f"  Warning: failed to read municipality checkpoint for {mname}: {e}; will reprocess")
                print(f"  Municipality: {mname}")
                ok = select_option_by_value(page, mun_info.get('selectId'), mval)
                if not ok and interactive:
                    input(f"Please select municipality '{mname}' in the browser then press Enter to continue...")
                page.wait_for_timeout(400)
                municipality_totals = extract_page_totals(page)
                # extract places
                place_info = extract_select_options(page, KEYWORDS_PLACE)
                if not place_info:
                    print(f"    No standard place select for {mname}; saving candidates and skipping.")
                    cand = extract_candidate_elements(page, KEYWORDS_PLACE)
                    (out_dir / f'rik_place_candidates_{rv}_{mval}.json').write_text(json.dumps(cand, ensure_ascii=False, indent=2))
                    continue
                places = place_info.get('options', [])
                mun_obj = {
                    'id': mval,
                    'name': mname,
                    'region_id': rv,
                    'region_name': rname,
                    'places': []
                }
                if municipality_totals.get('registeredVoters') is not None:
                    mun_obj['RIK_totalMunicipalityRegisteredVoters'] = municipality_totals['registeredVoters']
                if municipality_totals.get('votingPlaces') is not None:
                    mun_obj['RIK_votingPlacesNumber'] = municipality_totals['votingPlaces']
                # load overrides mapping once per region loop
                overrides_dict = load_place_overrides(out_dir)
                valid_place_count = 0
                for place in places:
                    pval = place.get('value')
                    pname = place.get('text')
                    if not pval or is_placeholder_option_text(pname):
                        continue
                    if test_mode and valid_place_count >= 2:
                        print(f"    Test mode: Reached limit of 2 places for municipality '{mname}', stopping place sweep.")
                        break
                    print(f"    Place: {pname}")

                    # Attempt to honor overrides: overrides file structure expected as { municipality_id: { normalized_place_text: override_value_or_text } }
                    ok = False
                    sel_used = None
                    try:
                        mun_overrides = overrides_dict.get(mval, {}) if isinstance(overrides_dict, dict) else {}
                    except Exception:
                        mun_overrides = {}
                    normalized_pname = (pname or '').strip().lower()
                    if mun_overrides:
                        ov = mun_overrides.get(normalized_pname) or mun_overrides.get(pname)
                        if ov:
                            # ov may be an option value or a visible text fragment to search for
                            # try to find a matching option value first
                            sel_val = None
                            for o in places:
                                if o.get('value') == ov:
                                    sel_val = ov
                                    break
                                if isinstance(ov, str) and ov.lower() in (o.get('text') or '').lower():
                                    sel_val = o.get('value')
                                    break
                            if sel_val:
                                print(f"      Using override to select option value: {sel_val}")
                                ok = select_option_by_value(page, place_info.get('selectId'), sel_val)
                                sel_used = sel_val
                            else:
                                # fallback: try selecting by visible text
                                print(f"      Override provided '{ov}', trying select by visible text")
                                ok = select_option_by_visible_text(page, ov)
                                sel_used = ov
                            if not ok:
                                print(f"      Override selection failed for {pname} (override={ov})")
                                log_missing_place(out_dir, {'timestamp': datetime.utcnow().isoformat(), 'region': rname, 'region_id': rv, 'municipality': mname, 'municipality_id': mval, 'place': pname, 'place_value': pval, 'override': ov, 'reason': 'override_selection_failed'})

                    if not ok:
                        ok = select_option_by_value(page, place_info.get('selectId'), pval)

                    if not ok and interactive:
                        # Try to offer terminal choice fallback: re-extract current place options and let user pick an index
                        try:
                            cur_place_info = extract_select_options(page, KEYWORDS_PLACE)
                            cur_opts = cur_place_info.get('options', []) if cur_place_info else []
                            if cur_opts:
                                print('\nCurrent place options:')
                                for i, opt in enumerate(cur_opts):
                                    print(f"  [{i}] {opt.get('text')} (value={opt.get('value')})")
                                sel = input("Enter option index to select, 's' to skip this place, or Enter to open browser and select manually: ").strip()
                                if sel.lower() == 's':
                                    print('Skipping this place as requested')
                                    log_missing_place(out_dir, {'timestamp': datetime.utcnow().isoformat(), 'region': rname, 'region_id': rv, 'municipality': mname, 'municipality_id': mval, 'place': pname, 'place_value': pval, 'reason': 'skipped_by_user'})
                                    continue
                                if sel != '':
                                    try:
                                        idx = int(sel)
                                        if 0 <= idx < len(cur_opts):
                                            sel_val = cur_opts[idx].get('value')
                                            ok = select_option_by_value(page, place_info.get('selectId'), sel_val)
                                            sel_used = sel_val
                                            if not ok:
                                                print('Failed to select chosen option via script; please select it manually in the browser and press Enter')
                                                input('After manual selection, press Enter to continue...')
                                        else:
                                            print('Index out of range; falling back to manual browser selection')
                                            input('Please select place in browser then press Enter to continue...')
                                    except ValueError:
                                        print('Invalid index; falling back to manual browser selection')
                                        input('Please select place in browser then press Enter to continue...')
                                else:
                                    input(f"Please select place '{pname}' in the browser then press Enter to continue...")
                            else:
                                # no current options found — fallback to asking user to select in browser
                                input(f"Please select place '{pname}' in the browser then press Enter to continue...")
                        except Exception:
                            # worst case fallback
                            input(f"Please select place '{pname}' in the browser then press Enter to continue...")

                    if not ok and not interactive:
                        # non-interactive mode couldn't select — log and continue
                        log_missing_place(out_dir, {'timestamp': datetime.utcnow().isoformat(), 'region': rname, 'region_id': rv, 'municipality': mname, 'municipality_id': mval, 'place': pname, 'place_value': pval, 'reason': 'select_failed'})

                    page.wait_for_timeout(300)
                    reg = find_registered_voters(page)
                    entry = { 'id': pval, 'name': pname, 'registeredVoters': reg or 0 }
                    if sel_used:
                        entry['selected'] = sel_used
                    mun_obj['places'].append(entry)
                    valid_place_count += 1
                region_obj['municipalities'].append(mun_obj)
                if checkpoints_dir:
                    checkpoints_dir.mkdir(parents=True, exist_ok=True)
                    mun_tmp = checkpoints_dir / f'region_{rv}_municipality_{mval}.json.tmp'
                    mun_final = checkpoints_dir / f'region_{rv}_municipality_{mval}.json'
                    mun_tmp.write_text(json.dumps(mun_obj, ensure_ascii=False, indent=2))
                    os.replace(str(mun_tmp), str(mun_final))
                    prog_path = checkpoints_dir / 'progress.json'
                    progress = { 'completed_region_ids': [], 'completed_municipality_ids': {} }
                    if prog_path.exists():
                        try:
                            progress = json.loads(prog_path.read_text())
                        except Exception:
                            progress = { 'completed_region_ids': [], 'completed_municipality_ids': {} }
                    progress.setdefault('completed_region_ids', [])
                    progress.setdefault('completed_municipality_ids', {})
                    region_municipalities = progress['completed_municipality_ids'].setdefault(rv, [])
                    if mval not in region_municipalities:
                        region_municipalities.append(mval)
                    prog_tmp = checkpoints_dir / 'progress.json.tmp'
                    prog_tmp.write_text(json.dumps(progress, ensure_ascii=False, indent=2))
                    os.replace(str(prog_tmp), str(prog_path))
                    print(f'  Wrote municipality checkpoint: {mun_final}')

            # finished region, append and checkpoint
            result['regions'].append(region_obj)
            try:
                if checkpoints_dir:
                    checkpoints_dir.mkdir(parents=True, exist_ok=True)
                    chk_tmp = checkpoints_dir / f'region_{rv}.json.tmp'
                    chk_final = checkpoints_dir / f'region_{rv}.json'
                    chk_tmp.write_text(json.dumps(region_obj, ensure_ascii=False, indent=2))
                    os.replace(str(chk_tmp), str(chk_final))
                    print(f'Wrote checkpoint: {chk_final}')
                    # remove any in-progress checkpoint from previous interrupted run
                    inprog = checkpoints_dir / f'region_{rv}.inprogress.json'
                    try:
                        if inprog.exists():
                            os.remove(str(inprog))
                            print(f'Removed in-progress checkpoint: {inprog}')
                    except Exception as e:
                        print(f'Warning: failed to remove in-progress checkpoint {inprog}: {e}')
                    # update progress index
                    prog_path = checkpoints_dir / 'progress.json'
                    progress = { 'completed_region_ids': [] }
                    if prog_path.exists():
                        try:
                            progress = json.loads(prog_path.read_text())
                        except Exception:
                            progress = { 'completed_region_ids': [] }
                    if rv not in progress.get('completed_region_ids', []):
                        progress.setdefault('completed_region_ids', []).append(rv)
                        prog_tmp = checkpoints_dir / 'progress.json.tmp'
                        prog_tmp.write_text(json.dumps(progress, ensure_ascii=False, indent=2))
                        os.replace(str(prog_tmp), str(prog_path))
            except Exception as e:
                print(f'Warning: failed to write checkpoint for region {rv}: {e}')

            # small delay between regions
            time.sleep(0.5)
        except KeyboardInterrupt:
            print(f'Interrupted during region {rname}; saving in-progress checkpoint...')
            if checkpoints_dir:
                try:
                    checkpoints_dir.mkdir(parents=True, exist_ok=True)
                    inprog_tmp = checkpoints_dir / f'region_{rv}.inprogress.json.tmp'
                    inprog = checkpoints_dir / f'region_{rv}.inprogress.json'
                    inprog_tmp.write_text(json.dumps(region_obj, ensure_ascii=False, indent=2))
                    os.replace(str(inprog_tmp), str(inprog))
                    print(f'Wrote in-progress checkpoint: {inprog}')
                except Exception as e:
                    print(f'Warning: failed to write in-progress checkpoint for region {rv}: {e}')
            raise
    # write final assembled result
    result = post_process_config(result, page=page, out_dir=out_dir, checkpoints_dir=checkpoints_dir)
    out_path = resolve_output_config_path(out_dir, config_name)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_out = out_path.with_suffix(out_path.suffix + '.tmp') if out_path.suffix else out_path.parent / f'{out_path.name}.tmp'
    tmp_out.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    os.replace(str(tmp_out), str(out_path))
    print(f'Wrote full config to {out_path}')
    return out_path


def assemble_checkpoints(out_dir, checkpoints_dir, config_name='config.json'):
    """Assemble the config file from per-region and per-municipality checkpoints in checkpoints_dir."""
    checkpoints_dir = Path(checkpoints_dir)
    if not checkpoints_dir.exists():
        print(f'No checkpoints directory at {checkpoints_dir}')
        return None

    region_map = {}

    # 1. Read full region checkpoint files
    for f in sorted(checkpoints_dir.glob('region_*.json')):
        if '_municipality_' in f.name or f.name.endswith('.tmp') or '.inprogress' in f.name:
            continue
        try:
            payload = json.loads(f.read_text())
            if is_placeholder_region_payload(payload):
                continue
            rid = str(payload.get('id', ''))
            if rid:
                region_map[rid] = payload
        except Exception as e:
            print(f'Warning: failed to read region checkpoint {f}: {e}')

    # 2. Read municipality checkpoint files for any regions not fully checkpointed
    mun_files = sorted(checkpoints_dir.glob('region_*_municipality_*.json'))
    mun_by_region = {}
    for mf in mun_files:
        if mf.name.endswith('.tmp'):
            continue
        try:
            payload = json.loads(mf.read_text())
            parts = mf.stem.split('_municipality_')
            rid = parts[0].replace('region_', '')
            if rid not in mun_by_region:
                mun_by_region[rid] = []
            mun_by_region[rid].append(payload)
        except Exception as e:
            print(f'Warning: failed to read municipality checkpoint {mf}: {e}')

    for rid, muns in mun_by_region.items():
        if rid not in region_map:
            rname = muns[0].get('region_name') if muns and isinstance(muns[0], dict) and muns[0].get('region_name') else f'Region {rid}'
            region_map[rid] = {
                'id': rid,
                'name': rname,
                'municipalities': muns
            }

    regions = list(region_map.values())
    candidate_data = load_checkpoint_candidate_data(checkpoints_dir)
    root_totals = candidate_data.get('RIK_totals', {}) if isinstance(candidate_data, dict) else {}
    result = {
        'regions': regions,
        'RIK_totalRegisteredVoters': root_totals.get('registeredVoters'),
        'RIK_votingUnitsPlacesNumber': root_totals.get('votingPlaces')
    }
    result = post_process_config(result, out_dir=out_dir, checkpoints_dir=checkpoints_dir)
    out_path = resolve_output_config_path(out_dir, config_name)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_out = out_path.with_suffix(out_path.suffix + '.tmp') if out_path.suffix else out_path.parent / f'{out_path.name}.tmp'
    try:
        tmp_out.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        os.replace(str(tmp_out), str(out_path))
        print(f'Assembled config written to {out_path} ({len(regions)} regions)')
        return out_path
    except Exception as e:
        print(f'Failed to assemble config: {e}')
        return None


def merge_into_config(existing_path, new_path, backup=True):
    # read existing
    existing = json.loads(existing_path.read_text()) if existing_path.exists() else {}
    new = json.loads(new_path.read_text())
    if backup and existing_path.exists():
        ts = datetime.now().strftime('%Y%m%d%H%M%S')
        bak = existing_path.parent / f'config.json.bak_{ts}'
        bak.write_text(json.dumps(existing, ensure_ascii=False, indent=2))
        print(f'Backup written to {bak}')
    # naive merge: append new regions (do not remove existing)
    existing_regions = existing.get('regions', [])
    existing_region_names = { r.get('name') for r in existing_regions }
    for r in new.get('regions', []):
        if r.get('name') in existing_region_names:
            print(f"Skipping merge for existing region {r.get('name')}")
            continue
        existing_regions.append(r)
    existing['regions'] = existing_regions
    existing_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2))
    print(f'Merged {len(new.get("regions", []))} regions into {existing_path}')


def main():
    parser = argparse.ArgumentParser(description='Fetch RIK full config')
    parser.add_argument('--url', default='https://www.rik.parlament.gov.rs/542645/sr/rezultati/', help='RIK results page URL')
    parser.add_argument('--output-dir', default='.', help='Directory to write JSON outputs')
    parser.add_argument('--headful', action='store_true', help='Run browser with GUI for debugging')
    parser.add_argument('--interactive', action='store_true', help='Open page and wait for user to interact before extracting')
    parser.add_argument('--checkpoints', action='store_true', help='Write per-region checkpoints to --output-dir/checkpoints')
    parser.add_argument('--resume', action='store_true', help='Resume a previously interrupted run using checkpoints in --output-dir/checkpoints')
    parser.add_argument('--assemble-checkpoints', action='store_true', help='Assemble config_rik_full.json from existing checkpoints and exit')
    parser.add_argument('--full-import', action='store_true', help='Run full sweep: regions -> municipalities -> places and extract registered voters')
    parser.add_argument('--regions', help='Comma-separated list of region names to limit the sweep (default: all)')
    parser.add_argument('--merge', action='store_true', help='Merge the resulting config into data/config.json (backing it up)')
    parser.add_argument('--config', default='config.json', help='Target config filename to write. Relative paths are resolved inside --output-dir. Default: config.json')
    parser.add_argument('--test-mode', action='store_true', help='Test mode: process all regions, 2 municipalities per region, and 2 places per municipality')
    parser.add_argument('--election-type-text', default='Parlamentarni', help='Visible text for Tip izbora to select')
    parser.add_argument('--election-text', default='Parlamentarni 2023', help='Visible text for Izbori to select')
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headful)
        context = browser.new_context()
        page = context.new_page()
        print(f'Navigating to {args.url} ...')
        page.goto(args.url, wait_until='networkidle', timeout=30000)
        page.wait_for_timeout(800)
        if args.interactive:
            print('\nInteractive mode: the browser window is open. Please interact with the page (choose election type / round) to populate controls.')
            input('When ready, press Enter here to continue...')
            page.wait_for_timeout(500)

        try:
            # If requested, assemble checkpoints and exit early
            if args.assemble_checkpoints:
                checkpoints_dir = out_dir / 'checkpoints'
                assemble_checkpoints(out_dir, checkpoints_dir, config_name=args.config)
                return

            # Try to automatically select election type and election round if provided
            try:
                print(f"Selecting election type: {args.election_type_text}")
                if select_option_by_visible_text(page, args.election_type_text):
                    page.wait_for_timeout(500)
                else:
                    print('Could not auto-select election type by visible text')
            except Exception:
                pass
            try:
                print(f"Selecting election: {args.election_text}")
                if select_option_by_visible_text(page, args.election_text):
                    page.wait_for_timeout(500)
                else:
                    print('Could not auto-select election by visible text')
            except Exception:
                pass

            # basic extraction
            print('Attempting to extract municipality select/options (sanity)...')
            mun_info = extract_select_options(page, KEYWORDS_MUN)
            if mun_info:
                (out_dir / 'rik_municipalities.json').write_text(json.dumps(mun_info, ensure_ascii=False, indent=2))
                print('Wrote rik_municipalities.json')

            if args.full_import:
                region_filter = None
                if args.regions:
                    region_filter = [r.strip() for r in args.regions.split(',') if r.strip()]
                # prepare checkpoints/resume
                checkpoints_dir = None
                resume_ids = None
                if args.checkpoints or args.resume:
                    checkpoints_dir = out_dir / 'checkpoints'
                    checkpoints_dir.mkdir(parents=True, exist_ok=True)
                if args.resume:
                    prog = checkpoints_dir / 'progress.json'
                    resume_ids = set()
                    if prog.exists():
                        try:
                            prog_data = json.loads(prog.read_text())
                            resume_ids = set(prog_data.get('completed_region_ids', []))
                            print(f'Resuming run; {len(resume_ids)} completed regions will be skipped')
                        except Exception:
                            print('Warning: failed to read progress.json; resuming with no completed region ids')
                    else:
                        print('Resume requested but no progress.json found; starting from scratch')
                full_path = build_full_config(
                    page,
                    out_dir,
                    region_filter=region_filter,
                    interactive=args.interactive,
                    checkpoints_dir=checkpoints_dir,
                    resume_ids=resume_ids,
                    config_name=args.config,
                    test_mode=args.test_mode,
                )
                if full_path and args.merge:
                    merge_into_config(Path('data/config.json'), full_path)
        except KeyboardInterrupt:
            print('Interrupted by user. Assembling checkpoints (if any) and exiting.')
            if (args.checkpoints or args.resume):
                checkpoints_dir = out_dir / 'checkpoints'
                assemble_checkpoints(out_dir, checkpoints_dir, config_name=args.config)
        finally:
            browser.close()

if __name__ == '__main__':
    main()
