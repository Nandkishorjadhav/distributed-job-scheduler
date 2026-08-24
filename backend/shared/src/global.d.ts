/// <reference types="node" />

declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
}
