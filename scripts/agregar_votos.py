#!/usr/bin/env python3
"""Calcula el voto de cada partido a partir del voto de cada diputado.

Lee los ficheros compactos de datos/seguimiento/votaciones/<ambito>/<legislatura>.json
(generados por los scripts de descarga) y la tabla datos/seguimiento/grupos.yml
(grupo parlamentario → partido), y escribe en cada votación:

  por_partido: { <partido>: { voto, si, no, abstencion, no_vota } }

Regla del voto de un partido (la misma que comprueba scripts/seguimiento.mjs):
  - sin ningún voto emitido (sí, no o abstención)          → no_presente
  - una opción reúne al menos 2/3 de los votos emitidos     → esa opción
  - en otro caso                                            → dividido
Los recuentos se guardan siempre, así que un voto suelto en contra queda a la vista.

No usa IA. Al final lista los grupos y diputados que aún no tienen partido asignado
en grupos.yml, para completarlo.

Uso:
  python3 scripts/agregar_votos.py              # todos los ámbitos y legislaturas
  python3 scripts/agregar_votos.py --datos datos/ejemplo/seguimiento
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent
BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"
CLAVE = {"S": "si", "N": "no", "A": "abstencion", "X": "no_vota"}


def voto_de_partido(cuenta):
    emitidos = cuenta["si"] + cuenta["no"] + cuenta["abstencion"]
    if not emitidos:
        return "no_presente"
    opcion, n = max(((k, cuenta[k]) for k in ("si", "no", "abstencion")), key=lambda kv: kv[1])
    return opcion if 3 * n >= 2 * emitidos else "dividido"


def cargar_grupos(dir_datos):
    tabla = {}
    for g in yaml.safe_load((dir_datos / "grupos.yml").read_text("utf-8")) or []:
        tabla[(g["ambito"], str(g["legislatura"]), g["grupo"])] = g
    return tabla


def agregar_fichero(ruta, ambito, grupos, sin_asignar):
    datos = json.loads(ruta.read_text("utf-8"))
    leg = datos["legislatura"]
    diputados, codigos = datos["diputados"], datos["grupos"]

    def partidos_de(i, codigo):
        g = grupos.get((ambito, leg, codigo))
        if g is None:
            sin_asignar[(ambito, leg, codigo)].add(None)
            return []
        if g.get("diputados") is not None:
            partido = g["diputados"].get(diputados[i])
            if partido is None:
                sin_asignar[(ambito, leg, codigo)].add(diputados[i])
                return []
            return [partido]
        return g.get("partidos") or []

    for v in datos["votaciones"]:
        cuentas = defaultdict(lambda: Counter(si=0, no=0, abstencion=0, no_vota=0))
        for i, (voto, g) in enumerate(zip(v.get("votos", ""), v.get("grupos", ""))):
            if voto == ".":
                continue
            for partido in partidos_de(i, codigos[BASE36.index(g)]):
                cuentas[partido][CLAVE[voto]] += 1
        v["por_partido"] = {p: {"voto": voto_de_partido(c), **dict(c)} for p, c in sorted(cuentas.items())}

    ruta.write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    return len(datos["votaciones"])


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--datos", default="datos/seguimiento", help="carpeta del modelo de seguimiento")
    args = p.parse_args()
    dir_datos = (RAIZ / args.datos).resolve()

    grupos = cargar_grupos(dir_datos)
    sin_asignar = defaultdict(set)
    for ruta in sorted((dir_datos / "votaciones").glob("*/*.json")):
        n = agregar_fichero(ruta, ruta.parent.name, grupos, sin_asignar)
        print(f"{ruta.relative_to(RAIZ)}: {n} votaciones agregadas")

    if sin_asignar:
        print("\nPendiente de asignar en grupos.yml:")
        for (ambito, leg, codigo), nombres in sorted(sin_asignar.items()):
            if None in nombres:
                print(f"  - {ambito} {leg}: grupo «{codigo}» sin entrada")
            else:
                print(f"  - {ambito} {leg}: grupo «{codigo}», diputados sin partido: {'; '.join(sorted(nombres))}")
    sys.exit(0)


if __name__ == "__main__":
    main()
