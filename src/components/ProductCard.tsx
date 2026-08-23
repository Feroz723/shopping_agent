"use client";

import { Product } from "@/lib/types";
import { useState } from "react";

export default function ProductCard({ product, rank }: { product: Product; rank: number }) {
  const [imageFailed, setImageFailed] = useState(false);
  const currency = product.currency ?? "USD";
  const formatPrice = (value: number) => new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: currency === "INR" ? 0 : 2 }).format(value);
  const dealHref = product.providerProductId
    ? `/api/go?pid=${product.providerProductId}&r=${encodeURIComponent(product.retailer)}&g=${currency === "INR" ? "in" : "us"}&q=${encodeURIComponent(product.name)}&u=${encodeURIComponent(product.url)}`
    : product.url;
  function trackClick() {
    void fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: product.id, retailer: product.retailer }) });
  }

  return (
    <article className={`product-card ${rank === 1 ? "best-pick" : ""}`}>
      <div className="product-image-wrap">
        {product.imageUrl && !imageFailed ? <img src={`/api/image?url=${encodeURIComponent(product.imageUrl)}`} alt={product.name} className="product-image" onError={() => setImageFailed(true)} /> : <div className="image-placeholder"><span>⌕</span><small>Product image unavailable</small></div>}
        {rank === 1 && <span className="best-label">Best match</span>}
      </div>
      <div className="product-body">
        <p className="retailer">{product.retailer}</p>
        <h3>{product.name}</h3>
        <div className="rating">{product.rating ? <><span>★</span> {product.rating.toFixed(1)} <small>({product.reviewsCount?.toLocaleString()} reviews)</small></> : <span>New listing</span>}</div>
        <p className="reason">{product.reason}</p>
        <div className="badges">{product.badges.map((badge) => <span key={badge}>{badge}</span>)}</div>
        <div className="card-footer"><div><strong>{formatPrice(product.price)}</strong>{product.originalPrice && <del>{formatPrice(product.originalPrice)}</del>}<small>{product.shipping}</small></div><a href={dealHref} target="_blank" rel="noopener noreferrer" onClick={trackClick}>View deal <span>↗</span></a></div>
      </div>
    </article>
  );
}
