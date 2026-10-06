# Elecciones: qué propone cada partido

Comparador ciudadano e independiente de las propuestas de los partidos para las **elecciones generales**, tema a tema, y de si lo que dicen coincide con lo que votaron en el Congreso («dicen vs. hacen»).

- **Cada dato con su fuente**: programa electoral (con página), votación oficial o declaración con fecha.
- **Mismas preguntas para todos los partidos.** Si uno no dice nada, aparece «no se pronuncia».
- **Sin encuestas ni recomendaciones de voto.**

La metodología completa está en [`metodologia.html`](metodologia.html).

## Cómo está organizado

```
index.html, tema.html, metodologia.html   páginas de la web
assets/                                   estilos y JavaScript (sin dependencias externas)
datos/
  meta.yml                                fecha de la votación y de la última revisión
  partidos.yml                            partidos incluidos
  temas.yml                               lista y orden de los temas
  temas/<tema>.yml                        preguntas, posiciones y votaciones de cada tema
  ejemplo/                                datos FICTICIOS para la demo (?demo en la URL)
scripts/validar.mjs                       comprueba que los datos están bien formados
```

Toda la información vive en los ficheros `datos/*.yml`. Para actualizar la web basta con editarlos: no hay que tocar código.

## Cómo añadir datos

### 1. Añadir un partido (`datos/partidos.yml`)

```yaml
- id: nombre-corto            # minúsculas y guiones; se usa en el resto de ficheros
  nombre: Nombre del partido
  siglas: SIGLAS
  color: "#777777"
  web: https://...
  programa: https://...       # vacío hasta que se publique
  grupo_parlamentario: Grupo en la legislatura anterior
  nota: Opcional, p. ej. «concurre en coalición con…»
```

### 2. Añadir la posición de un partido (`datos/temas/<tema>.yml`)

Dentro de la pregunta correspondiente, en `posiciones`:

```yaml
  - id: alquiler-limite
    tipo: si_no
    pregunta: "¿Limitar por ley el precio del alquiler en zonas de mercado tensionado?"
    posiciones:
      nombre-corto:
        postura: a_favor          # a_favor | en_contra | matizada | no_se_pronuncia
        resumen: Una o dos frases neutras explicando la propuesta.
        cita: "Texto literal del programa."     # opcional pero muy recomendable
        fuente:
          tipo: programa          # programa | declaracion | votacion | otro
          titulo: Programa electoral 2026
          url: https://...
          pagina: 42              # opcional
          fecha: 2026-11-20       # obligatoria en declaraciones (AAAA-MM-DD)
```

- En las preguntas `abierta` no se pone `postura`, solo `resumen` (y la fuente).
- Si el programa no dice nada, pon `postura: no_se_pronuncia` y un resumen del tipo «Su programa no menciona…». En ese caso la fuente es opcional.
- Si un partido no aparece en `posiciones`, la web muestra «Pendiente de revisar».

### 3. Añadir una votación del Congreso («dicen vs. hacen»)

En la lista `votaciones` del tema:

```yaml
votaciones:
  - id: ley-vivienda-2023
    titulo: Ley por el derecho a la vivienda
    fecha: 2023-04-27
    tipo: votacion_final      # votacion_final | toma_en_consideracion | enmienda_totalidad | convalidacion | mocion | otra
    descripcion: Qué se votaba, en una frase neutra.
    url: https://www.congreso.es/...   # enlace a la votación oficial
    resultado: Aprobada
    relacionada_con:
      - pregunta: alquiler-limite
        si_equivale_a: a_favor  # qué significaba votar «sí» respecto a esa pregunta
    votos:
      nombre-corto: si          # si | no | abstencion | dividido | no_presente
    nota: Contexto opcional (p. ej. «la ley incluía además…»).
```

### 4. Comprobar y publicar

```bash
node scripts/validar.mjs      # comprueba los datos; no necesita instalar nada
python3 -m http.server        # y abre http://localhost:8000 para verlo en local
```

La validación también se ejecuta automáticamente en GitHub en cada cambio (pestaña *Actions*).

También se pueden editar los ficheros directamente desde la web de GitHub (icono del lápiz). La validación avisará si algo está mal.

## Publicar la web (GitHub Pages)

1. El repositorio debe ser público: *Settings → General → Danger Zone → Change visibility*.
2. *Settings → Pages → Build and deployment*: en *Source* elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`.
3. En un par de minutos estará en `https://gavilanp.github.io/elecciones/`.

## Licencias

- Código: [MIT](LICENSE).
- Contenidos (`datos/` y textos de la web): [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es). Puedes reutilizarlos citando la fuente y con la misma licencia.
- [js-yaml](https://github.com/nodeca/js-yaml) (incluido en `assets/vendor/`): MIT.
