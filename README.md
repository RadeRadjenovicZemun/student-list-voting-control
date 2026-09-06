# Signal Voting Dashboard

A local dashboard and toolkit for collecting RIK election data and displaying voting information.

## Requirements

- Node.js 16 or newer
- Python 3
- Playwright for Python
- A Chromium browser installed for Playwright

Install the Node dependencies:

```bash
npm install
```

Install the scraper dependencies:

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
```

## Recreate `config.json`

Election configuration files and scraper checkpoints are generated locally and are not part of the public project. To create a fresh configuration, run:

```bash
python3 tools/fetch_rik.py \
  --output-dir data \
  --full-import \
  --checkpoints \
  --interactive \
  --headful \
  --config config.json
```

The browser will open the RIK results page. Select the required election and round if necessary, then return to the terminal and press Enter. The scraper collects:

- Candidate lists
- RIK totals for voters and voting places
- Regions
- Municipalities
- Polling places and registered voters

The generated files are written locally under `data/`, including:

```text
data/config.json
data/checkpoints/
```

The first checkpoint contains the candidate list and root RIK totals. Region and municipality checkpoints are written as the scraper progresses.

### Resume an interrupted scrape

```bash
python3 tools/fetch_rik.py \
  --output-dir data \
  --full-import \
  --checkpoints \
  --resume \
  --config config.json
```

### Assemble from existing checkpoints

If the checkpoints already exist, recreate the configuration without scraping the site again:

```bash
python3 tools/fetch_rik.py \
  --output-dir data \
  --assemble-checkpoints \
  --config config.json
```

### Small test run

To verify the workflow without processing every municipality and polling place:

```bash
python3 tools/fetch_rik.py \
  --output-dir data \
  --full-import \
  --checkpoints \
  --interactive \
  --headful \
  --test-mode \
  --config test_config.json
```

## Start the dashboard

After `data/config.json` has been generated:

```bash
npm start
```

Open <http://127.0.0.1:3000> in a browser.

The server is local. Signal integration and notification bridging are optional; see [README_BRIDGE.md](README_BRIDGE.md).

## Local data

Do not commit generated election configurations, checkpoints, Signal messages, sender data, backups, virtual environments, or `node_modules`. Each user should generate and keep their own local data.

More scraper details are available in [tools/README.md](tools/README.md).

## Contributing

Contributions are welcome. You can fork the repository, make changes in your
own clone, and submit a pull request for review. Direct push access to the
upstream repository is managed separately by the repository owner.

The project is released under the [MIT License](LICENSE).
