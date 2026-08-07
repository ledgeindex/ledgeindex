const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

// apps/mobile → ledgeindex (workspaces) → pindownai (outer workspaces)
const projectRoot = __dirname
const ledgeindexRoot = path.resolve(projectRoot, '../..')
const monorepoRoot = path.resolve(projectRoot, '../../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [ledgeindexRoot, monorepoRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(ledgeindexRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]

module.exports = config
