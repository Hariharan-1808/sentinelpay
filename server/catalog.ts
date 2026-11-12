import type { CatalogCandidate } from "./types.js";

interface RawChannel3Offer {
  url?: string;
  domain?: string;
  availability?: string;
  price?:
    | number
    | { price?: number; amount?: number; value?: number; currency?: string };
}

interface RawChannel3Item {
  id?: string;
  title?: string;
  name?: string;
  price?:
    | number
    | { price?: number; amount?: number; value?: number; currency?: string };
  currency?: string;
  merchant?: string;
  brand?: { name?: string } | string;
  brands?: Array<{ name?: string }>;
  url?: string;
  images?: Array<string | { url?: string; cleaned_url?: string }>;
  image_url?: string;
  availability?: string;
  offers?: RawChannel3Offer[];
}

const FALLBACK_CATALOG: CatalogCandidate[] = [
  {
    id: "fb-fan-24v-80mm",
    title: "Noctua IndustrialPPC 24V 80mm High-RPM Cooling Fan",
    priceUsd: 29.95,
    currency: "USD",
    vendor: "Industrial Cooling Direct",
    url: "https://example.com/parts/fan-24v-80mm",
    availability: "in_stock",
    source: "FALLBACK_CATALOG",
  },
  {
    id: "fb-fan-12v-ball",
    title: "Delta Dual-Ball Bearing Brushless Axial Fan (120mm)",
    priceUsd: 24.5,
    currency: "USD",
    vendor: "ElectroParts Supply",
    url: "https://example.com/parts/fan-120mm",
    availability: "in_stock",
    source: "FALLBACK_CATALOG",
  },
  {
    id: "fb-spindle-vfd",
    title: "2.2kW Brushless CNC Spindle VFD Controller & Bearing Kit",
    priceUsd: 189.0,
    currency: "USD",
    vendor: "Precision Motion Systems",
    url: "https://example.com/parts/spindle-vfd",
    availability: "in_stock",
    source: "FALLBACK_CATALOG",
  },
  {
    id: "fb-hepa-filter",
    title: "H14 Cleanroom HEPA Pleated Cartridge + Thermal Sensor",
    priceUsd: 44.0,
    currency: "USD",
    vendor: "CleanAir Lab Supply",
    url: "https://example.com/parts/hepa-h14",
    availability: "in_stock",
    source: "FALLBACK_CATALOG",
  },
];

function extractNumericPrice(raw: RawChannel3Item["price"]): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Number(raw.toFixed(2));
  }
  if (raw && typeof raw === "object") {
    const val = raw.price ?? raw.amount ?? raw.value;
    if (typeof val === "number" && Number.isFinite(val) && val > 0) {
      return Number(val.toFixed(2));
    }
  }
  return null;
}

function normalizeChannel3Item(
  item: RawChannel3Item,
  idx: number
): CatalogCandidate | null {
  const title = (item.title || item.name || "").trim();
  const primaryOffer = item.offers?.[0];
  const priceUsd =
    extractNumericPrice(primaryOffer?.price) ?? extractNumericPrice(item.price);
  if (!title || priceUsd === null) return null;

  const brandName =
    typeof item.brand === "string"
      ? item.brand
      : item.brand?.name || item.brands?.[0]?.name;

  const rawPriceObj = primaryOffer?.price ?? item.price;
  const currency =
    (rawPriceObj && typeof rawPriceObj === "object"
      ? rawPriceObj.currency
      : undefined) ||
    item.currency ||
    "USD";

  const firstImage = item.images?.[0];
  const imageUrl =
    typeof firstImage === "string"
      ? firstImage
      : firstImage?.cleaned_url || firstImage?.url || item.image_url;

  return {
    id: item.id || `ch3-${idx}`,
    title,
    priceUsd,
    currency,
    vendor:
      primaryOffer?.domain ||
      item.merchant ||
      brandName ||
      "Channel3 Verified Merchant",
    url: primaryOffer?.url || item.url || "https://trychannel3.com",
    imageUrl,
    availability: primaryOffer?.availability || item.availability || "InStock",
    source: "CHANNEL3",
  };
}

function matchFallbackCatalog(query: string): CatalogCandidate[] {
  const lower = query.toLowerCase();
  if (lower.includes("spindle") || lower.includes("controller") || lower.includes("motor")) {
    return [FALLBACK_CATALOG[2], FALLBACK_CATALOG[0]];
  }
  if (lower.includes("hepa") || lower.includes("filter") || lower.includes("blower")) {
    return [FALLBACK_CATALOG[3], FALLBACK_CATALOG[1]];
  }
  return [FALLBACK_CATALOG[0], FALLBACK_CATALOG[1]];
}

export interface CatalogSearchOptions {
  limit?: number;
  minPriceUsd?: number;
  maxPriceUsd?: number;
}

/**
 * Searches Channel3's product API for real replacement parts matching the AI diagnosis.
 * Falls back cleanly to a labeled local catalog if CHANNEL3_API_KEY is unset or returns no priced hits.
 */
export async function searchReplacementParts(
  query: string,
  options: CatalogSearchOptions = {}
): Promise<CatalogCandidate[]> {
  const { limit = 5, minPriceUsd, maxPriceUsd } = options;
  const apiKey = process.env.CHANNEL3_API_KEY?.trim();
  if (!apiKey) {
    return matchFallbackCatalog(query);
  }

  const filters: Record<string, unknown> = {
    availability: ["InStock", "LimitedAvailability"],
  };
  if (minPriceUsd !== undefined || maxPriceUsd !== undefined) {
    filters.price = {
      ...(minPriceUsd !== undefined ? { min_price: minPriceUsd } : {}),
      ...(maxPriceUsd !== undefined ? { max_price: maxPriceUsd } : {}),
    };
  }

  try {
    const res = await fetch("https://api.trychannel3.com/v1/search", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, limit, filters }),
    });

    if (!res.ok) {
      console.warn(`Channel3 HTTP ${res.status}; using fallback catalog.`);
      return matchFallbackCatalog(query);
    }

    const body = (await res.json()) as
      | RawChannel3Item[]
      | { data?: RawChannel3Item[]; products?: RawChannel3Item[]; results?: RawChannel3Item[] };

    const rawItems = Array.isArray(body)
      ? body
      : body.data || body.products || body.results || [];

    const normalized = rawItems
      .map((item, idx) => normalizeChannel3Item(item, idx))
      .filter((item): item is CatalogCandidate => item !== null)
      .filter((item) => {
        if (minPriceUsd !== undefined && item.priceUsd < minPriceUsd) return false;
        if (maxPriceUsd !== undefined && item.priceUsd > maxPriceUsd) return false;
        return true;
      });

    if (normalized.length > 0) return normalized;
    return minPriceUsd === undefined && maxPriceUsd === undefined
      ? matchFallbackCatalog(query)
      : [];
  } catch (err) {
    console.warn("Channel3 lookup failed; using fallback catalog:", err);
    return matchFallbackCatalog(query);
  }
}
