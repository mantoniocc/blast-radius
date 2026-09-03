/**
 * Determina si un archivo cambiado cae dentro de una ruta declarada.
 *
 * El match es por prefijo CON delimitador. Sin el '/', la ruta
 * 'services/api' haria match con 'services/api-v2/...', marcando
 * como afectado un servicio que no cambio.
 */
function matchesPath(file, declaredPath) {
    // Normalizamos quitando './' incial y '/' final, porque un consumidor
    // puede escribir './services/api/' y esperar que funcione
    const p = declaredPath.replace(/^\.\//).replace(/\/$/, '')
    return file === p || file.startsWith(p + '/')
}

/**
 * Servicios cuyos paths declarados contienen alguno de los archivos
 * cambiados. Es el punto de partida del recorrido, sin propagacion.
 *
 * @param {string[]} changedFiles
 * @param {Map<string, {paths: string[], dependsOn: string[]}>} services
 * @returns {Set<string>}
 */
export function directlyChanged(changedFiles, services) {
    const changed = new Set()

    for (const [name, {paths}] of services) {
        for (const declaredPath of paths) {
            if (changedFiles.some((f) => matchesPath(f, declaredPath))) {
                changed.add(name)
                // Un servicio se marca una sola vez: mas rutas que coincidan
                // no cambian el resultado
                break
            }
        }
    }
    return changed
}

/**
 * Invierte las aristas del grafo.
 *
 * La configuracion declara 'api depends-on shared'. La pregunta que
 * respondemos es la inversa: 'shared cambio, a quien afecta'. Sin esta
 * inversion el algoritmo daria resultados exactamente al reves.
 *
 * @returns {Map<string, string[]>} servicio -> quienes dependen de el
 */
export function buildDependentsMap(services) {
    const dependents = new Map()

    // Inicializamos TODAS las claves, incluso las de servicios sin
    // dependientes. Asi el recorrido nunca recibe undefined y no
    // necesita comprobaciones defensivas en el bucle caliente.
    for (const name of services.keys()) {
        dependents.set(name, [])
    }

    for (const [name, { dependsOn }] of services) {
        for (const dep of dependsOn) {
            dependents.get(dep).push(name)
        }
    }

    return dependents
}

/**
 * Cierre transitivo: todos los servicios alcanzables desde los
 * directamente cambiados siguiendo las aristas invertidas.
 *
 * @returns {{affected: Set<string>, reasons: Map<string, string>}}
 *   reasons distingue 'directo' de 'transitivo via X', para poder
 *   explicarle al consumidor POR QUE un servicio quedo en la lista.
 */
export function computeAffected(directSet, dependentMap) {
    const affected = new Set(directSet)
    const reasons = new Map()

    for (const name of directSet) {
        reasons.set(name, 'directo')
    }

    // Recorrido en anchura. La cola arranca con los directos; cada nodo
    // visitado agrega sus dependientes no vistos.
    const queue = [...directSet]

    while (queue.length > 0) {
        const current = queue.shift()

        for (const dependent of dependentMap.get(current) ?? []) {
            // El Set de visitados es lo que hace que un ciclo termine:
            // un nodo ya marcado no vuelve a la cola.
            if (affected.has(dependent)) continue

            affected.add(dependent)
            reasons.set(dependent, `transitivo via ${current}`)
            queue.push(dependent)
        }
    }

    return {affected, reasons}
}

/**
 * Detecta ciclos en el grafo declarado.
 *
 * No es un error para el algoritmo (el Set de visitados los maneja),
 * pero casi siempre indica un problema de arquitectura en el monorepo.
 * Devolvemos los ciclos para poder advertir, no para fallar.
 */
export function findCycles(services) {
    const cycles = []
    // Estado de cada nodo en el DFS: 'visitando' detecta la arista de
    // retroceso que define un ciclo: 'listo' evita reexplorar.
    const state = new Map()

    function visit(name, path) {
        if(state.get(name) === 'visitando') {
            // Cortamos el camino desde la primera aparecicion del nodo:
            // eso es el ciclo,  sin la cola que llevo hasta el.
            cycles.push([...path.slice(path.indexOf(name)), name])
            return
        }
        if (state.get(name) === 'listo') return

        state.set(name, 'visitando')
        for (const dep of services.get(name)?.dependsOn ?? []) {
            visit(dep, [...path, name])
        }
        state.set(name, 'listo')
    }

    for (const name of services.keys()){
        visit(name, [])
    }

    return cycles
}