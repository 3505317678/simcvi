'use strict';

/**
 * Indicadores de evaluación del prototipo (capítulo 8.5 del informe):
 *  - Tasa de detección = anomalías detectadas / anomalías resueltas × 100.
 *  - Tasa de falsas alarmas = alarmas sin anomalía inyectada / alarmas × 100.
 *  - Tiempo de respuesta = generación de la lectura anormal → orden de cierre.
 *  - Tiempo de cierre total ante incendio.
 *  - Integridad del almacenamiento = líneas escritas / líneas enviadas × 100.
 */

const MAX_MUESTRAS = 500;

function metricasVacias(ahoraMs = Date.now()) {
  return {
    desdeMs: ahoraMs,
    lecturas: 0,
    secuenciaAnomalias: 0,
    anomaliasInyectadas: 0,
    anomaliasDetectadas: 0,
    anomaliasNoDetectadas: 0,
    alarmasEmitidas: 0,
    falsasAlarmas: 0,
    incendios: 0,
    tiemposRespuestaMs: [],
    tiemposCierreTotalMs: [],
  };
}

function agregarMuestra(lista, valor) {
  if (!Number.isFinite(valor)) return;
  lista.push(valor);
  if (lista.length > MAX_MUESTRAS) lista.shift();
}

function redondear(valor, decimales = 3) {
  if (!Number.isFinite(valor)) return null;
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

/** Estadística descriptiva de una lista de tiempos en milisegundos. */
function resumen(lista) {
  const n = lista.length;
  if (!n) return { n: 0, mediaMs: null, desvMs: null, minMs: null, maxMs: null, p95Ms: null };
  const media = lista.reduce((a, b) => a + b, 0) / n;
  const varianza = n > 1 ? lista.reduce((a, b) => a + (b - media) ** 2, 0) / (n - 1) : 0;
  const ordenada = [...lista].sort((a, b) => a - b);
  const p95 = ordenada[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  return {
    n,
    mediaMs: redondear(media),
    desvMs: redondear(Math.sqrt(varianza)),
    minMs: redondear(ordenada[0]),
    maxMs: redondear(ordenada[n - 1]),
    p95Ms: redondear(p95),
  };
}

function porcentaje(parte, total) {
  return total > 0 ? redondear((parte / total) * 100, 2) : null;
}

/** Vista pública de las métricas, con los indicadores ya calculados. */
function calcularIndicadores(metricas, persistencia) {
  const resueltas = metricas.anomaliasDetectadas + metricas.anomaliasNoDetectadas;
  const enviadas = persistencia.lineasEnviadas;
  return {
    desdeMs: metricas.desdeMs,
    lecturas: metricas.lecturas,
    anomaliasInyectadas: metricas.anomaliasInyectadas,
    anomaliasDetectadas: metricas.anomaliasDetectadas,
    anomaliasNoDetectadas: metricas.anomaliasNoDetectadas,
    alarmasEmitidas: metricas.alarmasEmitidas,
    falsasAlarmas: metricas.falsasAlarmas,
    incendios: metricas.incendios,
    tasaDeteccionPct: porcentaje(metricas.anomaliasDetectadas, resueltas),
    tasaFalsasAlarmasPct: porcentaje(metricas.falsasAlarmas, metricas.alarmasEmitidas),
    integridadPct: porcentaje(persistencia.lineasEscritas, enviadas),
    tiempoRespuesta: resumen(metricas.tiemposRespuestaMs),
    tiempoCierreTotal: resumen(metricas.tiemposCierreTotalMs),
  };
}

module.exports = { metricasVacias, agregarMuestra, resumen, redondear, calcularIndicadores };
