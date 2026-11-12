export type ImageRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type ImageMatch = ImageRegion & { similarity: number; scale: number };
export type ImageSearchOptions = {
  minSimilarity: number;
  scales: number[];
  region?: ImageRegion;
};
export interface ImageAssets {
  load(id: string, signal?: AbortSignal): Promise<Buffer>;
}
