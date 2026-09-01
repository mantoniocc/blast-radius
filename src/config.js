import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'

/**
 * Error de configuracion del consumidor, distinto de un fallo interno.
 * La distincion importa porque el mensaje que le mostramos al usuario
 * debe decirle como arreglar SU archivo, no exponer nuestro stack trace.
 */
export class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * Carga y valida el archivo de configuracion de servicios.
 *
 * Formato esperado:
 *   services:
 *     api:
 *       paths: [services/api]
 *       depends-on: [shared]
 *     shared:
 *       paths: [libs/shared]
 *
 * @param {string} path Ruta al archivo YAML
 * @returns {Promise<Map<string, {paths: string[], dependsOn: string[]}>>}
 */
export async function loadConfig(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    // ENOENT es el unico error que sabemos traducir a algo accionable.
    // Cualquier otro (permisos, es un directorio) se propaga tal cual:
    // inventar un mensaje generico esconderia la causa real.
    if (err.code === 'ENOENT') {
      throw new ConfigError(
        `No existe el archivo de configuracion '${path}'. ` +
          `Crealo o ajusta el input 'config-path'.`
      )
    }
    throw err
  }

  let doc
  try {
    doc = parse(raw)
  } catch (err) {
    // El parser de YAML da mensajes con linea y columna. Los conservamos
    // en vez de reemplazarlos por uno propio menos preciso.
    throw new ConfigError(`'${path}' no es YAML valido: ${err.message}`)
  }

  if (!doc || typeof doc !== 'object' || !doc.services) {
    throw new ConfigError(`'${path}' debe tener una clave 'services' en la raiz.`)
  }

  const services = new Map()

  for (const [name, spec] of Object.entries(doc.services)) {
    if (!spec || !Array.isArray(spec.paths) || spec.paths.length === 0) {
      throw new ConfigError(
        `El servicio '${name}' debe declarar 'paths' como una lista no vacia.`
      )
    }

    services.set(name, {
      paths: spec.paths,
      // 'depends-on' en YAML (kebab-case, consistente con los inputs de
      // actions) se normaliza a dependsOn en JS. La conversion se hace
      // aqui, en el limite del sistema, para que el resto del codigo
      // trabaje con una sola convencion.
      dependsOn: spec['depends-on'] ?? []
    })
  }

  if (services.size === 0) {
    throw new ConfigError(`'${path}' no declara ningun servicio.`)
  }

  // Validar que las dependencias apunten a servicios existentes.
  // Sin esto, un typo en 'depends-on' se ignoraria en silencio y el
  // servicio nunca se marcaria como afectado: un falso verde.
  for (const [name, { dependsOn }] of services) {
    for (const dep of dependsOn) {
      if (!services.has(dep)) {
        throw new ConfigError(
          `El servicio '${name}' depende de '${dep}', que no esta declarado.`
        )
      }
    }
  }

  return services
}