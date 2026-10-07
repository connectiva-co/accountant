/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base de la API (por defecto el servidor local en el puerto 3001). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
