// Estado de la interfaz: última instantánea de Node-RED, historial para las
// tendencias y estadísticas de la conexión. Las vistas se suscriben a cambios.

import { VARIABLES } from './util.js';

const MAX_PUNTOS = 300;

const estado = {
  instantanea: null,
  conexion: 'conectando',
  historial: { t: [], zonas: {} },
  ultimoCicloMs: 0,
  mensajes: 0,
  latenciaMs: null,
  pulsos: { ws: 0, ciclo: 0 },
};

const suscriptores = new Set();

export const obtener = () => estado;

export function suscribir(funcion) {
  suscriptores.add(funcion);
  return () => suscriptores.delete(funcion);
}

let pendiente = false;
function notificar() {
  if (pendiente) return;
  pendiente = true;
  requestAnimationFrame(() => {
    pendiente = false;
    for (const funcion of suscriptores) funcion(estado);
  });
}

export function cambiarConexion(valor) {
  estado.conexion = valor;
  notificar();
}

export function cargarHistorial(historial) {
  if (!historial || !Array.isArray(historial.t)) return;
  estado.historial = historial;
  estado.ultimoCicloMs = historial.t.at(-1) || 0;
  notificar();
}

function agregarPunto(instantanea) {
  const { historial } = estado;
  const t = instantanea.simulacion.ultimoCicloMs;
  historial.t.push(t);
  const ids = new Set(instantanea.zonas.map((z) => String(z.id)));
  for (const zona of instantanea.zonas) {
    if (!historial.zonas[zona.id]) {
      historial.zonas[zona.id] = { presion: [], temperatura: [], caudal: [] };
      for (const v of VARIABLES) historial.zonas[zona.id][v] = new Array(historial.t.length - 1).fill(null);
    }
  }
  for (const [id, serie] of Object.entries(historial.zonas)) {
    const zona = ids.has(id) ? instantanea.zonas.find((z) => String(z.id) === id) : null;
    for (const v of VARIABLES) serie[v].push(zona ? zona[v] : null);
  }
  while (historial.t.length > MAX_PUNTOS) {
    historial.t.shift();
    for (const serie of Object.values(historial.zonas)) for (const v of VARIABLES) serie[v].shift();
  }
}

export function recibirInstantanea(instantanea) {
  if (!instantanea || instantanea.tipo !== 'instantanea') return;
  estado.instantanea = instantanea;
  estado.mensajes += 1;
  estado.pulsos.ws += 1;
  const latencia = Date.now() - instantanea.tsMs;
  if (latencia >= 0 && latencia < 60000) {
    estado.latenciaMs = estado.latenciaMs === null ? latencia : estado.latenciaMs * 0.8 + latencia * 0.2;
  }
  const ciclo = instantanea.simulacion.ultimoCicloMs;
  if (ciclo && ciclo > estado.ultimoCicloMs) {
    estado.ultimoCicloMs = ciclo;
    estado.pulsos.ciclo += 1;
    agregarPunto(instantanea);
  }
  notificar();
}
