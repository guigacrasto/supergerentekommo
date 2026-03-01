/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_APP_SHORT_NAME?: string;
  readonly VITE_APP_DESCRIPTION?: string;
  readonly VITE_APP_THEME_COLOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
