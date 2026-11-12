// Válvula de compuerta con volante, vástago roscado ascendente y visor de flujo.
// Solo dibuja y anima: el estado real lo decide Node-RED.
//
// Animaciones (definidas en app.css, bloque «válvula»):
//  - el vástago sube al abrir y baja al cerrar (carrera de CARRERA_MS);
//  - el volante gira mientras dura la carrera;
//  - la rueda del visor gira solo cuando hay caudal.
// Con «reducir movimiento» activado en el sistema, todo queda estático.

/** Duración de la carrera visual (ms). Debe coincidir con --carrera en app.css. */
export const CARRERA_MS = 1400;

/**
 * Marcado del dibujo. Los ids de los degradados llevan el número de zona para no
 * chocar entre válvulas. No recibe datos externos: solo el id numérico de la zona.
 */
function dibujo(p) {
  const tuerca = (x, y) => `<circle cx="${x}" cy="${y}" r="3.6" fill="url(#${p}tuerca)" stroke="#3f454b" stroke-width=".6"/>`;
  const brida = (x) => `<rect x="${x}" y="132" width="14" height="70" rx="2" fill="url(#${p}vert)" stroke="#3f454b"/>${tuerca(x + 7, 140)}${tuerca(x + 7, 194)}`;
  const radios = [0, 60, 120].map((a) => `<rect x="-40" y="-2.2" width="80" height="4.4" rx="2" fill="#7a2a2a" transform="rotate(${a})"/>`).join('');
  const palas = [0, 60, 120].map((a) => `<rect x="-1.5" y="-12" width="3" height="24" rx="1" fill="#2a3036" transform="rotate(${a})"/>`).join('');
  return `
  <defs>
    <linearGradient id="${p}tubo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4c535a"/><stop offset=".28" stop-color="#b9bfc5"/><stop offset=".42" stop-color="#eef0f2"/>
      <stop offset=".62" stop-color="#9aa1a8"/><stop offset="1" stop-color="#3f454b"/></linearGradient>
    <linearGradient id="${p}vert" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4c535a"/><stop offset=".3" stop-color="#bfc5ca"/><stop offset=".45" stop-color="#f1f3f4"/>
      <stop offset=".7" stop-color="#9aa1a8"/><stop offset="1" stop-color="#3f454b"/></linearGradient>
    <radialGradient id="${p}fund" cx=".38" cy=".3" r=".8">
      <stop offset="0" stop-color="#e9ecee"/><stop offset=".35" stop-color="#a9b0b6"/><stop offset=".8" stop-color="#6b737b"/><stop offset="1" stop-color="#454b51"/></radialGradient>
    <radialGradient id="${p}tuerca" cx=".35" cy=".35" r=".8">
      <stop offset="0" stop-color="#f2f4f5"/><stop offset=".6" stop-color="#8a929a"/><stop offset="1" stop-color="#3f454b"/></radialGradient>
    <linearGradient id="${p}vastago" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6b737b"/><stop offset=".45" stop-color="#f7f8f9"/><stop offset="1" stop-color="#7a828a"/></linearGradient>
    <pattern id="${p}rosca" width="6" height="3" patternUnits="userSpaceOnUse"><rect width="6" height="1.2" fill="#000" opacity=".22"/></pattern>
    <linearGradient id="${p}vidrio" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#dfe9f0"/><stop offset=".5" stop-color="#9fb6c6"/><stop offset="1" stop-color="#6d8799"/></linearGradient>
    <filter id="${p}sombra" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#000" flood-opacity=".28"/></filter>
  </defs>
  <!-- tubería -->
  <rect x="96" y="150" width="274" height="34" fill="url(#${p}tubo)" stroke="#3f454b" stroke-width=".8"/>
  <g filter="url(#${p}sombra)">
    ${brida(110)}${brida(256)}
    <!-- cuerpo fundido -->
    <path d="M124 145 C130 120 160 112 190 112 C220 112 250 120 256 145 L256 190 C250 214 220 222 190 222 C160 222 130 214 124 190 Z" fill="url(#${p}fund)" stroke="#3f454b" stroke-width="1.2"/>
    <path d="M140 132 C155 121 175 118 190 118" stroke="#fff" stroke-width="3" fill="none" opacity=".55" stroke-linecap="round"/>
    <!-- brida del bonete, bonete y yugo -->
    <rect x="152" y="100" width="76" height="16" rx="3" fill="url(#${p}vert)" stroke="#3f454b"/>
    ${tuerca(160, 108)}${tuerca(220, 108)}
    <path d="M166 100 L170 68 L210 68 L214 100 Z" fill="url(#${p}vert)" stroke="#3f454b"/>
    <path d="M172 68 L176 26 M208 68 L204 26" stroke="#59616a" stroke-width="7" stroke-linecap="round"/>
    <rect x="168" y="20" width="44" height="10" rx="3" fill="url(#${p}vert)" stroke="#3f454b"/>
  </g>
  <!-- vástago roscado: sube 44 unidades al abrir -->
  <g class="valvula__vastago">
    <rect x="185" y="2" width="10" height="70" fill="url(#${p}vastago)" stroke="#59616a" stroke-width=".6"/>
    <rect x="185" y="2" width="10" height="70" fill="url(#${p}rosca)"/>
    <rect x="183" y="0" width="14" height="5" rx="1.5" fill="#59616a"/>
  </g>
  <!-- volante en perspectiva: los radios giran durante la carrera -->
  <g transform="translate(190 18) scale(1 .28)">
    <g class="valvula__radios">${radios}</g>
    <circle r="44" fill="none" stroke="#5a1f1f" stroke-width="14"/>
    <circle r="44" fill="none" stroke="#a33a3a" stroke-width="9"/>
    <circle r="44" fill="none" stroke="#d27070" stroke-width="2" transform="translate(0 -3)" opacity=".7"/>
    <circle r="9" fill="url(#${p}tuerca)" stroke="#3f454b"/>
  </g>
  <!-- visor de flujo: la rueda gira solo si hay caudal -->
  <rect x="304" y="140" width="52" height="54" rx="6" fill="url(#${p}vert)" stroke="#3f454b"/>
  ${tuerca(311, 146)}${tuerca(349, 146)}${tuerca(311, 188)}${tuerca(349, 188)}
  <circle cx="330" cy="167" r="17" fill="url(#${p}vidrio)" stroke="#3f454b" stroke-width="2"/>
  <g transform="translate(330 167)">
    <g class="valvula__visor">${palas}</g>
    <circle r="3" fill="#cfd5da" stroke="#2a3036"/>
  </g>
  <path d="M320 155 q6 -4 14 -1" stroke="#fff" stroke-width="2.4" fill="none" opacity=".7" stroke-linecap="round"/>
  <!-- mando manual -->
  <g class="valvula__manual">
    <rect x="232" y="-10" width="34" height="30" rx="4"/>
    <text x="249" y="13" text-anchor="middle">M</text>
  </g>`;
}

/**
 * Crea la válvula de una zona.
 * @param {number} id número de la zona (solo se usa para los ids internos del SVG)
 * @returns {SVGSVGElement}
 */
export function crearValvula(id) {
  const nodo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  nodo.setAttribute('class', 'valvula');
  nodo.setAttribute('viewBox', '96 -48 274 274');
  nodo.setAttribute('aria-hidden', 'true');
  nodo.setAttribute('focusable', 'false');
  nodo.innerHTML = dibujo(`v${Number(id)}-`); // marcado fijo, sin datos de usuario
  return nodo;
}

/**
 * Lleva la válvula al estado indicado. Si la posición cambia, marca la carrera para
 * que el CSS anime vástago y volante durante CARRERA_MS.
 * @param {SVGSVGElement} nodo
 * @param {{ abierta: boolean, fluye: boolean, manual: boolean }} estado
 */
export function actualizarValvula(nodo, { abierta, fluye, manual }) {
  const anterior = nodo.dataset.posicion;
  const posicion = abierta ? 'abierta' : 'cerrada';
  nodo.dataset.posicion = posicion;
  nodo.dataset.fluye = fluye ? 'si' : 'no';
  nodo.dataset.manual = manual ? 'si' : 'no';

  // Primer dibujo: sin animación, la válvula aparece ya en su posición.
  if (anterior === undefined || anterior === posicion) return;

  nodo.dataset.carrera = abierta ? 'abriendo' : 'cerrando';
  clearTimeout(nodo._finCarrera);
  nodo._finCarrera = setTimeout(() => { delete nodo.dataset.carrera; }, CARRERA_MS);
}
