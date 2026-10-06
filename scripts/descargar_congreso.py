#!/usr/bin/env python3
"""Descarga las votaciones del Pleno del Congreso desde sus datos abiertos.

Fuente: https://www.congreso.es/es/opendata/votaciones (una página por legislatura con
los días con votaciones; en la página de cada día, un JSON por votación con el voto de
cada diputado). No usa IA: solo copia y compacta los datos oficiales.

Salida: datos/seguimiento/votaciones/congreso/<legislatura>.json, en formato compacto:

  diputados   lista de nombres (el índice de cada uno se usa en `votos` y `grupos`)
  grupos      lista de códigos de grupo tal y como vienen en los datos oficiales (GS, GP…)
  votaciones  una entrada por votación, con:
    votos     un carácter por diputado: S sí, N no, A abstención, X no vota,
              «.» no figura en esa votación
    grupos    un carácter por diputado: índice en `grupos` en base 36 («.» si no figura)

Las legislaturas y el periodo seguido salen de datos/seguimiento/elecciones.yml.
El voto agregado por partido lo añade después scripts/agregar_votos.py.

Uso:
  python3 scripts/descargar_congreso.py              # todas las legislaturas, solo lo nuevo
  python3 scripts/descargar_congreso.py XV           # una legislatura
  python3 scripts/descargar_congreso.py XV --rehacer # vuelve a descargarla entera

Formato de la web oficial estudiado a partir del proyecto Escrutinio (MIT,
https://github.com/migueltubia/escrutinio); el código es propio.
"""

import argparse
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent
SEGUIMIENTO = RAIZ / "datos" / "seguimiento"
SALIDA = SEGUIMIENTO / "votaciones" / "congreso"

CONGRESO = "https://www.congreso.es"
VOTACIONES_URL = CONGRESO + "/es/opendata/votaciones"
USER_AGENT = "elecciones/1.0 (comparador ciudadano de datos abiertos del Congreso)"

DIAS_RE = re.compile(r"diasVotaciones\s*=\s*\[([^\]]*)\]")
JSON_RE = re.compile(r"/webpublica/opendata/votaciones/Leg(\d+)/Sesion(\d+)/(\d{8})/Votacion(\d+)/[^\"'\s]+?\.json")

ROMANOS = {"X": 10, "XI": 11, "XII": 12, "XIII": 13, "XIV": 14, "XV": 15, "XVI": 16, "XVII": 17}
VOTO = {"sí": "S", "si": "S", "no": "N", "abstención": "A", "abstencion": "A", "no vota": "X"}
BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def descargar(url, reintentos=5, espera=60):
    """GET con reintentos. Devuelve bytes; un 404 se propaga sin reintentar."""
    ultimo = None
    for intento in range(reintentos):
        try:
            peticion = urllib.request.Request(url, headers={
                "User-Agent": USER_AGENT,
                "Accept": "*/*",
                "Accept-Language": "es-ES,es;q=0.9",
                "Accept-Encoding": "gzip",
            })
            with urllib.request.urlopen(peticion, timeout=espera) as r:
                datos = r.read()
                return gzip.decompress(datos) if r.headers.get("Content-Encoding") == "gzip" else datos
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            ultimo = e
        except Exception as e:  # red, tiempo de espera, gzip truncado
            ultimo = e
        time.sleep(2 * (intento + 1))
    raise RuntimeError(f"No se pudo descargar {url}: {ultimo}")


def url_legislatura(romano):
    return (f"{VOTACIONES_URL}?p_p_id=votaciones&p_p_lifecycle=0&p_p_state=normal&p_p_mode=view"
            f"&targetLegislatura={romano}")


def dias_con_votaciones(romano):
    html = descargar(url_legislatura(romano)).decode("utf-8", "replace")
    m = DIAS_RE.search(html)
    if not m:
        raise RuntimeError(f"No se encuentra la lista de días en la página de la legislatura {romano}: ¿ha cambiado la web?")
    return sorted({f"{d[:4]}-{d[4:6]}-{d[6:]}" for d in re.findall(r"\d{8}", m.group(1))})


def urls_del_dia(romano, fecha):
    a, m, d = fecha.split("-")
    html = descargar(url_legislatura(romano) + f"&targetDate={d}/{m}/{a}").decode("utf-8", "replace")
    urls = {}
    for match in JSON_RE.finditer(html):
        leg, sesion, dia, numero = match.groups()
        if int(leg) == ROMANOS[romano] and dia == f"{a}{m}{d}":
            urls.setdefault((int(sesion), int(numero)), CONGRESO + match.group(0))
    return [urls[k] for k in sorted(urls)]


def tipo_de_votacion(texto):
    """Clasificación orientativa a partir del título oficial (sin IA)."""
    t = texto.lower()
    if "toma en consideración" in t:
        return "toma_en_consideracion"
    if "convalidación" in t or "convalidacion" in t:
        return "convalidacion"
    if "totalidad" in t:
        return "enmienda_totalidad"
    if "votación de conjunto" in t or "votación final" in t or "votacion de conjunto" in t:
        return "votacion_final"
    if "moción" in t or "proposición no de ley" in t or "mocion" in t:
        return "mocion"
    return "otra"


def entero(valor):
    try:
        return int(valor)
    except (TypeError, ValueError):
        return None


class Legislatura:
    """Fichero compacto de una legislatura, que se va completando día a día."""

    def __init__(self, romano, ruta):
        self.romano, self.ruta = romano, ruta
        previo = json.loads(ruta.read_text("utf-8")) if ruta.exists() else {}
        self.diputados = previo.get("diputados", [])
        self.grupos = previo.get("grupos", [])
        self.votaciones = {v["id"]: v for v in previo.get("votaciones", [])}
        self._idx_dip = {n: i for i, n in enumerate(self.diputados)}
        self._idx_grupo = {g: i for i, g in enumerate(self.grupos)}

    def fechas(self):
        return {v["fecha"] for v in self.votaciones.values()}

    def _indice(self, valor, lista, indice):
        if valor not in indice:
            indice[valor] = len(lista)
            lista.append(valor)
        return indice[valor]

    def anadir(self, url, crudo):
        datos = json.loads(crudo.decode("utf-8-sig"))
        info, tot = datos.get("informacion") or {}, datos.get("totales") or {}
        m = JSON_RE.search(url)
        _, sesion_url, dia_url, numero_url = m.groups()
        if info.get("fecha"):
            fecha = datetime.strptime(info["fecha"].strip(), "%d/%m/%Y").strftime("%Y-%m-%d")
        else:
            fecha = f"{dia_url[:4]}-{dia_url[4:6]}-{dia_url[6:]}"
        sesion = entero(info.get("sesion")) or int(sesion_url)
        numero = entero(info.get("numeroVotacion")) or int(numero_url)

        votos, grupos = {}, {}
        for v in datos.get("votaciones") or []:
            nombre = (v.get("diputado") or "").strip()
            if not nombre:
                continue
            voto = VOTO.get((v.get("voto") or "").strip().lower())
            if voto is None:
                raise ValueError(f"voto desconocido «{v.get('voto')}» de {nombre}")
            grupo = (v.get("grupo") or "").strip() or "?"
            i = self._indice(nombre, self.diputados, self._idx_dip)
            votos[i] = voto
            grupos[i] = self._indice(grupo, self.grupos, self._idx_grupo)
        if len(self.grupos) > len(BASE36):
            raise ValueError("demasiados grupos para el formato compacto")

        titulo = (info.get("titulo") or "").strip()
        expediente = (info.get("textoExpediente") or "").strip()
        subgrupo = " ".join(filter(None, [(info.get("tituloSubGrupo") or "").strip(), (info.get("textoSubGrupo") or "").strip()]))
        id_ = f"{fecha}/{sesion}-{numero}"
        self.votaciones[id_] = {
            "id": id_,
            "fecha": fecha,
            "sesion": sesion,
            "numero": numero,
            "titulo": titulo or expediente or f"Votación {numero} de la sesión {sesion}",
            "expediente": expediente,
            "subgrupo": subgrupo,
            "tipo": tipo_de_votacion(" ".join([titulo, expediente, subgrupo])),
            "url_oficial": url,
            "asentimiento": str(tot.get("asentimiento", "")).strip().lower().startswith("s"),
            "totales": {
                "si": entero(tot.get("afavor")),
                "no": entero(tot.get("enContra")),
                "abstencion": entero(tot.get("abstenciones")),
                "no_vota": entero(tot.get("noVotan")),
            },
            "votos": "".join(votos.get(i, ".") for i in range(len(self.diputados))).rstrip("."),
            "grupos": "".join(BASE36[grupos[i]] if i in grupos else "." for i in range(len(self.diputados))).rstrip("."),
        }

    def quitar_dia(self, fecha):
        self.votaciones = {k: v for k, v in self.votaciones.items() if v["fecha"] != fecha}

    def guardar(self):
        ordenadas = sorted(self.votaciones.values(), key=lambda v: (v["fecha"], v["sesion"], v["numero"]))
        salida = {
            "ambito": "congreso",
            "legislatura": self.romano,
            "fuente": VOTACIONES_URL,
            "generado": date.today().isoformat(),
            "formato": "votos: S sí, N no, A abstención, X no vota, «.» no figura; grupos: índice en base 36",
            "diputados": self.diputados,
            "grupos": self.grupos,
            "votaciones": ordenadas,
        }
        self.ruta.parent.mkdir(parents=True, exist_ok=True)
        temporal = self.ruta.with_suffix(".tmp")
        temporal.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
        temporal.replace(self.ruta)


def legislaturas_seguidas():
    datos = yaml.safe_load((SEGUIMIENTO / "elecciones.yml").read_text("utf-8")) or {}
    return [l for l in datos.get("legislaturas") or [] if l.get("ambito") == "congreso"]


def procesar(leg, rehacer, hilos, log):
    romano = leg["id"]
    if romano not in ROMANOS:
        raise ValueError(f"legislatura desconocida: {romano}")
    desde = str(leg.get("seguimiento_desde") or leg["inicio"])
    hasta = str(leg["fin"]) if leg.get("fin") else "9999-12-31"
    ruta = SALIDA / f"{romano}.json"
    if rehacer and ruta.exists():
        ruta.unlink()
    datos = Legislatura(romano, ruta)

    dias = [d for d in dias_con_votaciones(romano) if desde <= d <= hasta]
    hechos = datos.fechas()
    # El último día ya descargado se repite por si quedó a medias.
    ultimo = max(hechos) if hechos else None
    pendientes = [d for d in dias if d not in hechos or d == ultimo]
    log(f"Legislatura {romano}: {len(dias)} días con votaciones desde {desde}; {len(pendientes)} por descargar")

    errores = 0
    with ThreadPoolExecutor(hilos) as ex:
        for n, fecha in enumerate(pendientes, 1):
            try:
                urls = urls_del_dia(romano, fecha)
                crudos = list(ex.map(descargar, urls))
                for url, crudo in zip(urls, crudos):
                    datos.anadir(url, crudo)
            except Exception as e:  # se informa y se sigue con el resto de días
                datos.quitar_dia(fecha)  # sin días a medias: se reintentará entero
                errores += 1
                log(f"  ! {fecha}: {e}")
                continue
            if n % 20 == 0:
                datos.guardar()
                log(f"  {n}/{len(pendientes)} días")
    datos.guardar()
    log(f"  {len(datos.votaciones)} votaciones guardadas en {ruta.relative_to(RAIZ) if ruta.is_relative_to(RAIZ) else ruta}; {errores} día(s) con error")
    return errores


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("legislaturas", nargs="*", help="p. ej. XIV XV (por defecto, todas las de elecciones.yml)")
    p.add_argument("--rehacer", action="store_true", help="descarga de nuevo la legislatura entera")
    p.add_argument("--hilos", type=int, default=4, help="descargas simultáneas (no abusar de la web oficial)")
    args = p.parse_args()

    seguidas = legislaturas_seguidas()
    if args.legislaturas:
        desconocidas = set(args.legislaturas) - {l["id"] for l in seguidas}
        if desconocidas:
            sys.exit(f"Legislaturas que no están en elecciones.yml: {', '.join(sorted(desconocidas))}")
        seguidas = [l for l in seguidas if l["id"] in args.legislaturas]

    errores = sum(procesar(l, args.rehacer, args.hilos, lambda t: print(t, flush=True)) for l in seguidas)
    sys.exit(1 if errores else 0)


if __name__ == "__main__":
    main()
