// Vista Pruebas: ejecuta los escenarios EP-01 a EP-06 del informe y compara
// la respuesta esperada con la observada, junto con los indicadores de evaluación.

import { api } from '../api.js';
import { $, el, avisar, descargar, formatoMs, formatoNumero, VARIABLES, NOMBRES } from '../util.js';

const TOLERANCIA_RELOJ_MS = 1500;

const ESCENARIOS = [
  {
    id: 'EP-01', nombre: 'Operación normal',
    condicion: 'Todas las variables dentro de rango.',
    esperada: 'Válvulas abiertas, sin alarmas; lecturas almacenadas y visibles en los tableros.',
    indicador: 'Integridad del almacenamiento.',
  },
  {
    id: 'EP-02', nombre: 'Variable fuera de rango',
    condicion: 'Presión, temperatura o caudal fuera de los límites en una zona.',
    esperada: 'Alarma registrada y cierre automático de la válvula de la zona.',
    indicador: 'Tasa de detección, tasa de falsas alarmas y tiempo de respuesta.',
  },
  {
    id: 'EP-03', nombre: 'Retorno a la normalidad',
    condicion: 'La variable vuelve al rango de operación.',
    esperada: 'Reapertura automática o por el operador, según el modo configurado.',
    indicador: 'Tiempo de recuperación.',
  },
  {
    id: 'EP-04', nombre: 'Mando manual',
    condicion: 'El operador abre o cierra una válvula.',
    esperada: 'La orden del operador prevalece sobre el modo automático y queda registrada.',
    indicador: 'Trazabilidad de la acción en el registro.',
  },
  {
    id: 'EP-05', nombre: 'Incendio',
    condicion: 'Señal de incendio en una zona.',
    esperada: 'Parada de emergencia: cierre de todas las válvulas y bloqueo de la reapertura hasta el restablecimiento.',
    indicador: 'Tiempo de cierre total.',
  },
  {
    id: 'EP-06', nombre: 'Falla del almacenamiento',
    condicion: 'InfluxDB no disponible temporalmente.',
    esperada: 'La lógica de control sigue operando y se registra el error de escritura.',
    indicador: 'Continuidad del control y lecturas no almacenadas.',
  },
];

const ETIQUETAS_RESULTADO = { pendiente: 'Sin ejecutar', 'en-curso': 'En curso', cumple: 'Cumple', 'no-cumple': 'No cumple' };

let seleccionado = 'EP-01';
const corridas = {};
let obtener = null;
let firmaZonasDetalle = '';

const plazoMs = (inst) => (inst.config.intervaloSeg * 3 + 3) * 1000;
const buscar = (inst, filtro) => inst.eventos.find(filtro);
const zonaDe = (inst, id) => inst.zonas.find((z) => z.id === id);

/* ------------------------------------------------------------ evaluación */

const CICLOS_OBSERVACION = 10;

/**
 * EP-01 exige CICLOS_OBSERVACION ciclos consecutivos en operación normal.
 * Una válvula cerrada o InfluxDB sin escribir reinician la cuenta (la planta
 * puede estar terminando una reapertura); una alarma o una emergencia hacen
 * fallar la prueba. Si no se completa en el triple de ciclos, no cumple.
 */
function evaluarEP01(inst, c) {
  const alarma = buscar(inst, (e) => (e.tipo === 'alarma' || e.tipo === 'incendio') && e.tsMs >= c.inicioMs);
  if (alarma) return { resultado: 'no-cumple', texto: `Se registró una alarma durante la observación: ${alarma.mensaje}`, final: true };
  if (inst.emergencia.activa) return { resultado: 'no-cumple', texto: 'Hay una emergencia activa: restablézcala y repita la prueba.', final: true };
  if (!inst.simulacion.activa) return { resultado: 'en-curso', texto: 'La simulación está detenida: iníciela en la vista Planta para continuar la observación.' };

  const ciclos = inst.simulacion.ciclos;
  c.consecutivos ??= 0;
  c.ultimoCiclo ??= c.ciclosInicio;
  const cerradas = inst.zonas.filter((z) => z.valvula !== 'abierta').map((z) => z.id);
  const sinEscritura = inst.persistencia.estado !== 'ok';
  if (ciclos > c.ultimoCiclo) {
    c.consecutivos = cerradas.length || sinEscritura ? 0 : c.consecutivos + (ciclos - c.ultimoCiclo);
    c.ultimoCiclo = ciclos;
  }
  if (c.consecutivos >= CICLOS_OBSERVACION) {
    return {
      resultado: 'cumple',
      texto: `${CICLOS_OBSERVACION} ciclos consecutivos sin alarmas, con todas las válvulas abiertas y las lecturas almacenadas. Integridad del almacenamiento: ${formatoNumero(inst.metricas.integridadPct, 2)} %.`,
      final: true,
    };
  }
  if (ciclos - c.ciclosInicio > CICLOS_OBSERVACION * 3) {
    const motivo = cerradas.length ? `siguen cerradas las válvulas de las zonas ${cerradas.join(', ')} (use «Todas a automático» en la vista Planta)` : 'InfluxDB no confirma las escrituras';
    return { resultado: 'no-cumple', texto: `No se alcanzó la operación normal: ${motivo}.`, final: true };
  }
  if (cerradas.length) return { resultado: 'en-curso', texto: `Esperando a que se abran las válvulas de las zonas ${cerradas.join(', ')}…` };
  if (sinEscritura) return { resultado: 'en-curso', texto: 'Esperando a que InfluxDB confirme las escrituras…' };
  return { resultado: 'en-curso', texto: `Observando: ${c.consecutivos} de ${CICLOS_OBSERVACION} ciclos consecutivos en operación normal.` };
}

function evaluarEP02(inst, c) {
  const alarma = buscar(inst, (e) => e.tipo === 'alarma' && e.zona === c.zona && e.variable === c.variable && e.tsMs >= c.inicioMs);
  if (!alarma) {
    return Date.now() - c.enviadoMs > plazoMs(inst)
      ? { resultado: 'no-cumple', texto: 'No se registró la alarma esperada.', final: true }
      : { resultado: 'en-curso', texto: 'Esperando el próximo ciclo de control…' };
  }
  const zona = zonaDe(inst, c.zona);
  const esperaCierre = inst.config.modoAuto && !c.overrideAlInicio;
  if (!esperaCierre) {
    return { resultado: 'cumple', texto: `Alarma registrada (${alarma.accion}). Sin cierre porque el control automático no actúa en esta zona.`, final: true };
  }
  const cierre = buscar(inst, (e) => e.tipo === 'cierre_auto' && e.zona === c.zona && e.tsMs >= c.inicioMs);
  if (cierre) {
    return { resultado: 'cumple', texto: `Alarma registrada y válvula cerrada automáticamente. Tiempo de decisión: ${formatoMs(cierre.tiempoRespuestaMs)}.`, final: true, cierreMs: cierre.tsMs };
  }
  return zona && zona.valvula === 'cerrada'
    ? { resultado: 'cumple', texto: 'Alarma registrada; la válvula ya estaba cerrada.', final: true }
    : { resultado: 'no-cumple', texto: 'La alarma se registró pero la válvula no se cerró.', final: true };
}

function evaluarEP03(inst) {
  const previa = corridas['EP-02'];
  if (!previa || !previa.evaluacion || previa.evaluacion.resultado !== 'cumple' || !previa.evaluacion.cierreMs) {
    return { resultado: 'pendiente', texto: 'Ejecute primero EP-02 con el control automático encendido; esta prueba observa la reapertura de esa zona.' };
  }
  const apertura = buscar(inst, (e) => e.tipo === 'apertura_auto' && e.zona === previa.zona && e.tsMs >= previa.evaluacion.cierreMs);
  if (apertura) {
    const segundos = (apertura.tsMs - previa.evaluacion.cierreMs) / 1000;
    return { resultado: 'cumple', texto: `${apertura.mensaje} Tiempo de recuperación: ${formatoNumero(segundos, 1)} s.`, final: true };
  }
  const zona = zonaDe(inst, previa.zona);
  if (zona && zona.override) return { resultado: 'en-curso', texto: 'La zona está en mando manual: la reapertura depende del operador.' };
  return { resultado: 'en-curso', texto: `Esperando ${inst.config.ticksReapertura} ciclos normales consecutivos en la zona ${previa.zona}…` };
}

function evaluarEP04(inst, c) {
  const evento = buscar(inst, (e) => e.tipo === 'mando_manual' && e.zona === c.zona && e.accion === c.accion && e.tsMs >= c.inicioMs);
  const zona = zonaDe(inst, c.zona);
  const esperado = c.accion === 'abrir' ? 'abierta' : 'cerrada';
  if (evento && zona && zona.override === esperado && zona.valvula === esperado) {
    return { resultado: 'cumple', texto: `Válvula ${esperado} por orden del operador y registrada a las ${new Date(evento.tsMs).toLocaleTimeString('es-CO')}. El control automático no la modifica mientras siga en mando manual.`, final: true };
  }
  if (Date.now() - c.enviadoMs > 4000) return { resultado: 'no-cumple', texto: 'No se observó la orden manual en el estado o en el registro.', final: true };
  return { resultado: 'en-curso', texto: 'Esperando la confirmación de Node-RED…' };
}

function evaluarEP05(inst, c) {
  const incendio = buscar(inst, (e) => e.tipo === 'incendio' && e.zona === c.zona && e.tsMs >= c.inicioMs);
  if (!incendio) {
    return Date.now() - c.enviadoMs > plazoMs(inst)
      ? { resultado: 'no-cumple', texto: 'No se registró la detección del incendio.', final: true }
      : { resultado: 'en-curso', texto: 'Esperando el próximo ciclo de control…' };
  }
  const todasCerradas = inst.zonas.every((z) => z.valvula === 'cerrada');
  if (inst.emergencia.activa && todasCerradas) {
    return { resultado: 'cumple', texto: `Parada de emergencia: ${inst.zonas.length} válvulas cerradas. Tiempo de cierre total: ${formatoMs(incendio.tiempoRespuestaMs)}. Intente abrir una válvula: Node-RED lo rechazará hasta restablecer.`, final: true };
  }
  return { resultado: 'no-cumple', texto: 'Se detectó el incendio pero no todas las válvulas quedaron cerradas.', final: true };
}

function evaluarEP06(inst, c) {
  const p = inst.persistencia;
  if (p.estado === 'error' && !c.errorDesde) c.errorDesde = { ciclos: inst.simulacion.ciclos, fallidas: p.escriturasFallidas };
  if (c.errorDesde && p.estado === 'error') {
    const ciclos = inst.simulacion.ciclos - c.errorDesde.ciclos;
    return { resultado: 'en-curso', texto: `InfluxDB no disponible: el control sigue operando (${ciclos} ciclos sin almacenar). Vuelva a iniciarlo para terminar la prueba.` };
  }
  if (c.errorDesde && p.estado === 'ok') {
    return {
      resultado: 'cumple',
      texto: `El control no se interrumpió. Escrituras fallidas: ${p.escriturasFallidas}. Integridad del almacenamiento: ${formatoNumero(inst.metricas.integridadPct, 2)} %.`,
      final: true,
    };
  }
  return { resultado: 'en-curso', texto: 'Observando… Detenga InfluxDB con el comando del paso 1.' };
}

const EVALUADORES = { 'EP-01': evaluarEP01, 'EP-02': evaluarEP02, 'EP-03': evaluarEP03, 'EP-04': evaluarEP04, 'EP-05': evaluarEP05, 'EP-06': evaluarEP06 };

function evaluar(id, inst) {
  // EP-03 no tiene parámetros propios: observa la zona cerrada en EP-02.
  if (id === 'EP-03') {
    if (corridas[id]?.evaluacion?.final) return corridas[id].evaluacion;
    const evaluacion = evaluarEP03(inst);
    corridas[id] = { evaluacion };
    return evaluacion;
  }
  const corrida = corridas[id];
  if (!corrida) return { resultado: 'pendiente', texto: 'Sin ejecutar.' };
  if (corrida.evaluacion && corrida.evaluacion.final) return corrida.evaluacion;
  corrida.evaluacion = EVALUADORES[id](inst, corrida);
  return corrida.evaluacion;
}

/* ------------------------------------------------------------ controles */

function selectZonas(nombre, zonas) {
  return el('label', { clase: 'campo' }, 'Zona', el('select', { name: nombre }, zonas.map((z) => el('option', { value: z.id, texto: `Zona ${z.id}` }))));
}

function valorDe(nombre) {
  return $(`#detalle-escenario [name="${nombre}"]`).value;
}

async function ejecutar(id, accion, datos) {
  const enviadoMs = Date.now();
  try {
    await accion();
    corridas[id] = { ...datos, enviadoMs, inicioMs: enviadoMs - TOLERANCIA_RELOJ_MS, evaluacion: null };
    if (id === 'EP-02') corridas['EP-03'] = null;
  } catch (error) {
    avisar(error.message, 'error');
  }
  renderPruebas(obtener());
}

function controles(id, inst) {
  const zonas = inst.zonas;
  switch (id) {
    case 'EP-01':
      return el('div', { clase: 'parametros' },
        el('p', { texto: `Pone en 0 % las probabilidades de anomalía e incendio y observa ${CICLOS_OBSERVACION} ciclos consecutivos.` }),
        el('button', { clase: 'boton boton--principal', type: 'button', texto: 'Iniciar observación', onclick: () => {
          const ciclosInicio = obtener().instantanea.simulacion.ciclos;
          ejecutar('EP-01', () => api.configurar({ probAnomaliaPct: 0, probIncendioPct: 0 }), { ciclosInicio });
        } }));
    case 'EP-02':
      return el('div', { clase: 'parametros' },
        selectZonas('zona', zonas),
        el('label', { clase: 'campo' }, 'Variable', el('select', { name: 'variable' }, VARIABLES.map((v) => el('option', { value: v, texto: NOMBRES[v] })))),
        el('label', { clase: 'campo' }, 'Dirección', el('select', { name: 'direccion' }, el('option', { value: 'alta', texto: 'Por encima del máximo' }), el('option', { value: 'baja', texto: 'Por debajo del mínimo' }))),
        el('button', { clase: 'boton boton--principal', type: 'button', texto: 'Inyectar anomalía', onclick: () => {
          const zona = Number(valorDe('zona'));
          const variable = valorDe('variable');
          const zonaActual = zonaDe(obtener().instantanea, zona);
          ejecutar('EP-02', () => api.anomalia(zona, variable, valorDe('direccion')), { zona, variable, overrideAlInicio: Boolean(zonaActual && zonaActual.override) });
        } }));
    case 'EP-04':
      return el('div', { clase: 'parametros' },
        selectZonas('zona', zonas),
        el('label', { clase: 'campo' }, 'Orden', el('select', { name: 'accion' }, el('option', { value: 'cerrar', texto: 'Cerrar válvula' }), el('option', { value: 'abrir', texto: 'Abrir válvula' }))),
        el('button', { clase: 'boton boton--principal', type: 'button', texto: 'Enviar orden manual', onclick: () => {
          const zona = Number(valorDe('zona'));
          const accion = valorDe('accion');
          ejecutar('EP-04', () => api.valvula(zona, accion), { zona, accion });
        } }),
        el('button', { clase: 'boton', type: 'button', texto: 'Devolver la zona a automático', onclick: async () => {
          try { await api.valvula(Number(valorDe('zona')), 'auto'); avisar('Zona devuelta al control automático.'); } catch (e) { avisar(e.message, 'error'); }
        } }));
    case 'EP-05':
      return el('div', { clase: 'parametros' },
        selectZonas('zona', zonas),
        el('button', { clase: 'boton boton--principal', type: 'button', texto: 'Simular incendio', onclick: () => {
          const zona = Number(valorDe('zona'));
          ejecutar('EP-05', () => api.incendio(zona), { zona });
        } }),
        el('button', { clase: 'boton', type: 'button', texto: 'Restablecer emergencia', onclick: async () => {
          try { await api.restablecerEmergencia(); avisar('Emergencia restablecida.'); } catch (e) { avisar(e.message, 'error'); }
        } }));
    case 'EP-06':
      return el('div', { clase: 'parametros' },
        el('ol', { clase: 'pasos' },
          el('li', {}, 'Pulse «Iniciar observación» y, en una terminal dentro de la carpeta del proyecto, ejecute ', el('code', { texto: 'docker compose stop influxdb' }), '.'),
          el('li', {}, 'Observe que la planta sigue operando y que el estado de InfluxDB cambia a sin conexión.'),
          el('li', {}, 'Ejecute ', el('code', { texto: 'docker compose start influxdb' }), ' y espere a que la escritura se restablezca.')),
        el('button', { clase: 'boton boton--principal', type: 'button', texto: 'Iniciar observación', onclick: () => ejecutar('EP-06', async () => {}, {}) }));
    default:
      return el('div', { clase: 'parametros' }, el('p', { texto: 'Esta prueba observa el resultado de EP-02; no requiere parámetros.' }));
  }
}

/* ------------------------------------------------------------ render */

function renderIndicadores(m) {
  const tr = m.tiempoRespuesta;
  const tc = m.tiempoCierreTotal;
  const datos = [
    ['Tasa de detección', m.tasaDeteccionPct === null ? '–' : `${formatoNumero(m.tasaDeteccionPct, 1)} %`, `${m.anomaliasDetectadas} de ${m.anomaliasDetectadas + m.anomaliasNoDetectadas} anomalías`, m.tasaDeteccionPct !== null && m.tasaDeteccionPct < 100],
    ['Falsas alarmas', m.tasaFalsasAlarmasPct === null ? '–' : `${formatoNumero(m.tasaFalsasAlarmasPct, 1)} %`, `${m.falsasAlarmas} de ${m.alarmasEmitidas} alarmas`, m.falsasAlarmas > 0],
    ['Tiempo de respuesta', formatoMs(tr.mediaMs), tr.n ? `n = ${tr.n} · desv. ${formatoMs(tr.desvMs)} · p95 ${formatoMs(tr.p95Ms)}` : 'sin cierres automáticos', false],
    ['Cierre total ante incendio', formatoMs(tc.mediaMs), tc.n ? `n = ${tc.n} · máx. ${formatoMs(tc.maxMs)}` : 'sin incendios', false],
    ['Integridad del almacenamiento', m.integridadPct === null ? '–' : `${formatoNumero(m.integridadPct, 2)} %`, 'líneas escritas / enviadas', m.integridadPct !== null && m.integridadPct < 100],
  ];
  $('#indicadores').replaceChildren(...datos.map(([nombre, valor, detalle, alerta]) => el('div', { clase: 'indicador', datos: { alerta: alerta ? 'si' : 'no' } },
    el('p', { clase: 'indicador__nombre', texto: nombre }),
    el('p', { clase: 'indicador__valor', texto: valor }),
    el('p', { clase: 'indicador__detalle', texto: detalle }))));
}

function renderLista(inst) {
  const lista = $('#lista-escenarios');
  if (!lista.children.length) {
    lista.replaceChildren(...ESCENARIOS.map((esc) => el('li', {}, el('button', {
      type: 'button',
      datos: { escenario: esc.id },
      onclick: () => { seleccionado = esc.id; firmaZonasDetalle = ''; renderPruebas(obtener()); },
    }, el('span', { clase: 'escenarios__id', texto: esc.id }), el('span', { texto: esc.nombre }), el('span', { clase: 'resultado' })))));
  }
  for (const boton of lista.querySelectorAll('button')) {
    const id = boton.dataset.escenario;
    const evaluacion = evaluar(id, inst);
    boton.setAttribute('aria-current', id === seleccionado ? 'true' : 'false');
    const etiqueta = boton.querySelector('.resultado');
    etiqueta.dataset.resultado = evaluacion.resultado;
    etiqueta.textContent = ETIQUETAS_RESULTADO[evaluacion.resultado];
  }
}

function renderDetalle(inst) {
  const contenedor = $('#detalle-escenario');
  const esc = ESCENARIOS.find((e) => e.id === seleccionado);
  const firma = `${seleccionado}|${inst.zonas.map((z) => z.id).join(',')}`;
  if (firma !== firmaZonasDetalle) {
    firmaZonasDetalle = firma;
    contenedor.replaceChildren(
      el('h2', { texto: `${esc.id} · ${esc.nombre}` }),
      el('dl', { clase: 'ficha' },
        el('dt', { texto: 'Condición simulada' }), el('dd', { texto: esc.condicion }),
        el('dt', { texto: 'Respuesta esperada' }), el('dd', { texto: esc.esperada }),
        el('dt', { texto: 'Indicador' }), el('dd', { texto: esc.indicador })),
      controles(esc.id, inst),
      el('div', { clase: 'observacion', id: 'observacion' }));
  }
  const evaluacion = evaluar(esc.id, inst);
  const observacion = $('#observacion');
  observacion.dataset.resultado = evaluacion.resultado;
  const hijos = [el('strong', { texto: `${ETIQUETAS_RESULTADO[evaluacion.resultado]}. ` }), evaluacion.texto];
  if (evaluacion.condiciones) {
    hijos.push(el('ul', { clase: 'pasos' }, evaluacion.condiciones.map(([texto, ok]) => el('li', { texto: `${ok ? 'Sí' : 'No'}: ${texto}` }))));
  }
  observacion.replaceChildren(...hijos);
}

export function renderPruebas(estado) {
  const inst = estado.instantanea;
  if (!inst) return;
  renderIndicadores(inst.metricas);
  renderLista(inst);
  renderDetalle(inst);
}

export function iniciarPruebas(obtenerEstado) {
  obtener = obtenerEstado;
  $('#btn-reiniciar-metricas').addEventListener('click', async () => {
    try {
      await api.reiniciarMetricas();
      avisar('Métricas reiniciadas.');
    } catch (error) {
      avisar(error.message, 'error');
    }
  });
  $('#btn-exportar-metricas').addEventListener('click', () => {
    const inst = obtener().instantanea;
    if (!inst) return;
    const resultados = ESCENARIOS.map((esc) => ({ id: esc.id, nombre: esc.nombre, ...evaluar(esc.id, inst), parametros: corridas[esc.id] || null }));
    const informe = {
      generado: new Date().toISOString(),
      version: inst.version,
      configuracion: inst.config,
      metricas: inst.metricas,
      persistencia: inst.persistencia,
      escenarios: resultados,
    };
    descargar(`simcvi-resultados-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`, JSON.stringify(informe, null, 2), 'application/json');
  });
}
