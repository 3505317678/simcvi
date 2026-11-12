'use strict';

/**
 * Configuración del proceso simulado: valores por defecto, validación y
 * lectura desde variables de entorno.
 *
 * Toda modificación pasa por validarCambios(), que es atómica: si un campo
 * es inválido no se aplica ninguno y se devuelve la lista de errores.
 */

const VARIABLES = Object.freeze(['presion', 'temperatura', 'caudal']);

const UNIDADES = Object.freeze({ presion: 'bar', temperatura: '°C', caudal: 'L/min' });

const ETIQUETAS = Object.freeze({ presion: 'Presión', temperatura: 'Temperatura', caudal: 'Caudal' });

/** Límites de los parámetros que el operador puede cambiar. */
const LIMITES = Object.freeze({
  zonas: { min: 1, max: 12 },
  intervaloSeg: { min: 1, max: 60 },
  probAnomaliaPct: { min: 0, max: 100 },
  probIncendioPct: { min: 0, max: 100 },
  ticksReapertura: { min: 1, max: 20 },
  valorRango: { min: -1000, max: 100000 },
});

const CONFIG_BASE = Object.freeze({
  zonas: 4,
  intervaloSeg: 2,
  probAnomaliaPct: 4,
  probIncendioPct: 0,
  modoAuto: true,
  ticksReapertura: 2,
  rangos: Object.freeze({
    presion: Object.freeze({ min: 2, max: 8 }),
    temperatura: Object.freeze({ min: 10, max: 75 }),
    caudal: Object.freeze({ min: 20, max: 120 }),
  }),
});

function copiar(config) {
  return JSON.parse(JSON.stringify(config));
}

function esNumero(valor) {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function validarEntero(nombre, valor, errores) {
  const { min, max } = LIMITES[nombre];
  if (!Number.isInteger(valor) || valor < min || valor > max) {
    errores.push(`${nombre} debe ser un entero entre ${min} y ${max}.`);
    return false;
  }
  return true;
}

function validarNumero(nombre, valor, errores) {
  const { min, max } = LIMITES[nombre];
  if (!esNumero(valor) || valor < min || valor > max) {
    errores.push(`${nombre} debe ser un número entre ${min} y ${max}.`);
    return false;
  }
  return true;
}

/**
 * Valida un objeto de cambios parciales sobre una configuración.
 * @returns {{ config: object, errores: string[] }} config es la nueva
 *   configuración si no hubo errores; si los hubo, es una copia de la actual.
 */
function validarCambios(actual, cambios) {
  const errores = [];
  const nueva = copiar(actual);

  if (cambios === null || typeof cambios !== 'object' || Array.isArray(cambios)) {
    return { config: nueva, errores: ['El cuerpo debe ser un objeto JSON.'] };
  }

  const conocidos = new Set(['zonas', 'intervaloSeg', 'probAnomaliaPct', 'probIncendioPct', 'modoAuto', 'ticksReapertura', 'rangos']);
  for (const clave of Object.keys(cambios)) {
    if (!conocidos.has(clave)) errores.push(`Parámetro desconocido: ${clave}.`);
  }

  for (const clave of ['zonas', 'ticksReapertura']) {
    if (clave in cambios && validarEntero(clave, cambios[clave], errores)) nueva[clave] = cambios[clave];
  }
  for (const clave of ['intervaloSeg', 'probAnomaliaPct', 'probIncendioPct']) {
    if (clave in cambios && validarNumero(clave, cambios[clave], errores)) nueva[clave] = cambios[clave];
  }
  if ('modoAuto' in cambios) {
    if (typeof cambios.modoAuto === 'boolean') nueva.modoAuto = cambios.modoAuto;
    else errores.push('modoAuto debe ser true o false.');
  }

  if ('rangos' in cambios) {
    const rangos = cambios.rangos;
    if (rangos === null || typeof rangos !== 'object' || Array.isArray(rangos)) {
      errores.push('rangos debe ser un objeto.');
    } else {
      for (const variable of Object.keys(rangos)) {
        if (!VARIABLES.includes(variable)) {
          errores.push(`Variable desconocida en rangos: ${variable}.`);
          continue;
        }
        const propuesto = { ...nueva.rangos[variable], ...rangos[variable] };
        const okMin = validarNumero('valorRango', propuesto.min, errores);
        const okMax = validarNumero('valorRango', propuesto.max, errores);
        if (okMin && okMax && propuesto.min >= propuesto.max) {
          errores.push(`En ${variable}, el mínimo debe ser menor que el máximo.`);
        } else if (okMin && okMax) {
          nueva.rangos[variable] = { min: propuesto.min, max: propuesto.max };
        }
      }
    }
  }

  return errores.length ? { config: copiar(actual), errores } : { config: nueva, errores };
}

function numeroDeEntorno(texto) {
  if (texto === undefined || texto === null || String(texto).trim() === '') return undefined;
  const valor = Number(texto);
  return Number.isFinite(valor) ? valor : NaN;
}

/**
 * Construye la configuración inicial a partir de variables de entorno.
 * Si alguna es inválida, se informa y se conserva el valor por defecto.
 */
function configDesdeEntorno(entorno = process.env) {
  const cambios = {};
  const mapa = {
    zonas: 'SIM_ZONAS',
    intervaloSeg: 'SIM_INTERVALO_SEG',
    probAnomaliaPct: 'SIM_PROB_ANOMALIA_PCT',
    probIncendioPct: 'SIM_PROB_INCENDIO_PCT',
  };
  for (const [clave, nombre] of Object.entries(mapa)) {
    const valor = numeroDeEntorno(entorno[nombre]);
    if (valor !== undefined) cambios[clave] = valor;
  }
  const base = copiar(CONFIG_BASE);
  let { config, errores } = validarCambios(base, cambios);
  if (errores.length) {
    // Se aplica campo por campo para conservar los válidos.
    config = base;
    for (const [clave, valor] of Object.entries(cambios)) {
      const parcial = validarCambios(config, { [clave]: valor });
      if (!parcial.errores.length) config = parcial.config;
    }
  }
  const autoinicio = String(entorno.SIM_AUTOINICIO ?? 'true').toLowerCase() !== 'false';
  return { config, autoinicio, errores };
}

module.exports = {
  VARIABLES,
  UNIDADES,
  ETIQUETAS,
  LIMITES,
  CONFIG_BASE,
  copiar,
  validarCambios,
  configDesdeEntorno,
};
