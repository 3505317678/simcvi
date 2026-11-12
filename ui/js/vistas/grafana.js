// Vista Grafana: tablero histórico embebido (solo lectura, acceso anónimo
// con rol Viewer). El iframe se crea solo al abrir la vista.

import { $, el } from '../util.js';

const UID_TABLERO = 'simcvi-planta';
let urlCargada = '';

function urlTablero(base, tema) {
  const url = new URL(`/d/${UID_TABLERO}/simcvi`, base);
  url.search = new URLSearchParams({ orgId: '1', from: 'now-15m', to: 'now', refresh: '5s', theme: tema === 'oscuro' ? 'dark' : 'light' }).toString();
  // kiosk oculta el menú y la barra de navegación de Grafana.
  return `${url.toString()}&kiosk`;
}

function estadoVacio(titulo, pasos) {
  return el('div', { clase: 'vacio' },
    el('h2', { clase: 'subtitulo', texto: titulo }),
    el('ol', { clase: 'pasos' }, pasos.map((paso) => el('li', {}, paso))));
}

export function renderGrafana(estado, visible) {
  const inst = estado.instantanea;
  if (!inst || !visible) return;
  const base = inst.enlaces.grafana;
  const marco = $('#grafana-marco');
  const enlace = $('#enlace-grafana');

  if (!base) {
    enlace.hidden = true;
    urlCargada = '';
    marco.replaceChildren(estadoVacio('Grafana no está configurado', [
      'Defina GRAFANA_PUBLIC_URL en el archivo .env (por ejemplo, http://localhost:3000).',
      ['Reinicie Node-RED con ', el('code', { texto: 'docker compose up -d node-red' }), '.'],
    ]));
    return;
  }

  const tema = document.documentElement.dataset.tema;
  const url = urlTablero(base, tema);
  enlace.hidden = false;
  enlace.href = url.replace('&kiosk', '');

  const salud = inst.salud.grafana;
  if (salud && !salud.ok) {
    urlCargada = '';
    marco.replaceChildren(estadoVacio('Grafana no responde', [
      ['Compruebe que el contenedor está en ejecución: ', el('code', { texto: 'docker compose ps grafana' }), '.'],
      ['Revise el registro: ', el('code', { texto: 'docker compose logs --tail 50 grafana' }), '.'],
      'Cuando Grafana responda, el tablero aparecerá aquí automáticamente.',
    ]));
    return;
  }

  if (url === urlCargada) return;
  urlCargada = url;
  marco.replaceChildren(el('iframe', {
    src: url,
    title: 'Tablero histórico de SIMCVI en Grafana',
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
  }));
}

/** Al cambiar de tema se vuelve a cargar el tablero con el tema nuevo. */
export function reiniciarGrafana() {
  urlCargada = '';
}
