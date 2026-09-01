import * as core from '@actions/core'
import { loadConfig, ConfigError } from './config.js'

export async function run() {
  try {
    const configPath = core.getInput('config-path')

    core.info(`Cargando configuracion desde ${configPath}`)
    const services = await loadConfig(configPath)

    core.info(`SERVICIOS ENCONTRADOS: ${services.size}`)
    for (const [name, { paths, dependsOn }] of services) {
      // core.debug solo aparece si ACTIONS_STEP_DEBUG esta activo.
      // Detalle util para diagnosticar, ruido en una corrida normal.
      core.debug(
        `  ${name}: paths=[${paths.join(', ')}] depends-on=[${dependsOn.join(', ')}]`
      )
    }

    core.setOutput('services', JSON.stringify([...services.keys()]))
  } catch (err) {
    if (err instanceof ConfigError) {
      // Error del consumidor: mensaje limpio, sin stack trace.
      core.setFailed(err.message)
      return
    }
    // Fallo inesperado: incluimos el stack, porque aqui el destinatario
    // real del mensaje somos nosotros, no el consumidor.
    core.setFailed(`Error inesperado: ${err.message}`)
    core.debug(err.stack ?? '')
  }
}