import { join } from 'node:path'

export function resolvePackagedServerModulePath(runtimeRoot: string): string {
  return join(
    runtimeRoot,
    'node_modules',
    '@ledgeindex',
    'server',
    'dist',
    'index.js',
  )
}

export function resolvePackagedFirebaseAuthPath(runtimeRoot: string): string {
  return join(
    runtimeRoot,
    'node_modules',
    '@ledgeindex',
    'docs',
    'dist',
    'runtime',
    'middleware',
    'firebase-auth.js',
  )
}
