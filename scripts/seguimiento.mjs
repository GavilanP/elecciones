// Validación del modelo de seguimiento (docs/PLAN-datos.md): programas electorales,
// votaciones, iniciativas y normas desde junio de 2018, y el análisis propio
// (coherencia programa ↔ hechos y variaciones entre programas).
//
// Lo usa scripts/validar.mjs. Aquí no se descarga nada: solo se comprueba que lo
// guardado es coherente entre sí.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const URL_OK = /^https?:\/\/\S+$/;
const SHA256 = /^[0-9a-f]{64}$/;

const NIVELES = ['estatal', 'autonomico'];
const TIPOS_PARTIDO = ['estatal', 'nacionalista', 'regional'];
const CONCRECION = ['medida_concreta', 'objetivo_general'];
const ESTADOS_PROPUESTA = ['propuesta_ia', 'revisada', 'descartada'];
const ESTADOS_RELACION = ['sugerida_ia', 'confirmada', 'descartada'];
const VOTO_COMPACTO = { S: 'si', N: 'no', A: 'abstencion', X: 'no_vota' };
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const VOTO_PARTIDO = ['si', 'no', 'abstencion', 'dividido', 'no_presente'];
const TIPOS_VOTACION = ['votacion_final', 'dictamen', 'enmiendas', 'toma_en_consideracion', 'enmienda_totalidad', 'convalidacion', 'mocion', 'otra'];
const TIPOS_EVIDENCIA = ['votacion', 'iniciativa', 'norma'];
const SENTIDOS = ['a_favor', 'en_contra', 'neutro'];
const VALORACIONES = ['coherente', 'contradictoria', 'mixta', 'sin_actuacion', 'fuera_de_su_alcance'];
const TIPOS_CAMBIO = ['nueva', 'retirada', 'cambiada', 'igual'];

const esTexto = (v) => typeof v === 'string' && v.trim() !== '';
const fechaValida = (v) => typeof v === 'string' && FECHA.test(v) && !Number.isNaN(Date.parse(v));
const lista = (v) => (Array.isArray(v) ? v : []);
const ficheros = (dir, ext) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort() : []);
const carpetas = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []);

/**
 * Valoración que corresponde a unas evidencias (reglas públicas del análisis propio).
 * Las evidencias «neutro» (abstención, voto dividido…) no inclinan la balanza.
 */
export function valoracionSegunEvidencias(evidencias) {
  const favor = evidencias.filter((e) => e.sentido === 'a_favor').length;
  const contra = evidencias.filter((e) => e.sentido === 'en_contra').length;
  if (favor && contra) return 'mixta';
  if (favor) return 'coherente';
  if (contra) return 'contradictoria';
  return 'sin_actuacion';
}

/**
 * Voto de un partido a partir de los recuentos de sus diputados (misma regla que
 * scripts/agregar_votos.py): la opción con al menos 2/3 de los votos emitidos;
 * si ninguna llega, «dividido»; sin votos emitidos, «no_presente».
 */
export function votoDePartido(c) {
  const emitidos = c.si + c.no + c.abstencion;
  if (!emitidos) return 'no_presente';
  const [opcion, n] = [['si', c.si], ['no', c.no], ['abstencion', c.abstencion]].reduce((a, b) => (b[1] > a[1] ? b : a));
  return 3 * n >= 2 * emitidos ? opcion : 'dividido';
}

/** Qué significa el voto de un partido respecto a una propuesta. */
function sentidoDelVoto(voto, siEquivaleA) {
  if (voto === 'si') return siEquivaleA;
  if (voto === 'no') return siEquivaleA === 'a_favor' ? 'en_contra' : 'a_favor';
  return 'neutro';
}

export function validarSeguimiento(raiz, base, { leer, error, aviso }) {
  const dir = `${base}/seguimiento`;
  if (!existsSync(join(raiz, dir))) return;
  console.log(`\nValidando ${dir}/`);

  const leerJson = (ruta) => {
    try { return JSON.parse(readFileSync(join(raiz, ruta), 'utf8')); } catch (e) { error(ruta, `JSON inválido: ${e.message}`); return undefined; }
  };
  const comprobarId = (donde, id, vistos, que = 'id') => {
    if (!ID.test(id ?? '')) error(donde, `${que} inválido (minúsculas, números y guiones)`);
    else if (vistos.has(id)) error(donde, `${que} repetido`);
    vistos.add(id);
  };

  // ── Ámbitos ────────────────────────────────────────────────────────────────
  const ambitos = new Map();
  for (const [i, a] of lista(leer(`${dir}/ambitos.yml`)).entries()) {
    const donde = `${dir}/ambitos.yml [${a?.id ?? i}]`;
    if (!ID.test(a?.id ?? '') || ambitos.has(a.id)) { error(donde, 'id inválido o repetido'); continue; }
    ambitos.set(a.id, a);
    if (!esTexto(a.nombre)) error(donde, 'falta nombre');
    if (!NIVELES.includes(a.nivel)) error(donde, `nivel debe ser: ${NIVELES.join(' o ')}`);
    if (!esTexto(a.parlamento)) error(donde, 'falta parlamento');
    if (!URL_OK.test(a.datos_votaciones ?? '')) error(donde, 'datos_votaciones debe ser un enlace http(s)');
  }

  // ── Partidos y marcas ──────────────────────────────────────────────────────
  const partidos = new Map();
  for (const [i, p] of lista(leer(`${dir}/partidos.yml`)).entries()) {
    const donde = `${dir}/partidos.yml [${p?.id ?? i}]`;
    if (!ID.test(p?.id ?? '') || partidos.has(p.id)) { error(donde, 'id inválido o repetido'); continue; }
    partidos.set(p.id, p);
    if (!esTexto(p.nombre)) error(donde, 'falta nombre');
    if (!TIPOS_PARTIDO.includes(p.tipo)) error(donde, `tipo debe ser uno de: ${TIPOS_PARTIDO.join(', ')}`);
    if (!/^#[0-9a-fA-F]{6}$/.test(p.color ?? '')) error(donde, 'color debe ser hexadecimal');
    if (!lista(p.marcas).length) error(donde, 'necesita al menos una marca (siglas en un ámbito)');
    for (const m of lista(p.marcas)) {
      if (!esTexto(m?.siglas)) error(donde, 'marca sin siglas');
      if (!ambitos.has(m?.ambito)) error(donde, `marca ${m?.siglas}: ámbito desconocido (${m?.ambito})`);
      if (!fechaValida(m?.desde)) error(donde, `marca ${m?.siglas}: desde debe ser AAAA-MM-DD`);
      if (m?.hasta != null && !fechaValida(m.hasta)) error(donde, `marca ${m?.siglas}: hasta debe ser AAAA-MM-DD`);
    }
  }
  for (const p of partidos.values()) {
    for (const miembro of lista(p.miembros)) {
      if (!partidos.has(miembro)) error(`${dir}/partidos.yml [${p.id}]`, `miembro desconocido: ${miembro}`);
    }
  }
  const partidoConocido = (donde, id) => { if (!partidos.has(id)) error(donde, `partido desconocido: ${id}`); };

  // ── Legislaturas y elecciones ──────────────────────────────────────────────
  const rutaElecciones = `${dir}/elecciones.yml`;
  const datosElecciones = leer(rutaElecciones) ?? {};
  const legislaturas = new Map(); // "ambito/id" → legislatura
  for (const [i, l] of lista(datosElecciones.legislaturas).entries()) {
    const donde = `${rutaElecciones} › legislatura ${l?.id ?? i}`;
    const clave = `${l?.ambito}/${l?.id}`;
    if (!esTexto(l?.id) || legislaturas.has(clave)) { error(donde, 'id vacío o repetido en el mismo ámbito'); continue; }
    legislaturas.set(clave, l);
    if (!ambitos.has(l.ambito)) error(donde, `ámbito desconocido: ${l.ambito}`);
    if (!fechaValida(l.inicio)) error(donde, 'inicio debe ser AAAA-MM-DD');
    if (l.fin != null && !fechaValida(l.fin)) error(donde, 'fin debe ser AAAA-MM-DD');
    if (l.seguimiento_desde != null && !fechaValida(l.seguimiento_desde)) error(donde, 'seguimiento_desde debe ser AAAA-MM-DD');
    for (const g of lista(l.gobierno)) {
      lista(g?.partidos).forEach((id) => partidoConocido(donde, id));
      if (!fechaValida(g?.desde)) error(donde, 'gobierno.desde debe ser AAAA-MM-DD');
    }
  }
  const enLegislatura = (l, fecha) => fecha >= (l.seguimiento_desde ?? l.inicio) && (l.fin == null || fecha <= l.fin);
  const gobernaba = (l, partido, fecha) => lista(l.gobierno).some((g) =>
    lista(g.partidos).includes(partido) && fecha >= g.desde && (g.hasta == null || fecha <= g.hasta));

  const elecciones = new Map();
  for (const [i, e] of lista(datosElecciones.elecciones).entries()) {
    const donde = `${rutaElecciones} › elección ${e?.id ?? i}`;
    if (!ID.test(e?.id ?? '') || elecciones.has(e.id)) { error(donde, 'id inválido o repetido'); continue; }
    elecciones.set(e.id, e);
    if (!ambitos.has(e.ambito)) error(donde, `ámbito desconocido: ${e.ambito}`);
    if (!fechaValida(e.fecha)) error(donde, 'fecha debe ser AAAA-MM-DD');
    if (!legislaturas.has(`${e.ambito}/${e.legislatura}`)) error(donde, `legislatura desconocida: ${e.legislatura}`);
  }

  // ── Grupos parlamentarios → partidos ───────────────────────────────────────
  const grupos = new Map(); // "ambito/leg/grupo" → { partidos } | { diputados }
  for (const [i, g] of lista(leer(`${dir}/grupos.yml`)).entries()) {
    const donde = `${dir}/grupos.yml [${g?.grupo ?? i}]`;
    const clave = `${g?.ambito}/${g?.legislatura}/${g?.grupo}`;
    if (!legislaturas.has(`${g?.ambito}/${g?.legislatura}`)) error(donde, 'ámbito o legislatura desconocidos');
    if (!esTexto(g?.grupo)) { error(donde, 'falta el nombre del grupo'); continue; }
    if (grupos.has(clave)) error(donde, 'grupo repetido en esa legislatura');
    const porPartido = lista(g.partidos).length > 0;
    const porDiputado = g.diputados && typeof g.diputados === 'object';
    if (porPartido === Boolean(porDiputado)) error(donde, 'indica `partidos` o `diputados` (uno de los dos)');
    lista(g.partidos).forEach((id) => partidoConocido(donde, id));
    for (const [nombre, valor] of Object.entries(g.diputados ?? {})) {
      const tramos = typeof valor === 'string' ? [{ partido: valor }] : lista(valor);
      if (!tramos.length) error(donde, `${nombre}: indica un partido, «ninguno» o una lista de tramos con fechas`);
      for (const t of tramos) {
        if (t?.partido !== 'ninguno') partidoConocido(`${donde} › ${nombre}`, t?.partido);
        for (const f of ['desde', 'hasta']) if (t?.[f] != null && !fechaValida(t[f])) error(`${donde} › ${nombre}`, `${f} debe ser AAAA-MM-DD`);
      }
    }
    if (lista(g.partidos).length > 1) aviso(donde, 'grupo con varios partidos: sus votos se atribuyen a todos ellos; mejor repartir por `diputados`');
    grupos.set(clave, g);
  }
  // Lo que falta en grupos.yml se avisa una sola vez por grupo, no en cada votación.
  const gruposSinEntrada = new Set();
  const diputadosSinPartido = new Map(); // "ambito leg: grupo" → nombres
  const SIN_GRUPO = '?'; // diputados que votan antes de tener grupo asignado
  const partidoEnFecha = (valor, fecha) => {
    if (typeof valor === 'string') return valor;
    const t = lista(valor).find((x) => fecha >= (x.desde ?? '0000') && fecha <= (x.hasta ?? '9999'));
    return t?.partido;
  };
  // `otrosGrupos`: índice de diputado → grupos (sin «?») en los que aparece en la legislatura.
  const partidosDeDiputado = (ambito, leg, grupo, nombre, fecha, otrosGrupos) => {
    if (grupo === SIN_GRUPO && otrosGrupos?.size === 1) grupo = [...otrosGrupos][0];
    const g = grupos.get(`${ambito}/${leg}/${grupo}`);
    const clave = `${ambito} ${leg}: grupo «${grupo}»`;
    if (!g) {
      if (grupo === SIN_GRUPO) diputadosSinPartido.set(clave, (diputadosSinPartido.get(clave) ?? new Set()).add(nombre));
      else gruposSinEntrada.add(clave);
      return [];
    }
    if (!g.diputados) return g.partidos;
    const partido = partidoEnFecha(g.diputados[nombre], fecha);
    if (partido) return partido === 'ninguno' ? [] : [partido];
    diputadosSinPartido.set(clave, (diputadosSinPartido.get(clave) ?? new Set()).add(nombre));
    return [];
  };

  // ── Datos oficiales en bruto (generados por los scripts de descarga) ───────
  const votaciones = new Map(); // "ambito/leg/id" → votación (+ ambito, legislatura)
  for (const ambito of carpetas(join(raiz, dir, 'votaciones'))) {
    for (const f of ficheros(join(raiz, dir, 'votaciones', ambito), '.json')) {
      const ruta = `${dir}/votaciones/${ambito}/${f}`;
      const datos = leerJson(ruta);
      if (!datos) continue;
      const leg = f.replace(/\.json$/, '');
      const l = legislaturas.get(`${ambito}/${leg}`);
      if (!l) { error(ruta, `ámbito o legislatura desconocidos (${ambito}/${leg})`); continue; }
      if (datos.ambito !== ambito || datos.legislatura !== leg) error(ruta, 'ambito/legislatura no coinciden con la ruta del fichero');
      if (!URL_OK.test(datos.fuente ?? '')) error(ruta, 'fuente debe ser un enlace http(s)');
      const otrosGrupos = new Map();
      for (const v of lista(datos.votaciones)) {
        [...(v?.grupos ?? '')].forEach((g, i) => {
          const codigo = datos.grupos?.[BASE36.indexOf(g)];
          if (g === '.' || codigo == null || codigo === SIN_GRUPO) return;
          if (!otrosGrupos.has(i)) otrosGrupos.set(i, new Set());
          otrosGrupos.get(i).add(codigo);
        });
      }
      let sinListaNominal = 0;
      for (const [i, v] of lista(datos.votaciones).entries()) {
        const donde = `${ruta} › ${v?.id ?? i}`;
        const clave = `${ambito}/${leg}/${v?.id}`;
        if (!esTexto(v?.id) || votaciones.has(clave)) { error(donde, 'id vacío o repetido'); continue; }
        votaciones.set(clave, { ...v, ambito, legislatura: leg });
        if (!fechaValida(v.fecha)) error(donde, 'fecha debe ser AAAA-MM-DD');
        else if (!enLegislatura(l, v.fecha)) aviso(donde, 'fecha fuera del periodo seguido de la legislatura');
        if (!esTexto(v.titulo)) error(donde, 'falta titulo');
        if (!TIPOS_VOTACION.includes(v.tipo)) error(donde, `tipo debe ser uno de: ${TIPOS_VOTACION.join(', ')}`);
        if (!URL_OK.test(v.url_oficial ?? '')) error(donde, 'url_oficial debe ser un enlace http(s)');

        // Recuentos y voto por partido recalculados desde el voto de cada diputado.
        if (v.asentimiento) continue;
        const votos = v.votos ?? '';
        if (!votos && Object.values(v.totales ?? {}).some((n) => n > 0)) { sinListaNominal++; continue; }
        const gruposVot = v.grupos ?? '';
        if (typeof votos !== 'string' || typeof gruposVot !== 'string' || votos.length !== gruposVot.length) {
          error(donde, '`votos` y `grupos` deben ser textos de la misma longitud'); continue;
        }
        const cuenta = { si: 0, no: 0, abstencion: 0, no_vota: 0 };
        const porPartido = new Map();
        for (let i = 0; i < votos.length; i++) {
          if (votos[i] === '.') { if (gruposVot[i] !== '.') error(donde, `posición ${i}: grupo sin voto`); continue; }
          const voto = VOTO_COMPACTO[votos[i]];
          const grupo = datos.grupos?.[BASE36.indexOf(gruposVot[i])];
          const nombre = datos.diputados?.[i];
          if (!voto || grupo == null || nombre == null) { error(donde, `posición ${i}: voto, grupo o diputado inválidos`); continue; }
          cuenta[voto]++;
          for (const id of partidosDeDiputado(ambito, leg, grupo, nombre, v.fecha, otrosGrupos.get(i))) {
            if (!porPartido.has(id)) porPartido.set(id, { si: 0, no: 0, abstencion: 0, no_vota: 0 });
            porPartido.get(id)[voto]++;
          }
        }
        for (const k of ['si', 'no', 'abstencion']) {
          if (v.totales?.[k] != null && v.totales[k] !== cuenta[k]) aviso(donde, `totales oficiales: ${k} = ${v.totales[k]}, pero la lista de diputados da ${cuenta[k]}`);
        }
        const declarado = v.por_partido ?? {};
        for (const [id, c] of porPartido) {
          const d = declarado[id];
          const esperado = votoDePartido(c);
          if (!d) { if (Object.keys(declarado).length) error(donde, `falta por_partido.${id} (ejecuta scripts/agregar_votos.py)`); continue; }
          if (d.voto !== esperado || ['si', 'no', 'abstencion', 'no_vota'].some((k) => d[k] !== c[k])) {
            error(donde, `por_partido.${id} no cuadra con el voto de sus diputados (ejecuta scripts/agregar_votos.py)`);
          }
        }
        for (const [id, d] of Object.entries(declarado)) {
          if (!VOTO_PARTIDO.includes(d?.voto)) error(donde, `por_partido.${id}: voto inválido`);
          if (!porPartido.has(id)) error(donde, `por_partido.${id}: ningún diputado de ese partido en la votación`);
        }
      }
      if (sinListaNominal) aviso(ruta, `${sinListaNominal} votación(es) con totales oficiales pero sin voto nominal publicado: no se atribuyen a partidos`);
    }
  }
  for (const clave of gruposSinEntrada) aviso(`${dir}/grupos.yml`, `${clave} sin entrada: sus votos no cuentan para ningún partido`);
  for (const [clave, nombres] of diputadosSinPartido) aviso(`${dir}/grupos.yml`, `${clave}: diputados sin partido: ${[...nombres].join('; ')}`);

  const iniciativas = new Map();
  for (const ambito of carpetas(join(raiz, dir, 'iniciativas'))) {
    for (const f of ficheros(join(raiz, dir, 'iniciativas', ambito), '.json')) {
      const ruta = `${dir}/iniciativas/${ambito}/${f}`;
      const datos = leerJson(ruta);
      if (!datos) continue;
      const leg = f.replace(/\.json$/, '');
      if (!legislaturas.has(`${ambito}/${leg}`)) { error(ruta, `ámbito o legislatura desconocidos (${ambito}/${leg})`); continue; }
      for (const [i, x] of lista(datos.iniciativas).entries()) {
        const donde = `${ruta} › ${x?.id ?? i}`;
        const clave = `${ambito}/${leg}/${x?.id}`;
        if (!esTexto(x?.id) || iniciativas.has(clave)) { error(donde, 'id vacío o repetido'); continue; }
        iniciativas.set(clave, x);
        if (!fechaValida(x.fecha)) error(donde, 'fecha debe ser AAAA-MM-DD');
        if (!esTexto(x.titulo)) error(donde, 'falta titulo');
        if (!URL_OK.test(x.url_oficial ?? '')) error(donde, 'url_oficial debe ser un enlace http(s)');
        lista(x.autor_partidos).forEach((id) => partidoConocido(donde, id));
      }
    }
  }

  const normas = new Map();
  for (const f of ficheros(join(raiz, dir, 'normas'), '.json')) {
    const ruta = `${dir}/normas/${f}`;
    const ambito = f.replace(/\.json$/, '');
    if (!ambitos.has(ambito)) { error(ruta, `ámbito desconocido: ${ambito}`); continue; }
    const datos = leerJson(ruta);
    for (const [i, n] of lista(datos?.normas).entries()) {
      const donde = `${ruta} › ${n?.id ?? i}`;
      const clave = `${ambito}/${n?.id}`;
      if (!esTexto(n?.id) || normas.has(clave)) { error(donde, 'id vacío o repetido'); continue; }
      normas.set(clave, { ...n, ambito });
      if (!fechaValida(n.fecha)) error(donde, 'fecha debe ser AAAA-MM-DD');
      if (!esTexto(n.titulo)) error(donde, 'falta titulo');
      if (!URL_OK.test(n.url ?? '')) error(donde, 'url debe ser un enlace http(s)');
    }
  }

  // ── Programas y propuestas ─────────────────────────────────────────────────
  const temas = new Set(lista(leer(`${base}/temas.yml`)));
  const propuestas = new Map(); // id → propuesta (+ partido, eleccion)
  for (const idEleccion of carpetas(join(raiz, dir, 'programas'))) {
    if (!elecciones.has(idEleccion)) error(`${dir}/programas/${idEleccion}`, 'elección desconocida (no está en elecciones.yml)');
    for (const f of ficheros(join(raiz, dir, 'programas', idEleccion), '.yml')) {
      const ruta = `${dir}/programas/${idEleccion}/${f}`;
      const prog = leer(ruta);
      if (!prog) continue;
      const idPartido = f.replace(/\.yml$/, '');
      if (prog.partido !== idPartido) error(ruta, `partido (${prog.partido}) no coincide con el nombre del fichero`);
      if (prog.eleccion !== idEleccion) error(ruta, `eleccion (${prog.eleccion}) no coincide con la carpeta`);
      partidoConocido(ruta, idPartido);
      if (!URL_OK.test(prog.url ?? '')) error(ruta, 'url del programa debe ser un enlace http(s)');
      if (!SHA256.test(prog.sha256 ?? '')) error(ruta, 'sha256 del PDF inválido');
      if (!Number.isInteger(prog.paginas) || prog.paginas < 1) error(ruta, 'paginas debe ser un número entero');
      for (const [i, q] of lista(prog.propuestas).entries()) {
        const donde = `${ruta} › ${q?.id ?? i}`;
        if (!ID.test(q?.id ?? '') || propuestas.has(q.id)) { error(donde, 'id inválido o repetido (debe ser único en todos los programas)'); continue; }
        propuestas.set(q.id, { ...q, partido: idPartido, eleccion: idEleccion });
        if (!temas.has(q.tema)) error(donde, `tema desconocido: ${q.tema}`);
        if (q.asunto != null && !ID.test(q.asunto)) error(donde, 'asunto inválido');
        if (!esTexto(q.texto)) error(donde, 'falta texto (resumen neutro)');
        if (!esTexto(q.cita)) error(donde, 'falta la cita literal del programa');
        if (!Number.isInteger(q.pagina) || q.pagina < 1 || q.pagina > prog.paginas) error(donde, 'pagina fuera del programa');
        if (!CONCRECION.includes(q.concrecion)) error(donde, `concrecion debe ser: ${CONCRECION.join(' o ')}`);
        if (!ESTADOS_PROPUESTA.includes(q.estado)) error(donde, `estado debe ser uno de: ${ESTADOS_PROPUESTA.join(', ')}`);
      }
    }
  }
  /** Solo se puede analizar lo revisado por una persona y comprobable. */
  const propuestaUsable = (donde, id) => {
    const q = propuestas.get(id);
    if (!q) { error(donde, `propuesta desconocida: ${id}`); return null; }
    if (q.estado !== 'revisada') { error(donde, `la propuesta ${id} no está revisada (${q.estado})`); return null; }
    return q;
  };

  // ── Relaciones propuesta → votación ────────────────────────────────────────
  const relaciones = new Map(); // "propuesta|votacion" → relación confirmada
  for (const f of ficheros(join(raiz, dir, 'relaciones'), '.yml')) {
    const ruta = `${dir}/relaciones/${f}`;
    const idEleccion = f.replace(/\.yml$/, '');
    if (!elecciones.has(idEleccion)) error(ruta, 'elección desconocida');
    for (const [i, r] of lista(leer(ruta)).entries()) {
      const donde = `${ruta} › ${r?.propuesta ?? i}`;
      if (!ESTADOS_RELACION.includes(r?.estado)) error(donde, `estado debe ser uno de: ${ESTADOS_RELACION.join(', ')}`);
      if (!['a_favor', 'en_contra'].includes(r?.si_equivale_a)) error(donde, 'si_equivale_a debe ser a_favor o en_contra');
      if (!votaciones.has(r?.votacion)) { error(donde, `votación desconocida: ${r?.votacion}`); continue; }
      const q = r.estado === 'confirmada' ? propuestaUsable(donde, r.propuesta) : propuestas.get(r.propuesta);
      if (!q) { if (r.estado !== 'confirmada') error(donde, `propuesta desconocida: ${r.propuesta}`); continue; }
      if (q.eleccion !== idEleccion) error(donde, `la propuesta es de ${q.eleccion}, no de ${idEleccion}`);
      if (q.concrecion !== 'medida_concreta') error(donde, 'solo se relacionan medidas concretas');
      const clave = `${r.propuesta}|${r.votacion}`;
      if (relaciones.has(clave)) error(donde, 'relación repetida');
      if (r.estado === 'confirmada') relaciones.set(clave, r);
    }
  }

  // ── Análisis propio A: programa frente a hechos ────────────────────────────
  for (const f of ficheros(join(raiz, dir, 'analisis', 'coherencia'), '.yml')) {
    const ruta = `${dir}/analisis/coherencia/${f}`;
    const idEleccion = f.replace(/\.yml$/, '');
    const eleccion = elecciones.get(idEleccion);
    if (!eleccion) { error(ruta, 'elección desconocida'); continue; }
    const vistas = new Set();
    for (const [i, a] of lista(leer(ruta)).entries()) {
      const donde = `${ruta} › ${a?.propuesta ?? i}`;
      if (vistas.has(a?.propuesta)) error(donde, 'propuesta analizada dos veces');
      vistas.add(a?.propuesta);
      const q = propuestaUsable(donde, a?.propuesta);
      if (!q) continue;
      if (q.eleccion !== idEleccion) error(donde, `la propuesta es de ${q.eleccion}, no de ${idEleccion}`);
      if (q.concrecion !== 'medida_concreta') error(donde, 'solo se analizan medidas concretas');
      if (!VALORACIONES.includes(a.valoracion)) error(donde, `valoracion debe ser una de: ${VALORACIONES.join(', ')}`);
      if (!esTexto(a.explicacion)) error(donde, 'falta explicacion');
      if (!esTexto(a.revisado_por) || !fechaValida(a.fecha_revision)) error(donde, 'análisis propio: faltan revisado_por y fecha_revision');

      const evidencias = lista(a.evidencias);
      for (const ev of evidencias) {
        const de = `${donde} › ${ev?.tipo} ${ev?.id}`;
        if (!TIPOS_EVIDENCIA.includes(ev?.tipo)) { error(de, `tipo debe ser uno de: ${TIPOS_EVIDENCIA.join(', ')}`); continue; }
        if (!SENTIDOS.includes(ev.sentido)) error(de, `sentido debe ser uno de: ${SENTIDOS.join(', ')}`);
        if (ev.tipo === 'votacion') {
          const v = votaciones.get(ev.id);
          if (!v) { error(de, 'votación desconocida'); continue; }
          const rel = relaciones.get(`${q.id}|${ev.id}`);
          if (!rel) { error(de, 'no hay relación confirmada entre esta propuesta y esta votación'); continue; }
          const voto = v.por_partido?.[q.partido]?.voto;
          if (voto == null) { error(de, `no consta el voto de ${q.partido}`); continue; }
          const esperado = sentidoDelVoto(voto, rel.si_equivale_a);
          if (ev.sentido !== esperado) error(de, `sentido debería ser «${esperado}» (votó «${voto}»)`);
          if (v.legislatura !== eleccion.legislatura && v.ambito === eleccion.ambito) aviso(de, 'votación de otra legislatura distinta a la que salió de la elección');
        } else if (ev.tipo === 'iniciativa') {
          const x = iniciativas.get(ev.id);
          if (!x) { error(de, 'iniciativa desconocida'); continue; }
          if (!lista(x.autor_partidos).includes(q.partido)) aviso(de, `${q.partido} no figura como autor de la iniciativa`);
        } else {
          const n = normas.get(ev.id);
          if (!n) { error(de, 'norma desconocida'); continue; }
          const l = legislaturas.get(`${n.ambito}/${eleccion.legislatura}`);
          if (l && !gobernaba(l, q.partido, n.fecha)) aviso(de, `${q.partido} no gobernaba cuando se aprobó la norma`);
        }
      }
      if (a.valoracion !== 'fuera_de_su_alcance') {
        const esperada = valoracionSegunEvidencias(evidencias);
        if (a.valoracion !== esperada) error(donde, `según las evidencias, la valoración es «${esperada}» (pone «${a.valoracion}»)`);
      }
    }
  }

  // ── Análisis propio B: variaciones entre programas ─────────────────────────
  for (const f of ficheros(join(raiz, dir, 'analisis', 'variaciones'), '.yml')) {
    const ruta = `${dir}/analisis/variaciones/${f}`;
    const datos = leer(ruta);
    if (!datos) continue;
    const idPartido = f.replace(/\.yml$/, '');
    if (datos.partido !== idPartido) error(ruta, 'partido no coincide con el nombre del fichero');
    for (const c of lista(datos.comparaciones)) {
      const donde = `${ruta} › ${c?.de} → ${c?.a}`;
      const de = elecciones.get(c?.de);
      const a = elecciones.get(c?.a);
      if (!de || !a) { error(donde, 'elecciones desconocidas'); continue; }
      if (de.ambito !== a.ambito) aviso(donde, 'compara elecciones de ámbitos distintos');
      if (de.fecha >= a.fecha) error(donde, '`de` debe ser anterior a `a`');
      if (!esTexto(c.revisado_por) || !fechaValida(c.fecha_revision)) error(donde, 'análisis propio: faltan revisado_por y fecha_revision');
      for (const cambio of lista(c.cambios)) {
        const dc = `${donde} › ${cambio?.tipo}`;
        if (!TIPOS_CAMBIO.includes(cambio?.tipo)) { error(dc, `tipo debe ser uno de: ${TIPOS_CAMBIO.join(', ')}`); continue; }
        const necesita = { nueva: ['despues'], retirada: ['antes'], cambiada: ['antes', 'despues'], igual: ['antes', 'despues'] }[cambio.tipo];
        for (const campo of ['antes', 'despues']) {
          if (necesita.includes(campo) !== (cambio[campo] != null)) { error(dc, `${campo} ${necesita.includes(campo) ? 'es obligatorio' : 'no corresponde'} en un cambio «${cambio.tipo}»`); continue; }
          if (cambio[campo] == null) continue;
          const q = propuestaUsable(dc, cambio[campo]);
          const eleccionEsperada = campo === 'antes' ? c.de : c.a;
          if (q && (q.partido !== idPartido || q.eleccion !== eleccionEsperada)) error(dc, `${cambio[campo]} no es de ${idPartido} en ${eleccionEsperada}`);
        }
        if (!esTexto(cambio.explicacion)) error(dc, 'falta explicacion');
      }
    }
  }
}
