const assert = require('node:assert/strict');
const test = require('node:test');
const cheerio = require('cheerio');

const {
  analyzeFilters,
  buildCsv,
  createAbsoluteUrl,
  extractByFilter,
  extractGrouped,
  isPrivateIp,
  normalizeText,
  uniqueRows
} = require('../server');

const sampleHtml = `
<!doctype html>
<html>
  <head>
    <title>Sample Shop</title>
    <meta name="description" content="Deals on jackets and shoes">
    <meta property="og:title" content="Sample Shop Social Title">
  </head>
  <body>
    <h1> Sample Shop </h1>
    <h2>Deals</h2>
    <nav>
      <ul>
        <li><a href="javascript:void(0)">Cart</a></li>
        <li><a href="#top">Back to top</a></li>
      </ul>
    </nav>
    <p>Offer ends 2026-05-10 and costs €49.99.</p>
    <a href="/products/1"> Blue Jacket </a>
    <a href="/products/1"> Blue Jacket </a>
    <img src="/images/jacket.jpg" alt=" Blue jacket ">
    <ul>
      <li>Free delivery</li>
      <li>New arrivals</li>
    </ul>
    <table>
      <tr><th>Name</th><th>Price</th></tr>
      <tr><td>Blue Jacket</td><td>120 TND</td></tr>
    </table>
    <time datetime="2026-05-02">May 2, 2026</time>
    <article class="product-card">
      <h3>Blue Jacket</h3>
      <p>Warm winter jacket.</p>
      <a href="/products/1">View</a>
      <img src="/images/jacket.jpg" alt="Blue jacket">
      <span>120 TND</span>
    </article>
    <article class="product-card">
      <h3>Red Shoes</h3>
      <p>Running shoes with light material.</p>
      <a href="/products/2">View</a>
      <img src="/images/shoes.jpg" alt="Red shoes">
      <span>$89.50</span>
    </article>
  </body>
</html>
`;

const pageUrl = 'https://example.com/catalog';
const groupedWrapperHtml = `
<!doctype html>
<html>
  <body>
    <main>
      <section>
        <div class="story-card">
          <a href="/sport/story-1">First sport story</a>
          <img src="/one.jpg" alt="First image">
          <p>First summary text.</p>
        </div>
        <div class="story-card">
          <a href="/sport/story-2">Second sport story</a>
          <img src="/two.jpg" alt="Second image">
          <p>Second summary text.</p>
        </div>
      </section>
    </main>
  </body>
</html>
`;
const duplicatedLinksHtml = `
<!doctype html>
<html>
  <body>
    <article class="product-card">
      <h3>Gaming PC</h3>
      <a href="/product/pc">Gaming PC</a>
      <a href="/product/pc">3 sizes</a>
      <a href="/product/pc">$1,499.99</a>
      <img src="/pc.jpg" alt="Gaming PC">
    </article>
  </body>
</html>
`;
const steamLikeTableHtml = `
<!doctype html>
<html>
  <body>
    <div class="substats_row row_0">
      <div class="substats_col_left"><span>NVIDIA GeForce RTX 3060</span></div>
      <div class="substats_col_month">4.25%</div>
      <div class="substats_col_month">4.28%</div>
      <div class="substats_col_month_last_pct"><strong>4.15%</strong></div>
      <div class="substats_col_month_last_chg">+0.05%</div>
    </div>
    <div class="substats_row row_1">
      <div class="substats_col_left"><span>NVIDIA GeForce RTX 4060</span></div>
      <div class="substats_col_month">3.90%</div>
      <div class="substats_col_month">4.36%</div>
      <div class="substats_col_month_last_pct"><strong>4.05%</strong></div>
      <div class="substats_col_month_last_chg">-0.31%</div>
    </div>
  </body>
</html>
`;
const laterDateRowsHtml = `
<!doctype html>
<html>
  <body>
    <article class="story-card">
      <a href="/story-1">Story without date</a>
      <p>No date here.</p>
    </article>
    <article class="story-card">
      <a href="/story-2">Story with date</a>
      <p>Published update.</p>
      <span datetime="2026-05-02">2 May 2026</span>
    </article>
  </body>
</html>
`;

test('normalizes whitespace and removes duplicate or empty rows', () => {
  assert.equal(normalizeText('  Hello \n\n SmartFetch  '), 'Hello SmartFetch');
  assert.deepEqual(
    uniqueRows([
      { text: ' Alpha ' },
      { text: 'Alpha' },
      { text: '   ' },
      { text: 'Beta' }
    ]),
    [{ text: 'Alpha' }, { text: 'Beta' }]
  );
});

test('extracts separate filters from sample HTML', () => {
  const $ = cheerio.load(sampleHtml);

  assert.deepEqual(extractByFilter('headings', $, pageUrl), [
    { level: 'h1', text: 'Sample Shop' },
    { level: 'h2', text: 'Deals' },
    { level: 'h3', text: 'Blue Jacket' },
    { level: 'h3', text: 'Red Shoes' }
  ]);

  assert.deepEqual(extractByFilter('paragraphs', $, pageUrl), [
    { text: 'Offer ends 2026-05-10 and costs €49.99.' },
    { text: 'Warm winter jacket.' },
    { text: 'Running shoes with light material.' }
  ]);

  assert.deepEqual(extractByFilter('links', $, pageUrl), [
    { text: 'Blue Jacket', href: 'https://example.com/products/1' },
    { text: 'View', href: 'https://example.com/products/1' },
    { text: 'View', href: 'https://example.com/products/2' }
  ]);

  assert.deepEqual(extractByFilter('images', $, pageUrl), [
    { src: 'https://example.com/images/jacket.jpg', alt: 'Blue jacket' },
    { src: 'https://example.com/images/shoes.jpg', alt: 'Red shoes' }
  ]);

  assert.equal(extractByFilter('tables', $, pageUrl).length, 2);
  assert.deepEqual(extractByFilter('lists', $, pageUrl), [
    { list: '1', type: 'unordered', item: '1', text: 'Free delivery' },
    { list: '1', type: 'unordered', item: '2', text: 'New arrivals' }
  ]);
  assert.deepEqual(extractByFilter('metadata', $, pageUrl), [
    { name: 'title', content: 'Sample Shop' },
    { name: 'description', content: 'Deals on jackets and shoes' },
    { name: 'og:title', content: 'Sample Shop Social Title' }
  ]);
  assert.deepEqual(extractByFilter('prices', $, pageUrl), [
    { value: '€49.99' },
    { value: '120 TND' },
    { value: '$89.50' }
  ]);
  assert.equal(extractByFilter('dates', $, pageUrl).length, 3);
});

test('extracts table-like div layouts such as Steam hardware rows', () => {
  const $ = cheerio.load(steamLikeTableHtml);

  assert.deepEqual(extractByFilter('tables', $, pageUrl), [
    {
      table: 'div layout',
      row: '1',
      name: 'NVIDIA GeForce RTX 3060',
      value_1: '4.25%',
      value_2: '4.28%',
      value_3: '4.15%',
      change: '+0.05%',
      values: 'NVIDIA GeForce RTX 3060 | 4.25% | 4.28% | 4.15% | +0.05%'
    },
    {
      table: 'div layout',
      row: '2',
      name: 'NVIDIA GeForce RTX 4060',
      value_1: '3.90%',
      value_2: '4.36%',
      value_3: '4.05%',
      change: '-0.31%',
      values: 'NVIDIA GeForce RTX 4060 | 3.90% | 4.36% | 4.05% | -0.31%'
    }
  ]);
});

test('extracts grouped results that preserve nearby relationships', () => {
  const $ = cheerio.load(sampleHtml);
  const groups = extractGrouped($, pageUrl, ['headings', 'paragraphs', 'links', 'images', 'prices', 'metadata']);

  assert.ok(groups.length >= 2);
  assert.equal(groups.some((group) => String(group.links || '').includes('javascript:void')), false);
  assert.equal(groups.some((group) => String(group.selector || '') === 'li'), false);
  assert.ok(
    groups.some(
      (group) =>
        group.headings === 'Blue Jacket' &&
        group.paragraphs === 'Warm winter jacket.' &&
        group.links.includes('https://example.com/products/1') &&
        group.prices === '120 TND' &&
        group.metadata.includes('description: Deals on jackets and shoes')
    )
  );
  assert.ok(groups.some((group) => group.headings === 'Red Shoes' && group.images.includes('/images/shoes.jpg')));
});

test('splits large grouped wrappers into story cards', () => {
  const $ = cheerio.load(groupedWrapperHtml);
  const groups = extractGrouped($, pageUrl, ['headings', 'paragraphs', 'links', 'images']);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => group.headings),
    ['First sport story', 'Second sport story']
  );
  assert.ok(groups.every((group) => group.selector !== 'body'));
  assert.ok(groups.every((group) => group.images));
  assert.equal(groups[0].paragraphs, 'First summary text.');
  assert.equal(groups[0].links, 'https://example.com/sport/story-1');
});

test('deduplicates grouped links by href', () => {
  const $ = cheerio.load(duplicatedLinksHtml);
  const groups = extractGrouped($, pageUrl, ['headings', 'links', 'images', 'prices']);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].links, '3 sizes: https://example.com/product/pc');
});

test('extracts grouped dates from datetime attributes', () => {
  const $ = cheerio.load(laterDateRowsHtml);
  const groups = extractGrouped($, pageUrl, ['headings', 'paragraphs', 'links', 'dates']);

  assert.equal(groups.length, 2);
  assert.equal(groups[1].dates, '2026-05-02 | 2 May 2026');
});

test('keeps page-level dates visible in grouped mode', () => {
  const $ = cheerio.load(`
    <html>
      <body>
        <p>Updated 2026-05-02</p>
        <article class="story-card"><a href="/story">Story without local date</a></article>
      </body>
    </html>
  `);
  const groups = extractGrouped($, pageUrl, ['headings', 'links', 'dates']);

  assert.ok(groups.some((group) => group.headings === 'Page-level dates' && group.dates === '2026-05-02'));
});

test('analyzes available filters and builds table-style CSV', () => {
  const filters = analyzeFilters(sampleHtml, pageUrl);
  assert.equal(filters.find((filter) => filter.key === 'paragraphs').available, true);
  assert.equal(filters.find((filter) => filter.key === 'metadata').available, true);
  assert.equal(filters.find((filter) => filter.key === 'lists').available, true);
  assert.equal(filters.some((filter) => filter.key === 'repeatedBlocks'), false);

  const csv = buildCsv([
    {
      label: 'Links',
      items: [{ text: 'Blue Jacket', href: 'https://example.com/products/1' }]
    },
    {
      label: 'Metadata',
      items: [{ name: 'description', content: 'Deals on jackets and shoes' }]
    }
  ]);

  assert.equal(csv.split('\n')[0], 'filter,text,href,name,content');
  assert.match(csv, /"Links","Blue Jacket","https:\/\/example.com\/products\/1","",""/);
});

test('adds export settings to CSV when provided', () => {
  const csv = buildCsv(
    [
      {
        label: 'Headings',
        items: [{ level: 'h1', text: 'Sample Shop' }]
      }
    ],
    {
      sourceUrl: pageUrl,
      groupedMode: false,
      selectedFilters: ['Headings'],
      totalItems: 1,
      durationMs: 12
    }
  );
  const lines = csv.split('\n');

  assert.equal(lines[0], 'setting,value');
  assert.equal(lines[1], `"sourceUrl","${pageUrl}"`);
  assert.equal(lines[6], '');
  assert.equal(lines[7], 'filter,level,text');
});

test('protects private IP ranges and resolves relative URLs', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('192.168.1.10'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(createAbsoluteUrl('/item', pageUrl), 'https://example.com/item');
});
