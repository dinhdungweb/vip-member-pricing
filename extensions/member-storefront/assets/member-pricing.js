(() => {
  const script = document.querySelector("script[data-vip-member-pricing]");
  if (!script || window.__vipMemberPricingLoaded) return;
  window.__vipMemberPricingLoaded = true;

  const defaultCards = [
    "[data-vip-product-card]",
    ".card-wrapper",
    ".product-card-wrapper",
    ".product-card",
    ".product-item",
  ];
  const customSelector = script.dataset.cardSelector?.trim();
  const cardSelector = customSelector
    ? `${defaultCards.join(",")},${customSelector}`
    : defaultCards.join(",");
  const contextUrl = script.dataset.contextUrl || "/apps/vip-member/context";
  const productPattern = /\/products\/([^/?#]+)/;
  const productCache = new Map();
  let context = null;
  let scanTimer = 0;

  const productHandle = (card) => {
    if (card.dataset.vipHandle) return card.dataset.vipHandle;
    const link = card.matches('a[href*="/products/"]')
      ? card
      : card.querySelector('a[href*="/products/"]');
    return link?.getAttribute("href")?.match(productPattern)?.[1] || null;
  };

  const mediaFor = (card) =>
    card.querySelector(
      ".card__media,.card__inner,.product-card__image-wrapper,.product__media-wrapper,.media",
    ) ||
    (card.hasAttribute("data-vip-product-card")
      ? document.querySelector(
          ".product__media-wrapper,.product-media-container",
        )
      : null) ||
    card;

  const numberFrom = (value) => {
    if (!value) return null;
    const normalized = value.replace(/[^\d.,-]/g, "");
    if (!normalized) return null;
    const comma = normalized.lastIndexOf(",");
    const dot = normalized.lastIndexOf(".");
    const decimalSeparator = comma > dot ? "," : ".";
    const pieces = normalized.split(decimalSeparator);
    const decimal =
      pieces.length > 1 && pieces.at(-1).length <= 2 ? `.${pieces.pop()}` : "";
    const integer = pieces.join("").replace(/[.,]/g, "");
    const result = Number(`${integer}${decimal}`);
    return Number.isFinite(result) ? result : null;
  };

  const domPrices = (card) => {
    const exactPrice = numberFrom(card.dataset.vipPrice);
    const exactCompare = numberFrom(card.dataset.vipCompareAtPrice);
    if (exactPrice !== null) {
      return { price: exactPrice, compareAtPrice: exactCompare };
    }
    const sale =
      card.querySelector(".price-item--sale,.price__sale .price-item") ||
      card.querySelector("[data-sale-price]");
    const compare =
      card.querySelector(
        ".price-item--regular s,s.price-item,.price__compare",
      ) || card.querySelector("[data-compare-at-price]");
    const regular =
      card.querySelector(".price-item--regular,.price__regular .price-item") ||
      card.querySelector("[data-product-price]");
    return {
      price: numberFrom((sale || regular)?.textContent),
      compareAtPrice: numberFrom(compare?.textContent),
    };
  };

  const selectVariant = (card, product) => {
    if (!product?.variants?.nodes?.length) return null;
    const requested =
      (card.hasAttribute("data-vip-product-card")
        ? new URL(window.location.href).searchParams.get("variant")
        : null) ||
      card.dataset.vipVariantId ||
      card
        .querySelector('a[href*="variant="]')
        ?.href.match(/[?&]variant=(\d+)/)?.[1];
    if (requested) {
      return (
        product.variants.nodes.find(
          (variant) => variant.id.split("/").at(-1) === String(requested),
        ) || null
      );
    }
    return product.variants.nodes[0];
  };

  const formatPercent = (basisPoints) => {
    const percent = basisPoints / 100;
    return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
  };

  const ruleTargetsProduct = (rule, product) => {
    if (!product) return false;
    const productGids = rule.productGids || [];
    const collectionGids = rule.collectionGids || [];
    const includeTags = (rule.includeTags || []).map((tag) =>
      String(tag).toLowerCase(),
    );
    const excludeTags = (rule.excludeTags || []).map((tag) =>
      String(tag).toLowerCase(),
    );
    const productTags = (product.tags || []).map((tag) =>
      String(tag).toLowerCase(),
    );
    if (excludeTags.some((tag) => productTags.includes(tag))) return false;
    const hasSelector =
      productGids.length > 0 ||
      collectionGids.length > 0 ||
      includeTags.length > 0;
    return (
      !hasSelector ||
      productGids.includes(product.id) ||
      (product.collections?.nodes || []).some((collection) =>
        collectionGids.includes(collection.id),
      ) ||
      includeTags.some((tag) => productTags.includes(tag))
    );
  };

  const render = (card) => {
    if (card.dataset.vipPricingRendered === "true" || !context?.enabled) return;
    const handle = productHandle(card);
    if (!handle) return;
    const product = productCache.get(handle);
    const variant = selectVariant(card, product);
    const tierRank = context.authenticated ? (context.tier?.rank ?? -1) : -1;
    const accessRule = (context.accessRules || []).find(
      (rule) =>
        ruleTargetsProduct(rule, product) &&
        ((rule.loginRequired && tierRank < 0) ||
          (Number.isFinite(rule.minimumTierRank) &&
            tierRank < rule.minimumTierRank)),
    );
    if (accessRule) {
      const actionRoot = card.hasAttribute("data-vip-product-card")
        ? card.closest(".product__info-wrapper,product-info,.product") ||
          document
        : card;
      actionRoot
        .querySelectorAll(
          'button[name="add"],button[type="submit"][name="add"],.quick-add__submit',
        )
        .forEach((button) => {
          button.disabled = true;
          button.setAttribute("aria-disabled", "true");
        });
      if (!card.querySelector(".vip-pricing-access-message")) {
        const message = document.createElement("div");
        message.className = "vip-pricing-access-message";
        message.textContent =
          accessRule.messageVi ||
          (tierRank < 0
            ? "\u0110\u0103ng nh\u1eadp \u0111\u1ec3 mua s\u1ea3n ph\u1ea9m d\u00e0nh cho th\u00e0nh vi\u00ean."
            : `Y\u00eau c\u1ea7u h\u1ea1ng th\u00e0nh vi\u00ean ${accessRule.minimumTierRank} tr\u1edf l\u00ean.`);
        const destination = context.authenticated
          ? "/account"
          : `/account/login?return_url=${encodeURIComponent(
              window.location.pathname,
            )}`;
        const link = document.createElement("a");
        link.href = destination;
        link.textContent = context.authenticated
          ? "Xem quy\u1ec1n l\u1ee3i th\u00e0nh vi\u00ean"
          : "\u0110\u0103ng nh\u1eadp";
        message.append(" ", link);
        card.appendChild(message);
      }
    }
    const fallback = domPrices(card);
    const price = variant ? Number(variant.price) : fallback.price;
    const compareAtPrice = variant?.compareAtPrice
      ? Number(variant.compareAtPrice)
      : fallback.compareAtPrice;
    if (!Number.isFinite(price) || price <= 0) return;

    const original =
      Number.isFinite(compareAtPrice) && compareAtPrice > price
        ? compareAtPrice
        : price;
    const tierBps = context.tier?.discountBps || 0;
    const tierAmount = (original * tierBps) / 10000;
    const finalPrice = Math.max(0, price - tierAmount);
    const effectiveBps = Math.round(
      ((original - finalPrice) / original) * 10000,
    );
    if (effectiveBps <= 0) {
      card.dataset.vipPricingRendered = "true";
      return;
    }

    const media = mediaFor(card);
    media.classList.add("vip-pricing-anchor");
    const badge = document.createElement("span");
    badge.className = "vip-pricing-badge";
    badge.dataset.position = context.badge?.position || "top-left";
    badge.textContent = `-${formatPercent(effectiveBps)}%${
      tierBps > 0 ? " MEMBER" : ""
    }`;
    badge.style.setProperty(
      "--vip-badge-background",
      context.badge?.background || "#f5f5f5",
    );
    badge.style.setProperty(
      "--vip-badge-foreground",
      context.badge?.foreground || "#111",
    );
    badge.style.setProperty(
      "--vip-badge-radius",
      `${context.badge?.borderRadiusPx || 0}px`,
    );
    const soldOut =
      card.dataset.vipAvailable === "false" ||
      variant?.availableForSale === false ||
      /sold out|hết hàng/i.test(media.textContent || "");
    if (soldOut) badge.style.setProperty("--vip-badge-top", "44px");
    media.appendChild(badge);

    if (tierBps > 0) {
      const priceArea =
        card.querySelector(".price,[data-price-container]") ||
        (card.hasAttribute("data-vip-product-card")
          ? document.querySelector(".product__info-wrapper .price")
          : null);
      if (priceArea && !priceArea.querySelector(".vip-pricing-member-price")) {
        const memberPrice = document.createElement("span");
        memberPrice.className = "vip-pricing-member-price";
        memberPrice.textContent = finalPrice.toLocaleString(undefined, {
          style: "currency",
          currency: context.currencyCode || "USD",
        });
        priceArea.appendChild(memberPrice);
      }
    }
    card.dataset.vipPricingRendered = "true";
  };

  const scan = () => document.querySelectorAll(cardSelector).forEach(render);
  const handles = () =>
    [
      ...new Set(
        [...document.querySelectorAll(cardSelector)]
          .map(productHandle)
          .filter(Boolean),
      ),
    ].slice(0, 100);

  const load = async () => {
    try {
      const url = new URL(contextUrl, window.location.origin);
      url.searchParams.set("handles", handles().join(","));
      const response = await fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      context = await response.json();
      (context.products || []).forEach((product) =>
        productCache.set(product.handle, product),
      );
      scan();
    } catch {
      // Fail open: the theme's native prices remain untouched.
    }
  };

  const observer = new MutationObserver(() => {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 50);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener("change", (event) => {
    if (
      !event.target?.matches?.(
        'select[name="id"],input[name="id"],select[name^="options"]',
      )
    ) {
      return;
    }
    window.setTimeout(() => {
      document.querySelectorAll("[data-vip-product-card]").forEach((card) => {
        card
          .querySelectorAll(
            ".vip-pricing-badge,.vip-pricing-member-price,.vip-pricing-access-message",
          )
          .forEach((element) => element.remove());
        delete card.dataset.vipPricingRendered;
      });
      scan();
    }, 100);
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load, { once: true });
  } else {
    load();
  }
})();
