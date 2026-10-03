# Tools manual

This directory contains helper scripts for fetching, transforming, aggregating and validating election data from the RIK site.

## fetch_rik.py

Scrapes the RIK election results page and builds a full configuration structure of:

- regions
- municipalities
- polling places
- registered voter counts

The script is intended for local use on a machine with a browser and terminal access.

### Requirements

Install the Python dependencies first:

```bash
python3 -m pip install playwright
python3 -m playwright install
```

### Basic usage

Run the scraper in non-interactive mode:

```bash
cd /home/rade/VSC/First
python3 tools/fetch_rik.py --output-dir data --full-import --checkpoints --config my_election_config.json
```

This writes the final config to:

```text
data/my_election_config.json
```

and checkpoint files to:

```text
data/checkpoints/
```

The first checkpoint created is `data/checkpoints/candidates.json`, containing
the candidate list captured from the page. Region and municipality checkpoints
reuse this list during processing and checkpoint assembly.

The same first checkpoint also stores the root-level RIK totals in `RIK_totals`.
After each region and municipality is selected, their direct page totals are
stored in `RIK_totalRegionRegisteredVoters`, `RIK_votingRegionPlacesNumber`,
`RIK_totalMunicipalityRegisteredVoters`, and `RIK_votingPlacesNumber`.

### Interactive mode

Use interactive mode when the page needs manual election selection:

```bash
cd /home/rade/VSC/First
python3 tools/fetch_rik.py --output-dir data --full-import --checkpoints --interactive --headful --config my_election_config.json
```

Steps:

1. Browser opens.
2. Select the election / round manually in the browser.
3. Return to the terminal and press Enter.
4. Scraping continues.

This is the recommended mode for first-time use.

### Default output location (Safe composition)

To prevent unintentional overwriting of `data/config.json`, simple filenames like `config.json` are output directly inside `data/checkpoints/` (e.g., `data/checkpoints/config.json`):

```bash
cd /home/rade/VSC/First
python3 tools/fetch_rik.py --output-dir data --full-import --checkpoints
```

After inspecting `data/checkpoints/config.json`, you can safely copy it to `data/config.json`:

```bash
cp data/checkpoints/config.json data/config.json
```

### Save output to a custom path

You may pass a relative or absolute filename for the final config:

```bash
cd /home/rade/VSC/First
python3 tools/fetch_rik.py --output-dir data --full-import --checkpoints --config custom_config.json
```

Relative names are resolved under `--output-dir`.

### Resume from checkpoints

If a previous run was interrupted, you can resume using the saved `checkpoints` data:

```bash
cd /home/rade/VSC/First
python3 tools/fetch_rik.py --output-dir data --full-import --checkpoints --resume
```

Checkpoints are written after each municipality as well as after each completed
region. On resume, completed municipalities in an unfinished region are loaded
from `data/checkpoints/region_<region_id>_municipality_<municipality_id>.json` and
only the remaining municipalities are scraped.

### Assemble from existing checkpoints only

If you already have checkpoint files on disk and want to rebuild the final config without scraping again:

```bash
cd /home/rade/VSC/First
python3 tools/fetch_rik.py --output-dir data --assemble-checkpoints --config assembled_config.json
```

### Merge into the project config

You can merge a newly generated config into the main application config:

```bash
cd /home/rade/VSC/First
python3 tools/fetch_rik.py --output-dir data --full-import --config my_election_config.json --merge
```

The script backs up the existing config before merging.

### Common arguments

- `--url` – RIK results URL to open. Default:
  ```text
  https://www.rik.parlament.gov.rs/542645/sr/rezultati/
  ```
- `--output-dir` – directory where output JSON files are saved.
- `--headful` – run browser with visible UI.
- `--interactive` – stop and wait for manual page interaction.
- `--checkpoints` – save per-region checkpoint files.
- `--resume` – continue from previous checkpoints.
- `--full-import` – do the full regions → municipalities → places extraction.
- `--regions` – comma-separated region names to limit processing.
- `--config` – output config filename. Default: `config.json`.
- `--merge` – merge generated regions into the active project config.

### Output files

The script may generate these files in the output directory:

- `config.json` or custom target file
- `checkpoints/region_<id>.json`
- `checkpoints/progress.json`
- `rik_municipalities.json`
- `rik_polling_places_by_mun.json`
- `missing_places.json`
- debug files such as candidate snapshots when selectors are not found

### Typical start workflow

For a fresh local run:

```bash
cd /home/rade/VSC/First
python3 tools/fetch_rik.py --output-dir data --full-import --checkpoints --interactive --headful --config my_election_config.json
```

After the data is collected, use the assembled output as needed by the app or for later resumption.

## Check and stop a residual dashboard server

The dashboard is started from the repository root with `npm start` and normally
uses port `3000`. Before restarting it, check whether an old `server.js`
process is still running:

```bash
cd /home/rade/VSC/First
pgrep -af 'node server.js'
ss -ltnp | grep ':3000'
```

If either command reports a process, inspect its PID before stopping it. The
first column in the `pgrep` output is the PID; `ss` may show it as `pid=...`:

```bash
ps -fp <PID>
readlink -f /proc/<PID>/cwd
```

Only continue when the command and working directory identify this project.
Stop the confirmed residual process gracefully:

```bash
kill -TERM <PID>
```

If `ps` shows `T` or `Tl` in the `STAT` column, the process is stopped and
cannot handle the termination signal until it is resumed:

```bash
kill -CONT <PID>
kill -TERM <PID>
```

Verify that it released the process and port:

```bash
pgrep -af 'node server.js'
ss -ltnp | grep ':3000'
```

If the confirmed process remains after a short wait, force-stop only that PID:

```bash
kill -KILL <PID>
```

Do not use `pkill node` or `killall node`; those commands can terminate
unrelated Node.js applications. An empty `grep` result is normal when no
process is listening on port `3000`.
