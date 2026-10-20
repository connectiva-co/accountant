import { IntegrationError } from './adapter.js';
import type { AnyIntegrationAdapter } from './adapter.js';
import { siigoAdapter } from './providers/siigo.js';
import { worldOfficeAdapter } from './providers/worldoffice.js';

/**
 * Catálogo de providers registrados. El resto de la aplicación (manager,
 * sync, API, UI) resuelve adapters aquí; ningún módulo importa un provider
 * concreto directamente.
 */
const ADAPTERS: Map<string, AnyIntegrationAdapter> = new Map([
  [siigoAdapter.provider, siigoAdapter as AnyIntegrationAdapter],
  [worldOfficeAdapter.provider, worldOfficeAdapter as AnyIntegrationAdapter],
]);

export function getAdapter(provider: string): AnyIntegrationAdapter | undefined {
  return ADAPTERS.get(provider);
}

export function requireAdapter(provider: string): AnyIntegrationAdapter {
  const adapter = ADAPTERS.get(provider);
  if (!adapter) {
    throw new IntegrationError(
      'PROVIDER_DESCONOCIDO',
      `Provider "${provider}" no está registrado. Disponibles: ${listProviders().join(', ')}`,
    );
  }
  return adapter;
}

export function isKnownProvider(provider: string): boolean {
  return ADAPTERS.has(provider);
}

export function listAdapters(): AnyIntegrationAdapter[] {
  return [...ADAPTERS.values()];
}

export function listProviders(): string[] {
  return [...ADAPTERS.keys()];
}
