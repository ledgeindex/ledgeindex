export type MetadataCatalogSection = {
  name: string;
  chunkCount: number;
};

export type MetadataCatalogPage = {
  url: string;
  title: string;
  chunkCount: number;
};

export type MetadataCatalogCategory = {
  name: string;
  chunkCount: number;
  pageCount: number;
  sections: MetadataCatalogSection[];
};

export type MetadataCatalog = {
  sourceId: string;
  categories: MetadataCatalogCategory[];
  /** Indexed documentation pages (title + URL from crawl). */
  pages: MetadataCatalogPage[];
  updatedAt: string;
};
