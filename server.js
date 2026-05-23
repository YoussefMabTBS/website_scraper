const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const dns = require('dns').promises;
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3000;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

const FILTERS = [
  {
    key: 'headings',
    label: 'Headings',
    description: 'Main titles and section titles found on the page'
  },
  {
    key: 'paragraphs',
    label: 'Paragraphs',
    description: 'Readable paragraph text from the page'
  },
  {
    key: 'links',
    label: 'Links',
    description: 'Clickable links with their text and destination'
  },
  {
    key: 'images',
    label: 'Images',
    description: 'Image sources and alt text'
  },
  {
    key: 'tables',
    label: 'Tables',
    description: 'Rows from detected tables'
  },
  {
    key: 'lists',
    label: 'Lists',
    description: 'Bullet or numbered list items'
  },
  {
    key: 'metadata',
    label: 'Metadata',
    description: 'Page title, description, keywords, and social metadata'
  },
  {
    key: 'prices',
    label: 'Prices',
    description: '$, EUR, TND, and price-like values'
  },
  {
    key: 'dates',
    label: 'Dates',
    description: 'Dates from time tags and page text'
  }
];

const htmlCache = new Map();
const pricePattern = /(?:[$€]\s?\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2})?|\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2})?\s?(?:TND|USD|EUR|GBP|dollars?|euros?|dinars?))/gi;
const datePattern = /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/gi;

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

function isUsefulHref(value) {
  const cleaned = normalizeText(value).toLowerCase();
  return Boolean(
    cleaned &&
      !cleaned.startsWith('#') &&
      !cleaned.startsWith('javascript:') &&
      !cleaned.startsWith('mailto:') &&
      !cleaned.startsWith('tel:')
  );
}

function isNoisyContainer($, element) {
  const container = $(element).closest('header, nav, footer, [role="navigation"]');
  const noisyAncestor = $(element)
    .parents()
    .toArray()
    .some((ancestor) => {
      const signature = `${$(ancestor).attr('id') || ''} ${$(ancestor).attr('class') || ''} ${
        $(ancestor).attr('aria-label') || ''
      }`.toLowerCase();
      return /\b(nav|navigation|footer|account|cookie)\b/.test(signature);
    });
  const text = normalizeText($(element).text()).toLowerCase();

  return Boolean(
    container.length ||
      noisyAncestor ||
      ['sign in', 'log in', 'account', 'cart', 'basket', 'privacy policy', 'terms of use', 'cookie settings'].includes(text)
  );
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
  let currentUrl = pageUrl;
  const redirects = [];

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    currentUrl = await validatePublicUrl(currentUrl);

    const response = await axios.get(currentUrl, {
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: MAX_HTML_BYTES,
      maxBodyLength: MAX_HTML_BYTES,
      maxRedirects: 0,
      proxy: false,
      responseType: 'text',
      headers: {
        'User-Agent': 'SmartFetch-University-Project/1.0',
        Accept: 'text/html,application/xhtml+xml'
      },
      validateStatus(status) {
        return status >= 200 && status < 400;
      }
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) {
        throw new Error('The website redirected without giving a destination.');
      }

      redirects.push(currentUrl);
      currentUrl = new URL(location, currentUrl).href;

      if (redirects.includes(currentUrl)) {
        throw new Error('The website redirected in a loop.');
      }

      continue;
    }

    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error('The URL did not return an HTML webpage.');
    }

    return {
      html: response.data,
      finalUrl: currentUrl,
      redirects
    };
  }

  throw new Error('The website redirected too many times.');
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

function compactValues(values) {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

function removeDuplicateValues(values, blockedValues) {
  const simplify = (value) =>
    normalizeText(value)
      .toLowerCase()
      .replace(/^live\.\s*/, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const blocked = blockedValues.map(simplify).filter(Boolean);

  return values.filter((value) => {
    const cleaned = simplify(value);
    return !blocked.some((blockedValue) => cleaned === blockedValue || blockedValue.includes(cleaned));
  });
}

function uniqueLinksByHref(links) {
  const byHref = new Map();

  links.forEach((link) => {
    if (!link.href) return;

    const existing = byHref.get(link.href);
    const currentText = normalizeText(link.text);
    const existingText = existing ? normalizeText(existing.text) : '';

    if (!existing || (!existingText && currentText) || currentText.length < existingText.length) {
      byHref.set(link.href, {
        ...link,
        text: currentText
      });
    }
  });

  return Array.from(byHref.values());
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

function extractParagraphs($) {
  return uniqueRows(
    $('p')
      .map((_, element) => ({ text: $(element).text() }))
      .get()
  );
}

function extractLinks($, pageUrl) {
  return uniqueRows(
    $('a[href]')
      .filter((_, element) => isUsefulHref($(element).attr('href')))
      .filter((_, element) => !isNoisyContainer($, element))
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

  $('.substats_row, [class*="table-row"], [class*="table_row"], [class*="data-row"], [class*="data_row"]').each(
    (rowIndex, row) => {
      const container = $(row);
      const cells = container
        .children('div, span')
        .filter((_, cell) => {
          const className = $(cell).attr('class') || '';
          return /col|cell|value|name|month|pct|chg/i.test(className);
        })
        .map((_, cell) => ({
          className: $(cell).attr('class') || '',
          text: normalizeText($(cell).text())
        }))
        .get()
        .filter((cell) => cell.text);

      if (cells.length >= 2) {
        const monthHeaders = container
          .prevAll('.substats_col_month.col_header, .substats_col_month_last_pct.col_header')
          .toArray()
          .reverse()
          .map((header) => normalizeText($(header).text()))
          .filter(Boolean);
        const rowData = {
          table: 'div layout',
          row: rowIndex + 1
        };
        let monthIndex = 0;
        let valueIndex = 1;

        cells.forEach((cell, cellIndex) => {
          if (cellIndex === 0 || /left|name/i.test(cell.className)) {
            rowData.name = cell.text;
          } else if (/chg|change/i.test(cell.className)) {
            rowData.change = cell.text;
          } else if (/month|pct|value|cell|col/i.test(cell.className)) {
            const header = monthHeaders[monthIndex];
            const key = header ? header.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : `value_${valueIndex}`;
            rowData[key || `value_${valueIndex}`] = cell.text;
            monthIndex += 1;
            valueIndex += 1;
          }
        });

        rowData.values = cells.map((cell) => cell.text).join(' | ');
        rows.push(rowData);
      }
    }
  );

  return uniqueRows(rows);
}

function extractLists($) {
  const rows = [];
  const noisyTexts = new Set(['previous', 'next']);
  const isNoisyListItem = (text) => {
    const cleaned = normalizeText(text).toLowerCase();
    return !cleaned || noisyTexts.has(cleaned) || /^\d+$/.test(cleaned);
  };

  $('ul, ol')
    .filter((_, list) => {
      const container = $(list);
      const role = normalizeText(container.attr('role')).toLowerCase();
      const label = normalizeText(container.attr('aria-label')).toLowerCase();

      return (
        !container.closest('header, nav, footer, [role="navigation"]').length &&
        role !== 'navigation' &&
        !label.includes('pagination')
      );
    })
    .each((listIndex, list) => {
    const type = list.tagName.toLowerCase() === 'ol' ? 'ordered' : 'unordered';

    $(list)
      .children('li')
      .each((itemIndex, item) => {
        const text = normalizeText($(item).text());
        if (isNoisyListItem(text)) return;

        rows.push({
          list: listIndex + 1,
          type,
          item: itemIndex + 1,
          text
        });
      });
  });

  return uniqueRows(rows);
}

function extractMetadata($) {
  const rows = [];
  const title = normalizeText($('title').first().text());

  if (title) rows.push({ name: 'title', content: title });

  $('meta').each((_, element) => {
    const name = $(element).attr('name') || $(element).attr('property') || $(element).attr('http-equiv');
    const content = $(element).attr('content');

    if (name && content) {
      rows.push({
        name,
        content
      });
    }
  });

  $('link[rel="canonical"], link[rel="alternate"]').each((_, element) => {
    rows.push({
      name: `link:${$(element).attr('rel')}`,
      content: $(element).attr('href')
    });
  });

  return uniqueRows(rows);
}

function extractPrices($) {
  const text = $('body').text();
  const matches = text.match(pricePattern) || [];

  return uniqueRows(matches.map((price) => ({ value: price })));
}

function extractDates($) {
  const rows = [];

  $('time, [datetime]').each((_, element) => {
    rows.push({
      source: element.tagName.toLowerCase() === 'time' ? 'time tag' : 'datetime attribute',
      value: $(element).attr('datetime') || $(element).text()
    });
  });

  const text = $('body').text();
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
    case 'paragraphs':
      return extractParagraphs($);
    case 'links':
      return extractLinks($, pageUrl);
    case 'images':
      return extractImages($, pageUrl);
    case 'tables':
      return extractTables($);
    case 'lists':
      return extractLists($);
    case 'metadata':
      return extractMetadata($);
    case 'prices':
      return extractPrices($);
    case 'dates':
      return extractDates($);
    default:
      return [];
  }
}

function getGroupedCandidates($) {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (selector, element) => {
    if (!element) return;

    const block = $(element);
    const text = normalizeText(block.text());
    const linkCount = block
      .find('a[href]')
      .filter((_, link) => isUsefulHref($(link).attr('href')) && !isNoisyContainer($, link)).length;

    if (
      text.length < 20 ||
      text.length > 1200 ||
      block.closest('header, nav, footer, script, style, noscript, [role="navigation"]').length ||
      linkCount > 12
    ) {
      return;
    }

    const signature = text.slice(0, 220);
    if (seen.has(signature)) return;

    seen.add(signature);
    candidates.push({ selector, element });
  };
  const specificSelectors = [
    '[data-component-type="s-search-result"]',
    '[data-asin][data-component-type]',
    '[data-asin]:not([data-asin=""])',
    '.s-result-item',
    '[data-testid*="card"]',
    '[data-testid*="promo"]',
    '[data-testid*="item"]',
    '[class*="promo"]',
    '[class*="story"]',
    '[class*="media"]',
    '.product',
    '.product-card',
    '.card',
    '.post',
    '.product',
    '[class*="product"]',
    '[class*="card"]',
    '[class*="post"]'
  ];
  const structuralSelectors = ['main > section', 'main > article', 'body > section', 'body > article', 'article', 'section'];
  const hasSpecificBlocks = specificSelectors.some(
    (selector) =>
      $(selector).filter((_, element) => {
        const block = $(element);
        return (
          normalizeText(block.text()).length >= 20 &&
          !block.closest('header, nav, footer, script, style, noscript').length
        );
      }).length >= 2
  );
  const selectors = hasSpecificBlocks ? specificSelectors : structuralSelectors;

  selectors.forEach((selector) => {
    const elements = $(selector)
      .filter((_, element) => {
        const block = $(element);
        return (
          normalizeText(block.text()).length >= 20 &&
          !block.closest('header, nav, footer, script, style, noscript').length
        );
      })
      .slice(0, 60);

    if (elements.length < 1) return;

    elements.each((_, element) => {
      addCandidate(selector, element);
    });
  });

  if (candidates.length < 2) {
    $('a[href]')
      .filter((_, link) => isUsefulHref($(link).attr('href')) && !isNoisyContainer($, link))
      .each((_, link) => {
        let current = $(link);

        for (let depth = 0; depth < 5; depth += 1) {
          const parent = current.parent();
          if (!parent.length || parent.is('body, html, main')) break;

          const textLength = normalizeText(parent.text()).length;
          const hasMedia = parent.find('img[src], picture, figure').length > 0;
          const hasHeading = parent.find('h1, h2, h3').length > 0;
          const linkCount = parent
            .find('a[href]')
            .filter((__, item) => isUsefulHref($(item).attr('href')) && !isNoisyContainer($, item)).length;

          if (textLength >= 30 && textLength <= 900 && linkCount <= 6 && (hasMedia || hasHeading || depth >= 1)) {
            addCandidate('link-card', parent.get(0));
            break;
          }

          current = parent;
        }
      });
  }

  if (!candidates.length) {
    candidates.push({ selector: 'body', element: $('body').get(0) });
  }

  return candidates;
}

function extractGrouped($, pageUrl, selectedFilters) {
  const selected = new Set(selectedFilters);
  const groups = [];
  const pageMetadata = selected.has('metadata')
    ? extractMetadata($)
        .map((item) => `${item.name}: ${item.content}`)
        .join(' | ')
    : '';

  getGroupedCandidates($).forEach((candidate, index) => {
    const block = $(candidate.element);
    const text = normalizeText(block.text());
    const row = {
      group: index + 1,
      selector: candidate.selector
    };

    if (selected.has('headings')) {
      const headingValues = compactValues(
        block
          .find('h1, h2, h3')
          .map((_, element) => $(element).text())
          .get()
      );

      if (!headingValues.length) {
        const fallbackHeading = normalizeText(
          block
            .find('a[href]')
            .filter((_, link) => isUsefulHref($(link).attr('href')) && !isNoisyContainer($, link))
            .first()
            .text()
        );
        if (fallbackHeading) headingValues.push(fallbackHeading);
      }

      row.headings = headingValues.join(' | ');
    }

    if (selected.has('paragraphs')) {
      const headings = compactValues(String(row.headings || '').split(' | '));
      const paragraphValues = removeDuplicateValues(
        compactValues(
          block
            .find('p')
            .map((_, element) => $(element).text())
            .get()
        ),
        headings
      );

      row.paragraphs = paragraphValues.join(' | ');
    }

    if (selected.has('paragraphs') && !row.paragraphs) {
      const headings = compactValues(String(row.headings || '').split(' | '));
      const fallbackTexts = removeDuplicateValues(
        compactValues(
          block
            .children()
            .not('a, img, picture, figure, h1, h2, h3, ul, ol, script, style')
            .map((_, element) => $(element).text())
            .get()
        ),
        headings
      );

      row.paragraphs = fallbackTexts.join(' | ');
    }

    if (selected.has('links')) {
      const headings = compactValues(String(row.headings || '').split(' | '));
      const links = uniqueLinksByHref(
        block
          .find('a[href]')
          .filter((_, element) => isUsefulHref($(element).attr('href')) && !isNoisyContainer($, element))
          .map((_, element) => ({
            text: $(element).text(),
            href: createAbsoluteUrl($(element).attr('href'), pageUrl)
          }))
          .get()
      );

      row.links = links
        .map((item) => {
          const label = normalizeText(item.text);
          const isDuplicateLabel = headings.some((heading) => heading.toLowerCase() === label.toLowerCase());
          return isDuplicateLabel || !label ? item.href : `${label}: ${item.href}`;
        })
        .join(' | ');
    }

    if (selected.has('images')) {
      row.images = uniqueRows(
        block
          .find('img[src]')
          .map((_, element) => ({
            src: createAbsoluteUrl($(element).attr('src'), pageUrl),
            alt: $(element).attr('alt') || ''
          }))
          .get()
      )
        .map((item) => `${item.alt || 'image'}: ${item.src}`)
        .join(' | ');
    }

    if (selected.has('prices')) {
      row.prices = compactValues(text.match(pricePattern) || []).join(' | ');
    }

    if (selected.has('dates')) {
      const timeValues = block
        .find('time, [datetime]')
        .map((_, element) => $(element).attr('datetime') || $(element).text())
        .get();
      row.dates = compactValues(timeValues.concat(text.match(datePattern) || [])).join(' | ');
    }

    if (selected.has('lists')) {
      row.lists = compactValues(
        block
          .find('li')
          .map((_, element) => $(element).text())
          .get()
      ).join(' | ');
    }

    if (selected.has('metadata')) {
      row.metadata = pageMetadata;
    }

    row.excerpt = text.slice(0, 280);

    if (Object.keys(row).some((key) => !['group', 'selector', 'excerpt'].includes(key) && row[key])) {
      groups.push(row);
    }
  });

  const cleanedGroups = uniqueRows(groups);

  if (selected.has('dates')) {
    const existingDates = new Set(
      cleanedGroups.flatMap((group) => compactValues(String(group.dates || '').split(' | ')))
    );
    const pageDates = extractDates($)
      .map((item) => item.value)
      .filter((date) => !existingDates.has(date));

    if (pageDates.length) {
      cleanedGroups.push({
        group: cleanedGroups.length + 1,
        selector: 'page',
        headings: selected.has('headings') ? 'Page-level dates' : '',
        dates: compactValues(pageDates).join(' | ')
      });
    }
  }

  return cleanedGroups.slice(0, 80);
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

function buildCsv(sections, exportSettings = null) {
  const escapeCsv = (value) => {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  };
  const preferredFields = [
    'filter',
    'group',
    'selector',
    'level',
    'text',
    'href',
    'src',
    'alt',
    'table',
    'row',
    'name',
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
    'change',
    'value_1',
    'value_2',
    'value_3',
    'value_4',
    'value_5',
    'value_6',
    'values',
    'list',
    'type',
    'item',
    'content',
    'value',
    'source',
    'headings',
    'paragraphs',
    'links',
    'images',
    'prices',
    'dates',
    'metadata',
    'lists',
    'excerpt'
  ];
  const rows = [];

  sections.forEach((section) => {
    section.items.forEach((item) => {
      rows.push({
        filter: section.label,
        ...item
      });
    });
  });

  const extraFields = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).filter(
    (field) => !preferredFields.includes(field)
  );
  const fields = preferredFields.filter((field) => rows.some((row) => row[field])).concat(extraFields);
  const lines = [];

  if (exportSettings) {
    lines.push('setting,value');
    Object.entries(exportSettings).forEach(([key, value]) => {
      lines.push([key, Array.isArray(value) ? value.join(', ') : value].map(escapeCsv).join(','));
    });
    lines.push('');
  }

  lines.push(fields.join(','));

  rows.forEach((row) => {
    lines.push(fields.map((field) => escapeCsv(row[field] || '')).join(','));
  });

  return lines.join('\n');
}

app.post('/api/analyze', async (req, res) => {
  try {
    const pageUrl = await validatePublicUrl(req.body.url);
    const fetched = await fetchHtml(pageUrl);
    const filters = analyzeFilters(fetched.html, fetched.finalUrl);

    htmlCache.set(fetched.finalUrl, {
      html: fetched.html,
      createdAt: Date.now()
    });

    res.json({
      url: fetched.finalUrl,
      requestedUrl: pageUrl,
      redirected: fetched.finalUrl !== pageUrl,
      redirects: fetched.redirects,
      title: normalizeText(cheerio.load(fetched.html)('title').first().text()) || 'Untitled page',
      filters
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to analyze this URL.' });
  }
});

app.post('/api/extract', async (req, res) => {
  const startedAt = Date.now();

  try {
    const pageUrl = await validatePublicUrl(req.body.url);
    const selectedFilters = Array.isArray(req.body.filters) ? req.body.filters : [];
    const allowedKeys = new Set(FILTERS.map((filter) => filter.key));
    const filters = selectedFilters.filter((key) => allowedKeys.has(key));
    const grouped = Boolean(req.body.grouped);

    if (!filters.length) {
      throw new Error('Select at least one filter before extracting data.');
    }

    let cached = htmlCache.get(pageUrl);
    if (!cached || Date.now() - cached.createdAt > 10 * 60 * 1000) {
      const fetched = await fetchHtml(pageUrl);
      cached = {
        html: fetched.html,
        createdAt: Date.now()
      };
      htmlCache.set(fetched.finalUrl, cached);
    }

    const $ = cheerio.load(cached.html);
    const sections = grouped
      ? [
          {
            key: 'grouped',
            label: 'Grouped Results',
            items: extractGrouped($, pageUrl, filters)
          }
        ]
      : filters.map((key) => {
          const filter = FILTERS.find((item) => item.key === key);
          return {
            key,
            label: filter.label,
            items: extractByFilter(key, $, pageUrl)
          };
        });
    const totalItems = sections.reduce((sum, section) => sum + section.items.length, 0);
    const selectedLabels = filters.map((key) => FILTERS.find((filter) => filter.key === key).label);
    const durationMs = Date.now() - startedAt;
    const exportSettings = {
      sourceUrl: pageUrl,
      groupedMode: grouped,
      selectedFilters: selectedLabels,
      totalItems,
      durationMs
    };

    res.json({
      url: pageUrl,
      extractedAt: new Date().toISOString(),
      grouped,
      exportSettings,
      summary: {
        totalItems,
        selectedFilters: selectedLabels,
        filterCount: selectedLabels.length,
        durationMs
      },
      sections,
      csv: buildCsv(sections, exportSettings)
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to extract data from this URL.' });
  }
});

app.use((_, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SmartFetch is running at http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  analyzeFilters,
  buildCsv,
  createAbsoluteUrl,
  extractByFilter,
  extractGrouped,
  fetchHtml,
  isUsefulHref,
  isPrivateIp,
  normalizeText,
  uniqueRows,
  validatePublicUrl
};
