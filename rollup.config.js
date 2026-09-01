import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/index.js',
    // 'es' debe coincidir con "type": "module" del package.json.
    // Si emitieramos 'cjs', Node interpretaria el require() del bundle
    // como ESM y fallaria con "require is not defined in ES module scope".
    format: 'es',
    // Un solo archivo. sourcemap: false porque el bundle se commitea
    // y un sourcemap duplicaria el tamano del diff en cada build.
    sourcemap: false
  },
  plugins: [
    nodeResolve({
      // El bundle corre en Node, no en un navegador. Sin esto, rollup
      // podria elegir el campo "browser" de un package.json y traer
      // implementaciones que no funcionan fuera del navegador.
      preferBuiltins: true,
      exportConditions: ['node']
    }),
    // Algunas dependencias transitivas siguen siendo CommonJS.
    // Este plugin las convierte a ESM para poder incluirlas.
    commonjs(),
    // Varios paquetes importan su propio package.json para leer la version.
    // Sin este plugin, rollup falla al encontrar un import de .json.
    json()
  ]
}