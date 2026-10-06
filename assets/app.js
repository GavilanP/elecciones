import { load, CORE_SCHEMA } from './vendor/js-yaml.mjs';

// ── Configuración ────────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const BASE = DEMO ? 'datos/ejemplo/' : 'datos/';

const POSTURAS = {
  a_favor: { texto: 'A favor', simbolo: '✓', clase: 'favor' },
  en_contra: { texto: 'En contra', simbolo: '✗', clase: 'contra' },
  matizada: { texto: 'Matizada', simbolo: '≈', clase: 'matiz' },
  no_se_pronuncia: { texto: 'No se pronuncia', simbolo: '—', clase: 'nada' },
};
const PENDIENTE = { texto: 'Pendiente de revisar', simbolo: '·', clase: 'pendiente' };

const VOTOS = {
  si: { texto: 'Sí', clase: 'favor' },
  no: { texto: 'No', clase: 'contra' },
  abstencion: { texto: 'Abstención', clase: 'matiz' },
  dividido: { texto: 'Voto dividido', clase: 'matiz' },
  no_presente: { texto: 'No votó', clase: 'nada' },
};

const TIPOS_FUENTE = {
  programa: 'Programa electoral',
  declaracion: 'Declaración',
  votacion: 'Votación',
  otro: 'Fuente',
};

const TIPOS_VOTACION = {
  votacion_final: 'Votación final',
  toma_en_consideracion: 'Toma en consideración',
  enmienda_totalidad: 'Enmienda a la totalidad',
  convalidacion: 'Convalidación de decreto',
  mocion: 'Moción / PNL',
  otra: 'Votación',
};

const CLAVE_OCULTOS = 'elecciones:partidos-ocultos';

// ── Utilidades ───────────────────────────────────────────────────────────────

/** Crea un elemento. Los hijos de texto se insertan como texto (nunca como HTML). */
function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor == null || valor === false) continue;
    if (clave === 'clase') nodo.className = valor;
    else if (clave === 'estilo') Object.assign(nodo.style, valor);
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor === true ? '' : valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo == null || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}

const urlSegura = (url) => (typeof url === 'string' && /^https?:\/\//.test(url) ? url : null);

/** Enlace interno que conserva el modo demo. */
function enlace(ruta, extra = {}) {
  const [camino, ancla] = ruta.split('#');
  const p = new URLSearchParams(extra);
  if (DEMO) p.set('demo', '');
  const qs = p.toString().replace(/=(&|$)/g, '$1');
  return camino + (qs ? `?${qs}` : '') + (ancla ? `#${ancla}` : '');
}

function enlaceExterno(url, texto) {
  const segura = urlSegura(url);
  return segura ? el('a', { href: segura, target: '_blank', rel: 'noopener noreferrer' }, texto) : texto;
}

function formatearFecha(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function insignia(info) {
  return el('span', { clase: `insignia ${info.clase}` }, info.simbolo ? `${info.simbolo} ` : '', info.texto);
}

function leerOcultos() {
  try { return new Set(JSON.parse(localStorage.getItem(CLAVE_OCULTOS) ?? '[]')); } catch { return new Set(); }
}
function guardarOcultos(ocultos) {
  try { localStorage.setItem(CLAVE_OCULTOS, JSON.stringify([...ocultos])); } catch { /* sin almacenamiento: no pasa nada */ }
}

// ── Carga de datos ───────────────────────────────────────────────────────────

async function cargarYaml(ruta) {
  const respuesta = await fetch(BASE + ruta, { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`No se pudo cargar ${BASE + ruta} (${respuesta.status})`);
  return load(await respuesta.text(), { schema: CORE_SCHEMA });
}

async function cargarBase() {
  const [meta, partidos, indice] = await Promise.all([
    cargarYaml('meta.yml'),
    cargarYaml('partidos.yml'),
    cargarYaml('temas.yml'),
  ]);
  return { meta: meta ?? {}, partidos: partidos ?? [], indice: indice ?? [] };
}

const cargarTema = (id) => cargarYaml(`temas/${id}.yml`);

// ── Elementos comunes ────────────────────────────────────────────────────────

function prepararPagina(meta) {
  if (DEMO) {
    document.body.prepend(el('div', { clase: 'banda-demo', role: 'note' },
      'Modo demostración: partidos y datos FICTICIOS. ',
      el('a', { href: location.pathname }, 'Ver datos reales')));
  }
  document.querySelectorAll('a[data-interno]').forEach((a) => { a.href = enlace(a.getAttribute('href')); });
  const pie = document.getElementById('actualizado');
  if (pie && meta.actualizado) pie.textContent = `Datos revisados por última vez el ${formatearFecha(meta.actualizado)}.`;
}

function mostrarError(contenedor, e) {
  contenedor.replaceChildren(el('div', { clase: 'aviso', role: 'alert' },
    el('p', {}, el('strong', {}, 'No se han podido cargar los datos.')),
    el('p', {}, e.message),
    location.protocol === 'file:'
      ? el('p', {}, 'Abre la web con un servidor local (por ejemplo: python3 -m http.server) en lugar de abrir el fichero directamente.')
      : null));
  console.error(e);
}

function nombrePartido(p) {
  return el('span', { clase: 'fila-partido' }, el('span', { clase: 'punto', estilo: { background: p.color } }), p.siglas);
}

// ── Portada ──────────────────────────────────────────────────────────────────

async function portada() {
  const raiz = document.getElementById('contenido');
  try {
    const { meta, partidos, indice } = await cargarBase();
    prepararPagina(meta);
    const temas = await Promise.all(indice.map(cargarTema));
    raiz.replaceChildren();

    if (meta.fecha_votacion) {
      const dias = Math.ceil((new Date(`${meta.fecha_votacion}T00:00:00`) - new Date()) / 86400000);
      if (dias >= 0) {
        raiz.append(el('p', { clase: 'aviso' }, `${meta.elecciones}: ${formatearFecha(meta.fecha_votacion)}`,
          dias > 0 ? ` (faltan ${dias} días).` : ' (hoy).'));
      }
    }

    raiz.append(el('h2', {}, 'Partidos'));
    if (partidos.length === 0) {
      raiz.append(el('div', { clase: 'vacio' },
        el('p', {}, 'Todavía no se ha añadido ningún partido. Se irán incorporando a medida que presenten candidatura y publiquen su programa electoral.'),
        el('p', {}, 'Mientras tanto, puedes ver ', el('a', { href: '?demo' }, 'una demostración con partidos ficticios'), ' para hacerte una idea de cómo funciona.')));
    } else {
      raiz.append(el('ul', { clase: 'partidos' }, partidos.map((p) => el('li', {},
        el('span', { clase: 'chip', title: p.nota ?? p.nombre },
          el('span', { clase: 'punto', estilo: { background: p.color } }),
          p.nombre,
          p.programa ? null : el('span', { clase: 'nota' }, ' · programa pendiente'))))));
    }

    raiz.append(el('h2', {}, 'Temas'));
    raiz.append(el('ul', { clase: 'temas' }, temas.map((t) => {
      const total = t.preguntas.length * partidos.length;
      const hechas = t.preguntas.reduce((n, q) => n + Object.keys(q.posiciones ?? {}).filter((id) => partidos.some((p) => p.id === id)).length, 0);
      const pct = total ? Math.round((hechas / total) * 100) : 0;
      const votaciones = (t.votaciones ?? []).length;
      return el('li', {}, el('a', { clase: 'tarjeta-tema', href: enlace('tema.html', { id: t.id }) },
        el('h3', {}, t.titulo),
        el('p', {}, t.descripcion),
        el('div', { clase: 'progreso', role: 'img', 'aria-label': `${pct}% documentado` }, el('span', { estilo: { width: `${pct}%` } })),
        el('div', { clase: 'progreso-texto' },
          `${t.preguntas.length} preguntas · ${votaciones} ${votaciones === 1 ? 'votación' : 'votaciones'}`,
          total ? ` · ${pct}% documentado` : '')));
    })));
  } catch (e) {
    mostrarError(raiz, e);
  }
}

// ── Página de tema ───────────────────────────────────────────────────────────

/** ¿Coincide lo que el partido dice con lo que votó? Solo si hay datos suficientes. */
function compararDiceHace(postura, voto, siEquivaleA) {
  if (!postura || !siEquivaleA || postura === 'no_se_pronuncia') return null;
  if (!['si', 'no', 'abstencion'].includes(voto)) return null;
  const contrario = siEquivaleA === 'a_favor' ? 'en_contra' : 'a_favor';
  const implicito = voto === 'si' ? siEquivaleA : voto === 'no' ? contrario : 'matizada';
  if (implicito === postura) return { clase: 'si', texto: 'Coincide' };
  if (implicito === 'matizada' || postura === 'matizada') return { clase: 'parcial', texto: 'Coincide en parte' };
  return { clase: 'no', texto: 'No coincide' };
}

function bloqueFuente(fuente) {
  if (!fuente) return null;
  const partes = [TIPOS_FUENTE[fuente.tipo] ?? 'Fuente', ': ', enlaceExterno(fuente.url, fuente.titulo)];
  if (fuente.pagina != null) partes.push(`, pág. ${fuente.pagina}`);
  if (fuente.fecha) partes.push(` (${formatearFecha(fuente.fecha)})`);
  return el('p', { clase: 'fuente' }, partes);
}

function seccionPreguntas(tema, partidos) {
  const seccion = el('section', { id: 'proponen', 'aria-labelledby': 'titulo-proponen' },
    el('h2', { id: 'titulo-proponen' }, 'Qué proponen'));

  for (const q of tema.preguntas) {
    const posiciones = q.posiciones ?? {};
    seccion.append(el('article', { clase: 'bloque', id: `p-${q.id}` },
      el('div', { clase: 'bloque-cabecera' },
        el('h3', {}, q.pregunta),
        el('a', { clase: 'enlace-ancla', href: `#p-${q.id}`, title: 'Enlace a esta pregunta' }, '#')),
      el('ul', { clase: 'filas' }, partidos.map((p) => {
        const pos = posiciones[p.id];
        const cuerpo = el('div', { clase: 'fila-cuerpo' });
        if (!pos) {
          cuerpo.append(el('p', { clase: 'sin-datos' }, 'Pendiente de revisar.'));
        } else {
          if (q.tipo === 'si_no' || pos.postura === 'no_se_pronuncia') cuerpo.append(insignia(POSTURAS[pos.postura] ?? PENDIENTE));
          cuerpo.append(...[
            el('p', {}, pos.resumen),
            pos.cita ? el('blockquote', { clase: 'cita' }, `«${pos.cita}»`) : null,
            bloqueFuente(pos.fuente),
          ].filter(Boolean));
        }
        return el('li', { clase: 'fila', 'data-partido': p.id }, nombrePartido(p), cuerpo);
      }))));
  }
  return seccion;
}

function seccionVotaciones(tema, partidos) {
  const seccion = el('section', { id: 'hacen', 'aria-labelledby': 'titulo-hacen' },
    el('h2', { id: 'titulo-hacen' }, 'Dicen vs. hacen'),
    el('p', { clase: 'entradilla' }, 'Qué votó cada grupo en el Congreso sobre estas cuestiones, junto a lo que dice ahora. ',
      el('a', { href: enlace('metodologia.html#dicen-hacen') }, 'Cómo se interpreta')));

  const votaciones = tema.votaciones ?? [];
  if (votaciones.length === 0) {
    seccion.append(el('p', { clase: 'vacio' }, 'Todavía no se han añadido votaciones para este tema.'));
    return seccion;
  }

  const preguntas = new Map(tema.preguntas.map((q) => [q.id, q]));
  for (const v of [...votaciones].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))) {
    const relaciones = (v.relacionada_con ?? []).filter((r) => preguntas.has(r.pregunta));
    seccion.append(el('article', { clase: 'bloque', id: `v-${v.id}` },
      el('div', { clase: 'bloque-cabecera' },
        el('h3', {}, v.titulo),
        el('a', { clase: 'enlace-ancla', href: `#v-${v.id}`, title: 'Enlace a esta votación' }, '#')),
      el('p', { clase: 'meta-bloque' },
        `${TIPOS_VOTACION[v.tipo] ?? 'Votación'} · ${formatearFecha(v.fecha)}`,
        v.resultado ? ` · ${v.resultado}` : '', ' · ',
        enlaceExterno(v.url, 'Ver votación oficial')),
      v.descripcion ? el('p', { clase: 'descripcion-bloque' }, v.descripcion) : null,
      relaciones.map((r) => el('p', { clase: 'nota' },
        `Votar «sí» equivalía a estar ${r.si_equivale_a === 'a_favor' ? 'a favor' : 'en contra'} de: `,
        el('a', { href: `#p-${r.pregunta}` }, preguntas.get(r.pregunta).pregunta))),
      el('ul', { clase: 'filas' }, partidos.map((p) => {
        const voto = v.votos?.[p.id];
        const cuerpo = el('div', { clase: 'fila-cuerpo' });
        if (!voto) {
          cuerpo.append(el('p', { clase: 'sin-datos' }, 'Sin dato (puede que no tuviera representación).'));
        } else {
          cuerpo.append(insignia(VOTOS[voto]));
          for (const r of relaciones) {
            const postura = preguntas.get(r.pregunta).posiciones?.[p.id]?.postura;
            if (!postura) continue;
            const cmp = compararDiceHace(postura, voto, r.si_equivale_a);
            cuerpo.append(el('p', { clase: 'comparacion' },
              el('span', { clase: 'etiqueta' }, 'Ahora dice:'), insignia(POSTURAS[postura]),
              cmp ? el('span', { clase: `coincide ${cmp.clase}` }, `→ ${cmp.texto}`) : null));
          }
        }
        return el('li', { clase: 'fila', 'data-partido': p.id }, nombrePartido(p), cuerpo);
      })),
      v.nota ? el('p', { clase: 'nota' }, v.nota) : null));
  }
  return seccion;
}

function matrizResumen(tema, partidos) {
  const cerradas = tema.preguntas.filter((q) => q.tipo === 'si_no');
  if (cerradas.length === 0 || partidos.length === 0) return null;
  return el('div', { clase: 'matriz-envoltorio' },
    el('table', { clase: 'matriz' },
      el('caption', { clase: 'nota', estilo: { padding: '.5rem', textAlign: 'left' } }, 'Resumen de posturas (preguntas de sí o no)'),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Pregunta'),
        partidos.map((p) => el('th', { scope: 'col', 'data-partido': p.id, title: p.nombre },
          el('span', { clase: 'punto', estilo: { background: p.color, marginRight: '.3rem' } }), p.siglas)))),
      el('tbody', {}, cerradas.map((q) => el('tr', {},
        el('th', { scope: 'row' }, el('a', { href: `#p-${q.id}` }, q.pregunta)),
        partidos.map((p) => {
          const info = POSTURAS[q.posiciones?.[p.id]?.postura] ?? PENDIENTE;
          return el('td', { 'data-partido': p.id, title: `${p.siglas}: ${info.texto}` },
            el('span', { clase: `insignia ${info.clase}`, 'aria-label': info.texto }, info.simbolo));
        }))))));
}

function filtroPartidos(partidos, alCambiar) {
  const ocultos = leerOcultos();
  const contenedor = el('div', { clase: 'filtro', role: 'group', 'aria-label': 'Mostrar u ocultar partidos' },
    el('span', { clase: 'filtro-titulo' }, 'Mostrar:'));
  for (const p of partidos) {
    const boton = el('button', { type: 'button', clase: 'chip', 'aria-pressed': String(!ocultos.has(p.id)), title: p.nombre },
      el('span', { clase: 'punto', estilo: { background: p.color } }), p.siglas);
    boton.addEventListener('click', () => {
      if (ocultos.has(p.id)) ocultos.delete(p.id); else ocultos.add(p.id);
      boton.setAttribute('aria-pressed', String(!ocultos.has(p.id)));
      guardarOcultos(ocultos);
      alCambiar(ocultos);
    });
    contenedor.append(boton);
  }
  return contenedor;
}

async function paginaTema() {
  const raiz = document.getElementById('contenido');
  try {
    const { meta, partidos, indice } = await cargarBase();
    prepararPagina(meta);
    const id = params.get('id');
    const posicion = indice.indexOf(id);
    if (posicion === -1) {
      raiz.replaceChildren(el('p', { clase: 'vacio' }, 'Ese tema no existe. ', el('a', { href: enlace('index.html') }, 'Volver al inicio')));
      return;
    }
    const tema = await cargarTema(id);
    document.title = `${tema.titulo} · Elecciones: qué propone cada partido`;

    raiz.replaceChildren(
      el('p', { clase: 'nota' }, el('a', { href: enlace('index.html') }, '← Todos los temas')),
      el('h1', {}, tema.titulo),
      el('p', { clase: 'entradilla' }, tema.descripcion),
      el('nav', { clase: 'indice-tema', 'aria-label': 'Secciones' },
        el('a', { href: '#proponen' }, 'Qué proponen'),
        el('a', { href: '#hacen' }, 'Dicen vs. hacen')));

    if (partidos.length === 0) {
      raiz.append(el('div', { clase: 'vacio' },
        el('p', {}, 'Todavía no se ha añadido ningún partido; de momento solo puedes ver las preguntas que se van a comparar.'),
        el('ul', {}, tema.preguntas.map((q) => el('li', {}, q.pregunta))),
        el('p', {}, el('a', { href: enlace('tema.html', { id: tema.id, demo: '' }) }, 'Ver la demostración con partidos ficticios'))));
    } else {
      const aplicarFiltro = (ocultos) => {
        document.querySelectorAll('[data-partido]').forEach((n) => { n.hidden = ocultos.has(n.dataset.partido); });
      };
      raiz.append(...[
        filtroPartidos(partidos, aplicarFiltro),
        matrizResumen(tema, partidos),
        seccionPreguntas(tema, partidos),
        seccionVotaciones(tema, partidos),
      ].filter(Boolean));
      aplicarFiltro(leerOcultos());
    }

    const anterior = indice[posicion - 1];
    const siguiente = indice[posicion + 1];
    raiz.append(el('nav', { clase: 'navegacion-temas', 'aria-label': 'Otros temas' },
      anterior ? el('a', { href: enlace('tema.html', { id: anterior }) }, '← Tema anterior') : el('span'),
      siguiente ? el('a', { href: enlace('tema.html', { id: siguiente }) }, 'Tema siguiente →') : el('span')));

    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch (e) {
    mostrarError(raiz, e);
  }
}

// ── Metodología (solo necesita la cabecera común) ────────────────────────────

async function paginaEstatica() {
  try { prepararPagina((await cargarBase()).meta); } catch { prepararPagina({}); }
}

// ── Arranque ─────────────────────────────────────────────────────────────────

const paginas = { portada, tema: paginaTema, estatica: paginaEstatica };
paginas[document.body.dataset.pagina]?.();
