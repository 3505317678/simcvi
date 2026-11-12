'use strict';

/**
 * SIMCVI · Núcleo de dominio (fachada pública).
 *
 * Node-RED carga este módulo en settings.js (functionGlobalContext) y los
 * nodos Function solo lo invocan; así la lógica no depende de Node-RED y se
 * prueba con `node --test`.
 *
 * Estado: un único objeto en memoria, creado con crearEstado() y guardado
 * por Node-RED en el contexto global.
 */

const { performance } = require('node:perf_hooks');
const config = require('./config');
const { crearAleatorio, generarLectura } = require('./simulacion');
const control = require('./control');
const { registrarEvento, eventosDesde } = require('./eventos');
const metricas = require('./metricas');
const lp = require('./line-protocol');
const { atenderSolicitud } = require('./api');

const VERSION = '1.0.0';
const MAX_HISTORIAL = 300;
const EVENTOS_EN_INSTANTANEA = 40;
const TOLERANCIA_CICLO_MS = 50;
const MUESTRA_LINEAS = 8;

function crearEstado(opciones = {}, ahoraMs = Date.now()) {
  const desdeEntorno = config.configDesdeEntorno(opciones.entorno || process.env);
  const base = opciones.config ? config.validarCambios(desdeEntorno.config, opciones.config) : { config: desdeEntorno.config, errores: [] };
  if (base.errores.length) throw new Error(`Configuración inicial inválida: ${base.errores.join(' ')}`);
  const estado = {
    version: VERSION,
    iniciadoMs: ahoraMs,
    config: base.config,
    simulacion: { activa: opciones.autoinicio ?? desdeEntorno.autoinicio, ultimoCicloMs: 0, ciclos: 0 },
    emergencia: { activa: false, zona: null, desdeMs: null },
    zonas: {},
    eventos: [],
    secuenciaEventos: 0,
    eventosPersistidosHasta: 0,
    historial: { t: [], zonas: {} },
    metricas: metricas.metricasVacias(ahoraMs),
    persistencia: {
      estado: 'sin_datos',
      lineasEnviadas: 0,
      lineasEscritas: 0,
      escriturasOk: 0,
      escriturasFallidas: 0,
      ultimaLatenciaMs: null,
      ultimoError: null,
      ultimaEscrituraMs: null,
    },
    salud: {},
    ultimasLineas: [],
    enlaces: { grafana: (opciones.entorno || process.env).GRAFANA_PUBLIC_URL || null },
    pendientes: { anomalias: {}, incendios: {} },
  };
  control.sincronizarZonas(estado);
  registrarEvento(estado, {
    tipo: 'sistema',
    severidad: 'info',
    origen: 'sistema',
    mensaje: `SIMCVI ${VERSION} iniciado con ${estado.config.zonas} zonas.`,
  }, ahoraMs);
  for (const error of desdeEntorno.errores) {
    registrarEvento(estado, { tipo: 'sistema', severidad: 'aviso', origen: 'sistema', mensaje: `Variable de entorno ignorada: ${error}` }, ahoraMs);
  }
  return estado;
}

function resumenPlanta(estado) {
  const zonas = control.listaZonas(estado);
  return {
    zonas: zonas.length,
    valvulasAbiertas: zonas.filter((z) => z.valvula === 'abierta').length,
    zonasAlerta: zonas.filter((z) => z.estado === 'alerta').length,
    emergencia: estado.emergencia.activa,
    modoAuto: estado.config.modoAuto,
    simulacionActiva: estado.simulacion.activa,
  };
}

function agregarHistorial(estado, ahoraMs) {
  const { historial } = estado;
  historial.t.push(ahoraMs);
  for (const zona of control.listaZonas(estado)) {
    if (!historial.zonas[zona.id]) historial.zonas[zona.id] = { presion: [], temperatura: [], caudal: [] };
  }
  for (const [id, serie] of Object.entries(historial.zonas)) {
    const zona = estado.zonas[id];
    for (const variable of config.VARIABLES) {
      serie[variable].push(zona && Number.isFinite(zona[variable]) ? metricas.redondear(zona[variable], 3) : null);
    }
  }
  if (historial.t.length > MAX_HISTORIAL) {
    historial.t.shift();
    for (const serie of Object.values(historial.zonas)) {
      for (const variable of config.VARIABLES) serie[variable].shift();
    }
  }
}

/**
 * Líneas de eventos aún no persistidos. Avanza el puntero de persistencia
 * porque cada lote se entrega una sola vez a Node-RED.
 */
function lineasEventosPendientes(estado) {
  const pendientes = eventosDesde(estado, estado.eventosPersistidosHasta);
  estado.eventosPersistidosHasta = estado.secuenciaEventos;
  return pendientes.map((evento, indice) => lp.lineaEvento(evento, indice + 1));
}

/**
 * Ciclo de simulación y control. Node-RED lo llama cada segundo; solo
 * ejecuta un ciclo cuando ha pasado el intervalo configurado.
 * @returns {null | { instantanea: object, lineas: string[] }}
 */
function ciclo(estado, ahoraMs = Date.now(), aleatorio = Math.random) {
  const sim = estado.simulacion;
  if (!sim.activa) return null;
  if (ahoraMs - sim.ultimoCicloMs < estado.config.intervaloSeg * 1000 - TOLERANCIA_CICLO_MS) return null;
  sim.ultimoCicloMs = ahoraMs;
  sim.ciclos += 1;

  const lineas = [];
  for (const zona of control.listaZonas(estado)) {
    const lectura = generarLectura(estado, zona, aleatorio);
    lectura.t0 = performance.now();
    control.procesarLectura(estado, zona, lectura, ahoraMs);
    lineas.push(lp.lineaTelemetria(zona, lectura, ahoraMs));
  }
  agregarHistorial(estado, ahoraMs);
  lineas.push(lp.lineaPlanta(resumenPlanta(estado), ahoraMs));
  lineas.push(...lp.lineasLimites(estado.config.rangos, ahoraMs));
  lineas.push(...lineasEventosPendientes(estado));
  estado.ultimasLineas = lineas.slice(0, MUESTRA_LINEAS);
  return { instantanea: instantanea(estado, ahoraMs), lineas };
}

function zonaPublica(zona) {
  const redondo = (valor) => (Number.isFinite(valor) ? metricas.redondear(valor, 3) : null);
  return {
    id: zona.id,
    presion: redondo(zona.presion),
    temperatura: redondo(zona.temperatura),
    caudal: redondo(zona.caudal),
    valvula: zona.valvula,
    estado: zona.estado,
    motivos: [...zona.motivos],
    incendio: zona.incendio,
    mando: zona.override ? 'manual' : 'auto',
    override: zona.override,
    ciclosNormales: zona.ciclosNormales,
    ultimaLecturaMs: zona.ultimaLecturaMs,
  };
}

/** Vista pública del estado (lo que reciben la API y el WebSocket). */
function instantanea(estado, ahoraMs = Date.now()) {
  return {
    tipo: 'instantanea',
    version: estado.version,
    tsMs: ahoraMs,
    iniciadoMs: estado.iniciadoMs,
    simulacion: { ...estado.simulacion, intervaloSeg: estado.config.intervaloSeg },
    emergencia: { ...estado.emergencia },
    config: config.copiar(estado.config),
    limites: config.LIMITES,
    unidades: config.UNIDADES,
    kpis: resumenPlanta(estado),
    zonas: control.listaZonas(estado).map(zonaPublica),
    eventos: estado.eventos.slice(0, EVENTOS_EN_INSTANTANEA),
    metricas: metricas.calcularIndicadores(estado.metricas, estado.persistencia),
    persistencia: { ...estado.persistencia },
    salud: JSON.parse(JSON.stringify(estado.salud)),
    ultimasLineas: [...estado.ultimasLineas],
    enlaces: { ...estado.enlaces },
  };
}

function historial(estado) {
  return JSON.parse(JSON.stringify(estado.historial));
}

/** Llamado por Node-RED antes de enviar un lote a InfluxDB. */
function registrarEnvio(estado, cantidadLineas) {
  estado.persistencia.lineasEnviadas += cantidadLineas;
}

/**
 * Llamado por Node-RED con el resultado de la escritura en InfluxDB.
 * Solo registra un evento cuando cambia el estado (ok ↔ error) para no
 * inundar el registro.
 */
function registrarEscritura(estado, resultado, ahoraMs = Date.now()) {
  const p = estado.persistencia;
  const anterior = p.estado;
  p.ultimaLatenciaMs = Number.isFinite(resultado.latenciaMs) ? metricas.redondear(resultado.latenciaMs, 1) : null;
  if (resultado.ok) {
    p.escriturasOk += 1;
    p.lineasEscritas += resultado.lineas || 0;
    p.ultimaEscrituraMs = ahoraMs;
    p.estado = 'ok';
    if (anterior === 'error') {
      registrarEvento(estado, { tipo: 'persistencia', severidad: 'info', origen: 'sistema', mensaje: 'Escritura en InfluxDB restablecida.' }, ahoraMs);
    }
  } else {
    p.escriturasFallidas += 1;
    p.ultimoError = String(resultado.error || 'Error desconocido').slice(0, 300);
    p.estado = 'error';
    if (anterior !== 'error') {
      registrarEvento(estado, {
        tipo: 'persistencia',
        severidad: 'aviso',
        origen: 'sistema',
        mensaje: `No se pudo escribir en InfluxDB: ${p.ultimoError}. El control sigue operando.`,
      }, ahoraMs);
    }
  }
}

const SERVICIOS = Object.freeze(['influxdb', 'grafana']);

function registrarSalud(estado, servicio, resultado, ahoraMs = Date.now()) {
  if (!SERVICIOS.includes(servicio)) return;
  estado.salud[servicio] = {
    ok: Boolean(resultado.ok),
    latenciaMs: Number.isFinite(resultado.latenciaMs) ? metricas.redondear(resultado.latenciaMs, 1) : null,
    detalle: String(resultado.detalle || '').slice(0, 200),
    tsMs: ahoraMs,
  };
}

module.exports = {
  VERSION,
  VARIABLES: config.VARIABLES,
  crearEstado,
  crearAleatorio,
  ciclo,
  instantanea,
  historial,
  atenderSolicitud: (estado, solicitud, ahoraMs = Date.now()) => atenderSolicitud(estado, solicitud, ahoraMs, {
    instantanea, historial, lineasEventosPendientes,
  }),
  lineasEventosPendientes,
  registrarEnvio,
  registrarEscritura,
  registrarSalud,
};
