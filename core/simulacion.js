'use strict';

/**
 * Generador de lecturas simuladas.
 *
 * Cada variable sigue un proceso con reversión a la media (paseo aleatorio
 * que tiende a un valor central), de modo que las tendencias se parecen a
 * las de un proceso real. Las anomalías son episodios de varios ciclos que
 * llevan una variable fuera de su rango; el generador marca cada lectura
 * con la «verdad de referencia» (qué anomalía o incendio inyectó) para que
 * el sistema pueda medir su tasa de detección y de falsas alarmas.
 *
 * Simplificaciones (documentadas para el informe):
 *  - Al cerrarse la válvula de una zona, la perturbación se considera
 *    aislada y el episodio termina.
 *  - Con la válvula cerrada el caudal es prácticamente cero.
 *  - En la zona con incendio la temperatura sube por encima de su máximo.
 */

const { VARIABLES } = require('./config');

const REVERSION = 0.25;
const RUIDO = 0.035;
const MARGEN_NORMAL = 0.1;
const DURACION_EPISODIO = { min: 3, max: 6 };
const EXCESO_EPISODIO = { min: 0.08, max: 0.3 };

/** Generador pseudoaleatorio reproducible (mulberry32) para pruebas. */
function crearAleatorio(semilla = 1) {
  let a = semilla >>> 0;
  return function aleatorio() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(aleatorio) {
  const u = Math.max(aleatorio(), 1e-12);
  const v = aleatorio();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function limitar(valor, min, max) {
  return Math.min(max, Math.max(min, valor));
}

function entre(aleatorio, min, max) {
  return min + aleatorio() * (max - min);
}

/** Desfase determinista por zona para que no todas tengan el mismo centro. */
function desfaseZona(id) {
  return (((id * 37) % 11) - 5) / 5;
}

function avanzarProceso(zona, rangos, aleatorio) {
  for (const variable of VARIABLES) {
    const { min, max } = rangos[variable];
    const amplitud = max - min;
    const centro = min + amplitud * (0.5 + desfaseZona(zona.id) * 0.12);
    const previo = Number.isFinite(zona.proceso[variable]) ? zona.proceso[variable] : centro;
    const siguiente = previo + REVERSION * (centro - previo) + gauss(aleatorio) * amplitud * RUIDO;
    zona.proceso[variable] = limitar(siguiente, min + amplitud * MARGEN_NORMAL, max - amplitud * MARGEN_NORMAL);
  }
}

function iniciarEpisodio(estado, zona, aleatorio, forzado = {}) {
  const variable = forzado.variable || VARIABLES[Math.floor(aleatorio() * VARIABLES.length)];
  const direccion = forzado.direccion || (aleatorio() < 0.5 ? 'alta' : 'baja');
  estado.metricas.secuenciaAnomalias += 1;
  zona.anomalia = {
    id: estado.metricas.secuenciaAnomalias,
    variable,
    direccion,
    exceso: entre(aleatorio, EXCESO_EPISODIO.min, EXCESO_EPISODIO.max),
    restantes: Math.round(entre(aleatorio, DURACION_EPISODIO.min, DURACION_EPISODIO.max)),
    detectada: false,
  };
  estado.metricas.anomaliasInyectadas += 1;
}

/**
 * Cierra el episodio activo de una zona y actualiza las métricas si nunca
 * llegó a detectarse.
 */
function terminarEpisodio(estado, zona) {
  if (!zona.anomalia) return;
  if (!zona.anomalia.detectada) estado.metricas.anomaliasNoDetectadas += 1;
  zona.anomalia = null;
}

function valorAnomalo(anomalia, rango, aleatorio) {
  const amplitud = rango.max - rango.min;
  const exceso = amplitud * anomalia.exceso * (0.9 + aleatorio() * 0.2);
  return anomalia.direccion === 'alta' ? rango.max + exceso : rango.min - exceso;
}

/**
 * Genera la lectura de una zona para el ciclo actual.
 * @returns {object} lectura con valores y verdad de referencia.
 */
function generarLectura(estado, zona, aleatorio) {
  const { config } = estado;
  const pendientes = estado.pendientes;

  avanzarProceso(zona, config.rangos, aleatorio);

  // Incendio: inyectado por prueba o por probabilidad configurada.
  const incendioForzado = Boolean(pendientes.incendios[zona.id]);
  delete pendientes.incendios[zona.id];
  if (!estado.emergencia.activa && (incendioForzado || aleatorio() * 100 < config.probIncendioPct)) {
    zona.incendio = true;
    zona.ciclosIncendio = 0;
  }

  // Anomalía: solo en zonas con la válvula abierta y sin emergencia.
  const forzada = pendientes.anomalias[zona.id];
  delete pendientes.anomalias[zona.id];
  const puedeIniciar = !zona.anomalia && zona.valvula === 'abierta' && !estado.emergencia.activa && !zona.incendio;
  if (puedeIniciar && (forzada || aleatorio() * 100 < config.probAnomaliaPct)) {
    iniciarEpisodio(estado, zona, aleatorio, forzada || {});
  }

  const lectura = {
    zona: zona.id,
    presion: zona.proceso.presion,
    temperatura: zona.proceso.temperatura,
    caudal: zona.proceso.caudal,
    anomalia: null,
    incendio: zona.incendio,
    t0: null,
  };

  if (zona.anomalia) {
    const { variable } = zona.anomalia;
    lectura[variable] = valorAnomalo(zona.anomalia, config.rangos[variable], aleatorio);
    lectura.anomalia = { id: zona.anomalia.id, variable };
    zona.anomalia.restantes -= 1;
  }

  if (zona.incendio) {
    const rango = config.rangos.temperatura;
    const amplitud = rango.max - rango.min;
    zona.ciclosIncendio = (zona.ciclosIncendio || 0) + 1;
    const subida = Math.min(1, zona.ciclosIncendio / 3);
    lectura.temperatura = rango.max + amplitud * 0.4 * subida + gauss(aleatorio) * amplitud * 0.02;
  }

  if (zona.valvula === 'cerrada') {
    lectura.caudal = Math.abs(gauss(aleatorio)) * 0.3;
  }

  return lectura;
}

module.exports = {
  crearAleatorio,
  generarLectura,
  terminarEpisodio,
};
