const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const dns = require('dns').promises;
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3000;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

const FILTERS = [
  {
    key: 'headings',
    label: 'Headings',
    description: 'h1, h2, and h3 text'
  },
  {
    key: 'links',
    label: 'Links',
    description: 'Link text and href values'
  },
  {
    key: 'images',
    label: 'Images',
    description: 'Image src and alt text'
  },
  {
    key: 'tables',
    label: 'Tables',
    description: 'Rows from table, tr, th, and td elements'
  },
  {
    key: 'prices',
    label: 'Prices',
    description: '$, EUR, TND, and price-like patterns'
  },
  {
    key: 'dates',
    label: 'Dates',
    description: 'time tags and date-like text'
  }
];

const htmlCache = new Map();

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function createAbsoluteUrl(value, baseUrl) {
  const cleaned = normalizeText(value);
  if (!cleaned) return '';

  try {
    return new URL(cleaned, baseUrl).href;
  } catch {
    return cleaned;
  }
}

function isPrivateIp(ip) {
  if (!ip) return true;

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;

    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (net.isIPv6(ip)) {
    const lowered = ip.toLowerCase();
    return lowered === '::1' || lowered.startsWith('fc') || lowered.startsWith('fd') || lowered.startsWith('fe80');
  }

  return true;
}

async function validatePublicUrl(inputUrl) {
  let parsed;

  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new Error('Please enter a valid URL, for example https://example.com.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed.');
  }

  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error('Please enter a normal public webpage URL without login details.');
  }

  if (['localhost', 'localhost.localdomain'].includes(parsed.hostname.toLowerCase())) {
    throw new Error('Localhost URLs are blocked for safety.');
  }

  if (net.isIP(parsed.hostname) && isPrivateIp(parsed.hostname)) {
    throw new Error('Private or local network IP addresses are blocked for safety.');
  }

  let addresses;
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    throw new Error('Could not resolve the website hostname.');
  }

  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) {
    throw new Error('This URL resolves to a private or local network address, so it was blocked.');
  }

  return parsed.href;
}

async function fetchHtml(pageUrl) {
  const response = await axios.get(pageUrl, {
    timeout: REQUEST_TIMEOUT_MS,
    maxContentLength: MAX_HTML_BYTES,
    maxBodyLength: MAX_HTML_BYTES,
    responseType: 'text',
    headers: {
      'User-Agent': 'SmartFetch-University-Project/1.0',
      Accept: 'text/html,application/xhtml+xml'
    },
    validateStatus(status) {
      return status >= 200 && status < 400;
    }
  });

  const contentType = response.headers['content-type'] || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new Error('The URL did not return an HTML webpage.');
  }

  return response.data;
}

function uniqueRows(rows) {
  const seen = new Set();
  const cleaned = [];

  rows.forEach((row) => {
    const compact = {};

    Object.entries(row).forEach(([key, value]) => {
      const cleanedValue = normalizeText(value);
      if (cleanedValue) compact[key] = cleanedValue;
    });

    if (!Object.keys(compact).length) return;

    const signature = JSON.stringify(compact);
    if (!seen.has(signature)) {
      seen.add(signature);
      cleaned.push(compact);
    }
  });

  return cleaned;
}

function extractHeadings($) {
  return uniqueRows(
    $('h1, h2, h3')
      .map((_, element) => ({
        level: element.tagName.toLowerCase(),
        text: $(element).text()
      }))
      .get()
  );
}

function extractLinks($, pageUrl) {
  return uniqueRows(
    $('a[href]')
      .map((_, element) => ({
        text: $(element).text(),
        href: createAbsoluteUrl($(element).attr('href'), pageUrl)
      }))
      .get()
  );
}

function extractImages($, pageUrl) {
  return uniqueRows(
    $('img[src]')
      .map((_, element) => ({
        src: createAbsoluteUrl($(element).attr('src'), pageUrl),
        alt: $(element).attr('alt') || ''
      }))
      .get()
  );
}

function extractTables($) {
  const rows = [];

  $('table').each((tableIndex, table) => {
    $(table)
      .find('tr')
      .each((rowIndex, row) => {
        const cells = $(row)
          .find('th, td')
          .map((_, cell) => normalizeText($(cell).text()))
          .get()
          .filter(Boolean);

        if (cells.length) {
          rows.push({
            table: tableIndex + 1,
            row: rowIndex + 1,
            values: cells.join(' | ')
          });
        }
      });
  });

  return uniqueRows(rows);
}

function extractPrices($) {
  const text = $('body').text();
  const pricePattern = /(?:[$€]\s?\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2})?|\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2})?\s?(?:TND|USD|EUR|GBP|dollars?|euros?|dinars?))/gi;
  const matches = text.match(pricePattern) || [];

  return uniqueRows(matches.map((price) => ({ value: price })));
}

function extractDates($) {
  const rows = [];

  $('time').each((_, element) => {
    rows.push({
      source: 'time tag',
      value: $(element).attr('datetime') || $(element).text()
    });
  });

  const text = $('body').text();
  const datePattern = /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/gi;
  const matches = text.match(datePattern) || [];

  matches.forEach((date) => {
    rows.push({ source: 'page text', value: date });
  });

  return uniqueRows(rows);
}

function extractByFilter(filterKey, $, pageUrl) {
  switch (filterKey) {
    case 'headings':
      return extractHeadings($);
    case 'links':
      return extractLinks($, pageUrl);
    case 'images':
      return extractImages($, pageUrl);
    case 'tables':
      return extractTables($);
    case 'prices':
      return extractPrices($);
    case 'dates':
      return extractDates($);
    default:
      return [];
  }
}

function analyzeFilters(html, pageUrl) {
  const $ = cheerio.load(html);

  return FILTERS.map((filter) => {
    const count = extractByFilter(filter.key, $, pageUrl).length;

    return {
      ...filter,
      count,
      available: count > 0
    };
  });
}

function buildCsv(sections) {
  const escapeCsv = (value) => {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  };

  const lines = ['filter,field,value'];

  sections.forEach((section) => {
    section.items.forEach((item) => {
      Object.entries(item).forEach(([field, value]) => {
        lines.push([section.label, field, value].map(escapeCsv).join(','));
      });
    });
  });

  return lines.join('\n');
}

app.post('/api/analyze', async (req, res) => {
  try {
    const pageUrl = await validatePublicUrl(req.body.url);
    const html = await fetchHtml(pageUrl);
    const filters = analyzeFilters(html, pageUrl);

    htmlCache.set(pageUrl, {
      html,
      createdAt: Date.now()
    });

    res.json({
      url: pageUrl,
      title: normalizeText(cheerio.load(html)('title').first().text()) || 'Untitled page',
      filters
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to analyze this URL.' });
  }
});

app.post('/api/extract', async (req, res) => {
  try {
    const pageUrl = await validatePublicUrl(req.body.url);
    const selectedFilters = Array.isArray(req.body.filters) ? req.body.filters : [];
    const allowedKeys = new Set(FILTERS.map((filter) => filter.key));
    const filters = selectedFilters.filter((key) => allowedKeys.has(key));

    if (!filters.length) {
      throw new Error('Select at least one filter before extracting data.');
    }

    let cached = htmlCache.get(pageUrl);
    if (!cached || Date.now() - cached.createdAt > 10 * 60 * 1000) {
      cached = {
        html: await fetchHtml(pageUrl),
        createdAt: Date.now()
      };
      htmlCache.set(pageUrl, cached);
    }

    const $ = cheerio.load(cached.html);
    const sections = filters.map((key) => {
      const filter = FILTERS.find((item) => item.key === key);
      return {
        key,
        label: filter.label,
        items: extractByFilter(key, $, pageUrl)
      };
    });

    res.json({
      url: pageUrl,
      extractedAt: new Date().toISOString(),
      sections,
      csv: buildCsv(sections)
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to extract data from this URL.' });
  }
});

app.use((_, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

app.listen(PORT, () => {
  console.log(`SmartFetch is running at http://localhost:${PORT}`);
});
