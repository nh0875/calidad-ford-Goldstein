# Logos de las marcas (para el Word del RQR)

Acá va el logo que se imprime arriba del formulario de RQR que se exporta a Word.

## Qué archivo poner

El nombre del archivo lo determina la marca de la instancia (variable `MARCA`):

| MARCA | Archivo esperado |
|---|---|
| `FORD` | `logo-ford.png` |
| `VOLKSWAGEN` | `logo-volkswagen.png` |

Se puede forzar otra ruta con la variable de entorno `LOGO_MARCA_ARCHIVO`
(ruta absoluta), útil si el logo se monta desde afuera del contenedor.

## Formato

- **PNG** con fondo transparente.
- Ancho recomendado: entre 400 y 800 px. El documento lo escala a 45 mm de ancho
  manteniendo la proporción, así que lo que importa es que se vea nítido.

## Si el archivo no está

El Word se genera igual, sin el logo y sin ningún error: la exportación NUNCA
falla por un logo faltante. En el log del backend queda un aviso una sola vez.

Los logos NO se versionan en git (son material de marca de terceros): están
ignorados en `.gitignore`. Hay que copiarlos a mano en cada despliegue, o
montarlos como volumen.
