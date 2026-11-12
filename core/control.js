'use strict';

/**
 * Lógica de supervisión y control de válvulas.
 *
 * Prioridades (de mayor a menor):
 *  1. Emergencia por incendio: todas las válvulas cerradas y bloqueadas.
 *  2. Mando manual del operador sobre una zona (override).
 *  3. Control automático: cierre ante una variable fuera de rango y
 *     reapertura tras N ciclos normales consecutivos (histéresis).
 *  4. Modo automático apagado: solo se registran las alarmas.
 *
 * Supresión por estado (IEC 62682): con la válvula cerrada no se evalúa el
 * caudal mínimo, porque un caudal cercano a cero es lo esperado.
 */

const { performance } = require('node:perf_hooks');
const { VARIABLES, UNIDADES, ETIQUETAS } = require('./config');
const { registrarEvento } = require('./eventos');
const { agregarMuestra } = require('./metricas');
const { terminarEpisodio } = require('./simulacion');

function crearZona(id) {
  return {
    id,
    presion: null,
    temperatura: null,
    caudal: null,
    valvula: 'abierta',
    estado: 'normal',
    motivos: [],
    incendio: false,
    ciclosIncendio: 0,
    override: null,
    ciclosNormales: 0,
    anomalia: null,
    proceso: {},
    ultimaLecturaMs: null,
  };
}

/** Crea o elimina zonas para que coincidan con config.zonas. */
function sincronizarZonas(estado) {
  const total = estado.config.zonas;
  for (let id = 1; id <= total; id += 1) {
    if (!estado.zonas[id]) estado.zonas[id] = crearZona(id);
  }
  for (const clave of Object.keys(estado.zonas)) {
    if (Number(clave) > total) delete estado.zonas[clave];
  }
}

function listaZonas(estado) {
  return Object.values(estado.zonas).sort((a, b) => a.id - b.id);
}

/** Coma decimal, como en la interfaz (es-CO), sin depender de ICU. */
const decimal = (texto) => String(texto).replace('.', ',');

function formatearValor(variable, valor) {
  return `${decimal(valor.toFixed(variable === 'presion' ? 2 : 1))} ${UNIDADES[variable]}`;
}

/** Variables fuera de rango en una lectura, considerando la supresión por estado. */
function evaluarLectura(rangos, lectura, valvula) {
  const violaciones = [];
  for (const variable of VARIABLES) {
    const valor = lectura[variable];
    if (!Number.isFinite(valor)) continue;
    const { min, max } = rangos[variable];
    if (variable === 'caudal' && valvula === 'cerrada' && valor < min) continue;
    if (valor < min) violaciones.push({ variable, valor, limite: `mín ${decimal(min)} ${UNIDADES[variable]}` });
    else if (valor > max) violaciones.push({ variable, valor, limite: `máx ${decimal(max)} ${UNIDADES[variable]}` });
  }
  return violaciones;
}

function cerrarValvula(estado, zona) {
  zona.valvula = 'cerrada';
  zona.ciclosNormales = 0;
  // Al aislar la zona, la perturbación simulada se considera controlada.
  terminarEpisodio(estado, zona);
}

function activarEmergencia(estado, zona, ahoraMs, t0) {
  estado.emergencia = { activa: true, zona: zona.id, desdeMs: ahoraMs };
  for (const otra of listaZonas(estado)) cerrarValvula(estado, otra);
  const tiempo = performance.now() - t0;
  agregarMuestra(estado.metricas.tiemposCierreTotalMs, tiempo);
  estado.metricas.incendios += 1;
  registrarEvento(estado, {
    tipo: 'incendio',
    severidad: 'critica',
    origen: 'auto',
    zona: zona.id,
    mensaje: `Incendio detectado en la zona ${zona.id}. Parada de emergencia: todas las válvulas cerradas.`,
    accion: 'Cierre total y bloqueo de reapertura',
    tiempoRespuestaMs: tiempo,
  }, ahoraMs);
}

/**
 * Procesa la lectura de una zona: actualiza su estado, decide la acción
 * sobre la válvula, registra eventos y alimenta las métricas.
 */
function procesarLectura(estado, zona, lectura, ahoraMs) {
  const { config, metricas } = estado;
  const t0 = lectura.t0 ?? performance.now();

  zona.presion = lectura.presion;
  zona.temperatura = lectura.temperatura;
  zona.caudal = lectura.caudal;
  zona.ultimaLecturaMs = ahoraMs;
  metricas.lecturas += 1;

  if (lectura.incendio && !estado.emergencia.activa) activarEmergencia(estado, zona, ahoraMs, t0);

  const violaciones = evaluarLectura(config.rangos, lectura, zona.valvula);
  const anteriores = new Set(zona.motivos);
  zona.motivos = violaciones.map((v) => v.variable);
  if (zona.incendio) zona.motivos.push('incendio');
  zona.estado = zona.motivos.length ? 'alerta' : 'normal';

  // 1. Verdad de referencia: ¿la lectura trae una anomalía inyectada que ya es visible?
  let deteccionNueva = false;
  const inyectada = lectura.anomalia;
  if (inyectada && zona.motivos.includes(inyectada.variable) && zona.anomalia && zona.anomalia.id === inyectada.id && !zona.anomalia.detectada) {
    zona.anomalia.detectada = true;
    metricas.anomaliasDetectadas += 1;
    deteccionNueva = true;
  }

  // 2. Decisión sobre la válvula.
  let accion;
  let tiempoRespuestaMs;
  if (estado.emergencia.activa) {
    zona.valvula = 'cerrada';
    accion = 'Emergencia activa: válvula bloqueada';
  } else if (zona.override) {
    zona.valvula = zona.override;
    accion = `Sin acción: zona en mando manual (${zona.override})`;
  } else if (!config.modoAuto) {
    accion = 'Solo notificación: control automático apagado';
  } else if (zona.estado === 'alerta') {
    zona.ciclosNormales = 0;
    if (zona.valvula === 'abierta') {
      cerrarValvula(estado, zona);
      tiempoRespuestaMs = performance.now() - t0;
      accion = 'Cierre automático de la válvula';
      registrarEvento(estado, {
        tipo: 'cierre_auto',
        severidad: 'aviso',
        origen: 'auto',
        zona: zona.id,
        mensaje: `Válvula de la zona ${zona.id} cerrada automáticamente.`,
        tiempoRespuestaMs,
      }, ahoraMs);
    } else {
      accion = 'Válvula ya cerrada';
    }
  } else {
    zona.ciclosNormales += 1;
    if (zona.valvula === 'cerrada' && zona.ciclosNormales >= config.ticksReapertura) {
      zona.valvula = 'abierta';
      registrarEvento(estado, {
        tipo: 'apertura_auto',
        severidad: 'info',
        origen: 'auto',
        zona: zona.id,
        mensaje: `Válvula de la zona ${zona.id} reabierta tras ${zona.ciclosNormales} ciclos normales.`,
      }, ahoraMs);
    }
  }
  if (deteccionNueva && tiempoRespuestaMs !== undefined) agregarMuestra(metricas.tiemposRespuestaMs, tiempoRespuestaMs);

  // 3. Alarmas nuevas: transición de normal a fuera de rango por variable.
  for (const violacion of violaciones) {
    if (anteriores.has(violacion.variable)) continue;
    metricas.alarmasEmitidas += 1;
    const esperada = (inyectada && inyectada.variable === violacion.variable)
      || (violacion.variable === 'temperatura' && zona.incendio);
    if (!esperada) metricas.falsasAlarmas += 1;
    registrarEvento(estado, {
      tipo: 'alarma',
      severidad: 'alarma',
      origen: 'auto',
      zona: zona.id,
      variable: violacion.variable,
      valor: violacion.valor,
      limite: violacion.limite,
      accion,
      mensaje: `${ETIQUETAS[violacion.variable]} fuera de rango en la zona ${zona.id}: ${formatearValor(violacion.variable, violacion.valor)} (${violacion.limite}).`,
    }, ahoraMs);
  }

  if (zona.anomalia && zona.anomalia.restantes <= 0) terminarEpisodio(estado, zona);
}

/**
 * Orden manual sobre una zona.
 * @param {'abrir'|'cerrar'|'auto'} accion
 * @returns {{ ok: boolean, codigo?: number, mensaje: string }}
 */
function ordenValvula(estado, zona, accion, ahoraMs) {
  if (accion === 'abrir' && estado.emergencia.activa) {
    return { ok: false, codigo: 409, mensaje: 'Emergencia activa: no se puede abrir ninguna válvula hasta restablecerla.' };
  }
  if (accion === 'abrir') {
    zona.override = 'abierta';
    zona.valvula = 'abierta';
  } else if (accion === 'cerrar') {
    zona.override = 'cerrada';
    cerrarValvula(estado, zona);
  } else {
    zona.override = null;
    zona.ciclosNormales = 0;
  }
  const textos = {
    abrir: `Operador abrió la válvula de la zona ${zona.id} (mando manual).`,
    cerrar: `Operador cerró la válvula de la zona ${zona.id} (mando manual).`,
    auto: `Zona ${zona.id} devuelta al control automático.`,
  };
  registrarEvento(estado, {
    tipo: 'mando_manual',
    severidad: 'info',
    origen: 'operador',
    zona: zona.id,
    accion,
    mensaje: textos[accion],
  }, ahoraMs);
  return { ok: true, mensaje: textos[accion] };
}

function restablecerEmergencia(estado, ahoraMs) {
  if (!estado.emergencia.activa) {
    return { ok: false, codigo: 409, mensaje: 'No hay una emergencia activa.' };
  }
  const zonaOrigen = estado.emergencia.zona;
  estado.emergencia = { activa: false, zona: null, desdeMs: null };
  for (const zona of listaZonas(estado)) {
    zona.incendio = false;
    zona.ciclosIncendio = 0;
    zona.override = null;
    zona.ciclosNormales = 0;
  }
  registrarEvento(estado, {
    tipo: 'emergencia_restablecida',
    severidad: 'aviso',
    origen: 'operador',
    zona: zonaOrigen,
    mensaje: 'Emergencia restablecida por el operador. Las válvulas vuelven al control automático.',
  }, ahoraMs);
  return { ok: true, mensaje: 'Emergencia restablecida.' };
}

module.exports = {
  crearZona,
  sincronizarZonas,
  listaZonas,
  evaluarLectura,
  procesarLectura,
  ordenValvula,
  restablecerEmergencia,
};
