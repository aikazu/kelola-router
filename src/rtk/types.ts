export interface FilterFn {
  (text: string): string;
  filterName: string;
}

export interface CompressHit {
  shape: string;
  filter: string;
  saved: number;
}

export interface CompressStats {
  bytesBefore: number;
  bytesAfter: number;
  hits: CompressHit[];
}
