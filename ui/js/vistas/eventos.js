// Vista Eventos: registro filtrable de alarmas, acciones de control y órdenes.

import { $, el, csv, descargar, fechaYHora, formatoMs } from '../util.js';

const SEVERIDADES = { critica: 'Crítica', alarma: 'Alarma', aviso: 'Aviso', info: 'Información' };
let firmaZonas = '';

function filtrar(eventos) {
  const severidad = $('#f-severidad').value;
  const zona = $('#f-zona').value;
  const texto = $('#f-texto').value.trim().toLowerCase();
  return eventos.filter((e) => (!severidad || e.severidad === severidad)
    && (!zona || String(e.zona) === zona)
    && (!texto || `${e.mensaje} ${e.accion || ''}`.toLowerCase().includes(texto)));
}

function renderOpcionesZona(zonas) {
  const firma = zonas.map((z) => z.id).join(',');
  if (firma === firmaZonas) return;
  firmaZonas = firma;
  const select = $('#f-zona');
  const actual = select.value;
  select.replaceChildren(el('option', { value: '', texto: 'Todas' }), ...zonas.map((z) => el('option', { value: z.id, texto: `Zona ${z.id}` })));
  select.value = zonas.some((z) => String(z.id) === actual) ? actual : '';
}

export function renderEventos(estado) {
  const inst = estado.instantanea;
  if (!inst) return;
  renderOpcionesZona(inst.zonas);
  const eventos = filtrar(inst.eventos);
  const cuerpo = $('#tabla-eventos');
  if (!eventos.length) {
    cuerpo.replaceChildren(el('tr', {}, el('td', { colspan: 6, clase: 'vacio', texto: 'No hay eventos con estos filtros.' })));
    return;
  }
  cuerpo.replaceChildren(...eventos.map((e) => el('tr', {},
    el('td', {}, el('time', { datetime: e.ts, texto: fechaYHora(e.tsMs) })),
    el('td', {}, el('span', { clase: 'severidad', datos: { nivel: e.severidad }, texto: SEVERIDADES[e.severidad] || e.severidad })),
    el('td', { texto: e.zona ? `Zona ${e.zona}` : 'Sistema' }),
    el('td', { texto: e.mensaje }),
    el('td', { texto: e.accion && !['abrir', 'cerrar', 'auto'].includes(e.accion) ? e.accion : '' }),
    el('td', { clase: 'num', texto: Number.isFinite(e.tiempoRespuestaMs) ? formatoMs(e.tiempoRespuestaMs) : '' }))));
}

export function iniciarEventos(obtenerEstado) {
  for (const id of ['#f-severidad', '#f-zona', '#f-texto']) {
    $(id).addEventListener('input', () => renderEventos(obtenerEstado()));
  }
  $('#btn-exportar-eventos').addEventListener('click', () => {
    const inst = obtenerEstado().instantanea;
    if (!inst) return;
    const filas = [['id', 'fecha_iso', 'severidad', 'zona', 'tipo', 'origen', 'variable', 'valor', 'limite', 'accion', 'tiempo_respuesta_ms', 'mensaje']];
    for (const e of filtrar(inst.eventos)) {
      filas.push([e.id, e.ts, e.severidad, e.zona ?? '', e.tipo, e.origen, e.variable ?? '', e.valor ?? '', e.limite ?? '', e.accion ?? '', e.tiempoRespuestaMs ?? '', e.mensaje]);
    }
    descargar(`simcvi-eventos-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.csv`, `﻿${csv(filas)}`, 'text/csv;charset=utf-8');
  });
}
