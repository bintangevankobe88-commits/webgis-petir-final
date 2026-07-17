'use strict';

const DATA_PATHS = {
  points: 'data/petir.geojson',
  districts: 'data/kabupaten.geojson',
  metadata: 'data/metadata.json'
};

const PERIODS = ['Dini Hari', 'Pagi', 'Siang-Sore', 'Malam'];

const PERIOD_COLORS = {
  'Dini Hari': '#3b82f6',
  'Pagi': '#22c55e',
  'Siang-Sore': '#f59e0b',
  'Malam': '#a855f7'
};

const PERIOD_SHORT = {
  'Dini Hari': 'Dini Hari',
  'Pagi': 'Pagi',
  'Siang-Sore': 'Siang–Sore',
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
  provinceBounds: null
};

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
  resetButton: document.getElementById('resetButton'),
  fitButton: document.getElementById('fitButton'),
  togglePoints: document.getElementById('togglePoints'),
  toggleDistricts: document.getElementById('toggleDistricts'),
  districtTableBody: document.getElementById('districtTableBody')
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

  const darkBase = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      maxZoom: 20,
      subdomains: 'abcd',
      attribution:
        '&copy; OpenStreetMap contributors &copy; CARTO'
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
      'Dark Matter': darkBase,
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
        <div><i style="background:${PERIOD_COLORS[period]};border-radius:50%;"></i>${PERIOD_SHORT[period]}</div>
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
      <div><i style="background:#172f48"></i>0</div>
      <div><i style="background:#245274"></i>1–5</div>
      <div><i style="background:#287fa1"></i>6–10</div>
      <div><i style="background:#21b6c7"></i>11–20</div>
      <div><i style="background:#ffd166"></i>&gt;20</div>
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

  for (const district of districts) {
    const option = document.createElement('option');
    option.value = district;
    option.textContent = district;
    elements.districtFilter.appendChild(option);
  }
}

function bindEvents() {
  const filterControls = [
    elements.startDate,
    elements.endDate,
    elements.districtFilter,
    ...document.querySelectorAll('.period-filter'),
    ...document.querySelectorAll('.polarity-filter')
  ];

  filterControls.forEach(control => {
    control.addEventListener('change', applyFilters);
  });

  elements.resetButton.addEventListener('click', resetFilters);

  elements.fitButton.addEventListener('click', () => {
    if (state.provinceBounds) state.map.fitBounds(state.provinceBounds, { padding: [20, 20] });
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
    } else {
      state.map.removeLayer(state.districtLayer);
    }
  });

  elements.districtFilter.addEventListener('change', zoomToSelectedDistrict);
}

function getSelectedValues(selector) {
  return [...document.querySelectorAll(selector)]
    .filter(input => input.checked)
    .map(input => input.value);
}

function applyFilters() {
  const startDate = elements.startDate.value;
  const endDate = elements.endDate.value;
  const district = elements.districtFilter.value;
  const periods = new Set(getSelectedValues('.period-filter'));
  const polarities = new Set(getSelectedValues('.polarity-filter'));

  state.filteredFeatures = state.pointsData.features.filter(feature => {
    const props = feature.properties;
    const featureDistrict = normalizeDistrictName(props.kabupaten);

    const dateOK =
      (!startDate || props.tanggal >= startDate) &&
      (!endDate || props.tanggal <= endDate);

    const districtOK =
      district === 'ALL' || featureDistrict === district;

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
  return PERIOD_COLORS[period] || '#ffffff';
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
      const props = feature.properties;
      return L.circleMarker(latlng, {
        radius: 5.2,
        weight: 1,
        color: '#ffffff',
        opacity: 0.8,
        fillColor: getPeriodColor(props.periode_waktu),
        fillOpacity: 0.82
      });
    },
    onEachFeature(feature, layer) {
      layer.bindPopup(pointPopupHTML(feature.properties), {
        maxWidth: 320
      });

      layer.on('mouseover', function () {
        this.setStyle({ radius: 7, weight: 2 });
      });

      layer.on('mouseout', function () {
        this.setStyle({ radius: 5.2, weight: 1 });
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
  if (count > 20) return '#ffd166';
  if (count > 10) return '#21b6c7';
  if (count > 5) return '#287fa1';
  if (count > 0) return '#245274';
  return '#172f48';
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
        color: '#8bb0cb',
        weight: 0.8,
        opacity: 0.8,
        fillColor: districtFillColor(count),
        fillOpacity: 0.48
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
          <dt>Siang–Sore</dt><dd>${formatNumber(row['Siang-Sore'])}</dd>
          <dt>Malam</dt><dd>${formatNumber(row['Malam'])}</dd>
          <dt>Luas</dt><dd>${formatNumber(Number(feature.properties.luas_km2) || 0, 2)} km²</dd>
        </dl>
      `);

      layer.on({
        mouseover(event) {
          event.target.setStyle({
            weight: 2,
            color: '#ffffff',
            fillOpacity: 0.66
          });
          event.target.bringToFront();
        },
        mouseout(event) {
          state.districtLayer.resetStyle(event.target);
        },
        click(event) {
          state.map.fitBounds(event.target.getBounds(), { padding: [25, 25], maxZoom: 10 });
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

function buildCharts() {
  const textColor = '#cbd9e8';
  const gridColor = 'rgba(151, 181, 212, 0.12)';

  state.periodChart = new Chart(document.getElementById('periodChart'), {
    type: 'bar',
    data: {
      labels: ['Dini Hari', 'Pagi', 'Siang–Sore', 'Malam'],
      datasets: [{
        label: 'Jumlah Sambaran',
        data: [0, 0, 0, 0],
        backgroundColor: [
          PERIOD_COLORS['Dini Hari'],
          PERIOD_COLORS['Pagi'],
          PERIOD_COLORS['Siang-Sore'],
          PERIOD_COLORS['Malam']
        ],
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              return `${formatNumber(context.raw)} sambaran`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: textColor },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: textColor, precision: 0 },
          grid: { color: gridColor }
        }
      }
    }
  });

  state.polarityChart = new Chart(document.getElementById('polarityChart'), {
    type: 'doughnut',
    data: {
      labels: ['Negatif (−)', 'Positif (+)', 'Lainnya'],
      datasets: [{
        data: [0, 0, 0],
        backgroundColor: ['#20c7ff', '#ffc247', '#60758c'],
        borderColor: '#0a1828',
        borderWidth: 4,
        hoverOffset: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: textColor,
            padding: 18,
            usePointStyle: true
          }
        },
        tooltip: {
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

function zoomToSelectedDistrict() {
  const selected = elements.districtFilter.value;

  if (selected === 'ALL') {
    if (state.provinceBounds) {
      state.map.fitBounds(state.provinceBounds, { padding: [20, 20] });
    }
    return;
  }

  state.districtLayer.eachLayer(layer => {
    const district = normalizeDistrictName(layer.feature.properties.kabupaten);
    if (district === selected) {
      state.map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 10 });
      layer.openPopup();
    }
  });
}

function resetFilters() {
  elements.startDate.value = state.metadata.periode_mulai;
  elements.endDate.value = state.metadata.periode_selesai;
  elements.districtFilter.value = 'ALL';

  document.querySelectorAll('.period-filter, .polarity-filter')
    .forEach(input => { input.checked = true; });

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
        <p>Jalankan project melalui local server, bukan dengan membuka file index.html langsung.</p>
      </div>
    `;
  }
}

initialize();
