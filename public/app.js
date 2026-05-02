const analyzeForm = document.querySelector('#analyzeForm');
const urlInput = document.querySelector('#urlInput');
const analyzeButton = document.querySelector('#analyzeButton');
const extractButton = document.querySelector('#extractButton');
const selectAllButton = document.querySelector('#selectAllButton');
const clearSelectionButton = document.querySelector('#clearSelectionButton');
const groupedMode = document.querySelector('#groupedMode');
const filtersGrid = document.querySelector('#filtersGrid');
const previewArea = document.querySelector('#previewArea');
const messageBox = document.querySelector('#messageBox');
const pageSummary = document.querySelector('#pageSummary');
const resultSummary = document.querySelector('#resultSummary');
const urlHistory = document.querySelector('#urlHistory');
const previewModeControls = document.querySelector('#previewModeControls');
const tableViewButton = document.querySelector('#tableViewButton');
const cardViewButton = document.querySelector('#cardViewButton');
const jsonButton = document.querySelector('#jsonButton');
const csvButton = document.querySelector('#csvButton');
const connectionStatus = document.querySelector('#connectionStatus');

const idleLabels = {
  analyze: 'Analyze',
  extract: 'Extract Selected Data'
};
const PAGE_SIZE = 20;
const MAX_HISTORY = 6;

let currentUrl = '';
let latestExtraction = null;
let busyMode = '';
let analyzedHistory = [];
let visibleRows = {};
let previewMode = 'table';

function setStatus(text) {
  connectionStatus.textContent = text;
}

function showMessage(text, type = 'error') {
  messageBox.textContent = text;
  messageBox.className = type === 'success' ? 'message success' : 'message';
  messageBox.hidden = false;
}

function clearMessage() {
  messageBox.hidden = true;
  messageBox.textContent = '';
}

function setButtonLoading(button, isLoading, label) {
  if (isLoading) {
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${label}`;
    return;
  }

  button.textContent = button === analyzeButton ? idleLabels.analyze : idleLabels.extract;
}

function setBusy(isBusy, mode = '') {
  busyMode = isBusy ? mode : '';

  analyzeButton.disabled = isBusy;
  extractButton.disabled = isBusy || getSelectedFilters().length === 0;
  selectAllButton.disabled = isBusy || getAvailableFilterInputs().length === 0;
  clearSelectionButton.disabled = isBusy || getSelectedFilters().length === 0;

  setButtonLoading(analyzeButton, isBusy && mode === 'analyze', 'Analyzing');
  setButtonLoading(extractButton, isBusy && mode === 'extract', 'Extracting');
  setStatus(isBusy ? (mode === 'analyze' ? 'Analyzing' : 'Extracting') : 'Ready');
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

function renderHistory() {
  if (!analyzedHistory.length) {
    urlHistory.hidden = true;
    urlHistory.innerHTML = '';
    return;
  }

  urlHistory.hidden = false;
  urlHistory.innerHTML = `
    <span>Recent URLs</span>
    <div>
      ${analyzedHistory
        .map(
          (item) => `
            <button type="button" class="history-chip" data-url="${escapeHtml(item.url)}" title="${escapeHtml(item.url)}">
              ${escapeHtml(formatShortUrl(item.url))}
            </button>
          `
        )
        .join('')}
    </div>
  `;
}

function addHistoryItem(result) {
  analyzedHistory = [
    {
      url: result.url,
      title: result.title
    },
    ...analyzedHistory.filter((item) => item.url !== result.url)
  ].slice(0, MAX_HISTORY);

  renderHistory();
}

function renderFilters(filters) {
  filtersGrid.className = 'filters-grid';
  filtersGrid.innerHTML = '';

  filters.forEach((filter) => {
    const card = document.createElement('article');
    card.className = `filter-card${filter.available ? '' : ' unavailable'}`;

    card.innerHTML = `
      <label>
        <input type="checkbox" value="${escapeHtml(filter.key)}" ${filter.available ? '' : 'disabled'}>
        <div>
          <h3>${escapeHtml(filter.label)}</h3>
          <p>${escapeHtml(filter.description)}</p>
          <span class="count">${filter.count} item${filter.count === 1 ? '' : 's'} found</span>
        </div>
      </label>
    `;

    filtersGrid.appendChild(card);
  });

  updateFilterControls();
}

function getAvailableFilterInputs() {
  return Array.from(document.querySelectorAll('.filter-card input:not(:disabled)'));
}

function getSelectedFilters() {
  return Array.from(document.querySelectorAll('.filter-card input:checked')).map((input) => input.value);
}

function updateFilterControls() {
  const selectedCount = getSelectedFilters().length;
  const availableCount = getAvailableFilterInputs().length;
  const isBusy = Boolean(busyMode);

  extractButton.disabled = isBusy || selectedCount === 0;
  selectAllButton.disabled = isBusy || availableCount === 0 || selectedCount === availableCount;
  clearSelectionButton.disabled = isBusy || selectedCount === 0;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isImageUrl(value) {
  const text = String(value || '').split('?')[0].toLowerCase();
  return isUrl(value) && /\.(avif|gif|jpeg|jpg|png|webp|svg)$/.test(text);
}

function formatShortUrl(value, maxLength = 54) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function splitGroupedValue(value) {
  return String(value || '')
    .split(' | ')
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderImageLink(url, label = 'Extracted image') {
  return `
    <a class="image-link" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${escapeHtml(url)}">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy">
    </a>
  `;
}

function renderUrlLink(url, label = url) {
  return `
    <a class="table-url" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${escapeHtml(url)}">
      ${escapeHtml(formatShortUrl(label))}
    </a>
  `;
}

function renderGroupedMedia(value, type) {
  const items = splitGroupedValue(value);
  if (!items.length) return '';

  return `<div class="${type === 'image' ? 'image-list' : 'cell-list'}">${items
    .map((item) => {
      const separator = item.lastIndexOf(': http');
      const label = separator > -1 ? item.slice(0, separator) : '';
      const url = separator > -1 ? item.slice(separator + 2) : item;

      if (type === 'image' && isUrl(url)) {
        return renderImageLink(url, label || 'Extracted image');
      }

      if (isUrl(url)) {
        return `<span>${label ? `${escapeHtml(label)}: ` : ''}${renderUrlLink(url)}</span>`;
      }

      return `<span title="${escapeHtml(item)}">${escapeHtml(formatShortUrl(item, 90))}</span>`;
    })
    .join('')}</div>`;
}

function renderCellValue(field, value) {
  const text = String(value || '');
  if (!text) return '';

  if (['src', 'image'].includes(field) && isUrl(text)) {
    return renderImageLink(text);
  }

  if (field === 'images') {
    return renderGroupedMedia(text, 'image');
  }

  if (field === 'links') {
    return renderGroupedMedia(text, 'link');
  }

  if (['paragraphs', 'metadata', 'lists'].includes(field)) {
    const items = splitGroupedValue(text);

    if (items.length > 1 || text.length > 180) {
      return `<div class="cell-list">${items.map((item) => `<span title="${escapeHtml(item)}">${escapeHtml(item)}</span>`).join('')}</div>`;
    }
  }

  if (['href', 'link'].includes(field) && isUrl(text)) {
    return renderUrlLink(text);
  }

  if (isUrl(text)) {
    return renderUrlLink(text);
  }

  return `<span title="${escapeHtml(text)}">${escapeHtml(formatShortUrl(text, 220))}</span>`;
}

function getDisplayFieldName(field) {
  const labels = {
    text: 'List item',
    type: 'List type'
  };

  return labels[field] || field;
}

function getPreviewFields(items) {
  const hiddenFields = new Set(['excerpt', 'group', 'selector', 'list', 'item']);
  const hasStructuredTableColumns = items.some((item) =>
    Object.keys(item).some((field) => /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|value_\d+|change|name)$/.test(field))
  );

  if (hasStructuredTableColumns) {
    hiddenFields.add('values');
  }

  const preferredOrder = [
    'images',
    'image',
    'src',
    'headings',
    'level',
    'text',
    'paragraphs',
    'prices',
    'value',
    'dates',
    'links',
    'href',
    'lists',
    'metadata',
    'name',
    'content',
    'table',
    'row',
    'values',
    'list',
    'type',
    'item',
    'source',
    'alt'
  ];
  const fields = Array.from(new Set(items.flatMap((item) => Object.keys(item)))).filter(
    (field) => !hiddenFields.has(field)
  );

  return fields.sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a);
    const bIndex = preferredOrder.indexOf(b);

    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}

function renderListPreview(section, sectionId) {
  const visibleItems = section.items.slice(0, visibleRows[sectionId]);
  const grouped = visibleItems.reduce((groups, item) => {
    const key = item.list || '1';
    if (!groups[key]) {
      groups[key] = {
        type: item.type || 'list',
        items: []
      };
    }

    groups[key].items.push(item.text);
    return groups;
  }, {});
  const listBlocks = Object.entries(grouped)
    .map(([listNumber, group]) => {
      const tag = group.type === 'ordered' ? 'ol' : 'ul';
      const listItems = group.items.map((text) => `<li>${renderCellValue('text', text)}</li>`).join('');

      return `
        <article class="list-preview-card">
          <h4>List ${escapeHtml(listNumber)} <span>${escapeHtml(group.type)}</span></h4>
          <${tag}>${listItems}</${tag}>
        </article>
      `;
    })
    .join('');

  return `
    <section class="preview-section">
      <h3>${escapeHtml(section.label)} (${visibleItems.length} of ${section.items.length})</h3>
      <div class="list-preview-grid">${listBlocks}</div>
      ${
        visibleItems.length < section.items.length
          ? `<button type="button" class="view-more" data-section="${sectionId}">View 20 more</button>`
          : ''
      }
    </section>
  `;
}

function renderGroupedCardValue(label, field, value) {
  const rendered = renderCellValue(field, value);
  if (!rendered) return '';

  return `
    <div class="grouped-card-field grouped-card-${escapeHtml(field)}">
      <span>${escapeHtml(label)}</span>
      <div>${rendered}</div>
    </div>
  `;
}

function renderGroupedCards(section, sectionId) {
  const visibleItems = section.items.slice(0, visibleRows[sectionId]);
  const cards = visibleItems
    .map((item) => {
      const title = item.headings || item.text || item.name || 'Grouped item';
      return `
        <article class="grouped-card">
          ${item.images ? `<div class="grouped-card-media">${renderCellValue('images', item.images)}</div>` : ''}
          <div class="grouped-card-body">
            <h4>${escapeHtml(title)}</h4>
            ${renderGroupedCardValue('Paragraphs', 'paragraphs', item.paragraphs)}
            ${renderGroupedCardValue('Prices', 'prices', item.prices)}
            ${renderGroupedCardValue('Dates', 'dates', item.dates)}
            ${renderGroupedCardValue('Links', 'links', item.links)}
            ${renderGroupedCardValue('Lists', 'lists', item.lists)}
            ${renderGroupedCardValue('Metadata', 'metadata', item.metadata)}
          </div>
        </article>
      `;
    })
    .join('');

  return `
    <section class="preview-section">
      <h3>${escapeHtml(section.label)} (${visibleItems.length} of ${section.items.length})</h3>
      <div class="grouped-card-grid">${cards}</div>
      ${
        visibleItems.length < section.items.length
          ? `<button type="button" class="view-more" data-section="${sectionId}">View 20 more</button>`
          : ''
      }
    </section>
  `;
}

function formatDuration(ms) {
  const duration = Number(ms) || 0;

  if (duration < 1000) {
    return `${duration} ms`;
  }

  return `${(duration / 1000).toFixed(2)} s`;
}

function resetPreview() {
  latestExtraction = null;
  visibleRows = {};
  jsonButton.disabled = true;
  csvButton.disabled = true;
  previewModeControls.hidden = true;
  resultSummary.hidden = true;
  resultSummary.innerHTML = '';
  previewArea.className = 'preview empty-state';
  previewArea.textContent = 'No extracted data yet.';
}

function renderResultSummary(extraction) {
  const summary = extraction.summary || {
    totalItems: extraction.sections.reduce((sum, section) => sum + section.items.length, 0),
    selectedFilters: extraction.sections.map((section) => section.label),
    filterCount: extraction.sections.length,
    durationMs: 0
  };

  resultSummary.hidden = false;
  resultSummary.innerHTML = `
    <div><strong>${summary.totalItems}</strong><span>Total rows</span></div>
    <div><strong>${summary.filterCount}</strong><span>Filters selected</span></div>
    <div><strong>${escapeHtml(formatDuration(summary.durationMs))}</strong><span>Duration</span></div>
    <div><strong>${extraction.grouped ? 'Grouped' : 'Separate'}</strong><span>Mode</span></div>
    <div><strong>${escapeHtml(summary.selectedFilters.join(', '))}</strong><span>Selected filters</span></div>
  `;
}

function renderPreview(extraction, resetRows = true) {
  latestExtraction = extraction;
  previewArea.className = 'preview';
  previewArea.innerHTML = '';
  previewModeControls.hidden = !extraction.grouped;
  tableViewButton.classList.toggle('active', previewMode === 'table');
  cardViewButton.classList.toggle('active', previewMode === 'cards');
  renderResultSummary(extraction);

  const sectionsWithData = extraction.sections.filter((section) => section.items.length);

  if (!sectionsWithData.length) {
    previewArea.className = 'preview empty-state';
    previewArea.textContent = 'The selected filters did not return any clean data.';
    jsonButton.disabled = true;
    csvButton.disabled = true;
    return;
  }

  if (resetRows) {
    visibleRows = {};
  }

  sectionsWithData.forEach((section, sectionIndex) => {
    const sectionId = `${section.key}-${sectionIndex}`;
    if (!visibleRows[sectionId]) visibleRows[sectionId] = PAGE_SIZE;

    if (extraction.grouped && previewMode === 'cards') {
      previewArea.insertAdjacentHTML('beforeend', renderGroupedCards(section, sectionId));
      return;
    }

    if (section.key === 'lists') {
      previewArea.insertAdjacentHTML('beforeend', renderListPreview(section, sectionId));
      return;
    }

    const visibleItems = section.items.slice(0, visibleRows[sectionId]);
    const fields = getPreviewFields(section.items);
    const wrapper = document.createElement('section');
    wrapper.className = 'preview-section';

    const headerCells = fields.map((field) => `<th>${escapeHtml(getDisplayFieldName(field))}</th>`).join('');
    const rows = visibleItems
      .map((item) => {
        const cells = fields
          .map((field) => `<td class="field-${escapeHtml(field)}">${renderCellValue(field, item[field])}</td>`)
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    wrapper.innerHTML = `
      <h3>${escapeHtml(section.label)} (${visibleItems.length} of ${section.items.length})</h3>
      <table>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${
        visibleItems.length < section.items.length
          ? `<button type="button" class="view-more" data-section="${sectionId}">View 20 more</button>`
          : ''
      }
    `;

    previewArea.appendChild(wrapper);
  });

  jsonButton.disabled = false;
  csvButton.disabled = false;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

filtersGrid.addEventListener('change', updateFilterControls);

previewArea.addEventListener('click', (event) => {
  const button = event.target.closest('.view-more');
  if (!button || !latestExtraction) return;

  visibleRows[button.dataset.section] = (visibleRows[button.dataset.section] || PAGE_SIZE) + PAGE_SIZE;
  renderPreview(latestExtraction, false);
});

tableViewButton.addEventListener('click', () => {
  previewMode = 'table';
  if (latestExtraction) renderPreview(latestExtraction, false);
});

cardViewButton.addEventListener('click', () => {
  previewMode = 'cards';
  if (latestExtraction) renderPreview(latestExtraction, false);
});

urlHistory.addEventListener('click', (event) => {
  const button = event.target.closest('.history-chip');
  if (!button) return;

  urlInput.value = button.dataset.url;
  urlInput.focus();
});

selectAllButton.addEventListener('click', () => {
  getAvailableFilterInputs().forEach((input) => {
    input.checked = true;
  });
  updateFilterControls();
});

clearSelectionButton.addEventListener('click', () => {
  getAvailableFilterInputs().forEach((input) => {
    input.checked = false;
  });
  updateFilterControls();
});

analyzeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();
  resetPreview();
  setBusy(true, 'analyze');

  try {
    const result = await postJson('/api/analyze', { url: urlInput.value });
    currentUrl = result.url;

    pageSummary.hidden = false;
    pageSummary.innerHTML = `
      <strong>${escapeHtml(result.title)}</strong><br>
      ${escapeHtml(result.url)}
      ${result.redirected ? `<br><span>Redirected from ${escapeHtml(result.requestedUrl)}</span>` : ''}
    `;
    renderFilters(result.filters);
    addHistoryItem(result);
    showMessage('Analysis complete. Choose one or more filters to extract data.', 'success');
  } catch (error) {
    filtersGrid.className = 'filters-grid empty-state';
    filtersGrid.textContent =
      'Analyze a URL to discover headings, paragraphs, links, images, tables, lists, metadata, prices, and dates.';
    pageSummary.hidden = true;
    showMessage(error.message);
  } finally {
    setBusy(false);
    updateFilterControls();
  }
});

extractButton.addEventListener('click', async () => {
  clearMessage();
  setBusy(true, 'extract');

  try {
    const filters = getSelectedFilters();
    const result = await postJson('/api/extract', {
      url: currentUrl || urlInput.value,
      filters,
      grouped: groupedMode.checked
    });

    renderPreview(result);
    showMessage('Extraction complete. Preview and export are ready.', 'success');
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(false);
    updateFilterControls();
  }
});

jsonButton.addEventListener('click', () => {
  if (!latestExtraction) return;
  downloadFile('smartfetch-export.json', JSON.stringify(latestExtraction, null, 2), 'application/json');
});

csvButton.addEventListener('click', () => {
  if (!latestExtraction) return;
  downloadFile('smartfetch-export.csv', latestExtraction.csv, 'text/csv');
});
