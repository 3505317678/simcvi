'use strict';

/**
 * Serialización al protocolo de línea de InfluxDB.
 *
 * Formato: medicion,etiqueta=valor campo=valor marca_de_tiempo
 * Referencia: https://docs.influxdata.com/influxdb/v2/reference/syntax/line-protocol/
 *
 * Las marcas de tiempo se escriben en nanosegundos como texto
 * (milisegundos + 6 dígitos de desempate) para no perder precisión en
 * JavaScript y para que dos puntos del mismo milisegundo no se sobrescriban.
 */

const { VARIABLES } = require('./config');

function escaparMedicion(texto) {
  return String(texto).replace(/[,\s]/g, (c) => `\\${c}`);
}

function escaparClave(texto) {
  return String(texto).replace(/[,=\s]/g, (c) => `\\${c}`);
}

function escaparTexto(texto) {
  return `"${String(texto).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Convierte un valor a campo: entero (sufijo i), flotante, booleano o texto. */
function campo(valor, tipo) {
  if (tipo === 'entero') {
    if (!Number.isInteger(valor)) throw new Error(`Se esperaba un entero: ${valor}`);
    return `${valor}i`;
  }
  if (tipo === 'flotante') {
    if (!Number.isFinite(valor)) throw new Error(`Se esperaba un número finito: ${valor}`);
    return String(Math.round(valor * 1e4) / 1e4);
  }
  if (tipo === 'booleano') return valor ? 'true' : 'false';
  return escaparTexto(valor);
}

function marcaNs(ms, desempate = 0) {
  if (!Number.isInteger(ms) || ms < 0) throw new Error(`Marca de tiempo inválida: ${ms}`);
  return `${ms}${String(desempate % 1e6).padStart(6, '0')}`;
}

/**
 * @param {string} medicion
 * @param {object} etiquetas  { nombre: valor } (se omiten null/undefined/'')
 * @param {Array<[string, any, string]>} campos  [nombre, valor, tipo]
 * @param {string} marca  marca de tiempo en ns
 */
function linea(medicion, etiquetas, campos, marca) {
  const partesEtiquetas = Object.entries(etiquetas)
    .filter(([, valor]) => valor !== null && valor !== undefined && valor !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clave, valor]) => `${escaparClave(clave)}=${escaparClave(valor)}`);
  const partesCampos = campos
    .filter(([, valor]) => valor !== null && valor !== undefined)
    .map(([clave, valor, tipo]) => `${escaparClave(clave)}=${campo(valor, tipo)}`);
  if (!partesCampos.length) throw new Error(`La línea de ${medicion} no tiene campos.`);
  const cabecera = [escaparMedicion(medicion), ...partesEtiquetas].join(',');
  return `${cabecera} ${partesCampos.join(',')} ${marca}`;
}

function lineaTelemetria(zona, lectura, ms) {
  return linea('telemetria', { zona: zona.id }, [
    ['presion', lectura.presion, 'flotante'],
    ['temperatura', lectura.temperatura, 'flotante'],
    ['caudal', lectura.caudal, 'flotante'],
    ['valvula_abierta', zona.valvula === 'abierta', 'booleano'],
    ['en_alerta', zona.estado === 'alerta', 'booleano'],
    ['incendio', Boolean(zona.incendio), 'booleano'],
    ['anomalia_inyectada', Boolean(lectura.anomalia), 'booleano'],
    ['mando_manual', Boolean(zona.override), 'booleano'],
  ], marcaNs(ms, 0));
}

function lineaEvento(evento, desempate) {
  return linea('eventos', {
    zona: evento.zona,
    tipo: evento.tipo,
    severidad: evento.severidad,
    origen: evento.origen,
    variable: evento.variable,
  }, [
    ['id', evento.id, 'entero'],
    ['mensaje', evento.mensaje, 'texto'],
    ['valor', evento.valor, 'flotante'],
    ['limite', evento.limite, 'texto'],
    ['accion', evento.accion, 'texto'],
    ['tiempo_respuesta_ms', evento.tiempoRespuestaMs, 'flotante'],
  ], marcaNs(evento.tsMs, desempate));
}

function lineaPlanta(resumen, ms) {
  return linea('planta', {}, [
    ['emergencia', resumen.emergencia, 'booleano'],
    ['modo_auto', resumen.modoAuto, 'booleano'],
    ['simulacion_activa', resumen.simulacionActiva, 'booleano'],
    ['zonas', resumen.zonas, 'entero'],
    ['zonas_alerta', resumen.zonasAlerta, 'entero'],
    ['valvulas_abiertas', resumen.valvulasAbiertas, 'entero'],
  ], marcaNs(ms, 0));
}

function lineasLimites(rangos, ms) {
  return VARIABLES.map((variable) => linea('limites', { variable }, [
    ['min', rangos[variable].min, 'flotante'],
    ['max', rangos[variable].max, 'flotante'],
  ], marcaNs(ms, 0)));
}

module.exports = {
  escaparMedicion,
  escaparClave,
  escaparTexto,
  marcaNs,
  linea,
  lineaTelemetria,
  lineaEvento,
  lineaPlanta,
  lineasLimites,
};
