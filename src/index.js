// Entrypoint separado de la logica para que main.js sea importable
// desde los tests sin ejecutarse por el hecho de importarlo.
// Es la fase 7, pero la separacion se hace ahora porque despues
// implicaria refactorizar.
import { run } from './main.js'

await run()