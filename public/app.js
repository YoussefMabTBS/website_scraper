const analyzeForm = document.querySelector('#analyzeForm');
const urlInput = document.querySelector('#urlInput');
const analyzeButton = document.querySelector('#analyzeButton');
const extractButton = document.querySelector('#extractButton');
const filtersGrid = document.querySelector('#filtersGrid');
const previewArea = document.querySelector('#previewArea');
const messageBox = document.querySelector('#messageBox');
const pageSummary = document.querySelector('#pageSummary');
const jsonButton = document.querySelector('#jsonButton');
const csvButton = document.querySelector('#csvButton');
const connectionStatus = document.querySelector('#connectionStatus');

let currentUrl = '';
let latestExtraction = null;

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

function setBusy(isBusy, label = 'Working') {
  analyzeButton.disabled = isBusy;
  extractButton.disabled = isBusy || !document.querySelector('.filter-card input:checked');
  setStatus(isBusy ? label : 'Ready');
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

function renderFilters(filters) {
  filtersGrid.className = 'filters-grid';
  filtersGrid.innerHTML = '';

  filters.forEach((filter) => {
    const card = document.createElement('article');
    card.className = `filter-card${filter.available ? '' : ' unavailable'}`;

    card.innerHTML = `
      <label>
        <input type="checkbox" value="${filter.key}" ${filter.available ? '' : 'disabled'}>
        <div>
          <h3>${filter.label}</h3>
          <p>${filter.description}</p>
          <span class="count">${filter.count} item${filter.count === 1 ? '' : 's'} found</span>
        </div>
      </label>
    `;

    filtersGrid.appendChild(card);
  });

  filtersGrid.addEventListener('change', updateExtractButton);
  updateExtractButton();
}

function updateExtractButton() {
  const checked = document.querySelectorAll('.filter-card input:checked').length;
  extractButton.disabled = checked === 0;
}

function getSelectedFilters() {
  return Array.from(document.querySelectorAll('.filter-card input:checked')).map((input) => input.value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderPreview(extraction) {
  latestExtraction = extraction;
  previewArea.className = 'preview';
  previewArea.innerHTML = '';

  const sectionsWithData = extraction.sections.filter((section) => section.items.length);

  if (!sectionsWithData.length) {
    previewArea.className = 'preview empty-state';
    previewArea.textContent = 'The selected filters did not return any clean data.';
    jsonButton.disabled = true;
    csvButton.disabled = true;
    return;
  }

  sectionsWithData.forEach((section) => {
    const fields = Array.from(new Set(section.items.flatMap((item) => Object.keys(item))));
    const wrapper = document.createElement('section');
    wrapper.className = 'preview-section';

    const headerCells = fields.map((field) => `<th>${escapeHtml(field)}</th>`).join('');
    const rows = section.items
      .map((item) => {
        const cells = fields.map((field) => `<td>${escapeHtml(item[field] || '')}</td>`).join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    wrapper.innerHTML = `
      <h3>${escapeHtml(section.label)} (${section.items.length})</h3>
      <table>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
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

analyzeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();
  setBusy(true, 'Analyzing');
  latestExtraction = null;
  jsonButton.disabled = true;
  csvButton.disabled = true;
  previewArea.className = 'preview empty-state';
  previewArea.textContent = 'No extracted data yet.';

  try {
    const result = await postJson('/api/analyze', { url: urlInput.value });
    currentUrl = result.url;

    pageSummary.hidden = false;
    pageSummary.innerHTML = `<strong>${escapeHtml(result.title)}</strong><br>${escapeHtml(result.url)}`;
    renderFilters(result.filters);
    showMessage('Analysis complete. Choose one or more filters to extract data.', 'success');
  } catch (error) {
    filtersGrid.className = 'filters-grid empty-state';
    filtersGrid.textContent = 'Analyze a URL to discover headings, links, images, tables, prices, and dates.';
    pageSummary.hidden = true;
    extractButton.disabled = true;
    showMessage(error.message);
  } finally {
    setBusy(false);
    updateExtractButton();
  }
});

extractButton.addEventListener('click', async () => {
  clearMessage();
  setBusy(true, 'Extracting');

  try {
    const filters = getSelectedFilters();
    const result = await postJson('/api/extract', {
      url: currentUrl || urlInput.value,
      filters
    });

    renderPreview(result);
    showMessage('Extraction complete. Preview and export are ready.', 'success');
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(false);
    updateExtractButton();
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
