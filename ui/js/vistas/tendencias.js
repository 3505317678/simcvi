// Vista Tendencias: gráfica en vivo (Chart.js) de la variable elegida por
// zona, con la banda del rango normal y los puntos fuera de rango marcados.

import { $, $$, el, NOMBRES, UNIDADES, hora, formatoVariable, leerVariableCss } from '../util.js';

/* global Chart */

// Paletas categóricas apagadas (sin rojo, reservado para alarmas).
const PALETAS = {
  claro: ['#2f5f86', '#8a5a1e', '#3f7a46', '#6b4c8a', '#24797a', '#7a6a1c', '#4d5359', '#8a3f6b', '#3a6fb0', '#5f8a2a', '#9a5a2a', '#46468f'],
  oscuro: ['#8cc2ee', '#e3b36b', '#8fd197', '#c3a6e8', '#79d0d0', '#d8c96b', '#c2c8ce', '#e7a3c9', '#9fbff5', '#b7dc7f', '#efb385', '#a9a9ef'],
};

let grafica = null;
let variable = 'presion';
const ocultas = new Set();
let firmaZonas = '';

const temaActual = () => (document.documentElement.dataset.tema === 'oscuro' ? 'oscuro' : 'claro');

const bandaNormal = {
  id: 'bandaNormal',
  beforeDatasetsDraw(chart, _args, opciones) {
    const { ctx, chartArea, scales } = chart;
    if (!opciones.rango || !scales.y) return;
    const arriba = scales.y.getPixelForValue(opciones.rango.max);
    const abajo = scales.y.getPixelForValue(opciones.rango.min);
    ctx.save();
    ctx.fillStyle = opciones.color;
    ctx.fillRect(chartArea.left, Math.max(chartArea.top, arriba), chartArea.right - chartArea.left, Math.min(chartArea.bottom, abajo) - Math.max(chartArea.top, arriba));
    ctx.restore();
  },
};

function crearGrafica() {
  const tinta2 = leerVariableCss('--tinta-2');
  const borde = leerVariableCss('--borde');
  grafica = new Chart($('#grafica-tendencias'), {
    type: 'line',
    data: { datasets: [] },
    plugins: [bandaNormal],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        bandaNormal: { rango: null, color: leerVariableCss('--banda-normal') },
        tooltip: {
          callbacks: {
            title: (items) => (items.length ? hora(items[0].parsed.x) : ''),
            label: (item) => `${item.dataset.label}: ${formatoVariable(variable, item.parsed.y)} ${UNIDADES[variable]}`,
          },
        },
      },
      scales: {
        x: { type: 'linear', ticks: { color: tinta2, maxRotation: 0, autoSkipPadding: 24, callback: (v) => hora(v) }, grid: { color: borde } },
        y: { ticks: { color: tinta2 }, grid: { color: borde }, title: { display: true, color: tinta2 } },
      },
    },
  });
}

function renderFiltro(ids) {
  const firma = ids.join(',');
  if (firma === firmaZonas) return;
  firmaZonas = firma;
  const paleta = PALETAS[temaActual()];
  const contenedor = $('#filtro-zonas');
  contenedor.replaceChildren(el('legend', { texto: 'Zonas' }), ...ids.map((id, i) => {
    const casilla = el('input', { type: 'checkbox', value: id });
    casilla.checked = !ocultas.has(id);
    casilla.addEventListener('change', () => {
      if (casilla.checked) ocultas.delete(id);
      else ocultas.add(id);
    });
    const muestra = el('span', { clase: 'muestra' });
    muestra.style.background = paleta[i % paleta.length];
    return el('label', {}, casilla, muestra, `Zona ${id}`);
  }));
}

export function iniciarTendencias(obtenerEstado) {
  for (const opcion of $$('input[name="variable"]')) {
    opcion.addEventListener('change', () => {
      variable = opcion.value;
      renderTendencias(obtenerEstado(), true);
    });
  }
  $('#filtro-zonas').addEventListener('change', () => renderTendencias(obtenerEstado(), true));
}

/** Se vuelve a crear la gráfica al cambiar de tema para tomar los colores nuevos. */
export function reiniciarGrafica() {
  if (grafica) grafica.destroy();
  grafica = null;
  firmaZonas = '';
}

export function renderTendencias(estado) {
  const inst = estado.instantanea;
  if (!inst) return;
  if (!grafica) crearGrafica();
  const { historial } = estado;
  const ids = Object.keys(historial.zonas).map(Number).filter((id) => inst.zonas.some((z) => z.id === id)).sort((a, b) => a - b);
  renderFiltro(ids);

  const rango = inst.config.rangos[variable];
  const paleta = PALETAS[temaActual()];
  const alarma = leerVariableCss('--alarma');
  grafica.data.datasets = ids.filter((id) => !ocultas.has(id)).map((id) => {
    const color = paleta[ids.indexOf(id) % paleta.length];
    const datos = historial.t.map((t, i) => ({ x: t, y: historial.zonas[id][variable][i] })).filter((p) => Number.isFinite(p.y));
    const fuera = (contexto) => {
      const y = contexto.raw && contexto.raw.y;
      return Number.isFinite(y) && (y < rango.min || y > rango.max);
    };
    return {
      label: `Zona ${id}`,
      data: datos,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      tension: 0.25,
      pointRadius: (c) => (fuera(c) ? 3.5 : 0),
      pointBackgroundColor: (c) => (fuera(c) ? alarma : color),
      pointBorderWidth: 0,
    };
  });
  // El eje X se ajusta a los datos disponibles (sin márgenes vacíos).
  grafica.options.scales.x.min = historial.t[0];
  grafica.options.scales.x.max = historial.t.at(-1);
  grafica.options.plugins.bandaNormal.rango = rango;
  grafica.options.scales.y.title.text = `${NOMBRES[variable]} (${UNIDADES[variable]})`;
  grafica.update('none');
}
