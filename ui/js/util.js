// Utilidades compartidas: creación segura de elementos, formato y avisos.
// Todo texto se inserta con textContent: nunca se interpreta como HTML.

export const VARIABLES = ['presion', 'temperatura', 'caudal'];
export const NOMBRES = { presion: 'Presión', temperatura: 'Temperatura', caudal: 'Caudal' };
export const UNIDADES = { presion: 'bar', temperatura: '°C', caudal: 'L/min' };
const DECIMALES = { presion: 2, temperatura: 1, caudal: 1 };

const SVG_NS = 'http://www.w3.org/2000/svg';

export const $ = (selector, raiz = document) => raiz.querySelector(selector);
export const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

function aplicar(nodo, atributos) {
  for (const [clave, valor] of Object.entries(atributos || {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === 'texto') nodo.textContent = valor;
    else if (clave === 'clase') nodo.setAttribute('class', valor);
    else if (clave.startsWith('on') && typeof valor === 'function') nodo.addEventListener(clave.slice(2), valor);
    else if (clave === 'datos') for (const [k, v] of Object.entries(valor)) nodo.dataset[k] = v;
    else nodo.setAttribute(clave, valor === true ? '' : String(valor));
  }
}

function agregar(nodo, hijos) {
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
}

/** Crea un elemento HTML: el('p', { clase: 'x', texto: 'hola' }, hijo1, hijo2) */
export function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  aplicar(nodo, atributos);
  agregar(nodo, hijos);
  return nodo;
}

/** Igual que el(), pero para SVG. */
export function svg(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElementNS(SVG_NS, etiqueta);
  aplicar(nodo, atributos);
  agregar(nodo, hijos);
  return nodo;
}

const numero = new Map();
function formateador(decimales) {
  if (!numero.has(decimales)) {
    numero.set(decimales, new Intl.NumberFormat('es-CO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }));
  }
  return numero.get(decimales);
}

export function formatoNumero(valor, decimales = 1) {
  return Number.isFinite(valor) ? formateador(decimales).format(valor) : '–';
}

export function formatoVariable(variable, valor) {
  return formatoNumero(valor, DECIMALES[variable] ?? 1);
}

export function formatoMs(valor) {
  if (!Number.isFinite(valor)) return '–';
  if (valor < 1) return `${formatoNumero(valor * 1000, 0)} µs`;
  if (valor < 1000) return `${formatoNumero(valor, valor < 10 ? 2 : 0)} ms`;
  return `${formatoNumero(valor / 1000, 1)} s`;
}

const reloj = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fechaHora = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const hora = (ms) => (Number.isFinite(ms) ? reloj.format(new Date(ms)) : '–');
export const fechaYHora = (ms) => (Number.isFinite(ms) ? fechaHora.format(new Date(ms)) : '–');

/** Aviso breve en la esquina; los errores duran más. */
export function avisar(texto, tipo = 'info') {
  const contenedor = document.getElementById('avisos');
  const nodo = el('div', { clase: 'aviso', datos: { tipo } }, texto);
  contenedor.append(nodo);
  setTimeout(() => nodo.remove(), tipo === 'error' ? 7000 : 3500);
}

export function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const enlace = el('a', { href: url, download: nombre });
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csv(filas) {
  const celda = (valor) => {
    const texto = valor === null || valor === undefined ? '' : String(valor);
    return /[",\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  return filas.map((fila) => fila.map(celda).join(',')).join('\n');
}

/** Escala un valor al porcentaje de la pista: rango ± 50 % de su amplitud. */
export function posicionEnPista(valor, rango) {
  const amplitud = rango.max - rango.min;
  const desde = rango.min - amplitud * 0.5;
  const hasta = rango.max + amplitud * 0.5;
  const pos = ((valor - desde) / (hasta - desde)) * 100;
  return Math.min(100, Math.max(0, pos));
}

export const leerVariableCss = (nombre) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
