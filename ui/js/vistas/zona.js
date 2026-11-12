// Panel lateral con el detalle de una zona: lecturas, tendencia corta,
// mando manual, pruebas y eventos de la zona.

import { api } from '../api.js';
import { obtener } from '../store.js';
import { $, el, svg, avisar, VARIABLES, NOMBRES, UNIDADES, formatoVariable, hora } from '../util.js';

let zonaAbierta = null;
let disparador = null;
const PUNTOS_MINI = 60;

async function ejecutar(promesa, exito) {
  try {
    await promesa();
    if (exito) avisar(exito);
  } catch (error) {
    avisar(error.message, 'error');
  }
}

export function abrirPanelZona(id, origen) {
  zonaAbierta = id;
  disparador = origen || null;
  $('#velo').hidden = false;
  $('#panel-zona').hidden = false;
  $('#t-panel-zona').textContent = `Zona ${id}`;
  renderPanelZona(obtener());
  $('#btn-cerrar-panel').focus();
}

export function cerrarPanelZona() {
  if (zonaAbierta === null) return;
  zonaAbierta = null;
  $('#velo').hidden = true;
  $('#panel-zona').hidden = true;
  if (disparador && document.body.contains(disparador)) disparador.focus();
}

export const panelAbierto = () => zonaAbierta !== null;

function miniTendencia(variable, serie, rango) {
  const valores = serie.slice(-PUNTOS_MINI);
  const ancho = 300;
  const alto = 56;
  const amplitud = rango.max - rango.min;
  const desde = rango.min - amplitud * 0.5;
  const hasta = rango.max + amplitud * 0.5;
  const y = (v) => alto - ((Math.min(hasta, Math.max(desde, v)) - desde) / (hasta - desde)) * alto;
  const puntos = valores
    .map((v, i) => (Number.isFinite(v) ? `${((i / Math.max(1, valores.length - 1)) * ancho).toFixed(1)},${y(v).toFixed(1)}` : null))
    .filter(Boolean)
    .join(' ');
  return svg('svg', { clase: 'tendencia-mini', viewBox: `0 0 ${ancho} ${alto}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `Tendencia reciente de ${NOMBRES[variable].toLowerCase()}` },
    svg('rect', { x: 0, y: y(rango.max), width: ancho, height: Math.max(1, y(rango.min) - y(rango.max)) }),
    svg('polyline', { points: puntos }));
}

export function renderPanelZona(estado) {
  if (zonaAbierta === null || !estado.instantanea) return;
  const inst = estado.instantanea;
  const zona = inst.zonas.find((z) => z.id === zonaAbierta);
  const cuerpo = $('#panel-zona-cuerpo');
  if (!zona) {
    cuerpo.replaceChildren(el('p', { texto: 'Esta zona ya no existe en la configuración actual.' }));
    return;
  }
  const serie = estado.historial.zonas[zona.id] || {};

  const lecturas = el('dl', { clase: 'lecturas' }, VARIABLES.map((v) => el('div', { datos: { fuera: zona.motivos.includes(v) ? 'si' : 'no' } },
    el('dt', { texto: `${NOMBRES[v]} (${UNIDADES[v]})` }),
    el('dd', { texto: formatoVariable(v, zona[v]) }))));

  const tendencias = el('div', {}, VARIABLES.map((v) => el('div', {},
    el('p', { clase: 'campo', texto: `${NOMBRES[v]}: rango ${inst.config.rangos[v].min} a ${inst.config.rangos[v].max} ${UNIDADES[v]}` }),
    miniTendencia(v, serie[v] || [], inst.config.rangos[v]))));

  const emergencia = inst.emergencia.activa;
  const boton = (texto, accion, pulsado, deshabilitado) => el('button', {
    clase: 'boton',
    type: 'button',
    texto,
    'aria-pressed': pulsado ? 'true' : 'false',
    disabled: deshabilitado,
    onclick: accion,
  });
  const mando = el('div', { clase: 'botonera' },
    boton('Abrir', () => ejecutar(() => api.valvula(zona.id, 'abrir'), `Zona ${zona.id}: válvula abierta en mando manual.`), zona.override === 'abierta', emergencia),
    boton('Cerrar', () => ejecutar(() => api.valvula(zona.id, 'cerrar'), `Zona ${zona.id}: válvula cerrada en mando manual.`), zona.override === 'cerrada', false),
    boton('Automático', () => ejecutar(() => api.valvula(zona.id, 'auto'), `Zona ${zona.id}: control automático.`), !zona.override, false));

  const sinSimulacion = !inst.simulacion.activa;
  const pruebas = el('div', { clase: 'botonera' },
    boton('Inyectar anomalía', () => ejecutar(() => api.anomalia(zona.id), `Anomalía programada en la zona ${zona.id}.`), false, sinSimulacion || emergencia || zona.valvula !== 'abierta'),
    boton('Simular incendio', () => ejecutar(() => api.incendio(zona.id), `Incendio programado en la zona ${zona.id}.`), false, sinSimulacion || emergencia));

  const eventos = inst.eventos.filter((e) => e.zona === zona.id).slice(0, 6);
  const listaEventos = eventos.length
    ? el('ul', { clase: 'lista-eventos' }, eventos.map((e) => el('li', {}, el('time', { texto: hora(e.tsMs) }), e.mensaje)))
    : el('p', { clase: 'campo', texto: 'Sin eventos recientes en esta zona.' });

  const descripcion = zona.override
    ? `La válvula está ${zona.valvula} por orden del operador; el control automático no actúa en esta zona.`
    : emergencia
      ? 'La emergencia mantiene todas las válvulas cerradas hasta que se restablezca.'
      : `Control automático: se cierra ante una variable fuera de rango y se reabre tras ${inst.config.ticksReapertura} ciclos normales.`;

  // Conservar el foco del teclado entre actualizaciones.
  const enfocado = document.activeElement;
  const textoEnfocado = cuerpo.contains(enfocado) ? enfocado.textContent : null;
  cuerpo.replaceChildren(
    el('section', {}, el('h3', { texto: 'Lecturas' }), lecturas),
    el('section', {}, el('h3', { texto: 'Últimos ciclos' }), tendencias),
    el('section', {}, el('h3', { texto: `Válvula ${zona.valvula}` }), el('p', { clase: 'campo', texto: descripcion }), mando),
    el('section', {}, el('h3', { texto: 'Pruebas' }), pruebas),
    el('section', {}, el('h3', { texto: 'Eventos de la zona' }), listaEventos),
  );
  if (textoEnfocado) {
    const mismo = [...cuerpo.querySelectorAll('button')].find((b) => b.textContent === textoEnfocado);
    if (mismo) mismo.focus();
  }
}

export function iniciarPanelZona() {
  $('#btn-cerrar-panel').addEventListener('click', cerrarPanelZona);
  $('#velo').addEventListener('click', cerrarPanelZona);
  document.addEventListener('keydown', (evento) => {
    if (zonaAbierta === null) return;
    if (evento.key === 'Escape') {
      cerrarPanelZona();
      return;
    }
    // Mantener el foco dentro del panel mientras está abierto (diálogo modal).
    if (evento.key !== 'Tab') return;
    const enfocables = [...$('#panel-zona').querySelectorAll('button:not([disabled]), [href], input, select, [tabindex]:not([tabindex="-1"])')];
    if (!enfocables.length) return;
    const primero = enfocables[0];
    const ultimo = enfocables.at(-1);
    if (evento.shiftKey && document.activeElement === primero) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault();
      primero.focus();
    } else if (!$('#panel-zona').contains(document.activeElement)) {
      evento.preventDefault();
      primero.focus();
    }
  });
}
