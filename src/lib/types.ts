export type Product = {
  id: string;
  name: string;
  price: number;
  currency?: "USD" | "INR";
  originalPrice?: number;
  retailer: string;
  url: string;
  providerProductId?: string;
  imageUrl?: string;
  rating?: number;
  reviewsCount?: number;
  shipping?: string;
  availability: "In stock" | "Limited stock" | "Unknown";
  score: number;
  reason: string;
  badges: string[];
};

export type SearchResponse = {
  query: string;
  intent: string;
  summary: string;
  products: Product[];
  source: "live" | "demo";
};
