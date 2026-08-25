import { findProducts, extractBudgetFromQuery } from "../search";
import { braveFallbackProducts } from "../search-brave";

async function testFreeSearch() {
  console.log("Testing zero-cost search and budget logic...");

  // Ensure no API keys are present for zero-cost test
  delete process.env.SERPAPI_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;

  // Test 1: Budget extraction
  const budget1 = extractBudgetFromQuery("shoes under 1000 rupees");
  if (budget1 !== 1000) {
    throw new Error(`Budget extraction failed for 'shoes under 1000 rupees', got: ${budget1}`);
  }
  const budget2 = extractBudgetFromQuery("headphones under $150");
  if (budget2 !== 150) {
    throw new Error(`Budget extraction failed for 'headphones under $150', got: ${budget2}`);
  }

  // Test 2: findProducts returns valid results for general query
  const generalRes = await findProducts("running shoes");
  if (!generalRes.products || generalRes.products.length === 0) {
    throw new Error("findProducts returned 0 products for general query!");
  }

  // Test 3: findProducts returns valid results for INR budget query
  const res = await findProducts("shoes under 1000 rupees");
  console.log("Query:", res.query);
  console.log("Intent:", res.intent);
  console.log("Source:", res.source);
  console.log("Products count:", res.products.length);

  if (!res.products || res.products.length === 0) {
    throw new Error("findProducts returned 0 products for budget query!");
  }

  const first = res.products[0];
  console.log("Sample top product:", first.name, "|", first.price, first.currency, "| Retailer:", first.retailer);

  if (!first.name || !first.price || !first.url) {
    throw new Error("Product missing required fields!");
  }

  // Verify top product is under budget
  if (first.price > 1000) {
    throw new Error(`Top product price (${first.price}) exceeds budget limit (1000)!`);
  }

  // Test 4: braveFallbackProducts fallback function directly
  const freeItems = await braveFallbackProducts("shoes under 1000 rupees", { currency: "INR", gl: "in" });
  console.log("Free fallback scraped items count:", freeItems.length);

  console.log("All free search and budget tests passed successfully!");
}

testFreeSearch().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
