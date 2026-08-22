/// <reference types="vite/client" />

// Augment Vite's ImportMetaEnv with our custom variables
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
