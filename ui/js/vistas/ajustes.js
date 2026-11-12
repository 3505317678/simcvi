// Vista Ajustes: parámetros del proceso simulado. Node-RED valida de forma
// atómica; la interfaz solo adelanta las validaciones evidentes.

import { api } from '../api.js';
import { $, el, avisar, VARIABLES, NOMBRES } from '../util.js';

let sucio = false;
let obtener = null;

const formulario = () => $('#form-ajustes');

function campo(nombre) {
  return formulario().elements.namedItem(nombre);
}

function rellenar(config) {
  campo('zonas').value = config.zonas;
  campo('intervaloSeg').value = config.intervaloSeg;
  campo('probAnomaliaPct').value = config.probAnomaliaPct;
  campo('probIncendioPct').value = config.probIncendioPct;
  campo('modoAuto').checked = config.modoAuto;
  campo('ticksReapertura').value = config.ticksReapertura;
  for (const v of VARIABLES) {
    campo(`${v}.min`).value = config.rangos[v].min;
    campo(`${v}.max`).value = config.rangos[v].max;
  }
}

function mostrarErrores(errores) {
  const caja = $('#errores-ajustes');
  if (!errores.length) {
    caja.hidden = true;
    caja.replaceChildren();
    return;
  }
  caja.hidden = false;
  caja.replaceChildren(el('strong', { texto: 'No se guardaron los cambios:' }), el('ul', {}, errores.map((e) => el('li', { texto: e }))));
  caja.focus();
}

/** Lee el formulario y devuelve { cambios, errores } sin tocar el servidor. */
function leer() {
  const errores = [];
  const numero = (nombre, etiqueta) => {
    const entrada = campo(nombre);
    const texto = entrada.value.trim();
    if (texto === '') {
      errores.push(`${etiqueta}: escriba un valor.`);
      entrada.setAttribute('aria-invalid', 'true');
      return null;
    }
    const valor = Number(texto);
    const fuera = (entrada.min !== '' && valor < Number(entrada.min)) || (entrada.max !== '' && valor > Number(entrada.max));
    if (!Number.isFinite(valor) || fuera) {
      errores.push(`${etiqueta}: debe estar entre ${entrada.min} y ${entrada.max}.`);
      entrada.setAttribute('aria-invalid', 'true');
      return null;
    }
    entrada.removeAttribute('aria-invalid');
    return valor;
  };

  const cambios = {
    zonas: numero('zonas', 'Número de zonas'),
    intervaloSeg: numero('intervaloSeg', 'Intervalo'),
    probAnomaliaPct: numero('probAnomaliaPct', 'Probabilidad de anomalía'),
    probIncendioPct: numero('probIncendioPct', 'Probabilidad de incendio'),
    modoAuto: campo('modoAuto').checked,
    ticksReapertura: numero('ticksReapertura', 'Ciclos antes de reabrir'),
    rangos: {},
  };
  if (cambios.zonas !== null && !Number.isInteger(cambios.zonas)) errores.push('Número de zonas: debe ser un entero.');
  if (cambios.ticksReapertura !== null && !Number.isInteger(cambios.ticksReapertura)) errores.push('Ciclos antes de reabrir: debe ser un entero.');

  for (const v of VARIABLES) {
    const min = numero(`${v}.min`, `${NOMBRES[v]} mínima`);
    const max = numero(`${v}.max`, `${NOMBRES[v]} máxima`);
    if (min !== null && max !== null && min >= max) {
      errores.push(`${NOMBRES[v]}: el mínimo debe ser menor que el máximo.`);
      campo(`${v}.min`).setAttribute('aria-invalid', 'true');
    }
    cambios.rangos[v] = { min, max };
  }
  return { cambios, errores };
}

export function renderAjustes(estado) {
  const inst = estado.instantanea;
  if (!inst || sucio) return;
  rellenar(inst.config);
}

export function iniciarAjustes(obtenerEstado) {
  obtener = obtenerEstado;
  const form = formulario();
  form.addEventListener('input', () => { sucio = true; });
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const { cambios, errores } = leer();
    if (errores.length) {
      mostrarErrores(errores);
      return;
    }
    const boton = form.querySelector('[type="submit"]');
    boton.disabled = true;
    try {
      await api.configurar(cambios);
      sucio = false;
      mostrarErrores([]);
      avisar('Cambios guardados. Se aplican desde el próximo ciclo.');
    } catch (error) {
      mostrarErrores(error.detalles && error.detalles.length ? error.detalles : [error.message]);
    } finally {
      boton.disabled = false;
    }
  });
  $('#btn-descartar').addEventListener('click', () => {
    sucio = false;
    for (const entrada of form.querySelectorAll('[aria-invalid]')) entrada.removeAttribute('aria-invalid');
    mostrarErrores([]);
    renderAjustes(obtener());
  });
}
