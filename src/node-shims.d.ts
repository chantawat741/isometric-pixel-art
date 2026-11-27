// Just enough of Node's API for src/worker.ts, which runs in Orca's Node worker process (not in the
// browser panel). Declared by hand so the project needs no @types/node.

declare module 'node:child_process' {
  export function execFile(
    file: string,
    args: readonly string[],
    options: { timeout?: number; maxBuffer?: number; windowsHide?: boolean; env?: Record<string, string | undefined> },
    callback: (error: (Error & { code?: string }) | null, stdout: string | Uint8Array) => void
  ): unknown
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean
}

declare module 'node:path' {
  export function dirname(path: string): string
  export function join(...parts: string[]): string
}

declare const process: {
  platform: string
  execPath: string
  env: Record<string, string | undefined>
}
