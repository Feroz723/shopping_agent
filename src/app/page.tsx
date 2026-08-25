"use client";

import { FormEvent, useMemo, useState } from "react";
import ProductCard from "@/components/ProductCard";
import { SearchResponse } from "@/lib/types";

const suggestions = ["best workout shoes under $100", "noise cancelling headphones under $150", "ergonomic office chair"];
const PER_PAGE = 10;

type SortMode = "best" | "priceAsc" | "priceDesc" | "rating";

function pageWindow(current: number, total: number) {
  if (total <= 9) return Array.from({ length: total }, (_, index) => index + 1);
  const start = Math.max(1, Math.min(current - 4, total - 8));
  return Array.from({ length: 9 }, (_, index) => start + index);
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  const [sortBy, setSortBy] = useState<SortMode>("best");
  const [priceCap, setPriceCap] = useState<number | null>(null);
  const [minRating, setMinRating] = useState(0);
  const [onSaleOnly, setOnSaleOnly] = useState(false);
  const [retailerFilter, setRetailerFilter] = useState<string[]>([]);

  const currency = result?.products[0]?.currency ?? "USD";
  const formatPrice = (value: number) =>
    new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: currency === "INR" ? 0 : 2 }).format(value);

  const priceBounds = useMemo(() => {
    if (!result || result.products.length === 0) return null;
    const prices = result.products.map((product) => product.price);
    const min = Math.floor(Math.min(...prices));
    const max = Math.ceil(Math.max(...prices));
    if (min === max) return null;
    return { min, max, step: Math.max(1, Math.round((max - min) / 25)) };
  }, [result]);

  const retailers = useMemo(() => {
    if (!result) return [];
    return Array.from(new Set(result.products.map((product) => product.retailer))).sort();
  }, [result]);

  const rankById = useMemo(() => new Map((result?.products ?? []).map((product, index) => [product.id, index + 1])), [result]);

  const filtered = useMemo(() => {
    if (!result) return [];
    let items = [...result.products];
    if (priceCap !== null) items = items.filter((product) => product.price <= priceCap);
    if (minRating > 0) items = items.filter((product) => (product.rating ?? 0) >= minRating);
    if (onSaleOnly) items = items.filter((product) => product.originalPrice !== undefined);
    if (retailerFilter.length > 0) items = items.filter((product) => retailerFilter.includes(product.retailer));
    if (sortBy === "priceAsc") items.sort((a, b) => a.price - b.price);
    else if (sortBy === "priceDesc") items.sort((a, b) => b.price - a.price);
    else if (sortBy === "rating") items.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    return items;
  }, [result, priceCap, minRating, onSaleOnly, retailerFilter, sortBy]);

  const hasActiveFilters = priceCap !== null || minRating > 0 || onSaleOnly || retailerFilter.length > 0 || sortBy !== "best";

  function clearFilters() {
    setSortBy("best");
    setPriceCap(null);
    setMinRating(0);
    setOnSaleOnly(false);
    setRetailerFilter([]);
    setPage(1);
  }

  function toggleRetailer(retailer: string) {
    setRetailerFilter((current) => (current.includes(retailer) ? current.filter((item) => item !== retailer) : [...current, retailer]));
    setPage(1);
  }

  function resetFilterState() {
    clearFilters();
  }

  async function search(searchQuery: string) {
    if (searchQuery.trim().length < 3) return;
    setLoading(true);
    setError("");
    resetFilterState();
    try {
      const response = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searchQuery }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    search(query);
  }

  function goToPage(target: number) {
    const total = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    setPage(Math.min(Math.max(1, target), total));
    document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="#top" aria-label="ShopPulse home">
          <span className="brand-mark">S</span>ShopPulse
        </a>
        <div className="nav-links">
          <a href="#how-it-works">How it works</a>
          <button className="save-button">Sign in</button>
        </div>
      </nav>

      <section className={`hero shell ${result ? "hero-compact" : ""}`} id="top">
        <p className="eyebrow"><span /> AI shopping, without the hunt</p>
        <h1>Find the good stuff.<br /><em>Skip the noise.</em></h1>
        <p className="hero-copy">
          Tell ShopPulse what you need. It weighs price, real shopper feedback, and retailer value.
        </p>
        <form className="search-box" onSubmit={submit}>
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try “shoes under 1000 rupees”"
            aria-label="What are you shopping for?"
          />
          <button type="submit" disabled={loading || query.trim().length < 3}>
            {loading ? "Searching..." : "Search"}<span aria-hidden="true">→</span>
          </button>
        </form>
        {!result && (
          <div className="suggestions">
            <span>Try one:</span>
            {suggestions.map((suggestion) => (
              <button key={suggestion} onClick={() => { setQuery(suggestion); search(suggestion); }}>
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {error && <p className="error-message">{error}</p>}
      </section>

      {loading && (
        <section className="shell loading-state" aria-live="polite">
          <div className="radar" />
          <p>Checking prices, reviews, and retailer value...</p>
        </section>
      )}

      {result && !loading && (
        <section className="results shell" aria-live="polite" id="results">
          <div className="results-heading">
            <div>
              <p className="eyebrow"><span /> Your shopping report</p>
              <h2>Top matches for <em>“{result.query}”</em></h2>
            </div>
            <p className="source-label">
              {result.source === "live"
                ? `${filtered.length} of ${result.products.length} verified listings`
                : `${filtered.length} of ${result.products.length} demo listings`}
            </p>
          </div>
          <div className="insight-card">
            <div className="spark">✦</div>
            <div>
              <p className="insight-label">ShopPulse’s take</p>
              <p>{result.summary}</p>
            </div>
          </div>

          {result.products.length > 0 && (
            <div className="filters-bar">
              <div className="filters-row">
                <label className="filter-field">
                  <span>Sort by</span>
                  <select value={sortBy} onChange={(event) => { setSortBy(event.target.value as SortMode); setPage(1); }}>
                    <option value="best">Best match</option>
                    <option value="priceAsc">Price: low to high</option>
                    <option value="priceDesc">Price: high to low</option>
                    <option value="rating">Top rated</option>
                  </select>
                </label>
                {priceBounds && (
                  <label className="filter-field filter-price">
                    <span>{priceCap === null ? `Under ${formatPrice(priceBounds.max)}` : `Under ${formatPrice(priceCap)}`}</span>
                    <input type="range" min={priceBounds.min} max={priceBounds.max} step={priceBounds.step} value={priceCap ?? priceBounds.max} onChange={(event) => { setPriceCap(Number(event.target.value)); setPage(1); }} aria-label="Maximum price" />
                  </label>
                )}
                <div className="filter-group" role="group" aria-label="Minimum rating">
                  {[0, 4, 4.5].map((rating) => (
                    <button key={rating} className={minRating === rating ? "active" : ""} onClick={() => { setMinRating(rating); setPage(1); }}>
                      {rating === 0 ? "Any rating" : `${rating}★+`}
                    </button>
                  ))}
                </div>
                <button className={`filter-toggle ${onSaleOnly ? "active" : ""}`} onClick={() => { setOnSaleOnly(!onSaleOnly); setPage(1); }}>On sale</button>
              </div>
              {(retailers.length > 1 || hasActiveFilters) && (
                <div className="filters-row">
                  {retailers.slice(0, 8).map((retailer) => (
                    <button key={retailer} className={`filter-chip ${retailerFilter.includes(retailer) ? "active" : ""}`} onClick={() => toggleRetailer(retailer)}>{retailer}</button>
                  ))}
                  {hasActiveFilters && <button className="filter-clear" onClick={clearFilters}>Clear all</button>}
                </div>
              )}
            </div>
          )}

          {result.products.length === 0
            ? <div className="empty-results"><strong>No verified matches yet</strong><span>Try a broader description, another brand, or a different budget.</span></div>
            : filtered.length === 0
              ? <div className="empty-results"><strong>No matches with these filters</strong><span>Loosen the price cap or rating to see more listings.{hasActiveFilters && <button onClick={clearFilters}>Clear filters</button>}</span></div>
              : (
                <>
                  <div className="product-grid">{filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((product, index) => <ProductCard key={product.id} product={product} rank={rankById.get(product.id) ?? index + 1} />)}</div>
                  {Math.ceil(filtered.length / PER_PAGE) > 1 && (
                    <nav className="pagination" aria-label="Result pages">
                      <button onClick={() => goToPage(page - 1)} disabled={page === 1}>← Prev</button>
                      {pageWindow(page, Math.ceil(filtered.length / PER_PAGE)).map((pageNumber) => (
                        <button key={pageNumber} className={pageNumber === page ? "active" : ""} onClick={() => goToPage(pageNumber)}>{pageNumber}</button>
                      ))}
                      <button onClick={() => goToPage(page + 1)} disabled={page === Math.ceil(filtered.length / PER_PAGE)}>Next →</button>
                    </nav>
                  )}
                </>
              )}
        </section>
      )}

      {!result && !loading && (
        <section className="trust shell" id="how-it-works">
          <p>BUILT FOR BETTER BUYING</p>
          <div>
            <article>
              <strong>01</strong>
              <h2>Say what matters</h2>
              <span>Budget, use case, brand, or a very specific wish.</span>
            </article>
            <article>
              <strong>02</strong>
              <h2>We do the sorting</h2>
              <span>ShopPulse ranks the products that make the most sense.</span>
            </article>
            <article>
              <strong>03</strong>
              <h2>Buy with confidence</h2>
              <span>See the tradeoffs, then go straight to the retailer.</span>
            </article>
          </div>
        </section>
      )}
      <footer className="footer shell">
        <span>© 2026 ShopPulse</span>
        <span>Prices and availability may change at retailer checkout.</span>
      </footer>
    </main>
  );
}
