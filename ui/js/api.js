// Cliente de la API HTTP y del WebSocket de Node-RED.
// La interfaz no decide nada sobre el proceso: envía órdenes y muestra lo que Node-RED responde.

export class ErrorApi extends Error {
  constructor(mensaje, estado, detalles = []) {
    super(mensaje);
    this.estado = estado;
    this.detalles = detalles;
  }
}

async function pedir(metodo, ruta, cuerpo) {
  // Las órdenes (no las consultas) se anuncian para que el diagrama de arquitectura las muestre.
  if (metodo !== 'GET') window.dispatchEvent(new CustomEvent('simcvi:orden', { detail: { metodo, ruta } }));
  let respuesta;
  try {
    respuesta = await fetch(ruta, {
      method: metodo,
      headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ErrorApi('No hay conexión con Node-RED. Revise que el contenedor esté en ejecución.', 0);
  }
  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    throw new ErrorApi(`Respuesta inesperada de Node-RED (HTTP ${respuesta.status}).`, respuesta.status);
  }
  if (!respuesta.ok || !datos.ok) {
    const error = datos && datos.error ? datos.error : {};
    throw new ErrorApi(error.mensaje || `Error HTTP ${respuesta.status}`, respuesta.status, error.detalles || []);
  }
  return datos;
}

export const api = {
  estado: () => pedir('GET', '/api/estado'),
  historial: () => pedir('GET', '/api/historial'),
  simulacion: (accion) => pedir('POST', `/api/simulacion/${accion}`),
  configurar: (cambios) => pedir('PUT', '/api/config', cambios),
  valvula: (zona, accion) => pedir('POST', `/api/valvulas/${encodeURIComponent(zona)}/${accion}`),
  restablecerEmergencia: () => pedir('POST', '/api/emergencia/restablecer'),
  anomalia: (zona, variable, direccion) => pedir('POST', `/api/pruebas/anomalia/${zona}`, { variable, direccion }),
  incendio: (zona) => pedir('POST', `/api/pruebas/incendio/${zona}`),
  reiniciarMetricas: () => pedir('POST', '/api/metricas/reiniciar'),
};

/**
 * Conexión WebSocket con reconexión automática (espera creciente hasta 10 s).
 * Al conectarse envía {"tipo":"hola"} y Node-RED responde con el estado actual.
 */
export class ConexionTiempoReal {
  constructor({ alRecibir, alCambiarEstado }) {
    this.alRecibir = alRecibir;
    this.alCambiarEstado = alCambiarEstado;
    this.espera = 1000;
    this.socket = null;
  }

  conectar() {
    const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new WebSocket(`${protocolo}://${location.host}/ws/simcvi`);
    this.alCambiarEstado('conectando');
    this.socket.addEventListener('open', () => {
      this.espera = 1000;
      this.alCambiarEstado('ok');
      this.socket.send(JSON.stringify({ tipo: 'hola' }));
    });
    this.socket.addEventListener('message', (evento) => {
      try {
        this.alRecibir(JSON.parse(evento.data));
      } catch {
        // Mensaje no válido: se ignora.
      }
    });
    this.socket.addEventListener('close', () => {
      this.alCambiarEstado('error');
      setTimeout(() => this.conectar(), this.espera);
      this.espera = Math.min(this.espera * 2, 10000);
    });
  }
}
