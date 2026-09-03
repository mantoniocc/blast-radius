import * as core from '@actions/core'
import { loadConfig, ConfigError } from './config.js'
import {
  directlyChanged,
  buildDependentsMap,
  computeAffected,
  findCycles
} from './graph.js'

/**
 * Convierte el input multilinea en un array de rutas.
 * getMultilineInput ya separa por saltos de linea; filtramos vacios
 * y espacios porque un heredoc de YAML suele dejar lineas sueltas.
 */
function parseChangedFiles() {
  return core
    .getMultilineInput('changed-files')
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
}

async function writeSummary(affected, reasons, services, changedFiles) {
  const rows = [
    [
      { data: 'Servicio', header: true },
      { data: 'Motivo', header: true }
    ]
  ]

  // Orden alfabetico: sin esto el orden depende de la iteracion del Set,
  // y el resumen cambiaria entre corridas con el mismo resultado.
  for (const name of [...affected].sort()) {
    rows.push([name, reasons.get(name) ?? ''])
  }

  const summary = core.summary
    .addHeading('Blast Radius', 3)
    .addRaw(
      `${changedFiles.length} archivo(s) cambiado(s) · ` +
        `${affected.size} de ${services.size} servicio(s) afectado(s)`
    )
    .addBreak()

  if (affected.size > 0) {
    summary.addTable(rows)
  } else {
    summary.addRaw('Ningun servicio afectado.')
  }

  // .write() es obligatorio y asincrono. Sin el, el buffer se construye
  // y nunca llega a $GITHUB_STEP_SUMMARY, sin ningun error visible.
  await summary.write()
}

export async function run() {
  try {
    const configPath = core.getInput('config-path')
    const includeDependents = core.getBooleanInput('include-dependents')
    const changedFiles = parseChangedFiles()

    // startGroup/endGroup colapsa el bloque en la UI. Util cuando el
    // detalle es largo y solo interesa al depurar.
    core.startGroup(`Archivos cambiados (${changedFiles.length})`)
    for (const f of changedFiles) core.info(f)
    core.endGroup()

    const services = await loadConfig(configPath)
    core.info(`Servicios declarados: ${services.size}`)

    // Advertencia, no error: el algoritmo tolera ciclos, pero el
    // consumidor casi seguro no los quiere en su arquitectura.
    for (const cycle of findCycles(services)) {
      core.warning(`Ciclo de dependencias: ${cycle.join(' -> ')}`, {
        title: 'Ciclo detectado',
        file: configPath
      })
    }

    const direct = directlyChanged(changedFiles, services)
    core.info(`Directamente cambiados: ${[...direct].sort().join(', ') || '(ninguno)'}`)

    let affected, reasons
    if (includeDependents) {
      const dependentsMap = buildDependentsMap(services)
      ;({ affected, reasons } = computeAffected(direct, dependentsMap))
    } else {
      // Sin propagacion: util para depurar por que un servicio aparece
      // en la lista. Comparar ambos modos aisla si fue directo o transitivo.
      affected = direct
      reasons = new Map([...direct].map((n) => [n, 'directo']))
    }

    const sorted = [...affected].sort()

    // Formato listo para `strategy.matrix`. La forma con 'include'
    // permite agregar campos por servicio despues sin romper consumidores.
    const matrix = {
      include: sorted.map((name) => ({
        service: name,
        path: services.get(name).paths[0]
      }))
    }

    core.setOutput('matrix', JSON.stringify(matrix))
    core.setOutput('services', JSON.stringify(sorted))
    // Como string, no boolean: los outputs siempre son strings y
    // devolver un boolean lo convertiria implicitamente.
    core.setOutput('any-changed', String(sorted.length > 0))

    await writeSummary(affected, reasons, services, changedFiles)

    if (sorted.length === 0) {
      // notice, no warning: no encontrar nada afectado es un resultado
      // legitimo, no una anomalia.
      core.notice('Ningun servicio afectado por estos cambios')
    } else {
      core.info(`Afectados: ${sorted.join(', ')}`)
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      core.setFailed(err.message)
      return
    }
    core.setFailed(`Error inesperado: ${err.message}`)
    core.debug(err.stack ?? '')
  }
}