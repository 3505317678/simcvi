'use strict';

/**
 * Enrutador de la API HTTP de SIMCVI, independiente de Node-RED.
 *
 * Node-RED entrega { metodo, ruta, cuerpo } y devuelve la respuesta con el
 * código HTTP indicado. Cada entrada se valida contra listas blancas.
 *
 * Respuestas: { ok: true, ... } o { ok: false, error: { codigo, mensaje } }.
 */

const config = require('./config');
const control = require('./control');
const { registrarEvento } = require('./eventos');
const metricas = require('./metricas');

const ACCIONES_VALVULA = Object.freeze(['abrir', 'cerrar', 'auto']);
const DIRECCIONES = Object.freeze(['alta', 'baja']);

function exito(estado, cuerpo, opciones = {}) {
  return { estado, cuerpo: { ok: true, ...cuerpo }, difundir: Boolean(opciones.difundir), persistir: Boolean(opciones.persistir) };
}

function fallo(estado, mensaje) {
  return { estado, cuerpo: { ok: false, error: { codigo: estado, mensaje } }, difundir: false, persistir: false };
}

function segmentos(ruta) {
  return String(ruta || '')
    .split('?')[0]
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
    .map((parte) => decodeURIComponent(parte));
}

function resolverZona(estado, texto) {
  if (!/^\d{1,2}$/.test(texto)) return null;
  return estado.zonas[Number(texto)] || null;
}

function cuerpoObjeto(cuerpo) {
  if (cuerpo === undefined || cuerpo === null || cuerpo === '') return {};
  if (typeof cuerpo === 'object' && !Array.isArray(cuerpo)) return cuerpo;
  return null;
}

function cambiarSimulacion(estado, accion, ahoraMs) {
  if (accion !== 'iniciar' && accion !== 'detener') return fallo(404, 'Acción de simulación desconocida. Use iniciar o detener.');
  const activa = accion === 'iniciar';
  if (estado.simulacion.activa !== activa) {
    estado.simulacion.activa = activa;
    if (activa) estado.simulacion.ultimoCicloMs = 0;
    registrarEvento(estado, {
      tipo: 'simulacion',
      severidad: 'info',
      origen: 'operador',
      mensaje: activa ? 'Simulación iniciada por el operador.' : 'Simulación detenida por el operador.',
    }, ahoraMs);
  }
  return exito(200, { simulacion: { ...estado.simulacion } }, { difundir: true, persistir: true });
}

function actualizarConfiguracion(estado, cuerpo, ahoraMs) {
  const cambios = cuerpoObjeto(cuerpo);
  if (!cambios) return fallo(400, 'El cuerpo debe ser un objeto JSON.');
  const { config: nueva, errores } = config.validarCambios(estado.config, cambios);
  if (errores.length) return { ...fallo(422, 'La configuración no es válida.'), cuerpo: { ok: false, error: { codigo: 422, mensaje: 'La configuración no es válida.', detalles: errores } } };
  const claves = Object.keys(cambios);
  estado.config = nueva;
  control.sincronizarZonas(estado);
  registrarEvento(estado, {
    tipo: 'configuracion',
    severidad: 'info',
    origen: 'operador',
    mensaje: `Configuración actualizada: ${claves.join(', ') || 'sin cambios'}.`,
  }, ahoraMs);
  return exito(200, { config: config.copiar(nueva) }, { difundir: true, persistir: true });
}

function ordenarValvulas(estado, textoZona, accion, ahoraMs) {
  if (!ACCIONES_VALVULA.includes(accion)) return fallo(400, `Acción no válida. Use: ${ACCIONES_VALVULA.join(', ')}.`);
  const zonas = textoZona === 'todas' ? control.listaZonas(estado) : [resolverZona(estado, textoZona)];
  if (zonas.some((zona) => !zona)) return fallo(404, `La zona ${textoZona} no existe.`);
  const resultados = zonas.map((zona) => control.ordenValvula(estado, zona, accion, ahoraMs));
  const rechazo = resultados.find((r) => !r.ok);
  if (rechazo) return { ...fallo(rechazo.codigo, rechazo.mensaje), difundir: true, persistir: true };
  return exito(200, { mensaje: resultados.map((r) => r.mensaje).join(' ') }, { difundir: true, persistir: true });
}

function inyectarPrueba(estado, tipo, textoZona, cuerpo, ahoraMs) {
  const zona = resolverZona(estado, textoZona);
  if (!zona) return fallo(404, `La zona ${textoZona} no existe.`);
  if (!estado.simulacion.activa) return fallo(409, 'Inicie la simulación antes de inyectar una prueba.');
  if (estado.emergencia.activa) return fallo(409, 'Hay una emergencia activa. Restablézcala antes de inyectar otra prueba.');

  if (tipo === 'incendio') {
    estado.pendientes.incendios[zona.id] = true;
    registrarEvento(estado, { tipo: 'prueba', severidad: 'info', origen: 'operador', zona: zona.id, mensaje: `Prueba: incendio programado en la zona ${zona.id} para el próximo ciclo.` }, ahoraMs);
    return exito(202, { mensaje: 'Incendio programado para el próximo ciclo.' }, { difundir: true, persistir: true });
  }

  if (tipo === 'anomalia') {
    const datos = cuerpoObjeto(cuerpo);
    if (!datos) return fallo(400, 'El cuerpo debe ser un objeto JSON.');
    if (datos.variable !== undefined && !config.VARIABLES.includes(datos.variable)) return fallo(400, `Variable no válida. Use: ${config.VARIABLES.join(', ')}.`);
    if (datos.direccion !== undefined && !DIRECCIONES.includes(datos.direccion)) return fallo(400, 'Dirección no válida. Use alta o baja.');
    if (zona.valvula !== 'abierta' || zona.anomalia || zona.incendio) {
      return fallo(409, `La zona ${zona.id} debe tener la válvula abierta y estar sin perturbaciones para inyectar una anomalía.`);
    }
    estado.pendientes.anomalias[zona.id] = { variable: datos.variable, direccion: datos.direccion };
    const detalle = datos.variable ? `${config.ETIQUETAS[datos.variable]} ${datos.direccion || ''}`.trim() : 'variable aleatoria';
    registrarEvento(estado, { tipo: 'prueba', severidad: 'info', origen: 'operador', zona: zona.id, mensaje: `Prueba: anomalía (${detalle}) programada en la zona ${zona.id}.` }, ahoraMs);
    return exito(202, { mensaje: 'Anomalía programada para el próximo ciclo.' }, { difundir: true, persistir: true });
  }

  return fallo(404, 'Tipo de prueba desconocido. Use anomalia o incendio.');
}

/**
 * @param {object} estado
 * @param {{ metodo: string, ruta: string, cuerpo?: any }} solicitud
 * @param {number} ahoraMs
 * @param {{ instantanea: Function, historial: Function }} vistas
 */
function atenderSolicitud(estado, solicitud, ahoraMs, vistas) {
  const metodo = String(solicitud.metodo || '').toUpperCase();
  let partes;
  try {
    partes = segmentos(solicitud.ruta);
  } catch (error) {
    return fallo(400, 'Ruta mal codificada.');
  }
  if (partes[0] !== 'api') return fallo(404, 'Ruta no encontrada.');
  const [, recurso, a, b] = partes;
  const ruta = `${metodo} ${partes.slice(1).length} ${recurso}`;

  switch (ruta) {
    case 'GET 1 estado':
      return exito(200, { instantanea: vistas.instantanea(estado, ahoraMs) });
    case 'GET 1 historial':
      return exito(200, { historial: vistas.historial(estado) });
    case 'POST 2 simulacion':
      return cambiarSimulacion(estado, a, ahoraMs);
    case 'PUT 1 config':
      return actualizarConfiguracion(estado, solicitud.cuerpo, ahoraMs);
    case 'POST 3 valvulas':
      return ordenarValvulas(estado, a, b, ahoraMs);
    case 'POST 2 emergencia': {
      if (a !== 'restablecer') return fallo(404, 'Ruta no encontrada.');
      const r = control.restablecerEmergencia(estado, ahoraMs);
      return r.ok ? exito(200, { mensaje: r.mensaje }, { difundir: true, persistir: true }) : fallo(r.codigo, r.mensaje);
    }
    case 'POST 3 pruebas':
      return inyectarPrueba(estado, a, b, solicitud.cuerpo, ahoraMs);
    case 'POST 2 metricas': {
      if (a !== 'reiniciar') return fallo(404, 'Ruta no encontrada.');
      const secuencia = estado.metricas.secuenciaAnomalias;
      estado.metricas = { ...metricas.metricasVacias(ahoraMs), secuenciaAnomalias: secuencia };
      for (const zona of control.listaZonas(estado)) if (zona.anomalia) zona.anomalia.detectada = true;
      Object.assign(estado.persistencia, { lineasEnviadas: 0, lineasEscritas: 0, escriturasOk: 0, escriturasFallidas: 0 });
      registrarEvento(estado, { tipo: 'metricas', severidad: 'info', origen: 'operador', mensaje: 'Métricas de evaluación reiniciadas.' }, ahoraMs);
      return exito(200, { mensaje: 'Métricas reiniciadas.' }, { difundir: true, persistir: true });
    }
    default:
      return fallo(404, `Ruta no encontrada: ${metodo} /${partes.join('/')}`);
  }
}

module.exports = { atenderSolicitud, segmentos };
