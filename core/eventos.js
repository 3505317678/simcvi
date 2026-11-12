'use strict';

/**
 * Registro de eventos del sistema (alarmas, acciones de control, órdenes
 * del operador y avisos técnicos). Se guarda en memoria como búfer
 * circular, del más reciente al más antiguo, y cada evento recibe un
 * número de secuencia para saber cuáles faltan por persistir.
 */

const MAX_EVENTOS = 200;

const SEVERIDADES = Object.freeze(['info', 'aviso', 'alarma', 'critica']);

/**
 * @param {object} estado
 * @param {object} datos  { tipo, severidad, origen, mensaje, zona?, variable?, valor?, limite?, accion?, tiempoRespuestaMs? }
 * @param {number} ahoraMs
 */
function registrarEvento(estado, datos, ahoraMs) {
  if (!SEVERIDADES.includes(datos.severidad)) {
    throw new Error(`Severidad no válida: ${datos.severidad}`);
  }
  estado.secuenciaEventos += 1;
  const evento = {
    id: estado.secuenciaEventos,
    tsMs: ahoraMs,
    ts: new Date(ahoraMs).toISOString(),
    zona: datos.zona ?? null,
    tipo: datos.tipo,
    severidad: datos.severidad,
    origen: datos.origen,
    mensaje: datos.mensaje,
  };
  for (const opcional of ['variable', 'valor', 'limite', 'accion', 'tiempoRespuestaMs']) {
    if (datos[opcional] !== undefined && datos[opcional] !== null) evento[opcional] = datos[opcional];
  }
  estado.eventos.unshift(evento);
  if (estado.eventos.length > MAX_EVENTOS) estado.eventos.length = MAX_EVENTOS;
  return evento;
}

/** Eventos con secuencia mayor que `desde`, en orden cronológico. */
function eventosDesde(estado, desde) {
  return estado.eventos.filter((evento) => evento.id > desde).reverse();
}

module.exports = { MAX_EVENTOS, SEVERIDADES, registrarEvento, eventosDesde };
