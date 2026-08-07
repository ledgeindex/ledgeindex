export type Embedder = {
  embedTexts(texts: string[]): Promise<number[][]>;
  embedQuery?(text: string): Promise<number[]>;
};
