declare module 'gifsicle-wasm-browser' {
  export interface GifsicleInput {
    readonly file: ArrayBuffer | Blob | File | string;
    readonly name: string;
  }

  export interface GifsicleRunOptions {
    readonly input: readonly GifsicleInput[];
    readonly command: readonly string[];
    readonly folder?: readonly string[];
    readonly isStrict?: boolean;
  }

  const gifsicle: {
    run(options: GifsicleRunOptions): Promise<File[] | null>;
  };

  export default gifsicle;
}
