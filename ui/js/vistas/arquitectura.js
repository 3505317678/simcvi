// Vista Arquitectura: diagrama vivo del recorrido de los datos y la última
// escritura en InfluxDB resaltada según el protocolo de línea.
// Los pulsos se disparan con mensajes reales, no con temporizadores.

import { $, el, svg, formatoMs, formatoNumero, hora } from '../util.js';

const DURACION_PULSO_MS = 900;
const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');

// Geometría del diagrama (unidades del viewBox).
const NODOS = {
  navegador: { x: 10, y: 165, an: 210, al: 130, titulo: 'Interfaz web', sub: 'Navegador del operador' },
  nodered: { x: 400, y: 150, an: 240, al: 140, titulo: 'Node-RED 5', sub: 'Simulación · control · API' },
  influxdb: { x: 750, y: 20, an: 220, al: 130, titulo: 'InfluxDB 2.9', sub: 'Series de tiempo · Flux' },
  grafana: { x: 750, y: 300, an: 220, al: 130, titulo: 'Grafana 13', sub: 'Tableros históricos' },
};

// ancla: start | middle | end (alineación horizontal de la etiqueta).
const ARISTAS = {
  ws: { d: 'M400 205 H220', texto: 'WebSocket /ws/simcvi', tx: 310, ty: 196, ancla: 'middle' },
  rest: { d: 'M220 255 H400', texto: 'REST /api', tx: 310, ty: 275, ancla: 'middle' },
  escritura: { d: 'M640 180 C 700 180, 700 85, 750 85', texto: 'HTTP /api/v2/write', tx: 688, ty: 110, ancla: 'end' },
  flux: { d: 'M860 300 V150', texto: 'consulta Flux', tx: 868, ty: 230, ancla: 'start' },
  salud: { d: 'M640 265 C 700 265, 700 365, 750 365', texto: 'chequeo de salud', tx: 688, ty: 352, ancla: 'end' },
  iframe: { d: 'M750 405 C 470 475, 190 450, 115 295', texto: 'tablero embebido en la interfaz', tx: 440, ty: 458, ancla: 'middle' },
};

const elementos = { nodos: {}, aristas: {}, capaPulsos: null, construido: false };
const vistos = { ws: 0, ciclo: 0, escritura: 0, salud: { influxdb: 0, grafana: 0 } };

function crearNodo(clave, def) {
  const datos = [0, 1, 2].map((i) => svg('text', { clase: 'nodo__dato', x: def.x + 16, y: def.y + 72 + i * 20 }));
  const estado = svg('text', { clase: 'nodo__dato nodo__estado', x: def.x + def.an - 16, y: def.y + 30, 'text-anchor': 'end' });
  const grupo = svg('g', { clase: 'nodo', datos: { nodo: clave } },
    svg('rect', { x: def.x, y: def.y, width: def.an, height: def.al, rx: 4 }),
    svg('text', { clase: 'nodo__titulo', x: def.x + 16, y: def.y + 30, texto: def.titulo }),
    svg('text', { clase: 'nodo__dato', x: def.x + 16, y: def.y + 50, texto: def.sub }),
    estado,
    ...datos);
  elementos.nodos[clave] = { grupo, datos, estado };
  return grupo;
}

function construir() {
  const marcador = svg('marker', { id: 'flecha', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
    svg('path', { d: 'M0 0 L10 5 L0 10 z', clase: 'arista__punta' }));
  const aristas = Object.entries(ARISTAS).map(([clave, def]) => {
    const camino = svg('path', { clase: 'arista', d: def.d, 'marker-end': 'url(#flecha)', datos: { arista: clave } });
    elementos.aristas[clave] = camino;
    return svg('g', {}, camino, svg('text', { clase: 'arista__texto', x: def.tx, y: def.ty, 'text-anchor': def.ancla, texto: def.texto }));
  });
  elementos.capaPulsos = svg('g', { 'aria-hidden': 'true' });
  const lienzo = svg('svg', {
    viewBox: '0 0 980 475',
    role: 'img',
    'aria-label': 'Flujo de datos: Node-RED envía instantáneas a la interfaz por WebSocket, recibe órdenes por REST, escribe en InfluxDB; Grafana consulta InfluxDB con Flux y se muestra embebido en la interfaz.',
  },
  svg('defs', {}, marcador),
  ...aristas,
  ...Object.entries(NODOS).map(([clave, def]) => crearNodo(clave, def)),
  elementos.capaPulsos);
  $('#diagrama').replaceChildren(lienzo);
  elementos.construido = true;
}

/** Desplaza un punto a lo largo de una arista. Sin animación si el usuario la redujo. */
function pulso(clave) {
  const camino = elementos.aristas[clave];
  if (!camino) return;
  if (reducirMovimiento.matches) {
    camino.dataset.activa = 'si';
    setTimeout(() => { camino.dataset.activa = 'no'; }, DURACION_PULSO_MS);
    return;
  }
  const largo = camino.getTotalLength();
  const punto = svg('circle', { clase: 'pulso', r: 6 });
  elementos.capaPulsos.append(punto);
  const inicio = performance.now();
  const paso = (ahora) => {
    const avance = Math.min(1, (ahora - inicio) / DURACION_PULSO_MS);
    const p = camino.getPointAtLength(largo * avance);
    punto.setAttribute('cx', p.x);
    punto.setAttribute('cy', p.y);
    if (avance < 1) requestAnimationFrame(paso);
    else punto.remove();
  };
  requestAnimationFrame(paso);
}

function textos(clave, lineas, estadoTexto, error) {
  const nodo = elementos.nodos[clave];
  nodo.grupo.dataset.estado = error ? 'error' : 'ok';
  nodo.estado.textContent = estadoTexto;
  nodo.datos.forEach((t, i) => { t.textContent = lineas[i] || ''; });
}

function renderNodos(estado) {
  const inst = estado.instantanea;
  const p = inst.persistencia;
  const saludInflux = inst.salud.influxdb;
  const saludGrafana = inst.salud.grafana;

  textos('navegador', [
    `${estado.mensajes.toLocaleString('es-CO')} instantáneas recibidas`,
    `Retardo medio: ${estado.latenciaMs === null ? '–' : formatoMs(estado.latenciaMs)}`,
    `Último ciclo: ${hora(inst.simulacion.ultimoCicloMs || NaN)}`,
  ], estado.conexion === 'ok' ? 'conectada' : 'sin conexión', estado.conexion !== 'ok');

  textos('nodered', [
    `Ciclo ${inst.simulacion.ciclos.toLocaleString('es-CO')} · cada ${inst.simulacion.intervaloSeg} s`,
    `${inst.kpis.zonas} zonas · control ${inst.config.modoAuto ? 'automático' : 'manual'}`,
    inst.simulacion.activa ? 'Simulación en marcha' : 'Simulación detenida',
  ], inst.emergencia.activa ? 'emergencia' : 'en línea', inst.emergencia.activa);

  const influxError = p.estado === 'error' || (saludInflux && !saludInflux.ok);
  textos('influxdb', [
    `${p.lineasEscritas.toLocaleString('es-CO')} de ${p.lineasEnviadas.toLocaleString('es-CO')} líneas escritas`,
    `Escritura: ${formatoMs(p.ultimaLatenciaMs)} · fallidas: ${p.escriturasFallidas}`,
    p.estado === 'error' ? `Error: ${(p.ultimoError || '').slice(0, 34)}` : `Integridad: ${inst.metricas.integridadPct === null ? '–' : `${formatoNumero(inst.metricas.integridadPct, 2)} %`}`,
  ], influxError ? 'sin conexión' : p.estado === 'ok' ? 'escribiendo' : 'sin datos', influxError);

  const grafanaError = saludGrafana ? !saludGrafana.ok : false;
  textos('grafana', [
    saludGrafana ? `Salud: ${saludGrafana.ok ? 'correcta' : 'sin respuesta'}` : 'Salud: sin datos',
    `Respuesta: ${saludGrafana ? formatoMs(saludGrafana.latenciaMs) : '–'}`,
    'Fuente de datos: InfluxDB (Flux)',
  ], grafanaError ? 'sin conexión' : saludGrafana ? 'en línea' : 'sin datos', grafanaError);
}

function disparoPulsos(estado, visible) {
  const inst = estado.instantanea;
  const nuevos = {
    ws: estado.pulsos.ws !== vistos.ws,
    escritura: (inst.persistencia.ultimaEscrituraMs || 0) !== vistos.escritura,
    saludInflux: (inst.salud.influxdb?.tsMs || 0) !== vistos.salud.influxdb,
    saludGrafana: (inst.salud.grafana?.tsMs || 0) !== vistos.salud.grafana,
  };
  vistos.ws = estado.pulsos.ws;
  vistos.escritura = inst.persistencia.ultimaEscrituraMs || 0;
  vistos.salud.influxdb = inst.salud.influxdb?.tsMs || 0;
  vistos.salud.grafana = inst.salud.grafana?.tsMs || 0;
  if (!visible || document.hidden) return;
  if (nuevos.ws) pulso('ws');
  if (nuevos.escritura) pulso('escritura');
  if (nuevos.saludGrafana) pulso('salud');
}

/** Pulso para las órdenes que la interfaz envía (se llama desde main.js). */
export function pulsoOrden() {
  if (elementos.construido && $('#diagrama').offsetParent !== null) pulso('rest');
}

/* ------------------------------------------------ protocolo de línea */

/**
 * Divide una línea en medición, etiquetas, campos y marca de tiempo
 * respetando los escapes (\ , = espacio) y las comillas de los campos de texto.
 */
export function partesLinea(linea) {
  const espacios = [];
  let escape = false;
  let comillas = false;
  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"' && espacios.length === 1) { comillas = !comillas; continue; }
    if (c === ' ' && !comillas) espacios.push(i);
  }
  if (espacios.length < 2) return null;
  const cabeza = linea.slice(0, espacios[0]);
  const campos = linea.slice(espacios[0] + 1, espacios.at(-1));
  const tiempo = linea.slice(espacios.at(-1) + 1);
  let corte = -1;
  escape = false;
  for (let i = 0; i < cabeza.length; i += 1) {
    if (escape) { escape = false; continue; }
    if (cabeza[i] === '\\') { escape = true; continue; }
    if (cabeza[i] === ',') { corte = i; break; }
  }
  return {
    medicion: corte === -1 ? cabeza : cabeza.slice(0, corte),
    etiquetas: corte === -1 ? '' : cabeza.slice(corte),
    campos,
    tiempo,
  };
}

let firmaLineas = '';
function renderLineas(lineas) {
  const firma = lineas.join('\n');
  if (firma === firmaLineas) return;
  firmaLineas = firma;
  const destino = $('#lineas');
  if (!lineas.length) {
    destino.textContent = 'Aún no hay escrituras. Inicie la simulación en la vista Planta.';
    return;
  }
  const filas = lineas.map((linea) => {
    const p = partesLinea(linea);
    if (!p) return el('span', { texto: linea });
    return el('span', {},
      el('span', { clase: 'lp-medicion', texto: p.medicion }),
      el('span', { clase: 'lp-etiqueta', texto: p.etiquetas }),
      ' ',
      el('span', { clase: 'lp-campo', texto: p.campos }),
      ' ',
      el('span', { clase: 'lp-tiempo', texto: p.tiempo }));
  });
  destino.replaceChildren(...filas.flatMap((fila, i) => (i ? ['\n', fila] : [fila])));
}

function renderFlux() {
  const destino = $('#flux');
  if (destino.childElementCount || destino.textContent) return;
  destino.textContent = [
    'from(bucket: v.defaultBucket)',
    '  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)',
    '  |> filter(fn: (r) => r._measurement == "telemetria" and r._field == "presion")',
    '  |> group(columns: ["zona"])',
    '  |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)',
  ].join('\n');
}

export function renderArquitectura(estado, visible) {
  if (!estado.instantanea) return;
  if (!elementos.construido) construir();
  renderNodos(estado);
  disparoPulsos(estado, visible);
  renderLineas(estado.instantanea.ultimasLineas);
  renderFlux();
}
