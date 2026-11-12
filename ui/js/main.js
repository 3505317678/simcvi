// Punto de entrada: tema, reloj, navegación por hash, conexión en tiempo real
// y distribución del estado a las vistas.

import { api, ConexionTiempoReal } from './api.js';
import { obtener, suscribir, cambiarConexion, cargarHistorial, recibirInstantanea } from './store.js';
import { $, $$, el, avisar, hora } from './util.js';
import { iniciarPlanta, renderPlanta } from './vistas/planta.js';
import { iniciarPanelZona, renderPanelZona } from './vistas/zona.js';
import { iniciarTendencias, reiniciarGrafica, renderTendencias } from './vistas/tendencias.js';
import { iniciarEventos, renderEventos } from './vistas/eventos.js';
import { iniciarPruebas, renderPruebas } from './vistas/pruebas.js';
import { renderArquitectura, pulsoOrden } from './vistas/arquitectura.js';
import { renderGrafana, reiniciarGrafana } from './vistas/grafana.js';
import { iniciarAjustes, renderAjustes } from './vistas/ajustes.js';

const VISTAS = ['planta', 'tendencias', 'eventos', 'pruebas', 'arquitectura', 'grafana', 'ajustes'];
const CLAVE_TEMA = 'simcvi-tema';
const ESPERA_CONFIRMACION_MS = 5000;

let vistaActual = 'planta';

/* ------------------------------------------------------------ tema */

function leerTemaGuardado() {
  try {
    return localStorage.getItem(CLAVE_TEMA);
  } catch {
    return null;
  }
}

function aplicarTema(tema, guardar) {
  document.documentElement.dataset.tema = tema;
  if (guardar) {
    try { localStorage.setItem(CLAVE_TEMA, tema); } catch { /* almacenamiento no disponible */ }
  }
}

function iniciarTema() {
  const preferido = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  aplicarTema(leerTemaGuardado() || preferido, false);
  $('#btn-tema').addEventListener('click', () => {
    aplicarTema(document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro', true);
    reiniciarGrafica();
    reiniciarGrafana();
    renderizar(obtener());
  });
}

/* ------------------------------------------------------------ navegación */

function vistaDesdeHash() {
  const nombre = location.hash.replace('#', '');
  return VISTAS.includes(nombre) ? nombre : 'planta';
}

function mostrarVista(nombre, moverFoco) {
  vistaActual = nombre;
  for (const seccion of $$('[data-vista]')) seccion.hidden = seccion.dataset.vista !== nombre;
  for (const enlace of $$('[data-vista-enlace]')) {
    if (enlace.dataset.vistaEnlace === nombre) enlace.setAttribute('aria-current', 'page');
    else enlace.removeAttribute('aria-current');
  }
  const titulo = $(`[data-vista="${nombre}"] .vista__titulo`);
  document.title = `SIMCVI · ${titulo ? titulo.textContent : 'Sala de control'}`;
  if (moverFoco) $('#contenido').focus({ preventScroll: true });
  renderizar(obtener());
}

/* ------------------------------------------------------------ cabecera */

function servicio(id, estado, texto) {
  const nodo = $(id);
  nodo.dataset.estado = estado;
  nodo.querySelector('.servicios__texto').textContent = texto;
}

function renderServicios(estado) {
  const conexion = { ok: ['ok', 'en línea'], conectando: ['desconocido', 'conectando'], error: ['error', 'sin conexión'] }[estado.conexion];
  servicio('#srv-nodered', ...conexion);
  document.body.dataset.conexion = estado.conexion;

  const inst = estado.instantanea;
  if (!inst || estado.conexion !== 'ok') {
    servicio('#srv-influxdb', 'desconocido', 'sin datos');
    servicio('#srv-grafana', 'desconocido', 'sin datos');
    return;
  }
  const { influxdb, grafana } = inst.salud;
  const escritura = inst.persistencia.estado;
  if (escritura === 'error' || (influxdb && !influxdb.ok)) servicio('#srv-influxdb', 'error', 'sin conexión');
  else if (escritura === 'ok' || (influxdb && influxdb.ok)) servicio('#srv-influxdb', 'ok', escritura === 'ok' ? 'escribiendo' : 'en línea');
  else servicio('#srv-influxdb', 'desconocido', 'sin datos');

  if (!grafana) servicio('#srv-grafana', 'desconocido', 'sin datos');
  else servicio('#srv-grafana', grafana.ok ? 'ok' : 'error', grafana.ok ? 'en línea' : 'sin conexión');
}

/* ------------------------------------------------------------ franja de alarma */

const franja = { texto: null, boton: null, confirmando: null, firma: '' };

function construirFranja() {
  franja.texto = el('span', { clase: 'franja__texto' });
  franja.boton = el('button', { clase: 'boton', type: 'button' });
  franja.boton.addEventListener('click', alPulsarFranja);
  $('#franja-alarma').replaceChildren(franja.texto, franja.boton);
}

function cancelarConfirmacion() {
  clearTimeout(franja.confirmando);
  franja.confirmando = null;
}

async function alPulsarFranja() {
  const nivel = $('#franja-alarma').dataset.nivel;
  if (nivel === 'alerta') {
    location.hash = '#planta';
    return;
  }
  if (nivel !== 'emergencia') return;
  // Dos pasos: el primer clic arma la orden; el segundo la confirma.
  if (!franja.confirmando) {
    franja.confirmando = setTimeout(() => {
      franja.confirmando = null;
      franja.firma = '';
      renderFranja(obtener());
    }, ESPERA_CONFIRMACION_MS);
    franja.firma = '';
    renderFranja(obtener());
    return;
  }
  cancelarConfirmacion();
  try {
    await api.restablecerEmergencia();
    avisar('Emergencia restablecida. Las válvulas vuelven al control automático.');
  } catch (error) {
    avisar(error.message, 'error');
  }
}

function renderFranja(estado) {
  const caja = $('#franja-alarma');
  const inst = estado.instantanea;
  let nivel = '';
  let texto = '';
  let boton = '';
  if (estado.conexion === 'error') {
    nivel = 'conexion';
    texto = 'Sin conexión con Node-RED. Los valores en pantalla pueden estar desactualizados; reintentando…';
  } else if (inst && inst.emergencia.activa) {
    nivel = 'emergencia';
    texto = `Emergencia: incendio en la zona ${inst.emergencia.zona}. Todas las válvulas están cerradas desde las ${hora(inst.emergencia.desdeMs)}.`;
    boton = franja.confirmando ? 'Confirmar restablecimiento' : 'Restablecer emergencia';
  } else if (inst && inst.kpis.zonasAlerta > 0) {
    nivel = 'alerta';
    const zonas = inst.zonas.filter((z) => z.estado === 'alerta').map((z) => z.id);
    texto = zonas.length === 1 ? `Alarma en la zona ${zonas[0]}.` : `Alarmas en las zonas ${zonas.join(', ')}.`;
    boton = vistaActual === 'planta' ? '' : 'Ver planta';
  }
  if (nivel !== 'emergencia') cancelarConfirmacion();

  const firma = `${nivel}|${texto}|${boton}`;
  if (firma === franja.firma) return;
  franja.firma = firma;
  caja.hidden = !nivel;
  if (!nivel) return;
  caja.dataset.nivel = nivel;
  // Solo se anuncia como alerta lo que exige acción del operador.
  caja.setAttribute('role', nivel === 'conexion' ? 'status' : 'alert');
  franja.texto.textContent = texto;
  franja.boton.hidden = !boton;
  franja.boton.textContent = boton;
  franja.boton.className = nivel === 'emergencia' ? 'boton boton--peligro' : 'boton';
}

/* ------------------------------------------------------------ render */

function renderizar(estado) {
  renderServicios(estado);
  renderFranja(estado);
  if (!estado.instantanea) return;
  renderPlanta(estado);
  renderPanelZona(estado);
  renderEventos(estado);
  renderPruebas(estado);
  renderAjustes(estado);
  // Las vistas costosas solo se dibujan cuando están visibles.
  if (vistaActual === 'tendencias') renderTendencias(estado);
  renderArquitectura(estado, vistaActual === 'arquitectura');
  renderGrafana(estado, vistaActual === 'grafana');
}

/* ------------------------------------------------------------ arranque */

async function cargaInicial() {
  try {
    const [estado, historial] = await Promise.all([api.estado(), api.historial()]);
    cargarHistorial(historial.historial);
    recibirInstantanea(estado.instantanea);
  } catch (error) {
    avisar(error.message, 'error');
  }
}

function iniciarReloj() {
  const reloj = $('#reloj');
  const tic = () => {
    const ahora = new Date();
    reloj.textContent = hora(ahora.getTime());
    reloj.dateTime = ahora.toISOString();
  };
  tic();
  setInterval(tic, 1000);
}

function iniciar() {
  iniciarTema();
  iniciarReloj();
  construirFranja();
  iniciarPlanta(obtener);
  iniciarPanelZona();
  iniciarTendencias(obtener);
  iniciarEventos(obtener);
  iniciarPruebas(obtener);
  iniciarAjustes(obtener);

  // Cada orden enviada a la API se ve como un pulso REST en el diagrama.
  window.addEventListener('simcvi:orden', pulsoOrden);

  suscribir(renderizar);
  window.addEventListener('hashchange', () => mostrarVista(vistaDesdeHash(), true));
  mostrarVista(vistaDesdeHash(), false);

  new ConexionTiempoReal({ alRecibir: recibirInstantanea, alCambiarEstado: cambiarConexion }).conectar();
  cargaInicial();
}

iniciar();
