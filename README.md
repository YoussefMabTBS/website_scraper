# SmartFetch

SmartFetch is a simple client-server web application for adaptive web data extraction. It analyzes one public webpage URL at a time, suggests filters from the detected HTML elements, previews the selected data, and exports the result as JSON or CSV.

## Features

- URL input and analysis workflow
- Backend URL validation before fetching
- HTML fetching with Axios and timeout protection
- HTML parsing with Cheerio
- Suggested filters for:
  - headings: `h1`, `h2`, `h3`
  - links: `a` text and `href`
  - images: `img src` and `alt`
  - tables: `table`, `tr`, `th`, `td`
  - prices: `$`, `€`, `TND`, and common price-like patterns
  - dates: `time` tags and date-like text
- Clean output by trimming whitespace, removing empty values, and removing duplicates
- Preview tables grouped by selected filter
- JSON and CSV export
- Clear error messages
- Basic protection against invalid URLs, non-http protocols, localhost/private IP targets, and slow requests

## Project Structure

```text
smartfetch/
  package.json
  server.js
  public/
    index.html
    style.css
    app.js
  README.md
```

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Open the app in your browser:

```text
http://localhost:3000
```

## How To Use

1. Enter a public webpage URL, such as `https://example.com`.
2. Click **Analyze**.
3. Select one or more suggested filters.
4. Click **Extract Selected Data**.
5. Review the preview table.
6. Export the result as JSON or CSV.
