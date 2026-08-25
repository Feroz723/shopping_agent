import { findProducts } from "../search";
import { braveFallbackProducts } from "../search-brave";

async function testFreeSearch() {
  console.log("Testing zero-cost search logic...");

  // Ensure no API keys are present for zero-cost test
  delete process.env.SERPAPI_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;

  // Test 1: findProducts returns valid results for a query
  const res = await findProducts("running shoes");
  console.log("Query:", res.query);
  console.log("Intent:", res.intent);
  console.log("Source:", res.source);
  console.log("Products count:", res.products.length);

  if (!res.products || res.products.length === 0) {
    throw new Error("findProducts returned 0 products!");
  }

  const first = res.products[0];
  console.log("Sample top product:", first.name, "|", first.price, first.currency, "| Retailer:", first.retailer);

  if (!first.name || !first.price || !first.url) {
    throw new Error("Product missing required fields!");
  }

  // Test 2: braveFallbackProducts fallback function directly
  const freeItems = await braveFallbackProducts("running shoes under $100", { currency: "USD", gl: "us" });
  console.log("Free fallback scraped items count:", freeItems.length);

  console.log("All free search tests passed successfully!");
}

testFreeSearch().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
