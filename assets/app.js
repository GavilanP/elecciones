import { load, CORE_SCHEMA } from './vendor/js-yaml.mjs';

// ── Configuración ────────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const BASE = DEMO ? 'datos/ejemplo/' : 'datos/';
const ESCRITORIO = window.matchMedia('(min-width: 48rem)');

const POSTURAS = {
  a_favor: { texto: 'A favor', simbolo: '✓', clase: 'dice-favor' },
  en_contra: { texto: 'En contra', simbolo: '✗', clase: 'dice-contra' },
  matizada: { texto: 'Matizada', simbolo: '≈', clase: 'dice-matiz' },
  no_se_pronuncia: { texto: 'No se pronuncia', simbolo: '—', clase: 'dice-nada' },
};
const PENDIENTE = { texto: 'Pendiente de revisar', simbolo: '·', clase: 'pendiente' };

const VOTOS = {
  si: { texto: 'Votó sí', clase: 'favor' },
  no: { texto: 'Votó no', clase: 'contra' },
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

const ICONO_COMPARTIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';

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
  return segura
    ? el('a', { href: segura, target: '_blank', rel: 'noopener noreferrer' }, texto, el('span', { clase: 'oculto-visual' }, ' (se abre en otra pestaña)'))
    : texto;
}

function formatearFecha(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function insignia(info) {
  return el('span', { clase: `insignia ${info.clase}` }, info.simbolo ? el('span', { 'aria-hidden': 'true' }, `${info.simbolo} `) : null, info.texto);
}

function punto(color) {
  return el('span', { clase: 'punto', estilo: { background: color }, 'aria-hidden': 'true' });
}

function leerOcultos() {
  try { return new Set(JSON.parse(localStorage.getItem(CLAVE_OCULTOS) ?? '[]')); } catch { return new Set(); }
}
function guardarOcultos(ocultos) {
  try { localStorage.setItem(CLAVE_OCULTOS, JSON.stringify([...ocultos])); } catch { /* sin almacenamiento: no pasa nada */ }
}

let temporizadorAviso;
/** Región viva creada al cargar la página: así los lectores de pantalla anuncian cada aviso. */
function regionAvisos() {
  return document.querySelector('.aviso-flotante')
    ?? document.body.appendChild(el('div', { clase: 'aviso-flotante', role: 'status' }));
}
function avisar(texto) {
  const aviso = regionAvisos();
  aviso.textContent = texto;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { aviso.textContent = ''; }, 3500);
}

/** Comparte con el menú nativo del móvil; si no existe, copia el enlace. */
async function compartir(titulo, url) {
  if (navigator.share) {
    try { await navigator.share({ title: titulo, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    avisar('Enlace copiado');
  } catch {
    avisar(url);
  }
}

function botonCompartir(titulo, ancla) {
  const boton = el('button', { type: 'button', clase: 'boton-compartir', 'aria-label': `Compartir: ${titulo}` });
  boton.innerHTML = ICONO_COMPARTIR;
  boton.append('Compartir');
  boton.addEventListener('click', () => {
    const url = new URL(location.href);
    url.hash = ancla;
    compartir(titulo, url.toString());
  });
  return boton;
}

// ── Carga de datos ───────────────────────────────────────────────────────────

async function cargarYaml(ruta) {
  const respuesta = await fetch(BASE + ruta, { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`No se pudo cargar ${BASE + ruta} (${respuesta.status})`);
  return load(await respuesta.text(), { schema: CORE_SCHEMA });
}

async function cargarTodo() {
  const [meta, partidos, indice] = await Promise.all([
    cargarYaml('meta.yml'),
    cargarYaml('partidos.yml'),
    cargarYaml('temas.yml'),
  ]);
  const temas = await Promise.all((indice ?? []).map((id) => cargarYaml(`temas/${id}.yml`)));
  return { meta: meta ?? {}, partidos: partidos ?? [], temas };
}

function progreso(tema, partidos) {
  const total = tema.preguntas.length * partidos.length;
  const ids = new Set(partidos.map((p) => p.id));
  const hechas = tema.preguntas.reduce((n, q) => n + Object.keys(q.posiciones ?? {}).filter((id) => ids.has(id)).length, 0);
  return total ? Math.round((hechas / total) * 100) : 0;
}

// ── Elementos comunes: demo, índice lateral, barra inferior, pie ─────────────

function prepararMarco({ meta, partidos, temas }, temaActual) {
  if (DEMO) {
    document.querySelector('.saltar')?.after(el('section', { clase: 'banda-demo', 'aria-label': 'Aviso de demostración' },
      'Demostración con partidos y datos ficticios · ',
      el('a', { href: location.pathname }, 'Ver datos reales')));
  }
  regionAvisos();
  document.querySelectorAll('a[data-interno]').forEach((a) => { a.href = enlace(a.getAttribute('href')); });

  const pie = document.getElementById('actualizado');
  if (pie && meta.actualizado) pie.textContent = `Datos revisados por última vez el ${formatearFecha(meta.actualizado)}.`;

  const listaTemas = () => el('ul', { clase: 'indice-temas' }, temas.map((t) => el('li', {},
    el('a', { href: enlace('tema.html', { id: t.id }), 'aria-current': t.id === temaActual ? 'page' : null },
      el('span', {}, t.titulo),
      partidos.length ? el('span', { clase: 'cifra' }, `${progreso(t, partidos)}%`, el('span', { clase: 'oculto-visual' }, ' documentado')) : null))));

  document.getElementById('lateral-temas')?.replaceChildren(listaTemas());
  document.getElementById('dialogo-temas-lista')?.replaceChildren(listaTemas());

  const dialogo = document.getElementById('dialogo-temas');
  document.querySelectorAll('[data-accion="temas"]').forEach((b) => b.addEventListener('click', () => dialogo?.showModal()));
  dialogo?.querySelector('.boton-cerrar')?.addEventListener('click', () => dialogo.close());
  dialogo?.addEventListener('click', (e) => { if (e.target === dialogo) dialogo.close(); });
  document.querySelectorAll('[data-accion="compartir"]').forEach((b) => b.addEventListener('click', () => compartir(document.title, location.href)));
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

// ── Portada ──────────────────────────────────────────────────────────────────

async function portada() {
  const raiz = document.getElementById('contenido');
  try {
    const datos = await cargarTodo();
    const { meta, partidos, temas } = datos;
    prepararMarco(datos);

    const estado = document.getElementById('estado');
    if (estado) {
      if (meta.fecha_votacion) {
        const dias = Math.ceil((new Date(`${meta.fecha_votacion}T00:00:00`) - new Date()) / 86400000);
        estado.textContent = `${meta.elecciones}: ${formatearFecha(meta.fecha_votacion)}${dias > 0 ? ` · faltan ${dias} días` : ''}`;
      } else {
        estado.textContent = `${meta.elecciones} · fecha pendiente de convocatoria`;
      }
      estado.hidden = false;
    }

    raiz.replaceChildren();

    const seccionPartidos = el('section', { clase: 'seccion', 'aria-labelledby': 't-partidos' },
      el('div', { clase: 'seccion-cabecera' }, el('h2', { id: 't-partidos' }, 'Partidos')));
    if (partidos.length === 0) {
      seccionPartidos.append(el('div', { clase: 'vacio' },
        el('p', {}, 'Todavía no se ha añadido ningún partido. Se irán incorporando a medida que presenten candidatura y publiquen su programa electoral.'),
        el('p', {}, 'Mientras tanto, puedes ver ', el('a', { href: '?demo' }, 'una demostración con partidos ficticios'), ' para hacerte una idea de cómo funciona.')));
    } else {
      seccionPartidos.append(el('ul', { clase: 'partidos' }, partidos.map((p) => el('li', {},
        el('span', { clase: 'ficha-partido', title: p.nota ?? p.nombre },
          punto(p.color), p.nombre,
          p.programa ? null : el('span', { clase: 'nota' }, ' · programa pendiente'))))));
    }

    const seccionTemas = el('section', { clase: 'seccion', 'aria-labelledby': 't-temas' },
      el('div', { clase: 'seccion-cabecera' },
        el('h2', { id: 't-temas' }, 'Temas'),
        el('span', { clase: 'antetitulo' }, `${temas.length} temas · ${temas.reduce((n, t) => n + t.preguntas.length, 0)} preguntas`)),
      el('ul', { clase: 'temas' }, temas.map((t) => {
        const pct = progreso(t, partidos);
        const votaciones = (t.votaciones ?? []).length;
        return el('li', {}, el('a', { clase: 'tarjeta-tema', href: enlace('tema.html', { id: t.id }) },
          el('h3', {}, t.titulo),
          el('p', {}, t.descripcion),
          el('div', { clase: 'progreso', role: 'img', 'aria-label': `${pct}% documentado` }, el('span', { estilo: { width: `${pct}%` } })),
          el('div', { clase: 'progreso-texto' },
            `${t.preguntas.length} ${t.preguntas.length === 1 ? 'pregunta' : 'preguntas'} · ${votaciones} ${votaciones === 1 ? 'votación' : 'votaciones'}`,
            partidos.length ? ` · ${pct}% documentado` : '')));
      })));

    raiz.append(seccionPartidos, seccionTemas);
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
  return el('p', { clase: 'fuente' },
    `${TIPOS_FUENTE[fuente.tipo] ?? 'Fuente'}: `,
    enlaceExterno(fuente.url, fuente.titulo),
    fuente.pagina != null ? el('span', { clase: 'pagina' }, `pág. ${fuente.pagina}`) : null,
    fuente.fecha ? ` · ${formatearFecha(fuente.fecha)}` : null);
}

/** Cita y fuente: desplegables en móvil, siempre visibles en pantallas anchas. */
function detalle(...contenido) {
  const hijos = contenido.filter(Boolean);
  if (hijos.length === 0) return null;
  const tieneCita = hijos.some((h) => h.classList?.contains('cita'));
  return el('details', { clase: 'detalle', open: ESCRITORIO.matches },
    el('summary', {}, tieneCita ? 'Cita y fuente' : 'Fuente'),
    el('div', { clase: 'detalle-cuerpo' }, hijos));
}

function cabeceraPartido(p) {
  return el('div', { clase: 'celda-partido' }, punto(p.color), p.siglas,
    el('span', { clase: 'nombre-largo' }, p.nombre !== p.siglas ? p.nombre : null));
}

function seccionPreguntas(tema, partidos) {
  const seccion = el('section', { id: 'proponen', clase: 'apartado', 'aria-labelledby': 'titulo-proponen' },
    el('header', {},
      el('h2', { id: 'titulo-proponen' }, 'Qué proponen'),
      el('p', { clase: 'apartado-intro' }, 'Lo que dice cada partido, con su fuente. Siempre que es posible, con la cita literal.')));

  for (const q of tema.preguntas) {
    const posiciones = q.posiciones ?? {};
    seccion.append(el('article', { clase: 'bloque', id: `p-${q.id}` },
      el('div', { clase: 'bloque-cabecera' },
        el('span', { clase: 'antetitulo' }, q.tipo === 'si_no' ? 'Pregunta de sí o no' : 'Pregunta abierta'),
        el('h3', {}, q.pregunta),
        botonCompartir(q.pregunta, `p-${q.id}`)),
      el('ul', { clase: 'celdas' }, partidos.map((p) => {
        const pos = posiciones[p.id];
        const celda = el('li', { clase: 'celda', 'data-partido': p.id }, cabeceraPartido(p));
        if (!pos) {
          celda.append(el('p', { clase: 'sin-datos' }, 'Pendiente de revisar.'));
        } else {
          if (q.tipo === 'si_no' || pos.postura === 'no_se_pronuncia') celda.append(el('div', {}, insignia(POSTURAS[pos.postura] ?? PENDIENTE)));
          celda.append(...[
            el('p', { clase: 'celda-resumen' }, pos.resumen),
            detalle(pos.cita ? el('blockquote', { clase: 'cita' }, `«${pos.cita}»`) : null, bloqueFuente(pos.fuente)),
          ].filter(Boolean));
        }
        return celda;
      }))));
  }
  return seccion;
}

function seccionVotaciones(tema, partidos) {
  const seccion = el('section', { id: 'hacen', clase: 'apartado', 'aria-labelledby': 'titulo-hacen' },
    el('header', {},
      el('h2', { id: 'titulo-hacen' }, 'Dicen vs. hacen'),
      el('p', { clase: 'apartado-intro' }, 'Qué votó cada grupo en el Congreso sobre estas cuestiones, junto a lo que dice ahora. ',
        el('a', { href: enlace('metodologia.html#dicen-hacen') }, 'Cómo se interpreta'))));

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
        el('span', { clase: 'antetitulo' }, `${TIPOS_VOTACION[v.tipo] ?? 'Votación'} · ${formatearFecha(v.fecha)}${v.resultado ? ` · ${v.resultado}` : ''}`),
        el('h3', {}, v.titulo),
        botonCompartir(v.titulo, `v-${v.id}`),
        el('div', { clase: 'bloque-meta' },
          v.descripcion ? el('p', {}, v.descripcion) : null,
          relaciones.map((r) => el('p', {},
            `Votar «sí» equivalía a estar ${r.si_equivale_a === 'a_favor' ? 'a favor' : 'en contra'} de: `,
            el('a', { href: `#p-${r.pregunta}` }, preguntas.get(r.pregunta).pregunta))),
          el('p', {}, enlaceExterno(v.url, 'Ver la votación oficial')))),
      el('ul', { clase: 'celdas' }, partidos.map((p) => {
        const voto = v.votos?.[p.id];
        const celda = el('li', { clase: 'celda', 'data-partido': p.id }, cabeceraPartido(p));
        if (!voto) {
          celda.append(el('p', { clase: 'sin-datos' }, 'Sin dato (puede que no tuviera representación).'));
          return celda;
        }
        celda.append(el('div', {}, insignia(VOTOS[voto])));
        for (const r of relaciones) {
          const postura = preguntas.get(r.pregunta).posiciones?.[p.id]?.postura;
          if (!postura) continue;
          const cmp = compararDiceHace(postura, voto, r.si_equivale_a);
          celda.append(el('p', { clase: 'comparacion' },
            el('span', { clase: 'etiqueta' }, 'Ahora dice'), insignia(POSTURAS[postura]),
            cmp ? el('span', { clase: `coincide ${cmp.clase}` }, el('span', { 'aria-hidden': 'true' }, '→ '), cmp.texto) : null));
        }
        return celda;
      })),
      v.nota ? el('p', { clase: 'nota bloque-nota' }, v.nota) : null));
  }
  return seccion;
}

function matrizResumen(tema, partidos) {
  const cerradas = tema.preguntas.filter((q) => q.tipo === 'si_no');
  if (cerradas.length === 0 || partidos.length === 0) return null;
  return el('section', { clase: 'resumen', 'aria-labelledby': 'titulo-resumen' },
    el('h2', { id: 'titulo-resumen', clase: 'antetitulo' }, 'Resumen de posturas'),
    el('div', { clase: 'matriz-envoltorio' },
      el('table', { clase: 'matriz' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Pregunta'),
          partidos.map((p) => el('th', { scope: 'col', 'data-partido': p.id, title: p.nombre }, punto(p.color), p.siglas)))),
        el('tbody', {}, cerradas.map((q) => el('tr', {},
          el('th', { scope: 'row' }, el('a', { href: `#p-${q.id}` }, q.pregunta)),
          partidos.map((p) => {
            const info = POSTURAS[q.posiciones?.[p.id]?.postura] ?? PENDIENTE;
            return el('td', { 'data-partido': p.id, title: `${p.siglas}: ${info.texto}` },
              el('span', { clase: `insignia ${info.clase}` },
                el('span', { 'aria-hidden': 'true' }, info.simbolo), el('span', { clase: 'oculto-visual' }, info.texto)));
          })))))));
}

function selectorPartidos(partidos, alCambiar) {
  const ocultos = leerOcultos();
  const chips = el('div', { clase: 'comparar-chips' });
  const botones = [];
  const actualizar = () => {
    botones.forEach(([b, id]) => b.setAttribute('aria-pressed', String(!ocultos.has(id))));
    guardarOcultos(ocultos);
    alCambiar(ocultos);
  };
  const todos = el('button', { type: 'button', clase: 'chip chip-todos' }, 'Todos');
  todos.addEventListener('click', () => { ocultos.clear(); actualizar(); });
  chips.append(todos);
  for (const p of partidos) {
    const boton = el('button', { type: 'button', clase: 'chip', 'aria-pressed': String(!ocultos.has(p.id)), title: p.nombre }, punto(p.color), p.siglas);
    boton.addEventListener('click', () => {
      if (ocultos.has(p.id)) ocultos.delete(p.id); else ocultos.add(p.id);
      actualizar();
    });
    botones.push([boton, p.id]);
    chips.append(boton);
  }
  return el('div', { clase: 'comparar', role: 'group', 'aria-label': 'Elegir qué partidos comparar' },
    el('span', { clase: 'comparar-etiqueta' }, 'Comparar'), chips);
}

async function paginaTema() {
  const raiz = document.getElementById('contenido');
  try {
    const datos = await cargarTodo();
    const { partidos, temas } = datos;
    const id = params.get('id');
    const posicion = temas.findIndex((t) => t.id === id);
    prepararMarco(datos, id);
    if (posicion === -1) {
      raiz.replaceChildren(el('div', { clase: 'vacio' },
        el('p', {}, 'Ese tema no existe.'), el('p', {}, el('a', { href: enlace('index.html') }, 'Ver todos los temas'))));
      return;
    }
    const tema = temas[posicion];
    document.title = `${tema.titulo} · ¿Qué propone cada partido?`;

    raiz.replaceChildren(el('header', { clase: 'tema-cabecera' },
      el('p', { clase: 'migas' }, el('a', { href: enlace('index.html') }, 'Temas'), ` / ${posicion + 1} de ${temas.length}`),
      el('h1', {}, tema.titulo),
      el('p', { clase: 'entradilla' }, tema.descripcion),
      el('nav', { clase: 'saltos', 'aria-label': 'Secciones del tema' },
        el('a', { href: '#proponen' }, 'Qué proponen'),
        el('a', { href: '#hacen' }, 'Dicen vs. hacen'))));

    if (partidos.length === 0) {
      raiz.append(el('div', { clase: 'vacio', estilo: { marginTop: '2rem' } },
        el('p', {}, 'Todavía no se ha añadido ningún partido. Estas son las preguntas que se van a comparar:'),
        el('ul', {}, tema.preguntas.map((q) => el('li', {}, q.pregunta))),
        el('p', {}, el('a', { href: enlace('tema.html', { id: tema.id, demo: '' }) }, 'Ver la demostración con partidos ficticios'))));
    } else {
      const aplicarFiltro = (ocultos) => {
        document.querySelectorAll('[data-partido]').forEach((n) => { n.hidden = ocultos.has(n.dataset.partido); });
      };
      raiz.append(...[
        selectorPartidos(partidos, aplicarFiltro),
        matrizResumen(tema, partidos),
        seccionPreguntas(tema, partidos),
        seccionVotaciones(tema, partidos),
      ].filter(Boolean));
      aplicarFiltro(leerOcultos());
      ESCRITORIO.addEventListener('change', (e) => {
        document.querySelectorAll('details.detalle').forEach((d) => { d.open = e.matches; });
      });
    }

    const anterior = temas[posicion - 1];
    const siguiente = temas[posicion + 1];
    raiz.append(el('nav', { clase: 'navegacion-temas', 'aria-label': 'Otros temas' },
      anterior
        ? el('a', { href: enlace('tema.html', { id: anterior.id }) }, el('span', { clase: 'antetitulo' }, '← Anterior'), el('strong', {}, anterior.titulo))
        : el('span'),
      siguiente
        ? el('a', { href: enlace('tema.html', { id: siguiente.id }) }, el('span', { clase: 'antetitulo' }, 'Siguiente →'), el('strong', {}, siguiente.titulo))
        : el('span')));

    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch (e) {
    mostrarError(raiz, e);
  }
}

// ── Metodología (solo necesita el marco común) ───────────────────────────────

async function paginaEstatica() {
  try { prepararMarco(await cargarTodo()); } catch { prepararMarco({ meta: {}, partidos: [], temas: [] }); }
}

// ── Arranque ─────────────────────────────────────────────────────────────────

const paginas = { portada, tema: paginaTema, estatica: paginaEstatica };
paginas[document.body.dataset.pagina]?.();
