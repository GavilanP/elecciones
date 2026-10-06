#!/usr/bin/env node
// Comprueba que los datos de datos/ (y datos/ejemplo/) están bien formados:
// ids válidos, partidos conocidos, posturas y votos permitidos y, sobre todo,
// que cada posición documentada tiene fuente.
//
// Uso: node scripts/validar.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, CORE_SCHEMA } from '../assets/vendor/js-yaml.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const POSTURAS = ['a_favor', 'en_contra', 'matizada', 'no_se_pronuncia'];
const TIPOS_PREGUNTA = ['si_no', 'abierta'];
const TIPOS_FUENTE = ['programa', 'declaracion', 'votacion', 'otro'];
const VOTOS = ['si', 'no', 'abstencion', 'dividido', 'no_presente'];
const TIPOS_VOTACION = ['votacion_final', 'toma_en_consideracion', 'enmienda_totalidad', 'convalidacion', 'mocion', 'otra'];
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const URL_OK = /^https?:\/\/\S+$/;

let errores = 0;
let avisos = 0;
const error = (donde, msg) => { errores++; console.error(`  ✗ ${donde}: ${msg}`); };
const aviso = (donde, msg) => { avisos++; console.warn(`  ! ${donde}: ${msg}`); };

function leer(ruta) {
  const completa = join(RAIZ, ruta);
  if (!existsSync(completa)) { error(ruta, 'el fichero no existe'); return undefined; }
  try {
    return load(readFileSync(completa, 'utf8'), { schema: CORE_SCHEMA });
  } catch (e) {
    error(ruta, `YAML inválido: ${e.message.split('\n')[0]}`);
    return undefined;
  }
}

const esTexto = (v) => typeof v === 'string' && v.trim() !== '';
const fechaValida = (v) => typeof v === 'string' && FECHA.test(v) && !Number.isNaN(Date.parse(v));

function validarFuente(donde, fuente, obligatoria) {
  if (fuente == null) {
    if (obligatoria) error(donde, 'falta `fuente` (toda posición documentada necesita una)');
    return;
  }
  if (!TIPOS_FUENTE.includes(fuente.tipo)) error(donde, `fuente.tipo debe ser uno de: ${TIPOS_FUENTE.join(', ')}`);
  if (!esTexto(fuente.titulo)) error(donde, 'falta fuente.titulo');
  if (!URL_OK.test(fuente.url ?? '')) error(donde, 'fuente.url debe ser un enlace http(s)');
  if (fuente.fecha != null && !fechaValida(fuente.fecha)) error(donde, 'fuente.fecha debe tener formato AAAA-MM-DD');
  if (fuente.tipo === 'declaracion' && fuente.fecha == null) aviso(donde, 'una declaración debería llevar fuente.fecha');
}

function validarConjunto(base) {
  console.log(`\nValidando ${base}/`);

  const meta = leer(`${base}/meta.yml`) ?? {};
  if (!esTexto(meta.elecciones)) error(`${base}/meta.yml`, 'falta `elecciones`');
  if (meta.fecha_votacion != null && !fechaValida(meta.fecha_votacion)) error(`${base}/meta.yml`, 'fecha_votacion debe ser AAAA-MM-DD');
  if (!fechaValida(meta.actualizado)) error(`${base}/meta.yml`, 'actualizado debe ser AAAA-MM-DD');

  const rutaPartidos = `${base}/partidos.yml`;
  const partidos = leer(rutaPartidos) ?? [];
  if (!Array.isArray(partidos)) error(rutaPartidos, 'debe ser una lista');
  const idsPartido = new Set();
  for (const [i, p] of (Array.isArray(partidos) ? partidos : []).entries()) {
    const donde = `${rutaPartidos} [${p?.id ?? i}]`;
    if (!ID.test(p?.id ?? '')) error(donde, 'id inválido (minúsculas, números y guiones)');
    else if (idsPartido.has(p.id)) error(donde, 'id repetido');
    idsPartido.add(p?.id);
    if (!esTexto(p?.nombre)) error(donde, 'falta nombre');
    if (!esTexto(p?.siglas)) error(donde, 'faltan siglas');
    if (!/^#[0-9a-fA-F]{6}$/.test(p?.color ?? '')) error(donde, 'color debe ser hexadecimal, p. ej. "#777777"');
    for (const campo of ['web', 'programa']) {
      if (p?.[campo] != null && !URL_OK.test(p[campo])) error(donde, `${campo} debe ser un enlace http(s)`);
    }
  }

  const rutaIndice = `${base}/temas.yml`;
  const indice = leer(rutaIndice) ?? [];
  if (!Array.isArray(indice)) { error(rutaIndice, 'debe ser una lista de ids'); return; }
  const vistos = new Set();
  for (const idTema of indice) {
    if (vistos.has(idTema)) error(rutaIndice, `tema repetido: ${idTema}`);
    vistos.add(idTema);
    validarTema(base, idTema, idsPartido);
  }
}

function validarTema(base, idTema, idsPartido) {
  const ruta = `${base}/temas/${idTema}.yml`;
  const tema = leer(ruta);
  if (!tema) return;
  if (tema.id !== idTema) error(ruta, `el id del fichero (${tema.id}) no coincide con temas.yml (${idTema})`);
  if (!esTexto(tema.titulo)) error(ruta, 'falta titulo');
  if (!Array.isArray(tema.preguntas)) { error(ruta, '`preguntas` debe ser una lista'); return; }

  const preguntas = new Map();
  for (const [i, q] of tema.preguntas.entries()) {
    const donde = `${ruta} › ${q?.id ?? `pregunta ${i + 1}`}`;
    if (!ID.test(q?.id ?? '')) error(donde, 'id inválido');
    else if (preguntas.has(q.id)) error(donde, 'id de pregunta repetido');
    preguntas.set(q?.id, q);
    if (!TIPOS_PREGUNTA.includes(q?.tipo)) error(donde, `tipo debe ser: ${TIPOS_PREGUNTA.join(' o ')}`);
    if (!esTexto(q?.pregunta)) error(donde, 'falta el texto de la pregunta');

    const posiciones = q?.posiciones ?? {};
    if (typeof posiciones !== 'object' || Array.isArray(posiciones)) { error(donde, '`posiciones` debe ser un mapa partido → posición'); continue; }
    for (const [idPartido, pos] of Object.entries(posiciones)) {
      const dp = `${donde} › ${idPartido}`;
      if (!idsPartido.has(idPartido)) error(dp, 'partido desconocido (no está en partidos.yml)');
      if (pos == null || typeof pos !== 'object') { error(dp, 'la posición debe ser un objeto'); continue; }
      const callado = pos.postura === 'no_se_pronuncia';
      if (q.tipo === 'si_no' && !POSTURAS.includes(pos.postura)) error(dp, `postura debe ser una de: ${POSTURAS.join(', ')}`);
      if (q.tipo === 'abierta' && pos.postura != null && pos.postura !== 'no_se_pronuncia') error(dp, 'en preguntas abiertas solo se admite postura: no_se_pronuncia');
      if (!esTexto(pos.resumen)) error(dp, 'falta resumen');
      if (pos.cita != null && !esTexto(pos.cita)) error(dp, 'cita vacía');
      validarFuente(dp, pos.fuente, !callado);
    }
  }

  const votaciones = tema.votaciones ?? [];
  if (!Array.isArray(votaciones)) { error(ruta, '`votaciones` debe ser una lista'); return; }
  const idsVot = new Set();
  for (const [i, v] of votaciones.entries()) {
    const donde = `${ruta} › votación ${v?.id ?? i + 1}`;
    if (!ID.test(v?.id ?? '')) error(donde, 'id inválido');
    else if (idsVot.has(v.id)) error(donde, 'id de votación repetido');
    idsVot.add(v?.id);
    if (!esTexto(v?.titulo)) error(donde, 'falta titulo');
    if (!fechaValida(v?.fecha)) error(donde, 'fecha debe ser AAAA-MM-DD');
    if (!TIPOS_VOTACION.includes(v?.tipo)) error(donde, `tipo debe ser uno de: ${TIPOS_VOTACION.join(', ')}`);
    if (!URL_OK.test(v?.url ?? '')) error(donde, 'url debe ser un enlace http(s) a la votación oficial');
    for (const rel of v?.relacionada_con ?? []) {
      if (!preguntas.has(rel?.pregunta)) error(donde, `relacionada_con apunta a una pregunta inexistente: ${rel?.pregunta}`);
      else if (preguntas.get(rel.pregunta).tipo !== 'si_no') error(donde, `relacionada_con solo admite preguntas si_no (${rel.pregunta})`);
      if (!['a_favor', 'en_contra'].includes(rel?.si_equivale_a)) error(donde, 'si_equivale_a debe ser a_favor o en_contra');
    }
    const votos = v?.votos ?? {};
    if (typeof votos !== 'object' || Array.isArray(votos)) { error(donde, '`votos` debe ser un mapa partido → voto'); continue; }
    for (const [idPartido, voto] of Object.entries(votos)) {
      if (!idsPartido.has(idPartido)) error(`${donde} › ${idPartido}`, 'partido desconocido (no está en partidos.yml)');
      if (!VOTOS.includes(voto)) error(`${donde} › ${idPartido}`, `voto debe ser uno de: ${VOTOS.join(', ')}`);
    }
  }
}

validarConjunto('datos');
validarConjunto('datos/ejemplo');

console.log(`\n${errores} error(es), ${avisos} aviso(s).`);
process.exit(errores > 0 ? 1 : 0);
