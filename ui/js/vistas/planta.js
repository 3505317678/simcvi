// Vista Planta: sinóptico del proceso (cabezal, ramales, válvulas y medidores
// analógicos), resumen del estado y mando global. El color solo aparece en
// condiciones anormales.

import { api } from '../api.js';
import { $, $$, el, avisar, VARIABLES, NOMBRES, UNIDADES, formatoVariable, hora, posicionEnPista } from '../util.js';
import { abrirPanelZona } from './zona.js';
import { crearValvula, actualizarValvula } from './valvula.js';

const filas = new Map();

function direccion(valor, rango) {
  return valor > rango.max ? 'alta' : 'baja';
}

export function textoEstadoZona(zona, config) {
  if (zona.incendio) return 'Incendio';
  if (zona.estado !== 'alerta') return 'Normal';
  const motivos = zona.motivos
    .filter((m) => m !== 'incendio')
    .map((m) => `${NOMBRES[m].toLowerCase()} ${direccion(zona[m], config.rangos[m])}`);
  return `Alarma: ${motivos.join(', ')}`;
}

export function textoMando(zona, instantanea) {
  if (instantanea.emergencia.activa) return 'Bloqueada por emergencia';
  if (zona.override) return 'Mando manual';
  return instantanea.config.modoAuto ? 'Automático' : 'Automático apagado';
}

function crearMedidor(variable) {
  const valor = el('span', { clase: 'medidor__valor' });
  const banda = el('span', { clase: 'medidor__banda' });
  const aguja = el('span', { clase: 'medidor__aguja' });
  const nodo = el('div', { clase: 'medidor' },
    el('span', { clase: 'medidor__nombre', texto: NOMBRES[variable] }),
    valor,
    el('div', { clase: 'medidor__pista', 'aria-hidden': 'true' }, banda, aguja));
  return { nodo, valor, banda, aguja };
}

function crearFila(id) {
  const boton = el('button', { clase: 'zona__boton', type: 'button', texto: `Zona ${id}`, 'aria-haspopup': 'dialog' });
  const estado = el('span', { clase: 'zona__estado' });
  const valvulaTexto = el('span', { clase: 'zona__valvula' });
  const modo = el('span', { clase: 'zona__modo' });
  const valvula = crearValvula(id);
  const medidores = Object.fromEntries(VARIABLES.map((v) => [v, crearMedidor(v)]));
  const li = el('li', { clase: 'zona' },
    el('div', { clase: 'zona__ramal' }, el('span', { clase: 'zona__tubo' }), valvula),
    el('div', { clase: 'zona__id' }, boton, estado),
    el('div', { clase: 'zona__variables' }, VARIABLES.map((v) => medidores[v].nodo)),
    el('div', { clase: 'zona__mando' }, valvulaTexto, modo));
  boton.addEventListener('click', () => abrirPanelZona(id, boton));
  return { li, boton, estado, valvulaTexto, modo, valvula, medidores };
}

function actualizarFila(fila, zona, instantanea) {
  const { config } = instantanea;
  const fluye = zona.valvula === 'abierta' && instantanea.simulacion.activa;
  fila.li.dataset.estado = zona.incendio ? 'incendio' : zona.estado;
  fila.li.dataset.valvula = zona.valvula;
  fila.li.dataset.flujo = fluye ? 'si' : 'no';
  fila.estado.textContent = textoEstadoZona(zona, config);
  fila.valvulaTexto.textContent = zona.valvula === 'abierta' ? 'Abierta' : 'Cerrada';
  fila.modo.textContent = textoMando(zona, instantanea);
  actualizarValvula(fila.valvula, { abierta: zona.valvula === 'abierta', fluye, manual: Boolean(zona.override) });
  fila.boton.setAttribute('aria-label', `Zona ${zona.id}: ${fila.estado.textContent}, válvula ${fila.valvulaTexto.textContent.toLowerCase()}. Abrir detalle.`);

  for (const variable of VARIABLES) {
    const m = fila.medidores[variable];
    const rango = config.rangos[variable];
    const valor = zona[variable];
    const suprimido = variable === 'caudal' && zona.valvula === 'cerrada';
    m.valor.replaceChildren(formatoVariable(variable, valor), ' ', el('span', { clase: 'medidor__unidad', texto: UNIDADES[variable] }));
    const inicio = posicionEnPista(rango.min, rango);
    const fin = posicionEnPista(rango.max, rango);
    m.banda.style.left = `${inicio}%`;
    m.banda.style.width = `${fin - inicio}%`;
    m.aguja.style.left = Number.isFinite(valor) ? `${posicionEnPista(valor, rango)}%` : '-10%';
    m.nodo.dataset.fuera = zona.motivos.includes(variable) ? 'si' : 'no';
    m.nodo.dataset.suprimido = suprimido ? 'si' : 'no';
    m.nodo.title = suprimido
      ? 'Caudal con la válvula cerrada: la alarma de caudal mínimo está suprimida.'
      : `Rango normal: ${rango.min} a ${rango.max} ${UNIDADES[variable]}`;
  }
}

function renderZonas(instantanea) {
  const lista = $('#zonas');
  const ids = new Set(instantanea.zonas.map((z) => z.id));
  for (const [id, fila] of filas) {
    if (!ids.has(id)) {
      fila.li.remove();
      filas.delete(id);
    }
  }
  for (const zona of instantanea.zonas) {
    if (!filas.has(zona.id)) {
      const fila = crearFila(zona.id);
      filas.set(zona.id, fila);
      const siguiente = [...filas.keys()].filter((k) => k > zona.id).sort((a, b) => a - b)[0];
      lista.insertBefore(fila.li, siguiente ? filas.get(siguiente).li : null);
    }
    actualizarFila(filas.get(zona.id), zona, instantanea);
  }
  $('#zonas-vacio').hidden = instantanea.zonas.length > 0;
}

function renderResumen(instantanea) {
  const { kpis, emergencia, simulacion } = instantanea;
  const estado = $('#estado-planta');
  if (emergencia.activa) {
    estado.dataset.nivel = 'emergencia';
    estado.textContent = `Emergencia: incendio en la zona ${emergencia.zona}`;
  } else if (kpis.zonasAlerta > 0) {
    estado.dataset.nivel = 'alerta';
    estado.textContent = kpis.zonasAlerta === 1 ? '1 zona en alerta' : `${kpis.zonasAlerta} zonas en alerta`;
  } else {
    estado.dataset.nivel = 'normal';
    estado.textContent = simulacion.activa ? 'Operación normal' : 'Simulación detenida';
  }
  $('#k-valvulas').textContent = `${kpis.valvulasAbiertas} de ${kpis.zonas}`;
  const alerta = $('#k-alerta');
  alerta.textContent = String(kpis.zonasAlerta);
  alerta.dataset.alerta = kpis.zonasAlerta > 0 ? 'si' : 'no';
  $('#k-ciclo').textContent = simulacion.ciclos.toLocaleString('es-CO');
  $('#k-intervalo').textContent = `${simulacion.intervaloSeg} s`;

  $('#btn-simulacion').textContent = simulacion.activa ? 'Detener simulación' : 'Iniciar simulación';
  const auto = $('#chk-auto');
  if (document.activeElement !== auto) auto.checked = instantanea.config.modoAuto;

  const alarma = instantanea.eventos.find((e) => e.severidad === 'alarma' || e.severidad === 'critica');
  const destino = $('#ultima-alarma');
  if (alarma) destino.replaceChildren(el('strong', { texto: alarma.mensaje }), `${hora(alarma.tsMs)} · ${alarma.accion || ''}`);
  else destino.textContent = 'Ninguna desde el inicio.';
}

async function ejecutar(accion, textoExito) {
  try {
    const r = await accion();
    if (textoExito) avisar(textoExito);
    return r;
  } catch (error) {
    avisar(error.message, 'error');
    return null;
  }
}

export function iniciarPlanta(obtenerEstado) {
  $('#btn-simulacion').addEventListener('click', () => {
    const activa = obtenerEstado().instantanea?.simulacion.activa;
    ejecutar(() => api.simulacion(activa ? 'detener' : 'iniciar'), activa ? 'Simulación detenida.' : 'Simulación iniciada.');
  });
  $('#chk-auto').addEventListener('change', (evento) => {
    const activo = evento.target.checked;
    ejecutar(() => api.configurar({ modoAuto: activo }), activo ? 'Control automático encendido.' : 'Control automático apagado.');
  });
  for (const boton of $$('[data-todas]')) {
    boton.addEventListener('click', () => {
      const accion = boton.dataset.todas;
      const textos = { abrir: 'Todas las válvulas abiertas en mando manual.', cerrar: 'Todas las válvulas cerradas en mando manual.', auto: 'Todas las zonas en control automático.' };
      ejecutar(() => api.valvula('todas', accion), textos[accion]);
    });
  }
}

export function renderPlanta(estado) {
  if (!estado.instantanea) return;
  renderZonas(estado.instantanea);
  renderResumen(estado.instantanea);
}

export { ejecutar };
