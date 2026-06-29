// Metro config for an Expo app inside the Ticash monorepo.
// Watches the repo root so Metro transpiles the shared @ticash/* workspace
// packages (consumed as TypeScript source), and resolves modules from both the
// app and the hoisted root node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
