# Plan de datos: programas electorales vs. votaciones (Congreso + autonomías) desde junio de 2018

## Contexto
Ahora la web compara lo que propone cada partido para las próximas generales con algunas votaciones del Congreso añadidas a mano. Queremos ampliarla al periodo de Pedro Sánchez, desde el 2 de junio de 2018:
- **Partimos del programa de cada partido.** Solo aparece lo que ese partido propuso y lo que votó después sobre esas propuestas. Si algo no está en su programa, no se le pregunta. Ya no habrá filas de «no se pronuncia».
- **Congreso y parlamentos autonómicos**, solo votaciones de pleno.
- **Las marcas regionales se tratan como el mismo partido** (por ejemplo, PSC y PSOE) y los partidos nacionalistas o independentistas se siguen en los dos ámbitos.
- Empezamos con el **Congreso y 1 o 2 comunidades piloto**, la IA solo propone y una persona revisa, y las votaciones se descargan **todas en bruto** para elegir después las relevantes.

En esta fase lo importante es **definir exactamente qué datos se sacan y de dónde**. La web viene después.

> **Ubicación:** todo este modelo vive en `datos/seguimiento/` (y su versión ficticia en `datos/ejemplo/seguimiento/`) para no tocar la web actual hasta la fase 7. Las rutas de abajo son relativas a esa carpeta.
>
> **Nota:** en junio de 2018 la legislatura vigente (XII) salió de las generales de **2016**, así que el programa de 2016 es el que se contrasta con lo votado entre junio de 2018 y marzo de 2019.

## Qué hace cada cosa: script normal o IA
| Dato | Cómo se obtiene | ¿IA? |
|---|---|---|
| Votaciones del Congreso (quién votó qué) | Script en Python con los datos abiertos oficiales (JSON o XML de cada votación, voto de cada diputado) | **No** |
| Votaciones autonómicas con datos estructurados | Script en Python con cada parlamento | **No** |
| Votaciones autonómicas que solo están en PDF (diarios de sesiones) | Script que extrae el texto, con la IA como apoyo solo si el formato es irregular. Los recuentos se comprueban con el resultado oficial. | Solo si hace falta |
| Propuestas de los programas (PDF de decenas o cientos de páginas) | La IA propone cada propuesta con cita literal y página. Un script comprueba que la cita existe en el PDF. Una persona revisa. | **Sí, con verificación** |
| Qué votación corresponde a qué propuesta | La IA sugiere candidatas buscando en los títulos de las votaciones y una persona confirma | Sugerencia, decide una persona |
| Partidos, marcas regionales, coaliciones y grupos | Tabla hecha a mano (son pocas decenas de filas) | **No** |

## Datos exactos que se sacan

### 1. Partidos y marcas (`datos/partidos.yml`, a mano)
Se separa el **partido**, que es la identidad que se compara, de la **marca**, que es el nombre con el que se presenta en cada sitio y elección.
```yaml
- id: psoe
  nombre: Partido Socialista Obrero Español
  tipo: estatal               # estatal | nacionalista | regional
  marcas:
    - { siglas: PSOE, ambito: congreso, desde: 2018-06-02 }
    - { siglas: PSC-PSOE, ambito: cataluna, desde: 2018-06-02 }
- id: erc
  nombre: Esquerra Republicana de Catalunya
  tipo: nacionalista
  ambitos: [congreso, cataluna]   # se sigue en los dos
```
- **Coaliciones** (Unidas Podemos, Sumar, Navarra Suma, EH Bildu…): se registran como marca con `miembros: [...]`, con su fecha de inicio y de fin.
- **Grupos parlamentarios** (`datos/grupos.yml`): para cada legislatura y parlamento, qué grupo corresponde a qué partido o partidos. Es necesario porque el voto oficial se publica por diputado y grupo, no por partido. El Grupo Mixto se reparte diputado a diputado.

### 2. Elecciones y legislaturas (`datos/elecciones.yml`, a mano)
`id`, `ambito`, `fecha`, `legislatura_resultante`, `fecha_inicio` y `fecha_fin` de la legislatura. Generales: 2019-04, 2019-11, 2023 y las siguientes. Autonómicas: todas las de cada comunidad piloto desde 2018.

### 3. Programas (`datos/programas/<eleccion>/<partido>.yml`)
- Metadatos: `url` del PDF oficial, `sha256`, `paginas` y `fecha_descarga`. Se guarda también una copia del PDF, porque los partidos los borran de sus webs.
- **Propuestas** (la unidad básica, sacada del programa):
```yaml
propuestas:
  - id: psoe-g2023-alquiler-tope
    tema: vivienda                 # uno de datos/temas.yml
    asunto: alquiler-limite        # etiqueta común para comparar partidos (opcional)
    texto: Resumen neutro de una frase.
    cita: "Texto literal del programa."
    pagina: 42
    concrecion: medida_concreta    # medida_concreta | objetivo_general
    estado: propuesta_ia           # propuesta_ia | revisada | descartada
```
- Se registran solo las **medidas que se pueden comprobar** (`medida_concreta`). Las declaraciones genéricas («mejoraremos la sanidad») se marcan como `objetivo_general` y no se cruzan con votaciones.
- El campo `asunto` sirve para comparar partidos solo cuando dos o más proponen algo sobre lo mismo. **Ya no hay cuestionario común obligatorio.**

### 4. Votaciones en bruto (`datos/votaciones/<ambito>/<legislatura>.json`, generadas por script)
Para cada votación de pleno se guarda:
- `id`, `fecha`, `sesion`, `numero`, `titulo` y `expediente`.
- `tipo`: votación final, toma en consideración, enmienda a la totalidad, convalidación, moción o PNL, u otra.
- `resultado`, `url_oficial` y los recuentos totales.
- **Voto de cada diputado** (nombre, grupo y voto), solo donde el parlamento lo publique.
- **Voto agregado por partido**, calculado con `grupos.yml`: sí, no, abstención y no votó. Se marca `dividido` si el partido no votó en bloque.

> **Implementado (fase 2):** `scripts/descargar_congreso.py` + `scripts/agregar_votos.py`. Formato compacto: lista de `diputados` y de códigos de `grupos` por legislatura, y en cada votación un carácter por diputado (`S` sí, `N` no, `A` abstención, `X` no vota, `.` no figura). `por_partido` guarda los recuentos y el voto, que es la opción con al menos 2/3 de los votos emitidos o, si ninguna llega, `dividido`. No se guarda «aprobada/rechazada», porque depende de la mayoría exigida en cada caso: se muestran los recuentos oficiales.

### 5. Relaciones propuesta → votación (`datos/relaciones/<eleccion>.yml`, revisado a mano)
```yaml
- propuesta: psoe-g2023-alquiler-tope
  votacion: congreso/XV/2024-03-14/12
  si_equivale_a: a_favor      # qué significa votar «sí» respecto a la propuesta
  ambito_voto: congreso       # permite cruzar el programa autonómico de ERC con su voto en el Congreso, y al revés
  estado: sugerida_ia         # sugerida_ia | confirmada
  nota: Contexto si la ley incluía más cosas.
```
Una propuesta se cruza con las votaciones **de la legislatura que salió de esa elección** y del mismo ámbito. Para los partidos que están en los dos ámbitos, como ERC, Junts, PNV, Bildu, BNG o CC, se pueden añadir también las relaciones con el otro ámbito.

### 6. Lo que han propuesto y hecho, además de votar (generado por script, sin IA)
- **Iniciativas presentadas por cada grupo** (proposiciones de ley, PNL, mociones y enmiendas) en el Congreso y en cada parlamento piloto. Se guardan `autor`, `titulo`, `fecha`, `tramitacion` y `url_oficial`, y se enlazan a las propuestas igual que las votaciones.
- **Acción de gobierno** del partido que gobierna, en España o en la comunidad: decretos-ley, proyectos de ley aprobados y leyes publicadas en el BOE o en el boletín autonómico. Se guardan `boe_id`, `titulo`, `fecha` y `url`, con el mismo enlace a las propuestas.

## Tres capas, siempre separadas en la web
1. **Datos oficiales:** votaciones, iniciativas y BOE. Se muestran tal cual y con su enlace.
2. **Programas:** cita literal con página, extraída y revisada.
3. **Análisis propio**, marcado siempre como «Elaborado por nosotros», con fecha, criterio y enlace a la metodología. Tiene dos apartados:

### A. Variaciones entre programas (`datos/analisis/variaciones_programa/<partido>.yml`)
Compara el programa de un partido en elecciones consecutivas del mismo ámbito (por ejemplo, PSOE en abril de 2019, noviembre de 2019 y 2023):
- `nueva`: aparece por primera vez.
- `retirada`: estaba antes y desaparece.
- `cambiada`: el mismo asunto con otra postura o cifra. Se muestran las dos citas, una al lado de la otra.
- `igual`: no se muestra por defecto.

La IA empareja las propuestas por `asunto` y por parecido del texto, y una persona revisa. **Comparar programas del mismo partido en ámbitos distintos** (por ejemplo, ERC en el Congreso y en el Parlament) se deja como apartado opcional para más adelante.

### B. Programa frente a hechos (el apartado más importante) (`datos/analisis/coherencia/<eleccion>.yml`)
Para cada propuesta revisada y con `medida_concreta`, durante la legislatura que salió de esa elección:
```yaml
- propuesta: psoe-g2023-alquiler-tope
  valoracion: coherente      # coherente | contradictoria | mixta | sin_actuacion | fuera_de_su_alcance
  evidencias:                 # votaciones, iniciativas o normas, cada una con su enlace oficial
    - { tipo: votacion, id: congreso/XV/2024-03-14/12, sentido: a_favor }
    - { tipo: iniciativa, id: congreso/XV/122-000045 }
  explicacion: Una o dos frases neutras.
  revisado_por: ...          # quién y cuándo
  fecha_revision: 2026-10-06
```
- **Reglas fijas y públicas.** `coherente`: todas las evidencias van en el sentido de la propuesta. `contradictoria`: alguna va en contra y ninguna a favor. `mixta`: hay de los dos tipos. `sin_actuacion`: no hay ninguna evidencia. `fuera_de_su_alcance`: la competencia era de otro nivel de gobierno.
- La valoración se calcula automáticamente a partir de las evidencias confirmadas. **La IA no decide la valoración**, solo sugiere evidencias. La `explicacion` la escribe o la revisa una persona.
- Se distingue si el partido estaba **en el gobierno o en la oposición**, porque no se le puede exigir lo mismo.

## Scripts (`scripts/`)
- `descargar_congreso.py`: votaciones desde el 2018-06-02 (legislaturas XII, a partir de esa fecha, XIII, XIV y XV en adelante). Solo descarga lo nuevo.
- `descargar_<ccaa>.py`: uno por comunidad piloto.
- `agregar_votos.py`: pasa del voto por diputado al voto por partido usando `grupos.yml`.
- `extraer_programa.py <eleccion> <partido>`: convierte el PDF a texto por página. Después la IA (API de Claude, con `ANTHROPIC_API_KEY` como secreto) propone las propuestas, y se descarta cualquier propuesta cuya cita no aparezca literalmente en su página. **A la IA nunca se le enseñan las votaciones.**
- `sugerir_relaciones.py`: para cada propuesta revisada, busca votaciones candidatas por título y fecha. La IA ordena las candidatas y una persona confirma.
- `descargar_iniciativas.py` y `descargar_boe.py`: iniciativas por autor y normas publicadas (la API de datos abiertos del BOE), sin IA.
- `comparar_programas.py`: empareja las propuestas entre elecciones consecutivas para el apartado A, y la IA sugiere.
- `calcular_coherencia.py`: aplica las reglas del apartado B a las evidencias confirmadas. Es determinista.
- `validar.mjs` (se amplía): comprueba la integridad, que no se publique nada sin revisar y que todos los grupos tengan su partido asignado.

## Limitación del entorno
Desde aquí `www.congreso.es` está **bloqueado**. Las descargas se ejecutarán en **GitHub Actions** con un workflow semanal (`actualizar-votaciones.yml`) que hace commit de los JSON. La otra opción es que añadas el dominio en *Network access → Allowed domains* (https://code.claude.com/docs/en/cloud-environments#network-access).

## Fases
1. **Modelo de datos.** Preparar `partidos.yml` (con marcas y coaliciones), `grupos.yml` y `elecciones.yml` para el Congreso, y ampliar el validador. Se rellenan con datos ficticios en `datos/ejemplo/`.
2. **Votaciones del Congreso.** Escribir `descargar_congreso.py` y `agregar_votos.py`, y montar el workflow. Esta parte es 100 % automática y sin IA.
3. **Programas de las generales** (2019-A, 2019-N y 2023) de los partidos con representación. Se extraen con IA y se revisan.
4. **Relaciones.** Las sugiere la IA y una persona las confirma.
5. **Elegir las comunidades piloto.** Primero hay que investigar qué parlamentos publican el voto por grupo o por diputado. Después, sus scripts y sus programas autonómicos.
6. **Análisis propio**: hacer el apartado B (programa frente a hechos) en el Congreso y, después, el apartado A (variaciones entre programas).
7. **Web.** Cada bloque de análisis propio lleva la etiqueta «Elaborado por nosotros». Vista por partido (sus propuestas y cómo votó), comparación por `asunto` y vista de evolución entre elecciones. Hay que actualizar `metodologia.html`, porque el principio de «mismas preguntas para todos» pasa a ser «solo lo que cada partido propuso».

## Verificación
- `node scripts/validar.mjs` sin errores, incluido `datos/ejemplo/`.
- Congreso: comparar 5 votaciones al azar con la web oficial (recuentos y voto agregado por partido).
- Marcas: comprobar que el voto de PSC en el Parlament y el de PSOE en el Congreso aparecen bajo el partido `psoe`.
- Programas: todas las citas pasan la verificación literal, y se revisa a mano una muestra del 10 %.
- Web: `python3 -m http.server`, revisada en Chromium en escritorio y en móvil.
