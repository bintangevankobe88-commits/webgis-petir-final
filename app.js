'use strict';

const DATA_PATHS = {
  points: 'data/petir.geojson',
  districts: 'data/kabupaten.geojson',
  metadata: 'data/metadata.json'
};

const PERIODS = ['Dini Hari', 'Pagi', 'Siang-Sore', 'Malam'];

/* Palet biru tenang agar peta tetap informatif tanpa terlihat ramai. */
const PERIOD_COLORS = {
  'Dini Hari': '#86a9f2',
  'Pagi': '#5f87dd',
  'Siang-Sore': '#1647b8',
  'Malam': '#b3c4ec'
};

const PERIOD_SHORT = {
  'Dini Hari': 'Dini Hari',
  'Pagi': 'Pagi',
  'Siang-Sore': 'Siang-Sore',
  'Malam': 'Malam'
};

const state = {
  pointsData: null,
  districtsData: null,
  metadata: null,
  filteredFeatures: [],
  map: null,
  pointLayer: null,
  districtLayer: null,
  periodChart: null,
  polarityChart: null,
  provinceBounds: null,
  filterPanelOpen: false
};

const mobileLayoutQuery = window.matchMedia('(max-width: 1020px)');

const elements = {
  loadingOverlay: document.getElementById('loadingOverlay'),
  periodLabel: document.getElementById('periodLabel'),
  totalStrikes: document.getElementById('totalStrikes'),
  dominantPeriod: document.getElementById('dominantPeriod'),
  dominantPeriodDetail: document.getElementById('dominantPeriodDetail'),
  topDistrict: document.getElementById('topDistrict'),
  topDistrictDetail: document.getElementById('topDistrictDetail'),
  averageCurrent: document.getElementById('averageCurrent'),
  startDate: document.getElementById('startDate'),
  endDate: document.getElementById('endDate'),
  districtFilter: document.getElementById('districtFilter'),
  districtSearch: document.getElementById('districtSearch'),
  districtOptions: document.getElementById('districtOptions'),
  districtSearchEmpty: document.getElementById('districtSearchEmpty'),
  districtAll: document.getElementById('districtAll'),
  districtSelectionSummary: document.getElementById('districtSelectionSummary'),
  resetButton: document.getElementById('resetButton'),
  fitButton: document.getElementById('fitButton'),
  togglePoints: document.getElementById('togglePoints'),
  toggleDistricts: document.getElementById('toggleDistricts'),
  districtTableBody: document.getElementById('districtTableBody'),
  tableStatus: document.getElementById('tableStatus'),
  filterPanel: document.getElementById('filterPanel'),
  filterToggleButton: document.getElementById('filterToggleButton'),
  bottomFilterButton: document.getElementById('bottomFilterButton'),
  applyFilterButton: document.getElementById('applyFilterButton')
};

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits }).format(value);
}

function formatDateID(value) {
  if (!value) return '–';

  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(new Date(`${value}T00:00:00`));
}

function escapeHTML(value) {
  return String(value ?? '–')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeDistrictName(value) {
  if (!value) return 'Tidak diketahui';

  return String(value)
    .replace(/^Kdy\.\s*/i, 'Kota ')
    .replace(/^Kodya\s*/i, 'Kota ')
    .trim();
}

async function fetchJSON(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Gagal membaca ${path}: HTTP ${response.status}`);
  }

  return response.json();
}

function initializeMap() {
  state.map = L.map('map', {
    zoomControl: true,
    preferCanvas: true
  }).setView([-7.65, 112.7], 7);

  const lightBase = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    {
      maxZoom: 20,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }
  ).addTo(state.map);

  const osmBase = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }
  );

  L.control.layers(
    {
      'Peta Terang': lightBase,
      'OpenStreetMap': osmBase
    },
    null,
    { collapsed: true }
  ).addTo(state.map);

  addMapLegends();
}

function addMapLegends() {
  const periodLegend = L.control({ position: 'bottomleft' });

  periodLegend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <strong>Periode Waktu</strong>
      ${PERIODS.map(period => `
        <div>
          <i style="background:${PERIOD_COLORS[period]};border-radius:50%;"></i>
          ${PERIOD_SHORT[period]}
        </div>
      `).join('')}
    `;
    return div;
  };

  periodLegend.addTo(state.map);

  const districtLegend = L.control({ position: 'bottomright' });

  districtLegend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <strong>Jumlah Sambaran</strong>
      <div><i style="background:#eef2ff"></i>0</div>
      <div><i style="background:#dbe7ff"></i>1–5</div>
      <div><i style="background:#a9c5ff"></i>6–10</div>
      <div><i style="background:#5e8ee7"></i>11–20</div>
      <div><i style="background:#1647b8"></i>&gt;20</div>
    `;
    return div;
  };

  districtLegend.addTo(state.map);
}

function setupFilterInputs() {
  const minDate = state.metadata.periode_mulai;
  const maxDate = state.metadata.periode_selesai;

  elements.startDate.min = minDate;
  elements.startDate.max = maxDate;
  elements.endDate.min = minDate;
  elements.endDate.max = maxDate;
  elements.startDate.value = minDate;
  elements.endDate.value = maxDate;

  elements.periodLabel.textContent =
    `${formatDateID(minDate)} – ${formatDateID(maxDate)} • ${formatNumber(state.metadata.jumlah_data)} data sambaran`;

  const districts = [...new Set(
    state.pointsData.features
      .map(feature => normalizeDistrictName(feature.properties.kabupaten))
      .filter(name => name !== 'Tidak diketahui')
  )].sort((a, b) => a.localeCompare(b, 'id'));

  elements.districtOptions.innerHTML = districts.map(district => `
    <label class="district-option">
      <input
        class="district-filter"
        type="checkbox"
        value="${escapeHTML(district)}"
      />
      <span>${escapeHTML(district)}</span>
    </label>
  `).join('');

  updateDistrictSelectionSummary();
}

function isMobileLayout() {
  return mobileLayoutQuery.matches;
}

function setFilterPanelOpen(isOpen) {
  if (!elements.filterPanel) return;

  if (!isMobileLayout()) {
    state.filterPanelOpen = true;
    elements.filterPanel.hidden = false;
    elements.filterToggleButton?.setAttribute('aria-expanded', 'true');
    return;
  }

  state.filterPanelOpen = Boolean(isOpen);
  elements.filterPanel.hidden = !state.filterPanelOpen;
  elements.filterToggleButton?.setAttribute(
    'aria-expanded',
    String(state.filterPanelOpen)
  );
}

function initializeFilterPanelLayout() {
  setFilterPanelOpen(!isMobileLayout());
}

function handleLayoutBreakpointChange(event) {
  setFilterPanelOpen(!event.matches);

  window.setTimeout(() => {
    state.map?.invalidateSize();
  }, 50);
}

function scrollToElement(element, offset = 12) {
  if (!element) return;

  const top = window.scrollY + element.getBoundingClientRect().top - offset;
  window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
}

function openFilterPanelAndScroll() {
  setFilterPanelOpen(true);

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      scrollToElement(elements.filterPanel);
    });
  });
}

function bindEvents() {
  const filterControls = [
    elements.startDate,
    elements.endDate,
    ...document.querySelectorAll('.period-filter'),
    ...document.querySelectorAll('.polarity-filter')
  ];

  filterControls.forEach(control => {
    control.addEventListener('change', applyFilters);
  });

  elements.districtSearch?.addEventListener('input', filterDistrictOptions);

  elements.districtFilter?.addEventListener('change', event => {
    const changedInput = event.target.closest('.district-filter');
    if (!changedInput) return;

    const districtInputs = [
      ...document.querySelectorAll('.district-filter:not([value="ALL"])')
    ];

    if (changedInput.value === 'ALL') {
      if (changedInput.checked) {
        districtInputs.forEach(input => {
          input.checked = false;
        });
      } else if (!districtInputs.some(input => input.checked)) {
        changedInput.checked = true;
      }
    } else {
      if (changedInput.checked) {
        elements.districtAll.checked = false;
      }

      if (!districtInputs.some(input => input.checked)) {
        elements.districtAll.checked = true;
      }
    }

    updateDistrictSelectionSummary();
    applyFilters();
    zoomToSelectedDistricts();
  });

  elements.resetButton.addEventListener('click', resetFilters);
  elements.filterToggleButton?.addEventListener('click', openFilterPanelAndScroll);
  elements.bottomFilterButton?.addEventListener('click', openFilterPanelAndScroll);

  elements.applyFilterButton?.addEventListener('click', () => {
    applyFilters();
    setFilterPanelOpen(false);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollToElement(document.querySelector('.map-card'));

        window.setTimeout(() => {
          state.map?.invalidateSize();
        }, 300);
      });
    });
  });

  if (typeof mobileLayoutQuery.addEventListener === 'function') {
    mobileLayoutQuery.addEventListener('change', handleLayoutBreakpointChange);
  } else {
    mobileLayoutQuery.addListener(handleLayoutBreakpointChange);
  }

  elements.fitButton.addEventListener('click', () => {
    if (state.provinceBounds) {
      state.map.fitBounds(state.provinceBounds, { padding: [20, 20] });
    }
  });

  elements.togglePoints.addEventListener('change', () => {
    if (!state.pointLayer) return;

    if (elements.togglePoints.checked) {
      state.pointLayer.addTo(state.map);
    } else {
      state.map.removeLayer(state.pointLayer);
    }
  });

  elements.toggleDistricts.addEventListener('change', () => {
    if (!state.districtLayer) return;

    if (elements.toggleDistricts.checked) {
      state.districtLayer.addTo(state.map);
      state.districtLayer.bringToBack();
    } else {
      state.map.removeLayer(state.districtLayer);
    }
  });

  document.querySelectorAll('.bottom-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.bottom-nav-item').forEach(navItem => {
        navItem.classList.remove('is-active');
      });
      item.classList.add('is-active');
    });
  });
}

function getSelectedValues(selector) {
  return [...document.querySelectorAll(selector)]
    .filter(input => input.checked)
    .map(input => input.value);
}

function getSelectedDistricts() {
  const selected = [
    ...document.querySelectorAll('.district-filter:checked')
  ].map(input => input.value);

  return selected.length ? selected : ['ALL'];
}

function updateDistrictSelectionSummary() {
  if (!elements.districtSelectionSummary) return;

  const selectedDistricts = getSelectedDistricts();

  if (selectedDistricts.includes('ALL')) {
    elements.districtSelectionSummary.textContent = 'Semua wilayah dipilih';
    return;
  }

  if (selectedDistricts.length === 1) {
    elements.districtSelectionSummary.textContent =
      `1 wilayah dipilih: ${selectedDistricts[0]}`;
    return;
  }

  elements.districtSelectionSummary.textContent =
    `${selectedDistricts.length} wilayah dipilih`;
}

function filterDistrictOptions() {
  if (!elements.districtSearch || !elements.districtOptions) return;

  const keyword = elements.districtSearch.value
    .trim()
    .toLocaleLowerCase('id-ID');

  const districtRows = [
    ...elements.districtOptions.querySelectorAll('.district-option')
  ];

  let visibleCount = 0;

  districtRows.forEach(row => {
    const districtName = row.textContent
      .trim()
      .toLocaleLowerCase('id-ID');

    const isMatch = keyword === '' || districtName.includes(keyword);
    row.hidden = !isMatch;

    if (isMatch) visibleCount += 1;
  });

  if (elements.districtSearchEmpty) {
    elements.districtSearchEmpty.hidden = visibleCount !== 0;
  }

  elements.districtOptions.scrollTop = 0;
}

function applyFilters() {
  let startDate = elements.startDate.value;
  let endDate = elements.endDate.value;

  /* Mencegah rentang terbalik tanpa menghentikan dashboard. */
  if (startDate && endDate && startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
    elements.startDate.value = startDate;
    elements.endDate.value = endDate;
  }

  const selectedDistricts = new Set(getSelectedDistricts());
  const periods = new Set(getSelectedValues('.period-filter'));
  const polarities = new Set(getSelectedValues('.polarity-filter'));

  state.filteredFeatures = state.pointsData.features.filter(feature => {
    const props = feature.properties;
    const featureDistrict = normalizeDistrictName(props.kabupaten);

    const dateOK =
      (!startDate || props.tanggal >= startDate) &&
      (!endDate || props.tanggal <= endDate);

    const districtOK =
      selectedDistricts.has('ALL') ||
      selectedDistricts.has(featureDistrict);

    const periodOK = periods.has(props.periode_waktu);
    const polarityOK = polarities.has(props.polaritas);

    return dateOK && districtOK && periodOK && polarityOK;
  });

  renderPointLayer();
  renderDistrictLayer();
  updateDashboard();
  updateCharts();
  updateDistrictTable();
}

function getPeriodColor(period) {
  return PERIOD_COLORS[period] || '#1647b8';
}

function pointPopupHTML(props) {
  const dateText = formatDateID(props.tanggal);
  const timeText = props.waktu_lengkap
    ? String(props.waktu_lengkap).split(' ').slice(-1)[0]
    : `${String(Math.round(Number(props.jam) || 0)).padStart(2, '0')}:00`;

  return `
    <div class="popup-title">Sambaran Petir Cloud-to-Ground</div>
    <dl class="popup-grid">
      <dt>Tanggal</dt><dd>${escapeHTML(dateText)}</dd>
      <dt>Waktu</dt><dd>${escapeHTML(timeText)} WIB</dd>
      <dt>Periode</dt><dd>${escapeHTML(PERIOD_SHORT[props.periode_waktu] || props.periode_waktu)}</dd>
      <dt>Kabupaten</dt><dd>${escapeHTML(normalizeDistrictName(props.kabupaten))}</dd>
      <dt>Kecamatan</dt><dd>${escapeHTML(props.kecamatan)}</dd>
      <dt>Desa/Kel.</dt><dd>${escapeHTML(props.desa_kelurahan)}</dd>
      <dt>Polaritas</dt><dd>${escapeHTML(props.polaritas)}</dd>
      <dt>Arus</dt><dd>${formatNumber(Number(props.arus_abs_ka) || 0, 2)} kA</dd>
    </dl>
  `;
}

function renderPointLayer() {
  if (state.pointLayer) {
    state.map.removeLayer(state.pointLayer);
  }

  const filteredCollection = {
    type: 'FeatureCollection',
    features: state.filteredFeatures
  };

  state.pointLayer = L.geoJSON(filteredCollection, {
    pointToLayer(feature, latlng) {
      return L.circleMarker(latlng, {
        radius: 5,
        weight: 1.2,
        color: '#ffffff',
        opacity: 0.92,
        fillColor: getPeriodColor(feature.properties.periode_waktu),
        fillOpacity: 0.82
      });
    },
    onEachFeature(feature, layer) {
      layer.bindPopup(pointPopupHTML(feature.properties), { maxWidth: 320 });

      layer.on('mouseover', function () {
        this.setStyle({ radius: 7, weight: 2 });
      });

      layer.on('mouseout', function () {
        this.setStyle({ radius: 5, weight: 1.2 });
      });
    }
  });

  if (elements.togglePoints.checked) {
    state.pointLayer.addTo(state.map);
  }
}

function aggregateFilteredByDistrict() {
  const result = new Map();

  for (const feature of state.filteredFeatures) {
    const props = feature.properties;
    const district = normalizeDistrictName(props.kabupaten);

    if (!result.has(district)) {
      result.set(district, {
        district,
        total: 0,
        'Dini Hari': 0,
        'Pagi': 0,
        'Siang-Sore': 0,
        'Malam': 0
      });
    }

    const row = result.get(district);
    row.total += 1;

    if (PERIODS.includes(props.periode_waktu)) {
      row[props.periode_waktu] += 1;
    }
  }

  return result;
}

function districtFillColor(count) {
  if (count > 20) return '#1647b8';
  if (count > 10) return '#5e8ee7';
  if (count > 5) return '#a9c5ff';
  if (count > 0) return '#dbe7ff';
  return '#eef2ff';
}

function renderDistrictLayer() {
  if (state.districtLayer) {
    state.map.removeLayer(state.districtLayer);
  }

  const aggregate = aggregateFilteredByDistrict();

  state.districtLayer = L.geoJSON(state.districtsData, {
    style(feature) {
      const district = normalizeDistrictName(feature.properties.kabupaten);
      const count = aggregate.get(district)?.total || 0;

      return {
        color: '#7386a7',
        weight: 0.85,
        opacity: 0.72,
        fillColor: districtFillColor(count),
        fillOpacity: 0.46
      };
    },
    onEachFeature(feature, layer) {
      const district = normalizeDistrictName(feature.properties.kabupaten);
      const row = aggregate.get(district) || {
        total: 0,
        'Dini Hari': 0,
        'Pagi': 0,
        'Siang-Sore': 0,
        'Malam': 0
      };

      layer.bindPopup(`
        <div class="popup-title">${escapeHTML(district)}</div>
        <dl class="popup-grid">
          <dt>Total filter</dt><dd>${formatNumber(row.total)} sambaran</dd>
          <dt>Dini Hari</dt><dd>${formatNumber(row['Dini Hari'])}</dd>
          <dt>Pagi</dt><dd>${formatNumber(row['Pagi'])}</dd>
          <dt>Siang-Sore</dt><dd>${formatNumber(row['Siang-Sore'])}</dd>
          <dt>Malam</dt><dd>${formatNumber(row['Malam'])}</dd>
          <dt>Luas</dt><dd>${formatNumber(Number(feature.properties.luas_km2) || 0, 2)} km²</dd>
        </dl>
      `);

      layer.on({
        mouseover(event) {
          event.target.setStyle({
            weight: 2,
            color: '#1647b8',
            fillOpacity: 0.62
          });
          event.target.bringToFront();
        },
        mouseout(event) {
          state.districtLayer.resetStyle(event.target);
        },
        click(event) {
          state.map.fitBounds(event.target.getBounds(), {
            padding: [25, 25],
            maxZoom: 10
          });
        }
      });
    }
  });

  state.provinceBounds = state.districtLayer.getBounds();

  if (elements.toggleDistricts.checked) {
    state.districtLayer.addTo(state.map);
    state.districtLayer.bringToBack();
  }
}

function updateDashboard() {
  const features = state.filteredFeatures;
  const total = features.length;

  elements.totalStrikes.textContent = formatNumber(total);

  const periodCounts = Object.fromEntries(PERIODS.map(period => [period, 0]));
  const districtCounts = new Map();
  let currentSum = 0;
  let currentCount = 0;

  for (const feature of features) {
    const props = feature.properties;

    if (periodCounts[props.periode_waktu] !== undefined) {
      periodCounts[props.periode_waktu] += 1;
    }

    const district = normalizeDistrictName(props.kabupaten);
    districtCounts.set(district, (districtCounts.get(district) || 0) + 1);

    const current = Number(props.arus_abs_ka);
    if (Number.isFinite(current)) {
      currentSum += current;
      currentCount += 1;
    }
  }

  const dominantPeriodEntry = Object.entries(periodCounts)
    .sort((a, b) => b[1] - a[1])[0];

  const topDistrictEntry = [...districtCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0];

  if (total > 0) {
    elements.dominantPeriod.textContent = PERIOD_SHORT[dominantPeriodEntry[0]];
    elements.dominantPeriodDetail.textContent =
      `${formatNumber(dominantPeriodEntry[1])} sambaran (${formatNumber((dominantPeriodEntry[1] / total) * 100, 1)}%)`;

    elements.topDistrict.textContent = topDistrictEntry[0];
    elements.topDistrictDetail.textContent =
      `${formatNumber(topDistrictEntry[1])} sambaran`;

    elements.averageCurrent.textContent =
      `${formatNumber(currentCount ? currentSum / currentCount : 0, 2)} kA`;
  } else {
    elements.dominantPeriod.textContent = 'Tidak ada data';
    elements.dominantPeriodDetail.textContent = 'Ubah filter untuk menampilkan data';
    elements.topDistrict.textContent = 'Tidak ada data';
    elements.topDistrictDetail.textContent = '–';
    elements.averageCurrent.textContent = '0 kA';
  }
}

const polarityCenterPlugin = {
  id: 'polarityCenterText',
  afterDatasetsDraw(chart) {
    if (chart.canvas.id !== 'polarityChart') return;

    const values = chart.data.datasets[0].data.map(Number);
    const total = values.reduce((sum, value) => sum + value, 0);
    const negativePercentage = total ? (values[0] / total) * 100 : 0;
    const { ctx, chartArea } = chart;

    if (!chartArea) return;

    const centerX = (chartArea.left + chartArea.right) / 2;
    const centerY = (chartArea.top + chartArea.bottom) / 2;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#20212a';
    ctx.font = '700 18px Inter, sans-serif';
    ctx.fillText(`${formatNumber(negativePercentage, 0)}%`, centerX, centerY - 5);
    ctx.fillStyle = '#777c8d';
    ctx.font = '700 9px Inter, sans-serif';
    ctx.fillText('NEGATIF', centerX, centerY + 14);
    ctx.restore();
  }
};

function buildCharts() {
  Chart.register(polarityCenterPlugin);

  const textColor = '#666b7b';
  const gridColor = 'rgba(96, 105, 126, 0.12)';

  Chart.defaults.font.family = 'Inter, sans-serif';
  Chart.defaults.color = textColor;

  state.periodChart = new Chart(document.getElementById('periodChart'), {
    type: 'bar',
    data: {
      labels: ['Dini Hari', 'Pagi', 'Siang-Sore', 'Malam'],
      datasets: [{
        label: 'Jumlah Sambaran',
        data: [0, 0, 0, 0],
        backgroundColor: PERIODS.map(period => PERIOD_COLORS[period]),
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 54
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          backgroundColor: '#20212a',
          titleFont: { weight: '600' },
          callbacks: {
            label(context) {
              return `${formatNumber(context.raw)} sambaran`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: textColor,
            font: { size: 10, weight: '600' }
          },
          grid: { display: false },
          border: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: textColor,
            precision: 0,
            font: { size: 10 }
          },
          grid: { color: gridColor },
          border: { display: false }
        }
      }
    }
  });

  state.polarityChart = new Chart(document.getElementById('polarityChart'), {
    type: 'doughnut',
    data: {
      labels: ['Negatif (-)', 'Positif (+)', 'Lainnya'],
      datasets: [{
        data: [0, 0, 0],
        backgroundColor: ['#1647b8', '#d8e2ff', '#a7adba'],
        borderColor: '#ffffff',
        borderWidth: 3,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: { duration: 500 },
      layout: { padding: 8 },
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: textColor,
            boxWidth: 9,
            boxHeight: 9,
            padding: 16,
            usePointStyle: true,
            pointStyle: 'circle',
            font: { size: 10, weight: '600' }
          }
        },
        tooltip: {
          backgroundColor: '#20212a',
          callbacks: {
            label(context) {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = total ? (context.raw / total) * 100 : 0;
              return `${context.label}: ${formatNumber(context.raw)} (${formatNumber(percentage, 1)}%)`;
            }
          }
        }
      }
    }
  });
}

function updateCharts() {
  const periodCounts = Object.fromEntries(PERIODS.map(period => [period, 0]));
  const polarityCounts = { '(-)': 0, '(+)': 0, other: 0 };

  for (const feature of state.filteredFeatures) {
    const props = feature.properties;

    if (periodCounts[props.periode_waktu] !== undefined) {
      periodCounts[props.periode_waktu] += 1;
    }

    if (props.polaritas === '(-)') {
      polarityCounts['(-)'] += 1;
    } else if (props.polaritas === '(+)') {
      polarityCounts['(+)'] += 1;
    } else {
      polarityCounts.other += 1;
    }
  }

  state.periodChart.data.datasets[0].data =
    PERIODS.map(period => periodCounts[period]);
  state.periodChart.update();

  state.polarityChart.data.datasets[0].data = [
    polarityCounts['(-)'],
    polarityCounts['(+)'],
    polarityCounts.other
  ];
  state.polarityChart.update();
}

function updateDistrictTable() {
  const rows = [...aggregateFilteredByDistrict().values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  elements.tableStatus.textContent = rows.length
    ? `Menampilkan ${rows.length} wilayah teratas • sesuai filter aktif`
    : 'Tidak ada data yang sesuai dengan filter';

  if (rows.length === 0) {
    elements.districtTableBody.innerHTML = `
      <tr>
        <td colspan="7">Tidak ada data yang sesuai dengan filter.</td>
      </tr>
    `;
    return;
  }

  elements.districtTableBody.innerHTML = rows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${escapeHTML(row.district)}</strong></td>
      <td>${formatNumber(row['Dini Hari'])}</td>
      <td>${formatNumber(row['Pagi'])}</td>
      <td>${formatNumber(row['Siang-Sore'])}</td>
      <td>${formatNumber(row['Malam'])}</td>
      <td><strong>${formatNumber(row.total)}</strong></td>
    </tr>
  `).join('');
}

function zoomToSelectedDistricts() {
  const selectedDistricts = getSelectedDistricts();

  if (selectedDistricts.includes('ALL')) {
    if (state.provinceBounds) {
      state.map.fitBounds(state.provinceBounds, { padding: [20, 20] });
    }
    return;
  }

  const selectedSet = new Set(selectedDistricts);
  const combinedBounds = L.latLngBounds([]);
  let singleSelectedLayer = null;

  state.districtLayer.eachLayer(layer => {
    const district = normalizeDistrictName(layer.feature.properties.kabupaten);
    if (!selectedSet.has(district)) return;

    combinedBounds.extend(layer.getBounds());

    if (selectedDistricts.length === 1) {
      singleSelectedLayer = layer;
    }
  });

  if (combinedBounds.isValid()) {
    state.map.fitBounds(combinedBounds, {
      padding: [30, 30],
      maxZoom: selectedDistricts.length === 1 ? 10 : 9
    });
  }

  if (singleSelectedLayer) {
    singleSelectedLayer.openPopup();
  }
}

function resetFilters() {
  elements.startDate.value = state.metadata.periode_mulai;
  elements.endDate.value = state.metadata.periode_selesai;

  document.querySelectorAll('.district-filter').forEach(input => {
    input.checked = input.value === 'ALL';
  });

  updateDistrictSelectionSummary();

  if (elements.districtSearch) {
    elements.districtSearch.value = '';
    filterDistrictOptions();
  }

  document.querySelectorAll('.period-filter, .polarity-filter').forEach(input => {
    input.checked = true;
  });

  elements.togglePoints.checked = true;
  elements.toggleDistricts.checked = true;

  applyFilters();

  if (state.provinceBounds) {
    state.map.fitBounds(state.provinceBounds, { padding: [20, 20] });
  }
}

async function initialize() {
  try {
    const [pointsData, districtsData, metadata] = await Promise.all([
      fetchJSON(DATA_PATHS.points),
      fetchJSON(DATA_PATHS.districts),
      fetchJSON(DATA_PATHS.metadata)
    ]);

    state.pointsData = pointsData;
    state.districtsData = districtsData;
    state.metadata = metadata;

    initializeMap();
    setupFilterInputs();
    buildCharts();
    bindEvents();
    initializeFilterPanelLayout();
    applyFilters();

    state.map.fitBounds(state.provinceBounds, { padding: [20, 20] });

    window.setTimeout(() => {
      state.map.invalidateSize();
      elements.loadingOverlay.classList.add('hidden');
    }, 250);
  } catch (error) {
    console.error(error);
    elements.loadingOverlay.innerHTML = `
      <div>
        <h2>Data gagal dimuat</h2>
        <p>${escapeHTML(error.message)}</p>
        <p>Jalankan project melalui local server, bukan dengan membuka index.html langsung.</p>
      </div>
    `;
  }
}

initialize();
