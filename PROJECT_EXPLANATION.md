# SmartFetch Code Explanation

## Project Idea

SmartFetch is a small web application that extracts useful data from one public webpage at a time. The user enters a URL, the server downloads the HTML, checks what kind of data exists on the page, and then lets the user choose what to extract.

The main goal is to make web scraping easier for a normal user. Instead of writing scraper code for every website, the app suggests common filters such as headings, paragraphs, links, images, tables, lists, metadata, prices, and dates.

## How We Coded It

The project uses a simple client-server structure:

1. The frontend is written with normal HTML, CSS, and JavaScript.
2. The backend is written with Node.js and Express.
3. The backend fetches the webpage HTML with Axios.
4. Cheerio parses the HTML so we can search it like jQuery.
5. The frontend sends requests to the backend using `fetch`.
6. The backend returns JSON data.
7. The frontend displays the extracted data and lets the user export it as JSON or CSV.

We kept the structure simple so the project can be explained file by file.

## Libraries Used

### Express

Express is used to create the web server.

In this project it does three main jobs:

- Serves the frontend files from the `public` folder.
- Creates the `/api/analyze` endpoint.
- Creates the `/api/extract` endpoint.

### Axios

Axios is used by the backend to download the HTML from the URL entered by the user.

We use it instead of the browser because the server needs to read and parse the webpage content.

### Cheerio

Cheerio is used to parse HTML on the backend.

It lets us select elements such as:

- `h1`, `h2`, `h3` for headings
- `p` for paragraphs
- `a` for links
- `img` for images
- `table`, `tr`, `td`, and `th` for tables
- `ul`, `ol`, and `li` for lists
- `meta` tags for metadata

### Node Test

The project uses the built-in Node.js test runner through:

```bash
npm test
```

The tests check important extraction functions, URL helpers, duplicate removal, grouped extraction, and CSV export.

## Main User Flow

### 1. Analyze

The user enters a URL and clicks **Analyze**.

The frontend sends this request:

```text
POST /api/analyze
```

The server:

- Validates the URL.
- Blocks unsafe local/private network URLs.
- Downloads the HTML.
- Checks which filters have data.
- Sends the list of available filters back to the frontend.

### 2. Select Filters

The user chooses filters such as headings, links, prices, or tables.

The frontend only enables the extract button when at least one available filter is selected.

### 3. Extract

The user clicks **Extract Selected Data**.

The frontend sends this request:

```text
POST /api/extract
```

The server:

- Gets the saved or freshly fetched HTML.
- Runs the selected extraction functions.
- Removes empty rows and duplicates.
- Builds a summary.
- Builds a CSV version of the result.
- Sends everything back as JSON.

### 4. Preview and Export

The frontend displays the result in tables or cards.

The user can export:

- JSON for structured data.
- CSV for spreadsheet use.

## File-by-File Explanation

### `package.json`

Defines the project name, scripts, and dependencies.

Important scripts:

- `npm start`: starts the Express server.
- `npm run dev`: also starts the Express server.
- `npm test`: runs the test suite.

Important dependencies:

- `express`: backend web server.
- `axios`: downloads webpage HTML.
- `cheerio`: parses and searches HTML.

### `package-lock.json`

Stores the exact installed versions of dependencies. This helps everyone install the same versions when running `npm install`.

### `server.js`

This is the backend of the project.

Important parts:

- Sets up Express.
- Serves the files inside `public`.
- Validates URLs before fetching.
- Uses Axios to fetch HTML.
- Uses Cheerio to parse HTML.
- Contains all extraction functions.
- Creates the `/api/analyze` endpoint.
- Creates the `/api/extract` endpoint.
- Exports helper functions for tests.

Important functions:

- `normalizeText`: removes extra spaces and line breaks.
- `createAbsoluteUrl`: converts relative links into full URLs.
- `validatePublicUrl`: checks that the URL is safe to request.
- `fetchHtml`: downloads the page HTML.
- `uniqueRows`: removes duplicate or empty extracted rows.
- `extractHeadings`: extracts heading tags.
- `extractParagraphs`: extracts paragraph text.
- `extractLinks`: extracts link text and href values.
- `extractImages`: extracts image sources and alt text.
- `extractTables`: extracts rows from normal tables and some table-like layouts.
- `extractLists`: extracts list items.
- `extractMetadata`: extracts title, description, keywords, and social metadata.
- `extractPrices`: finds price-like text using a regular expression.
- `extractDates`: finds dates from `time` tags and text.
- `extractGrouped`: tries to keep related page content together, for example product cards.
- `analyzeFilters`: checks which filters have results.
- `buildCsv`: converts extracted data into CSV text.

### `public/index.html`

This is the page structure seen by the user.

It contains:

- The app title and status text.
- The URL input form.
- The suggested filters area.
- The grouped extraction checkbox.
- The preview area.
- The export buttons.

The file does not contain the main logic. It mostly gives the JavaScript elements to work with by using IDs such as `urlInput`, `analyzeButton`, `filtersGrid`, and `previewArea`.

### `public/style.css`

This controls how the app looks.

The styling is intentionally simple:

- Light page background.
- White panels.
- Blue accent color.
- Clear borders.
- Basic buttons.
- Responsive layout for smaller screens.

This makes the project look like a clean student-built application instead of an over-designed template.

### `public/app.js`

This is the frontend logic.

Important responsibilities:

- Reads elements from the HTML using `document.querySelector`.
- Sends analyze and extract requests to the backend.
- Shows loading states.
- Displays success or error messages.
- Renders filter cards after analysis.
- Tracks which filters are selected.
- Renders extracted data in preview tables or grouped cards.
- Keeps a short recent URL history.
- Handles JSON and CSV downloads.

Important functions:

- `postJson`: sends JSON requests to the backend.
- `renderFilters`: builds the filter cards.
- `getSelectedFilters`: reads selected checkboxes.
- `renderPreview`: displays extracted results.
- `renderResultSummary`: shows total rows, selected filters, mode, and duration.
- `downloadFile`: creates the JSON or CSV download.

### `test/extraction.test.js`

This file tests the backend extraction logic.

It uses small sample HTML strings instead of real websites. This makes the tests faster and more reliable.

The tests check:

- Text normalization.
- Duplicate removal.
- Heading extraction.
- Paragraph extraction.
- Link extraction.
- Image extraction.
- Table extraction.
- List extraction.
- Metadata extraction.
- Price extraction.
- Date extraction.
- Grouped extraction.
- CSV generation.
- Private IP checks.
- Relative URL conversion.

### `.gitignore`

Lists files or folders Git should ignore. Usually this includes generated folders such as `node_modules`.

### `README.md`

Gives a short overview of the project, how to install it, how to run it, and how to use it.

## API Endpoints

### `POST /api/analyze`

Input:

```json
{
  "url": "https://example.com"
}
```

Output:

- Final URL.
- Page title.
- Whether the page redirected.
- List of filters with counts.

### `POST /api/extract`

Input:

```json
{
  "url": "https://example.com",
  "filters": ["headings", "links"],
  "grouped": false
}
```

Output:

- Extracted sections.
- Summary information.
- CSV export text.
- Selected filters.
- Extraction duration.

## Safety Features

The backend does not fetch every possible URL blindly.

It blocks:

- Invalid URLs.
- Non-http protocols.
- URLs with usernames or passwords.
- Localhost URLs.
- Private network IP addresses.
- Redirect loops.
- Non-HTML responses.
- Very large HTML responses.
- Very slow requests.

These checks are important because a web scraper should not be allowed to request internal machine or network addresses.

## Why The Code Is Understandable

The project is split into clear parts:

- HTML for structure.
- CSS for design.
- Frontend JavaScript for browser interaction.
- Backend JavaScript for scraping and APIs.
- Tests for checking extraction behavior.

Most functions have one main job. For example, `extractLinks` only extracts links, and `extractImages` only extracts images. This makes the project easier to explain and easier to debug.

## Short Presentation Script

SmartFetch is a Node.js and Express web app for extracting data from a public webpage. The frontend is plain HTML, CSS, and JavaScript. When the user enters a URL, the frontend sends it to the backend. The backend validates the URL, downloads the HTML using Axios, and parses it with Cheerio. Then it checks what data is available, such as headings, links, images, tables, lists, prices, dates, and metadata. The user selects the filters they want, and the backend returns clean extracted data. The frontend previews the result and can export it as JSON or CSV.
